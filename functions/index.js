/* ============================================================
   adminResetPassword — HTTPS Cloud Function.

   Lets a Manager or Admin set a teammate's temporary password.
   A website can't change another user's Firebase password, so the
   app calls this function, which runs with admin privileges.

   This is written as a plain HTTPS function so it can be created &
   deployed straight from the Google Cloud console web UI (no CLI).
   Security: it verifies the caller's Firebase ID token and checks
   they are a Manager (role "boss") or Admin (by email) before doing
   anything, so it is safe even though the URL is public.

   Deploy: see functions/README.md.
   ============================================================ */
const admin = require("firebase-admin");
admin.initializeApp();

// Keep in sync with config.js `superAdmins`.
const SUPER_ADMINS = ["admin@peacehomes.ae"];

exports.adminResetPassword = async (req, res) => {
  // Allow the website to call this from the browser.
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  try {
    const authz = req.get("Authorization") || "";
    const match = authz.match(/^Bearer (.+)$/);
    if (!match) return res.status(401).json({ error: "Please sign in again." });

    const decoded = await admin.auth().verifyIdToken(match[1]);
    const email = String(decoded.email || "").toLowerCase();
    let allowed = SUPER_ADMINS.includes(email);
    if (!allowed) {
      const snap = await admin.firestore().doc(`users/${decoded.uid}`).get();
      allowed = snap.exists && snap.get("role") === "boss";
    }
    if (!allowed) return res.status(403).json({ error: "Only Managers and Admins can reset passwords." });

    const body = req.body || {};
    const uid = body.uid;
    const tempPassword = body.tempPassword;
    if (!uid || !tempPassword || String(tempPassword).length < 6)
      return res.status(400).json({ error: "A user and a password of at least 6 characters are required." });

    // Set the new password and force the user to change it on next sign-in.
    await admin.auth().updateUser(uid, { password: String(tempPassword) });
    await admin.firestore().doc(`users/${uid}`).set({ mustChangePassword: true }, { merge: true });
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Could not reset the password." });
  }
};
