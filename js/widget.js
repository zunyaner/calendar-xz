/* 锁屏壁纸预览 — personal, localStorage only for countdown */
(function () {
  "use strict";

  const STORAGE_KEY = "calendar2027.xz.widget.v1";
  const PHOTOS = ["01", "02", "05", "06", "07", "09", "12", "13", "14"];
  const DEFAULT_EVENT = { title: "下一场演唱会", date: "2027-06-20" };

  const $ = (id) => document.getElementById(id);
  let DATA = null;
  let state = loadState();
  let quoteIndex = 0;
  let toolbarOn = true;

  function todayISO() {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  }
  function loadState() {
    const base = { title: DEFAULT_EVENT.title, date: DEFAULT_EVENT.date, photo: 0 };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return base;
      const o = JSON.parse(raw);
      if (o.title) base.title = String(o.title).slice(0, 24);
      if (/^\d{4}-\d{2}-\d{2}$/.test(o.date || "")) base.date = o.date;
      if (Number.isInteger(o.photo)) base.photo = ((o.photo % PHOTOS.length) + PHOTOS.length) % PHOTOS.length;
    } catch (e) {}
    return base;
  }
  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      title: state.title, date: state.date, photo: state.photo
    }));
  }
  function daysUntil(iso) {
    const today = todayISO();
    const a = Date.parse(today + "T00:00:00+08:00");
    const b = Date.parse(iso + "T00:00:00+08:00");
    if (Number.isNaN(a) || Number.isNaN(b)) return null;
    return Math.round((b - a) / 86400000);
  }
  function rec(iso) { return DATA && DATA.days ? DATA.days[iso] : null; }

  function statusText(d) {
    if (!d) return "";
    if (d.holiday) {
      const short = d.holiday.short || d.holiday.name || "";
      const type = d.holiday.type;
      if (type === "班") return short ? "班 · " + short : "调班上班";
      return (type || "休") + (short ? " · " + short : "");
    }
    if (d.kind === "周末") return "周末";
    return "";
  }

  function applyPhoto() {
    const n = PHOTOS[state.photo];
    $("bg").src = "./icons/widget-" + n + ".jpg";
  }
  function applyQuote() {
    const qs = (DATA && DATA.quotes) || [];
    if (!qs.length) { $("lyric").textContent = ""; return; }
    const q = qs[quoteIndex % qs.length];
    $("lyric").innerHTML = escapeHtml(q.text) +
      (q.from ? ` <cite>${escapeHtml(q.from)}</cite>` : "");
  }
  function applyCountdown() {
    $("count-title").textContent = state.title || DEFAULT_EVENT.title;
    const days = daysUntil(state.date);
    const num = $("count-num");
    if (days === null) {
      num.innerHTML = "请设置日期";
      return;
    }
    if (days === 0) {
      num.innerHTML = "<em>今天</em>";
      return;
    }
    if (days > 0) {
      num.innerHTML = "还有 <em>" + days + "</em> 天";
      return;
    }
    num.innerHTML = "已过去 <em>" + Math.abs(days) + "</em> 天";
  }
  function applyToday() {
    const iso = todayISO();
    const [y, m, d] = iso.split("-").map(Number);
    $("date").textContent = m + "月" + d + "日";
    const recd = rec(iso);
    const week = recd && recd.weekdayName ? recd.weekdayName : weekdayName(iso);
    $("week").textContent = week;
    const lunarBits = recd
      ? [recd.lunarText ? "农历" + recd.lunarText : "", recd.solarTerm, recd.traditionalFestival, recd.gregorianFestival].filter(Boolean)
      : [];
    $("lunar").textContent = lunarBits.join(" · ");
    const st = statusText(recd);
    const el = $("status");
    if (st) {
      el.hidden = false;
      el.textContent = st;
      el.classList.toggle("is-off", !(recd && recd.holiday && recd.holiday.type === "班"));
    } else {
      el.hidden = true;
    }
  }
  function weekdayName(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return "星期" + "日一二三四五六"[new Date(y, m - 1, d).getDay()];
  }
  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function nextPhoto() {
    state.photo = (state.photo + 1) % PHOTOS.length;
    quoteIndex = (quoteIndex + 1) % Math.max(1, ((DATA && DATA.quotes) || []).length);
    saveState();
    applyPhoto();
    applyQuote();
  }
  function openEditor() {
    $("edit-title").value = state.title;
    $("edit-date").value = state.date;
    $("editor").hidden = false;
  }
  function closeEditor() { $("editor").hidden = true; }
  function saveEditor() {
    const title = $("edit-title").value.trim().slice(0, 24) || DEFAULT_EVENT.title;
    const date = $("edit-date").value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    state.title = title;
    state.date = date;
    saveState();
    applyCountdown();
    closeEditor();
  }
  function setToolbar(on) {
    toolbarOn = on;
    $("toolbar").classList.toggle("is-off", !on);
    document.querySelector(".content").classList.toggle("with-bar", on);
  }

  function bind() {
    document.getElementById("stage").addEventListener("click", (e) => {
      if (e.target.closest(".toolbar") || e.target.closest(".edit") || e.target.closest(".editor")) return;
      setToolbar(!toolbarOn);
    });
    $("btn-photo").addEventListener("click", (e) => { e.stopPropagation(); nextPhoto(); });
    $("btn-edit").addEventListener("click", (e) => { e.stopPropagation(); openEditor(); });
    $("btn-edit-icon").addEventListener("click", (e) => { e.stopPropagation(); openEditor(); });
    $("btn-cancel").addEventListener("click", closeEditor);
    $("btn-save").addEventListener("click", saveEditor);
    $("editor").addEventListener("click", (e) => {
      if (e.target.id === "editor") closeEditor();
    });
  }

  function applyQuery() {
    const q = new URLSearchParams(location.search);
    const photo = q.get("photo");
    if (photo && PHOTOS.includes(photo)) state.photo = PHOTOS.indexOf(photo);
    if (q.get("ui") === "0" || q.get("chrome") === "0") setToolbar(false);
  }

  async function boot() {
    bind();
    applyQuery();
    applyPhoto();
    applyCountdown();
    try {
      const res = await fetch("./data/calendar-data.json", { cache: "reload" });
      DATA = await res.json();
    } catch (e) {
      DATA = { quotes: [], days: {} };
    }
    const qs = DATA.quotes || [];
    quoteIndex = qs.length ? Math.floor(Math.random() * qs.length) : 0;
    applyToday();
    applyQuote();
  }
  boot();
})();
