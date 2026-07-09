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
    apiKey: "",
    authDomain: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: "",
  },

  currency: "AED",

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
