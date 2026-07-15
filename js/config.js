/* ============================================================
   App configuration
   ------------------------------------------------------------
   To go live with Firebase:
   1. Create a project at https://console.firebase.google.com
   2. Add a Web App, copy its config object into `firebase` below.
   3. Enable Cloud Firestore (production mode) and publish the
      rules from /firestore.rules.
   4. Open /seed.html once to import the Excel seed data.

   While `firebase.apiKey` is empty the app runs in LOCAL mode:
   it reads the bundled JSON seed data and stores your edits in
   this browser's localStorage.
   ============================================================ */

window.APP_CONFIG = {
  firebase: {
    apiKey: "AIzaSyDb5PzobUO0YjAdAnmmOOiDQn9_JdNkDzM",
    authDomain: "collection-tracker-6cda7.firebaseapp.com",
    projectId: "collection-tracker-6cda7",
    storageBucket: "collection-tracker-6cda7.firebasestorage.app",
    messagingSenderId: "818800487630",
    appId: "1:818800487630:web:86cf42f627c185b993b49f",
  },


  currency: "AED",

  /* System / IT administrators (by email). These accounts always have full
     Manager powers — including changing everyone's roles — no matter what
     role is stored on their profile. Keep this list short. */
  superAdmins: ["admin@peacehomes.ae"],

  /* Which projects to show across the whole app (dashboard, nav, totals).
     Leave as an empty array [] to show ALL projects from the summary.
     Listed here are the projects we have client-wise data loaded for. To show
     every project (including those still on summary figures only), empty this
     array. */
  onlyProjects: [
    "peace-lagoons-ii-tower-a", "peace-lagoons-ii-tower-b",
    "natuzzi-harmony-residences", "sky-vista", "peace-avenue",
    "peace-lagoons-tower-a", "peace-lagoons-tower-b", "sky-line", "sky-livings",
    "sky-suites",
  ],

  /* Category registry — colors are fixed identity slots from the
     validated palette (see css/style.css). Order here is the
     canonical stacking/legend order everywhere in the app. */
  categories: [
    { key: "installment", label: "Installment Due",            short: "Installment", color: "var(--cat-installment)", due: true },
    { key: "legal",       label: "Legal Case Due",             short: "Legal",       color: "var(--cat-legal)",       due: true },
    { key: "dnc",         label: "DNC Clients",                short: "DNC",         color: "var(--cat-dnc)",         due: true },
    { key: "dp24",        label: "24% Downpayment Due",        short: "24% DP",      color: "var(--cat-dp24)",        due: true },
    { key: "cancelled",   label: "Unit Cancelled by Client",   short: "Cancelled",   color: "var(--cat-cancelled)",   due: true },
    { key: "others",      label: "Others / Returned to Inventory", short: "Others",  color: "var(--cat-others)",      due: false, showDue: true },
    { key: "available",   label: "Available Units",            short: "Available",   color: "var(--cat-available)",   due: false },
  ],
};
