# Heavy Soul — new login/signup: setup & test

## Files changed / added
- account.html            new login/signup UI (links css/auth.css)
- css/auth.css            NEW  styles + animations
- js/auth-unified.js      rewritten (smart detector, dual signup, OTP boxes, lock)
- js/auth.js              + authSignInWithCustomToken, 8-char message
- reset-password.html     min password 8
- src/index.js            NEW endpoints: /api/signup, /api/login-phone, /api/login-otp,
                          /api/account-check (is this email/number already a user? read from Firebase Auth)
                          /api/phone-forgot-password now finds new + old accounts
- src/lib/gauth.js        + createFirebaseCustomToken
- wrangler.jsonc          + FIREBASE_WEB_API_KEY, FIREBASE_PROJECT_ID, OTP_BINDING

## Do these in order
1. Firebase Console -> Firestore -> Rules: paste
     match /accountIndex/{id} {
       allow get: if true;
       allow list: if false;
       allow create: if request.auth != null && request.auth.uid == request.resource.data.uid;
       allow update, delete: if false;
     }
     match /users/{uid} {
       allow get, create, update: if request.auth != null && request.auth.uid == uid;
     }
2. Firebase Console -> Authentication -> Settings: keep "Email enumeration protection" ON.
3. The service account behind FIREBASE_SERVICE_ACCOUNT_EMAIL must be allowed to
   manage Auth users (role "Firebase Authentication Admin" or "Firebase Admin").
   It already resets passwords, so it probably is.
4. Deploy: `npx wrangler deploy`
5. MSG91 phone binding check (IMPORTANT):
   run `npx wrangler tail`, do one OTP login, look for the line
   "OTP binding: MSG91 response carried no phone number".
   - If you see it: /api/login-otp refuses (on purpose). Ask MSG91 support which field
     of verifyAccessToken carries the mobile number, or keep password login only.
   - If you do NOT see it: set "OTP_BINDING": "strict" in wrangler.jsonc and redeploy.
6. Cloudflare dashboard -> Security -> WAF -> Rate limiting: add a rule for
   /api/login-phone, /api/login-otp, /api/signup, /api/account-check (e.g. 10 requests / minute / IP).

## Test checklist
- Sign up with email + mobile + OTP  -> logged in, account page shows both.
- Log out. Log in with the email + password.
- Log out. Log in with the mobile + password (same account).
- Log in with mobile OTP.
- Type an existing email/number on the Sign up tab -> "already registered, log in instead".
- Forgot password with email -> link mail; with mobile -> OTP -> new password.
- An OLD phone-only account still logs in with mobile + password.
- Google login still works.

## Known limits
- Email is not verified at signup (a verification mail is sent best-effort).
- accountIndex is public by design (no personal data inside) so the page can say
  "account found". Anyone can test whether an email/number is registered.
- Email-OTP is not included (you chose Firebase reset links).
