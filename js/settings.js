/* ============================================================
   Settings — profile name + password. Also hosts the mandatory
   first-login password change.
   ============================================================ */
import * as db from "./db.js";
import * as auth from "./auth.js";
import {
  esc, renderNav, initTheme, initSidebar, visibleProjects, toast, observeReveals,
} from "./ui.js";

initTheme();
initSidebar();

let ME = null;

async function main() {
  ME = await auth.requireAuth();
  if (!ME) return;
  auth.renderChrome(ME);
  render();   // render immediately — never block the form on data loading

  // sidebar projects load in the background (non-blocking)
  db.loadAll(false, auth.loadScope(ME))
    .then((data) => renderNav(visibleProjects(auth.scopeData(data, ME).summary.projects), null))
    .catch(() => { /* non-fatal */ });
}

function render() {
  const body = document.getElementById("settingsBody");
  body.innerHTML = `
    <div class="settings-grid">
      <section class="card section reveal">
        <h2>Profile</h2>
        <div class="card-sub">This name shows in the header and on your assignments</div>
        <label class="fld"><span>Full name</span><input id="pName" value="${esc(ME.name || "")}"></label>
        <label class="fld"><span>Email</span><input value="${esc(ME.email || "")}" disabled></label>
        <label class="fld"><span>Role</span><input value="${auth.displayRole(ME)}" disabled></label>
        <div class="login-error" id="pErr"></div>
        <button class="btn primary" id="saveName"><i class="ti ti-check"></i> Save profile</button>
      </section>

      <section class="card section reveal">
        <h2>Change password</h2>
        <div class="card-sub">At least 6 characters</div>
        <label class="fld"><span>New password</span><input id="pw1" type="password" placeholder="••••••••"></label>
        <label class="fld"><span>Confirm new password</span><input id="pw2" type="password" placeholder="••••••••"></label>
        <div class="login-error" id="pwErr"></div>
        <button class="btn primary" id="savePw"><i class="ti ti-lock"></i> Update password</button>
      </section>
    </div>`;

  document.getElementById("saveName").addEventListener("click", saveName);
  document.getElementById("savePw").addEventListener("click", savePassword);
  observeReveals();
}

async function saveName() {
  const name = document.getElementById("pName").value.trim();
  const err = document.getElementById("pErr");
  if (!name) { err.textContent = "Please enter your name."; err.classList.add("show"); return; }
  const btn = document.getElementById("saveName"); btn.disabled = true;
  try {
    await auth.updateUser(ME.uid, { name });
    ME = { ...ME, name };
    auth.renderChrome(ME);
    toast("Profile updated");
  } catch (e) { err.textContent = e.message || "Could not save."; err.classList.add("show"); }
  finally { btn.disabled = false; }
}

async function savePassword() {
  const p1 = document.getElementById("pw1").value;
  const p2 = document.getElementById("pw2").value;
  const err = document.getElementById("pwErr");
  err.classList.remove("show");
  if (p1.length < 6) { err.textContent = "Password must be at least 6 characters."; err.classList.add("show"); return; }
  if (p1 !== p2) { err.textContent = "The two passwords don't match."; err.classList.add("show"); return; }
  const btn = document.getElementById("savePw"); btn.disabled = true;
  const orig = btn.innerHTML;
  btn.innerHTML = `<i class="ti ti-loader-2 spin"></i> Saving…`;
  try {
    await auth.changePassword(p1);
    toast("Password updated");
    document.getElementById("pw1").value = "";
    document.getElementById("pw2").value = "";
  } catch (e) {
    err.textContent = e.message || "Could not update password."; err.classList.add("show");
  } finally { btn.disabled = false; btn.innerHTML = orig; }
}

main().catch((e) => { console.error(e); toast("Something went wrong loading settings"); });
