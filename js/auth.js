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
    // First person to ever sign in bootstraps as the boss/admin.
    prof = { uid: fbUser.uid, email: fbUser.email,
             name: (fbUser.email || "boss").split("@")[0], role: "boss", active: true };
    await db.saveUserDoc(fbUser.uid, { email: prof.email, name: prof.name, role: "boss", active: true });
  }
  return prof;
}

async function init() {
  if (db.LIVE) {
    await new Promise((res) => {
      db.authNs.onAuthStateChanged(db.authInst, async (fbUser) => {
        _user = await loadProfile(fbUser);
        res();
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

/* ------------------------------------------------ session */
export function currentUser() { return _user; }
export function isBoss() { return _user?.role === "boss"; }
export function isLive() { return db.LIVE; }

function redirectToLogin() {
  const here = location.pathname.split("/").pop() + location.search;
  location.replace(`login.html?next=${encodeURIComponent(here)}`);
}

/** Gate a page. Returns the profile, or redirects and returns null. */
export async function requireAuth({ boss = false } = {}) {
  const user = await ready;
  if (!user) { redirectToLogin(); return null; }
  // First-login security: must set a new password before using the app.
  if (user.mustChangePassword && !location.pathname.endsWith("settings.html")) {
    location.replace("settings.html"); return null;
  }
  if (boss && user.role !== "boss") { location.replace("index.html"); return null; }
  return user;
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

/** Filter a loaded { summary, records } down to what `user` may see. */
export function scopeData({ summary, records }, user) {
  if (!user || user.role === "boss") return { summary, records };
  const uid = user.uid;
  const recs = records.filter((r) => r.assignedTo === uid);
  const projIds = new Set(recs.map((r) => r.projectId));
  const projects = (summary.projects || []).filter((p) => projIds.has(p.id));
  return { summary: { ...summary, projects }, records: recs };
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
  if (roleEl) roleEl.textContent = user.role === "boss" ? "Manager" : "Collection Officer";
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

  const boss = user.role === "boss";
  if (boss) {
    const dash = document.getElementById("navDashboard");
    if (dash && !document.getElementById("navTeam")) {
      const t = document.createElement("a");
      t.id = "navTeam"; t.className = "sidebar-item"; t.href = "team.html";
      t.innerHTML = `<i class="ti ti-users"></i>Team & access`;
      if (location.pathname.endsWith("team.html")) t.classList.add("active");
      dash.after(t);
    }
  }
}
