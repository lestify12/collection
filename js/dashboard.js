/* ============================================================
   Analytics dashboard (boss view) — all-projects summary.
   ============================================================ */
import * as db from "./db.js";
import {
  CATS, catByKey, esc, fmtMoney, fmtInt, renderNav, initTheme, initSidebar,
  setModeBadge, observeReveals, countUp, attachTips, toast, visibleProjects,
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
  const projects = visibleProjects(summary.projects);
  renderNav(projects, null);

  document.getElementById("reportDate").textContent =
    `Report date ${summary.reportDate || ""} · ${projects.length} project${projects.length === 1 ? "" : "s"}`;

  // per-project metrics: live from unit records where present, else the seeded workbook figures
  const rows = projects.map((p) => ({ ...p, m: db.projectMetrics(p, records) }));

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
  const inst = catTot.installment;                          // the focus of this dashboard
  const instShare = tot.totalDue ? Math.round((inst.due / tot.totalDue) * 100) : 0;

  // rank projects by installment outstanding (the metric that matters most here)
  const byInst = [...rows].sort((a, b) => (b.m.installment?.due || 0) - (a.m.installment?.due || 0));
  const maxInst = Math.max(...byInst.map((r) => r.m.installment?.due || 0), 1);

  const cats = DUE_CATS.map((c) => ({ ...c, due: catTot[c.key].due, clients: catTot[c.key].clients }))
    .sort((a, b) => b.due - a.due);
  const maxCat = Math.max(...cats.map((c) => c.due), 1);

  el.innerHTML = `
    <section class="hero-card reveal">
      <div class="hero-main">
        <div class="hero-icon"><i class="ti ti-calendar-repeat"></i></div>
        <div>
          <div class="hero-label">Installment outstanding</div>
          <div class="hero-value" id="kpiInst">0</div>
          <div class="hero-foot">${fmtInt(inst.clients)} account${inst.clients === 1 ? "" : "s"} on 1% monthly · ${instShare}% of all outstanding</div>
        </div>
      </div>
      <div class="hero-meter"><div class="hero-meter-fill" data-w="${instShare}"></div></div>
    </section>

    <div class="stat-grid">
      <div class="stat-card reveal"><div class="stat-icon green"><i class="ti ti-report-money"></i></div>
        <div><div class="stat-value" id="kpiDue">0</div><div class="stat-label">Total outstanding</div>
        <div class="stat-foot">all categories · ${rows.length} project${rows.length === 1 ? "" : "s"}</div></div></div>
      <div class="stat-card reveal"><div class="stat-icon navy"><i class="ti ti-users-group"></i></div>
        <div><div class="stat-value" id="kpiUnits">0</div><div class="stat-label">Units with dues</div>
        <div class="stat-foot">of ${fmtInt(tot.projectUnits)} total units</div></div></div>
      <div class="stat-card reveal"><div class="stat-icon red"><i class="ti ti-gavel"></i></div>
        <div><div class="stat-value" id="kpiLegal">0</div><div class="stat-label">Legal exposure</div>
        <div class="stat-foot">${fmtInt(catTot.legal.clients)} legal cases</div></div></div>
      <div class="stat-card reveal"><div class="stat-icon amber"><i class="ti ti-home"></i></div>
        <div><div class="stat-value" id="kpiUnsold">0</div><div class="stat-label">Unsold units</div>
        <div class="stat-foot">available / hold / blocked</div></div></div>
    </div>

    <section class="card section reveal">
      <h2>Installment outstanding by project</h2>
      <div class="card-sub">1% monthly collection to chase, largest first — click to open</div>
      <div class="simple-bars">
        ${byInst.map((r) => `
          <a class="sbar-row" href="project.html?id=${encodeURIComponent(r.id)}">
            <div class="sbar-name">${esc(r.name)}</div>
            <div class="sbar-track"><div class="sbar-fill" data-w="${((r.m.installment?.due || 0) / maxInst * 100).toFixed(1)}"></div></div>
            <div class="sbar-val">${fmtMoney(r.m.installment?.due || 0, { compact: true })}<span class="sbar-sub"> · ${fmtInt(r.m.installment?.clients || 0)}</span></div>
          </a>`).join("")}
      </div>
    </section>

    <section class="card section reveal">
      <h2>Outstanding by category</h2>
      <div class="card-sub">Where the ${fmtMoney(tot.totalDue, { compact: true })} to collect sits</div>
      <div class="simple-bars">
        ${cats.map((c) => `
          <div class="sbar-row${c.key === "installment" ? " focus" : ""}">
            <div class="sbar-name"><span class="cat-dot" style="background:${c.color}"></span>${esc(c.label)}</div>
            <div class="sbar-track"><div class="sbar-fill" data-w="${(c.due / maxCat * 100).toFixed(1)}" style="background:${c.color}"></div></div>
            <div class="sbar-val">${fmtMoney(c.due, { compact: true })}<span class="sbar-sub"> · ${fmtInt(c.clients)}</span></div>
          </div>`).join("")}
      </div>
    </section>

    <section class="card section reveal">
      <h2>Projects</h2>
      <div class="card-sub">${esc(summary.target || "")}</div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Project</th><th>Assigned to</th><th class="num">Installment due</th><th class="num">Total outstanding</th><th></th></tr></thead>
          <tbody>
            ${byInst.map((r) => `
              <tr class="clickable" data-href="project.html?id=${encodeURIComponent(r.id)}">
                <td class="strong">${esc(r.name)}</td>
                <td style="white-space:nowrap;color:var(--ink-2)">${esc(r.handler || "—")}</td>
                <td class="num strong">${fmtMoney(r.m.installment?.due || 0, { currency: false })}</td>
                <td class="num">${fmtMoney(r.m.totalDue, { currency: false })}</td>
                <td class="num"><i class="ti ti-chevron-right" style="color:var(--ink-3)"></i></td>
              </tr>`).join("")}
          </tbody>
          <tfoot><tr>
            <td>Total</td><td></td>
            <td class="num strong">${fmtMoney(inst.due, { currency: false })}</td>
            <td class="num">${fmtMoney(tot.totalDue, { currency: false })}</td><td></td>
          </tr></tfoot>
        </table>
      </div>
    </section>`;

  countUp(document.getElementById("kpiInst"), inst.due, { money: true });
  countUp(document.getElementById("kpiDue"), tot.totalDue, { money: true });
  countUp(document.getElementById("kpiUnits"), tot.totalUnits);
  countUp(document.getElementById("kpiLegal"), catTot.legal.due, { money: true });
  countUp(document.getElementById("kpiUnsold"), tot.unsoldUnits);

  requestAnimationFrame(() => requestAnimationFrame(() =>
    el.querySelectorAll(".sbar-fill, .hero-meter-fill").forEach((f) => { f.style.width = f.dataset.w + "%"; })));

  el.querySelectorAll("tr.clickable").forEach((tr) =>
    tr.addEventListener("click", () => (location.href = tr.dataset.href)));

  observeReveals();
}

function sum(rows, cat, field) {
  return rows.reduce((s, r) => s + (r.m[cat]?.[field] || 0), 0);
}

main().catch((e) => { console.error(e); toast("Something went wrong loading the dashboard"); });
