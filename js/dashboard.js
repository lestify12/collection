/* ============================================================
   Analytics dashboard (boss view) — all-projects summary.
   ============================================================ */
import * as db from "./db.js";
import {
  CATS, catByKey, esc, fmtMoney, fmtInt, renderNav, initTheme, initSidebar,
  setModeBadge, observeReveals, countUp, attachTips, toast,
} from "./ui.js";

initTheme();
initSidebar();

const DUE_CATS = CATS.filter((c) => c.due);

async function main() {
  let data;
  try {
    data = await db.loadAll();
  } catch (e) {
    console.error(e);
    document.getElementById("dashboard").innerHTML =
      `<div class="card"><div class="empty"><div class="e-icon">⚠️</div>
       <div class="e-title">Could not load data</div>
       <div class="e-sub">${esc(e.message)}</div></div></div>`;
    return;
  }

  const { summary, records } = data;
  setModeBadge(db.LIVE);
  renderNav(summary.projects, null);

  document.getElementById("reportDate").textContent =
    `Report date ${summary.reportDate || ""} · ${summary.projects.length} projects`;

  // per-project metrics: live from unit records where present, else the seeded workbook figures
  const rows = summary.projects.map((p) => ({ ...p, m: db.projectMetrics(p, records) }));

  const tot = { totalDue: 0, totalUnits: 0, unsoldUnits: 0, projectUnits: 0 };
  const catTot = {};
  for (const c of DUE_CATS) catTot[c.key] = { clients: 0, due: 0 };
  for (const r of rows) {
    tot.totalDue += r.m.totalDue || 0;
    tot.totalUnits += r.m.totalUnits || 0;
    tot.unsoldUnits += r.m.unsoldUnits || 0;
    tot.projectUnits += r.m.projectUnits || 0;
    for (const c of DUE_CATS) {
      catTot[c.key].clients += r.m[c.key]?.clients || 0;
      catTot[c.key].due += r.m[c.key]?.due || 0;
    }
  }

  render(rows, tot, catTot, summary);
}

function legendHTML() {
  return `<div class="legend">${DUE_CATS.map((c) =>
    `<span class="key"><span class="swatch" style="background:${c.color}"></span>${esc(c.short)}</span>`).join("")}</div>`;
}

function stackTip(name, m) {
  const rowsHtml = DUE_CATS.map((c) => `
    <div class="t-row"><span class="swatch" style="width:8px;height:8px;border-radius:2px;background:${c.color}"></span>
      <span>${esc(c.short)}</span><span class="v">${fmtMoney(m[c.key]?.due || 0, { compact: true })}</span></div>`).join("");
  return `<div class="t-title">${esc(name)}</div>${rowsHtml}
    <div class="t-row" style="margin-top:4px;border-top:1px solid var(--grid);padding-top:4px">
      <span>Total</span><span class="v">${fmtMoney(m.totalDue, { compact: true })}</span></div>`;
}

function render(rows, tot, catTot, summary) {
  const el = document.getElementById("dashboard");
  const maxDue = Math.max(...rows.map((r) => r.m.totalDue || 0), 1);
  const byDue = [...rows].sort((a, b) => (b.m.totalDue || 0) - (a.m.totalDue || 0));

  el.innerHTML = `
    <!-- KPI row -->
    <div class="kpi-row">
      <div class="kpi hero reveal" style="--d:0s"><span class="kpi-accent"></span>
        <div class="kpi-label">Total outstanding</div>
        <div class="kpi-value" id="kpiDue">0</div>
        <div class="kpi-foot">across ${rows.length} projects</div>
      </div>
      <div class="kpi reveal" style="--d:.06s;--kpi-c:var(--cat-legal)">
        <span class="kpi-accent"></span>
        <div class="kpi-label">Units with dues</div>
        <div class="kpi-value" id="kpiUnits">0</div>
        <div class="kpi-foot">of ${fmtInt(tot.projectUnits)} total units</div>
      </div>
      <div class="kpi reveal" style="--d:.12s;--kpi-c:var(--cat-dnc)">
        <span class="kpi-accent"></span>
        <div class="kpi-label">Legal case exposure</div>
        <div class="kpi-value" id="kpiLegal">0</div>
        <div class="kpi-foot">${fmtInt(catTot.legal.clients)} cases</div>
      </div>
      <div class="kpi reveal" style="--d:.18s;--kpi-c:var(--cat-cancelled)">
        <span class="kpi-accent"></span>
        <div class="kpi-label">Unsold units</div>
        <div class="kpi-value" id="kpiUnsold">0</div>
        <div class="kpi-foot">available / hold / blocked</div>
      </div>
    </div>

    <!-- Outstanding by project -->
    <section class="card section reveal">
      <h2>Outstanding by project</h2>
      <div class="card-sub">Total dues split by category — hover a bar for the breakdown, click a name to open the project</div>
      ${legendHTML()}
      <div class="hbar-chart baseline-rule" style="padding-left:10px" id="projChart">
        ${byDue.map((r) => `
          <div class="hbar-row">
            <div class="hbar-name"><a href="project.html?id=${encodeURIComponent(r.id)}">${esc(r.name)}</a></div>
            <div class="hbar-track">
              <div class="hbar-stack" data-w="${((r.m.totalDue || 0) / maxDue * 100).toFixed(2)}"
                   data-tip='${stackTip(r.name, r.m).replace(/'/g, "&#39;")}'>
                ${DUE_CATS.map((c) => {
                  const v = r.m[c.key]?.due || 0;
                  if (!v) return "";
                  return `<span class="hbar-seg" style="flex:${v} ${v} 0;background:${c.color}"></span>`;
                }).join("")}
              </div>
            </div>
            <div class="hbar-val">${fmtMoney(r.m.totalDue, { compact: true })}</div>
          </div>`).join("")}
      </div>
    </section>

    <!-- Portfolio composition -->
    <section class="card section reveal">
      <h2>Portfolio dues composition</h2>
      <div class="card-sub">Where the ${fmtMoney(tot.totalDue, { compact: true })} outstanding sits</div>
      <div class="comp-bar" id="compBar">
        ${DUE_CATS.map((c) => `
          <span class="comp-seg" style="flex:${catTot[c.key].due} ${catTot[c.key].due} 0;background:${c.color};transition-delay:${DUE_CATS.indexOf(c) * 0.07}s"
            data-tip='<div class="t-title">${esc(c.label)}</div>
              <div class="t-row"><span>Outstanding</span><span class="v">${fmtMoney(catTot[c.key].due, { compact: true })}</span></div>
              <div class="t-row"><span>Clients</span><span class="v">${fmtInt(catTot[c.key].clients)}</span></div>'></span>`).join("")}
      </div>
      <div class="comp-labels">
        ${DUE_CATS.map((c) => `
          <div class="comp-label">
            <span class="swatch" style="background:${c.color}"></span>
            <span class="n">${esc(c.short)} · ${fmtInt(catTot[c.key].clients)} clients</span>
            <span class="v">${fmtMoney(catTot[c.key].due, { compact: true })}</span>
          </div>`).join("")}
      </div>
    </section>

    <!-- Full summary table -->
    <section class="card section reveal">
      <h2>Project summary table</h2>
      <div class="card-sub">${esc(summary.target || "")}</div>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Project</th>
              <th class="num">24% clients</th><th class="num">24% due</th>
              <th class="num">Inst. clients</th><th class="num">Installment due</th>
              <th class="num">Legal</th><th class="num">Legal due</th>
              <th class="num">DNC</th><th class="num">DNC due</th>
              <th class="num">Cancelled</th><th class="num">Cancelled due</th>
              <th class="num">Units w/ dues</th><th class="num">Total due</th>
              <th class="num">Unsold</th><th class="num">Total units</th>
              <th>Updated by</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) => `
              <tr class="clickable" data-href="project.html?id=${encodeURIComponent(r.id)}">
                <td class="strong">${esc(r.name)}${r.m.source === "records" ? ' <span title="Computed live from client-wise records" style="color:var(--good)">●</span>' : ""}</td>
                <td class="num">${fmtInt(r.m.dp24?.clients)}</td><td class="num">${fmtMoney(r.m.dp24?.due, { currency: false })}</td>
                <td class="num">${fmtInt(r.m.installment?.clients)}</td><td class="num">${fmtMoney(r.m.installment?.due, { currency: false })}</td>
                <td class="num">${fmtInt(r.m.legal?.clients)}</td><td class="num">${fmtMoney(r.m.legal?.due, { currency: false })}</td>
                <td class="num">${fmtInt(r.m.dnc?.clients)}</td><td class="num">${fmtMoney(r.m.dnc?.due, { currency: false })}</td>
                <td class="num">${fmtInt(r.m.cancelled?.clients)}</td><td class="num">${fmtMoney(r.m.cancelled?.due, { currency: false })}</td>
                <td class="num">${fmtInt(r.m.totalUnits)}</td>
                <td class="num strong">${fmtMoney(r.m.totalDue, { currency: false })}</td>
                <td class="num">${fmtInt(r.m.unsoldUnits)}</td>
                <td class="num">${fmtInt(r.m.projectUnits)}</td>
                <td style="white-space:nowrap">${esc(r.handler || "")}</td>
              </tr>`).join("")}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td class="num">${fmtInt(sum(rows, "dp24", "clients"))}</td><td class="num">${fmtMoney(sum(rows, "dp24", "due"), { currency: false })}</td>
              <td class="num">${fmtInt(sum(rows, "installment", "clients"))}</td><td class="num">${fmtMoney(sum(rows, "installment", "due"), { currency: false })}</td>
              <td class="num">${fmtInt(sum(rows, "legal", "clients"))}</td><td class="num">${fmtMoney(sum(rows, "legal", "due"), { currency: false })}</td>
              <td class="num">${fmtInt(sum(rows, "dnc", "clients"))}</td><td class="num">${fmtMoney(sum(rows, "dnc", "due"), { currency: false })}</td>
              <td class="num">${fmtInt(sum(rows, "cancelled", "clients"))}</td><td class="num">${fmtMoney(sum(rows, "cancelled", "due"), { currency: false })}</td>
              <td class="num">${fmtInt(tot.totalUnits)}</td>
              <td class="num">${fmtMoney(tot.totalDue, { currency: false })}</td>
              <td class="num">${fmtInt(tot.unsoldUnits)}</td>
              <td class="num">${fmtInt(tot.projectUnits)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>`;

  // KPI count-ups
  countUp(document.getElementById("kpiDue"), tot.totalDue, { money: true });
  countUp(document.getElementById("kpiUnits"), tot.totalUnits);
  countUp(document.getElementById("kpiLegal"), catTot.legal.due, { money: true });
  countUp(document.getElementById("kpiUnsold"), tot.unsoldUnits);

  // animate bars in after mount
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.querySelectorAll(".hbar-stack").forEach((b) => {
      b.style.setProperty("--w", b.dataset.w + "%");
      b.style.width = b.dataset.w + "%";
    });
    document.getElementById("compBar")?.classList.add("in");
  }));

  // clickable table rows
  el.querySelectorAll("tr.clickable").forEach((tr) =>
    tr.addEventListener("click", () => (location.href = tr.dataset.href)));

  observeReveals();
  attachTips(el);
}

function sum(rows, cat, field) {
  return rows.reduce((s, r) => s + (r.m[cat]?.[field] || 0), 0);
}

main().catch((e) => { console.error(e); toast("Something went wrong loading the dashboard"); });
