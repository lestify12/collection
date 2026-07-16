/* ============================================================
   Payment-plan model shared by the client & project pages.

   A unit's plan splits into a Downpayment (DP) and a Deferred /
   Construction (DC) portion, collected either as 1% Monthly or on a
   Flexi schedule (custom % per box). The DC% drives the number of
   installment boxes (1% each in monthly mode). Each box can carry a
   month/year and a "no collection" flag.
   ============================================================ */

export const r2 = (n) => Math.round(n * 100) / 100;

/** Parse / derive the plan: DP%, DC%, amounts and mode (monthly|flexi).
    Prefers structured fields, else reads the legacy `paymentPlan` string
    like "20% DP • 80% DC (1% Monthly)" or "20% DP • 90% DC (FLEXI)". */
export function planOf(r) {
  const S = Number(r.sellingPrice) || 0;
  const str = String(r.paymentPlan || "");
  let dpPct = Number(r.dpPct) || 0;
  let dcPct = Number(r.dcPct) || 0;
  let mode = r.planMode || "";
  if (!dpPct) { const m = str.match(/(\d+(?:\.\d+)?)\s*%?\s*DP/i); dpPct = m ? +m[1] : 20; }
  if (!dcPct) { const m = str.match(/(\d+(?:\.\d+)?)\s*%?\s*(?:DC|PH)/i); dcPct = m ? +m[1] : Math.max(0, 100 - dpPct); }
  if (!mode) mode = /cash/i.test(str) ? "cash" : /flex/i.test(str) ? "flexi" : "monthly";
  const onePct = S * 0.01;
  // DP amount = downpayment + DLD + admin (the "Downpayment + DLD + admin" total).
  const dpParts = (Number(r.dp20) || 0) + (Number(r.dld) || 0) + (Number(r.adminFee) || 0);
  const dpAmount = Number(r.dpAmount) || Number(r.dpTotal) || dpParts || r2((dpPct / 100) * S);
  const dcAmount = Number(r.dcAmount) || r2((dcPct / 100) * S);
  return { S, dpPct, dcPct, mode, dpAmount, dcAmount, onePct };
}

/** The number of installment boxes a plan should have (cash = none). */
export function boxCount(r) {
  const p = planOf(r);
  if (p.mode === "cash") return 0;
  if (Array.isArray(r.installmentPlan) && r.installmentPlan.length) return r.installmentPlan.length;
  return Math.max(0, Math.round(p.dcPct));
}

/** True when a Flexi plan has been edited (at least one box changed) but the
    boxes no longer total the DC amount — i.e. the officer needs to fix it.
    An untouched Flexi plan (default 1% boxes) shows no flag. */
export function flexiNeedsSetup(r) {
  const p = planOf(r);
  if (p.mode !== "flexi") return false;
  if (!Array.isArray(r.installmentPlan) || !r.installmentPlan.length) return false;
  const sum = r.installmentPlan.reduce((a, b) => a + (Number(b) || 0), 0);
  return Math.abs(sum - p.dcAmount) > 1;
}

/* ------------------------------------------------ month calendar */
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function parseYM(s) { const [y, m] = String(s).split("-").map(Number); return y && m ? { y, m } : null; }
export function addMonths(ym, n) { const i = ym.y * 12 + (ym.m - 1) + n; return { y: Math.floor(i / 12), m: (i % 12) + 1 }; }
export function ymKey(ym) { return `${ym.y}-${String(ym.m).padStart(2, "0")}`; }
export function fmtYM(ym) { return ym ? `${MONTHS[ym.m - 1]} ${String(ym.y).slice(2)}` : ""; }

/** Compute each box's month label + skip flag from stored `boxMonths`.
    A manually-set box re-anchors the running month; every box (incl. a
    "no collection" one) advances the calendar by one month. */
export function flowMonths(r, count) {
  const bm = Array.isArray(r.boxMonths) ? r.boxMonths : [];
  const out = [];
  let cur = null;
  // seed the calendar from the record's installmentStart unless box 0 is
  // manually set — so setting a start month cascades the whole schedule.
  if (r.installmentStart && !(bm[0] && bm[0].manual)) cur = parseYM(r.installmentStart);
  for (let i = 0; i < count; i++) {
    const b = bm[i];
    if (b && b.manual && b.m) cur = parseYM(b.m);
    if (cur) { out.push({ m: ymKey(cur), label: fmtYM(cur), skip: !!(b && b.skip) }); cur = addMonths(cur, 1); }
    else out.push({ m: null, label: "", skip: !!(b && b.skip) });
  }
  return out;
}

/* ------------------------------------------------ per-month overdue
   These power the dashboard's month filter. They need each installment's
   month + amount, which come from the SOA breakdown (or the default 1%
   plan). Records with no schedule (cash / no price) contribute nothing —
   hence the "complete the SOA breakdown" note for accurate figures. */

/** The per-box installment amounts (custom SOA plan, or default 1% boxes). */
export function boxAmounts(r) {
  const p = planOf(r);
  if (p.mode === "cash") return [];
  if (Array.isArray(r.installmentPlan) && r.installmentPlan.length) return r.installmentPlan.map(Number);
  const n = Math.max(0, Math.round(p.dcPct));
  return Array(n).fill(r2(p.onePct));
}

/** The 24% downpayment target = DP + DLD + Admin (falls back to a 24% estimate).
    This money is collected before the installments, so it must be removed from
    `reflected` before the remainder is spread across the boxes. */
export function dpTargetOf(r) {
  const S = Number(r.sellingPrice) || 0;
  const parts = (Number(r.dp20) || 0) + (Number(r.dld) || 0) + (Number(r.adminFee) || 0);
  return Number(r.dpTotal) || parts || r2(0.24 * S);
}

/** Each installment as { idx, mkey:'YYYY-MM'|null, amount, paid, due, skip },
    with the reflected amount (net of the downpayment) filled into the boxes in
    month order. */
export function scheduleRows(r) {
  const amounts = boxAmounts(r);
  if (!amounts.length) return [];
  const months = flowMonths(r, amounts.length);
  let left = Math.max(0, (Number(r.reflected) || 0) - dpTargetOf(r));
  return amounts.map((amt, i) => {
    const skip = !!(months[i] && months[i].skip);
    const paid = skip ? 0 : Math.max(0, Math.min(left, amt));
    if (!skip) left -= paid;
    return { idx: i, mkey: months[i] ? months[i].m : null, amount: amt, paid, skip, due: Math.max(0, r2(amt - paid)) };
  });
}

/** Total money still owed on a unit, derived from its plan: the downpayment
    still outstanding plus every unpaid installment. Cash plans owe price minus
    paid; a 24% DP client (still in the downpayment phase) owes only the DP.
    Returns null when there's no basis to compute (no price, or a category with
    no payment plan such as legal/dnc/cancelled) — the caller keeps the stored
    figure in that case. */
export function outstandingOf(r) {
  const S = Number(r.sellingPrice) || 0;
  if (!S) return null;
  const cat = r.category;
  if (cat && cat !== "dp24" && cat !== "installment") return null;   // plan-based cats only
  const R = Number(r.reflected) || 0;
  const p = planOf(r);
  if (p.mode === "cash") return Math.max(0, r2(S - R));
  const D = dpTargetOf(r);
  const dpRemaining = Math.max(0, r2(D - R));                        // reflected covers the DP first
  if (cat === "dp24") return dpRemaining;                            // installments haven't started
  const instRemaining = scheduleRows(r).reduce((s, row) => s + (row.skip ? 0 : row.due), 0);
  return Math.max(0, r2(dpRemaining + instRemaining));
}

/** The outstanding figure to show/aggregate: the stored value when it's been
    entered, otherwise the plan-derived amount — so a blank due auto-fills for
    downpayment/installment units instead of reading as zero. */
export function dueOf(r) {
  const stored = Number(r.outstanding) || 0;
  if (stored > 0) return stored;
  const computed = outstandingOf(r);
  return computed == null ? stored : computed;
}

/** Unpaid installments due on/before `cutoffKey` ('YYYY-MM'). */
export function overdueAsOf(r, cutoffKey) {
  let sum = 0;
  for (const row of scheduleRows(r)) if (row.mkey && !row.skip && row.mkey <= cutoffKey) sum += row.due;
  return r2(sum);
}

/** Unpaid installments due within [fromKey, toKey] inclusive. */
export function dueInRange(r, fromKey, toKey) {
  let sum = 0;
  for (const row of scheduleRows(r)) if (row.mkey && !row.skip && row.mkey >= fromKey && row.mkey <= toKey) sum += row.due;
  return r2(sum);
}
