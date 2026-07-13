/* ============================================================
   Client / buyer detail page — full record breakdown plus a
   1%-installment payment schedule (downpayment-first).
   ============================================================ */
import * as db from "./db.js";
import {
  catByKey, esc, fmtMoney, fmtInt, fmtDate, renderNav, initTheme,
  initSidebar, setModeBadge, observeReveals, toast, visibleProjects,
} from "./ui.js";
import { openRecordForm } from "./record-form.js";

initTheme();
initSidebar();

const params = new URLSearchParams(location.search);
const projectId = params.get("project");
const recordId = params.get("id");
let project = null, record = null;

async function main() {
  const { summary, records } = await db.loadAll();
  setModeBadge(db.LIVE);
  const projects = visibleProjects(summary.projects);
  project = summary.projects.find((p) => p.id === projectId) || null;
  renderNav(projects, project?.id);

  record = records.find((r) => r.id === recordId);
  if (!record) {
    document.getElementById("clientMain").innerHTML =
      `<div class="empty"><div class="e-icon">🔍</div><div class="e-title">Record not found</div>
       <div class="e-sub">It may have been deleted. <a href="${project ? `project.html?id=${encodeURIComponent(project.id)}` : "index.html"}">Go back</a>.</div></div>`;
    return;
  }
  render();
}

/* ------------------------------------------------ payment schedule */
function buildSchedule(r) {
  const S = Number(r.sellingPrice) || 0;
  const R = Number(r.reflected) || 0;
  const D = Number(r.dpTotal) || 0;                 // downpayment + DLD + admin (~24%)
  const dp20 = Number(r.dp20) || (S ? S * 0.2 : 0); // 20% portion of the price
  if (!S) return null;
  const onePct = S * 0.01;
  // 1% monthly installments cover the price balance after the 20% downpayment
  let instCount = Math.round((S - dp20) / onePct);
  instCount = Math.max(0, Math.min(120, instCount));

  const rows = [{ label: "Downpayment + DLD + Admin", amount: D, kind: "dp" }];
  for (let i = 1; i <= instCount; i++) rows.push({ label: `Installment ${i} · 1%`, amount: onePct, kind: "inst" });

  // allocate reflected cumulatively (downpayment must complete first)
  let left = R;
  for (const row of rows) {
    const paid = Math.max(0, Math.min(left, row.amount));
    left -= paid;
    row.paid = paid;
    row.status = paid >= row.amount - 0.01 && row.amount > 0 ? "paid" : paid > 0 ? "partial" : "due";
  }
  const planTotal = rows.reduce((s, x) => s + x.amount, 0);
  const paidTotal = Math.min(R, planTotal);
  return { rows, instCount, onePct, planTotal, paidTotal, dpTarget: D, dpPaid: rows[0].paid, dpDone: rows[0].status === "paid" };
}

/* ------------------------------------------------ render */
const INFO = [
  ["unitNo", "Unit no"], ["bookingDate", "Booking date", "date"], ["agent", "Internal agent"],
  ["type", "Type"], ["buyerName", "Buyer name"], ["paymentPlan", "Payment plan"],
  ["sellingPrice", "Selling price", "money"], ["dld", "DLD (4%)", "money"], ["adminFee", "Admin fee", "money"],
  ["dp20", "20% downpayment", "money"], ["dpTotal", "Downpayment + DLD + admin", "money"],
  ["reflected", "Reflected (paid)", "money"], ["monthlyInstallment", "Monthly installment", "money"],
  ["outstanding", "Outstanding dues", "money"], ["unsettledMonths", "Unsettled months"],
];

function infoVal(r, k, kind) {
  const v = r[k];
  if (v === null || v === undefined || v === "") return `<span class="muted">—</span>`;
  if (kind === "money") return fmtMoney(v);
  if (kind === "date") return fmtDate(v);
  return esc(v);
}

function render() {
  const r = record, c = catByKey[r.category];
  const main = document.getElementById("clientMain");
  const title = r.buyerName || `Unit ${r.unitNo}`;
  document.title = `${title} — ${project?.name || "Client"}`;

  const sched = buildSchedule(r);
  const reflected = Number(r.reflected) || 0;
  const outstanding = Number(r.outstanding) || 0;

  const infoRows = INFO.filter(([k]) => r[k] !== undefined && r[k] !== null && r[k] !== "" || ["sellingPrice", "reflected", "outstanding", "dpTotal"].includes(k))
    .map(([k, label, kind]) => `
      <div class="info-item">
        <div class="info-label">${label}</div>
        <div class="info-value ${k === "reflected" ? "money-good" : k === "outstanding" && outstanding > 0 ? "money-bad" : ""}">${infoVal(r, k, kind)}</div>
      </div>`).join("");

  main.innerHTML = `
    <div class="breadcrumb">
      <a href="index.html">Projects</a><i class="ti ti-chevron-right"></i>
      <a href="project.html?id=${encodeURIComponent(project?.id || "")}">${esc(project?.name || "Project")}</a>
      <i class="ti ti-chevron-right"></i><span>Unit ${esc(r.unitNo)}</span>
    </div>
    <div class="page-header">
      <div>
        <div class="detail-title">
          <span class="page-title">${esc(title)}</span>
          <span class="status-badge" style="--sb:${c.color}">${esc(c.short)}</span>
        </div>
        <div class="page-subtitle"><i class="ti ti-building"></i> Unit ${esc(r.unitNo)}${r.type ? " · " + esc(r.type) : ""} · ${esc(project?.name || "")}</div>
      </div>
      <div class="page-header-actions">
        <button class="btn" id="editBtn"><i class="ti ti-pencil"></i> Edit</button>
        <button class="btn danger" id="deleteBtn"><i class="ti ti-trash"></i> Delete</button>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-card"><div class="stat-icon green"><i class="ti ti-circle-check"></i></div>
        <div><div class="stat-value money-good">${fmtMoney(reflected, { compact: true })}</div>
        <div class="stat-label">Reflected (paid)</div></div></div>
      <div class="stat-card"><div class="stat-icon red"><i class="ti ti-alert-circle"></i></div>
        <div><div class="stat-value ${outstanding > 0 ? "money-bad" : ""}">${fmtMoney(outstanding, { compact: true })}</div>
        <div class="stat-label">Outstanding due</div></div></div>
      <div class="stat-card"><div class="stat-icon navy"><i class="ti ti-tag"></i></div>
        <div><div class="stat-value">${fmtMoney(r.sellingPrice, { compact: true })}</div>
        <div class="stat-label">Selling price</div></div></div>
    </div>

    <div class="detail-grid">
      <section class="card">
        <h2>Client details</h2>
        <div class="card-sub">${esc(c.label)}${r.agent ? " · " + esc(r.agent) : ""}</div>
        <div class="info-grid">${infoRows}</div>
        ${r.remarks ? `<div class="info-remarks"><div class="info-label">Remarks</div><div>${esc(r.remarks)}</div></div>` : ""}
      </section>
      <section class="card">
        <h2>Payment schedule</h2>
        <div class="card-sub">Selling price broken into 1% monthly installments — downpayment (24%) settles first</div>
        ${sched ? scheduleHTML(sched, r) : `<div class="empty" style="padding:26px"><div class="e-icon">🧾</div>
          <div class="e-title">No selling price on record</div>
          <div class="e-sub">Add a selling price to generate the 1% installment breakdown.</div></div>`}
      </section>
    </div>`;

  if (sched) mountScheduleTips();
  document.getElementById("editBtn").addEventListener("click", () =>
    openRecordForm({ category: r.category, record: r, projectId: project.id, projectName: project?.name,
      onSaved: async () => { const { records } = await db.loadAll(true); record = records.find((x) => x.id === recordId) || record; render(); } }));
  document.getElementById("deleteBtn").addEventListener("click", async () => {
    if (!confirm(`Delete record for unit ${r.unitNo}? This cannot be undone.`)) return;
    try { await db.deleteRecord(r.id); toast("Record deleted");
      location.href = `project.html?id=${encodeURIComponent(project.id)}`;
    } catch (e) { toast("Delete failed — " + e.message); }
  });
  observeReveals();
}

function scheduleHTML(s, r) {
  const dpPct = s.planTotal ? Math.round((s.paidTotal / s.planTotal) * 100) : 0;
  const dpBar = s.dpTarget ? Math.min(100, Math.round((s.dpPaid / s.dpTarget) * 100)) : 100;
  const paidCount = s.rows.filter((x) => x.kind === "inst" && x.status === "paid").length;
  const partialCount = s.rows.filter((x) => x.kind === "inst" && x.status === "partial").length;

  const cells = s.rows.filter((x) => x.kind === "inst").map((x, i) => `
    <span class="sched-cell ${x.status}" data-tip="Installment ${i + 1} · ${fmtMoney(x.amount)}<br>${x.status === "paid" ? "Paid" : x.status === "partial" ? "Partly paid " + fmtMoney(x.paid) : "Outstanding"}"></span>`).join("");

  return `
    <div class="sched-summary">
      <div><div class="sched-big">${dpPct}%</div><div class="sched-cap">of plan settled</div></div>
      <div class="sched-meter"><div class="sched-meter-fill" style="width:${dpPct}%"></div></div>
    </div>

    <div class="sched-dp ${s.dpDone ? "done" : ""}">
      <div class="sched-dp-head">
        <span><i class="ti ti-${s.dpDone ? "circle-check" : "clock"}"></i> Downpayment (24%) — ${fmtMoney(s.dpTarget)}</span>
        <span class="${s.dpDone ? "money-good" : "money-bad"}">${s.dpDone ? "Completed" : fmtMoney(s.dpPaid) + " / " + fmtMoney(s.dpTarget)}</span>
      </div>
      <div class="sched-meter"><div class="sched-meter-fill" style="width:${dpBar}%"></div></div>
      ${!s.dpDone ? `<div class="sched-note"><i class="ti ti-info-circle"></i> The 24% downpayment must be completed before the 1% monthly installments begin.</div>` : ""}
    </div>

    <div class="sched-inst-head">
      <span>${s.instCount} monthly installments · ${fmtMoney(s.onePct)} each (1%)</span>
      <span class="sched-legend">
        <span class="sched-cell paid"></span> ${paidCount} paid
        <span class="sched-cell partial"></span> ${partialCount} partial
        <span class="sched-cell due"></span> ${s.instCount - paidCount - partialCount} due
      </span>
    </div>
    <div class="sched-grid">${cells || `<span class="muted">No installments — full payment plan.</span>`}</div>`;
}

let tip = null;
function mountScheduleTips() {
  if (!tip) { tip = document.createElement("div"); tip.className = "viz-tip"; document.body.appendChild(tip); }
  document.querySelectorAll(".sched-cell[data-tip]").forEach((el) => {
    el.addEventListener("mouseenter", () => { tip.innerHTML = el.dataset.tip; tip.classList.add("show"); });
    el.addEventListener("mousemove", (e) => {
      const w = tip.offsetWidth, h = tip.offsetHeight;
      let x = e.clientX + 14, y = e.clientY + 14;
      if (x + w > innerWidth - 8) x = e.clientX - w - 14;
      if (y + h > innerHeight - 8) y = e.clientY - h - 14;
      tip.style.left = x + "px"; tip.style.top = y + "px";
    });
    el.addEventListener("mouseleave", () => tip.classList.remove("show"));
  });
}

main().catch((e) => {
  console.error(e);
  document.getElementById("clientMain").innerHTML =
    `<div class="empty"><div class="e-icon">⚠️</div><div class="e-title">Could not load record</div>
     <div class="e-sub">${esc(e.message)}</div></div>`;
});
