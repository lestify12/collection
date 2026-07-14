/* ============================================================
   Project page — Luxe-style detail: Overview tab + compact
   category tables that drill into the client detail page.
   ============================================================ */
import * as db from "./db.js";
import * as auth from "./auth.js";
import {
  CATS, catByKey, esc, fmtMoney, fmtInt, renderNav, initTheme,
  initSidebar, setModeBadge, observeReveals, toast, visibleProjects,
} from "./ui.js";
import { openRecordForm } from "./record-form.js";
import { importWorkbook } from "./import-xlsx.js";
import { flexiNeedsSetup, planOf, parseYM, MONTHS } from "./plan.js";

const planLabel = (r) => {
  const p = planOf(r);
  if (p.mode === "cash") return "100% Cash";
  return `${p.dpPct}% DP · ${p.dcPct}% DC · ${p.mode === "flexi" ? "Flexi" : "1% Monthly"}`;
};
const startLabel = (r) => { const ym = parseYM(r.installmentStart); return ym ? `${MONTHS[ym.m - 1]} ${ym.y}` : "—"; };

initTheme();
initSidebar();

let ME = null;

/* Tab order for the project page (Overview first, then 24% DP, …) */
const CAT_ORDER = ["dp24", "installment", "legal", "dnc", "cancelled", "others", "available"];
const STAT_ICON = {
  dp24: "ti-cash", installment: "ti-calendar-repeat", legal: "ti-gavel",
  dnc: "ti-phone-off", cancelled: "ti-circle-x", others: "ti-dots-circle-horizontal",
  available: "ti-home-check",
};

const params = new URLSearchParams(location.search);
const projectId = params.get("id");
let project = null;
let allRecords = [];
let activeTab = "overview";
let search = "";

async function main() {
  ME = await auth.requireAuth();
  if (!ME) return;
  auth.renderChrome(ME);

  const { summary, records } = auth.scopeData(await db.loadAll(false, auth.loadScope(ME)), ME);
  setModeBadge(db.LIVE);

  const projects = visibleProjects(summary.projects);
  project = summary.projects.find((p) => p.id === projectId) || projects[0] || summary.projects[0];
  if (!project) { location.replace("index.html"); return; }
  renderNav(projects, project.id);
  allRecords = records;

  // Structural actions (import) — Manager + Team Leader only.
  if (!auth.canViewAll(ME)) {
    document.getElementById("importBtn")?.style.setProperty("display", "none");
  }

  document.title = `${project.name} — Collection Tracker`;
  document.getElementById("bcName").textContent = project.name;
  document.getElementById("projTitle").textContent = project.name;
  // Assigned-to comes from the Team & access assignment (records' assignedTo),
  // not the static workbook handler.
  const usersById = Object.fromEntries(
    (await auth.listUsers().catch(() => [])).map((u) => [u.uid, u.name || u.email]));
  usersById[ME.uid] = ME.name || ME.email;
  const arecs = allRecords.filter((r) => r.projectId === project.id && r.assignedTo);
  const anames = [...new Set(arecs.map((r) => r.assignedToName || usersById[r.assignedTo] || "Assigned"))].sort();
  const assignee = anames.length
    ? (anames.length === 1 ? anames[0]
        : anames.slice(0, -1).join(", ") + " & " + anames[anames.length - 1])
    : null;
  document.getElementById("projSub").innerHTML = assignee
    ? `<i class="ti ti-user-circle"></i> Assigned to <b>${esc(assignee)}</b>`
    : `<i class="ti ti-user-circle"></i> <span style="font-style:italic;color:var(--ink-3)">Not Assigned</span>`;

  setupOnlyMine();
  renderTabs();
  renderTab();

  const importFile = document.getElementById("importFile");
  document.getElementById("importBtn")?.addEventListener("click", () => importFile.click());
  importFile?.addEventListener("change", async (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    try { await importWorkbook(f, project, refresh); }
    catch (err) { console.error(err); toast("Import failed — " + err.message); }
  });
}

/* ---- "Show only my units" switch (officers sharing a project) ---- */
function setupOnlyMine() {
  const actions = document.querySelector(".page-header-actions");
  if (!actions || !iOwnHere()) return;   // only for officers with units here

  showMine = auth.getPref("onlyMine", {})[project.id] === true;

  const wrap = document.createElement("label");
  wrap.className = "only-mine";
  wrap.innerHTML = `<span class="only-mine-txt"><i class="ti ti-user-check"></i> Show only my units</span>
    <span class="switch"><input type="checkbox" id="onlyMineChk" ${showMine ? "checked" : ""}><span class="slider"></span></span>`;
  actions.insertBefore(wrap, actions.firstChild);

  wrap.querySelector("#onlyMineChk").addEventListener("change", async (e) => {
    showMine = e.target.checked;
    const map = { ...(auth.getPref("onlyMine", {}) || {}), [project.id]: showMine };
    try { await auth.setPref("onlyMine", map); }
    catch (err) { console.error("Could not save preference", err); }
    renderTabs();
    renderTab();
  });
}

/* natural sort by unit number: letter prefix, then numeric, then remainder */
function unitKey(u) {
  const m = String(u || "").trim().match(/^([A-Za-z]*)\s*(\d+)?(.*)$/);
  return [(m?.[1] || "").toUpperCase(), m?.[2] ? parseInt(m[2], 10) : -1, m?.[3] || ""];
}
function byUnit(a, b) {
  const ka = unitKey(a.unitNo), kb = unitKey(b.unitNo);
  return ka[0] < kb[0] ? -1 : ka[0] > kb[0] ? 1
    : ka[1] !== kb[1] ? ka[1] - kb[1]
    : ka[2] < kb[2] ? -1 : ka[2] > kb[2] ? 1 : 0;
}

// "Show only my units": when on, the project view (overview + tables + tab
// counts) is filtered to records assigned to the signed-in officer. The
// preference is stored per-project on the user's profile, so it persists
// across refresh and sign-out.
let showMine = false;
const iOwnHere = () => allRecords.some((r) => r.projectId === project.id && r.assignedTo === ME.uid);
const projRecords = () => {
  const recs = allRecords.filter((r) => r.projectId === project.id);
  return showMine ? recs.filter((r) => r.assignedTo === ME.uid) : recs;
};
const catRecords = (cat) => projRecords().filter((r) => r.category === cat).sort(byUnit);
const metrics = () => db.projectMetrics(project, showMine ? projRecords() : allRecords);

/* ------------------------------------------------ tabs */
function renderTabs() {
  const tabs = document.getElementById("tabs");
  const tabHTML = [
    `<button class="tab ${activeTab === "overview" ? "active" : ""}" data-tab="overview">
       <i class="ti ti-layout-dashboard" style="font-size:15px"></i> Overview</button>`,
    ...CAT_ORDER.map((k) => {
      const c = catByKey[k];
      return `<button class="tab ${activeTab === k ? "active" : ""}" data-tab="${k}">
        <span class="swatch" style="background:${c.color}"></span>${esc(c.short)}
        <span class="count">${catRecords(k).length}</span></button>`;
    }),
  ].join("");
  tabs.innerHTML = tabHTML;
  tabs.querySelectorAll(".tab").forEach((b) =>
    b.addEventListener("click", () => { activeTab = b.dataset.tab; search = ""; renderTabs(); renderTab(); }));
}

function renderTab() {
  if (activeTab === "overview") renderOverview();
  else renderCategory(activeTab);
  observeReveals();
}

/* ------------------------------------------------ Overview */
function renderOverview() {
  const m = metrics();
  const body = document.getElementById("tabBody");
  const inst = m.installment || { clients: 0, due: 0 };

  // show full amounts; shrink the font as the figure gets longer so it fits the card
  const CARD_TIERS = [[12, 21], [14, 19], [16, 17.5], [18, 16], [Infinity, 14.5]];
  const fitPx = (s) => (CARD_TIERS.find(([mx]) => s.length <= mx) || CARD_TIERS[CARD_TIERS.length - 1])[1];

  const cards = [
    { label: "Total units", value: fmtInt(m.projectUnits), icon: "ti-building-community", tint: "navy",
      foot: `${fmtInt(m.totalUnits)} with dues · ${fmtInt(m.unsoldUnits)} unsold` },
    { label: "Installment to collect", value: fmtMoney(inst.due, { compact: false }), icon: "ti-calendar-repeat",
      tint: "amber", foot: `${fmtInt(inst.clients)} active installment clients`, money: true },
    { label: "Legal exposure", value: fmtMoney(m.legal?.due || 0, { compact: false }), icon: "ti-gavel", tint: "red",
      foot: `${fmtInt(m.legal?.clients || 0)} legal cases`, money: true },
    { label: "Total outstanding", value: fmtMoney(m.totalDue, { compact: false }), icon: "ti-report-money",
      tint: "green", foot: "across all due categories", money: true },
  ];

  const statCards = cards.map((c, i) => `
    <div class="stat-card reveal" style="--d:${i * 0.05}s">
      <div class="stat-icon ${c.tint}"><i class="ti ${c.icon}"></i></div>
      <div>
        <div class="stat-value"${c.money ? ` style="font-size:${fitPx(c.value)}px"` : ""}>${c.value}</div>
        <div class="stat-label">${c.label}</div>
        <div class="stat-foot">${c.foot}</div>
      </div>
    </div>`).join("");

  const rows = CAT_ORDER.map((k) => {
    const c = catByKey[k];
    const mm = m[k] || { clients: 0, due: 0 };
    const isAvail = k === "available";
    const count = isAvail ? m.unsoldUnits : mm.clients;
    return `
      <tr class="clickable" data-tab="${k}">
        <td><span class="cat-dot" style="background:${c.color}"></span>${esc(c.label)}</td>
        <td class="num">${fmtInt(count)}</td>
        <td class="num">${isAvail ? "—" : fmtMoney(mm.due, { currency: false })}</td>
        <td class="num"><i class="ti ti-chevron-right" style="color:var(--ink-3)"></i></td>
      </tr>`;
  }).join("");

  body.innerHTML = `
    <div class="stat-grid">${statCards}</div>
    <section class="card section reveal">
      <h2>Collection breakdown</h2>
      <div class="card-sub">Units and outstanding dues by category — click a row to open it</div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Category</th><th class="num">Units / clients</th><th class="num">Outstanding</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr>
            <td>Total to collect</td>
            <td class="num">${fmtInt(m.totalUnits)}</td>
            <td class="num strong">${fmtMoney(m.totalDue, { currency: false })}</td><td></td>
          </tr></tfoot>
        </table>
      </div>
    </section>`;

  body.querySelectorAll("tr.clickable").forEach((tr) =>
    tr.addEventListener("click", () => { activeTab = tr.dataset.tab; search = ""; renderTabs(); renderTab(); window.scrollTo({ top: 0, behavior: "smooth" }); }));
}

/* ------------------------------------------------ Category (compact) */
function matches(r, q) {
  if (!q) return true;
  q = q.toLowerCase();
  return ["unitNo", "buyerName", "agent", "remarks", "type", "paymentPlan"]
    .some((k) => String(r[k] || "").toLowerCase().includes(q));
}

function renderCategory(cat) {
  const c = catByKey[cat];
  const all = catRecords(cat);
  const rows = all.filter((r) => matches(r, search));
  const totalDue = rows.reduce((s, r) => s + (Number(r.outstanding) || 0), 0);
  const totalRefl = rows.reduce((s, r) => s + (Number(r.reflected) || 0), 0);
  const isAvail = cat === "available";
  const body = document.getElementById("tabBody");

  // Managers/TL/Admin can always add & export; an officer only on projects
  // assigned to them. Officers viewing someone else's project see neither.
  const canWork = auth.canViewAll(ME)
    || allRecords.some((r) => r.projectId === project.id && r.assignedTo === ME.uid);

  const toolbar = `
    <div class="toolbar">
      <label class="search">
        <i class="ti ti-search" style="font-size:15px;color:var(--ink-3)"></i>
        <input type="search" id="searchInput" placeholder="Search unit, buyer, agent, remarks…" value="${esc(search)}">
      </label>
      <span style="font-size:12.5px;color:var(--ink-3)">
        ${fmtInt(rows.length)} record${rows.length === 1 ? "" : "s"}${isAvail ? "" : ` · ${fmtMoney(totalDue, { compact: true })} outstanding`}
      </span>
      <div style="flex:1"></div>
      ${canWork ? `<button class="btn sm" id="exportBtn" ${rows.length ? "" : "disabled"}><i class="ti ti-download"></i> Export CSV</button>
      <button class="btn primary sm" id="addBtn"><i class="ti ti-plus"></i> Add record</button>` : ""}
    </div>`;

  if (!all.length) {
    body.innerHTML = toolbar + `
      <div class="empty"><div class="e-icon">🗂️</div>
        <div class="e-title">No ${esc(c.label.toLowerCase())} records yet</div>
        <div class="e-sub">Use <b>Add record</b> to start entering client-wise data for ${esc(project.name)}.</div></div>`;
  } else if (isAvail) {
    body.innerHTML = toolbar + `
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Unit</th><th>Type</th><th class="num">Selling price</th><th></th></tr></thead>
        <tbody>${rows.map((r) => `
          <tr class="clickable" data-id="${esc(r.id)}">
            <td><span class="unit-chip">${esc(r.unitNo)}</span></td>
            <td>${esc(r.type)}</td>
            <td class="num">${fmtMoney(r.sellingPrice, { currency: false })}</td>
            <td class="num"><i class="ti ti-chevron-right" style="color:var(--ink-3)"></i></td>
          </tr>`).join("")}</tbody>
      </table></div>`;
  } else {
    body.innerHTML = toolbar + `
      <div class="table-wrap"><table class="data">
        <thead><tr>
          <th>Unit</th><th>Buyer name</th><th>Payment plan</th><th>Installment start</th>
          <th class="num">Reflected</th><th class="num">Outstanding due</th><th></th>
        </tr></thead>
        <tbody>${rows.map((r) => `
          <tr class="clickable" data-id="${esc(r.id)}">
            <td><span class="unit-chip">${esc(r.unitNo)}</span>${flexiNeedsSetup(r) ? ` <i class="ti ti-alert-triangle flexi-flag" title="Flexi plan needs fixing — boxes don't total the DC amount"></i>` : ""}</td>
            <td class="strong">${esc(r.buyerName) || "<span style='color:var(--ink-3)'>—</span>"}</td>
            <td style="white-space:nowrap;color:var(--ink-2);font-size:12.5px">${esc(planLabel(r))}</td>
            <td style="white-space:nowrap;color:${r.installmentStart ? "var(--ink-2)" : "var(--ink-3)"};font-size:12.5px">${esc(startLabel(r))}</td>
            <td class="num money-good">${fmtMoney(r.reflected, { currency: false })}</td>
            <td class="num ${Number(r.outstanding) > 0 ? "money-bad" : ""}">${fmtMoney(r.outstanding, { currency: false })}</td>
            <td class="num"><i class="ti ti-chevron-right" style="color:var(--ink-3)"></i></td>
          </tr>`).join("")}</tbody>
        <tfoot><tr>
          <td>Total</td><td></td><td></td><td></td>
          <td class="num money-good">${fmtMoney(totalRefl, { currency: false })}</td>
          <td class="num strong">${fmtMoney(totalDue, { currency: false })}</td><td></td>
        </tr></tfoot>
      </table></div>`;
  }

  const si = document.getElementById("searchInput");
  si.addEventListener("input", (e) => {
    search = e.target.value; const pos = e.target.selectionStart;
    renderCategory(cat);
    const n = document.getElementById("searchInput"); n.focus(); n.setSelectionRange(pos, pos);
  });
  document.getElementById("addBtn")?.addEventListener("click", () => openAdd(cat));
  document.getElementById("exportBtn")?.addEventListener("click", () => exportCSV(rows, cat));
  body.querySelectorAll("tr.clickable").forEach((tr) =>
    tr.addEventListener("click", () =>
      (location.href = `client.html?project=${encodeURIComponent(project.id)}&id=${encodeURIComponent(tr.dataset.id)}`)));
}

/* ------------------------------------------------ add / export */
function openAdd(cat) {
  openRecordForm({
    category: cat, projectId: project.id, projectName: project.name,
    onSaved: refresh,
  });
}

/* Per-category CSV layout — [header, field] pairs. "_sr" = running number (col A). */
const EXPORT_BASE = [
  ["SR", "_sr"], ["Unit No", "unitNo"], ["Booking Date", "bookingDate"], ["Internal Agent", "agent"],
  ["Unit Type", "type"], ["Buyer Name", "buyerName"], ["Payment Plan", "paymentPlan"],
  ["Selling Price", "sellingPrice"], ["DLD", "dld"], ["Admin Fee", "adminFee"], ["20% DP", "dp20"],
  ["Downpayment + DLD + Admin", "dpTotal"], ["Reflected", "reflected"],
];
const EXPORT = {
  // 24% DP layout (also used by DNC, Cancelled, Available): ends at Outstanding + Remarks
  dp24: [...EXPORT_BASE, ["Outstanding Dues", "outstanding"], ["Remarks", "remarks"]],
  // full layout: adds Monthly Installment + Unsettled Months
  _full: [...EXPORT_BASE,
    ["Monthly Installment (1%)", "monthlyInstallment"], ["Outstanding Dues", "outstanding"],
    ["No. of Unsettled Monthly Installments", "unsettledMonths"], ["Remarks", "remarks"]],
};
EXPORT.dnc = EXPORT.cancelled = EXPORT.available = EXPORT.dp24;
EXPORT.installment = EXPORT.legal = EXPORT.others = EXPORT._full;

function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/* ---- Export ALL categories into one multi-sheet Excel workbook (SpreadsheetML) ---- */
const SHEET_LABEL = { dp24: "24% Due", installment: "Installment", legal: "Legal",
  dnc: "DNC", cancelled: "Cancelled", others: "Others", available: "Available" };
const SHEET_ORDER = ["dp24", "installment", "legal", "dnc", "cancelled", "others", "available"];
const NUMERIC = new Set(["sellingPrice", "dld", "adminFee", "dp20", "dpTotal", "reflected", "monthlyInstallment", "outstanding"]);
const xmlEsc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));

function sheetXML(cat, recs) {
  const spec = EXPORT[cat] || EXPORT._full;
  const head = "<Row>" + spec.map(([h]) => `<Cell><Data ss:Type="String">${xmlEsc(h)}</Data></Cell>`).join("") + "</Row>";
  const body = recs.map((r, i) => "<Row>" + spec.map(([, k]) => {
    const v = k === "_sr" ? i + 1 : r[k];
    if (v === null || v === undefined || v === "") return "<Cell/>";
    if (k === "_sr" || (NUMERIC.has(k) && typeof v === "number" && isFinite(v)))
      return `<Cell><Data ss:Type="Number">${v}</Data></Cell>`;
    return `<Cell><Data ss:Type="String">${xmlEsc(v)}</Data></Cell>`;
  }).join("") + "</Row>").join("");
  return `<Worksheet ss:Name="${xmlEsc(SHEET_LABEL[cat])}"><Table>${head}${body}</Table></Worksheet>`;
}

function exportAllExcel() {
  const sheets = SHEET_ORDER.filter((c) => c !== "others" || catRecords("others").length);
  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">`
    + sheets.map((c) => sheetXML(c, catRecords(c))).join("") + `</Workbook>`;
  const blob = new Blob([xml], { type: "application/vnd.ms-excel" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${project.id}_all_${new Date().toISOString().slice(0, 10)}.xls`;
  a.click(); URL.revokeObjectURL(a.href);
  toast("Exported all categories to Excel");
}
function exportCSV(rows, cat) {
  const spec = EXPORT[cat] || EXPORT._full;
  const table = [spec.map(([h]) => h),
    ...rows.map((r, i) => spec.map(([, k]) => (k === "_sr" ? i + 1 : r[k] ?? "")))];
  const csv = table.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${project.id}_${cat}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
}

async function refresh() {
  const { records } = await db.loadAll(true);
  allRecords = records;
  renderTabs();
  renderTab();
}

main().catch((e) => {
  console.error(e);
  document.getElementById("tabBody").innerHTML =
    `<div class="empty"><div class="e-icon">⚠️</div><div class="e-title">Could not load project</div>
     <div class="e-sub">${esc(e.message)}</div></div>`;
});
