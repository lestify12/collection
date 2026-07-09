/* ============================================================
   Shared UI helpers — theme, nav, formatting, animations.
   ============================================================ */

export const CATS = window.APP_CONFIG.categories;
export const CUR = window.APP_CONFIG.currency;
export const catByKey = Object.fromEntries(CATS.map((c) => [c.key, c]));

/* Scope the app to a subset of projects (config.onlyProjects). Empty → all. */
export function visibleProjects(projects) {
  const only = window.APP_CONFIG.onlyProjects;
  if (!Array.isArray(only) || only.length === 0) return projects;
  return projects.filter((p) => only.includes(p.id));
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
  const btn = document.getElementById("themeToggle");
  if (btn) btn.textContent = t === "dark" ? "☀" : "☾";
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
export function renderNav(projects, activeId) {
  const nav = document.getElementById("navProjects");
  if (!nav) return;
  nav.innerHTML = projects.map((p) => `
    <a href="project.html?id=${encodeURIComponent(p.id)}" class="${p.id === activeId ? "active" : ""}">
      <span class="dot"></span>
      <span>${esc(p.name)}</span>
    </a>`).join("");

  const dash = document.getElementById("navDashboard");
  if (dash && !activeId) dash.classList.add("active");
}

export function initSidebar() {
  const sidebar = document.querySelector(".sidebar");
  const scrim = document.querySelector(".scrim");
  document.getElementById("menuBtn")?.addEventListener("click", () => {
    sidebar.classList.toggle("open");
    scrim?.classList.toggle("show", sidebar.classList.contains("open"));
  });
  scrim?.addEventListener("click", () => {
    sidebar.classList.remove("open");
    scrim.classList.remove("show");
  });
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
