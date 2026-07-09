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

  /* Which projects to show across the whole app (dashboard, nav, totals).
     Leave as an empty array [] to show ALL projects from the summary.
     Right now we only have client-wise data for Peace Lagoons II, so the
     app is scoped to those two towers. To bring the other projects back,
     just empty this array (or add their ids). */
  onlyProjects: ["peace-lagoons-ii-tower-a", "peace-lagoons-ii-tower-b"],

  /* Category registry — colors are fixed identity slots from the
     validated palette (see css/style.css). Order here is the
     canonical stacking/legend order everywhere in the app. */
  categories: [
    { key: "installment", label: "Installment Due",            short: "Installment", color: "var(--cat-installment)", due: true },
    { key: "legal",       label: "Legal Case Due",             short: "Legal",       color: "var(--cat-legal)",       due: true },
    { key: "dnc",         label: "DNC Clients",                short: "DNC",         color: "var(--cat-dnc)",         due: true },
    { key: "dp24",        label: "24% Downpayment Due",        short: "24% DP",      color: "var(--cat-dp24)",        due: true },
    { key: "cancelled",   label: "Unit Cancelled by Client",   short: "Cancelled",   color: "var(--cat-cancelled)",   due: true },
    { key: "available",   label: "Available Units",            short: "Available",   color: "var(--cat-available)",   due: false },
  ],
};
