/* ============================================================
   Client / buyer detail page — full record breakdown plus a
   1%-installment payment schedule (downpayment-first).
   ============================================================ */
import * as db from "./db.js";
import * as auth from "./auth.js";
import {
  CATS, catByKey, esc, fmtMoney, fmtInt, fmtDate, renderNav, initTheme,
  initSidebar, setModeBadge, observeReveals, toast, visibleProjects, confirmModal, alertModal,
} from "./ui.js";
import { openRecordForm } from "./record-form.js";
import { parseSOA } from "./soa.js";
import { r2, planOf, flexiNeedsSetup, flowMonths, parseYM, addMonths, ymKey, fmtYM, MONTHS } from "./plan.js";

initTheme();
initSidebar();

let ME = null;
const params = new URLSearchParams(location.search);
const projectId = params.get("project");
const recordId = params.get("id");
let project = null, record = null;
let activeClientTab = "overview";
const txns = (r) => (Array.isArray(r.transactions) ? r.transactions : []);

async function main() {
  ME = await auth.requireAuth();
  if (!ME) return;
  auth.renderChrome(ME);

  const { summary, records } = auth.scopeData(await db.loadAll(false, auth.loadScope(ME)), ME);
  setModeBadge(db.LIVE);
  const projects = visibleProjects(summary.projects);
  project = summary.projects.find((p) => p.id === projectId) || null;
  renderNav(projects, project?.id);

  record = records.find((r) => r.id === recordId);
  if (!record) {
    document.getElementById("clientMain").innerHTML =
      `<div class="empty"><div class="e-icon">🔒</div><div class="e-title">Not available</div>
       <div class="e-sub">This unit doesn't exist or isn't assigned to you. <a href="index.html">Go back</a>.</div></div>`;
    return;
  }
  render();
}

/* Shrink the stat-card value font as the amount gets longer so full,
   non-shortened figures always fit inside the card. */
const STAT_TIERS = [[12, 21], [14, 19], [16, 17.5], [18, 16], [Infinity, 14.5]];
const fitStat = (s) => (STAT_TIERS.find(([m]) => s.length <= m) || STAT_TIERS[STAT_TIERS.length - 1])[1];

/* ------------------------------------------------ payment schedule */

/** Keep existing (possibly custom) boxes, then trim/extend with 1% boxes so
    the plan totals the new DC amount — preserves the officer's edits. */
function rebalanceBoxes(boxes, dcAmount, onePct) {
  const kept = []; let sum = 0;
  for (const bx of boxes.map(Number)) {
    if (!(bx > 0)) continue;
    if (sum + bx <= dcAmount + 0.01) { kept.push(r2(bx)); sum = r2(sum + bx); }
    else { const rem = r2(dcAmount - sum); if (rem > 0.01) { kept.push(rem); sum = dcAmount; } break; }
  }
  const rem = r2(dcAmount - sum);
  if (rem > 0.01) kept.push(...genBoxes(rem, onePct));
  return kept;
}

/** Fill `balance` with `onePct` boxes; last box is the remainder. */
function genBoxes(balance, onePct) {
  const boxes = [];
  let acc = 0;
  while (acc < balance - 0.01 && boxes.length < 400) {
    const amt = Math.min(onePct, balance - acc);
    boxes.push(r2(amt)); acc += amt;
  }
  return boxes;
}

/** Installment box amounts. A stored custom plan (Flexi) wins; otherwise
    the DC% drives the count — one 1%-of-selling-price box per DC point. */
export function scheduleBoxes(r) {
  const p = planOf(r);
  const onePct = p.onePct;
  const balance = p.dcAmount;
  if (p.mode === "cash") return { boxes: [], onePct, balance: 0 };
  if (Array.isArray(r.installmentPlan) && r.installmentPlan.length)
    return { boxes: r.installmentPlan.map(Number), onePct, balance };
  const n = Math.max(0, Math.round(p.dcPct));
  return { boxes: Array(n).fill(r2(onePct)), onePct, balance };
}

/** The 24% downpayment target = DP + DLD + Admin (falls back to a 24% estimate). */
export function downpaymentTarget(r) {
  const S = Number(r.sellingPrice) || 0;
  const explicit = Number(r.dpTotal) || 0;
  const parts = (Number(r.dp20) || 0) + (Number(r.dld) || 0) + (Number(r.adminFee) || 0);
  return explicit || parts || r2(0.24 * S);
}

function buildSchedule(r) {
  const S = Number(r.sellingPrice) || 0;
  const R = Number(r.reflected) || 0;
  if (!S) return null;
  const { boxes, onePct, balance } = scheduleBoxes(r);
  const D = downpaymentTarget(r);
  const isDp = r.category === "dp24";
  const custom = Array.isArray(r.installmentPlan) && r.installmentPlan.length > 0;
  const plan = planOf(r);
  const months = flowMonths(r, boxes.length);
  const needsFlexi = flexiNeedsSetup(r);

  if (plan.mode === "cash") {
    // Paid in full — no installment schedule; track against the selling price.
    const paidTotal = Math.min(R, S);
    return { isCash: true, boxes: [], instRows: [], instCount: 0, onePct, balance: 0, custom: false,
      plan, needsFlexi: false, dpTarget: 0, dpPaid: 0, dpDone: true, planTotal: S, paidTotal,
      pct: S ? Math.round((paidTotal / S) * 100) : 0, transferReady: false };
  }

  if (isDp) {
    // Still paying the 24% downpayment — reflected all goes to it; installments haven't started.
    const dpPaid = Math.min(R, D);
    const dpDone = D > 0 && dpPaid >= D - 0.01;
    const instRows = boxes.map((amt, i) => ({ label: `Installment ${i + 1}`, amount: amt, kind: "inst", idx: i, paid: 0,
      status: months[i]?.skip ? "skip" : "due", month: months[i]?.label, skip: !!months[i]?.skip }));
    return { isDp: true, boxes, instRows, instCount: boxes.length, onePct, balance, custom, plan, needsFlexi,
      dpTarget: D, dpPaid, dpDone, planTotal: D, paidTotal: dpPaid,
      pct: D ? Math.round((dpPaid / D) * 100) : 0, transferReady: dpDone };
  }

  // Installment phase — downpayment already settled; reflected fills the boxes.
  // "No collection" boxes are skipped by the fill (nothing is expected there).
  let left = R;
  const instRows = boxes.map((amt, i) => {
    const skip = !!months[i]?.skip;
    const paid = skip ? 0 : Math.max(0, Math.min(left, amt));
    if (!skip) left -= paid;
    return { label: `Installment ${i + 1}`, amount: amt, kind: "inst", idx: i, paid, month: months[i]?.label, skip,
      status: skip ? "skip" : paid >= amt - 0.01 && amt > 0 ? "paid" : paid > 0 ? "partial" : "due" };
  });
  const planTotal = boxes.reduce((a, b, i) => a + (months[i]?.skip ? 0 : b), 0);
  const paidTotal = Math.min(R, planTotal);
  return { isDp: false, boxes, instRows, instCount: boxes.length, onePct, balance, custom, plan, needsFlexi,
    dpTarget: D, dpPaid: D, dpDone: true, planTotal, paidTotal,
    pct: planTotal ? Math.round((paidTotal / planTotal) * 100) : 0, transferReady: false };
}

/* ------------------------------------------------ render */
const INFO = [
  ["unitNo", "Unit no"], ["bookingDate", "Booking date", "date"], ["agent", "Internal agent"],
  ["type", "Type"], ["buyerName", "Buyer name"], ["planType", "Plan type"], ["installmentStart", "Installment start"],
  ["sellingPrice", "Selling price", "money"], ["dld", "DLD (4%)", "money"], ["adminFee", "Admin fee", "money"],
  ["dp20", "20% downpayment", "money"], ["dpAmountCalc", "DP total (DP + DLD + admin)", "money"],
  ["dcAmountCalc", "DC amount", "money"], ["monthlyInstallment", "Monthly installment", "money"],
  ["reflected", "Reflected (paid)", "money"], ["outstanding", "Outstanding dues", "money"],
];

function infoVal(r, k, kind) {
  // computed plan fields
  if (k === "planType") { const p = planOf(r); return p.mode === "cash" ? "100% Cash" : `${p.dpPct}% DP · ${p.dcPct}% DC · ${p.mode === "flexi" ? "Flexi" : "1% Monthly"}`; }
  if (k === "installmentStart") { const ym = parseYM(r.installmentStart); return ym ? `${MONTHS[ym.m - 1]} ${ym.y}` : `<span class="muted">—</span>`; }
  if (k === "dpAmountCalc") return fmtMoney(planOf(r).dpAmount);
  if (k === "dcAmountCalc") return fmtMoney(planOf(r).dcAmount);
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
        ${auth.canEdit(r, ME) ? `<button class="btn" id="soaBtn"><i class="ti ti-file-upload"></i> Upload SOA</button>
        <input type="file" id="soaFile" accept="application/pdf,.pdf" hidden>
        <button class="btn" id="moveBtn"><i class="ti ti-arrows-exchange"></i> Move</button>` : ""}
        ${auth.canViewAll(ME) ? `<button class="btn" id="assignBtn"><i class="ti ti-user-cog"></i> Assign</button>
        <button class="btn" id="editBtn"><i class="ti ti-pencil"></i> Edit</button>
        <button class="btn danger" id="deleteBtn"><i class="ti ti-trash"></i> Delete</button>` : ""}
      </div>
    </div>

    <div class="tabs" id="clientTabs">
      <button class="tab ${activeClientTab === "overview" ? "active" : ""}" data-ctab="overview"><i class="ti ti-layout-dashboard" style="font-size:15px"></i> Overview</button>
      <button class="tab ${activeClientTab === "history" ? "active" : ""}" data-ctab="history"><i class="ti ti-history" style="font-size:15px"></i> Transaction history <span class="count">${txns(r).length}</span></button>
    </div>
    <div id="clientBody"></div>`;

  if (auth.canEdit(r, ME)) {
    document.getElementById("moveBtn").addEventListener("click", () => openMoveCategory(r));
    const soaFile = document.getElementById("soaFile");
    document.getElementById("soaBtn").addEventListener("click", () => soaFile.click());
    soaFile.addEventListener("change", handleSOAUpload);
  }
  if (auth.canViewAll(ME)) {
    document.getElementById("assignBtn").addEventListener("click", () => openAssign(r));
    document.getElementById("editBtn").addEventListener("click", () =>
      openRecordForm({ category: r.category, record: r, projectId: project.id, projectName: project?.name,
        onSaved: reloadAndRender }));
    document.getElementById("deleteBtn").addEventListener("click", async () => {
      if (!(await confirmModal({ title: `Delete unit ${r.unitNo}?`, message: "This permanently deletes the record. This cannot be undone.", confirmLabel: "Delete", danger: true }))) return;
      try { await db.deleteRecord(r.id); toast("Record deleted");
        location.href = `project.html?id=${encodeURIComponent(project.id)}`;
      } catch (e) { toast("Delete failed — " + e.message); }
    });
  }
  main.querySelectorAll("#clientTabs .tab").forEach((b) =>
    b.addEventListener("click", () => { activeClientTab = b.dataset.ctab; render(); }));

  renderClientTab();
  observeReveals();
}

function renderClientTab() {
  const r = record;
  const canEdit = auth.canEdit(r, ME);
  const body = document.getElementById("clientBody");
  if (activeClientTab === "history") {
    body.innerHTML = historyHTML(r, canEdit);
    document.getElementById("recordPayBtn2")?.addEventListener("click", recordPayment);
    body.querySelectorAll("[data-deltxn]").forEach((b) =>
      b.addEventListener("click", () => deleteTxn(b.dataset.deltxn)));
    return;
  }

  const c = catByKey[r.category];
  const sched = buildSchedule(r);
  const reflected = Number(r.reflected) || 0;
  const outstanding = Number(r.outstanding) || 0;
  const alwaysShow = ["sellingPrice", "reflected", "outstanding", "planType", "dpAmountCalc", "dcAmountCalc"];
  const infoRows = INFO.filter(([k]) => (r[k] !== undefined && r[k] !== null && r[k] !== "") || alwaysShow.includes(k))
    .map(([k, label, kind]) => `
      <div class="info-item">
        <div class="info-label">${label}</div>
        <div class="info-value ${k === "reflected" ? "money-good" : k === "outstanding" && outstanding > 0 ? "money-bad" : ""}">${infoVal(r, k, kind)}</div>
      </div>`).join("");

  const refS = fmtMoney(reflected), outS = fmtMoney(outstanding), spS = fmtMoney(r.sellingPrice);
  body.innerHTML = `
    ${!canEdit ? `<div class="ro-banner"><i class="ti ti-eye"></i> <div>View only — this unit is assigned to <b>${esc(r.assignedToName || "another officer")}</b>. You can browse it, but can't record or change payments.</div></div>` : ""}
    <div class="stat-grid client-stats">
      <div class="stat-card"><div class="stat-icon green"><i class="ti ti-circle-check"></i></div>
        <div><div class="stat-value money-good" style="font-size:${fitStat(refS)}px">${refS}</div>
        <div class="stat-label">Reflected (paid)</div></div></div>
      <div class="stat-card"><div class="stat-icon red"><i class="ti ti-alert-circle"></i></div>
        <div><div class="stat-value ${outstanding > 0 ? "money-bad" : ""}" style="font-size:${fitStat(outS)}px">${outS}</div>
        <div class="stat-label">Outstanding due</div></div></div>
      <div class="stat-card"><div class="stat-icon navy"><i class="ti ti-tag"></i></div>
        <div><div class="stat-value" style="font-size:${fitStat(spS)}px">${spS}</div>
        <div class="stat-label">Selling price</div></div></div>
    </div>

    <div class="detail-grid">
      <section class="card card--framed">
        <div class="card-head"><div class="card-head-t">
          <div class="card-head-title"><i class="ti ti-user"></i> Client details</div>
          <div class="card-head-sub">${esc(c.label)}${r.agent ? " · " + esc(r.agent) : ""}</div>
        </div></div>
        <div class="card-pad">
          <div class="info-grid">${infoRows}</div>
          ${r.remarks ? `<div class="info-remarks"><div class="info-label">Remarks</div><div>${esc(r.remarks)}</div></div>` : ""}
        </div>
      </section>
      <section class="card card--framed">
        <div class="card-head">
          <div class="card-head-t">
            <div class="card-head-title"><i class="ti ti-calendar-dollar"></i> Payment schedule</div>
            <div class="card-head-sub">${r.soaBreakdown?.items?.length ? `From SOA${r.soaBreakdown.ref ? " · " + esc(r.soaBreakdown.ref) : ""}` : (sched ? (sched.plan.mode === "cash" ? "100% Cash" : sched.plan.mode === "flexi" ? "Flexi" : "1% monthly") : "")}${canEdit && sched && sched.plan.mode !== "cash" ? " · click a box to set month / %" : ""}</div>
          </div>
          <div class="card-head-actions">
            ${canEdit ? `<button class="btn head-btn sm" id="editPlanBtn"><i class="ti ti-adjustments"></i> Edit plan</button>` : ""}
            ${sched && canEdit ? `<button class="btn head-btn sm" id="recordPayBtn"><i class="ti ti-cash"></i> Record payment</button>` : ""}
          </div>
        </div>
        <div class="card-pad">
          ${sched ? scheduleHTML(sched, r, canEdit) : `<div class="empty" style="padding:26px"><div class="e-icon">🧾</div>
            <div class="e-title">No selling price on record</div>
            <div class="e-sub">Add a selling price to generate the 1% installment breakdown.</div></div>`}
        </div>
      </section>
    </div>`;

  if (sched) {
    mountScheduleTips();
    if (canEdit) {
      document.getElementById("recordPayBtn")?.addEventListener("click", recordPayment);
      document.getElementById("editPlanBtn")?.addEventListener("click", openPlanEditor);
      document.getElementById("transferBtn")?.addEventListener("click", transferToInstallment);
      document.getElementById("schedReset")?.addEventListener("click", async (e) => {
        e.preventDefault();
        try { await db.updateRecord(record.id, { installmentPlan: null }); toast("Schedule reset to 1%"); await reloadAndRender(); }
        catch (err) { toast("Failed — " + err.message); }
      });
      document.querySelectorAll(".sched-cell[data-idx]").forEach((el) =>
        el.addEventListener("click", () => openBoxEditor(Number(el.dataset.idx))));
    }
  } else if (canEdit) {
    document.getElementById("editPlanBtn")?.addEventListener("click", openPlanEditor);
  }
}

function historyHTML(r, canEdit = true) {
  const list = txns(r).slice().sort((a, b) => String(b.date || b.ts || "").localeCompare(String(a.date || a.ts || "")));
  const reflected = Number(r.reflected) || 0;
  const sumTx = list.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const base = r2(reflected - sumTx);
  const rows = list.map((t) => `
    <tr>
      <td style="white-space:nowrap">${t.date ? fmtDate(t.date) : "—"}</td>
      <td class="num money-good">+${fmtMoney(t.amount, { currency: false })}</td>
      <td class="cell-remarks">${esc(t.note || "")}</td>
      <td>${canEdit ? `<div class="row-actions"><button class="del" data-deltxn="${esc(t.id)}" title="Delete payment">✕</button></div>` : ""}</td>
    </tr>`).join("");
  const baseRow = base > 0.5 ? `<tr>
      <td style="white-space:nowrap;color:var(--ink-3)">Opening balance</td>
      <td class="num money-good">${fmtMoney(base, { currency: false })}</td>
      <td class="cell-remarks" style="color:var(--ink-3)">Imported / existing reflected amount</td><td></td></tr>` : "";
  const hasRows = list.length || base > 0.5;

  return `<section class="card card--framed">
    <div class="card-head">
      <div class="card-head-t">
        <div class="card-head-title"><i class="ti ti-receipt-2"></i> Transaction history</div>
        <div class="card-head-sub">${list.length} recorded payment${list.length === 1 ? "" : "s"} for unit ${esc(r.unitNo)}</div>
      </div>
      ${canEdit ? `<button class="btn head-btn sm" id="recordPayBtn2"><i class="ti ti-cash"></i> Record payment</button>` : ""}
    </div>
    <div class="card-pad">
      ${hasRows ? `<div class="table-wrap"><table class="data">
        <thead><tr><th>Date</th><th class="num">Amount</th><th>Note</th><th></th></tr></thead>
        <tbody>${rows}${baseRow}</tbody>
        <tfoot><tr><td>Total reflected</td><td class="num money-good">${fmtMoney(reflected, { currency: false })}</td><td></td><td></td></tr></tfoot>
      </table></div>`
      : `<div class="empty" style="padding:34px"><div class="e-icon">🧾</div>
        <div class="e-title">No payments recorded yet</div>
        <div class="e-sub">Use <b>Record payment</b> to log a payment. Each one is listed here and can be deleted.</div></div>`}
    </div>
  </section>`;
}

async function deleteTxn(id) {
  const list = txns(record);
  const t = list.find((x) => x.id === id);
  if (!t) return;
  if (!(await confirmModal({ title: "Delete payment?", message: `Delete this ${fmtMoney(t.amount)} payment? Reflected decreases and outstanding increases by that amount.`, confirmLabel: "Delete payment", danger: true }))) return;
  const amt = Number(t.amount) || 0;
  try {
    await db.updateRecord(record.id, {
      transactions: list.filter((x) => x.id !== id),
      reflected: Math.max(0, r2((Number(record.reflected) || 0) - amt)),
      outstanding: r2((Number(record.outstanding) || 0) + amt),
    });
    toast("Payment deleted");
    await reloadAndRender();
  } catch (e) { toast("Failed — " + e.message); }
}

function scheduleHTML(s, r, canEdit = true) {
  const p = s.plan;

  if (s.isCash) {
    const done = s.pct >= 100;
    return `
      <div class="plan-strip"><span class="plan-chip cash">100% Cash</span></div>
      <div class="sched-summary">
        <div><div class="sched-big">${s.pct}%</div><div class="sched-cap">paid of selling price</div></div>
        <div class="sched-meter"><div class="sched-meter-fill" style="width:${s.pct}%"></div></div>
      </div>
      <div class="sched-dp ${done ? "done" : ""}">
        <div class="sched-dp-head">
          <span class="sched-dp-label"><i class="ti ti-${done ? "circle-check" : "cash"}"></i> 100% Cash payment</span>
          <span class="sched-dp-amt ${done ? "money-good" : "money-bad"}">${done ? "Paid in full · " + fmtMoney(s.planTotal) : fmtMoney(s.paidTotal) + " / " + fmtMoney(s.planTotal)}</span>
        </div>
        <div class="sched-meter"><div class="sched-meter-fill" style="width:${s.pct}%"></div></div>
        <div class="sched-note"><i class="ti ti-info-circle"></i> Paid in full in cash — no installment schedule.</div>
      </div>`;
  }

  const dpBar = s.dpTarget ? Math.min(100, Math.round((s.dpPaid / s.dpTarget) * 100)) : 100;
  const paidCount = s.instRows.filter((x) => x.status === "paid").length;
  const partialCount = s.instRows.filter((x) => x.status === "partial").length;

  const cells = s.instRows.map((x) => {
    const pct = s.onePct ? Math.round((x.amount / s.onePct) * 100) / 100 : 1;
    const custom = Math.abs(pct - 1) > 0.001;
    const cls = x.skip ? "skip" : x.status;
    // Label every box with its % (default boxes show 1%), matching custom boxes.
    const face = x.skip ? '<i class="ti ti-ban"></i>' : pct + "%";
    return `<span class="sched-cell ${cls}${custom && !x.skip ? " custom" : ""}${canEdit ? "" : " ro"}" ${canEdit ? `data-idx="${x.idx}"` : ""}
      data-tip="Installment ${x.idx + 1}${x.month ? " · " + x.month : ""} · ${fmtMoney(x.amount)} (${pct}%)<br>${x.skip ? "No collection this month" : x.status === "paid" ? "Paid" : x.status === "partial" ? "Partly paid " + fmtMoney(x.paid) : "Not yet paid"}${canEdit ? "<br><span style='opacity:.7'>click to set month / %</span>" : ""}">
      <span class="sc-face">${face}</span><span class="sc-mon">${x.month || ""}</span></span>`;
  }).join("");

  const planStrip = `
    <div class="plan-strip">
      <span class="plan-chip"><b>${p.dpPct}%</b> DP · ${fmtMoney(p.dpAmount, { compact: true })}</span>
      <span class="plan-chip"><b>${p.dcPct}%</b> DC · ${fmtMoney(p.dcAmount, { compact: true })}</span>
      <span class="plan-chip ${p.mode === "flexi" ? "flexi" : "monthly"}">${p.mode === "flexi" ? "Flexi" : "1% Monthly"}</span>
    </div>
    ${s.needsFlexi ? `<div class="flexi-warn"><i class="ti ti-alert-triangle"></i> Flexi boxes total ${fmtMoney(s.boxes.reduce((a, b) => a + (Number(b) || 0), 0))} but should total ${fmtMoney(p.dcAmount)} — adjust the boxes so they add up.</div>` : ""}`;

  const transfer = s.isDp
    ? (s.transferReady
        ? (canEdit ? `<button class="btn primary sm sched-transfer" id="transferBtn"><i class="ti ti-arrow-right"></i> Transfer to Installment</button>` : "")
        : `<div class="sched-note"><i class="ti ti-info-circle"></i> Reflected payments go to the 24% downpayment. When it's complete, a <b>Transfer to Installment</b> button appears to start the 1% monthly plan.</div>`)
    : "";

  return `
    ${planStrip}
    <div class="sched-summary">
      <div><div class="sched-big">${s.pct}%</div><div class="sched-cap">${s.isDp ? "of downpayment settled" : "of plan settled"}</div></div>
      <div class="sched-meter"><div class="sched-meter-fill" style="width:${s.pct}%"></div></div>
    </div>

    <div class="sched-dp ${s.dpDone ? "done" : ""}">
      <div class="sched-dp-head">
        <span class="sched-dp-label"><i class="ti ti-${s.dpDone ? "circle-check" : "clock"}"></i> Downpayment (24%)</span>
        <span class="sched-dp-amt ${s.dpDone ? "money-good" : "money-bad"}">${s.dpDone ? "Completed · " + fmtMoney(s.dpTarget) : fmtMoney(s.dpPaid) + " / " + fmtMoney(s.dpTarget)}</span>
      </div>
      <div class="sched-meter"><div class="sched-meter-fill" style="width:${dpBar}%"></div></div>
      ${transfer}
    </div>

    <div class="sched-inst-head">
      <span>${s.instCount} installments · 1% = ${fmtMoney(s.onePct)}${s.custom && canEdit ? ` · <a href="#" id="schedReset">reset</a>` : ""}${s.isDp ? " (starts after transfer)" : ""}</span>
      <span class="sched-legend">
        <span class="sched-cell paid"></span> ${paidCount} paid
        <span class="sched-cell partial"></span> ${partialCount} partial
        <span class="sched-cell due"></span> ${s.instCount - paidCount - partialCount} due
      </span>
    </div>
    <div class="sched-grid ${s.isDp ? "preview" : ""}">${cells || `<span class="muted">No installments.</span>`}</div>`;
}

async function handleSOAUpload(e) {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  toast("Reading SOA…");
  let res;
  try {
    res = await parseSOA(f);
  } catch (err) {
    console.error(err);
    await alertModal({
      title: "Couldn’t read the SOA",
      message: /PDF reader/i.test(err.message)
        ? "The PDF reader didn’t load. Please refresh the page and try again — if it keeps happening, check your connection."
        : `We couldn’t read that PDF: ${err.message}`,
      danger: true, icon: "ti-file-alert",
    });
    return;
  }
  if (!res.items.length) {
    await alertModal({
      title: "No installment breakdown found",
      message: "This PDF doesn’t contain a “Payment Installment Breakdown” section. Please upload the client’s full Statement of Account.",
      danger: true, icon: "ti-file-alert",
    });
    return;
  }
  // The SOA must belong to THIS unit. Block a definite mismatch; if the unit
  // number can't be read, ask before proceeding.
  const norm = (u) => String(u || "").toUpperCase().replace(/[\s\-]/g, "");
  if (res.unit && norm(res.unit) !== norm(record.unitNo)) {
    await alertModal({
      title: "Wrong unit — upload blocked",
      message: `This SOA is for unit ${res.unit}, but this record is unit ${record.unitNo}. Please upload the Statement of Account for unit ${record.unitNo}.`,
      danger: true, icon: "ti-alert-triangle", okLabel: "Got it",
    });
    return;
  }
  if (!res.unit) {
    const ok = await confirmModal({
      title: "Couldn’t verify the unit",
      message: `We couldn't read a unit number from this PDF to confirm it belongs to unit ${record.unitNo}. Upload anyway?`,
      confirmLabel: "Upload anyway", icon: "ti-help-circle",
    });
    if (!ok) return;
  }
  try {
    const patch = { soaBreakdown: { ...res, uploadedAt: new Date().toISOString(), fileName: f.name } };
    if (res.start) patch.installmentStart = res.start.slice(0, 7);   // feed the schedule anchor
    // Drive the payment-schedule boxes from the SOA: each installment's
    // percentage becomes a box (amount = % × selling price) on its exact month,
    // so the schedule mirrors the official statement (incl. the 2% boxes).
    const S = Number(record.sellingPrice) || 0;
    if (S > 0) {
      patch.installmentPlan = res.items.map((it) => r2(((Number(it.pct) || 0) / 100) * S));
      patch.boxMonths = res.items.map((it) => (it.date ? { m: it.date.slice(0, 7), manual: true } : null));
    }
    await db.updateRecord(record.id, patch);
    toast(`Loaded ${res.items.length} installments from the SOA`);
    await reloadAndRender();
  } catch (err) {
    console.error(err);
    await alertModal({ title: "Couldn’t save the SOA", message: `The installments were read but saving failed: ${err.message}`, danger: true, icon: "ti-file-alert" });
  }
}

/* ---- move a client's record to a different category (e.g. Legal → Installment) ---- */
function openMoveCategory(r) {
  const cur = catByKey[r.category];
  const opts = CATS.filter((c) => c.key !== r.category)
    .map((c) => `<option value="${c.key}">${esc(c.label)}</option>`).join("");
  const bd = document.createElement("div");
  bd.className = "modal-backdrop";
  bd.innerHTML = `<div class="modal" style="width:min(440px,100%)">
    <div class="modal-header"><div class="modal-header-left">
      <div class="modal-header-icon"><i class="ti ti-arrows-exchange"></i></div>
      <div style="min-width:0"><div class="modal-header-title">Move to another category</div>
      <div class="modal-header-sub">Unit ${esc(r.unitNo)}${r.buyerName ? " · " + esc(r.buyerName) : ""}</div></div></div>
      <button class="modal-close" data-x aria-label="Close"><i class="ti ti-x"></i></button></div>
    <form><div class="modal-body">
      <div style="margin-bottom:14px;font-size:13px;color:var(--ink-2)">Currently in
        <span class="status-badge" style="--sb:${cur.color};margin-left:4px">${esc(cur.short)}</span></div>
      <div class="field full"><label>Move to</label>
        <select id="mvCat" class="role-select" style="width:100%">${opts}</select></div>
      <div class="pm-hint">The record keeps its buyer, amounts, payment plan and history — only its category changes.</div>
    </div>
    <div class="modal-actions"><button type="button" class="btn" data-x>Cancel</button>
      <button type="submit" class="btn primary"><i class="ti ti-arrows-exchange"></i> Move</button></div></form></div>`;
  document.body.appendChild(bd);
  requestAnimationFrame(() => bd.classList.add("open"));
  const close = () => { bd.classList.remove("open"); setTimeout(() => bd.remove(), 200); };
  bd.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", close));
  bd.addEventListener("click", (e) => { if (e.target === bd) close(); });
  bd.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const cat = bd.querySelector("#mvCat").value;
    const btn = bd.querySelector("button[type=submit]"); btn.disabled = true;
    try {
      await db.updateRecord(r.id, { category: cat });
      close();
      toast(`Moved to ${catByKey[cat].label}`);
      await reloadAndRender();
    } catch (err) { toast("Move failed — " + err.message); btn.disabled = false; }
  });
}

/* ---- small prompt modal (green header) → resolves values or null ---- */
function promptModal(opts) {
  return new Promise((resolve) => {
    const bd = document.createElement("div");
    bd.className = "modal-backdrop";
    bd.innerHTML = `<div class="modal" style="width:min(440px,100%)">
      <div class="modal-header"><div class="modal-header-left">
        <div class="modal-header-icon"><i class="ti ${opts.icon}"></i></div>
        <div style="min-width:0"><div class="modal-header-title">${esc(opts.title)}</div>
        ${opts.sub ? `<div class="modal-header-sub">${esc(opts.sub)}</div>` : ""}</div></div>
        <button class="modal-close" data-x aria-label="Close"><i class="ti ti-x"></i></button></div>
      <form><div class="modal-body"><div class="form-grid" style="grid-template-columns:1fr">
        ${opts.fields.map((f) => `<div class="field full"><label>${esc(f.label)}</label>
          <input id="pm_${f.key}" type="${f.type || "text"}" ${f.step ? `step="${f.step}"` : ""} ${f.min != null ? `min="${f.min}"` : ""} value="${f.value ?? ""}" ${f.type === "number" ? 'inputmode="decimal"' : ""}>
          ${f.hint ? `<div class="pm-hint">${esc(f.hint)}</div>` : ""}</div>`).join("")}
      </div></div>
      <div class="modal-actions"><button type="button" class="btn" data-x>Cancel</button>
        <button type="submit" class="btn primary">${esc(opts.submitLabel || "Save")}</button></div></form></div>`;
    document.body.appendChild(bd);
    requestAnimationFrame(() => bd.classList.add("open"));
    const done = (val) => { bd.classList.remove("open"); setTimeout(() => bd.remove(), 200); resolve(val); };
    bd.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", () => done(null)));
    bd.addEventListener("click", (e) => { if (e.target === bd) done(null); });
    bd.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      const out = {};
      opts.fields.forEach((f) => { out[f.key] = bd.querySelector("#pm_" + f.key).value; });
      done(out);
    });
    setTimeout(() => bd.querySelector("input")?.focus(), 200);
  });
}

async function reloadAndRender() {
  const { records } = await db.loadAll(true);
  record = records.find((x) => x.id === recordId) || record;
  render();
}

async function recordPayment() {
  const today = new Date().toISOString().slice(0, 10);
  const res = await promptModal({
    title: `Record payment — Unit ${record.unitNo}`, icon: "ti-cash",
    sub: record.buyerName || "", submitLabel: "Record payment",
    fields: [
      { key: "amount", label: "Payment amount (AED)", type: "number", step: "0.01", min: 0,
        hint: "Added to reflected and deducted from outstanding." },
      { key: "date", label: "Payment date", type: "date", value: today },
      { key: "note", label: "Note (optional)", type: "text", value: "" },
    ],
  });
  if (!res) return;
  const amt = Number(res.amount);
  if (!(amt > 0)) { toast("Enter a valid amount"); return; }
  const t = { id: `t_${Date.now()}_${Math.floor(Math.random() * 1e5)}`, amount: r2(amt),
    date: res.date || today, note: (res.note || "").trim(), ts: new Date().toISOString() };
  try {
    await db.updateRecord(record.id, {
      transactions: [...txns(record), t],
      reflected: r2((Number(record.reflected) || 0) + amt),
      outstanding: Math.max(0, r2((Number(record.outstanding) || 0) - amt)),
    });
    toast(`Recorded ${fmtMoney(amt)}`);
    await reloadAndRender();
  } catch (e) { toast("Failed — " + e.message); }
}

/* ---- Payment plan editor: DP amount, DC amount / %, and mode ---- */
async function openPlanEditor() {
  const p = planOf(record);
  const startYM = parseYM(record.installmentStart);
  const nowY = new Date().getFullYear();
  const startYears = [];
  for (let y = Math.min(nowY - 1, 2023); y <= nowY + 10; y++) startYears.push(y);
  const bd = document.createElement("div");
  bd.className = "modal-backdrop";
  bd.innerHTML = `<div class="modal" style="width:min(460px,100%)">
    <div class="modal-header"><div class="modal-header-left">
      <div class="modal-header-icon"><i class="ti ti-adjustments"></i></div>
      <div><div class="modal-header-title">Payment plan</div>
      <div class="modal-header-sub">Unit ${esc(record.unitNo)} · ${fmtMoney(p.S, { compact: true })} selling price</div></div></div>
      <button class="modal-close" data-x><i class="ti ti-x"></i></button></div>
    <div class="modal-body">
      <label class="fld"><span>Plan type</span>
        <select id="plMode"><option value="monthly" ${p.mode === "monthly" ? "selected" : ""}>1% Monthly</option>
        <option value="flexi" ${p.mode === "flexi" ? "selected" : ""}>Flexi (custom % per box)</option>
        <option value="cash" ${p.mode === "cash" ? "selected" : ""}>100% Cash (no installments)</option></select></label>
      <div class="form-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <label class="fld"><span>DP % (down + DLD + admin)</span><input id="plDpPct" type="number" step="0.01" value="${p.dpPct}"></label>
        <label class="fld"><span>DP amount (AED)</span><input id="plDpAmt" type="number" step="0.01" value="${r2(p.dpAmount)}"></label>
        <label class="fld"><span>DC %</span><input id="plDcPct" type="number" step="0.01" value="${p.dcPct}"></label>
        <label class="fld"><span>DC amount (AED)</span><input id="plDcAmt" type="number" step="0.01" value="${r2(p.dcAmount)}"></label>
      </div>
      <label class="fld"><span>Installment start (first box month)</span>
        <div style="display:flex;gap:10px">
          <select id="plStartMon" style="flex:1"><option value="">—</option>${MONTHS.map((m, i) => `<option value="${i + 1}" ${startYM && startYM.m === i + 1 ? "selected" : ""}>${m}</option>`).join("")}</select>
          <select id="plStartYear" style="flex:1"><option value="">—</option>${startYears.map((y) => `<option value="${y}" ${startYM && startYM.y === y ? "selected" : ""}>${y}</option>`).join("")}</select>
        </div></label>
      <div class="assign-note"><i class="ti ti-info-circle"></i> The DC % sets how many 1% boxes appear (e.g. 80% → 80 boxes). The installment start anchors the first box's month and cascades the rest.</div>
    </div>
    <div class="modal-actions"><button class="btn" data-x>Cancel</button>
      <button class="btn primary" id="plSave"><i class="ti ti-check"></i> Save plan</button></div></div>`;
  document.body.appendChild(bd);
  requestAnimationFrame(() => bd.classList.add("open"));
  const close = () => { bd.classList.remove("open"); setTimeout(() => bd.remove(), 200); };
  bd.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", close));
  bd.addEventListener("click", (e) => { if (e.target === bd) close(); });
  // keep % and amount loosely in sync
  const S = p.S;
  const sync = (pctEl, amtEl) => {
    bd.querySelector(pctEl).addEventListener("input", (e) => { if (S) bd.querySelector(amtEl).value = r2((Number(e.target.value) || 0) / 100 * S); });
    bd.querySelector(amtEl).addEventListener("input", (e) => { if (S) bd.querySelector(pctEl).value = r2((Number(e.target.value) || 0) / S * 100); });
  };
  sync("#plDpPct", "#plDpAmt"); sync("#plDcPct", "#plDcAmt");

  bd.querySelector("#plSave").addEventListener("click", async () => {
    const mode = bd.querySelector("#plMode").value;
    const dpPct = Number(bd.querySelector("#plDpPct").value) || 0;
    const dcPct = Number(bd.querySelector("#plDcPct").value) || 0;
    const dpAmount = r2(Number(bd.querySelector("#plDpAmt").value) || 0);
    const dcAmount = r2(Number(bd.querySelector("#plDcAmt").value) || 0);
    const sm = bd.querySelector("#plStartMon").value, sy = bd.querySelector("#plStartYear").value;
    const patch = { planMode: mode, dpPct, dcPct, dpAmount, dcAmount,
      installmentStart: sm && sy ? `${sy}-${String(Number(sm)).padStart(2, "0")}` : "",
      paymentPlan: mode === "cash" ? "100% Cash"
        : `${dpPct}% DP • ${dcPct}% DC (${mode === "flexi" ? "FLEXI" : "1% Monthly"})` };
    // Cash has no boxes. Otherwise, if the officer already customised boxes,
    // KEEP them and just rebalance to the new DC amount (don't wipe their %s).
    // With no custom boxes, leave installmentPlan null so it regenerates as
    // dcPct × 1% boxes.
    if (mode === "cash") patch.installmentPlan = null;
    else if (Array.isArray(record.installmentPlan) && record.installmentPlan.length)
      patch.installmentPlan = rebalanceBoxes(record.installmentPlan, dcAmount, p.onePct);
    try { await db.updateRecord(record.id, patch); close(); toast("Payment plan saved"); await reloadAndRender(); }
    catch (e) { toast("Failed — " + e.message); }
  });
}

/* ---- Box editor: set the month/year, mark "no collection", and (Flexi) % ---- */
async function openBoxEditor(idx) {
  const s = buildSchedule(record);
  if (!s) return;
  const p = s.plan, flexi = p.mode === "flexi";
  const box = s.instRows[idx];
  const curPct = s.onePct ? r2((box.amount || s.onePct) / s.onePct) : 1;
  const curYM = box.month ? parseYMLabel(box.month) : null;
  const nowY = new Date().getFullYear();
  const years = [];
  for (let y = Math.min(nowY - 1, 2023); y <= nowY + 10; y++) years.push(y);
  const selY = curYM?.y || nowY, selM = curYM?.m || 1;

  const bd = document.createElement("div");
  bd.className = "modal-backdrop";
  bd.innerHTML = `<div class="modal" style="width:min(430px,100%)">
    <div class="modal-header"><div class="modal-header-left">
      <div class="modal-header-icon"><i class="ti ti-calendar-month"></i></div>
      <div><div class="modal-header-title">Installment ${idx + 1}</div>
      <div class="modal-header-sub">${fmtMoney(box.amount)} · setting the month cascades to later boxes</div></div></div>
      <button class="modal-close" data-x><i class="ti ti-x"></i></button></div>
    <div class="modal-body">
      <div class="form-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <label class="fld"><span>Month</span><select id="bxMon">${MONTHS.map((m, i) => `<option value="${i + 1}" ${i + 1 === selM ? "selected" : ""}>${m}</option>`).join("")}</select></label>
        <label class="fld"><span>Year</span><select id="bxYear">${years.map((y) => `<option value="${y}" ${y === selY ? "selected" : ""}>${y}</option>`).join("")}</select></label>
      </div>
      <label class="assign-row" style="margin-top:2px"><input type="checkbox" id="bxSkip" ${box.skip ? "checked" : ""}>
        <span>No collection this month (skipped)</span></label>
      <label class="fld" style="margin-top:10px"><span>Installment size (% of selling price) · default 1% = ${fmtMoney(s.onePct)}</span>
        <input id="bxPct" type="number" step="0.01" min="0" value="${curPct}"></label>
      <div class="assign-note"><i class="ti ti-info-circle"></i> Later boxes auto-fill the next months. Mark odd months as “No collection”.</div>
    </div>
    <div class="modal-actions">${box.month || box.skip ? `<button class="btn" id="bxClear">Clear month</button>` : `<button class="btn" data-x>Cancel</button>`}
      <button class="btn primary" id="bxSave"><i class="ti ti-check"></i> Apply</button></div></div>`;
  document.body.appendChild(bd);
  requestAnimationFrame(() => bd.classList.add("open"));
  const close = () => { bd.classList.remove("open"); setTimeout(() => bd.remove(), 200); };
  bd.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", close));
  bd.addEventListener("click", (e) => { if (e.target === bd) close(); });

  const saveBoxMonths = (entry) => {
    const bms = Array.isArray(record.boxMonths) ? record.boxMonths.map((x) => (x ? { ...x } : x)) : [];
    while (bms.length <= idx) bms.push(null);
    bms[idx] = entry;
    return bms;
  };

  bd.querySelector("#bxClear")?.addEventListener("click", async () => {
    try { await db.updateRecord(record.id, { boxMonths: saveBoxMonths(null) }); close(); toast("Month cleared"); await reloadAndRender(); }
    catch (e) { toast("Failed — " + e.message); }
  });

  bd.querySelector("#bxSave").addEventListener("click", async () => {
    const m = Number(bd.querySelector("#bxMon").value);
    const y = Number(bd.querySelector("#bxYear").value);
    const skip = bd.querySelector("#bxSkip").checked;
    const patch = { boxMonths: saveBoxMonths({ m: ymKey({ y, m }), manual: true, skip }) };
    const pct = Number(bd.querySelector("#bxPct").value);
    // Works in any mode. Setting a box's % keeps the boxes before it, sets
    // this box, then rebuilds the boxes after it as 1% each to fill the rest
    // of the DC amount — so the later boxes auto-adjust and the plan stays
    // balanced to the DC total.
    if (pct > 0 && Math.abs(pct * s.onePct - box.amount) > 0.01) {
      const newAmt = r2(s.onePct * pct);
      const head = s.boxes.slice(0, idx).map(Number);
      const rem = Math.max(0, r2(s.balance - head.reduce((a, b) => a + b, 0) - newAmt));
      patch.installmentPlan = [...head, newAmt, ...genBoxes(rem, s.onePct)];
    }
    try { await db.updateRecord(record.id, patch); close(); toast(`Installment ${idx + 1} updated`); await reloadAndRender(); }
    catch (e) { toast("Failed — " + e.message); }
  });
}

/** "Apr 25" → { y, m }. */
function parseYMLabel(label) {
  const [mon, yy] = String(label).split(" ");
  const m = MONTHS.indexOf(mon) + 1;
  if (!m || !yy) return null;
  return { y: 2000 + Number(yy), m };
}

async function transferToInstallment() {
  const D = downpaymentTarget(record);
  const R = Number(record.reflected) || 0;
  const excess = Math.max(0, r2(R - D));
  const { balance } = scheduleBoxes(record);
  if (!(await confirmModal({ title: "Transfer to Installment?", icon: "ti-arrow-right",
    message: `The 24% downpayment is complete. Unit ${record.unitNo} moves to the Installment tab and starts the 1% monthly plan${excess ? ` with ${fmtMoney(excess)} carried over` : ""}.`,
    confirmLabel: "Transfer" }))) return;
  try {
    await db.updateRecord(record.id, {
      category: "installment", reflected: excess,
      outstanding: Math.max(0, r2(balance - excess)),
      transferredAt: new Date().toISOString(),
    });
    toast("Transferred to Installment");
    await reloadAndRender();
  } catch (e) { toast("Failed — " + e.message); }
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

/* ------------------------------------------------ assign this unit (boss) */
async function openAssign(r) {
  const users = (await auth.listUsers()).filter((u) => u.role === "agent" && u.active !== false);
  const opts = [`<option value="">Unassigned — only the Manager sees it</option>`]
    .concat(users.map((u) => `<option value="${esc(u.uid)}" ${r.assignedTo === u.uid ? "selected" : ""}>${esc(u.name || u.email)}</option>`))
    .join("");

  const bd = document.createElement("div");
  bd.className = "modal-backdrop";
  bd.innerHTML = `<div class="modal" style="width:min(440px,100%)">
    <div class="modal-header"><div class="modal-header-left">
      <div class="modal-header-icon"><i class="ti ti-user-cog"></i></div>
      <div><div class="modal-header-title">Assign this unit</div>
      <div class="modal-header-sub">Unit ${esc(r.unitNo)}${r.buyerName ? " · " + esc(r.buyerName) : ""}</div></div></div>
      <button class="modal-close" data-x><i class="ti ti-x"></i></button></div>
    <div class="modal-body">
      <label class="fld"><span>Collector</span><select id="asSel">${opts}</select></label>
      <div class="assign-note"><i class="ti ti-info-circle"></i> Overrides the project-level assignment for this one unit.</div>
      ${users.length ? "" : `<div class="login-error show">No collection officers yet — add one in Team &amp; access.</div>`}
    </div>
    <div class="modal-actions"><button class="btn" data-x>Cancel</button>
      <button class="btn primary" id="asSave"><i class="ti ti-check"></i> Save</button></div></div>`;
  document.body.appendChild(bd);
  requestAnimationFrame(() => bd.classList.add("open"));
  const close = () => { bd.classList.remove("open"); setTimeout(() => bd.remove(), 200); };
  bd.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", close));
  bd.addEventListener("click", (e) => { if (e.target === bd) close(); });
  bd.querySelector("#asSave").addEventListener("click", async () => {
    const uid = bd.querySelector("#asSel").value;
    const name = uid ? (users.find((u) => u.uid === uid)?.name || users.find((u) => u.uid === uid)?.email || "") : "";
    try {
      await db.updateRecord(r.id, { assignedTo: uid, assignedToName: name });
      record.assignedTo = uid; record.assignedToName = name;
      close(); toast("Unit assignment updated");
    } catch (e) { toast("Could not update — " + e.message); }
  });
}

main().catch((e) => {
  console.error(e);
  document.getElementById("clientMain").innerHTML =
    `<div class="empty"><div class="e-icon">⚠️</div><div class="e-title">Could not load record</div>
     <div class="e-sub">${esc(e.message)}</div></div>`;
});
