// ============================================================
// HEAVY SOUL — ANALYTICS LOADER
// Loads GA4 and/or Meta Pixel, but only once real IDs are set in
// js/config.js (SITE_CONFIG.ANALYTICS). Until then this does nothing,
// so there's nothing to remove later — just fill in config.js.
// ============================================================

(function () {
  const cfg = (window.SITE_CONFIG && window.SITE_CONFIG.ANALYTICS) || {};

  // ---- GA4 ----
  const ga4Id = cfg.GA4_ID;
  if (ga4Id && !ga4Id.includes("XXXXXXXXXX")) {
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + ga4Id;
    document.head.appendChild(s);

    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    gtag("js", new Date());
    gtag("config", ga4Id);
  }

  // ---- Meta Pixel ----
  const pixelId = cfg.META_PIXEL_ID;
  if (pixelId && !/^0+$/.test(pixelId)) {
    (function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n; n.loaded = true; n.version = "2.0";
      n.queue = []; t = b.createElement(e); t.async = true;
      t.src = v; s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    fbq("init", pixelId);
    fbq("track", "PageView");
  }

  // ---- Helper: fire a standard e-commerce event on both, where configured ----
  // Call this from checkout/payment/success flows, e.g.:
  //   trackEvent("Purchase", { value: 999, currency: "INR" });
  window.trackEvent = function (eventName, params) {
    params = params || {};
    if (window.gtag) gtag("event", eventName, params);
    if (window.fbq) fbq("track", eventName, params);
  };
})();
