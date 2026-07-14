/* ============================================================
   Client / buyer detail page — full record breakdown plus a
   1%-installment payment schedule (downpayment-first).
   ============================================================ */
import * as db from "./db.js";
import * as auth from "./auth.js";
import {
  catByKey, esc, fmtMoney, fmtInt, fmtDate, renderNav, initTheme,
  initSidebar, setModeBadge, observeReveals, toast, visibleProjects, confirmModal,
} from "./ui.js";
import { openRecordForm } from "./record-form.js";

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
const r2 = (n) => Math.round(n * 100) / 100;

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

/** Installment box amounts — a stored custom plan, else default 1% boxes. */
export function scheduleBoxes(r) {
  const S = Number(r.sellingPrice) || 0;
  const dp20 = Number(r.dp20) || (S ? S * 0.2 : 0);
  const balance = Math.max(0, S - dp20);
  const onePct = S * 0.01;
  if (Array.isArray(r.installmentPlan) && r.installmentPlan.length)
    return { boxes: r.installmentPlan.map(Number), onePct, balance };
  return { boxes: genBoxes(balance, onePct), onePct, balance };
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

  if (isDp) {
    // Still paying the 24% downpayment — reflected all goes to it; installments haven't started.
    const dpPaid = Math.min(R, D);
    const dpDone = D > 0 && dpPaid >= D - 0.01;
    const instRows = boxes.map((amt, i) => ({ label: `Installment ${i + 1}`, amount: amt, kind: "inst", idx: i, paid: 0, status: "due" }));
    return { isDp: true, boxes, instRows, instCount: boxes.length, onePct, balance, custom,
      dpTarget: D, dpPaid, dpDone, planTotal: D, paidTotal: dpPaid,
      pct: D ? Math.round((dpPaid / D) * 100) : 0, transferReady: dpDone };
  }

  // Installment phase — downpayment already settled; reflected fills the boxes.
  let left = R;
  const instRows = boxes.map((amt, i) => {
    const paid = Math.max(0, Math.min(left, amt)); left -= paid;
    return { label: `Installment ${i + 1}`, amount: amt, kind: "inst", idx: i, paid,
      status: paid >= amt - 0.01 && amt > 0 ? "paid" : paid > 0 ? "partial" : "due" };
  });
  const planTotal = boxes.reduce((a, b) => a + b, 0);
  const paidTotal = Math.min(R, planTotal);
  return { isDp: false, boxes, instRows, instCount: boxes.length, onePct, balance, custom,
    dpTarget: D, dpPaid: D, dpDone: true, planTotal, paidTotal,
    pct: planTotal ? Math.round((paidTotal / planTotal) * 100) : 0, transferReady: false };
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
  const body = document.getElementById("clientBody");
  if (activeClientTab === "history") {
    body.innerHTML = historyHTML(r);
    document.getElementById("recordPayBtn2")?.addEventListener("click", recordPayment);
    body.querySelectorAll("[data-deltxn]").forEach((b) =>
      b.addEventListener("click", () => deleteTxn(b.dataset.deltxn)));
    return;
  }

  const c = catByKey[r.category];
  const sched = buildSchedule(r);
  const reflected = Number(r.reflected) || 0;
  const outstanding = Number(r.outstanding) || 0;
  const infoRows = INFO.filter(([k]) => r[k] !== undefined && r[k] !== null && r[k] !== "" || ["sellingPrice", "reflected", "outstanding", "dpTotal"].includes(k))
    .map(([k, label, kind]) => `
      <div class="info-item">
        <div class="info-label">${label}</div>
        <div class="info-value ${k === "reflected" ? "money-good" : k === "outstanding" && outstanding > 0 ? "money-bad" : ""}">${infoVal(r, k, kind)}</div>
      </div>`).join("");

  const refS = fmtMoney(reflected), outS = fmtMoney(outstanding), spS = fmtMoney(r.sellingPrice);
  body.innerHTML = `
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
            <div class="card-head-sub">1% monthly · click a box to edit %</div>
          </div>
          ${sched ? `<button class="btn head-btn sm" id="recordPayBtn"><i class="ti ti-cash"></i> Record payment</button>` : ""}
        </div>
        <div class="card-pad">
          ${sched ? scheduleHTML(sched, r) : `<div class="empty" style="padding:26px"><div class="e-icon">🧾</div>
            <div class="e-title">No selling price on record</div>
            <div class="e-sub">Add a selling price to generate the 1% installment breakdown.</div></div>`}
        </div>
      </section>
    </div>`;

  if (sched) {
    mountScheduleTips();
    document.getElementById("recordPayBtn")?.addEventListener("click", recordPayment);
    document.getElementById("transferBtn")?.addEventListener("click", transferToInstallment);
    document.getElementById("schedReset")?.addEventListener("click", async (e) => {
      e.preventDefault();
      try { await db.updateRecord(record.id, { installmentPlan: null }); toast("Schedule reset to 1%"); await reloadAndRender(); }
      catch (err) { toast("Failed — " + err.message); }
    });
    document.querySelectorAll(".sched-cell[data-idx]").forEach((el) =>
      el.addEventListener("click", () => editBox(Number(el.dataset.idx))));
  }
}

function historyHTML(r) {
  const list = txns(r).slice().sort((a, b) => String(b.date || b.ts || "").localeCompare(String(a.date || a.ts || "")));
  const reflected = Number(r.reflected) || 0;
  const sumTx = list.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const base = r2(reflected - sumTx);
  const rows = list.map((t) => `
    <tr>
      <td style="white-space:nowrap">${t.date ? fmtDate(t.date) : "—"}</td>
      <td class="num money-good">+${fmtMoney(t.amount, { currency: false })}</td>
      <td class="cell-remarks">${esc(t.note || "")}</td>
      <td><div class="row-actions"><button class="del" data-deltxn="${esc(t.id)}" title="Delete payment">✕</button></div></td>
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
      <button class="btn head-btn sm" id="recordPayBtn2"><i class="ti ti-cash"></i> Record payment</button>
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

function scheduleHTML(s, r) {
  const dpBar = s.dpTarget ? Math.min(100, Math.round((s.dpPaid / s.dpTarget) * 100)) : 100;
  const paidCount = s.instRows.filter((x) => x.status === "paid").length;
  const partialCount = s.instRows.filter((x) => x.status === "partial").length;

  const cells = s.instRows.map((x) => {
    const pct = s.onePct ? Math.round((x.amount / s.onePct) * 100) / 100 : 1;
    const custom = Math.abs(pct - 1) > 0.001;
    return `<span class="sched-cell ${x.status}${custom ? " custom" : ""}" data-idx="${x.idx}"
      data-tip="Installment ${x.idx + 1} · ${fmtMoney(x.amount)} (${pct}%)<br>${x.status === "paid" ? "Paid" : x.status === "partial" ? "Partly paid " + fmtMoney(x.paid) : "Not yet paid"}<br><span style='opacity:.7'>click to set %</span>">${custom ? pct + "%" : ""}</span>`;
  }).join("");

  const transfer = s.isDp
    ? (s.transferReady
        ? `<button class="btn primary sm sched-transfer" id="transferBtn"><i class="ti ti-arrow-right"></i> Transfer to Installment</button>`
        : `<div class="sched-note"><i class="ti ti-info-circle"></i> Reflected payments go to the 24% downpayment. When it's complete, a <b>Transfer to Installment</b> button appears to start the 1% monthly plan.</div>`)
    : "";

  return `
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
      <span>${s.instCount} installments · 1% = ${fmtMoney(s.onePct)}${s.custom ? ` · <a href="#" id="schedReset">reset</a>` : ""}${s.isDp ? " (starts after transfer)" : ""}</span>
      <span class="sched-legend">
        <span class="sched-cell paid"></span> ${paidCount} paid
        <span class="sched-cell partial"></span> ${partialCount} partial
        <span class="sched-cell due"></span> ${s.instCount - paidCount - partialCount} due
      </span>
    </div>
    <div class="sched-grid ${s.isDp ? "preview" : ""}">${cells || `<span class="muted">No installments.</span>`}</div>`;
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

async function editBox(idx) {
  const { boxes, onePct, balance } = scheduleBoxes(record);
  const cur = Number(boxes[idx]) || onePct;
  const curPct = onePct ? r2(cur / onePct) : 1;
  const res = await promptModal({
    title: `Installment ${idx + 1}`, icon: "ti-percentage",
    sub: `Default 1% = ${fmtMoney(onePct)}`, submitLabel: "Apply",
    fields: [{ key: "pct", label: "Installment size (% of selling price)", type: "number", step: "0.01", min: 0, value: curPct,
      hint: "Boxes after this recalculate so the plan still totals the balance." }],
  });
  if (!res) return;
  const pct = Number(res.pct);
  if (!(pct > 0)) { toast("Enter a valid %"); return; }
  const newAmt = r2(onePct * pct);
  const head = boxes.slice(0, idx).map(Number);
  const rem = Math.max(0, r2(balance - head.reduce((a, b) => a + b, 0) - newAmt));
  const plan = [...head, newAmt, ...genBoxes(rem, onePct)];
  try {
    await db.updateRecord(record.id, { installmentPlan: plan });
    toast(`Installment ${idx + 1} set to ${pct}%`);
    await reloadAndRender();
  } catch (e) { toast("Failed — " + e.message); }
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
