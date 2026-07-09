/* ============================================================
   Data layer — Firebase Firestore when configured, otherwise
   bundled JSON seed data + localStorage for local edits.
   Exposes the same API in both modes.
   ============================================================ */

const FB_VER = "10.12.2";
const LS_KEY = "collection_local_v1";

const cfg = (window.APP_CONFIG && window.APP_CONFIG.firebase) || {};
export const LIVE = !!cfg.apiKey;
export const mode = LIVE ? "live" : "local";

let fs = null;   // firestore module namespace
let db = null;

if (LIVE) {
  const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-app.js`);
  fs = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-firestore.js`);
  db = fs.getFirestore(initializeApp(cfg));
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

/** Loads everything the pages need: { summary, records } */
export async function loadAll(force = false) {
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

/* ------------------------------------------------ derived metrics */

/** Per-project metrics: computed live from unit records when the project
    has any; otherwise the seeded figures from the summary workbook. */
export function projectMetrics(project, records) {
  const recs = records.filter((r) => r.projectId === project.id);
  if (!recs.length) return { ...project.metrics, source: "summary" };

  const m = { source: "records" };
  let withDues = 0, totalDue = 0;
  for (const cat of window.APP_CONFIG.categories) {
    const rows = recs.filter((r) => r.category === cat.key);
    const due = rows.reduce((s, r) => s + (Number(r.outstanding) || 0), 0);
    m[cat.key] = { clients: rows.length, due: Math.round(due * 100) / 100 };
    if (cat.due) { withDues += rows.length; totalDue += due; }
  }
  m.totalUnits = withDues;
  m.totalDue = Math.round(totalDue * 100) / 100;
  m.unsoldUnits = m.available.clients;
  m.projectUnits = recs.length;
  return m;
}
