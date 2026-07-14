/* ============================================================
   Team & access (boss only) — manage logins, roles, and which
   projects each agent collects on.
   ============================================================ */
import * as db from "./db.js";
import * as auth from "./auth.js";
import {
  esc, fmtInt, renderNav, initTheme, initSidebar, visibleProjects, navLabel,
  toast, confirmModal, observeReveals,
} from "./ui.js";

initTheme();
initSidebar();

let ME = null;
let PROJECTS = [];   // assignable projects (config-scoped)
let RECORDS = [];    // all records (boss view) — used to derive current assignment

async function main() {
  ME = await auth.requireAuth({ min: "lead" });   // Manager + Team Leader
  if (!ME) return;
  auth.renderChrome(ME);

  const data = await db.loadAll(false, auth.loadScope(ME));
  RECORDS = data.records;
  PROJECTS = visibleProjects(data.summary.projects);
  renderNav(PROJECTS, null);

  const addBtn = document.getElementById("addUserBtn");
  if (auth.canManage(ME)) addBtn.addEventListener("click", () => openUserForm());
  else addBtn.style.display = "none";   // Team Leaders assign only, don't manage accounts

  document.getElementById("teamSub").textContent = auth.canManage(ME)
    ? "Manage who can sign in and which projects they collect on"
    : "Assign projects to your collection officers";
  await render();
}

async function render() {
  const users = await auth.listUsers();
  const body = document.getElementById("teamBody");
  const projName = Object.fromEntries(PROJECTS.map((p) => [p.id, p.name]));
  const canManage = auth.canManage(ME);   // Manager: manage accounts + roles

  const me = users.find((u) => u.uid === ME.uid) || ME;
  const others = users.filter((u) => u.uid !== ME.uid);

  const rowsHtml = others.map((u) => {
    const viewsAll = u.role !== "agent";   // Manager + TL see everything
    const assigned = viewsAll ? null : [...auth.assignedProjectIds(RECORDS, u.uid)];
    const chips = viewsAll
      ? `<span class="chip chip-all">All projects</span>`
      : (assigned.length
          ? assigned.map((id) => `<span class="chip">${esc(navLabel(projName[id] || id))}</span>`).join("")
          : `<span class="muted">No projects yet</span>`);
    const disabled = u.active === false;
    const roleCell = auth.isSuperAdmin(u)
      ? `<span class="role-badge boss">Admin</span>`
      : (canManage && u.uid !== ME.uid)
        ? `<select class="role-select" data-role="${u.uid}">
             <option value="agent" ${u.role === "agent" ? "selected" : ""}>Collection Officer</option>
             <option value="lead"  ${u.role === "lead" ? "selected" : ""}>Collection TL</option>
             <option value="boss"  ${u.role === "boss" ? "selected" : ""}>Manager</option>
           </select>`
        : `<span class="role-badge ${u.role === "agent" ? "agent" : "boss"}">${esc(auth.roleLabel(u.role))}</span>`;
    return `
      <tr class="${disabled ? "row-off" : ""}">
        <td>
          <div class="u-cell">
            <div class="u-avatar ${viewsAll ? "boss" : ""}">${esc(initials(u.name || u.email))}</div>
            <div><div class="u-name">${esc(u.name || "—")}${u.uid === ME.uid ? ' <span class="tag-you">you</span>' : ""}</div>
            <div class="u-email">${esc(u.email)}</div></div>
          </div>
        </td>
        <td>${roleCell}</td>
        <td class="proj-cell">${chips}</td>
        <td><span class="status-dot ${disabled ? "off" : "on"}"></span>${disabled ? "Disabled" : "Active"}</td>
        <td class="num act-cell">
          ${u.role === "agent" ? `<button class="icon-act" data-assign="${u.uid}" title="Assign projects"><i class="ti ti-map-pin-cog"></i></button>` : ""}
          ${canManage && u.uid !== ME.uid ? `
            <button class="icon-act" data-toggle="${u.uid}" title="${disabled ? "Enable" : "Disable"}"><i class="ti ti-${disabled ? "player-play" : "player-pause"}"></i></button>
            <button class="icon-act danger" data-del="${u.uid}" title="Remove"><i class="ti ti-trash"></i></button>` : ""}
        </td>
      </tr>`;
  }).join("");

  body.innerHTML = `
    <div class="you-label">Your account</div>
    <section class="card section reveal you-card">
      <div class="u-avatar boss you-avatar">${esc(initials(me.name || me.email))}</div>
      <div class="you-info">
        <div class="you-name">${esc(me.name || "—")} <span class="tag-you">you</span></div>
        <div class="u-email">${esc(me.email)}</div>
      </div>
      <span class="role-badge boss">${esc(auth.displayRole(me))}</span>
    </section>

    <div class="you-label" style="margin-top:20px">Team${others.length ? ` · ${others.length}` : ""}</div>
    <section class="card section reveal">
      ${others.length ? `<div class="table-wrap">
        <table class="data">
          <thead><tr><th>Person</th><th>Role</th><th>Assigned projects</th><th>Status</th><th></th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>` : `<div class="empty" style="padding:30px 10px"><div class="e-title">No teammates yet</div>
        <div class="e-sub">Use “Add teammate” to create collection officers and team leaders.</div></div>`}
    </section>`;

  body.querySelectorAll("[data-role]").forEach((sel) =>
    sel.addEventListener("change", () => changeRole(sel.dataset.role, sel.value)));
  body.querySelectorAll("[data-assign]").forEach((b) =>
    b.addEventListener("click", () => openAssign(b.dataset.assign)));
  body.querySelectorAll("[data-toggle]").forEach((b) =>
    b.addEventListener("click", () => toggleUser(b.dataset.toggle)));
  body.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => removeUser(b.dataset.del)));

  observeReveals();
}

/* ------------------------------------------------ actions */
async function changeRole(uid, role) {
  await auth.updateUser(uid, { role });
  toast("Role updated to " + auth.roleLabel(role));
  render();
}

async function toggleUser(uid) {
  const users = await auth.listUsers();
  const u = users.find((x) => x.uid === uid);
  await auth.updateUser(uid, { active: u.active === false });
  toast(u.active === false ? "Account enabled" : "Account disabled");
  render();
}

async function removeUser(uid) {
  const users = await auth.listUsers();
  const u = users.find((x) => x.uid === uid);
  const ok = await confirmModal({
    title: "Remove teammate?",
    message: `${u.name || u.email} will lose access. Their project assignments will be cleared.`,
    confirmLabel: "Remove", danger: true, icon: "ti-user-minus",
  });
  if (!ok) return;
  // clear their project assignments first
  for (const pid of auth.assignedProjectIds(RECORDS, uid)) await db.setProjectAssignee(pid, "");
  await auth.deleteUser(uid);
  RECORDS = (await db.loadAll(true, auth.loadScope(ME))).records;
  toast("Teammate removed");
  render();
}

/* ------------------------------------------------ add teammate modal */
function openUserForm() {
  const bd = modal(`
    <div class="modal-header"><div class="modal-header-left">
      <div class="modal-header-icon"><i class="ti ti-user-plus"></i></div>
      <div><div class="modal-header-title">Add teammate</div>
      <div class="modal-header-sub">They will use this email &amp; password to sign in</div></div></div>
      <button class="modal-close" data-x><i class="ti ti-x"></i></button></div>
    <div class="modal-body">
      <label class="fld"><span>Full name</span><input id="fName" placeholder="e.g. Reyshel Cruz"></label>
      <label class="fld"><span>Email</span><input id="fEmail" type="email" placeholder="reyshel@peacehomes.ae"></label>
      <label class="fld"><span>Temporary password</span><input id="fPass" type="text" placeholder="at least 6 characters"></label>
      <label class="fld"><span>Role</span>
        <select id="fRole"><option value="agent">Collection Officer — sees only assigned projects</option>
        <option value="lead">Collection TL — full access, can assign</option>
        <option value="boss">Manager — full access + manage team</option></select></label>
      <div class="login-error" id="fErr"></div>
    </div>
    <div class="modal-actions"><button class="btn" data-x>Cancel</button>
      <button class="btn primary" id="fSave"><i class="ti ti-check"></i> Create account</button></div>`);

  bd.querySelector("#fSave").addEventListener("click", async () => {
    const name = bd.querySelector("#fName").value.trim();
    const email = bd.querySelector("#fEmail").value.trim();
    const password = bd.querySelector("#fPass").value;
    const role = bd.querySelector("#fRole").value;
    const err = bd.querySelector("#fErr");
    if (!name || !email || password.length < 6) {
      err.textContent = "Enter a name, a valid email, and a password of at least 6 characters.";
      err.classList.add("show"); return;
    }
    const btn = bd.querySelector("#fSave"); btn.disabled = true;
    try {
      await auth.createUser({ email, name, role, password });
      close(bd); toast("Account created");
      render();
    } catch (e) {
      err.textContent = e.message || "Could not create the account."; err.classList.add("show");
      btn.disabled = false;
    }
  });
}

/* ------------------------------------------------ assign projects modal */
async function openAssign(uid) {
  const users = await auth.listUsers();
  const u = users.find((x) => x.uid === uid);
  const current = auth.assignedProjectIds(RECORDS, uid);

  const list = PROJECTS.map((p) => `
    <label class="assign-card">
      <input type="checkbox" value="${esc(p.id)}" ${current.has(p.id) ? "checked" : ""}>
      <i class="ti ti-building"></i>
      <span>${esc(navLabel(p.name))}</span>
      <i class="ti ti-check assign-check"></i>
    </label>`).join("");

  const bd = modal(`
    <div class="modal-header"><div class="modal-header-left">
      <div class="modal-header-icon"><i class="ti ti-map-pin-cog"></i></div>
      <div><div class="modal-header-title">Assign projects</div>
      <div class="modal-header-sub">${esc(u.name || u.email)} will see &amp; collect on the selected projects</div></div></div>
      <button class="modal-close" data-x><i class="ti ti-x"></i></button></div>
    <div class="modal-body"><div class="assign-grid">${list}</div>
      <div class="assign-note"><i class="ti ti-info-circle"></i> Assigning a project hands every unit in it to this collection officer. Fine-tune individual units on each client's page.</div></div>
    <div class="modal-actions"><button class="btn" data-x>Cancel</button>
      <button class="btn primary" id="aSave"><i class="ti ti-check"></i> Save</button></div>`);

  bd.querySelector("#aSave").addEventListener("click", async () => {
    const checked = new Set([...bd.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value));
    const toAdd = [...checked].filter((id) => !current.has(id));
    const toClear = [...current].filter((id) => !checked.has(id));
    if (!toAdd.length && !toClear.length) { close(bd); return; }
    const btn = bd.querySelector("#aSave"); btn.disabled = true;
    btn.innerHTML = `<i class="ti ti-loader-2 spin"></i> Saving…`;
    for (const id of toAdd) await db.setProjectAssignee(id, uid, u.name || u.email);
    for (const id of toClear) await db.setProjectAssignee(id, "");
    RECORDS = (await db.loadAll(true, auth.loadScope(ME))).records;
    close(bd); toast("Assignments updated");
    render();
  });
}

/* ------------------------------------------------ modal plumbing */
function modal(inner) {
  const bd = document.createElement("div");
  bd.className = "modal-backdrop";
  bd.innerHTML = `<div class="modal" style="width:min(520px,100%)">${inner}</div>`;
  document.body.appendChild(bd);
  requestAnimationFrame(() => bd.classList.add("open"));
  bd.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", () => close(bd)));
  bd.addEventListener("click", (e) => { if (e.target === bd) close(bd); });
  return bd;
}
function close(bd) { bd.classList.remove("open"); setTimeout(() => bd.remove(), 200); }

function initials(s) {
  const parts = String(s || "U").replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "U";
}

main().catch((e) => { console.error(e); toast("Something went wrong loading the team page"); });
