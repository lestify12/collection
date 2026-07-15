# Password‑reset function — deploy from the browser (no CLI)

The Team page's **Reset password → temporary password** action needs one small
server function, because a website can't change another person's Firebase
password on its own. You can create and deploy it entirely in the browser
using the **Google Cloud console** (same Google login as Firebase).

## Deploy it (all in the browser)

1. Go to **https://console.cloud.google.com** and, in the top bar, make sure the
   selected project is **collection-tracker-6cda7**.
2. In the search box type **Cloud Run functions** (older name: *Cloud
   Functions*) and open it. If prompted, **enable the API** and **upgrade to the
   Blaze (pay‑as‑you‑go) plan** — this is required for any function. (This
   function is tiny and normally stays within the free monthly allowance.)
3. Click **Create function** and set:
   - **Environment:** 2nd gen
   - **Function name:** `adminResetPassword`
   - **Region:** `us-central1`
   - **Trigger:** HTTPS
   - **Authentication:** *Allow unauthenticated invocations* (the function
     checks the caller's login itself, so this is safe)
   - Click **Next**.
4. **Runtime:** Node.js 20.  **Entry point:** `adminResetPassword`.
5. In the code editor on the left, open **index.js**, select all, delete, and
   paste the contents of this repo's `functions/index.js`.
6. Open **package.json** in that editor and paste the contents of this repo's
   `functions/package.json`.
7. Click **Deploy** and wait ~1–2 minutes.
8. When it finishes, open the function and copy its **URL** (looks like
   `https://adminresetpassword-xxxxxxxx-uc.a.run.app`).
9. Put that URL into **`js/config.js`** → `functionsUrl: "…paste here…"`
   (edit the file on GitHub in the browser, or just send me the URL and I'll set
   it). Once saved, the site redeploys and **Reset password → temporary
   password** works on the live site.

That's it — no CLI, nothing installed on your computer.

## Alternative: deploy with the Firebase CLI (for a developer)
From the repo root (the folder with `firebase.json`):
```
npm install -g firebase-tools && firebase login
cd functions && npm install && cd ..
firebase deploy --only functions
```
(This repo already has `firebase.json` / `.firebaserc`, and the code also works
as a callable — but the browser steps above are the simplest.)

## Note
If you add/remove system admins, keep `SUPER_ADMINS` in `functions/index.js` in
sync with `superAdmins` in `js/config.js`.
