# Support tickets + live refund status — drop-in

Copy every file in this zip to the same path in the repo (they overwrite the
current versions), commit, let Cloudflare build.

NEW:      support.html  admin-support.html  css/support.css  css/refund.css
          js/support.js  js/admin-support.js  js/refund-status.js
          src/lib/support.js  src/lib/refunds.js
CHANGED:  src/index.js (2 imports + 2 routes)  js/track.js  track.html
          index.html (footer link)  admin.html (link to ticket inbox)

## One-time checks
1. Firestore must exist in Firebase project `heavy-soul-auth` (it does — the
   account page already uses it). Tickets live in collection `supportTickets`.
   Only the Worker touches it, so DO NOT add client rules for it (default deny).
2. The Worker reuses the secrets signup already needs:
   FIREBASE_SERVICE_ACCOUNT_EMAIL (secrets store) and
   FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY (Worker secret). If signup works, this works.
   The service account must be allowed to use Firestore (the default
   firebase-adminsdk account is).
3. Admin inbox: open /admin-support.html (or the "Support tickets" link in
   admin.html). It uses the same admin password as admin.html.

## Endpoints added
POST /api/support/create | lookup | reply | admin/list | admin/reply
GET  /api/refund-status?orderId=...   (read-only, live from Razorpay)

## Refunds
The refund card only READS from Razorpay. Create the refund in the Razorpay
dashboard (Payments -> Refund) and it shows up on the customer's track page by
itself. Orders are matched by Razorpay `receipt` = Heavy Soul order id.
