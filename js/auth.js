/* ============================================================
   Authentication + role/assignment layer.

   Live mode  → Firebase Authentication (email/password), user
                profiles in Firestore `users/{uid}`.
   Local mode → simulated auth backed by localStorage so the whole
                flow is testable before Firebase Auth is switched on.

   Visibility source of truth: every record carries `assignedTo`
   (a uid). An agent sees only records assigned to them; the boss
   sees everything. Assigning a whole project bulk-sets assignedTo
   on its records; assigning one unit sets it on that record.
   ============================================================ */
import * as db from "./db.js";
import { openAddProject as uiOpenAddProject } from "./ui.js";

const FB_VER = "10.12.2";
const LS_USERS = "collection_users_v1";
const LS_SESSION = "collection_session_v1";

let _user = null;   // resolved profile of the signed-in user (or null)

/* ------------------------------------------------ local store */
function lsUsers() {
  try { return JSON.parse(localStorage.getItem(LS_USERS)) || null; } catch { return null; }
}
function saveUsers(list) { localStorage.setItem(LS_USERS, JSON.stringify(list)); }
function seedLocal() {
  let list = lsUsers();
  if (!list) {
    list = [{ uid: "boss", email: "boss@peacehomes.ae", name: "Boss",
              role: "boss", password: "peace123", active: true }];
    saveUsers(list);
  }
  return list;
}

/* ------------------------------------------------ init */
async function loadProfile(fbUser) {
  if (!fbUser) return null;
  let prof = await db.getUserDoc(fbUser.uid);
  if (!prof) {
    // No profile yet → default to Collection Officer. A Manager can promote
    // them later from Team & access. (The Manager account is set up first.)
    prof = { uid: fbUser.uid, email: fbUser.email,
             name: (fbUser.email || "user").split("@")[0], role: "agent", active: true };
    await db.saveUserDoc(fbUser.uid, { email: prof.email, name: prof.name, role: "agent", active: true });
  }
  return prof;
}

async function init() {
  if (db.LIVE) {
    await new Promise((res) => {
      let settled = false;
      const done = () => { if (!settled) { settled = true; res(); } };
      db.authNs.onAuthStateChanged(db.authInst, async (fbUser) => {
        try { _user = await loadProfile(fbUser); }
        catch (e) {
          console.error("Could not load user profile", e);
          // Never hang the app: fall back to a minimal officer profile.
          _user = fbUser ? { uid: fbUser.uid, email: fbUser.email,
            name: (fbUser.email || "user").split("@")[0], role: "agent", active: true } : null;
        }
        finally { done(); }
      });
    });
  } else {
    seedLocal();
    const sess = JSON.parse(localStorage.getItem(LS_SESSION) || "null");
    if (sess?.uid) {
      const u = (lsUsers() || []).find((x) => x.uid === sess.uid && x.active !== false);
      _user = u ? { ...u } : null;
    }
  }
  return _user;
}

/** Resolves to the signed-in profile (or null) once auth state is known. */
export const ready = init();

/* ------------------------------------------------ roles
   Three tiers (internal key → label):
     boss  → Manager           (main boss, full control)
     lead  → Collection TL      (team leader, sees all + assigns)
     agent → Collection Officer (only their assigned units)          */
const RANK = { boss: 3, lead: 2, agent: 1 };
const SUPER_ADMINS = ((window.APP_CONFIG && window.APP_CONFIG.superAdmins) || [])
  .map((e) => String(e).toLowerCase());

export function roleLabel(role) {
  return role === "boss" ? "Manager" : role === "lead" ? "Collection TL" : "Collection Officer";
}
/** System/IT admin — always has full Manager powers regardless of role. */
export function isSuperAdmin(user = _user) {
  return !!user && SUPER_ADMINS.includes(String(user.email || "").toLowerCase());
}
/** Label shown to people (super admins read as "Admin"). */
export function displayRole(user) {
  return isSuperAdmin(user) ? "Admin" : roleLabel(user.role);
}
function effRank(user) { return isSuperAdmin(user) ? 3 : (RANK[user.role] || 0); }

/* ------------------------------------------------ session */
export function currentUser() { return _user; }
export function isBoss() { return _user?.role === "boss" || isSuperAdmin(); }
export function isManager(user = _user) { return user?.role === "boss" || isSuperAdmin(user); }
export function isLead(user = _user) { return user?.role === "lead"; }
/** Manager + Team Leader (+ super admin) see every project; officers see only their own. */
export function canViewAll(user = _user) { return !!user && (user.role !== "agent" || isSuperAdmin(user)); }
/** Manager + super admin can manage accounts, roles, and import. */
export function canManage(user = _user) { return user?.role === "boss" || isSuperAdmin(user); }
export function isLive() { return db.LIVE; }

function redirectToLogin() {
  const here = location.pathname.split("/").pop() + location.search;
  location.replace(`login.html?next=${encodeURIComponent(here)}`);
}

/** Gate a page. `min` = the lowest role allowed ("agent" | "lead" | "boss").
    Returns the profile, or redirects and returns null. */
export async function requireAuth({ min = "agent" } = {}) {
  const user = await ready;
  if (!user) { redirectToLogin(); return null; }
  // First-login security: must set a new password before using the app.
  if (user.mustChangePassword && !location.pathname.endsWith("reset.html")) {
    location.replace("reset.html"); return null;
  }
  if (effRank(user) < (RANK[min] || 0)) { location.replace("index.html"); return null; }
  return user;
}

/** Scope object for db.loadAll — full access for anyone who can view all. */
export function loadScope(user = _user) {
  return user ? { uid: user.uid, role: canViewAll(user) ? "boss" : "agent" } : null;
}

export async function signIn(email, password) {
  email = (email || "").trim();
  if (db.LIVE) {
    try {
      const cred = await db.authNs.signInWithEmailAndPassword(db.authInst, email, password);
      _user = await loadProfile(cred.user);
      if (_user && _user.active === false) { await db.authNs.signOut(db.authInst); _user = null; return { ok: false, error: "This account is disabled." }; }
      return { ok: true };
    } catch (e) { return { ok: false, error: friendly(e) }; }
  }
  const u = (lsUsers() || seedLocal()).find((x) => x.email.toLowerCase() === email.toLowerCase());
  if (!u || u.password !== password) return { ok: false, error: "Invalid email or password." };
  if (u.active === false) return { ok: false, error: "This account is disabled." };
  localStorage.setItem(LS_SESSION, JSON.stringify({ uid: u.uid }));
  _user = { ...u };
  return { ok: true };
}

export async function signOut() {
  if (db.LIVE) { try { await db.authNs.signOut(db.authInst); } catch {} }
  else localStorage.removeItem(LS_SESSION);
  _user = null;
  location.replace("login.html");
}

function friendly(e) {
  const m = String(e?.code || e?.message || e);
  if (m.includes("invalid-credential") || m.includes("wrong-password") || m.includes("user-not-found"))
    return "Invalid email or password.";
  if (m.includes("too-many-requests")) return "Too many attempts — try again shortly.";
  if (m.includes("network")) return "Network error — check your connection.";
  return "Could not sign in. Please try again.";
}

/* ------------------------------------------------ user management (boss) */
export async function listUsers() {
  if (db.LIVE) return db.listUserDocs();
  return (lsUsers() || seedLocal()).map((u) => ({ ...u }));
}

export async function createUser({ email, name, role, password }) {
  email = (email || "").trim(); name = (name || "").trim();
  if (db.LIVE) {
    // Create the auth login in a throwaway secondary app so the boss's own
    // session is not replaced by the newly-created user.
    const { initializeApp, deleteApp } = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-app.js`);
    const secApp = initializeApp(db.firebaseConfig(), "secondary");
    try {
      const secAuth = db.authNs.getAuth(secApp);
      const cred = await db.authNs.createUserWithEmailAndPassword(secAuth, email, password);
      await db.saveUserDoc(cred.user.uid, { email, name, role, active: true, mustChangePassword: true });
      await db.authNs.signOut(secAuth);
      return { uid: cred.user.uid, email, name, role, active: true };
    } finally { await deleteApp(secApp); }
  }
  const list = lsUsers() || seedLocal();
  if (list.some((u) => u.email.toLowerCase() === email.toLowerCase())) throw new Error("That email already exists.");
  const uid = "u_" + Date.now();
  const u = { uid, email, name, role, password, active: true, mustChangePassword: true };
  list.push(u); saveUsers(list);
  return u;
}

export async function updateUser(uid, patch) {
  if (db.LIVE) { await db.saveUserDoc(uid, patch); if (_user?.uid === uid) _user = { ..._user, ...patch }; return; }
  const list = lsUsers() || seedLocal();
  const i = list.findIndex((u) => u.uid === uid);
  if (i >= 0) { list[i] = { ...list[i], ...patch }; saveUsers(list); if (_user?.uid === uid) _user = { ..._user, ...patch }; }
}

/* ------------------------------------------------ per-user preferences
   Small personal settings stored on the user's own profile so they follow
   the account across devices and survive sign-out (e.g. "show only my units"
   per project). Writing `prefs` leaves role/active untouched, so the
   self-update Firestore rule allows it. */
export function getPref(key, fallback = undefined) {
  const p = _user?.prefs;
  return p && p[key] !== undefined ? p[key] : fallback;
}
export async function setPref(key, value) {
  if (!_user) return;
  const prefs = { ...(_user.prefs || {}), [key]: value };
  await updateUser(_user.uid, { prefs });
}

export async function changePassword(newPassword) {
  if (db.LIVE) {
    const u = db.authInst.currentUser;
    if (!u) throw new Error("Please sign in again.");
    try { await db.authNs.updatePassword(u, newPassword); }
    catch (e) {
      if (String(e?.code || e).includes("requires-recent-login"))
        throw new Error("For security, sign out and back in, then change your password.");
      throw new Error("Could not update password.");
    }
    return;
  }
  await updateUser(_user.uid, { password: newPassword });
}

/** Manager/Admin sets a teammate's temporary password. The teammate is forced
    to set their own password on next sign-in (mustChangePassword), exactly like
    a brand-new account. Live mode does the password change through a secure
    Cloud Function (the browser can't set another user's Firebase password);
    local/testing mode sets it directly. */
export async function resetPassword(uid, tempPassword) {
  if (db.LIVE) {
    const url = String((window.APP_CONFIG && window.APP_CONFIG.functionsUrl) || "").trim();
    if (!url) throw new Error("Password reset isn’t set up yet — the admin needs to deploy the reset function (see functions/README.md) and add its URL to config.js.");
    let resp;
    try {
      const idToken = await db.authInst.currentUser.getIdToken();
      resp = await fetch(url, {
        method: "POST",
        headers: { "Authorization": `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ uid, tempPassword }),
      });
    } catch (e) { throw new Error("Couldn’t reach the reset service. Check the function URL in config.js."); }
    if (!resp.ok) {
      const j = await resp.json().catch(() => ({}));
      throw new Error(j.error || "Could not reset the password.");
    }
    if (_user?.uid === uid) _user = { ..._user, mustChangePassword: true };
    return { tempApplied: true };
  }
  await updateUser(uid, { password: tempPassword, mustChangePassword: true });
  return { tempApplied: true };
}

export async function deleteUser(uid) {
  // Live: removes the profile + assignments. The Firebase Auth login itself
  // must be removed from the Firebase console (client SDK cannot delete others).
  if (db.LIVE) { await db.deleteUserDoc(uid); return; }
  saveUsers((lsUsers() || seedLocal()).filter((u) => u.uid !== uid));
}

/* ------------------------------------------------ assignment */
/** Which project ids currently have at least one record assigned to `uid`. */
export function assignedProjectIds(records, uid) {
  const s = new Set();
  for (const r of records) if (r.assignedTo === uid) s.add(r.projectId);
  return s;
}

/** Everyone may VIEW all projects & records now, so this is a pass-through.
    (Write access is gated separately via canEdit.) */
export function scopeData({ summary, records }, user) {
  return { summary, records };
}

/** Can `user` make changes to this record? Manager/TL/admin: any record;
    a Collection Officer: only units assigned to them. */
export function canEdit(record, user = _user) {
  if (!user || !record) return false;
  return canViewAll(user) || record.assignedTo === user.uid;
}

/* ------------------------------------------------ chrome (navbar + sidebar) */
function initials(s) {
  const parts = String(s || "U").replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "U";
}

/** Update the shared header/sidebar for the signed-in user. */
export function renderChrome(user) {
  const nameEl = document.querySelector(".user-name");
  const roleEl = document.querySelector(".user-role");
  const avEl = document.querySelector(".user-avatar");
  if (nameEl) nameEl.textContent = user.name || "User";
  if (roleEl) roleEl.textContent = displayRole(user);
  if (avEl) avEl.textContent = initials(user.name || user.email);

  const right = document.querySelector(".navbar-right");
  const anchor = right?.querySelector(".navbar-user");
  if (right && !document.getElementById("settingsBtn")) {
    const s = document.createElement("a");
    s.id = "settingsBtn"; s.className = "navbar-icon-btn"; s.title = "Settings"; s.href = "settings.html";
    s.innerHTML = `<i class="ti ti-settings"></i>`;
    right.insertBefore(s, anchor);
  }
  if (right && !document.getElementById("signOutBtn")) {
    const b = document.createElement("button");
    b.id = "signOutBtn"; b.className = "navbar-icon-btn"; b.title = "Sign out";
    b.innerHTML = `<i class="ti ti-logout"></i>`;
    b.addEventListener("click", () => signOut());
    right.insertBefore(b, anchor);
  }
  // everything on the right is set — reveal the group as one
  right?.classList.add("chrome-ready");

  // Manager + Team Leader get the Team & access page (TL can assign only).
  if (canViewAll(user)) {
    const dash = document.getElementById("navDashboard");
    if (dash && !document.getElementById("navTeam")) {
      const t = document.createElement("a");
      t.id = "navTeam"; t.className = "sidebar-item"; t.href = "team.html";
      t.innerHTML = `<i class="ti ti-users"></i>Team & access`;
      if (location.pathname.endsWith("team.html")) t.classList.add("active");
      dash.after(t);
    }
  }

  // Manager + Admin can add a new project — button at the bottom of the sidebar.
  if (canManage(user)) {
    const sidebar = document.querySelector(".sidebar");
    const foot = sidebar?.querySelector(".sidebar-foot");
    if (sidebar && foot && !document.getElementById("addProjectBtn")) {
      const b = document.createElement("button");
      b.id = "addProjectBtn"; b.className = "sidebar-add-project";
      b.innerHTML = `<i class="ti ti-plus"></i> Add project`;
      b.addEventListener("click", () => uiOpenAddProject());
      sidebar.insertBefore(b, foot);
    }
  }
}
