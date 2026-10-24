(() => {
  const CFG = window.WASP_CONFIG;
  const $ = (id) => document.getElementById(id);

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
    // 전화번호(reporter_phone4)는 공개 조회 대상이 아니므로 컬럼을 명시한다
    COLS: "id,kind,lat,lng,note,photo_urls,created_at,done,handler,done_at",
    page(n) {
      return this.req(`/rest/v1/wasp_reports?select=${this.COLS}&order=created_at.desc`, {
        withCount: true, headers: { Range: `${n * PAGE_SIZE}-${n * PAGE_SIZE + PAGE_SIZE - 1}`, Prefer: "count=exact" },
      });
    },
    // 조건에 맞는 신고 건수 (본문 없이 개수만 받는다)
    async count(filter = "") {
      const res = await fetch(`${CFG.SUPABASE_URL}/rest/v1/wasp_reports?select=id${filter}`, { method: "HEAD", headers: this.h({ Prefer: "count=exact" }) });
      if (!res.ok) throw new Error("count");
      return +(res.headers.get("content-range") || "").split("/")[1] || 0;
    },
    markers() { return this.req("/rest/v1/wasp_reports?select=id,kind,lat,lng,note,done&order=created_at.desc&limit=1000"); },
    async uploadPhoto(blob) {
      const name = `${crypto.randomUUID()}.jpg`;
      await this.req(`/storage/v1/object/wasp-photos/${name}`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
      return `${CFG.SUPABASE_URL}/storage/v1/object/public/wasp-photos/${name}`;
    },
    add(r) {
      return this.req("/rest/v1/wasp_reports", { method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(r) });
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
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const KIND = { sighting: "벌 목격", nest: "벌집 위치", both: "목격+벌집" };
  const PAGE_SIZE = 10;

  // ---------- 상태 ----------
  const MAX_PHOTOS = 3;
  let map, pickMarker, picked = null, photos = [], doneTarget = null;
  let rows = [], pins = [], total = 0, pageNo = 0;
  const markers = {};

  // ---------- 상단 현황 (방문 / 신고 / 처리완료) ----------
  const stats = { visit: null, reports: null, done: null };
  function renderStats() {
    const part = (label, v, unit) => (v == null ? "" : `<span>${label} <b>${v}</b>${unit}</span>`);
    $("visit").innerHTML = part("오늘 방문", stats.visit, "명") + part("신고", stats.reports, "건") + part("처리완료", stats.done, "건");
  }
  Store.visit().then((n) => { stats.visit = n; renderStats(); }).catch(() => {});

  // ---------- 지도 ----------
  function loadMap() {
    if (!CFG.KAKAO_JS_KEY || CFG.KAKAO_JS_KEY.startsWith("여기에")) {
      $("mapMsg").innerHTML = "config.js 에 카카오 JavaScript 키를 입력하면<br>지도가 표시됩니다.<br>(지도 없이도 '현위치 사용'으로 신고할 수 있어요)";
      return;
    }
    const s = document.createElement("script");
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${CFG.KAKAO_JS_KEY}&autoload=false`;
    s.onerror = () => { $("mapMsg").textContent = "지도 SDK를 불러오지 못했습니다. 키와 등록된 도메인을 확인하세요."; };
    s.onload = () => kakao.maps.load(initMap);
    document.head.appendChild(s);
  }

  function initMap() {
    $("mapMsg").hidden = true;
    const c = CFG.DEFAULT_CENTER;
    map = new kakao.maps.Map($("map"), { center: new kakao.maps.LatLng(c.lat, c.lng), level: 4 });
    map.addControl(new kakao.maps.MapTypeControl(), kakao.maps.ControlPosition.TOPRIGHT); // 일반지도 / 스카이뷰(위성)
    map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
    kakao.maps.event.addListener(map, "click", (e) => setPick(e.latLng.getLat(), e.latLng.getLng()));
    renderMarkers(); renderList();
  }

  function setPick(lat, lng, pan) {
    picked = { lat, lng };
    $("posText").textContent = `선택됨 (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
    if (!map) return;
    const ll = new kakao.maps.LatLng(lat, lng);
    if (!pickMarker) pickMarker = new kakao.maps.Marker({ position: ll, map, zIndex: 10 });
    else pickMarker.setPosition(ll);
    if (pan) map.panTo(ll);
  }

  function markerImage(color) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="9" fill="${color}" stroke="#fff" stroke-width="3"/></svg>`;
    return new kakao.maps.MarkerImage("data:image/svg+xml," + encodeURIComponent(svg), new kakao.maps.Size(24, 24));
  }

  function renderMarkers() {
    if (!map) return;
    Object.values(markers).forEach((m) => m.setMap(null));
    pins.forEach((r) => {
      const color = r.done ? "#2b8a3e" : r.kind !== "sighting" ? "#d9480f" : "#e67700";
      markers[r.id] = new kakao.maps.Marker({ position: new kakao.maps.LatLng(r.lat, r.lng), map, image: markerImage(color), title: `${KIND[r.kind]} ${r.note || ""}` });
    });
  }

  // n: 이동할 페이지(0부터). 생략하면 현재 페이지를 다시 불러온다.
  async function refresh(n = pageNo) {
    try {
      const [p, m, done] = await Promise.all([Store.page(n), Store.markers(), Store.count("&done=eq.true")]);
      stats.reports = p.total; stats.done = done; renderStats();
      // 마지막 페이지의 항목이 모두 사라진 경우(예: 삭제) 한 페이지 앞으로
      if (!p.data.length && n > 0 && p.total) return refresh(Math.ceil(p.total / PAGE_SIZE) - 1);
      rows = p.data; total = p.total; pins = m; pageNo = n;
    } catch { $("list").innerHTML = '<div class="empty">목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>'; return; }
    renderMarkers(); renderList();
  }

  // ---------- 현위치 ----------
  $("btnLocate").onclick = () => {
    if (!navigator.geolocation) return alert("이 기기에서는 위치 기능을 사용할 수 없습니다.");
    $("posText").textContent = "위치 확인 중…";
    navigator.geolocation.getCurrentPosition(
      (p) => setPick(p.coords.latitude, p.coords.longitude, true),
      () => { $("posText").textContent = "위치 미선택"; alert("현재 위치를 가져오지 못했습니다. 위치 권한을 확인하거나 지도를 눌러 지정하세요."); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // ---------- 사진 (축소 후 업로드) ----------
  function shrink(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const max = 1280, k = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(img.src);
        cv.toBlob((b) => (b ? resolve(b) : reject()), "image/jpeg", 0.8);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  async function addPhotos(files) {
    const room = MAX_PHOTOS - photos.length;
    if (files.length > room) alert(`사진은 최대 ${MAX_PHOTOS}장까지 등록할 수 있습니다.`);
    for (const f of files.slice(0, Math.max(room, 0))) {
      try { const blob = await shrink(f); photos.push({ blob, url: URL.createObjectURL(blob) }); }
      catch { alert("사진을 불러오지 못했습니다."); }
    }
    renderPhotos();
  }

  function renderPhotos() {
    $("previews").innerHTML = photos.map((p, i) =>
      `<div class="thumb"><img src="${p.url}" alt="사진 ${i + 1}"><button type="button" data-i="${i}" aria-label="사진 삭제">×</button></div>`).join("");
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
  $("form").onsubmit = async (e) => {
    e.preventDefault();
    const checked = [...document.querySelectorAll('input[name="kind"]:checked')].map((c) => c.value);
    const kind = checked.length === 2 ? "both" : checked[0];
    if (!picked) return alert("위치를 지정해 주세요. (지도를 누르거나 '현위치 사용')");
    if (!kind) return alert("벌 목격, 벌집 위치 중 하나 이상 선택해 주세요.");
    const phone4 = $("phone4").value.trim();
    if (phone4 && !/^\d{4}$/.test(phone4)) return alert("전화번호 뒷자리는 숫자 4자리로 입력해 주세요.");
    const btn = e.submitter; btn.disabled = true;
    try {
      const photo_urls = await Promise.all(photos.map((p) => Store.uploadPhoto(p.blob)));
      await Store.add({ kind, lat: picked.lat, lng: picked.lng, note: $("note").value.trim() || null, photo_urls, reporter_phone4: phone4 || null });
    } catch { btn.disabled = false; return alert("신고 접수에 실패했습니다. 네트워크를 확인하고 다시 시도해 주세요."); }
    btn.disabled = false;
    $("form").reset(); clearPhotos();
    picked = null; $("posText").textContent = "위치 미선택";
    if (pickMarker) { pickMarker.setMap(null); pickMarker = null; }
    await refresh(0); // 새 신고는 첫 페이지 맨 위에 나온다
    alert("신고가 접수되었습니다.");
  };

  // ---------- 목록 (날짜별) ----------
  function renderList() {
    $("count").textContent = `(총 ${total}건)`;
    renderPager();
    if (!rows.length) { $("list").innerHTML = '<div class="empty">접수된 신고가 없습니다.</div>'; return; }
    let html = "", cur = "";
    for (const r of rows) {
      const d = ymd(new Date(r.created_at));
      if (d !== cur) { cur = d; html += `<div class="date">${d}</div>`; }
      html += `<div class="item" data-id="${r.id}">
        <div class="head">
          <span><span class="tag ${r.kind}">${KIND[r.kind]}</span> ${esc(r.note || "(설명 없음)")}</span>
          <span class="tag ${r.done ? "done" : ""}" style="${r.done ? "" : "background:#868e96"}">${r.done ? "처리완료" : "접수"}</span>
        </div>
        <div class="meta">${hm(new Date(r.created_at))} 신고</div>
        ${r.photo_urls?.length ? `<div class="thumbs">${r.photo_urls.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="신고 사진" loading="lazy"></a>`).join("")}</div>` : ""}
        ${r.done ? `<div class="result">✔ ${esc(r.handler)} · ${full(r.done_at)}</div>` : ""}
        <div class="acts">
          ${map ? '<button class="btn sub" data-act="show">지도 보기</button>' : ""}
          ${r.done ? "" : '<button class="btn sub" data-act="done">처리완료 입력</button>'}
        </div></div>`;
    }
    $("list").innerHTML = html;
  }

  function renderPager() {
    const pages = Math.ceil(total / PAGE_SIZE);
    if (pages <= 1) { $("pager").innerHTML = ""; return; }
    const from = Math.max(0, Math.min(pageNo - 2, pages - 5)), to = Math.min(pages, from + 5);
    let html = `<button data-p="${pageNo - 1}" ${pageNo === 0 ? "disabled" : ""} aria-label="이전">‹</button>`;
    for (let i = from; i < to; i++) html += `<button data-p="${i}" class="${i === pageNo ? "on" : ""}">${i + 1}</button>`;
    html += `<button data-p="${pageNo + 1}" ${pageNo >= pages - 1 ? "disabled" : ""} aria-label="다음">›</button>`;
    $("pager").innerHTML = html;
  }

  $("pager").onclick = async (e) => {
    const b = e.target.closest("button[data-p]"); if (!b || b.disabled) return;
    await refresh(+b.dataset.p);
    $("list").scrollIntoView({ behavior: "smooth", block: "start" });
  };

  $("list").onclick = (e) => {
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const id = b.closest(".item").dataset.id;
    const r = rows.find((x) => x.id === id);
    if (b.dataset.act === "show" && map) {
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
    catch { alert("처리 완료 저장에 실패했습니다. 이미 처리된 신고일 수 있습니다."); }
    $("doneDialogWrap").hidden = true;
    await refresh();
  };

  refresh();
  loadMap();
})();
