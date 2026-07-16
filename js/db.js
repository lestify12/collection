/* ============================================================
   Data layer — Firebase Firestore when configured, otherwise
   bundled JSON seed data + localStorage for local edits.
   Exposes the same API in both modes.
   ============================================================ */

import { dueOf } from "./plan.js";

const FB_VER = "10.12.2";
const LS_KEY = "collection_local_v1";

const cfg = (window.APP_CONFIG && window.APP_CONFIG.firebase) || {};
export let LIVE = !!cfg.apiKey;   // may flip to false if the SDK can't load
export let mode = LIVE ? "live" : "local";

let fs = null;   // firestore module namespace
let db = null;
let app = null;
export let authNs = null;   // firebase-auth module namespace (live only)
export let authInst = null; // Auth instance (live only)

if (LIVE) {
  try {
    const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-app.js`);
    fs = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-firestore.js`);
    authNs = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-auth.js`);
    app = initializeApp(cfg);
    db = fs.getFirestore(app);
    authInst = authNs.getAuth(app);
  } catch (e) {
    // Network / CDN failure — degrade to local mode instead of hanging on a blank page.
    console.error("Firebase SDK failed to load — falling back to local data.", e);
    LIVE = false;
    mode = "local";
    fs = null;
    db = null;
    app = null;
    authNs = null;
    authInst = null;
  }
}

export function firebaseApp() { return app; }
export function firebaseConfig() { return cfg; }

/* Call a Firebase Cloud Function (used for admin actions the browser can't do
   directly, e.g. setting another user's password). Lazy-loads the SDK. */
let fnMod = null, fnInst = null;
export async function callFunction(name, data) {
  if (!LIVE) throw new Error("Cloud functions are only available in live mode.");
  if (!fnMod) fnMod = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-functions.js`);
  if (!fnInst) fnInst = fnMod.getFunctions(app);
  const res = await fnMod.httpsCallable(fnInst, name)(data);
  return res.data;
}

/* ------------------------------------------------ user profiles (live) */
export async function listUserDocs() {
  if (!LIVE) return [];
  const snap = await fs.getDocs(fs.collection(db, "users"));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}
export async function getUserDoc(uid) {
  if (!LIVE) return null;
  const d = await fs.getDoc(fs.doc(db, "users", uid));
  return d.exists() ? { uid, ...d.data() } : null;
}
export async function saveUserDoc(uid, data) {
  if (!LIVE) return;
  await fs.setDoc(fs.doc(db, "users", uid), data, { merge: true });
}
export async function deleteUserDoc(uid) {
  if (!LIVE) return;
  await fs.deleteDoc(fs.doc(db, "users", uid));
}

/* Set (or clear, uid="") the assignee on every record of a project.
   `name` is denormalised onto each record so viewers who cannot list all
   users (e.g. Collection Officers) can still show the assignee's name. */
export async function setProjectAssignee(projectId, uid, name = "") {
  const patch = { assignedTo: uid || "", assignedToName: uid ? (name || "") : "" };
  if (LIVE) {
    // Read every record of the project in one query (reads aren't capped at
    // 400 — only write batches are), then stamp them in chunks of 400. The old
    // paginated loop re-ran the same projectId query with no cursor, so once
    // the first page was stamped it kept returning the same docs and bailed —
    // leaving the tail of any project with >400 units unassigned.
    const snap = await fs.getDocs(fs.query(fs.collection(db, "records"), fs.where("projectId", "==", projectId)));
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += 400) {
      const batch = fs.writeBatch(db);
      docs.slice(i, i + 400).forEach((d) => batch.set(d.ref, patch, { merge: true }));
      await batch.commit();
    }
    invalidate();
    return docs.length;
  }
  // local mode
  const local = loadLocal();
  let touched = 0;
  for (const r of local.added)
    if (r.projectId === projectId) { Object.assign(r, patch); touched++; }
  for (const r of cache?.records || [])
    if (r.projectId === projectId && !String(r.id).startsWith("loc_")) {
      const base = local.overrides[r.id] || { ...r };
      delete base.id;
      Object.assign(base, patch);
      local.overrides[r.id] = base;
      touched++;
    }
  saveLocal(local);
  invalidate();
  return touched;
}

/* Move ALL of one officer's work to another in one go (e.g. when someone
   resigns). Reassigns every record assigned to `fromUid` — across all
   projects — plus any whole-project assignments, to `toUid`. Returns the
   number of unit records moved. */
export async function reassignRecords(fromUid, toUid, toName = "") {
  if (!fromUid || !toUid || fromUid === toUid) return 0;
  const patch = { assignedTo: toUid, assignedToName: toName || "" };
  let touched = 0;
  if (LIVE) {
    // Each batch flips assignedTo, so those docs drop out of the next query.
    while (true) {
      const q = fs.query(fs.collection(db, "records"), fs.where("assignedTo", "==", fromUid), fs.limit(400));
      const snap = await fs.getDocs(q);
      if (snap.empty) break;
      const batch = fs.writeBatch(db);
      snap.docs.forEach((d) => batch.set(d.ref, patch, { merge: true }));
      await batch.commit();
      touched += snap.size;
      if (snap.size < 400) break;
    }
    // whole-project assignments
    const assignments = await loadAssignments();
    const updates = {};
    for (const [pid, a] of Object.entries(assignments)) if (a && a.uid === fromUid) updates[pid] = { uid: toUid, name: toName || "" };
    if (Object.keys(updates).length) await fs.setDoc(fs.doc(db, "assignments", "projects"), updates, { merge: true });
    invalidate();
    return touched;
  }
  // local mode
  const local = loadLocal();
  for (const r of local.added) if (r.assignedTo === fromUid) { Object.assign(r, patch); touched++; }
  for (const r of cache?.records || [])
    if (r.assignedTo === fromUid && !String(r.id).startsWith("loc_")) {
      const base = local.overrides[r.id] || { ...r };
      delete base.id; Object.assign(base, patch);
      local.overrides[r.id] = base; touched++;
    }
  const assignments = local.assignments || {};
  for (const [pid, a] of Object.entries(assignments)) if (a && a.uid === fromUid) assignments[pid] = { uid: toUid, name: toName || "" };
  local.assignments = assignments;
  saveLocal(local);
  invalidate();
  return touched;
}

/* ---- project-level assignment (records-independent) ----------------------
   Whole-project assignment is ALSO stored in a small doc so a project with
   no imported units yet (summary-only, e.g. Sky Livings) can still be
   assigned to an officer. Shape: { [projectId]: { uid, name } }. When the
   project's units exist they are additionally stamped via setProjectAssignee
   so filtering and officer edit-rights keep working. */
async function loadAssignments() {
  if (LIVE) {
    try {
      const d = await fs.getDoc(fs.doc(db, "assignments", "projects"));
      return d.exists() ? d.data() : {};
    } catch (e) { console.warn("assignments doc unavailable", e); return {}; }
  }
  return loadLocal().assignments || {};
}

export async function setProjectAssignment(projectId, uid, name = "") {
  const entry = { uid: uid || "", name: uid ? (name || "") : "" };
  if (LIVE) {
    await fs.setDoc(fs.doc(db, "assignments", "projects"), { [projectId]: entry }, { merge: true });
    invalidate();
    return;
  }
  const local = loadLocal();
  local.assignments = { ...(local.assignments || {}), [projectId]: entry };
  saveLocal(local);
  invalidate();
}

/** The officer a whole project is assigned to ({uid,name}) or null. */
export function projectAssignee(assignments, projectId) {
  const a = assignments && assignments[projectId];
  return a && a.uid ? a : null;
}

/* ------------------------------------------------ local overlay */
function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || { added: [], overrides: {} }; }
  catch { return { added: [], overrides: {} }; }
}
function saveLocal(state) { localStorage.setItem(LS_KEY, JSON.stringify(state)); }

/* ------------------------------------------------ cache */
let cache = null;
let _imagesCache = null;   // { [projectId]: dataUrl } uploaded project photos

async function fetchJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

/** Loads everything the pages need: { summary, records }.
    Every signed-in user reads all records (officers see all projects);
    write access is enforced separately in the UI and Firestore rules. */
/** Load { summary, records, assignments }.
    Pass `projectId` to fetch ONLY that project's records — the project and
    client pages use this so they don't download the whole (now large)
    collection on every navigation. Dashboard/team omit it (they aggregate
    across everything). */
// Buyer names are displayed in ALL CAPS across the app; normalise on load.
const upperNames = (recs) => recs.map((r) =>
  (r && r.buyerName ? { ...r, buyerName: String(r.buyerName).toUpperCase() } : r));

export async function loadAll(force = false, scope = null, projectId = null) {
  projectId = projectId || null;
  if (cache && !force && cache._projectId === projectId) return cache;

  const summary = await loadSummary();
  const assignments = await loadAssignments();
  const images = await loadProjectImages();
  let records;

  if (LIVE) {
    const src = projectId
      ? fs.query(fs.collection(db, "records"), fs.where("projectId", "==", projectId))
      : fs.collection(db, "records");
    const snap = await fs.getDocs(src);
    records = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } else {
    const seed = await fetchJSON("data/records.json");
    const local = loadLocal();
    records = seed.records.map((r, i) => ({ id: `seed_${i}`, ...r }));
    records = records
      .map((r) => (r.id in local.overrides ? local.overrides[r.id] && { ...local.overrides[r.id], id: r.id } : r))
      .filter(Boolean);
    records = records.concat(local.added);
    if (projectId) records = records.filter((r) => r.projectId === projectId);
  }

  cache = { summary, records: upperNames(records), assignments, images, _projectId: projectId };
  return cache;
}

/* All records across every project — used only by the global search, loaded
   lazily the first time someone types. Cached separately so it doesn't
   disturb the page's (project-scoped) cache. */
let _searchCache = null;
export async function fetchAllRecords(force = false) {
  if (_searchCache && !force) return _searchCache;
  let records;
  if (LIVE) {
    const snap = await fs.getDocs(fs.collection(db, "records"));
    records = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } else {
    const seed = await fetchJSON("data/records.json");
    const local = loadLocal();
    records = seed.records.map((r, i) => ({ id: `seed_${i}`, ...r }));
    records = records
      .map((r) => (r.id in local.overrides ? local.overrides[r.id] && { ...local.overrides[r.id], id: r.id } : r))
      .filter(Boolean)
      .concat(local.added);
  }
  _searchCache = upperNames(records);
  return _searchCache;
}

const LS_PROJECTS = "collection_projects_v1";
const LS_IMAGES = "collection_projimages_v1";   // { [id]: dataUrl } uploaded photos (local mode)
const LS_PROJMETA = "collection_projmeta_v1";   // { [id]: {name} } project renames (local mode)
async function loadSummary() {
  if (LIVE) {
    try {
      const doc = await fs.getDoc(fs.doc(db, "app", "summary"));
      if (doc.exists()) return doc.data();
    } catch (e) { console.warn("summary doc unavailable, using bundled JSON", e); }
  }
  const base = await fetchJSON("data/projects.json");
  if (!LIVE) {
    // local mode: merge any projects added in this browser, plus name overrides
    const extra = JSON.parse(localStorage.getItem(LS_PROJECTS) || "[]");
    const meta = JSON.parse(localStorage.getItem(LS_PROJMETA) || "{}");
    const have = new Set(base.projects.map((p) => p.id));
    let projects = [...base.projects, ...extra.filter((p) => !have.has(p.id))];
    if (Object.keys(meta).length)
      projects = projects.map((p) => (meta[p.id]?.name ? { ...p, name: meta[p.id].name } : p));
    return { ...base, projects };
  }
  return base;
}

/* ---- project photos (per-project image docs) ----------------------------
   Uploaded building photos are stored one doc per project — LIVE reads the
   `projectImages` collection ({ url }); local mode a localStorage map — so the
   large data URL never bloats the summary doc that every page loads. Consumed
   by the sidebar, dashboard hero and project hero, always with a fallback to
   the static photos/projects/<id>.webp shipped in the repo. */
export async function loadProjectImages(force = false) {
  if (_imagesCache && !force) return _imagesCache;
  const out = {};
  if (LIVE) {
    try {
      const snap = await fs.getDocs(fs.collection(db, "projectImages"));
      snap.docs.forEach((d) => { const u = d.data()?.url; if (u) out[d.id] = u; });
    } catch (e) { console.warn("projectImages unavailable", e); }
  } else {
    try { Object.assign(out, JSON.parse(localStorage.getItem(LS_IMAGES) || "{}")); } catch {}
  }
  _imagesCache = out;
  return out;
}

/** The uploaded-photo map cached by the last loadAll/loadProjectImages call. */
export function cachedImages() { return _imagesCache || {}; }

/** Store (or clear, dataUrl="") a project's building photo. Manager/admin only. */
export async function setProjectImage(projectId, dataUrl) {
  if (LIVE) {
    if (dataUrl) await fs.setDoc(fs.doc(db, "projectImages", projectId), { url: dataUrl, updatedAt: new Date().toISOString() });
    else await fs.deleteDoc(fs.doc(db, "projectImages", projectId));
  } else {
    const map = JSON.parse(localStorage.getItem(LS_IMAGES) || "{}");
    if (dataUrl) map[projectId] = dataUrl; else delete map[projectId];
    localStorage.setItem(LS_IMAGES, JSON.stringify(map));
  }
  _imagesCache = null;
  invalidate();
}

/** Rename a project. Manager/admin only (enforced by rules on the app doc). */
export async function renameProject(projectId, name) {
  name = String(name || "").trim();
  if (!name) throw new Error("Project name cannot be empty.");
  if (LIVE) {
    const summary = await loadSummary();
    const projects = (summary.projects || []).map((p) => (p.id === projectId ? { ...p, name } : p));
    await fs.setDoc(fs.doc(db, "app", "summary"), { ...summary, projects });
  } else {
    // custom-added projects live in LS_PROJECTS; seeded ones use a name-override map
    const extra = JSON.parse(localStorage.getItem(LS_PROJECTS) || "[]");
    const i = extra.findIndex((p) => p.id === projectId);
    if (i >= 0) {
      extra[i] = { ...extra[i], name };
      localStorage.setItem(LS_PROJECTS, JSON.stringify(extra));
    } else {
      const meta = JSON.parse(localStorage.getItem(LS_PROJMETA) || "{}");
      meta[projectId] = { ...(meta[projectId] || {}), name };
      localStorage.setItem(LS_PROJMETA, JSON.stringify(meta));
    }
  }
  invalidate();
}

/** Add a new (empty) project. Manager/admin only (enforced by rules on the
    app doc). Persisted into the summary so it appears in the sidebar. */
export async function addProject(project) {
  const summary = await loadSummary();
  const projects = summary.projects || [];
  if (projects.some((p) => p.id === project.id)) throw new Error("A project with that name already exists.");
  if (LIVE) {
    await fs.setDoc(fs.doc(db, "app", "summary"), { ...summary, projects: [...projects, project] });
  } else {
    const extra = JSON.parse(localStorage.getItem(LS_PROJECTS) || "[]");
    extra.push(project);
    localStorage.setItem(LS_PROJECTS, JSON.stringify(extra));
  }
  invalidate();
  return project;
}

/** Delete a project: remove all of its unit records and drop it from the
    summary. Manager/admin only (enforced by rules). */
export async function deleteProject(projectId) {
  if (LIVE) {
    // delete records in batches (Firestore batch limit is 500)
    while (true) {
      const snap = await fs.getDocs(fs.query(fs.collection(db, "records"), fs.where("projectId", "==", projectId), fs.limit(400)));
      if (snap.empty) break;
      const batch = fs.writeBatch(db);
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      if (snap.size < 400) break;
    }
    const summary = await loadSummary();
    const projects = (summary.projects || []).filter((p) => p.id !== projectId);
    await fs.setDoc(fs.doc(db, "app", "summary"), { ...summary, projects });
    try { await fs.setDoc(fs.doc(db, "assignments", "projects"), { [projectId]: fs.deleteField() }, { merge: true }); } catch {}
    try { await fs.deleteDoc(fs.doc(db, "projectImages", projectId)); } catch {}
  } else {
    const extra = JSON.parse(localStorage.getItem(LS_PROJECTS) || "[]").filter((p) => p.id !== projectId);
    localStorage.setItem(LS_PROJECTS, JSON.stringify(extra));
    const meta = JSON.parse(localStorage.getItem(LS_PROJMETA) || "{}"); delete meta[projectId];
    localStorage.setItem(LS_PROJMETA, JSON.stringify(meta));
    const imgs = JSON.parse(localStorage.getItem(LS_IMAGES) || "{}"); delete imgs[projectId];
    localStorage.setItem(LS_IMAGES, JSON.stringify(imgs));
    const local = loadLocal();
    local.added = (local.added || []).filter((r) => r.projectId !== projectId);
    if (local.assignments) delete local.assignments[projectId];
    saveLocal(local);
  }
  _imagesCache = null;
  invalidate();
}

export function invalidate() { cache = null; _searchCache = null; }

/* ------------------------------------------------ writes */
function cleanRecord(rec) {
  const out = {};
  for (const [k, v] of Object.entries(rec)) {
    if (k === "id" || v === undefined) continue;
    out[k] = v === "" ? "" : v;
  }
  return out;
}

export async function addRecord(rec) {
  const data = cleanRecord(rec);
  data.createdAt = new Date().toISOString();
  if (LIVE) {
    const ref = await fs.addDoc(fs.collection(db, "records"), data);
    invalidate();
    return ref.id;
  }
  const local = loadLocal();
  const id = `loc_${Date.now()}_${Math.floor(Math.random() * 1e5)}`;
  local.added.push({ id, ...data });
  saveLocal(local);
  invalidate();
  return id;
}

export async function updateRecord(id, rec) {
  const data = cleanRecord(rec);
  data.updatedAt = new Date().toISOString();
  if (LIVE) {
    await fs.setDoc(fs.doc(db, "records", id), data, { merge: true });
    invalidate();
    return;
  }
  const local = loadLocal();
  if (id.startsWith("loc_")) {
    const i = local.added.findIndex((r) => r.id === id);
    if (i >= 0) local.added[i] = { ...local.added[i], ...data, id };
  } else {
    const base = (cache?.records || []).find((r) => r.id === id) || {};
    local.overrides[id] = { ...base, ...data };
    delete local.overrides[id].id;
  }
  saveLocal(local);
  invalidate();
}

export async function deleteRecord(id) {
  if (LIVE) {
    await fs.deleteDoc(fs.doc(db, "records", id));
    invalidate();
    return;
  }
  const local = loadLocal();
  if (id.startsWith("loc_")) {
    local.added = local.added.filter((r) => r.id !== id);
  } else {
    local.overrides[id] = null;
  }
  saveLocal(local);
  invalidate();
}

/* ------------------------------------------------ bulk (import) */
export async function addRecordsBulk(records) {
  const stamp = new Date().toISOString();
  const clean = records.map((r) => ({ ...cleanRecord(r), createdAt: stamp }));
  if (LIVE) {
    for (let i = 0; i < clean.length; i += 400) {
      const batch = fs.writeBatch(db);
      for (const rec of clean.slice(i, i + 400)) batch.set(fs.doc(fs.collection(db, "records")), rec);
      await batch.commit();
    }
    invalidate();
    return clean.length;
  }
  const local = loadLocal();
  clean.forEach((rec, i) =>
    local.added.push({ id: `loc_${Date.now()}_${i}_${Math.floor(Math.random() * 1e5)}`, ...rec }));
  saveLocal(local);
  invalidate();
  return clean.length;
}

/** Delete every record for a project+category (used before a replace-import). */
export async function deleteCategoryRecords(projectId, category) {
  if (LIVE) {
    let removed = 0;
    while (true) {
      const q = fs.query(fs.collection(db, "records"),
        fs.where("projectId", "==", projectId), fs.where("category", "==", category), fs.limit(400));
      const snap = await fs.getDocs(q);
      if (snap.empty) break;
      const batch = fs.writeBatch(db);
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      removed += snap.size;
    }
    invalidate();
    return removed;
  }
  const local = loadLocal();
  const before = local.added.length;
  local.added = local.added.filter((r) => !(r.projectId === projectId && r.category === category));
  for (const r of cache?.records || [])
    if (r.projectId === projectId && r.category === category && !String(r.id).startsWith("loc_"))
      local.overrides[r.id] = null;
  saveLocal(local);
  invalidate();
  return before - local.added.length;
}

/* ------------------------------------------------ derived metrics */

/** Amount still owed on one record. Uses the stored outstanding when entered,
    otherwise the plan-derived due — so a blank figure auto-fills for both 24% DP
    clients (still in the downpayment phase) and installment buyers, keeping the
    dashboard totals in step with the project table and client page. */
function rowDue(r) {
  return dueOf(r);
}

/** Per-project metrics: computed live from unit records when the project
    has any; otherwise the seeded figures from the summary workbook. */
/* `fromRecords` = compute strictly from the given records (zeros when none),
   used by the dashboard's "My units" scope; otherwise fall back to the boss
   summary figures for projects with no imported records. */
export function projectMetrics(project, records, fromRecords = false) {
  const recs = records.filter((r) => r.projectId === project.id);
  if (!recs.length && !fromRecords) return { ...project.metrics, source: "summary" };
  if (!recs.length) {
    const z = { source: "records" };
    for (const cat of window.APP_CONFIG.categories) z[cat.key] = { clients: 0, due: 0 };
    return { ...z, totalUnits: 0, totalDue: 0, unsoldUnits: 0, projectUnits: 0 };
  }

  const m = { source: "records" };
  let withDues = 0, totalDue = 0;
  for (const cat of window.APP_CONFIG.categories) {
    const rows = recs.filter((r) => r.category === cat.key);
    const due = rows.reduce((s, r) => s + rowDue(r), 0);
    m[cat.key] = { clients: rows.length, due: Math.round(due * 100) / 100 };
    if (cat.due) { withDues += rows.length; totalDue += due; }
  }
  m.totalUnits = withDues;
  m.totalDue = Math.round(totalDue * 100) / 100;
  // Unsold / total-unit counts come from the client-wise "available" records
  // when the workbook has them (Peace Lagoons II); otherwise fall back to the
  // boss summary figures, since most workbooks don't list available units.
  const sm = project.metrics || {};
  const hasAvail = (m.available?.clients || 0) > 0;
  // In "My units" scope, count only the officer's units — never the boss summary.
  m.unsoldUnits = hasAvail ? m.available.clients : (fromRecords ? 0 : (sm.unsoldUnits || 0));
  m.projectUnits = hasAvail ? recs.length : (fromRecords ? recs.length : (sm.projectUnits || recs.length));
  return m;
}
