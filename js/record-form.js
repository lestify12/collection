/* ============================================================
   Shared record editor — a modal form used by the project page
   and the client detail page. Injects its own markup so pages
   don't need to include it.
   ============================================================ */
import * as db from "./db.js";
import { esc, toast, catByKey } from "./ui.js";

export const FIELDS = {
  unitNo:             { label: "Unit No",             type: "text", required: true },
  bookingDate:        { label: "Booking date",        type: "date" },
  agent:              { label: "Internal agent",      type: "text" },
  type:               { label: "Unit type",           type: "text", placeholder: "Studio / 1BHK / 2BHK" },
  buyerName:          { label: "Buyer name",          type: "text" },
  paymentPlan:        { label: "Payment plan",        type: "text", placeholder: "e.g. 20% DP • 80% DC (1% Monthly)" },
  sellingPrice:       { label: "Selling price",       type: "number" },
  dld:                { label: "DLD (4%)",            type: "number" },
  adminFee:           { label: "Admin fee",           type: "number" },
  dp20:               { label: "20% downpayment",     type: "number" },
  dpTotal:            { label: "DP + DLD + admin",    type: "number" },
  reflected:          { label: "Reflected (paid)",    type: "number" },
  monthlyInstallment: { label: "Monthly installment", type: "number" },
  outstanding:        { label: "Outstanding dues",    type: "number" },
  unsettledMonths:    { label: "Unsettled months",    type: "text" },
  remarks:            { label: "Remarks",             type: "textarea", full: true },
};

const COMMON = ["unitNo", "bookingDate", "agent", "type", "buyerName", "paymentPlan",
                "sellingPrice", "dld", "adminFee", "dp20", "dpTotal", "reflected"];

export const SCHEMAS = {
  dp24:        [...COMMON, "outstanding", "remarks"],
  installment: [...COMMON, "monthlyInstallment", "outstanding", "unsettledMonths", "remarks"],
  legal:       [...COMMON, "monthlyInstallment", "outstanding", "unsettledMonths", "remarks"],
  dnc:         [...COMMON, "outstanding", "remarks"],
  cancelled:   [...COMMON, "outstanding", "remarks"],
  others:      [...COMMON, "monthlyInstallment", "outstanding", "unsettledMonths", "remarks"],
  available:   ["unitNo", "type", "sellingPrice", "remarks"],
};

let backdrop = null, form = null, ctx = null;

function ensure() {
  if (backdrop) return;
  backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-header">
        <div class="modal-header-left">
          <div class="modal-header-icon"><i class="ti ti-clipboard-plus" id="rfIcon"></i></div>
          <div style="min-width:0">
            <div class="modal-header-title" id="rfTitle">Add record</div>
            <div class="modal-header-sub" id="rfSub"></div>
          </div>
        </div>
        <button type="button" class="modal-close" id="rfClose" aria-label="Close"><i class="ti ti-x"></i></button>
      </div>
      <form id="rfForm">
        <div class="modal-body"><div class="form-grid" id="rfGrid"></div></div>
        <div class="modal-actions">
          <button type="button" class="btn" id="rfCancel">Cancel</button>
          <button type="submit" class="btn primary" id="rfSave">Save record</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(backdrop);
  form = backdrop.querySelector("#rfForm");
  backdrop.querySelector("#rfCancel").addEventListener("click", close);
  backdrop.querySelector("#rfClose").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  form.addEventListener("submit", submit);
}

function close() { backdrop.classList.remove("open"); ctx = null; }

/** opts: { category, record?, projectId, projectName, onSaved } */
export function openRecordForm(opts) {
  ensure();
  ctx = opts;
  const cat = catByKey[opts.category];
  const rec = opts.record || null;
  backdrop.querySelector("#rfIcon").className = rec ? "ti ti-pencil" : "ti ti-clipboard-plus";
  backdrop.querySelector("#rfTitle").textContent =
    rec ? `Edit ${rec.unitNo} — ${cat.label}` : `Add record — ${cat.label}`;
  backdrop.querySelector("#rfSub").textContent =
    `${opts.projectName || ""}${db.LIVE ? "" : " · local mode: saved in this browser only"}`;

  backdrop.querySelector("#rfGrid").innerHTML = SCHEMAS[opts.category].map((k) => {
    const f = FIELDS[k];
    const val = rec?.[k] ?? "";
    const common = `id="rf_${k}" name="${k}" ${f.required ? "required" : ""} placeholder="${esc(f.placeholder || "")}"`;
    let input;
    if (f.type === "textarea") input = `<textarea ${common}>${esc(val)}</textarea>`;
    else if (f.type === "number") input = `<input type="number" step="0.01" inputmode="decimal" ${common} value="${val ?? ""}">`;
    else input = `<input type="${f.type}" ${common} value="${esc(val)}">`;
    return `<div class="field ${f.full ? "full" : ""}"><label for="rf_${k}">${esc(f.label)}</label>${input}</div>`;
  }).join("");

  const price = backdrop.querySelector("#rf_sellingPrice");
  price?.addEventListener("change", () => {
    const p = Number(price.value); if (!p) return;
    const set = (id, v) => { const el = backdrop.querySelector("#" + id); if (el && el.value === "") el.value = v; };
    set("rf_dld", (p * 0.04).toFixed(2));
    set("rf_dp20", (p * 0.2).toFixed(2));
    const dld = Number(backdrop.querySelector("#rf_dld")?.value) || 0;
    const dp = Number(backdrop.querySelector("#rf_dp20")?.value) || 0;
    const adm = Number(backdrop.querySelector("#rf_adminFee")?.value) || 0;
    set("rf_dpTotal", (dld + dp + adm).toFixed(2));
  });

  backdrop.classList.add("open");
  setTimeout(() => backdrop.querySelector("#rf_unitNo")?.focus(), 220);
}

async function submit(e) {
  e.preventDefault();
  const btn = backdrop.querySelector("#rfSave");
  btn.disabled = true;
  const rec = ctx.record || null;
  const data = { projectId: ctx.projectId, category: ctx.category };
  for (const k of SCHEMAS[ctx.category]) {
    const el = backdrop.querySelector("#rf_" + k);
    let v = el.value.trim();
    if (FIELDS[k].type === "number") v = v === "" ? null : Number(v);
    data[k] = v;
  }
  const onSaved = ctx.onSaved;
  try {
    if (rec) { await db.updateRecord(rec.id, data); toast(`Record ${data.unitNo} updated`); }
    else { await db.addRecord(data); toast(`Record ${data.unitNo} added`); }
    close();
    if (onSaved) await onSaved();
  } catch (err) {
    console.error(err); toast("Save failed — " + err.message);
  } finally { btn.disabled = false; }
}
