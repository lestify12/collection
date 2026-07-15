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

Run these **from the project root** (the folder that contains `firebase.json`).
The project is already set in `.firebaserc`, so you don't need `firebase use`.

1. Install the Firebase CLI (once, on your computer):
   ```
   npm install -g firebase-tools
   firebase login
   ```
2. Install the function's dependencies and deploy:
   ```
   cd functions && npm install && cd ..
   firebase deploy --only functions
   ```

If `firebase deploy` still says "not a Firebase project directory", make sure
you're in the folder that has `firebase.json` (the repo root), not inside
`functions/`.

You can also push the Firestore security rules from here with:
```
firebase deploy --only firestore:rules
```

## Notes
- Cloud Functions require the Firebase **Blaze (pay-as-you-go)** plan. This
  function is tiny and typically stays within the free monthly allowance.
- If you add or change system admins, keep `SUPER_ADMINS` in `functions/index.js`
  in sync with `superAdmins` in `js/config.js`.
- Until this function is deployed, the reset dialog on the live site will say
  the server function isn't enabled yet (it works right away in local/testing).
