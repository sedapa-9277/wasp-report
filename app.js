(() => {
  const CFG = window.WASP_CONFIG;
  const $ = (id) => document.getElementById(id);

  // ---------- 언어 (한국어 / English) ----------
  let lang = "ko";
  try { lang = localStorage.getItem("wasp_lang") || "ko"; } catch {}
  try { localStorage.removeItem("wasp_handler"); } catch {} // 예전 버전이 저장해 둔 담당자 이름을 지운다
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
    COLS: "id,report_no,kind,lat,lng,note,photo_urls,created_at,done,handler,done_at,reporter_phone4,address,wasp_species,wasp_count,nest_size",
    // day: 'YYYY-MM-DD'(브라우저 현지 시간 기준 하루). 비우면 전체
    dayFilter(day) {
      if (!day) return "";
      const [y, m, d] = day.split("-").map(Number);
      const from = new Date(y, m - 1, d), to = new Date(y, m - 1, d + 1);
      return `&created_at=gte.${encodeURIComponent(from.toISOString())}&created_at=lt.${encodeURIComponent(to.toISOString())}`;
    },
    // q: 전화번호 뒷자리 검색어(숫자만). 검색 중에는 날짜와 상관없이 전체에서 찾는다.
    page(n, day, q) {
      const filter = q ? `&reporter_phone4=like.*${q}*` : this.dayFilter(day);
      return this.req(`/rest/v1/wasp_reports?select=${this.COLS}&order=created_at.desc${filter}`, {
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
    markers() { return this.req("/rest/v1/wasp_reports?select=id,report_no,kind,lat,lng,note,done,created_at,done_at,handler,photo_urls,reporter_phone4,address,wasp_species,wasp_count,nest_size&order=created_at.desc&limit=1000"); },
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
      // { today, total } (오늘 / 누적)
      return this.req("/rest/v1/rpc/wasp_visit_stats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ p_count: count }) });
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
  let phoneQ = ""; // 전화번호 뒷자리 검색어. 있으면 날짜 대신 이것으로 목록을 거른다
  const markers = {};
  let mapFilter = "all"; // 지도에 보일 신고: all / pending / done
  let showLabels = true; // 마커 옆 신고·완료 일시 표시 (설정)
  try { showLabels = localStorage.getItem("wasp_labels") !== "0"; } catch {}
  const stats = { visit: null, reports: null, done: null };

  // ---------- 상단 현황 ----------
  function renderStats() {
    $("visit").innerHTML = stats.visit == null ? "" :
      `<span>${t("visitToday", { n: `<b>${stats.visit.today}</b>` })}</span><span>${t("visitTotal", { n: `<b>${stats.visit.total}</b>` })}</span>`;
    const chip = (label, v, cls = "") => `<div class="chip ${cls}">${label}<b>${v ?? "-"}</b></div>`;
    $("stats").innerHTML = chip(t("statAll"), stats.reports) + chip(t("statDone"), stats.done, "ok");
  }
  Store.visit().then((v) => { stats.visit = v; renderStats(); }).catch(() => {});

  // ---------- 지도 ----------
  function setMapMsg(key) {
    mapMsgKey = key; $("mapMsg").removeAttribute("data-i18n"); $("mapMsg").innerHTML = t(key);
  }

  function loadMap() {
    if (!CFG.KAKAO_JS_KEY || CFG.KAKAO_JS_KEY.startsWith("여기에")) return setMapMsg("mapNoKey");
    const s = document.createElement("script");
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${CFG.KAKAO_JS_KEY}&autoload=false&libraries=services`;
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
    // 지도 왼쪽 위: 전체 / 처리 대기 / 처리 완료만 보기
    const bar = document.createElement("div");
    bar.id = "mapFilter"; bar.className = "map-filter";
    bar.onclick = (e) => {
      const b = e.target.closest("button[data-f]"); if (!b) return;
      mapFilter = b.dataset.f; renderMapFilter(); renderMarkers();
    };
    $("map").appendChild(bar);
    renderMapFilter();
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
    // 흰 테두리 바깥에 가는 진한 테두리를 둘러 밝은 지도에서도(특히 노란 마커) 잘 보이게 한다
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26"><circle cx="13" cy="13" r="10" fill="${color}" stroke="#fff" stroke-width="3"/><circle cx="13" cy="13" r="12" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="1"/></svg>`;
    // 원의 중심이 좌표에 오도록 기준점을 이미지 가운데로 둔다
    return new kakao.maps.MarkerImage("data:image/svg+xml," + encodeURIComponent(svg), new kakao.maps.Size(26, 26), { offset: new kakao.maps.Point(13, 13) });
  }

  const pinVisible = (r) => mapFilter === "all" || (mapFilter === "done") === !!r.done;

  function renderMapFilter() {
    const bar = $("mapFilter"); if (!bar) return;
    const n = { all: pins.length, pending: pins.filter((r) => !r.done).length, done: pins.filter((r) => r.done).length };
    bar.setAttribute("role", "group"); bar.setAttribute("aria-label", t("mapFilterLabel"));
    bar.innerHTML = [["all", "filterAll"], ["pending", "filterPending"], ["done", "filterDone"]]
      .map(([f, k]) => `<button type="button" data-f="${f}" class="${mapFilter === f ? "on" : ""}">${t(k)} <b>${n[f]}</b></button>`).join("");
  }

  function renderMarkers() {
    if (!map) return;
    Object.values(markers).forEach((m) => m.setMap(null));
    for (const k of Object.keys(markers)) delete markers[k]; // 걸러진 신고는 탭 선택 대상에서도 빠진다
    renderMapFilter();
    pins.filter(pinVisible).forEach((r) => {
      const pos = new kakao.maps.LatLng(r.lat, r.lng);
      const marker = new kakao.maps.Marker({ position: pos, map, image: markerImage(pinColor(r)), clickable: true, title: `${kindName(r.kind)} ${r.note || ""}` });
      // 마커 옆 작은 라벨: 신고 일시(+전화번호 뒷자리), 줄바꿈 후 완료 일시
      const phone = r.reporter_phone4 ? ` ☎${esc(r.reporter_phone4)}` : "";
      // 라벨은 터치가 통과하게 두어(pointer-events:none) 옆 마커를 가리지 않는다
      const label = showLabels ? new kakao.maps.CustomOverlay({
        position: pos, xAnchor: 0, yAnchor: 0.5, zIndex: 1,
        content: `<div class="pin-label">${t("pinReport", { t: md(r.created_at) })}${phone}${r.done && r.done_at ? `<br><span class="ok">${t("pinDone", { t: md(r.done_at) })}</span>` : ""}</div>`,
      }) : null;
      if (label) label.setMap(map);
      kakao.maps.event.addListener(marker, "click", () => openInfo(r, marker));
      markers[r.id] = { marker, setMap(m) { marker.setMap(m); if (label) label.setMap(m); } };
    });
    closeInfo(); // 목록이 갱신되면 열려 있던 팝업은 닫는다
  }

  // 처리완료 초록 / 벌집(목격+벌집 포함) 빨강 / 벌 목격 노랑
  const pinColor = (r) => (r.done ? "#2b8a3e" : r.kind !== "sighting" ? "#d9480f" : "#f5c400");

  // ---------- 주소 (카카오 좌표→행정구역 변환: 시·구·동) ----------
  const addrCache = new Map();
  const addrOf = (r) => r.address || addrCache.get(r.id) || "";
  const addrHtml = (r) => (addrOf(r) ? `📍 ${esc(addrOf(r))}` : "");

  function geocode(lat, lng) {
    return new Promise((resolve) => {
      if (!window.kakao?.maps?.services) return resolve(null);
      const timer = setTimeout(() => resolve(null), 4000);
      new kakao.maps.services.Geocoder().coord2RegionCode(lng, lat, (res, status) => {
        clearTimeout(timer);
        if (status !== kakao.maps.services.Status.OK || !res.length) return resolve(null);
        const reg = res.find((x) => x.region_type === "B") || res[0]; // 법정동 우선
        resolve(reg.address_name || null);
      });
    });
  }

  // 주소가 저장되지 않은 신고(이전에 접수된 것)는 화면에 보일 때 좌표로 주소를 구해 채운다
  async function fillAddresses(list) {
    if (!window.kakao?.maps?.services) return;
    for (const r of list) {
      if (r.address || addrCache.has(r.id)) continue;
      const a = await geocode(r.lat, r.lng);
      if (!a) continue;
      addrCache.set(r.id, a);
      document.querySelectorAll(`[data-addr="${r.id}"]`).forEach((el) => { el.innerHTML = addrHtml(r); });
    }
  }

  // ---------- 마커를 누르면 나오는 상세 팝업 ----------
  // 카카오 기본 InfoWindow는 테두리가 흐려서, 마커 색과 같은 굵은 테두리의 팝업을 직접 만든다.
  function closeInfo() { if (info) { info.setMap(null); info = null; } }

  function openInfo(r, marker) {
    closeInfo();
    const imgs = (r.photo_urls || []).map((u) => `<a href="${esc(u)}" class="zoom"><img src="${esc(u)}" alt="${esc(t("photoAlt"))}"></a>`).join("");
    const el = document.createElement("div");
    el.className = "pop-wrap";
    el.innerHTML = `<div class="pin-pop" style="--pc:${pinColor(r)}">
      <button type="button" class="pop-x" aria-label="${esc(t("close"))}">×</button>
      <div class="pop-head"><span class="no">${t("reportNo", { n: r.report_no })}</span> <span class="tag ${r.kind}">${kindName(r.kind)}</span></div>
      <div class="row addr" data-addr="${r.id}">${addrHtml(r)}</div>
      ${r.note ? `<div class="row note">${esc(t("noteLabel"))}: ${esc(r.note)}</div>` : ""}
      ${extraText(r).map((x) => `<div class="row">${esc(x)}</div>`).join("")}
      <div class="row">${t("pinReport", { t: full(r.created_at) })}</div>
      ${r.reporter_phone4 ? `<div class="row">${t("pinPhone", { p: esc(r.reporter_phone4) })}</div>` : ""}
      ${r.done ? `<div class="row ok">${t("pinDone", { t: full(r.done_at) })}<br>${t("handlerLbl")} ${esc(r.handler || "-")}</div>` : `<div class="row">${t("pinPending")}</div>`}
      ${imgs ? `<div class="ph">${imgs}</div>` : ""}
    </div>`;
    el.querySelector(".pop-x").onclick = closeInfo;
    // 마커 위쪽에 띄운다. clickable:true라서 팝업을 눌러도 지도 클릭(위치 지정)이 일어나지 않는다.
    info = new kakao.maps.CustomOverlay({ position: marker.getPosition(), content: el, xAnchor: 0.5, yAnchor: 1, zIndex: 20, clickable: true });
    info.setMap(map);
    // 팝업이 지도 위쪽에서 잘리지 않도록, 팝업 높이만큼 위 공간이 생기게 지도를 옮긴다
    const y = map.getProjection().containerPointFromCoords(marker.getPosition()).y;
    const need = el.offsetHeight + 12;
    if (y < need) map.panBy(0, y - need);
    fillAddresses([r]);
  }

  // n: 이동할 페이지(0부터). 생략하면 현재 페이지를 다시 불러온다.
  async function refresh(n = pageNo) {
    try {
      const [p, m, all, done] = await Promise.all([Store.page(n, day, phoneQ), Store.markers(), Store.count(), Store.count("&done=eq.true")]);
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

  // ---------- 벌 종류 / 개체수 / 벌집 크기 (모두 선택 입력) ----------
  const SPECIES = ["mandarinia", "velutina", "crabro", "simillima", "analis", "polistes", "unknown"]; // 국내에서 많이 신고되는 순서대로 안내서와 같은 6종 + 모르겠음
  const COUNTS = ["le5", "6to10", "ge11"];
  const SIZES = ["le20", "21to50", "ge51"];
  const sel = { species: null, count: null, size: null };
  const KINDS = ["sighting", "nest"];
  const selKinds = new Set(); // 구분(필수)은 둘 다 고를 수 있다
  const speciesName = (id) => (id === "unknown" ? t("speciesUnknown") : t("waspList").find((w) => w.id === id)?.name || id);

  function renderChips() {
    const chips = (group, values, label) => values.map((v) =>
      `<button type="button" class="chip-btn" data-g="${group}" data-v="${v}" aria-pressed="${sel[group] === v}">${esc(label(v))}</button>`).join("");
    $("chipsKind").innerHTML = KINDS.map((v) =>
      `<button type="button" class="chip-btn" data-k="${v}" aria-pressed="${selKinds.has(v)}">${esc(t(v === "sighting" ? "kindSighting" : "kindNest"))}</button>`).join("");
    $("chipsSpecies").innerHTML = chips("species", SPECIES, speciesName);
    $("chipsCount").innerHTML = chips("count", COUNTS, (v) => t("count_" + v));
    $("chipsSize").innerHTML = chips("size", SIZES, (v) => t("size_" + v));
  }
  // 칩을 다시 누르면 선택이 풀린다(선택 입력이므로)
  for (const id of ["chipsSpecies", "chipsCount", "chipsSize"]) {
    $(id).onclick = (e) => {
      const b = e.target.closest("button[data-g]"); if (!b) return;
      sel[b.dataset.g] = sel[b.dataset.g] === b.dataset.v ? null : b.dataset.v;
      renderChips();
    };
  }
  $("chipsKind").onclick = (e) => {
    const b = e.target.closest("button[data-k]"); if (!b) return;
    const k = b.dataset.k;
    if (selKinds.has(k)) selKinds.delete(k); else selKinds.add(k);
    renderChips(); updateGroups();
  };
  // 개체수는 '벌 목격', 벌집 크기는 '벌집 위치'를 골랐을 때만 묻는다
  const checkedKinds = () => KINDS.filter((k) => selKinds.has(k));
  function updateGroups() {
    $("grpCount").hidden = !selKinds.has("sighting");
    $("grpSize").hidden = !selKinds.has("nest");
  }
  $("seePhotos").onclick = () => { renderInfo(); openModal("infoWrap"); };

  const extraText = (r) => [
    r.wasp_species && `${t("speciesLabel")}: ${speciesName(r.wasp_species)}`,
    r.wasp_count && t("pinCount", { v: t("count_" + r.wasp_count) }),
    r.nest_size && t("pinSize", { v: t("size_" + r.nest_size) }),
  ].filter(Boolean);
  const extraHtml = (r) => extraText(r).map((x) => `<span class="xt">${esc(x)}</span>`).join("");

  // ---------- 신고 ----------
  $("phone4").oninput = (e) => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4); }; // 숫자만
  $("form").onsubmit = async (e) => {
    e.preventDefault();
    const checked = checkedKinds();
    const kind = checked.length === 2 ? "both" : checked[0];
    if (!picked) return notify(t("needPos"));
    if (!kind) return notify(t("needKind"));
    const phone4 = $("phone4").value.trim();
    if (!/^\d{4}$/.test(phone4)) return notify(t("needPhone"));
    const btn = e.submitter; btn.disabled = true;
    try {
      const photo_urls = await Promise.all(photos.map((p) => Store.uploadPhoto(p.blob)));
      const address = await geocode(picked.lat, picked.lng); // 시·구·동. 구하지 못해도 신고는 접수된다
      await Store.add({ kind, lat: picked.lat, lng: picked.lng, note: $("note").value.trim() || null, photo_urls, reporter_phone4: phone4, address,
        wasp_species: sel.species,
        wasp_count: checked.includes("sighting") ? sel.count : null, // 안 묻는 항목은 보내지 않는다
        nest_size: checked.includes("nest") ? sel.size : null });
    } catch { btn.disabled = false; return notify(t("submitFail")); }
    btn.disabled = false;
    $("form").reset(); clearPhotos();
    sel.species = sel.count = sel.size = null; selKinds.clear(); renderChips(); updateGroups();
    picked = null; renderPos();
    if (pickMarker) { pickMarker.setMap(null); pickMarker = null; }
    if (phoneQ) setSearch("", false);
    if (day) setDay(ymd(new Date()), false); // 새 신고가 보이도록 오늘로 이동
    await refresh(0); // 새 신고는 첫 페이지 맨 위에 나온다
    notify(t("submitOk"));
  };

  // ---------- 목록 (날짜별) ----------
  function renderList() {
    $("count").textContent = phoneQ ? t("countSearch", { q: phoneQ, n: total }) : t("countFmt", { day: day || t("allShort"), n: total });
    renderPager();
    if (!rows.length) { $("list").innerHTML = `<div class="empty">${t(phoneQ ? "emptySearch" : day ? "emptyDay" : "emptyAll")}</div>`; return; }
    let html = "", cur = "";
    for (const r of rows) {
      const d = ymd(new Date(r.created_at));
      if (d !== cur) { cur = d; html += `<div class="date">${d}</div>`; }
      html += `<div class="item" data-id="${r.id}">
        <div class="head">
          <span><span class="no">${t("reportNo", { n: r.report_no })}</span> <span class="tag ${r.kind}">${kindName(r.kind)}</span></span>
          <span class="tag ${r.done ? "done" : ""}" style="${r.done ? "" : "background:#868e96"}">${t(r.done ? "statusDone" : "statusNew")}</span>
        </div>
        <div class="addr" data-addr="${r.id}">${addrHtml(r)}</div>
        ${r.note ? `<div class="note">${esc(t("noteLabel"))}: ${esc(r.note)}</div>` : ""}
        <div class="extra">${extraHtml(r)}</div>
        <div class="meta">${t("reportedAt", { t: hm(new Date(r.created_at)) })}${r.reporter_phone4 ? ` · ${t("pinPhone", { p: esc(r.reporter_phone4) })}` : ""}</div>
        ${r.photo_urls?.length ? `<div class="thumbs">${r.photo_urls.map((u) => `<a href="${esc(u)}" class="zoom"><img src="${esc(u)}" alt="${esc(t("photoAlt"))}" loading="lazy"></a>`).join("")}</div>` : ""}
        ${r.done ? `<div class="result">✔ ${t("handlerLbl")} ${esc(r.handler)} · ${full(r.done_at)}</div>` : ""}
        <div class="acts">
          ${map ? `<button class="btn sub" data-act="show">${t("show")}</button>` : ""}
          ${r.done ? "" : `<button class="btn sub" data-act="done">${t("markDone")}</button>`}
          <button class="btn sub danger" data-act="del">${t("del")}</button>
        </div></div>`;
    }
    $("list").innerHTML = html;
    fillAddresses(rows);
  }

  // ---------- 날짜 선택 ----------
  function setDay(d, reload = true) {
    if (reload && phoneQ) setSearch("", false); // 날짜를 바꾸면 검색을 끝내고 날짜별 보기로 돌아간다
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

  // ---------- 하단 탭 (좁은 화면에서만 보인다. 넓은 화면은 두 칸 배치라 둘 다 보임) ----------
  function setTab(tab, scroll = true) {
    document.body.classList.toggle("tab-report", tab === "report");
    document.body.classList.toggle("tab-list", tab === "list");
    document.querySelectorAll("#tabbar button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    try { sessionStorage.setItem("wasp_tab", tab); } catch {}
    if (!scroll) return;
    // 신고하기는 지도부터(위치 지정), 목록은 목록부터 보이게
    if (tab === "report") window.scrollTo({ top: 0, behavior: "smooth" });
    else document.querySelector(".list-card").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  $("tabbar").onclick = (e) => { const b = e.target.closest("button[data-tab]"); if (b) setTab(b.dataset.tab); };
  let startTab = "report";
  try { startTab = sessionStorage.getItem("wasp_tab") || "report"; } catch {}
  setTab(startTab, false);

  // ---------- 전화번호 뒷자리 검색 ----------
  function setSearch(q, reload = true) {
    phoneQ = q;
    if ($("phoneQ").value !== q) $("phoneQ").value = q;
    $("phoneQClear").hidden = !q;
    $("datebar").classList.toggle("dim", !!q); // 검색 중에는 날짜 선택이 적용되지 않음을 흐리게 표시
    if (reload) refresh(0);
  }
  // 입력만으로는 검색하지 않고, '검색' 버튼(또는 키보드의 검색/Enter)을 눌렀을 때 한 번만 찾는다
  $("phoneQ").oninput = (e) => {
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4); // 숫자만
    $("phoneQClear").hidden = !e.target.value && !phoneQ;
  };
  $("searchForm").onsubmit = (e) => {
    e.preventDefault();
    $("phoneQ").blur(); // 휴대폰 키보드를 내린다
    setSearch($("phoneQ").value);
  };
  $("phoneQClear").onclick = () => { $("phoneQ").value = ""; if (phoneQ) setSearch(""); else $("phoneQClear").hidden = true; $("phoneQ").focus(); };

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
      $("handler").value = "";
      $("doneDialogWrap").hidden = false; $("handler").focus();
    }
  };

  $("doneCancel").onclick = () => { $("doneDialogWrap").hidden = true; };
  $("doneForm").onsubmit = async (e) => {
    e.preventDefault();
    const h = $("handler").value.trim(); if (!h) return;
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
  // ---------- 사진 크게 보기 ----------
  // 사진 링크를 새 창으로 열면 휴대폰에서 돌아올 때 페이지가 다시 불러와져 지도 위치가 처음으로 돌아간다.
  // 그래서 같은 화면 위에 확대 창을 띄운다. (휴대폰의 뒤로 가기 버튼은 이 창만 닫는다)
  let lbOpen = false;
  function openLightbox(src) {
    $("lbImg").src = src; $("lightbox").hidden = false;
    if (!lbOpen) { lbOpen = true; history.pushState({ lb: 1 }, ""); }
  }
  function closeLightbox(fromPop) {
    if (!lbOpen) return;
    lbOpen = false; $("lightbox").hidden = true; $("lbImg").removeAttribute("src");
    if (!fromPop && history.state && history.state.lb) history.back();
  }
  // 카카오 지도 팝업 안의 링크도 잡기 위해 캡처 단계에서 처리한다
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a.zoom");
    if (!a) return;
    e.preventDefault(); e.stopPropagation();
    openLightbox(a.href);
  }, true);
  $("lightbox").onclick = () => closeLightbox();
  window.addEventListener("popstate", () => closeLightbox(true));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLightbox(); });

  // 사진은 가이드를 열 때 그린다 (열지 않는 방문자는 사진을 내려받지 않는다)
  $("optLabels").onchange = (e) => {
    showLabels = e.target.checked;
    try { localStorage.setItem("wasp_labels", showLabels ? "1" : "0"); } catch {}
    renderMarkers();
  };
  $("btnInfo").onclick = () => { renderInfo(); openModal("infoWrap"); };
  $("btnSettings").onclick = () => {
    document.querySelector(`input[name="lang"][value="${lang}"]`).checked = true;
    $("optLabels").checked = showLabels;
    openModal("settingsWrap");
  };
  $("btnHelp").onclick = () => openModal("helpWrap");
  $("openHelp").onclick = () => { closeModal("settingsWrap"); openModal("helpWrap"); };
  document.querySelectorAll('input[name="lang"]').forEach((r) => { r.onchange = () => setLang(r.value); });

  function renderHelp() {
    $("helpBody").innerHTML = t("helpDoc").map((s) => `<h4>${esc(s.h)}</h4><ul>${s.p.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`).join("");
  }

  // 말벌 사진: 한국어 위키백과 각 종 문서의 대표 사진(Wikimedia Commons). 작성자·라이선스를 사진 아래에 표시한다.
  // file은 Commons 파일 이름을 URL 인코딩한 것, wiki는 참고한 한국어 위키백과 문서 제목
  const cm = (path, file) => ({
    src: `https://upload.wikimedia.org/wikipedia/commons/thumb/${path}/${file}/500px-${file}`,
    page: `https://commons.wikimedia.org/wiki/File:${file}`,
  });
  const WASP_IMG = {
    mandarinia: { ...cm("8/8d", "20200512-P1100071_Vespa_mandarinia_japonica.jpg"), by: "Yasunori Koide", lic: "CC BY-SA 4.0", wiki: "장수말벌" },
    velutina: { ...cm("c/c8", "Vespa_velutina_nigrithorax_MHNT_dos.jpg"), by: "Didier Descouens", lic: "CC BY-SA 4.0", wiki: "등검은말벌" },
    crabro: { ...cm("f/fd", "Hornet-vespa.jpg"), by: "PiccoloNamek", lic: "CC BY-SA 3.0", wiki: "말벌" },
    simillima: { ...cm("a/ab", "%E3%82%B1%E3%83%96%E3%82%AB%E3%82%B9%E3%82%BA%E3%83%A1%E3%83%90%E3%83%81_%2815357627266%29.jpg"), by: "harum.koh", lic: "CC BY-SA 2.0", wiki: "털보말벌" },
    analis: { ...cm("0/0d", "Plumpy_hornet_on_the_ground_-_1.jpg"), by: "Kyu3", lic: "CC BY-SA 4.0", wiki: "좀말벌" },
    polistes: { ...cm("c/c5", "Wasp_May_2008-11.jpg"), by: "Alvesgaspar", lic: "CC BY-SA 3.0", wiki: "쌍살벌" },
  };

  function renderInfo() {
    const list = (s) => `<${s.ordered ? "ol" : "ul"}>${s.p.map((x) => `<li>${esc(x)}</li>`).join("")}</${s.ordered ? "ol" : "ul"}>`;
    const wasps = () => t("waspList").map((w) => {
      const im = WASP_IMG[w.id];
      return `<div class="wasp"><div class="ph"><img src="${im.src}" alt="${esc(w.name)}" onerror="this.style.visibility='hidden'">
        <small><a href="${im.page}" target="_blank" rel="noopener">${esc(t("photoCredit"))}: ${esc(im.by)} · ${im.lic}</a></small></div>
        <div class="tx"><b>${esc(w.name)}</b> <i>${esc(w.sci)}</i><p>${esc(w.desc)}</p>
        <a class="wiki" href="https://ko.wikipedia.org/wiki/${encodeURIComponent(im.wiki)}" target="_blank" rel="noopener">${esc(t("moreWiki"))} ↗</a></div></div>`;
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
    renderPos(); renderStats(); renderPhotos(); renderChips(); renderHelp(); if (!$("infoWrap").hidden) renderInfo();
    setDay(day, false); renderList(); renderMarkers();
  }

  function setLang(l) {
    lang = l;
    try { localStorage.setItem("wasp_lang", l); } catch {}
    applyLang();
  }

  // 상단 벌 애니메이션: 휴대폰에서는 잠자리채 구간의 오른쪽 끝을 버튼 묶음 바로 앞으로 맞추고,
  // 제목의 벌이 잠자리채 입구 바로 안쪽(44×40 그림의 (25,14))까지 날아가는 애니메이션을 픽셀 값으로 만든다.
  // CSS 키프레임 안의 var()는 브라우저에 따라 처음 값에 고정되므로, 크기가 바뀔 때마다 새로 만든다.
  const top = document.querySelector(".top"), hdrRight = document.querySelector(".hdr-right");
  const titleBee = document.querySelector(".title-bee"), beeScene = document.querySelector(".bee-scene");
  const tb = titleBee.querySelector(".tb"), net = beeScene.querySelector(".net");
  let beeAnim = null;
  const placeBee = () => {
    top.style.setProperty("--bee-right", `${Math.ceil(top.getBoundingClientRect().right - hdrRight.getBoundingClientRect().left) + 2}px`);
    if (!tb.animate || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const b = titleBee.getBoundingClientRect(), s = beeScene.getBoundingClientRect();
    if (!s.width) return;
    const dx = Math.round(s.right - 44 + 25 - (b.left + b.width / 2));
    const dy = Math.round(s.top + s.height / 2 - 20 + 14 - (b.top + b.height / 2));
    const at = (offset, x, y, sc, opacity) => ({ offset, transform: `translate(${x}px,${y}px) scale(${sc})`, opacity, easing: "ease-in-out" });
    if (beeAnim) beeAnim.cancel();
    beeAnim = tb.animate([
      at(0, 0, 0, 1, 1), at(0.08, 0, 0, 1, 1),
      at(0.5, dx - 18, dy, 1, 1), at(0.6, dx, dy, 0.75, 1),
      at(0.66, dx, dy, 0.55, 1), at(0.86, dx, dy, 0.55, 1), at(0.92, dx, dy, 0.55, 0),
      at(0.93, 0, 0, 1, 0), at(1, 0, 0, 1, 1),
    ], { duration: 6000, iterations: Infinity });
    // 잠자리채(CSS 애니메이션)와 같은 박자로 맞춘다
    const netAnim = net.getAnimations ? net.getAnimations()[0] : null;
    if (netAnim && netAnim.currentTime != null) beeAnim.currentTime = netAnim.currentTime;
  };
  if (window.ResizeObserver) { const ro = new ResizeObserver(placeBee); [top, hdrRight, titleBee.parentNode].forEach((el) => ro.observe(el)); }
  addEventListener("resize", placeBee);
  placeBee();

  applyLang();
  refresh();
  loadMap();
})();
