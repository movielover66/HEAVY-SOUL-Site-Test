// ============================================================
// HEAVY SOUL — CONSOLE DEBUGGER & HEALTH MONITOR
// ============================================================
(function() {
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;

    // স্টাইলিশ কনসোল লোগো ও হেডার
    console.clear();
    console.log(
        "%c HEAVY SOUL %c Live Diagnostic & Monitor Active ",
        "background: #000; color: #fff; font-weight: bold; padding: 4px 8px; border-radius: 4px 0 0 4px;",
        "background: #333; color: #ff5555; font-weight: bold; padding: 4px 8px; border-radius: 0 4px 4px 0;"
    );

    // ১. গ্লোবাল এরর ট্র্যাকিং (কোড ফেইল করলে কেন করছে তা ধরা)
    window.onerror = function(msg, url, line, col, error) {
        console.group("%c❌ JavaScript Runtime Error Detected", "color: #ff3333; font-weight: bold;");
        console.log(`%cMessage: %c${msg}`, "color: #666;", "color: #ff3333;");
        console.log(`%cSource: %c${url}:${line}:${col}`, "color: #666;", "color: #000;");
        if (error && error.stack) {
            console.log(`%cStack Trace:\n%c${error.stack}`, "color: #666;", "color: #888;");
        }
        console.log("%c💡 কিভাবে ঠিক করবেন: %cউক্ত ফাইলের নির্দিষ্ট লাইন নম্বর চেক করুন এবং সিনট্যাক্স বা ভ্যারিয়েবল আনডিফাইন্ড (undefined) আছে কিনা যাচাই করুন।", "color: #000; font-weight: bold;", "color: #0055ff;");
        console.groupEnd();
        return false;
    };

    // ২. আনহ্যান্ডলড প্রমিজ রিজেকশন (API বা Fetch ফেইল করলে কেন করছে তা ধরা)
    window.addEventListener('unhandledrejection', function(event) {
        console.group("%c⚠️ Unhandled Promise Rejection (Network/API Error)", "color: #ff9900; font-weight: bold;");
        console.log(`%cReason: %c${event.reason}`, "color: #666;", "color: #ff9900;");
        console.log("%c💡 কিভাবে ঠিক করবেন: %cআপনার API এন্ডপয়েন্ট (যেমন Apps Script URL) অথবা ফেচ রিকোয়েস্টের নেটওয়ার্ক কানেকশন চেক করুন। CORS বা ভুল URL-এর কারণে এটি হতে পারে।", "color: #000; font-weight: bold;", "color: #0055ff;");
        console.groupEnd();
    });

    // ৩. সাইটের বেসিক হেলথ চেক (কনসোলে টাইপ করে দেখতে পারবেন)
    window.checkHeavySoulHealth = function() {
        console.group("🔍 HEAVY SOUL SYSTEM HEALTH CHECK");
        
        // Config Check
        if (typeof SITE_CONFIG !== 'undefined') {
            console.log("✅ SITE_CONFIG: Loaded successfully");
            console.log("🔗 Apps Script URL:", SITE_CONFIG.APPS_SCRIPT_URL ? "Configured" : "Missing");
        } else {
            console.error("❌ SITE_CONFIG: Not found! Check if config.js is loaded properly.");
        }

        // Cart Check
        try {
            const cart = JSON.parse(localStorage.getItem('heavySoulCart') || '[]');
            console.log(`🛒 LocalStorage Cart: ${cart.length} item(s) found.`);
        } catch (e) {
            console.error("❌ LocalStorage Cart: Corrupted data format.");
        }

        // Firebase Check
        if (window.firebase && firebase.apps.length > 0) {
            console.log("🔥 Firebase: Connected (" + firebase.app().name + ")");
        } else {
            console.warn("⚠️ Firebase: Not initialized or skipped.");
        }

        console.groupEnd();
        return "Health check complete. Check logs above.";
    };

    console.log("ℹ️ টিপস: সাইটের যেকোনো সময় বর্তমান অবস্থা জানতে কনসোলে %ccheckHeavySoulHealth()%c লিখে এন্টার দিন।", "font-family: monospace; background: #eee; padding: 2px 4px;", "");
})();
