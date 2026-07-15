/* ============================================================
   Cloud Functions for the Collection Tracker.

   adminResetPassword — lets a Manager or Admin set a teammate's
   temporary password. The browser cannot change another user's
   Firebase password for security reasons, so the app calls this
   function, which runs with admin privileges.

   Deploy: see functions/README.md (needs the Firebase Blaze plan).
   ============================================================ */
const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

// Keep in sync with config.js `superAdmins`.
const SUPER_ADMINS = ["admin@peacehomes.ae"];

exports.adminResetPassword = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Please sign in.");
  }
  // Caller must be a system Admin (by email) or a Manager (role === "boss").
  const email = String(context.auth.token.email || "").toLowerCase();
  let allowed = SUPER_ADMINS.includes(email);
  if (!allowed) {
    const snap = await admin.firestore().doc(`users/${context.auth.uid}`).get();
    allowed = snap.exists && snap.get("role") === "boss";
  }
  if (!allowed) {
    throw new functions.https.HttpsError("permission-denied", "Only Managers and Admins can reset passwords.");
  }

  const uid = data && data.uid;
  const tempPassword = data && data.tempPassword;
  if (!uid || !tempPassword || String(tempPassword).length < 6) {
    throw new functions.https.HttpsError("invalid-argument", "A user and a password of at least 6 characters are required.");
  }

  // Set the new password, and force the user to change it on next sign-in.
  await admin.auth().updateUser(uid, { password: String(tempPassword) });
  await admin.firestore().doc(`users/${uid}`).set({ mustChangePassword: true }, { merge: true });
  return { ok: true };
});
