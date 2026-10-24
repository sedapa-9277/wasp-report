(() => {
  const CFG = window.WASP_CONFIG;
  const $ = (id) => document.getElementById(id);

  // ---------- 언어 (한국어 / English) ----------
  let lang = "ko";
  try { lang = localStorage.getItem("wasp_lang") || "ko"; } catch {}
  if (!window.I18N[lang]) lang = "ko";
  const t = (key, vars = {}) => {
    const s = window.I18N[lang][key] ?? window.I18N.ko[key] ?? key;
    return typeof s === "string" ? s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "") : s;
  };

  // ---------- 저장소: Supabase REST (앱 버전에서도 같은 API 사용) ----------
  const Store = {
    h(extra) { return { apikey: CFG.SUPABASE_KEY, ...extra }; },
    async req(path, opt = {}) {
      const res = await fetch(CFG.SUPABASE_URL + path, { ...opt, headers: this.h(opt.headers) });
      if (!res.ok) throw new Error(await res.text());
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!opt.withCount) return data;
      return { data, total: +(res.headers.get("content-range") || "").split("/")[1] || 0 };
    },
    COLS: "id,kind,lat,lng,note,photo_urls,created_at,done,handler,done_at,reporter_phone4",
    // day: 'YYYY-MM-DD'(브라우저 현지 시간 기준 하루). 비우면 전체
    dayFilter(day) {
      if (!day) return "";
      const [y, m, d] = day.split("-").map(Number);
      const from = new Date(y, m - 1, d), to = new Date(y, m - 1, d + 1);
      return `&created_at=gte.${encodeURIComponent(from.toISOString())}&created_at=lt.${encodeURIComponent(to.toISOString())}`;
    },
    page(n, day) {
      return this.req(`/rest/v1/wasp_reports?select=${this.COLS}&order=created_at.desc${this.dayFilter(day)}`, {
        withCount: true, headers: { Range: `${n * PAGE_SIZE}-${n * PAGE_SIZE + PAGE_SIZE - 1}`, Prefer: "count=exact" },
      });
    },
    // 조건에 맞는 신고 건수 (본문 없이 개수만 받는다)
    async count(filter = "") {
      const res = await fetch(`${CFG.SUPABASE_URL}/rest/v1/wasp_reports?select=id${filter}`, { method: "HEAD", headers: this.h({ Prefer: "count=exact" }) });
      if (!res.ok) throw new Error("count");
      return +(res.headers.get("content-range") || "").split("/")[1] || 0;
    },
    // 마커용. reporter_phone4(전화번호 뒷자리)는 마커 표시를 위해 공개 조회를 허용해 둔 컬럼이다.
    markers() { return this.req("/rest/v1/wasp_reports?select=id,kind,lat,lng,note,done,created_at,done_at,handler,photo_urls,reporter_phone4&order=created_at.desc&limit=1000"); },
    async uploadPhoto(blob) {
      const name = `${crypto.randomUUID()}.jpg`;
      await this.req(`/storage/v1/object/wasp-photos/${name}`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
      return `${CFG.SUPABASE_URL}/storage/v1/object/public/wasp-photos/${name}`;
    },
    add(r) {
      return this.req("/rest/v1/wasp_reports", { method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(r) });
    },
    // 테스트 기간 한정 기능. 비밀번호 추가 시 이 함수와 목록의 삭제 버튼을 함께 손볼 것.
    async remove(id) {
      const rows = await this.req(`/rest/v1/wasp_reports?id=eq.${id}&select=id`, { method: "DELETE", headers: { Prefer: "return=representation" } });
      if (!rows.length) throw new Error("not deleted");
    },
    async complete(id, handler) {
      const rows = await this.req(`/rest/v1/wasp_reports?id=eq.${id}&done=eq.false&select=id`, {
        method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify({ done: true, handler, done_at: new Date().toISOString() }),
      });
      if (!rows.length) throw new Error("already done");
    },
    // 방문 1회(세션당) 집계 후 오늘 방문자 수 반환
    visit() {
      const count = !sessionStorage.getItem("wasp_counted");
      sessionStorage.setItem("wasp_counted", "1");
      return this.req("/rest/v1/rpc/wasp_hit_visit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ p_count: count }) });
    },
  };

  // ---------- 유틸 ----------
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const full = (iso) => { const d = new Date(iso); return `${ymd(d)} ${hm(d)}`; };
  const md = (iso) => { const d = new Date(iso); return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${hm(d)}`; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const kindName = (k) => t({ sighting: "kindSighting", nest: "kindNest", both: "kindBoth" }[k]);
  const PAGE_SIZE = 10;
  const TAP_RADIUS = 28; // 지도를 탭했을 때 이 거리(px) 안의 신고를 선택한 것으로 본다
  const MAX_PHOTOS = 3;
  const fmtSize = (b) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))}KB` : `${(b / 1024 / 1024).toFixed(1)}MB`);

  // 브라우저 기본 alert/confirm은 맨 위에 사이트 주소가 붙으므로 화면 안의 안내창을 쓴다
  function dialog(msg, withCancel) {
    return new Promise((resolve) => {
      const wrap = $("msgWrap"), ok = $("msgOk"), cancel = $("msgCancel");
      $("msgText").textContent = msg; cancel.hidden = !withCancel; wrap.hidden = false; ok.focus();
      const close = (v) => {
        wrap.hidden = true; ok.onclick = cancel.onclick = wrap.onclick = null;
        document.removeEventListener("keydown", onKey); resolve(v);
      };
      const onKey = (e) => { if (e.key === "Escape") close(false); };
      document.addEventListener("keydown", onKey);
      ok.onclick = () => close(true);
      cancel.onclick = () => close(false);
      wrap.onclick = (e) => { if (e.target === wrap) close(false); };
    });
  }
  const notify = (msg) => dialog(msg, false);
  const ask = (msg) => dialog(msg, true);

  // ---------- 상태 ----------
  let map, pickMarker, picked = null, photos = [], doneTarget = null, locating = false, mapMsgKey = null, info = null;
  let rows = [], pins = [], total = 0, pageNo = 0;
  let day = ymd(new Date()); // 목록에 보여줄 날짜. ''이면 전체
  const markers = {};
  const stats = { visit: null, reports: null, done: null };

  // ---------- 상단 현황 ----------
  function renderStats() {
    $("visit").innerHTML = stats.visit == null ? "" : `<span>${t("visitToday", { n: `<b>${stats.visit}</b>` })}</span>`;
    const chip = (label, v, cls = "") => `<div class="chip ${cls}">${label}<b>${v ?? "-"}</b></div>`;
    $("stats").innerHTML = chip(t("statAll"), stats.reports) + chip(t("statDone"), stats.done, "ok");
  }
  Store.visit().then((n) => { stats.visit = n; renderStats(); }).catch(() => {});

  // ---------- 지도 ----------
  function setMapMsg(key) {
    mapMsgKey = key; $("mapMsg").removeAttribute("data-i18n"); $("mapMsg").innerHTML = t(key);
  }

  function loadMap() {
    if (!CFG.KAKAO_JS_KEY || CFG.KAKAO_JS_KEY.startsWith("여기에")) return setMapMsg("mapNoKey");
    const s = document.createElement("script");
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${CFG.KAKAO_JS_KEY}&autoload=false`;
    s.onerror = () => setMapMsg("mapFail");
    s.onload = () => kakao.maps.load(initMap);
    document.head.appendChild(s);
  }

  function initMap() {
    $("mapMsg").hidden = true;
    const c = CFG.DEFAULT_CENTER;
    map = new kakao.maps.Map($("map"), { center: new kakao.maps.LatLng(c.lat, c.lng), level: 4 });
    map.addControl(new kakao.maps.MapTypeControl(), kakao.maps.ControlPosition.TOPRIGHT); // 일반지도 / 스카이뷰(위성)
    map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
    // 지도를 탭하면: 가까운(28px 이내) 신고가 있으면 그 신고를 열고, 없으면 신고 위치로 지정한다.
    // 손가락은 작은 마커를 정확히 누르기 어려워서 가장 가까운 마커를 대신 찾아 준다.
    kakao.maps.event.addListener(map, "click", (e) => {
      const proj = map.getProjection(), tap = proj.containerPointFromCoords(e.latLng);
      let best = null, bestD = TAP_RADIUS;
      for (const r of pins) {
        const p = proj.containerPointFromCoords(new kakao.maps.LatLng(r.lat, r.lng));
        const d = Math.hypot(p.x - tap.x, p.y - tap.y);
        if (d <= bestD && markers[r.id]) { bestD = d; best = r; }
      }
      if (best) openInfo(best, markers[best.id].marker);
      else setPick(e.latLng.getLat(), e.latLng.getLng());
    });
    renderMarkers(); renderList();
  }

  function renderPos() {
    $("posText").textContent = picked ? t("posPicked", { lat: picked.lat.toFixed(5), lng: picked.lng.toFixed(5) }) : locating ? t("posLocating") : t("posNone");
  }

  function setPick(lat, lng, pan) {
    picked = { lat, lng }; locating = false; renderPos();
    if (!map) return;
    const ll = new kakao.maps.LatLng(lat, lng);
    if (!pickMarker) pickMarker = new kakao.maps.Marker({ position: ll, map, zIndex: 10 });
    else pickMarker.setPosition(ll);
    if (pan) map.panTo(ll);
  }

  function markerImage(color) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26"><circle cx="13" cy="13" r="10" fill="${color}" stroke="#fff" stroke-width="3"/></svg>`;
    // 원의 중심이 좌표에 오도록 기준점을 이미지 가운데로 둔다
    return new kakao.maps.MarkerImage("data:image/svg+xml," + encodeURIComponent(svg), new kakao.maps.Size(26, 26), { offset: new kakao.maps.Point(13, 13) });
  }

  function renderMarkers() {
    if (!map) return;
    Object.values(markers).forEach((m) => m.setMap(null));
    pins.forEach((r) => {
      const pos = new kakao.maps.LatLng(r.lat, r.lng);
      const color = r.done ? "#2b8a3e" : r.kind !== "sighting" ? "#d9480f" : "#e67700";
      const marker = new kakao.maps.Marker({ position: pos, map, image: markerImage(color), clickable: true, title: `${kindName(r.kind)} ${r.note || ""}` });
      // 마커 옆 작은 라벨: 신고 일시(+전화번호 뒷자리), 줄바꿈 후 완료 일시
      const phone = r.reporter_phone4 ? ` ☎${esc(r.reporter_phone4)}` : "";
      // 라벨은 터치가 통과하게 두어(pointer-events:none) 옆 마커를 가리지 않는다
      const label = new kakao.maps.CustomOverlay({
        position: pos, xAnchor: 0, yAnchor: 0.5, zIndex: 1,
        content: `<div class="pin-label">${t("pinReport", { t: md(r.created_at) })}${phone}${r.done && r.done_at ? `<br><span class="ok">${t("pinDone", { t: md(r.done_at) })}</span>` : ""}</div>`,
      });
      label.setMap(map);
      kakao.maps.event.addListener(marker, "click", () => openInfo(r, marker));
      markers[r.id] = { marker, setMap(m) { marker.setMap(m); label.setMap(m); } };
    });
    if (info) { info.close(); info = null; } // 목록이 갱신되면 열려 있던 팝업은 닫는다
  }

  // 마커를 누르면 해당 신고 내용을 팝업으로 보여준다
  function openInfo(r, marker) {
    if (info) info.close();
    const imgs = (r.photo_urls || []).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="${esc(t("photoAlt"))}"></a>`).join("");
    info = new kakao.maps.InfoWindow({
      removable: true, zIndex: 20,
      content: `<div class="pin-info">
        <div><span class="tag ${r.kind}">${kindName(r.kind)}</span> <b>${esc(r.note || t("descNone"))}</b></div>
        <div class="row">${t("pinReport", { t: full(r.created_at) })}</div>
        ${r.reporter_phone4 ? `<div class="row">${t("pinPhone", { p: esc(r.reporter_phone4) })}</div>` : ""}
        ${r.done ? `<div class="row ok">${t("pinDone", { t: full(r.done_at) })}<br>${t("handlerLbl")} ${esc(r.handler || "-")}</div>` : `<div class="row">${t("pinPending")}</div>`}
        ${imgs ? `<div class="ph">${imgs}</div>` : ""}
      </div>`,
    });
    info.open(map, marker);
    // 마커가 지도 위쪽에 있으면 팝업이 잘리므로 마커가 아래쪽에 오도록 지도를 옮긴다
    const h = $("map").clientHeight, y = map.getProjection().containerPointFromCoords(marker.getPosition()).y;
    const want = Math.min(h - 30, Math.max(h * 0.7, 210)); // 팝업 높이(약 170~200px)만큼 위 공간 확보
    if (y < want) map.panBy(0, y - want);
  }

  // n: 이동할 페이지(0부터). 생략하면 현재 페이지를 다시 불러온다.
  async function refresh(n = pageNo) {
    try {
      const [p, m, all, done] = await Promise.all([Store.page(n, day), Store.markers(), Store.count(), Store.count("&done=eq.true")]);
      stats.reports = all; stats.done = done; renderStats();
      // 마지막 페이지의 항목이 모두 사라진 경우(예: 삭제) 한 페이지 앞으로
      if (!p.data.length && n > 0 && p.total) return refresh(Math.ceil(p.total / PAGE_SIZE) - 1);
      rows = p.data; total = p.total; pins = m; pageNo = n;
    } catch { $("list").innerHTML = `<div class="empty">${t("listFail")}</div>`; return; }
    renderMarkers(); renderList();
  }

  // ---------- 현위치 ----------
  $("btnLocate").onclick = () => {
    if (!navigator.geolocation) return notify(t("noGeo"));
    locating = true; renderPos();
    navigator.geolocation.getCurrentPosition(
      (p) => setPick(p.coords.latitude, p.coords.longitude, true),
      () => { locating = false; renderPos(); notify(t("geoFail")); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // ---------- 사진 (축소 후 업로드) ----------
  function shrink(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const max = 1024, k = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(img.src);
        cv.toBlob((b) => (b ? resolve({ blob: b, w: cv.width, h: cv.height }) : reject()), "image/jpeg", 0.7);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  async function addPhotos(files) {
    const room = MAX_PHOTOS - photos.length;
    if (files.length > room) notify(t("photoMax", { n: MAX_PHOTOS }));
    for (const f of files.slice(0, Math.max(room, 0))) {
      try { const s = await shrink(f); photos.push({ ...s, orig: f.size, url: URL.createObjectURL(s.blob) }); }
      catch { notify(t("photoLoadFail")); }
    }
    renderPhotos();
  }

  function renderPhotos() {
    $("previews").innerHTML = photos.map((p, i) =>
      `<div class="thumb"><img src="${p.url}" alt="${esc(t("photoAlt"))} ${i + 1}"><button type="button" data-i="${i}" aria-label="${esc(t("photoDel"))}">×</button>
        <div class="cap">${p.w}×${p.h}<br>${fmtSize(p.blob.size)}${p.orig > p.blob.size ? `<br><s>${t("photoOrig", { s: fmtSize(p.orig) })}</s>` : ""}</div></div>`).join("");
    $("photoCount").textContent = photos.length ? `(${photos.length}/${MAX_PHOTOS})` : "";
  }

  function clearPhotos() {
    photos.forEach((p) => URL.revokeObjectURL(p.url)); photos = []; renderPhotos();
  }

  $("photoCam").onchange = (e) => { addPhotos([...e.target.files]); e.target.value = ""; };
  $("photoGal").onchange = (e) => { addPhotos([...e.target.files]); e.target.value = ""; };
  $("previews").onclick = (e) => {
    const b = e.target.closest("button[data-i]"); if (!b) return;
    const [p] = photos.splice(+b.dataset.i, 1); URL.revokeObjectURL(p.url); renderPhotos();
  };

  // ---------- 신고 ----------
  $("phone4").oninput = (e) => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4); }; // 숫자만
  $("form").onsubmit = async (e) => {
    e.preventDefault();
    const checked = [...document.querySelectorAll('input[name="kind"]:checked')].map((c) => c.value);
    const kind = checked.length === 2 ? "both" : checked[0];
    if (!picked) return notify(t("needPos"));
    if (!kind) return notify(t("needKind"));
    const phone4 = $("phone4").value.trim();
    if (!/^\d{4}$/.test(phone4)) return notify(t("needPhone"));
    const btn = e.submitter; btn.disabled = true;
    try {
      const photo_urls = await Promise.all(photos.map((p) => Store.uploadPhoto(p.blob)));
      await Store.add({ kind, lat: picked.lat, lng: picked.lng, note: $("note").value.trim() || null, photo_urls, reporter_phone4: phone4 });
    } catch { btn.disabled = false; return notify(t("submitFail")); }
    btn.disabled = false;
    $("form").reset(); clearPhotos();
    picked = null; renderPos();
    if (pickMarker) { pickMarker.setMap(null); pickMarker = null; }
    if (day) setDay(ymd(new Date()), false); // 새 신고가 보이도록 오늘로 이동
    await refresh(0); // 새 신고는 첫 페이지 맨 위에 나온다
    notify(t("submitOk"));
  };

  // ---------- 목록 (날짜별) ----------
  function renderList() {
    $("count").textContent = t("countFmt", { day: day || t("allShort"), n: total });
    renderPager();
    if (!rows.length) { $("list").innerHTML = `<div class="empty">${t(day ? "emptyDay" : "emptyAll")}</div>`; return; }
    let html = "", cur = "";
    for (const r of rows) {
      const d = ymd(new Date(r.created_at));
      if (d !== cur) { cur = d; html += `<div class="date">${d}</div>`; }
      html += `<div class="item" data-id="${r.id}">
        <div class="head">
          <span><span class="tag ${r.kind}">${kindName(r.kind)}</span> ${esc(r.note || t("descNone"))}</span>
          <span class="tag ${r.done ? "done" : ""}" style="${r.done ? "" : "background:#868e96"}">${t(r.done ? "statusDone" : "statusNew")}</span>
        </div>
        <div class="meta">${t("reportedAt", { t: hm(new Date(r.created_at)) })}${r.reporter_phone4 ? ` · ${t("pinPhone", { p: esc(r.reporter_phone4) })}` : ""}</div>
        ${r.photo_urls?.length ? `<div class="thumbs">${r.photo_urls.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="${esc(t("photoAlt"))}" loading="lazy"></a>`).join("")}</div>` : ""}
        ${r.done ? `<div class="result">✔ ${t("handlerLbl")} ${esc(r.handler)} · ${full(r.done_at)}</div>` : ""}
        <div class="acts">
          ${map ? `<button class="btn sub" data-act="show">${t("show")}</button>` : ""}
          ${r.done ? "" : `<button class="btn sub" data-act="done">${t("markDone")}</button>`}
          <button class="btn sub danger" data-act="del">${t("del")}</button>
        </div></div>`;
    }
    $("list").innerHTML = html;
  }

  // ---------- 날짜 선택 ----------
  function setDay(d, reload = true) {
    day = d; $("dayPick").value = d;
    const [y, m, dd] = (d || "").split("-").map(Number);
    $("dayText").textContent = d ? `${d} (${t("weekdays")[new Date(y, m - 1, dd).getDay()]})` : t("allRange");
    const today = ymd(new Date());
    $("dayPick").max = today;
    $("dayNext").disabled = !d || d >= today; // 오늘 이후(미래)로는 이동 불가
    document.querySelectorAll("#datebar [data-day]").forEach((b) => {
      b.classList.toggle("on", (b.dataset.day === "today" && d === ymd(new Date())) || (b.dataset.day === "all" && !d));
    });
    if (reload) refresh(0);
  }
  const shiftDay = (delta) => {
    const [y, m, d] = (day || ymd(new Date())).split("-").map(Number);
    setDay(ymd(new Date(y, m - 1, d + delta)));
  };
  $("dayPrev").onclick = () => shiftDay(-1);
  $("dayNext").onclick = () => shiftDay(1);
  $("dayToday").onclick = () => setDay(ymd(new Date()));
  $("dayAll").onclick = () => setDay("");
  $("dayPick").onchange = (e) => { const tt = ymd(new Date()); setDay(e.target.value > tt ? tt : e.target.value); }; // 지우면 전체, 미래는 오늘로
  $("dayPick").onclick = (e) => { try { e.target.showPicker(); } catch {} }; // 글자 부분을 눌러도 달력이 열리게

  function renderPager() {
    const pages = Math.ceil(total / PAGE_SIZE);
    if (pages <= 1) { $("pager").innerHTML = ""; return; }
    const from = Math.max(0, Math.min(pageNo - 2, pages - 5)), to = Math.min(pages, from + 5);
    let html = `<button data-p="${pageNo - 1}" ${pageNo === 0 ? "disabled" : ""} aria-label="${esc(t("pagePrev"))}">‹</button>`;
    for (let i = from; i < to; i++) html += `<button data-p="${i}" class="${i === pageNo ? "on" : ""}">${i + 1}</button>`;
    html += `<button data-p="${pageNo + 1}" ${pageNo >= pages - 1 ? "disabled" : ""} aria-label="${esc(t("pageNext"))}">›</button>`;
    $("pager").innerHTML = html;
  }

  $("pager").onclick = async (e) => {
    const b = e.target.closest("button[data-p]"); if (!b || b.disabled) return;
    await refresh(+b.dataset.p);
    $("list").scrollIntoView({ behavior: "smooth", block: "start" });
  };

  $("list").onclick = async (e) => {
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const id = b.closest(".item").dataset.id;
    const r = rows.find((x) => x.id === id);
    if (b.dataset.act === "del") {
      if (!(await ask(t("delConfirm")))) return;
      try { await Store.remove(id); } catch { return notify(t("delFail")); }
      await refresh();
    } else if (b.dataset.act === "show" && map) {
      map.setCenter(new kakao.maps.LatLng(r.lat, r.lng)); map.setLevel(3);
      $("map").scrollIntoView({ behavior: "smooth" });
    } else if (b.dataset.act === "done") {
      doneTarget = id;
      $("doneTime").textContent = full(new Date().toISOString());
      $("handler").value = localStorage.getItem("wasp_handler") || "";
      $("doneDialogWrap").hidden = false; $("handler").focus();
    }
  };

  $("doneCancel").onclick = () => { $("doneDialogWrap").hidden = true; };
  $("doneForm").onsubmit = async (e) => {
    e.preventDefault();
    const h = $("handler").value.trim(); if (!h) return;
    localStorage.setItem("wasp_handler", h);
    try { await Store.complete(doneTarget, h); }
    catch { notify(t("doneFail")); }
    $("doneDialogWrap").hidden = true;
    await refresh();
  };

  // ---------- 설정 / 사용 설명서 ----------
  const openModal = (id) => { $(id).hidden = false; };
  const closeModal = (id) => { $(id).hidden = true; };
  const MODALS = [["settingsWrap", "settingsClose"], ["helpWrap", "helpClose"], ["infoWrap", "infoClose"]];
  for (const [wrap, closeBtn] of MODALS) {
    $(closeBtn).onclick = () => closeModal(wrap);
    $(wrap).onclick = (e) => { if (e.target === $(wrap)) closeModal(wrap); };
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") MODALS.forEach(([wrap]) => closeModal(wrap)); });
  // 사진은 가이드를 열 때 그린다 (열지 않는 방문자는 사진을 내려받지 않는다)
  $("btnInfo").onclick = () => { renderInfo(); openModal("infoWrap"); };
  $("btnSettings").onclick = () => {
    document.querySelector(`input[name="lang"][value="${lang}"]`).checked = true;
    openModal("settingsWrap");
  };
  $("btnHelp").onclick = () => openModal("helpWrap");
  $("openHelp").onclick = () => { closeModal("settingsWrap"); openModal("helpWrap"); };
  document.querySelectorAll('input[name="lang"]').forEach((r) => { r.onchange = () => setLang(r.value); });

  function renderHelp() {
    $("helpBody").innerHTML = t("helpDoc").map((s) => `<h4>${esc(s.h)}</h4><ul>${s.p.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`).join("");
  }

  // 말벌 사진: Wikimedia Commons (각 사진의 작성자·라이선스를 사진 아래에 표시)
  const cm = (path) => `https://upload.wikimedia.org/wikipedia/commons/thumb/${path}`;
  const WASP_IMG = {
    mandarinia: { src: cm("9/94/Vespa_mandarinia_japonica.jpg/500px-Vespa_mandarinia_japonica.jpg"), file: "Vespa_mandarinia_japonica.jpg", by: "Michael J. Trout", lic: "CC BY-SA 4.0" },
    velutina: { src: cm("c/cc/Asian_hornet_%28Vespa_velutina%29.jpg/500px-Asian_hornet_%28Vespa_velutina%29.jpg"), file: "Asian_hornet_(Vespa_velutina).jpg", by: "Charles J. Sharp", lic: "CC BY-SA 4.0" },
    crabro: { src: cm("3/36/European_hornet_090621.jpg/500px-European_hornet_090621.jpg"), file: "European_hornet_090621.jpg", by: "Aconcagua", lic: "CC BY-SA 3.0" },
    simillima: { src: cm("3/31/Vespa_simillima_xanthoptera01.jpg/500px-Vespa_simillima_xanthoptera01.jpg"), file: "Vespa_simillima_xanthoptera01.jpg", by: "Takahashi", lic: "CC BY-SA 3.0" },
    analis: { src: cm("1/12/Vespa_analis_insularis.jpg/500px-Vespa_analis_insularis.jpg"), file: "Vespa_analis_insularis.jpg", by: "Toshihiro Gamo", lic: "CC BY 2.0" },
    polistes: { src: cm("1/10/Paper_wasp_%28polistes_wattii%29.jpg/500px-Paper_wasp_%28polistes_wattii%29.jpg"), file: "Paper_wasp_(polistes_wattii).jpg", by: "Charles J. Sharp", lic: "CC BY-SA 3.0" },
  };

  function renderInfo() {
    const list = (s) => `<${s.ordered ? "ol" : "ul"}>${s.p.map((x) => `<li>${esc(x)}</li>`).join("")}</${s.ordered ? "ol" : "ul"}>`;
    const wasps = () => t("waspList").map((w) => {
      const im = WASP_IMG[w.id];
      return `<div class="wasp"><div class="ph"><img src="${im.src}" alt="${esc(w.name)}" onerror="this.style.visibility='hidden'">
        <small><a href="https://commons.wikimedia.org/wiki/File:${im.file}" target="_blank" rel="noopener">${esc(t("photoCredit"))}: ${esc(im.by)} · ${im.lic}</a></small></div>
        <div class="tx"><b>${esc(w.name)}</b> <i>${esc(w.sci)}</i><p>${esc(w.desc)}</p></div></div>`;
    }).join("");
    $("infoBody").innerHTML = t("infoSections").map((s) => s.species
      ? `<section class="info-sec"><h4>${esc(s.h)}</h4><p class="tip">${esc(s.tip)}</p>${wasps()}</section>`
      : `<section class="info-sec${s.danger ? " danger" : ""}"><h4>${esc(s.h)}</h4>${list(s)}</section>`).join("")
      + `<p class="info-note">${esc(t("infoNote"))}</p>`;
  }

  // data-i18n(글자) / data-i18n-ph(입력 예시) / data-i18n-aria(접근성 이름)를 현재 언어로 채우고 동적 화면을 다시 그린다
  function applyLang() {
    document.documentElement.lang = lang;
    document.title = t("title");
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    document.querySelectorAll("[data-i18n-aria]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.i18nAria)); });
    if (mapMsgKey) $("mapMsg").innerHTML = t(mapMsgKey);
    renderPos(); renderStats(); renderPhotos(); renderHelp(); if (!$("infoWrap").hidden) renderInfo();
    setDay(day, false); renderList(); renderMarkers();
  }

  function setLang(l) {
    lang = l;
    try { localStorage.setItem("wasp_lang", l); } catch {}
    applyLang();
  }

  applyLang();
  refresh();
  loadMap();
})();
