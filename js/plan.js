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
