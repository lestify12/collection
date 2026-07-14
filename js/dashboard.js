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

  // category tabs (installment has its own section above)
  const TAB_CATS = ["dp24", "legal", "dnc", "cancelled", "others"].map((k) => catByKey[k]).filter(Boolean);

  // per-project bars for one category — re-rendered when a tab is clicked
  function renderCatBars(catKey) {
    const c = catByKey[catKey];
    const list = rows
      .map((r) => ({ id: r.id, name: r.name, due: r.m[catKey]?.due || 0, clients: r.m[catKey]?.clients || 0 }))
      .sort((a, b) => b.due - a.due);
    const max = Math.max(...list.map((x) => x.due), 1);
    const box = document.getElementById("catBars");
    box.innerHTML = list.map((x) => `
      <a class="sbar-row" href="project.html?id=${encodeURIComponent(x.id)}"
         data-tip="${esc(x.name)}<br><b>${fmtMoney(x.due)}</b> · ${fmtInt(x.clients)} account(s)">
        <div class="sbar-name">${esc(x.name)}</div>
        <div class="sbar-track"><div class="sbar-fill" data-w="${(x.due / max * 100).toFixed(1)}" style="background:${c.color}"></div></div>
        <div class="sbar-val">${fmtMoney(x.due, { compact: true })}<span class="sbar-sub"> · ${fmtInt(x.clients)}</span></div>
      </a>`).join("");
    requestAnimationFrame(() => requestAnimationFrame(() =>
      box.querySelectorAll(".sbar-fill").forEach((f) => { f.style.width = f.dataset.w + "%"; })));
    attachTips(box);
  }

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
      <div class="stat-card reveal"><div class="stat-icon green"><i class="ti ti-cash"></i></div>
        <div><div class="stat-value" id="kpiDp24">0</div><div class="stat-label">24% DP due</div>
        <div class="stat-foot">${fmtInt(catTot.dp24.clients)} account${catTot.dp24.clients === 1 ? "" : "s"}</div></div></div>
      <div class="stat-card reveal"><div class="stat-icon red"><i class="ti ti-gavel"></i></div>
        <div><div class="stat-value" id="kpiLegal">0</div><div class="stat-label">Legal case due</div>
        <div class="stat-foot">${fmtInt(catTot.legal.clients)} case${catTot.legal.clients === 1 ? "" : "s"}</div></div></div>
      <div class="stat-card reveal"><div class="stat-icon amber"><i class="ti ti-user-x"></i></div>
        <div><div class="stat-value" id="kpiDnc">0</div><div class="stat-label">DNC clients due</div>
        <div class="stat-foot">${fmtInt(catTot.dnc.clients)} client${catTot.dnc.clients === 1 ? "" : "s"}</div></div></div>
      <div class="stat-card reveal"><div class="stat-icon slate"><i class="ti ti-ban"></i></div>
        <div><div class="stat-value" id="kpiCancelled">0</div><div class="stat-label">Cancelled due</div>
        <div class="stat-foot">${fmtInt(catTot.cancelled.clients)} unit${catTot.cancelled.clients === 1 ? "" : "s"}</div></div></div>
      <div class="stat-card reveal"><div class="stat-icon navy"><i class="ti ti-building-community"></i></div>
        <div><div class="stat-value" id="kpiUnits">0</div><div class="stat-label">Total units</div>
        <div class="stat-foot">across ${rows.length} project${rows.length === 1 ? "" : "s"}</div></div></div>
    </div>

    <section class="card section reveal">
      <h2>Installment outstanding by project</h2>
      <div class="card-sub">1% monthly collection to chase, largest first — click to open</div>
      <div class="simple-bars">
        ${byInst.map((r) => `
          <a class="sbar-row" href="project.html?id=${encodeURIComponent(r.id)}"
             data-tip="${esc(r.name)}<br><b>${fmtMoney(r.m.installment?.due || 0)}</b> · ${fmtInt(r.m.installment?.clients || 0)} account(s)">
            <div class="sbar-name">${esc(r.name)}</div>
            <div class="sbar-track"><div class="sbar-fill" data-w="${((r.m.installment?.due || 0) / maxInst * 100).toFixed(1)}"></div></div>
            <div class="sbar-val">${fmtMoney(r.m.installment?.due || 0, { compact: true })}<span class="sbar-sub"> · ${fmtInt(r.m.installment?.clients || 0)}</span></div>
          </a>`).join("")}
      </div>
    </section>

    <section class="card section reveal">
      <h2>Outstanding by category</h2>
      <div class="card-sub">Pick a category to see each project's share — hover a bar for the exact amount</div>
      <div class="cat-tabs">
        ${TAB_CATS.map((c, i) => `<button class="cat-tab${i === 0 ? " active" : ""}" data-cat="${c.key}">
          <span class="cat-dot" style="background:${c.color}"></span>${esc(c.short)}</button>`).join("")}
      </div>
      <div class="simple-bars" id="catBars"></div>
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

  const money = { money: true, compact: false };
  // shrink the value font as the amount gets longer so big figures never overflow
  const fit = (id, amount, tiers) => {
    const el = document.getElementById(id);
    if (!el) return el;
    const len = fmtMoney(amount, { compact: false }).length;
    el.style.fontSize = (tiers.find(([max]) => len <= max) || tiers[tiers.length - 1])[1] + "px";
    return el;
  };
  const CARD = [[12, 21], [14, 19], [16, 17.5], [18, 16], [Infinity, 14.5]];
  const HERO = [[13, 34], [16, 31], [19, 27], [Infinity, 23]];

  countUp(fit("kpiInst", inst.due, HERO), inst.due, money);
  countUp(fit("kpiDp24", catTot.dp24.due, CARD), catTot.dp24.due, money);
  countUp(fit("kpiLegal", catTot.legal.due, CARD), catTot.legal.due, money);
  countUp(fit("kpiDnc", catTot.dnc.due, CARD), catTot.dnc.due, money);
  countUp(fit("kpiCancelled", catTot.cancelled.due, CARD), catTot.cancelled.due, money);
  countUp(document.getElementById("kpiUnits"), tot.projectUnits);

  requestAnimationFrame(() => requestAnimationFrame(() =>
    el.querySelectorAll(".sbar-fill, .hero-meter-fill").forEach((f) => { f.style.width = f.dataset.w + "%"; })));

  // category tabs — switch the per-project bars
  el.querySelectorAll(".cat-tab").forEach((btn) => btn.addEventListener("click", () => {
    el.querySelectorAll(".cat-tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    renderCatBars(btn.dataset.cat);
  }));
  renderCatBars(TAB_CATS[0].key);
  attachTips(el);   // tooltips for the installment-by-project bars

  el.querySelectorAll("tr.clickable").forEach((tr) =>
    tr.addEventListener("click", () => (location.href = tr.dataset.href)));

  observeReveals();
}

function sum(rows, cat, field) {
  return rows.reduce((s, r) => s + (r.m[cat]?.[field] || 0), 0);
}

main().catch((e) => { console.error(e); toast("Something went wrong loading the dashboard"); });
