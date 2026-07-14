/* ============================================================
   Import all — read a multi-tab Excel/CSV workbook and route each
   sheet's rows into the matching category for the current project.
   Uses the vendored SheetJS parser (lazy-loaded on first use).
   ============================================================ */
import * as db from "./db.js";
import { CATS, catByKey, esc, fmtInt, toast } from "./ui.js";

let xlsxPromise = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsxPromise) xlsxPromise = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "js/vendor/xlsx.full.min.js";
    s.onload = () => res(window.XLSX);
    s.onerror = () => rej(new Error("Could not load the Excel parser."));
    document.head.appendChild(s);
  });
  return xlsxPromise;
}

/* ---- value + header helpers (ported from the workbook extractor) ---- */
const norm = (h) => String(h == null ? "" : h).replace(/\s+/g, " ").trim().toLowerCase();
const UNIT_RE = /^[A-Za-z]{0,2}\d{2,4}[A-Za-z]?$/;

function num(v) {
  if (v == null) return null;
  if (typeof v === "number") return Math.round(v * 100) / 100;
  const s = String(v).replace(/ /g, " ").trim().replace(/,/g, "");
  if (s === "" || s === "-") return null;
  const f = parseFloat(s);
  return isNaN(f) ? null : Math.round(f * 100) / 100;
}
function txt(v) {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).replace(/ /g, " ").trim();
  return s === "-" ? "" : s;
}

function matchField(h) {
  const n = norm(h);
  if (["unit no", "unit", "unit no."].includes(n)) return "unitNo";
  if (n.includes("booking")) return "bookingDate";
  if (n.includes("internal") && n.includes("agent")) return "agent";
  if (n === "internal agent") return "agent";
  if (n === "type") return "type";
  if (n.includes("buyer")) return "buyerName";
  if (n.includes("payment plan")) return "paymentPlan";
  if (["selling price", "unit price"].includes(n)) return "sellingPrice";
  if (n === "dld" || n === "dld fees" || n.startsWith("dld")) return "dld";
  // "Down Payment + DLD (& Admin)" is the downpayment total — check it BEFORE
  // the plain "admin fee" rule, otherwise it gets misread as the admin fee.
  if (n.includes("downpayment + dld") || n.includes("down payment + dld") || n.includes("total 20% and dld") || n.includes("dp + dld")) return "dpTotal";
  if (n.includes("admin fee")) return "adminFee";
  if (n.includes("20% dp") || n.includes("20% down payment") || n.includes("20% downpayment")) return "dp20";
  if (n.includes("reflected") || n.includes("total amount paid")) return "reflected";
  if (n.includes("monthly installment")) return "monthlyInstallment";
  if (n.includes("how many months") || n.includes("unsettled")) return "unsettledMonths";
  if (n.includes("remarks")) return "remarks";
  return null;
}

const OUT_PATTERNS = ["outstanding", "balance payment as of now", "balance payment as of",
  "balance receivable", "24% balance", "total balance payable", "total due as on", "total due", "receivable"];
function outColIndex(header) {
  for (const pat of OUT_PATTERNS) {
    const idx = header.findIndex((h) => norm(h).includes(pat));
    if (idx >= 0) return idx;
  }
  return -1;
}

function sheetCategory(name) {
  const n = norm(name);
  if (n.includes("24") || n.includes("downpay") || n === "dp" || n.includes(" dp")) return "dp24";
  if (n.includes("install")) return "installment";
  if (n.includes("legal")) return "legal";
  if (n.includes("dnc") || n.includes("do not call")) return "dnc";
  if (n.includes("cancel")) return "cancelled";
  if (n.includes("avail")) return "available";
  if (n.includes("other")) return "others";
  return null;   // summary / unknown sheets are skipped
}

function unitCol(header, data) {
  const byName = header.findIndex((h) => ["unit", "unit no", "unit no."].includes(norm(h)));
  if (byName >= 0) return byName;
  let best = -1, score = 0;
  const nc = Math.max(0, ...data.slice(0, 25).map((r) => r.length));
  for (let j = 0; j < nc; j++) {
    const s = data.slice(0, 25).filter((r) => UNIT_RE.test(txt(r[j]))).length;
    if (s > score) { score = s; best = j; }
  }
  return best;
}

function extractRows(aoa, cat, projectId) {
  let hi = -1, header = null;
  for (let i = 0; i < Math.min(10, aoa.length); i++) {
    const fields = (aoa[i] || []).map(matchField);
    if (fields.includes("unitNo") && (fields.includes("buyerName") || fields.includes("sellingPrice"))) { hi = i; header = aoa[i]; break; }
  }
  if (hi < 0) for (let i = 0; i < Math.min(10, aoa.length); i++) {
    if ((aoa[i] || []).map(matchField).includes("unitNo")) { hi = i; header = aoa[i]; break; }
  }
  if (hi < 0) return [];

  const col = {};
  header.forEach((h, idx) => { const f = matchField(h); if (f && !(f in col)) col[f] = idx; });
  const data = aoa.slice(hi + 1);
  const ucol = "unitNo" in col ? col.unitNo : unitCol(header, data);
  if (ucol < 0) return [];
  const ocol = outColIndex(header);

  const out = [];
  for (const r of data) {
    const u = txt(r[ucol]);
    if (!u || ["unit", "unit no", "total", "total amount", "grand total"].includes(norm(u))) continue;
    const g = (f) => (f in col && col[f] < r.length ? r[col[f]] : null);
    out.push({
      unitNo: u, bookingDate: txt(g("bookingDate")), agent: txt(g("agent")), type: txt(g("type")),
      buyerName: txt(g("buyerName")), paymentPlan: txt(g("paymentPlan")), sellingPrice: num(g("sellingPrice")),
      dld: num(g("dld")), adminFee: num(g("adminFee")), dp20: num(g("dp20")), dpTotal: num(g("dpTotal")),
      reflected: num(g("reflected")), monthlyInstallment: num(g("monthlyInstallment")),
      outstanding: ocol >= 0 && ocol < r.length ? num(r[ocol]) : null,
      unsettledMonths: txt(g("unsettledMonths")), remarks: txt(g("remarks")),
      projectId, category: cat,
    });
  }
  return out;
}

/* ---- public entry ---- */
export async function importWorkbook(file, project, onDone) {
  const XLSX = await loadXLSX();
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });

  const parsed = {};   // category -> rows[]
  const skipped = [];
  for (const name of wb.SheetNames) {
    const cat = sheetCategory(name);
    if (!cat) { skipped.push(name); continue; }
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, defval: null });
    const rows = extractRows(aoa, cat, project.id);
    if (rows.length) (parsed[cat] ||= []).push(...rows);
  }
  showPreview(parsed, skipped, file.name, project, onDone);
}

/* ---- preview + confirm modal ---- */
let backdrop = null;
function ensure() {
  if (backdrop) return;
  backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  document.body.appendChild(backdrop);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.classList.remove("open"); });
}

function showPreview(parsed, skipped, fileName, project, onDone) {
  ensure();
  const cats = CATS.filter((c) => parsed[c.key]?.length);
  const total = cats.reduce((s, c) => s + parsed[c.key].length, 0);

  const rows = cats.map((c) => `
    <div class="imp-row">
      <span class="cat-dot" style="background:${c.color}"></span>
      <span>${esc(c.label)}</span>
      <span class="imp-count">${fmtInt(parsed[c.key].length)} rows</span>
    </div>`).join("");

  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-header">
        <div class="modal-header-left">
          <div class="modal-header-icon"><i class="ti ti-file-import"></i></div>
          <div style="min-width:0">
            <div class="modal-header-title">Import — ${esc(project.name)}</div>
            <div class="modal-header-sub">${esc(fileName)}${db.LIVE ? "" : " · local mode"}</div>
          </div>
        </div>
        <button type="button" class="modal-close" id="impClose" aria-label="Close"><i class="ti ti-x"></i></button>
      </div>
      <div class="modal-body">
        ${total ? `<div class="imp-lead">Found <b>${fmtInt(total)}</b> records across ${cats.length} categor${cats.length === 1 ? "y" : "ies"}:</div>${rows}`
          : `<div class="empty" style="padding:14px"><div class="e-icon">🤔</div>
          <div class="e-title">No recognizable category tabs</div>
          <div class="e-sub">Name the sheets like 24% Due, Installment, Legal, DNC, Cancelled, Available.</div></div>`}
        ${skipped.length ? `<div class="imp-skip"><i class="ti ti-info-circle"></i> Skipped sheets: ${skipped.map(esc).join(", ")}</div>` : ""}
        ${total ? `<label class="imp-replace"><input type="checkbox" id="impReplace" checked>
          Replace existing data in these categories first (avoids duplicates)</label>` : ""}
      </div>
      <div class="modal-actions">
        <button type="button" class="btn" id="impCancel">Cancel</button>
        ${total ? `<button type="button" class="btn primary" id="impGo">Import ${fmtInt(total)} records</button>` : ""}
      </div>
    </div>`;
  backdrop.classList.add("open");
  backdrop.querySelector("#impCancel").addEventListener("click", () => backdrop.classList.remove("open"));
  backdrop.querySelector("#impClose").addEventListener("click", () => backdrop.classList.remove("open"));

  backdrop.querySelector("#impGo")?.addEventListener("click", async () => {
    const go = backdrop.querySelector("#impGo");
    const replace = backdrop.querySelector("#impReplace").checked;
    go.disabled = true; go.textContent = "Importing…";
    try {
      if (replace) for (const c of cats) await db.deleteCategoryRecords(project.id, c.key);
      const all = cats.flatMap((c) => parsed[c.key]);
      const n = await db.addRecordsBulk(all);
      backdrop.classList.remove("open");
      toast(`Imported ${n} records into ${project.name}`);
      if (onDone) await onDone();
    } catch (e) {
      console.error(e); toast("Import failed — " + e.message);
      go.disabled = false; go.textContent = "Retry import";
    }
  });
}
