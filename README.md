# Collection Tracker

A modern, dependency-free web app (HTML + CSS + JS + JSON) for tracking
collection / outstanding dues across all projects.

- **Analytics Dashboard** (`index.html`) — the boss view. Animated KPIs,
  outstanding-by-project chart, portfolio composition, and the full
  all-projects summary table (mirrors the summary Excel).
- **Project pages** (`project.html?id=…`) — one per project via the sidebar
  nav. Category tabs (Installment / Legal / DNC / 24% DP / Cancelled /
  Available), searchable client-wise tables, CSV export, and add / edit /
  delete record forms. This is where each team enters its data.
- **Database** — Firebase Cloud Firestore. Until Firebase is configured the
  app runs in **local mode**: it shows the bundled Excel seed data
  (`data/*.json`) and keeps edits in the browser's localStorage, so you can
  demo and test everything immediately.

Currently seeded with client-wise data for **Peace Lagoons II Tower A & B**
(831 units, verified line-by-line against the source workbook). The other
eight projects show their summary figures from the boss workbook and have
empty client-wise tables ready for data entry.

## Structure

```
index.html          dashboard (analytics, boss view)
project.html        project detail + data entry (?id=<project-id>)
seed.html           one-time Firestore import of the bundled seed data
css/style.css       design system, light + dark theme, animations
js/config.js        ← Firebase config goes here
js/db.js            data layer (Firestore ⇄ local JSON fallback)
js/ui.js            shared UI helpers
js/dashboard.js     dashboard rendering
js/project.js       project page rendering + forms
data/projects.json  all-projects summary (from the summary Excel)
data/records.json   client-wise unit records (from the PL II workbook)
firestore.rules     Firestore security rules
```

## 1 · Connect Firebase

1. Go to [console.firebase.google.com](https://console.firebase.google.com) →
   **Add project** (e.g. `collection-tracker`). Google Analytics optional.
2. In the project: **Build → Firestore Database → Create database** →
   production mode → choose a region close to you (e.g. `me-central1`).
3. **Project settings → Your apps → Web app (</>)** → register app → copy the
   `firebaseConfig` object.
4. Paste its values into `js/config.js` under `firebase: { … }`.
5. **Firestore → Rules** → paste the contents of `firestore.rules` → Publish.
   > V1 rules are open (no login yet). Keep the URL private; when you're
   > ready, enable Firebase Authentication and switch to the locked variant
   > commented inside `firestore.rules`.
6. Deploy (or run locally), open **`/seed.html`** once and click
   **Import seed data**. The dashboard badge flips to **Live · Firebase**.

## 2 · Deploy to Cloudflare Pages

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages →
   Create → Pages → Connect to Git** → pick this repository.
2. Build settings: framework preset **None**, build command **(leave empty)**,
   output directory **`/`** (root). Save & deploy.
3. Every push to the connected branch auto-deploys. Custom domains can be
   added under the Pages project → Custom domains.

No build step, no npm — the site is served as-is.

## Run locally

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

(Any static server works; opening index.html via file:// won't, because the
app fetches JSON.)

## Data model

Firestore collections:

- `app/summary` — one document: the all-projects summary
  (title, reportDate, target, `projects[]` with id, name, handler, metrics).
- `records` — one document per unit/client record:
  `projectId`, `category` (`dp24 | installment | legal | dnc | cancelled |
  available`), `unitNo`, `bookingDate`, `agent`, `type`, `buyerName`,
  `paymentPlan`, `sellingPrice`, `dld`, `adminFee`, `dp20`, `dpTotal`,
  `reflected`, `monthlyInstallment`, `outstanding`, `unsettledMonths`,
  `remarks`.

Dashboard figures for a project are computed live from its `records` when it
has any (marked with a green dot in the summary table); otherwise the seeded
workbook figures are shown. So as teams enter data project by project, the
boss dashboard switches to live numbers automatically.

## Notes on the source data

- The Peace Lagoons II workbook's own SUMMARY sheet shows legal dues of
  3,692,493.44 — that figure comes from a `SUBTOTAL` over a **filtered**
  sheet which hides all 30 Tower B legal rows. The true total (A + B) is
  7,190,491.50, which matches the boss summary workbook exactly.
- Its cancelled-units total also missed the two newest rows (B1109, B514);
  the app uses the correct 2,303,184.69.
