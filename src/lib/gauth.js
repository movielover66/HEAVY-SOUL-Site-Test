// Minimal Google service-account OAuth2 helper for Cloudflare Workers.
// Signs a JWT assertion with the service account's private key (RS256)
// using the native Web Crypto API (no firebase-admin — it isn't
// Workers-compatible), then exchanges it for a short-lived Google
// OAuth2 access token via the standard JWT-bearer flow.

function base64url(input) {
  let bin;
  if (typeof input === "string") {
    bin = unescape(encodeURIComponent(input));
  } else {
    const bytes = new Uint8Array(input);
    bin = "";
    for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToArrayBuffer(pem) {
  const clean = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\\n/g, "")   // literal backslash-n text (secret pasted with escaped newlines, not real line breaks)
    .replace(/\s+/g, "");  // any actual whitespace/newlines
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function getGoogleAccessToken(clientEmail, privateKeyPem, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: clientEmail,
    scope: scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  };

  const signingInput = base64url(JSON.stringify(header)) + "." + base64url(JSON.stringify(claims));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const jwt = signingInput + "." + base64url(signature);

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + encodeURIComponent(jwt)
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) throw new Error("Google OAuth2 token exchange failed: " + JSON.stringify(tokenData));
  return tokenData.access_token;
}


// Mints a Firebase CUSTOM TOKEN for a uid. The browser exchanges it with
// firebase.auth().signInWithCustomToken(token). Used after the Worker has
// itself proven who the person is (password checked, or OTP verified), so
// the real email behind a phone login is never sent to the browser.
export async function createFirebaseCustomToken(clientEmail, privateKeyPem, uid) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: clientEmail,
    sub: clientEmail,
    aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
    iat: now,
    exp: now + 3600,
    uid: uid
  };
  const signingInput = base64url(JSON.stringify(header)) + "." + base64url(JSON.stringify(claims));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );
  return signingInput + "." + base64url(signature);
}
