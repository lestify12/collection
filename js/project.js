/* ============================================================
   Project page — category tabs, client-wise tables, data entry.
   ============================================================ */
import * as db from "./db.js";
import {
  CATS, catByKey, esc, fmtMoney, fmtInt, fmtDate, renderNav, initTheme,
  initSidebar, setModeBadge, observeReveals, toast, visibleProjects,
} from "./ui.js";

initTheme();
initSidebar();

/* ------------------------------------------------ field + schema registry */
const FIELDS = {
  unitNo:             { label: "Unit No",                 type: "text", required: true },
  bookingDate:        { label: "Booking date",            type: "date" },
  agent:              { label: "Internal agent",          type: "text" },
  type:               { label: "Unit type",               type: "text", placeholder: "Studio / 1BHK / 2BHK" },
  buyerName:          { label: "Buyer name",              type: "text" },
  paymentPlan:        { label: "Payment plan",            type: "text", placeholder: "e.g. 20% DP • 80% DC (1% Monthly)" },
  sellingPrice:       { label: "Selling price",           type: "number" },
  dld:                { label: "DLD (4%)",                type: "number" },
  adminFee:           { label: "Admin fee",               type: "number" },
  dp20:               { label: "20% downpayment",         type: "number" },
  dpTotal:            { label: "DP + DLD + admin",        type: "number" },
  reflected:          { label: "Reflected (paid)",        type: "number" },
  monthlyInstallment: { label: "Monthly installment",     type: "number" },
  outstanding:        { label: "Outstanding dues",        type: "number" },
  unsettledMonths:    { label: "Unsettled months",        type: "text" },
  remarks:            { label: "Remarks",                 type: "textarea", full: true },
};

const COMMON = ["unitNo", "bookingDate", "agent", "type", "buyerName", "paymentPlan",
                "sellingPrice", "dld", "adminFee", "dp20", "dpTotal", "reflected"];

const SCHEMAS = {
  dp24:        [...COMMON, "outstanding", "remarks"],
  installment: [...COMMON, "monthlyInstallment", "outstanding", "unsettledMonths", "remarks"],
  legal:       [...COMMON, "monthlyInstallment", "outstanding", "unsettledMonths", "remarks"],
  dnc:         [...COMMON, "outstanding", "remarks"],
  cancelled:   [...COMMON, "outstanding", "remarks"],
  others:      [...COMMON, "monthlyInstallment", "outstanding", "unsettledMonths", "remarks"],
  available:   ["unitNo", "type", "sellingPrice", "remarks"],
};

/* table columns per category: [key, header, kind] */
const MONEY = (k, h) => [k, h, "money"];
const TABLE_COLS = {
  dp24: [["unitNo", "Unit"], ["bookingDate", "Booked", "date"], ["type", "Type"], ["buyerName", "Buyer"],
    ["agent", "Agent"], ["paymentPlan", "Plan", "plan"], MONEY("sellingPrice", "Price"), MONEY("dpTotal", "DP+DLD+Adm"),
    MONEY("reflected", "Reflected"), MONEY("outstanding", "Outstanding"), ["remarks", "Remarks", "remarks"]],
  installment: [["unitNo", "Unit"], ["bookingDate", "Booked", "date"], ["type", "Type"], ["buyerName", "Buyer"],
    ["agent", "Agent"], ["paymentPlan", "Plan", "plan"], MONEY("sellingPrice", "Price"), MONEY("reflected", "Reflected"),
    MONEY("monthlyInstallment", "Monthly"), MONEY("outstanding", "Outstanding"), ["unsettledMonths", "Months"],
    ["remarks", "Remarks", "remarks"]],
  dnc: [["unitNo", "Unit"], ["bookingDate", "Booked", "date"], ["type", "Type"], ["buyerName", "Buyer"],
    ["agent", "Agent"], MONEY("dpTotal", "DP+DLD+Adm"), MONEY("reflected", "Reflected"),
    MONEY("outstanding", "Outstanding"), ["remarks", "Remarks", "remarks"]],
  cancelled: [["unitNo", "Unit"], ["bookingDate", "Booked", "date"], ["type", "Type"], ["buyerName", "Buyer"],
    ["agent", "Agent"], ["paymentPlan", "Plan", "plan"], MONEY("sellingPrice", "Price"), MONEY("dpTotal", "DP+DLD+Adm"),
    MONEY("reflected", "Reflected"), MONEY("outstanding", "Outstanding"), ["remarks", "Remarks", "remarks"]],
  available: [["unitNo", "Unit"], ["type", "Type"], MONEY("sellingPrice", "Price"), ["remarks", "Remarks", "remarks"]],
};
TABLE_COLS.legal = TABLE_COLS.installment;
TABLE_COLS.others = TABLE_COLS.installment;

/* ------------------------------------------------ state */
const params = new URLSearchParams(location.search);
const projectId = params.get("id");
let project = null;
let allRecords = [];
let activeCat = "installment";
let search = "";

async function main() {
  const { summary, records } = await db.loadAll();
  setModeBadge(db.LIVE);

  const projects = visibleProjects(summary.projects);
  project = summary.projects.find((p) => p.id === projectId) || projects[0] || summary.projects[0];
  renderNav(projects, project.id);
  allRecords = records;

  document.title = `${project.name} — Collection Tracker`;
  document.getElementById("projTitle").textContent = project.name;
  document.getElementById("projSub").textContent =
    [project.handler && `Handled by ${project.handler}`, project.note].filter(Boolean).join(" · ");

  const recs = myRecords();
  if (!recs.length) activeCat = "installment";
  renderChips();
  renderTabs();
  renderTab();
  observeReveals();

  document.getElementById("sidebarAdd")?.addEventListener("click", () => openModal(null));
}

const myRecords = () => allRecords.filter((r) => r.projectId === project.id);
const catRecords = (cat) => myRecords().filter((r) => r.category === cat);

/* ------------------------------------------------ chips */
function renderChips() {
  const m = db.projectMetrics(project, allRecords);
  const chips = CATS.map((c) => {
    let clients, foot;
    if (c.key === "available") {
      clients = m.unsoldUnits ?? 0;
      foot = "units unsold";
    } else {
      clients = m[c.key]?.clients ?? 0;
      foot = fmtMoney(m[c.key]?.due ?? 0, { compact: true }) + " due";
    }
    return `
      <div class="chip reveal" style="--chip-c:${c.color}">
        <div class="c-label">${esc(c.short)}</div>
        <div class="c-value">${fmtInt(clients)}</div>
        <div class="c-foot">${foot}</div>
      </div>`;
  }).join("");

  document.getElementById("chips").innerHTML = chips + `
    <div class="chip reveal" style="--chip-c:var(--accent)">
      <div class="c-label">Total outstanding</div>
      <div class="c-value">${fmtMoney(m.totalDue, { compact: true })}</div>
      <div class="c-foot">${fmtInt(m.totalUnits)} units with dues · ${fmtInt(m.projectUnits)} total</div>
    </div>`;
  observeReveals();
}

/* ------------------------------------------------ tabs */
function renderTabs() {
  const tabs = document.getElementById("tabs");
  tabs.innerHTML = CATS.map((c) => `
    <button class="tab ${c.key === activeCat ? "active" : ""}" data-cat="${c.key}">
      <span class="swatch" style="background:${c.color}"></span>
      ${esc(c.short)}
      <span class="count">${catRecords(c.key).length}</span>
    </button>`).join("");
  tabs.querySelectorAll(".tab").forEach((b) =>
    b.addEventListener("click", () => { activeCat = b.dataset.cat; search = ""; renderTabs(); renderTab(); }));
}

/* ------------------------------------------------ tab body */
function matches(r, q) {
  if (!q) return true;
  q = q.toLowerCase();
  return ["unitNo", "buyerName", "agent", "remarks", "type", "paymentPlan"]
    .some((k) => String(r[k] || "").toLowerCase().includes(q));
}

function renderTab() {
  const cat = catByKey[activeCat];
  const cols = TABLE_COLS[activeCat];
  const all = catRecords(activeCat);
  const rows = all.filter((r) => matches(r, search));
  const totalDue = rows.reduce((s, r) => s + (Number(r.outstanding) || 0), 0);
  const body = document.getElementById("tabBody");

  const toolbar = `
    <div class="toolbar">
      <label class="search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input type="search" id="searchInput" placeholder="Search unit, buyer, agent, remarks…" value="${esc(search)}">
      </label>
      <span style="font-size:12.5px;color:var(--ink-3)">
        ${fmtInt(rows.length)} record${rows.length === 1 ? "" : "s"}${cat.due ? ` · ${fmtMoney(totalDue, { compact: true })} outstanding` : ""}
      </span>
      <div class="spacer" style="flex:1"></div>
      <button class="btn sm" id="exportBtn" ${rows.length ? "" : "disabled"}>⤓ Export CSV</button>
      <button class="btn primary sm" id="addBtn">＋ Add record</button>
    </div>`;

  if (!all.length) {
    body.innerHTML = toolbar + `
      <div class="empty">
        <div class="e-icon">🗂️</div>
        <div class="e-title">No ${esc(cat.label.toLowerCase())} records yet</div>
        <div class="e-sub">Data for ${esc(project.name)} hasn't been uploaded for this category.
          Use <b>Add record</b> to start entering client-wise data.</div>
      </div>`;
  } else {
    body.innerHTML = toolbar + `
      <div class="table-wrap">
        <table class="data">
          <thead><tr>
            ${cols.map(([, h, kind]) => `<th class="${kind === "money" ? "num" : ""}">${esc(h)}</th>`).join("")}
            <th></th>
          </tr></thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                ${cols.map(([k, , kind]) => cell(r, k, kind)).join("")}
                <td><div class="row-actions">
                  <button title="Edit" data-edit="${esc(r.id)}">✎</button>
                  <button title="Delete" class="del" data-del="${esc(r.id)}">✕</button>
                </div></td>
              </tr>`).join("")}
          </tbody>
          ${cat.due && rows.length ? `
          <tfoot><tr>
            ${cols.map(([k, , kind], i) => {
              if (i === 0) return `<td>Total</td>`;
              if (k === "outstanding") return `<td class="num">${fmtMoney(totalDue, { currency: false })}</td>`;
              return `<td class="${kind === "money" ? "num" : ""}"></td>`;
            }).join("")}
            <td></td>
          </tr></tfoot>` : ""}
        </table>
      </div>`;
  }

  document.getElementById("searchInput").addEventListener("input", (e) => {
    search = e.target.value;
    const pos = e.target.selectionStart;
    renderTab();
    const inp = document.getElementById("searchInput");
    inp.focus(); inp.setSelectionRange(pos, pos);
  });
  document.getElementById("addBtn").addEventListener("click", () => openModal(null));
  document.getElementById("exportBtn")?.addEventListener("click", () => exportCSV(rows, cols, cat));
  body.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => openModal(all.find((r) => r.id === b.dataset.edit))));
  body.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", async () => {
      const rec = all.find((r) => r.id === b.dataset.del);
      if (!confirm(`Delete record for unit ${rec?.unitNo || ""}? This cannot be undone.`)) return;
      try {
        await db.deleteRecord(b.dataset.del);
        await refresh();
        toast(`Record ${rec?.unitNo || ""} deleted`);
      } catch (e) { console.error(e); toast("Delete failed — " + e.message); }
    }));
}

function cell(r, k, kind) {
  const v = r[k];
  if (k === "unitNo") return `<td><span class="unit-chip">${esc(v)}</span></td>`;
  if (kind === "money") return `<td class="num${k === "outstanding" && Number(v) > 0 ? " strong" : ""}">${fmtMoney(v, { currency: false })}</td>`;
  if (kind === "date") return `<td style="white-space:nowrap">${fmtDate(v)}</td>`;
  if (kind === "remarks") return `<td class="cell-remarks">${esc(v)}</td>`;
  if (kind === "plan") return `<td class="cell-plan">${esc(v)}</td>`;
  return `<td>${esc(v)}</td>`;
}

function exportCSV(rows, cols, cat) {
  const head = cols.map(([, h]) => h);
  const lines = [head, ...rows.map((r) => cols.map(([k]) => r[k] ?? ""))]
    .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","));
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${project.id}_${cat.key}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ------------------------------------------------ modal editor */
const backdrop = document.getElementById("modalBackdrop");
let editing = null;

function openModal(rec) {
  editing = rec;
  const cat = catByKey[activeCat];
  document.getElementById("modalTitle").textContent =
    rec ? `Edit ${rec.unitNo} — ${cat.label}` : `Add record — ${cat.label}`;
  document.getElementById("modalSub").textContent =
    `${project.name}${db.LIVE ? "" : " · local mode: saved in this browser only"}`;

  const grid = document.getElementById("formGrid");
  grid.innerHTML = SCHEMAS[activeCat].map((k) => {
    const f = FIELDS[k];
    const val = rec?.[k] ?? "";
    const common = `id="f_${k}" name="${k}" ${f.required ? "required" : ""} placeholder="${esc(f.placeholder || "")}"`;
    let input;
    if (f.type === "textarea") input = `<textarea ${common}>${esc(val)}</textarea>`;
    else if (f.type === "number") input = `<input type="number" step="0.01" inputmode="decimal" ${common} value="${val ?? ""}">`;
    else input = `<input type="${f.type}" ${common} value="${esc(val)}">`;
    return `<div class="field ${f.full ? "full" : ""}"><label for="f_${k}">${esc(f.label)}</label>${input}</div>`;
  }).join("");

  // convenience auto-fill: DLD 4% / DP 20% of price, and their sum — only into empty fields
  const price = document.getElementById("f_sellingPrice");
  price?.addEventListener("change", () => {
    const p = Number(price.value);
    if (!p) return;
    const set = (id, v) => { const el = document.getElementById(id); if (el && el.value === "") el.value = v; };
    set("f_dld", (p * 0.04).toFixed(2));
    set("f_dp20", (p * 0.2).toFixed(2));
    const dld = Number(document.getElementById("f_dld")?.value) || 0;
    const dp = Number(document.getElementById("f_dp20")?.value) || 0;
    const adm = Number(document.getElementById("f_adminFee")?.value) || 0;
    set("f_dpTotal", (dld + dp + adm).toFixed(2));
  });

  backdrop.classList.add("open");
  setTimeout(() => document.getElementById("f_unitNo")?.focus(), 220);
}

function closeModal() { backdrop.classList.remove("open"); editing = null; }
document.getElementById("modalCancel").addEventListener("click", closeModal);
backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

document.getElementById("recordForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("modalSave");
  btn.disabled = true;
  const data = { projectId: project.id, category: activeCat };
  for (const k of SCHEMAS[activeCat]) {
    const el = document.getElementById(`f_${k}`);
    let v = el.value.trim();
    if (FIELDS[k].type === "number") v = v === "" ? null : Number(v);
    data[k] = v;
  }
  try {
    if (editing) { await db.updateRecord(editing.id, data); toast(`Record ${data.unitNo} updated`); }
    else { await db.addRecord(data); toast(`Record ${data.unitNo} added`); }
    closeModal();
    await refresh();
  } catch (err) {
    console.error(err);
    toast("Save failed — " + err.message);
  } finally { btn.disabled = false; }
});

async function refresh() {
  const { records } = await db.loadAll(true);
  allRecords = records;
  renderChips();
  renderTabs();
  renderTab();
}

main().catch((e) => {
  console.error(e);
  document.getElementById("tabBody").innerHTML =
    `<div class="empty"><div class="e-icon">⚠️</div><div class="e-title">Could not load project</div>
     <div class="e-sub">${esc(e.message)}</div></div>`;
});
