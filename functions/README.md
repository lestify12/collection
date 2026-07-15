# Cloud Functions — password reset

The app lets Managers/Admins set a teammate's **temporary password** from the
Team & access page. For security, a website can't change another person's
Firebase password directly, so the app calls this small server function
(`adminResetPassword`) which runs with admin privileges.

## What it does
- Checks the caller is a **Manager** (role `boss`) or **Admin** (email in the
  super-admins list).
- Sets the chosen temporary password on the target user.
- Flags the target so they must set their own password on next sign-in
  (same as a new account).

## One-time setup / deploy

1. Install the Firebase CLI (once, on your computer):
   ```
   npm install -g firebase-tools
   firebase login
   ```
2. From the project root:
   ```
   firebase use collection-tracker-6cda7
   cd functions && npm install && cd ..
   firebase deploy --only functions
   ```

## Notes
- Cloud Functions require the Firebase **Blaze (pay-as-you-go)** plan. This
  function is tiny and typically stays within the free monthly allowance.
- If you add or change system admins, keep `SUPER_ADMINS` in `functions/index.js`
  in sync with `superAdmins` in `js/config.js`.
- Until this function is deployed, the reset dialog on the live site will say
  the server function isn't enabled yet (it works right away in local/testing).
