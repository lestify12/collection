/* ============================================================
   Shared UI helpers — theme, nav, formatting, animations.
   ============================================================ */
import * as db from "./db.js";

export const CATS = window.APP_CONFIG.categories;
export const CUR = window.APP_CONFIG.currency;
export const catByKey = Object.fromEntries(CATS.map((c) => [c.key, c]));

/* Scope the app to a subset of projects (config.onlyProjects). Empty → all. */
export function visibleProjects(projects) {
  const only = window.APP_CONFIG.onlyProjects;
  if (!Array.isArray(only) || only.length === 0) return projects;
  // custom (manually-added) projects always show, even if not in the config list
  return projects.filter((p) => p.custom || only.includes(p.id));
}

/* ------------------------------------------------ new project (Manager/admin) */
export function openAddProject() {
  const bd = document.createElement("div");
  bd.className = "modal-backdrop";
  bd.innerHTML = `<div class="modal" style="width:min(440px,100%)">
    <div class="modal-header"><div class="modal-header-left">
      <div class="modal-header-icon"><i class="ti ti-building-plus"></i></div>
      <div style="min-width:0"><div class="modal-header-title">New project</div>
      <div class="modal-header-sub">It appears in the sidebar — then import its Excel</div></div></div>
      <button class="modal-close" data-x aria-label="Close"><i class="ti ti-x"></i></button></div>
    <form><div class="modal-body">
      <label class="fld"><span>Project name</span><input id="npName" placeholder="e.g. Sky Gardens" autocomplete="off"></label>
      <div class="login-error" id="npErr"></div>
    </div>
    <div class="modal-actions"><button type="button" class="btn" data-x>Cancel</button>
      <button type="submit" class="btn primary"><i class="ti ti-check"></i> Create project</button></div></form></div>`;
  document.body.appendChild(bd);
  requestAnimationFrame(() => bd.classList.add("open"));
  const close = () => { bd.classList.remove("open"); setTimeout(() => bd.remove(), 200); };
  bd.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", close));
  bd.addEventListener("click", (e) => { if (e.target === bd) close(); });
  bd.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = bd.querySelector("#npName").value.trim();
    const err = bd.querySelector("#npErr");
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (name.length < 2 || !id) { err.textContent = "Enter a project name (letters or numbers)."; err.classList.add("show"); return; }
    const metrics = {};
    for (const c of CATS) metrics[c.key] = { clients: 0, due: 0 };
    Object.assign(metrics, { totalUnits: 0, totalDue: 0, unsoldUnits: 0, projectUnits: 0 });
    const btn = bd.querySelector("button[type=submit]"); btn.disabled = true;
    try {
      await db.addProject({ id, name, handler: "", note: "", custom: true, metrics });
      toast("Project created");
      location.href = `project.html?id=${encodeURIComponent(id)}`;
    } catch (ex) { err.textContent = ex.message || "Could not create the project."; err.classList.add("show"); btn.disabled = false; }
  });
  setTimeout(() => bd.querySelector("#npName")?.focus(), 200);
}

/* ------------------------------------------------ theme */
const THEME_KEY = "collection_theme";
export function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  setTheme(saved || (prefersDark ? "dark" : "light"), false);
  document.getElementById("themeToggle")?.addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme;
    setTheme(cur === "dark" ? "light" : "dark", true);
  });
}
function setTheme(t, persist) {
  document.documentElement.dataset.theme = t;
  const icon = document.querySelector("#themeToggle i");
  if (icon) icon.className = t === "dark" ? "ti ti-sun" : "ti ti-moon";
  if (persist) localStorage.setItem(THEME_KEY, t);
}

/* ------------------------------------------------ formatting */
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function fmtMoney(n, { compact = false, currency = true } = {}) {
  if (n === null || n === undefined || n === "" || isNaN(n)) return "—";
  n = Number(n);
  let s;
  if (compact) {
    const abs = Math.abs(n);
    if (abs >= 1e6) s = (n / 1e6).toFixed(abs >= 1e7 ? 1 : 2) + "M";
    else if (abs >= 1e3) s = (n / 1e3).toFixed(1) + "K";
    else s = n.toFixed(0);
  } else {
    s = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return currency ? `${CUR} ${s}` : s;
}

export function fmtInt(n) {
  if (n === null || n === undefined || n === "" || isNaN(n)) return "—";
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return esc(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/* ------------------------------------------------ nav */
/** Shorter sidebar label (full name kept as tooltip + for search). */
export function navLabel(name) {
  return String(name)
    .replace(/\s*-\s*Tower\s+([AB])\b/i, " - $1")   // "… - Tower A" → "… - A"
    .replace(/\bHarmony Residences\b/i, "Harmony")
    .replace(/\bResidences\b/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function renderNav(projects, activeId) {
  const nav = document.getElementById("navProjects");
  if (!nav) return;
  const sorted = [...projects].sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true, sensitivity: "base" }));
  nav.innerHTML = sorted.map((p) => `
    <a class="sidebar-item project-item ${p.id === activeId ? "active" : ""}"
       href="project.html?id=${encodeURIComponent(p.id)}"
       title="${esc(p.name)}" data-name="${esc(p.name).toLowerCase()}">
      <span class="sidebar-ico"><i class="ti ti-building-skyscraper"></i></span>
      <span>${esc(navLabel(p.name))}</span>
    </a>`).join("");

  const dash = document.getElementById("navDashboard");
  if (dash && !activeId) dash.classList.add("active");
}

/* Navbar search: shows a dropdown of matching projects, units and buyers you
   can click or arrow/Enter into. The sidebar nav is left untouched. Mobile
   drawer is handled separately by js/mobile-nav.js. */
export function initSidebar() {
  const search = document.getElementById("projSearch");
  if (!search) return;
  const wrap = search.closest(".navbar-search") || search.parentElement;
  wrap.classList.add("has-menu");
  const menu = document.createElement("div");
  menu.className = "nav-search-menu";
  wrap.appendChild(menu);

  const items = () => [...document.querySelectorAll("#navProjects .sidebar-item")];
  const close = () => { menu.classList.remove("open"); menu.innerHTML = ""; };
  // project id → full name (from the sidebar list), for labelling unit results
  const projName = () => Object.fromEntries(items().map((a) => {
    const id = new URLSearchParams(a.getAttribute("href").split("?")[1] || "").get("id");
    return [id, a.getAttribute("title") || a.dataset.name || id];
  }));
  let recsP = null;   // lazy: all records, loaded only when someone searches
  const loadRecs = () => (recsP || (recsP = db.fetchAllRecords().catch(() => [])));

  const draw = (q, projMatches, recMatches, loading) => {
    const names = projName();
    let html = "";
    if (projMatches.length) html += `<div class="nsm-group">Projects</div>` + projMatches.map((a) =>
      `<a class="nsm-item" href="${a.getAttribute("href")}"><i class="ti ti-building"></i>
        <span class="nsm-main">${esc(a.getAttribute("title") || a.dataset.name)}</span></a>`).join("");
    if (recMatches.length) html += `<div class="nsm-group">Units &amp; buyers</div>` + recMatches.map((r) =>
      `<a class="nsm-item" href="client.html?project=${encodeURIComponent(r.projectId)}&id=${encodeURIComponent(r.id)}">
        <i class="ti ti-user"></i><span class="nsm-main"><b>${esc(r.unitNo || "—")}</b> · ${esc(r.buyerName || "—")}</span>
        <span class="nsm-sub">${esc(navLabel(names[r.projectId] || ""))}</span></a>`).join("");
    if (loading) html += `<div class="nsm-empty"><i class="ti ti-loader-2 spin"></i> Searching units &amp; buyers…</div>`;
    else if (!projMatches.length && !recMatches.length) html += `<div class="nsm-empty">No matches for “${esc(q)}”</div>`;
    menu.innerHTML = html;
    menu.querySelector(".nsm-item")?.classList.add("active");
    menu.classList.add("open");
  };

  const run = async () => {
    const q = search.value.trim().toLowerCase();
    // The sidebar is navigation — never hide its projects. Matching projects
    // (and units/buyers) are surfaced in the dropdown below instead.
    if (!q) return close();
    const projMatches = items().filter((a) => (a.dataset.name || "").includes(q)).slice(0, 5);
    if (q.length < 2) return draw(q, projMatches, [], false);   // wait for 2+ chars before unit search
    draw(q, projMatches, [], true);                             // show projects immediately, records loading
    const all = await loadRecs();
    if (search.value.trim().toLowerCase() !== q) return;        // a newer keystroke won
    const recMatches = all.filter((r) =>
      `${r.unitNo || ""} ${r.buyerName || ""}`.toLowerCase().includes(q)).slice(0, 8);
    draw(q, projMatches, recMatches, false);
  };

  search.addEventListener("input", run);
  search.addEventListener("focus", () => { if (search.value.trim()) run(); });
  search.addEventListener("keydown", (e) => {
    const list = [...menu.querySelectorAll(".nsm-item")];
    if (e.key === "Escape") { close(); search.blur(); return; }
    if (!list.length) return;
    let idx = list.findIndex((x) => x.classList.contains("active"));
    if (e.key === "ArrowDown") { e.preventDefault(); idx = Math.min(list.length - 1, idx + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); idx = Math.max(0, idx - 1); }
    else if (e.key === "Enter") { e.preventDefault(); (list[idx] || list[0]).click(); return; }
    else return;
    list.forEach((x, i) => x.classList.toggle("active", i === idx));
  });
  document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) close(); });
}

export function setModeBadge(live) {
  const el = document.getElementById("modeBadge");
  if (!el) return;
  el.classList.toggle("live", live);
  el.querySelector(".mode-text").textContent = live ? "Live · Firebase" : "Local data";
  el.title = live
    ? "Connected to Firebase Firestore"
    : "Firebase is not configured yet — showing bundled Excel data; edits stay in this browser";
}

/* ------------------------------------------------ animations */
export function observeReveals(root = document) {
  const els = root.querySelectorAll(".reveal:not(.in)");
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }
  }, { threshold: 0.08 });
  els.forEach((el) => io.observe(el));
}

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function countUp(el, target, { money = false, compact = true, duration = 1100 } = {}) {
  const format = (v) => (money ? fmtMoney(v, { compact }) : fmtInt(v));
  if (reduceMotion || !Number.isFinite(target)) { el.textContent = format(target); return; }
  const start = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = format(target * eased);
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* ------------------------------------------------ tooltip */
let tipEl = null;
export function attachTips(root = document) {
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.className = "viz-tip";
    document.body.appendChild(tipEl);
  }
  root.querySelectorAll("[data-tip]").forEach((el) => {
    el.addEventListener("mouseenter", () => {
      tipEl.innerHTML = el.dataset.tip;
      tipEl.classList.add("show");
    });
    el.addEventListener("mousemove", (e) => {
      const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
      let x = e.clientX + 14, y = e.clientY + 14;
      if (x + w > innerWidth - 8) x = e.clientX - w - 14;
      if (y + h > innerHeight - 8) y = e.clientY - h - 14;
      tipEl.style.left = x + "px";
      tipEl.style.top = y + "px";
    });
    el.addEventListener("mouseleave", () => tipEl.classList.remove("show"));
  });
}

/* ------------------------------------------------ confirm modal */
/** Styled replacement for window.confirm → resolves true/false. */
export function confirmModal({ title = "Are you sure?", message = "", confirmLabel = "Confirm", danger = false, icon } = {}) {
  return new Promise((resolve) => {
    const bd = document.createElement("div");
    bd.className = "modal-backdrop";
    bd.innerHTML = `<div class="modal" style="width:min(430px,100%)">
      <div class="modal-header"><div class="modal-header-left">
        <div class="modal-header-icon"><i class="ti ${icon || (danger ? "ti-alert-triangle" : "ti-help-circle")}"></i></div>
        <div style="min-width:0"><div class="modal-header-title">${esc(title)}</div></div></div>
        <button class="modal-close" data-x aria-label="Close"><i class="ti ti-x"></i></button></div>
      <div class="modal-body"><p style="margin:0;font-size:14px;line-height:1.55;color:var(--ink-2)">${esc(message)}</p></div>
      <div class="modal-actions"><button class="btn" data-x>Cancel</button>
        <button class="btn ${danger ? "danger-solid" : "primary"}" data-ok>${esc(confirmLabel)}</button></div></div>`;
    document.body.appendChild(bd);
    requestAnimationFrame(() => bd.classList.add("open"));
    const done = (v) => { bd.classList.remove("open"); setTimeout(() => bd.remove(), 200); document.removeEventListener("keydown", onKey); resolve(v); };
    const onKey = (e) => { if (e.key === "Escape") done(false); };
    bd.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", () => done(false)));
    bd.querySelector("[data-ok]").addEventListener("click", () => done(true));
    bd.addEventListener("click", (e) => { if (e.target === bd) done(false); });
    document.addEventListener("keydown", onKey);
    setTimeout(() => bd.querySelector("[data-ok]").focus(), 200);
  });
}

/** A dismiss-only modal for errors / notices (single OK button). */
export function alertModal({ title = "Notice", message = "", okLabel = "OK", icon, danger = false } = {}) {
  return new Promise((resolve) => {
    const bd = document.createElement("div");
    bd.className = "modal-backdrop";
    bd.innerHTML = `<div class="modal" style="width:min(430px,100%)">
      <div class="modal-header"><div class="modal-header-left">
        <div class="modal-header-icon"><i class="ti ${icon || (danger ? "ti-alert-triangle" : "ti-info-circle")}"></i></div>
        <div style="min-width:0"><div class="modal-header-title">${esc(title)}</div></div></div>
        <button class="modal-close" data-x aria-label="Close"><i class="ti ti-x"></i></button></div>
      <div class="modal-body"><p style="margin:0;font-size:14px;line-height:1.55;color:var(--ink-2)">${esc(message)}</p></div>
      <div class="modal-actions"><button class="btn ${danger ? "danger-solid" : "primary"}" data-ok>${esc(okLabel)}</button></div></div>`;
    document.body.appendChild(bd);
    requestAnimationFrame(() => bd.classList.add("open"));
    const done = () => { bd.classList.remove("open"); setTimeout(() => bd.remove(), 200); document.removeEventListener("keydown", onKey); resolve(true); };
    const onKey = (e) => { if (e.key === "Escape" || e.key === "Enter") done(); };
    bd.querySelectorAll("[data-x],[data-ok]").forEach((b) => b.addEventListener("click", done));
    bd.addEventListener("click", (e) => { if (e.target === bd) done(); });
    document.addEventListener("keydown", onKey);
    setTimeout(() => bd.querySelector("[data-ok]").focus(), 200);
  });
}

/* ------------------------------------------------ toast */
let toastTimer = null;
export function toast(msg) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}
