/* ============================================================
   Data layer — Firebase Firestore when configured, otherwise
   bundled JSON seed data + localStorage for local edits.
   Exposes the same API in both modes.
   ============================================================ */

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
    let touched = 0;
    let last = null;
    while (true) {
      let q = fs.query(fs.collection(db, "records"), fs.where("projectId", "==", projectId), fs.limit(400));
      const snap = await fs.getDocs(q);
      if (snap.empty) break;
      const batch = fs.writeBatch(db);
      snap.docs.forEach((d) => batch.set(d.ref, patch, { merge: true }));
      await batch.commit();
      touched += snap.size;
      if (snap.size < 400) break;
      if (last === snap.docs[0].id) break;   // guard against loops
      last = snap.docs[0].id;
    }
    invalidate();
    return touched;
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

/* ------------------------------------------------ local overlay */
function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || { added: [], overrides: {} }; }
  catch { return { added: [], overrides: {} }; }
}
function saveLocal(state) { localStorage.setItem(LS_KEY, JSON.stringify(state)); }

/* ------------------------------------------------ cache */
let cache = null;

async function fetchJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

/** Loads everything the pages need: { summary, records }.
    Every signed-in user reads all records (officers see all projects);
    write access is enforced separately in the UI and Firestore rules. */
export async function loadAll(force = false, scope = null) {
  if (cache && !force) return cache;

  const summary = await loadSummary();
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
      .filter(Boolean);
    records = records.concat(local.added);
  }

  cache = { summary, records };
  return cache;
}

async function loadSummary() {
  if (LIVE) {
    try {
      const doc = await fs.getDoc(fs.doc(db, "app", "summary"));
      if (doc.exists()) return doc.data();
    } catch (e) { console.warn("summary doc unavailable, using bundled JSON", e); }
  }
  return fetchJSON("data/projects.json");
}

export function invalidate() { cache = null; }

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

/** Amount still owed on one record. For 24% DP clients the workbook often
    leaves the outstanding column blank (they're in the downpayment phase),
    so fall back to the remaining downpayment = (DP + DLD + admin) − reflected. */
function rowDue(r, catKey) {
  const stored = Number(r.outstanding) || 0;
  if (catKey === "dp24" && stored <= 0) {
    const dpTarget = Number(r.dpTotal) || Number(r.dpAmount)
      || ((Number(r.dp20) || 0) + (Number(r.dld) || 0) + (Number(r.adminFee) || 0))
      || (Number(r.sellingPrice) ? 0.24 * Number(r.sellingPrice) : 0);
    return Math.max(0, dpTarget - (Number(r.reflected) || 0));
  }
  return stored;
}

/** Per-project metrics: computed live from unit records when the project
    has any; otherwise the seeded figures from the summary workbook. */
export function projectMetrics(project, records) {
  const recs = records.filter((r) => r.projectId === project.id);
  if (!recs.length) return { ...project.metrics, source: "summary" };

  const m = { source: "records" };
  let withDues = 0, totalDue = 0;
  for (const cat of window.APP_CONFIG.categories) {
    const rows = recs.filter((r) => r.category === cat.key);
    const due = rows.reduce((s, r) => s + rowDue(r, cat.key), 0);
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
  m.unsoldUnits = hasAvail ? m.available.clients : (sm.unsoldUnits || 0);
  m.projectUnits = hasAvail ? recs.length : (sm.projectUnits || recs.length);
  return m;
}
