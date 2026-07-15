/* ============================================================
   Analytics dashboard (boss view) — all-projects summary.
   ============================================================ */
import * as db from "./db.js";
import * as auth from "./auth.js";
import {
  CATS, catByKey, esc, fmtMoney, fmtInt, renderNav, initTheme, initSidebar,
  setModeBadge, observeReveals, countUp, attachTips, toast, visibleProjects,
} from "./ui.js";
import { overdueAsOf, dueInRange, MONTHS } from "./plan.js";

initTheme();
initSidebar();

const DUE_CATS = CATS.filter((c) => c.due);

async function main() {
  const user = await auth.requireAuth();
  if (!user) return;
  auth.renderChrome(user);

  let data, ASSIGN = {};
  try {
    const raw = await db.loadAll(false, auth.loadScope(user));
    ASSIGN = raw.assignments || {};
    data = auth.scopeData(raw, user);
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

  // page title reflects the active scope (set for real in draw()).
  const titleEl = document.querySelector(".page-title");

  // who is assigned to each project. Prefer the name denormalised onto the
  // record; else look it up (Manager/TL can list users); always resolve self.
  const usersById = Object.fromEntries(
    (await auth.listUsers().catch(() => [])).map((u) => [u.uid, u.name || u.email]));
  usersById[user.uid] = user.name || user.email;
  const projectAssignee = (pid) => {
    const set = new Set(records.filter((r) => r.projectId === pid && r.assignedTo)
      .map((r) => r.assignedToName || usersById[r.assignedTo] || "Assigned"));
    const docA = db.projectAssignee(ASSIGN, pid);   // whole-project assignment (works with 0 units)
    if (docA) set.add(docA.name || usersById[docA.uid] || "Assigned");
    if (!set.size) return null;
    const names = [...set].sort();
    return names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " & " + names[names.length - 1];
  };

  // Scope: "all" = every unit (with boss-summary fallback for un-imported
  // projects); "mine" = only the signed-in officer's assigned units.
  const buildScope = (scope) => {
    const scoped = scope === "mine" ? records.filter((r) => r.assignedTo === user.uid) : records;
    const projs = scope === "mine" ? projects.filter((p) => scoped.some((r) => r.projectId === p.id)) : projects;
    const rows = projs.map((p) => ({ ...p, m: db.projectMetrics(p, scoped, scope === "mine"), assignee: projectAssignee(p.id) }));
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
    return { rows, tot, catTot, scoped };
  };

  // My units / All units switcher, in the page header — controls the whole page.
  let scope = user.role === "agent" ? "mine" : "all";
  const draw = () => {
    const s = buildScope(scope);
    if (scope === "mine") {
      const names = s.rows.map((r) => r.name);
      titleEl.textContent = names.length === 1 ? `${names[0]} Collection Summary`
        : names.length ? `${names.join(", ")} Collection Summary`
        : "My Collection Summary";
    } else {
      titleEl.textContent = "All Project Collection Summary";
    }
    render(s.rows, s.tot, s.catTot, summary, s.scoped, user, scope);
  };
  const header = document.querySelector(".page-header");
  if (header && !document.getElementById("scopeSeg")) {
    const seg = document.createElement("div");
    seg.className = "seg scope-seg"; seg.id = "scopeSeg";
    seg.innerHTML = `<button class="seg-btn${scope === "mine" ? " active" : ""}" data-scope="mine">My units</button>
      <button class="seg-btn${scope === "all" ? " active" : ""}" data-scope="all">All units</button>`;
    header.appendChild(seg);
    seg.querySelectorAll(".seg-btn").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.scope === scope) return;
      scope = b.dataset.scope;
      seg.querySelectorAll(".seg-btn").forEach((x) => x.classList.toggle("active", x === b));
      draw();
    }));
  }
  draw();
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

/* ---- Monthly overdue filter (My units / All units + month selection) ---- */
const OD_YMIN = 2024, OD_YMAX = 2031;

// close any open month/year popover when clicking elsewhere
document.addEventListener("click", (e) => {
  if (e.target.closest(".my-picker")) return;
  document.querySelectorAll(".my-pop:not([hidden])").forEach((p) => {
    p.hidden = true; p.closest(".my-picker")?.classList.remove("open");
  });
});

/** Wire a month+year popover: year stepper + month grid, writes data-m/data-y. */
function initMYPicker(root, onChange) {
  const trigger = root.querySelector(".my-trigger");
  const pop = root.querySelector(".my-pop");
  const label = root.querySelector(".my-label");
  const yrVal = root.querySelector(".my-yr-val");
  const paint = () => {
    label.textContent = `${MONTHS[+root.dataset.m - 1]} ${root.dataset.y}`;
    yrVal.textContent = root.dataset.y;
    root.querySelectorAll(".my-grid button").forEach((b) => b.classList.toggle("sel", b.dataset.m === root.dataset.m));
  };
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = pop.hidden;
    document.querySelectorAll(".my-pop:not([hidden])").forEach((p) => {
      p.hidden = true; p.closest(".my-picker")?.classList.remove("open");
    });
    if (willOpen) { yrVal.textContent = root.dataset.y; pop.hidden = false; root.classList.add("open"); }
  });
  root.querySelectorAll(".my-yr-btn").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    const y = Math.max(OD_YMIN, Math.min(OD_YMAX, +yrVal.textContent + (+b.dataset.d)));
    yrVal.textContent = y;
  }));
  root.querySelectorAll(".my-grid button").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    root.dataset.m = b.dataset.m;
    root.dataset.y = yrVal.textContent;   // commit the year the user paged to
    paint();
    pop.hidden = true; root.classList.remove("open");
    onChange && onChange();
  }));
  paint();
}

/** A month+year popover picker. Value lives in data-m / data-y on the root. */
function myPickerHTML(id, m, y) {
  return `<div class="my-picker" id="${id}" data-m="${m}" data-y="${y}">
    <button type="button" class="my-trigger">
      <i class="ti ti-calendar-event"></i>
      <span class="my-label">${MONTHS[m - 1]} ${y}</span>
      <i class="ti ti-chevron-down my-caret"></i>
    </button>
    <div class="my-pop" hidden>
      <div class="my-yr">
        <button type="button" class="my-yr-btn" data-d="-1" aria-label="Previous year"><i class="ti ti-chevron-left"></i></button>
        <span class="my-yr-val">${y}</span>
        <button type="button" class="my-yr-btn" data-d="1" aria-label="Next year"><i class="ti ti-chevron-right"></i></button>
      </div>
      <div class="my-grid">
        ${MONTHS.map((mn, i) => `<button type="button" class="my-m${i + 1 === m ? " sel" : ""}" data-m="${i + 1}">${mn}</button>`).join("")}
      </div>
    </div>
  </div>`;
}

function overdueCardHTML() {
  const now = new Date();
  const m = now.getMonth() + 1;
  const y = Math.min(2031, Math.max(2024, now.getFullYear()));
  return `
    <section class="card section reveal" id="overdueCard">
      <div class="od-head">
        <div><h2>Monthly overdue</h2>
          <div class="card-sub">Installments that should already be collected but aren’t</div></div>
      </div>
      <div class="od-controls">
        <div class="seg od-mode">
          <button class="seg-btn active" data-mode="asof">As of a month</button>
          <button class="seg-btn" data-mode="range">Between months</button>
        </div>
        <div class="od-pickers">
          <span class="od-plabel" id="odFromLabel">As of</span>
          ${myPickerHTML("odFrom", m, y)}
          <span id="odTo" class="od-to" hidden><span class="od-dash">to</span>
            ${myPickerHTML("odToPick", m, y)}</span>
        </div>
      </div>
      <div class="od-result">
        <div><div class="od-big" id="odAmount">—</div>
          <div class="od-cap" id="odCount">&nbsp;</div></div>
      </div>
      <div class="od-note"><i class="ti ti-info-circle"></i>
        For accurate figures, complete each unit’s <b>SOA monthly breakdown</b> (upload the SOA on the client page). Units without one use the default 1% schedule.</div>
    </section>`;
}

function render(rows, tot, catTot, summary, records = [], user = {}, scope = "all") {
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
        </div>
      </div>
      <div class="hero-meter"><div class="hero-meter-fill" data-w="${instShare}"></div></div>
    </section>

    <!-- Monthly overdue card temporarily hidden — restore with \${overdueCardHTML()} -->

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
                <td style="white-space:nowrap;${r.assignee ? "color:var(--ink-2)" : "color:var(--ink-3);font-style:italic"}">${esc(r.assignee || "Not Assigned")}</td>
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

  /* ---- monthly overdue card (operates on the already-scoped records) ---- */
  const card = document.getElementById("overdueCard");
  if (card) {
    let mode = "asof";
    const key = (sel) => { const p = card.querySelector(sel); return `${p.dataset.y}-${String(p.dataset.m).padStart(2, "0")}`; };
    const recompute = () => {
      let a = key("#odFrom"), b = key("#odToPick");
      if (mode === "range" && a > b) [a, b] = [b, a];
      let total = 0, n = 0;
      for (const r of records) {
        const od = mode === "range" ? dueInRange(r, a, b) : overdueAsOf(r, a);
        if (od > 0.01) { total += od; n++; }
      }
      card.querySelector("#odAmount").textContent = fmtMoney(total, { compact: false });
      const fit = [[13, 34], [16, 30], [19, 26], [Infinity, 22]];
      const len = fmtMoney(total, { compact: false }).length;
      card.querySelector("#odAmount").style.fontSize = (fit.find(([mx]) => len <= mx) || fit[fit.length - 1])[1] + "px";
      card.querySelector("#odCount").textContent = mode === "range"
        ? `${fmtInt(n)} unit${n === 1 ? "" : "s"} overdue between the selected months`
        : `${fmtInt(n)} unit${n === 1 ? "" : "s"} overdue as of the selected month`;
    };
    card.querySelectorAll(".od-mode .seg-btn").forEach((btn) => btn.addEventListener("click", () => {
      mode = btn.dataset.mode;
      card.querySelectorAll(".od-mode .seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
      card.querySelector("#odTo").hidden = mode !== "range";
      card.querySelector("#odFromLabel").textContent = mode === "range" ? "From" : "As of";
      recompute();
    }));
    card.querySelectorAll(".my-picker").forEach((p) => initMYPicker(p, recompute));
    recompute();
  }

  observeReveals();
}

function sum(rows, cat, field) {
  return rows.reduce((s, r) => s + (r.m[cat]?.[field] || 0), 0);
}

main().catch((e) => { console.error(e); toast("Something went wrong loading the dashboard"); });
