/* 2027日历·肖战 — static PWA, localStorage only for personal items */
(function () {
  "use strict";

  const STORAGE_KEY = "calendar2027.xz.items.v1";
  const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
  const IMPORTANCE = ["高", "中", "低"];
  const STATUS = ["未开办", "正常进行", "已完结"];
  const FALLBACK_MIN_YM = "2026-11";
  const FALLBACK_MAX_YM = "2027-12";

  const $app = document.getElementById("app");
  let DATA = null;
  let items = [];
  let quote = null;
  let hero = null;
  let toastTimer = null;

  /* ---------- time & helpers ---------- */
  function todayISO() {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  }
  function rangeYM() {
    const start = (DATA && DATA.meta && DATA.meta.range && DATA.meta.range.start) || (FALLBACK_MIN_YM + "-01");
    const end = (DATA && DATA.meta && DATA.meta.range && DATA.meta.range.end) || (FALLBACK_MAX_YM + "-31");
    return { min: start.slice(0, 7), max: end.slice(0, 7), start: start, end: end };
  }
  function currentMonthYM() {
    return clampYM(todayISO().slice(0, 7));
  }
  function todayInRange() {
    const r = rangeYM();
    const t = todayISO();
    return t >= r.start && t <= r.end;
  }
  function weekdayName(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    const wd = new Date(y, m - 1, d).getDay(); // 0 Sun
    return "日一二三四五六"[wd];
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function ymOf(iso) { return iso.slice(0, 7); }
  function parseYM(ym) {
    const [y, m] = ym.split("-").map(Number);
    return { y, m };
  }
  function addMonth(ym, delta) {
    const { y, m } = parseYM(ym);
    const dt = new Date(y, m - 1 + delta, 1);
    return dt.getFullYear() + "-" + pad(dt.getMonth() + 1);
  }
  function daysInMonth(y, m) {
    return new Date(y, m, 0).getDate();
  }
  function monthCells(y, m) {
    const first = new Date(y, m - 1, 1);
    const padStart = (first.getDay() + 6) % 7; // Monday start
    const count = daysInMonth(y, m);
    const cells = [];
    for (let i = 0; i < padStart; i++) cells.push(null);
    for (let d = 1; d <= count; d++) cells.push(y + "-" + pad(m) + "-" + pad(d));
    while (cells.length % 7) cells.push(null);
    return cells;
  }
  function uid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return "i-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }
  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function rec(iso) { return DATA && DATA.days ? DATA.days[iso] : null; }

  /* ---------- items ---------- */
  function loadItems() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      items = Array.isArray(arr) ? arr : [];
    } catch (e) {
      items = [];
    }
  }
  function saveItems() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }
  function itemsOn(iso) {
    return items
      .filter((it) => it.date === iso)
      .sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99") || a.title.localeCompare(b.title));
  }
  function countsFor(today) {
    const todo = items.filter((it) => it.date === today && it.status !== "已完结").length;
    const due = items.filter((it) => it.date === today && it.status !== "已完结").length;
    const overdue = items.filter((it) => it.date < today && it.status !== "已完结").length;
    return { todo, due, overdue };
  }

  /* ---------- routing ---------- */
  function route() {
    const hash = (location.hash || "#/").replace(/^#/, "");
    const parts = hash.split("/").filter(Boolean);
    const today = todayISO();
    if (parts[0] === "m" && parts[1] && /^\d{4}-\d{2}$/.test(parts[1])) {
      return { view: "month", ym: clampYM(parts[1]), day: parts[2] || null, settings: false, today };
    }
    if (parts[0] === "settings") {
      return { view: "settings", ym: null, day: null, settings: true, today };
    }
    return { view: "year", ym: null, day: parts[0] === "d" ? parts[1] : null, settings: false, today };
  }
  function clampYM(ym) {
    const r = rangeYM();
    if (ym < r.min) return r.min;
    if (ym > r.max) return r.max;
    return ym;
  }
  function go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  /* ---------- captions ---------- */
  function shortLabel(iso, compact) {
    const d = rec(iso);
    if (!d) return "";
    if (d.companyEvents && d.companyEvents.length) {
      const n = d.companyEvents[0].name;
      if (compact) {
        if (n.indexOf("年会") >= 0) return "年会";
        if (n.indexOf("盘点") >= 0) return "盘点";
        if (n.indexOf("优秀") >= 0) return "优秀";
      }
      return n;
    }
    if (d.holiday) {
      if (d.holiday.type === "班") return compact ? "班" : "调班上班";
      if (d.holiday.type === "年休") return compact ? "年休" : "年休";
      const s = d.holiday.short || "";
      return compact ? s.slice(0, 2) : s;
    }
    if (d.solarTerm) return d.solarTerm;
    if (d.traditionalFestival) return compact ? d.traditionalFestival.slice(0, 2) : d.traditionalFestival;
    if (d.gregorianFestival) return compact ? d.gregorianFestival.slice(0, 2) : d.gregorianFestival;
    return compact ? "" : "";
  }
  function monthDayLabel(iso) {
    const d = rec(iso);
    if (!d) return "";
    // Prefer festival / solar term / company event over plain lunar
    if (d.solarTerm) return d.solarTerm;
    if (d.traditionalFestival) return d.traditionalFestival;
    if (d.gregorianFestival) return d.gregorianFestival;
    if (d.companyEvents && d.companyEvents.length) return d.companyEvents[0].name;
    return d.label || d.lunarText || "";
  }
  function badgeText(kind) {
    if (kind === "国定" || kind === "休") return "休";
    if (kind === "年休") return "年";
    if (kind === "班") return "班";
    return "";
  }

  /* ---------- render ---------- */
  function render() {
    if (!DATA) return;
    const r = route();
    if (r.view === "month") renderMonth(r);
    else if (r.view === "settings") renderSettings(r);
    else renderYear(r);
    if (r.day) openDay(r.day, false);
  }

  function topbar(title, leftHtml, rightHtml) {
    return `<header class="topbar">
      <div class="left">${leftHtml || ""}</div>
      <h1>${escapeHtml(title)}</h1>
      <div class="right">${rightHtml || ""}</div>
    </header>`;
  }

  function renderYear(r) {
    const today = r.today;
    const c = countsFor(today);
    const d = rec(today);
    const lunar = d
      ? [d.lunarText, d.solarTerm, d.traditionalFestival, d.gregorianFestival].filter(Boolean).join(" · ")
      : (todayInRange() ? "" : "今天不在日历范围内");
    const statusLine = d && d.holiday
      ? `${d.holiday.type === "班" ? "调班上班" : "休息"} · ${d.holiday.name}`
      : (d && (d.kind === "周末") ? "周末" : "");
    const q = quote || DATA.quotes[0];
    const standalone = window.navigator.standalone === true
      || window.matchMedia("(display-mode: standalone)").matches;
    const icsHttps = new URL("company-2027.ics", location.href).href;
    const webcal = icsHttps.replace(/^https:/, "webcal:").replace(/^http:/, "webcal:");

    let months = "";
    for (let m = 1; m <= 12; m++) {
      months += miniMonth(2027, m, today);
    }

    $app.innerHTML = `<div class="app">
      ${topbar("2027日历·肖战", "", `<button class="btn-text" data-go="#/settings">设置</button>`)}
      <div class="page">
        <section class="today-card">
          ${heroBlock()}
          <div class="body">
            <div class="when">
              <div class="date">${formatLong(today)}</div>
              <div class="week">星期${weekdayName(today)}</div>
              <div class="lunar">${escapeHtml(lunar)}${statusLine ? "<br>" + escapeHtml(statusLine) : ""}</div>
            </div>
            <div class="stats">
              <div class="stat"><b>${c.todo}</b><span>今日待办</span></div>
              <div class="stat due"><b>${c.due}</b><span>今日到期</span></div>
              <div class="stat overdue"><b>${c.overdue}</b><span>逾期</span></div>
            </div>
            <div class="quote">${escapeHtml(q.text)} <em> — ${escapeHtml(q.from)}</em></div>
            <div class="actions">
              <a class="btn-primary" id="btn-subscribe" href="${escapeHtml(webcal)}">订阅到 iPhone 日历</a>
              <a class="btn-ghost" href="${escapeHtml(icsHttps)}" download="company-2027.ics">下载行事历</a>
            </div>
          </div>
        </section>
        ${standalone ? "" : `<p class="hint">用 <strong>Safari</strong> 打开本页，点底部分享按钮，再选「添加到主屏幕」，就可以像 App 一样从桌面打开。</p>`}
        ${thisMonthBlock(today)}
        <div class="sec-title">全年总览</div>
        <div class="legend">
          <span><i style="background:var(--国定)"></i>国定</span>
          <span><i style="background:var(--休)"></i>休</span>
          <span><i style="background:var(--年休)"></i>年休</span>
          <span><i style="background:var(--班)"></i>班</span>
          <span><i style="background:var(--周末)"></i>周末</span>
          <span><i style="background:var(--今天)"></i>今天</span>
        </div>
        <div class="year-grid">${months}</div>
      </div>
    </div>`;
    bindNav();
  }

  function heroBlock() {
    if (!hero) return "";
    const pos = hero.object_pos || "50% 15%";
    return `<div class="hero">
            <img src="./icons/${escapeHtml(hero.out)}" alt="${escapeHtml(hero.title)}" style="object-position:${escapeHtml(pos)}">
            <div class="fade"></div>
          </div>
          <div class="credit-line">${escapeHtml(hero.title)} · ${escapeHtml(hero.author)} · ${escapeHtml(hero.license)}</div>`;
  }

  function thisMonthBlock(today) {
    if (!todayInRange()) return "";
    const ym = currentMonthYM();
    const { y, m } = parseYM(ym);
    const ph = monthPhoto(y, m);
    const credit = ph
      ? `<div class="month-photo-credit">本月背景：${escapeHtml(ph.title)} · ${escapeHtml(ph.author)} · ${escapeHtml(ph.license)}</div>`
      : "";
    return `<div class="sec-title">本月 <button data-go="#/m/${ym}">打开详情</button></div>
        <div class="this-month">${miniMonth(y, m, today, true)}</div>
        ${credit}`;
  }

  function formatLong(iso) {
    const [y, m, d] = iso.split("-");
    return `${Number(y)}年${Number(m)}月${Number(d)}日`;
  }

  function monthPhoto(y, m) {
    const photos = DATA.photos || [];
    if (!photos.length) return null;
    return photos[(y * 12 + m) % photos.length];
  }

  function monthPhotoStyle(y, m) {
    const ph = monthPhoto(y, m);
    if (!ph) return "";
    const src = ph.month_out || ph.out;
    const pos = ph.month_pos || ph.object_pos || "50% 20%";
    // background-image must be inline: url() inside a CSS variable is
    // resolved against css/app.css, not the page, and would 404.
    return ` style="background-image:url('./icons/${escapeHtml(src)}');background-position:${escapeHtml(pos)}"`;
  }

  function miniMonth(y, m, today, featured) {
    const cells = monthCells(y, m);
    const ym = y + "-" + pad(m);
    const title = featured ? (y + "年" + m + "月") : (m + "月");
    const photoCls = (DATA.photos && DATA.photos.length) ? " has-photo" : "";
    const daysHtml = cells.map((iso) => {
      if (!iso) return `<div class="cell is-muted"></div>`;
      const d = rec(iso);
      const kind = d ? d.kind : "";
      const lab = shortLabel(iso, true);
      const cls = [
        "cell",
        kind ? "kind-" + kind : "",
        iso === today ? "is-today" : "",
        itemsOn(iso).length ? "has-item" : ""
      ].filter(Boolean).join(" ");
      return `<div class="${cls}"><span class="n">${Number(iso.slice(-2))}</span>${lab ? `<span class="lab">${escapeHtml(lab)}</span>` : ""}</div>`;
    }).join("");
    return `<button type="button" class="mini${featured ? " featured" : ""}${photoCls}" data-go="#/m/${ym}"${monthPhotoStyle(y, m)}>
      <div class="mtitle">${title}</div>
      <div class="dow">${WEEKDAYS.map((w) => `<span>${w}</span>`).join("")}</div>
      <div class="days">${daysHtml}</div>
    </button>`;
  }

  function renderMonth(r) {
    const { y, m } = parseYM(r.ym);
    const today = r.today;
    const prev = addMonth(r.ym, -1);
    const next = addMonth(r.ym, 1);
    const canPrev = r.ym > rangeYM().min;
    const canNext = r.ym < rangeYM().max;
    const title = `${y}年${m}月`;
    const cells = monthCells(y, m);
    const grid = cells.map((iso) => {
      if (!iso) return `<div class="mcell is-muted"></div>`;
      const d = rec(iso);
      const kind = d ? d.kind : (function () {
        const wd = new Date(iso + "T00:00:00").getDay();
        return (wd === 0 || wd === 6) ? "周末" : "工作";
      })();
      const badge = badgeText(kind);
      const lab = monthDayLabel(iso);
      const labIsLunar = d && lab && lab === d.label && !d.solarTerm && !d.traditionalFestival && !d.gregorianFestival && !(d.companyEvents && d.companyEvents.length);
      const list = itemsOn(iso);
      const show = list.slice(0, 2);
      const more = list.length - show.length;
      const its = show.map((it) => {
        const cls = it.status === "已完结" ? "it done" : "it imp-" + (it.importance || "中");
        return `<div class="${cls}">${escapeHtml(it.title)}</div>`;
      }).join("") + (more > 0 ? `<div class="more">另有 ${more} 项</div>` : "");
      const cls = [
        "mcell",
        kind ? "kind-" + kind : "",
        iso === today ? "is-today" : ""
      ].filter(Boolean).join(" ");
      return `<button type="button" class="${cls}" data-day="${iso}">
        <div class="hd"><span class="n">${Number(iso.slice(-2))}</span>${badge ? `<span class="badge badge-${kind}">${badge}</span>` : ""}</div>
        ${lab ? `<div class="lab${labIsLunar ? " lunar" : ""}">${escapeHtml(lab)}</div>` : ""}
        ${its}
      </button>`;
    }).join("");

    $app.innerHTML = `<div class="app">
      ${topbar(
        title,
        `<button class="btn-text" data-go="#/">全年</button>`,
        `<span>
          <button class="btn-icon" data-go="${canPrev ? "#/m/" + prev : "#/m/" + r.ym}" ${canPrev ? "" : "disabled"} aria-label="上一月">‹</button>
          <button class="btn-icon" data-go="${canNext ? "#/m/" + next : "#/m/" + r.ym}" ${canNext ? "" : "disabled"} aria-label="下一月">›</button>
        </span>`
      )}
      <div class="page">
        <div class="month-wrap has-photo" id="month-wrap"${monthPhotoStyle(y, m)}>
          <div class="month-dow">${WEEKDAYS.map((w) => `<span>${w}</span>`).join("")}</div>
          <div class="month-grid">${grid}</div>
        </div>
        <div class="legend" style="margin-top:12px">
          <span><i style="background:var(--国定)"></i>国定</span>
          <span><i style="background:var(--休)"></i>休</span>
          <span><i style="background:var(--年休)"></i>年休</span>
          <span><i style="background:var(--班)"></i>班</span>
          <span><i style="background:var(--周末)"></i>周末</span>
        </div>
        ${monthPhoto(y, m) ? `<div class="month-photo-credit">${escapeHtml(monthPhoto(y, m).title)} · ${escapeHtml(monthPhoto(y, m).author)} · ${escapeHtml(monthPhoto(y, m).license)}</div>` : ""}
      </div>
    </div>`;
    bindNav();
    $app.querySelectorAll("[data-day]").forEach((el) => {
      el.addEventListener("click", () => openDay(el.getAttribute("data-day"), true));
    });
    bindSwipe(r.ym, canPrev, canNext, prev, next);
  }

  function bindSwipe(ym, canPrev, canNext, prev, next) {
    const wrap = document.getElementById("month-wrap");
    if (!wrap) return;
    let x0 = null, y0 = null, locked = null;
    wrap.addEventListener("touchstart", (e) => {
      const t = e.changedTouches[0];
      x0 = t.clientX; y0 = t.clientY; locked = null;
    }, { passive: true });
    wrap.addEventListener("touchend", (e) => {
      if (x0 == null) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - x0, dy = t.clientY - y0;
      x0 = null;
      if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy)) return;
      if (dx > 0 && canPrev) go("#/m/" + prev);
      if (dx < 0 && canNext) go("#/m/" + next);
    }, { passive: true });
  }

  function renderSettings(r) {
    const icsHttps = new URL("company-2027.ics", location.href).href;
    const webcal = icsHttps.replace(/^https:/, "webcal:").replace(/^http:/, "webcal:");
    const counts = DATA.meta.counts;
    const countLines = Object.keys(counts).map((k) => `<li>${k} ${counts[k]} 天</li>`).join("");
    $app.innerHTML = `<div class="app">
      ${topbar("设置", `<button class="btn-text" data-go="#/">返回</button>`, "")}
      <div class="page settings">
        <div class="block">
          <h3>订阅公司行事历</h3>
          <p>把 2027 年的休息日、调班上班日和公司活动加到 iPhone 自带的「日历」里。系统通知比网页更稳。订阅日历在 iPhone 上<strong>可能不会弹出提醒</strong>，请以日历中的全天事件为准。</p>
          <div class="actions">
            <a class="btn-primary" href="${escapeHtml(webcal)}">订阅到 iPhone 日历</a>
            <a class="btn-ghost" href="${escapeHtml(icsHttps)}" download="company-2027.ics">下载 .ics 文件</a>
          </div>
        </div>
        <div class="block">
          <h3>备份我的事项</h3>
          <p>事项只保存在这台手机的浏览器里，不会上传。换机或清理网站数据前，请先导出备份。</p>
          <div class="actions">
            <button class="btn-primary" type="button" id="btn-export">导出事项</button>
            <button class="btn-ghost" type="button" id="btn-import">导入事项</button>
          </div>
          <input id="import-file" type="file" accept="application/json,.json" hidden>
        </div>
        <div class="block">
          <h3>添加到主屏幕</h3>
          <p>用 Safari 打开本页 → 点底部分享 → 「添加到主屏幕」。安装后可离线查看日历。网页版不能在后台到点推送通知，需要提醒请订阅上方的行事历，或继续用桌面上的「小宇宙提醒」。</p>
        </div>
        <div class="block">
          <h3>关于</h3>
          <p>这是你的个人日历，肖战主题版，不是官方产品，也与艺人及经纪公司无关。休班颜色按公司行事历标注，农历、节气来自公开历法数据。首页歌词为短句摘录，仅供个人欣赏。</p>
          <ul>
            ${countLines}
            <li>与公司公布天数一致</li>
          </ul>
          <p style="margin-top:8px">${DATA.meta.notes.map(escapeHtml).join("<br>")}</p>
        </div>
        <div class="block">
          <h3>现场照片来源</h3>
          <p>维基共享上目前没有可自由使用的肖战个人巡回演唱会现场照。主页大图和每月日历背景使用已标明许可的晚会舞台、颁奖盛典与官方音乐视频剧照，按月轮换。来源见下方各条。</p>
          <ul>${(DATA.photos || []).map((ph) =>
            `<li>${escapeHtml(ph.title)}（${escapeHtml(ph.date)}）<br><a href="${escapeHtml(ph.commons)}" target="_blank" rel="noopener">Wikimedia Commons</a> · <a href="${escapeHtml(ph.license_url)}" target="_blank" rel="noopener">${escapeHtml(ph.license)}</a></li>`
          ).join("")}</ul>
        </div>
      </div>
    </div>`;
    bindNav();
    document.getElementById("btn-export").addEventListener("click", exportItems);
    document.getElementById("btn-import").addEventListener("click", () => document.getElementById("import-file").click());
    document.getElementById("import-file").addEventListener("change", importItems);
  }

  function bindNav() {
    $app.querySelectorAll("[data-go]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        if (el.hasAttribute("disabled")) return;
        go(el.getAttribute("data-go"));
      });
    });
  }

  /* ---------- day sheet ---------- */
  function closeSheet(keepHash) {
    const r = route();
    if (!keepHash) {
      if (r.view === "month") {
        history.replaceState(null, "", "#/m/" + r.ym);
      } else {
        history.replaceState(null, "", "#/");
      }
    }
    const bd = document.querySelector(".backdrop");
    if (bd) bd.remove();
  }

  function openDay(iso, pushHash) {
    const r = route();
    if (pushHash) {
      const base = r.view === "month" ? "#/m/" + r.ym + "/" + iso : "#/m/" + ymOf(iso) + "/" + iso;
      if (location.hash !== base) history.replaceState(null, "", base);
    }
    const existing = document.querySelector(".backdrop");
    if (existing) existing.remove();
    const d = rec(iso);
    const holiday = d && d.holiday;
    const kind = d ? d.kind : "";
    const lunar = d
      ? [d.lunarText, d.solarTerm, d.traditionalFestival, d.gregorianFestival].filter(Boolean).join(" · ")
      : "";
    const evs = (d && d.companyEvents) ? d.companyEvents : [];
    const evLine = evs.map((e) => e.name + (e.note ? "（" + e.note + "）" : "")).join("、");
    let pill = "";
    if (holiday) {
      const label = holiday.type === "班" ? "班 · " + holiday.name : holiday.type + " · " + holiday.name;
      pill = `<span class="pill pill-${holiday.type}">${escapeHtml(label)}</span>`;
    } else if (kind === "周末") {
      pill = `<span class="pill pill-周末">周末</span>`;
    }
    const list = itemsOn(iso);
    const listHtml = list.length
      ? list.map((it) => itemCard(it)).join("")
      : `<div class="empty">这一天还没有事项。</div>`;

    const bd = document.createElement("div");
    bd.className = "backdrop";
    bd.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="day-title">
      <div class="grab"></div>
      <h2 id="day-title">${formatLong(iso)} 星期${weekdayName(iso)}</h2>
      <div class="meta">${escapeHtml(lunar)}${evLine ? "<br>" + escapeHtml(evLine) : ""}</div>
      ${pill}
      <div id="day-items">${listHtml}</div>
      <div class="actions">
        <button class="btn-primary" type="button" id="btn-add">添加事项</button>
        <button class="btn-ghost" type="button" id="btn-close">关闭</button>
      </div>
      <div id="day-form" hidden></div>
    </div>`;
    document.body.appendChild(bd);
    bd.addEventListener("click", (e) => { if (e.target === bd) closeSheet(); });
    bd.querySelector("#btn-close").addEventListener("click", () => closeSheet());
    bd.querySelector("#btn-add").addEventListener("click", () => showForm(iso, null));
    bd.querySelectorAll("[data-edit]").forEach((el) => {
      el.addEventListener("click", () => showForm(iso, el.getAttribute("data-edit")));
    });
    bd.querySelectorAll("[data-del]").forEach((el) => {
      el.addEventListener("click", () => deleteItem(iso, el.getAttribute("data-del")));
    });
  }

  function itemCard(it) {
    const done = it.status === "已完结";
    const sub = [
      it.time || "",
      it.importance ? it.importance + "优先级" : "",
      it.status || "",
      it.location || ""
    ].filter(Boolean).join(" · ");
    return `<div class="item-card">
      <div class="ttl ${done ? "done" : ""}">${escapeHtml(it.title || "未命名")}</div>
      <div class="sub"><span class="tag-${escapeHtml(it.importance || "中")}">${escapeHtml(sub)}</span>${it.note ? "<br>" + escapeHtml(it.note) : ""}</div>
      <div class="row-btns">
        <button type="button" data-edit="${escapeHtml(it.id)}">编辑</button>
        <button type="button" data-del="${escapeHtml(it.id)}">删除</button>
      </div>
    </div>`;
  }

  function showForm(iso, id) {
    const it = id ? items.find((x) => x.id === id) : {
      id: "", date: iso, title: "", time: "", importance: "中", location: "", note: "", status: "未开办"
    };
    const box = document.getElementById("day-form");
    box.hidden = false;
    box.innerHTML = `<div class="form">
      <label>事项名称<input id="f-title" type="text" maxlength="80" value="${escapeHtml(it.title)}" placeholder="例如：做 AC 维保"></label>
      <div class="pair">
        <label>时间（可选）<input id="f-time" type="time" value="${escapeHtml(it.time || "")}"></label>
        <label>重要程度
          <select id="f-imp">${IMPORTANCE.map((v) => `<option ${v === (it.importance || "中") ? "selected" : ""}>${v}</option>`).join("")}</select>
        </label>
      </div>
      <label>地点<input id="f-loc" type="text" maxlength="80" value="${escapeHtml(it.location || "")}" placeholder="可选"></label>
      <label>状态
        <select id="f-status">${STATUS.map((v) => `<option ${v === (it.status || "未开办") ? "selected" : ""}>${v}</option>`).join("")}</select>
      </label>
      <label>备注<textarea id="f-note" maxlength="400" placeholder="可选">${escapeHtml(it.note || "")}</textarea></label>
      <div class="actions">
        <button class="btn-primary" type="button" id="f-save">保存</button>
        <button class="btn-ghost" type="button" id="f-cancel">取消</button>
      </div>
    </div>`;
    document.getElementById("f-cancel").addEventListener("click", () => { box.hidden = true; box.innerHTML = ""; });
    document.getElementById("f-save").addEventListener("click", () => {
      const title = document.getElementById("f-title").value.trim();
      if (!title) { showToast("请填写事项名称"); document.getElementById("f-title").focus(); return; }
      const record = {
        id: it.id || uid(),
        date: iso,
        title,
        time: document.getElementById("f-time").value || "",
        importance: document.getElementById("f-imp").value,
        location: document.getElementById("f-loc").value.trim(),
        note: document.getElementById("f-note").value.trim(),
        status: document.getElementById("f-status").value
      };
      const idx = items.findIndex((x) => x.id === record.id);
      if (idx >= 0) items[idx] = record;
      else items.push(record);
      saveItems();
      showToast("已保存（只存在这台手机上）");
      // re-render month/year under the sheet, then reopen sheet
      const open = iso;
      render();
      openDay(open, false);
    });
    setTimeout(() => document.getElementById("f-title").focus(), 50);
  }

  function deleteItem(iso, id) {
    if (!confirm("删除这条事项？")) return;
    items = items.filter((x) => x.id !== id);
    saveItems();
    showToast("已删除");
    render();
    openDay(iso, false);
  }

  /* ---------- backup ---------- */
  function exportItems() {
    const payload = {
      app: "2027日历·肖战",
      exportedAt: new Date().toISOString(),
      items
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "2027日历-肖战-事项备份.json";
    a.click();
    URL.revokeObjectURL(a.href);
    showToast("已导出 " + items.length + " 条事项");
  }
  function importItems(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const incoming = Array.isArray(data) ? data : (data.items || []);
        if (!Array.isArray(incoming)) throw new Error("格式不对");
        const cleaned = incoming.map((it) => ({
          id: it.id || uid(),
          date: String(it.date || ""),
          title: String(it.title || "").slice(0, 80),
          time: String(it.time || ""),
          importance: IMPORTANCE.indexOf(it.importance) >= 0 ? it.importance : "中",
          location: String(it.location || "").slice(0, 80),
          note: String(it.note || "").slice(0, 400),
          status: STATUS.indexOf(it.status) >= 0 ? it.status : "未开办"
        })).filter((it) => /^\d{4}-\d{2}-\d{2}$/.test(it.date) && it.title);
        if (!cleaned.length) { showToast("文件里没有可用事项"); return; }
        const mode = confirm("确定导入 " + cleaned.length + " 条事项？\n点「确定」合并到现有事项，点「取消」什么也不做。") ;
        if (!mode) return;
        const map = new Map(items.map((it) => [it.id, it]));
        cleaned.forEach((it) => map.set(it.id, it));
        items = Array.from(map.values());
        saveItems();
        showToast("已导入，当前共 " + items.length + " 条");
        render();
      } catch (err) {
        showToast("导入失败，请选择本应用导出的 JSON");
      }
    };
    reader.readAsText(file, "utf-8");
  }

  function showToast(msg) {
    const old = document.querySelector(".toast");
    if (old) old.remove();
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    document.body.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 2200);
  }

  /* ---------- boot ---------- */
  async function boot() {
    try {
      const res = await fetch("./data/calendar-data.json", { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      DATA = await res.json();
      loadItems();
      const qs = DATA.quotes || [];
      quote = qs.length ? qs[Math.floor(Math.random() * qs.length)] : { text: "", from: "" };
      const photos = DATA.photos || [];
      hero = photos.length ? photos[Math.floor(Math.random() * photos.length)] : null;
      render();
      window.addEventListener("hashchange", render);
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("./sw.js").catch(() => {});
      }
    } catch (err) {
      $app.innerHTML = `<div class="err">日历数据加载失败。<br>${escapeHtml(err.message || String(err))}</div>`;
    }
  }

  boot();
})();
