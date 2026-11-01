# New checkout (Address + Payment) — drop-in

Copy to the same paths in the repo (checkout.html, payment.html and js/payment.js REPLACE the current ones):

    checkout.html            (replaces)  Step 2: address
    payment.html             (replaces)  Step 3: payment
    js/payment.js            (replaces)  + alternative number in the order + WhatsApp message
    css/checkout-flow.css    (new)       layout
    css/checkout-anim.css    (new)       every animation
    js/address-book.js       (new)       saved addresses (max 3) + delivery estimate
    js/checkout.js           (replaces)  saved-address flow, full details form, validation
    js/payment-fx.js         (new)       recap, method amounts, countdown ring

Needs css/theme.css (already in your repo). No new images or libraries
(only the Caveat font from Google Fonts for the handwritten accents).

Unchanged: stock check, abandoned-cart log, Razorpay flow, COD advance maths,
10-minute window, order sheet fields (only `altPhone` is added).
Saved addresses: localStorage on the device + (when logged in) Firestore field
`addressBook` on the existing users/{uid} document. If your Firestore rules only
allow specific fields on that document, add `addressBook`; otherwise nothing to do.
