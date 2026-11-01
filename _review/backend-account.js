document.addEventListener('DOMContentLoaded', () => {
  if (!window.firebase || !firebase.apps.length) return;

  firebase.auth().onAuthStateChanged(async (user) => {
    const name = document.querySelector('.profile-name');
    const email = document.querySelector('.profile-email');
    const avatar = document.querySelector('.profile-avatar');
    const logout = document.querySelector('.btn-logout');

    if (!user) {
      if (name) name.textContent = 'Guest';
      if (email) email.textContent = 'Not logged in';
      if (avatar) avatar.textContent = 'HS';
      if (logout) logout.onclick = () => authLogOut();
      return;
    }

    if (name) name.textContent = user.displayName || 'Heavy Souler';
    if (avatar) avatar.textContent = (user.displayName || 'HS').slice(0, 2).toUpperCase();
    if (logout) logout.onclick = () => authLogOut();

    // Don't trust the Firebase Auth user object's .email field for display —
    // phone-signup accounts are created with a synthetic
    // "<phone>@phone.heavysoul.in" email purely so Firebase Auth (email/
    // password only, on the free Spark plan) has something to key on. The
    // REAL phone number lives in Firestore's users/{uid} doc instead
    // (see auth-unified.js's uUpsertUserDoc_ call at signup).
    if (email) {
      email.textContent = '…'; // brief placeholder while Firestore loads
      try {
        const doc = await firebase.firestore().collection('users').doc(user.uid).get();
        const data = doc.exists ? doc.data() : null;

        if (data && data.phone) {
          email.textContent = 'Phone: +91 ' + data.phone;
        } else if (data && data.email) {
          email.textContent = data.email;
        } else if (user.email && !user.email.endsWith('@phone.heavysoul.in')) {
          // Fallback for accounts without a Firestore doc yet (e.g. very
          // old Google sign-ins) — only show if it's a real email, never
          // the synthetic phone placeholder.
          email.textContent = user.email;
        } else {
          email.textContent = '';
        }
      } catch (err) {
        console.warn('Could not load profile contact info:', err);
        email.textContent = '';
      }
    }
  });
});
