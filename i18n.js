// 한국어 / English 문구. 새 문구는 두 언어에 같은 키로 추가한다. {이름} 자리는 t("키", { 이름: 값 })로 채운다.
window.I18N = {
  ko: {
    title: "말벌 신고", appName: "말벌 위치 신고", visitToday: "오늘 방문 {n}명",
    settings: "설정", help: "사용 설명서", close: "닫기", language: "언어", ok: "확인", cancel: "취소",
    mapLoading: "지도를 불러오는 중…",
    mapNoKey: "config.js 에 카카오 JavaScript 키를 입력하면<br>지도가 표시됩니다.<br>(지도 없이도 '현위치 사용'으로 신고할 수 있어요)",
    mapFail: "지도 SDK를 불러오지 못했습니다. 키와 등록된 도메인을 확인하세요.",

    reportTitle: "신고하기",
    reportHint: "지도를 눌러 위치를 찍거나, 아래 버튼으로 현재 위치를 사용하세요.",
    useLocation: "📍 현위치 사용", posNone: "위치 미선택", posLocating: "위치 확인 중…", posPicked: "선택됨 ({lat}, {lng})",
    kindLegend: "구분", required: "필수", optional: "선택",
    kindSighting: "벌 목격", kindNest: "벌집 위치", kindBoth: "목격+벌집", kindBothHint: "둘 다 해당되면 함께 선택하세요.",
    noteLabel: "위치 설명", noteOpt: "(선택)", notePh: "예) 전신주 12-345, ○○빌딩 뒤편",
    phoneLabel: "신고자 전화번호 뒷자리", phoneHint: "(필수, 숫자 4자리)", phonePh: "예) 1234",
    photoLabel: "사진", photoHint: "(선택, 최대 3장 · 30일 후 자동 삭제)", camera: "📷 촬영", gallery: "🖼 사진첩",
    photoDel: "사진 삭제", photoOrig: "원본 {s}", photoAlt: "신고 사진",
    submit: "신고 접수",

    statAll: "전체 신고", statDone: "처리완료",
    listTitle: "신고 목록", countFmt: "({day} · {n}건)", allRange: "전체 기간", allShort: "전체",
    today: "오늘", prevDay: "어제", nextDay: "내일", pickDate: "날짜 선택",
    weekdays: ["일", "월", "화", "수", "목", "금", "토"],
    emptyDay: "이 날짜에 접수된 신고가 없습니다.", emptyAll: "접수된 신고가 없습니다.",
    listFail: "목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    pagePrev: "이전", pageNext: "다음", pagerLabel: "페이지 이동",
    descNone: "(설명 없음)", statusDone: "처리완료", statusNew: "접수", reportedAt: "{t} 신고",
    handlerLbl: "담당자(기관)", show: "지도 보기", markDone: "처리완료 입력", del: "삭제",

    pinReport: "신고 {t}", pinDone: "완료 {t}", pinPending: "처리 대기", pinPhone: "☎ 신고자 {p}",

    doneTitle: "처리 완료 입력", handlerPh: "예) 수원남부소방서", doneTimeLbl: "처리 시간", doneSubmit: "처리 완료",

    noGeo: "이 기기에서는 위치 기능을 사용할 수 없습니다.",
    geoFail: "현재 위치를 가져오지 못했습니다. 위치 권한을 확인하거나 지도를 눌러 지정하세요.",
    photoMax: "사진은 최대 {n}장까지 등록할 수 있습니다.", photoLoadFail: "사진을 불러오지 못했습니다.",
    needPos: "위치를 지정해 주세요. (지도를 누르거나 '현위치 사용')",
    needKind: "벌 목격, 벌집 위치 중 하나 이상 선택해 주세요.",
    needPhone: "전화번호 뒷자리 4자리를 숫자로 입력해 주세요.",
    submitFail: "신고 접수에 실패했습니다. 네트워크를 확인하고 다시 시도해 주세요.", submitOk: "신고가 접수되었습니다.",
    delConfirm: "이 신고를 삭제할까요? 삭제하면 되돌릴 수 없습니다.", delFail: "삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    doneFail: "처리 완료 저장에 실패했습니다. 이미 처리된 신고일 수 있습니다.",

    helpTitle: "사용 설명서",
    helpDoc: [
      { h: "1. 신고하는 방법", p: [
        "지도를 눌러 위치를 찍거나 ‘현위치 사용’ 버튼을 누릅니다. (휴대폰은 위치 권한을 허용해야 합니다.)",
        "‘벌 목격’, ‘벌집 위치’ 중 해당하는 것을 선택합니다. 둘 다 해당하면 함께 선택할 수 있습니다.",
        "신고자 전화번호 뒷자리 4자리를 입력합니다. (필수)",
        "위치 설명(전신주 번호, 건물명 등)과 사진은 선택입니다. 사진은 촬영하거나 사진첩에서 최대 3장까지 올릴 수 있고, 자동으로 줄여서 올라가며 30일 뒤 자동 삭제됩니다.",
        "‘신고 접수’를 누르면 끝납니다." ] },
      { h: "2. 지도 보기", p: [
        "마커 색: 주황 = 벌 목격, 빨강 = 벌집(또는 목격+벌집), 초록 = 처리완료.",
        "마커 옆 글자는 신고 시각과 전화번호 뒷자리이고, 처리된 신고는 완료 시각도 함께 나옵니다.",
        "마커를 누르면 신고 내용, 처리 정보, 사진을 팝업으로 볼 수 있습니다.",
        "지도 오른쪽 위의 ‘지도 / 스카이뷰’ 버튼으로 일반 지도와 위성 지도를 바꿀 수 있습니다." ] },
      { h: "3. 신고 목록", p: [
        "‘‹ ›’ 버튼으로 하루씩 이동하고, 날짜를 눌러 달력에서 고를 수 있습니다. ‘오늘’은 오늘로, ‘전체’는 모든 날짜를 봅니다.",
        "한 페이지에 10건씩 보이며 아래 번호로 페이지를 넘깁니다.",
        "‘지도 보기’를 누르면 해당 신고 위치로 지도가 이동합니다." ] },
      { h: "4. 처리완료 입력", p: [
        "목록에서 ‘처리완료 입력’을 누르고 담당자(기관) 이름을 입력합니다. 예) 수원남부소방서",
        "처리 시각은 자동으로 기록되며, 한 번 처리한 신고는 다시 바꿀 수 없습니다." ] },
      { h: "5. 알아두세요", p: [
        "테스트 기간에는 목록의 ‘삭제’ 버튼으로 신고를 삭제할 수 있습니다. (추후 비밀번호가 추가될 예정입니다.)",
        "전화번호 뒷자리는 지도 마커에 표시되어 누구나 볼 수 있습니다.",
        "벌집을 직접 건드리지 마세요. 위급한 상황이면 119에 먼저 연락하세요.",
        "화면 오른쪽 위 ⚙ 설정에서 한국어 / English를 바꿀 수 있습니다." ] },
    ],
  },

  en: {
    title: "Wasp Report", appName: "Wasp Location Report", visitToday: "Visitors today {n}",
    settings: "Settings", help: "User guide", close: "Close", language: "Language", ok: "OK", cancel: "Cancel",
    mapLoading: "Loading map…",
    mapNoKey: "Enter your Kakao JavaScript key in config.js<br>to show the map.<br>(You can still report with “Use my location”.)",
    mapFail: "Could not load the map SDK. Check the key and the registered domain.",

    reportTitle: "Report",
    reportHint: "Tap the map to set a location, or use the button below for your current location.",
    useLocation: "📍 Use my location", posNone: "No location selected", posLocating: "Locating…", posPicked: "Selected ({lat}, {lng})",
    kindLegend: "Type", required: "Required", optional: "Optional",
    kindSighting: "Wasp sighting", kindNest: "Nest location", kindBoth: "Sighting + nest", kindBothHint: "Select both if both apply.",
    noteLabel: "Location details", noteOpt: "(optional)", notePh: "e.g. utility pole 12-345, behind ○○ building",
    phoneLabel: "Reporter phone (last 4 digits)", phoneHint: "(required, 4 digits)", phonePh: "e.g. 1234",
    photoLabel: "Photos", photoHint: "(optional, up to 3 · auto-deleted after 30 days)", camera: "📷 Camera", gallery: "🖼 Gallery",
    photoDel: "Remove photo", photoOrig: "Original {s}", photoAlt: "Report photo",
    submit: "Submit report",

    statAll: "Total reports", statDone: "Resolved",
    listTitle: "Reports", countFmt: "({day} · {n})", allRange: "All dates", allShort: "All",
    today: "Today", prevDay: "Previous day", nextDay: "Next day", pickDate: "Pick a date",
    weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    emptyDay: "No reports on this date.", emptyAll: "No reports yet.",
    listFail: "Could not load the list. Please try again shortly.",
    pagePrev: "Previous", pageNext: "Next", pagerLabel: "Pagination",
    descNone: "(no details)", statusDone: "Resolved", statusNew: "Received", reportedAt: "Reported {t}",
    handlerLbl: "Handler (agency)", show: "Show on map", markDone: "Mark resolved", del: "Delete",

    pinReport: "Rpt {t}", pinDone: "Done {t}", pinPending: "Pending", pinPhone: "☎ Reporter {p}",

    doneTitle: "Mark as resolved", handlerPh: "e.g. Suwon South Fire Station", doneTimeLbl: "Time", doneSubmit: "Resolve",

    noGeo: "Location is not available on this device.",
    geoFail: "Could not get your location. Check the permission or tap the map to set it.",
    photoMax: "You can add up to {n} photos.", photoLoadFail: "Could not load the photo.",
    needPos: "Please set a location. (Tap the map or use “Use my location”.)",
    needKind: "Select at least one: wasp sighting or nest location.",
    needPhone: "Enter the last 4 digits of your phone number.",
    submitFail: "Could not submit the report. Check your network and try again.", submitOk: "Your report has been submitted.",
    delConfirm: "Delete this report? This cannot be undone.", delFail: "Could not delete. Please try again shortly.",
    doneFail: "Could not save. This report may already be resolved.",

    helpTitle: "User guide",
    helpDoc: [
      { h: "1. How to report", p: [
        "Tap the map to set a location, or press “Use my location”. (On phones, allow location access.)",
        "Choose “Wasp sighting” and/or “Nest location”. Select both if both apply.",
        "Enter the last 4 digits of your phone number. (Required)",
        "Location details (utility pole number, building name, etc.) and photos are optional. Take or pick up to 3 photos; they are shrunk automatically and deleted after 30 days.",
        "Press “Submit report” to finish." ] },
      { h: "2. Using the map", p: [
        "Marker colors: orange = sighting, red = nest (or sighting + nest), green = resolved.",
        "The text beside a marker shows the report time and the phone last 4 digits; resolved reports also show the resolved time.",
        "Tap a marker to see the report, handling details and photos in a popup.",
        "Use the “Map / Skyview” buttons at the top right of the map to switch to satellite view." ] },
      { h: "3. Report list", p: [
        "Use ‹ › to move one day at a time, or tap the date to pick from a calendar. “Today” jumps to today and “All” shows every date.",
        "Reports are shown 10 per page; use the numbers below to change pages.",
        "“Show on map” moves the map to that report." ] },
      { h: "4. Marking as resolved", p: [
        "Press “Mark resolved” in the list and enter the handler (agency) name, e.g. Suwon South Fire Station.",
        "The time is recorded automatically, and a resolved report cannot be changed again." ] },
      { h: "5. Good to know", p: [
        "During the test period, the “Delete” button removes a report. (A password will be added later.)",
        "The phone last 4 digits are shown on the map markers and can be seen by anyone.",
        "Do not touch a nest yourself. In an emergency, call 119 first.",
        "Switch between 한국어 / English in ⚙ Settings at the top right." ] },
    ],
  },
};
