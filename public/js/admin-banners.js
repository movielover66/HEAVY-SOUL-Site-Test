// Heavy Soul — Admin: "Banners" tab (home page hero slides).
// Loaded after js/admin.js, so it reuses its helpers: $, adminCall, showAdminToast.
(function () {
  var banners = [], editing = null, imgUrl = "", imgUrlM = "", loaded = false;
  var THEME = { ink: "Black + red", ember: "Black + orange", oxblood: "Oxblood", bone: "Bone" };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

  /* ---------- tabs ---------- */
  function showTab(name) {
    var ban = name === "banners", con = name === "content", inv = !ban && !con;
    $("invView").classList.toggle("hidden", !inv);
    $("banView").classList.toggle("hidden", !ban);
    $("conView").classList.toggle("hidden", !con);
    $("addProductBtn").classList.toggle("hidden", !inv);
    $("tabInv").setAttribute("aria-pressed", String(inv));
    $("tabBan").setAttribute("aria-pressed", String(ban));
    $("tabCon").setAttribute("aria-pressed", String(con));
    document.querySelector("h1.title").textContent = ban ? "Home page banners" : con ? "Site content" : "Inventory";
    document.querySelector(".head .sub").textContent = ban
      ? "The big slides at the top of the home page. Add, edit, hide or re-order them. Changes show on the site within a minute."
      : con
      ? "Every line of text and photo on the home page (except the big banners). Change anything, tap “Save all changes”."
      : "Mark a whole product or a single size as out of stock. The storefront updates right away.";
    if (ban && !loaded) loadBanners();
    if (con) window.dispatchEvent(new CustomEvent("hs:tab", { detail: "content" }));
    try { sessionStorage.setItem("hs_admin_tab", name); } catch (e) {}
  }
  $("tabInv").addEventListener("click", function () { showTab("inventory"); });
  $("tabBan").addEventListener("click", function () { showTab("banners"); });
  $("tabCon").addEventListener("click", function () { showTab("content"); });
  try { var _t = sessionStorage.getItem("hs_admin_tab"); if (_t === "banners" || _t === "content") setTimeout(function () { showTab(_t); }, 0); } catch (e) {}

  /* ---------- list ---------- */
  function render() {
    if (!banners.length) { $("bnList").innerHTML = '<p class="empty">No banners yet. Tap “+ Add banner”.</p>'; return; }
    $("bnList").innerHTML = banners.map(function (b, i) {
      var off = b.status === "Hidden", photo = b.layout === "photo";
      var title = photo ? "Photo only" : (esc(b.line1) + " " + esc(b.line2));
      var meta = photo ? "Photo banner (no text added)" : esc(b.kicker) + " · " + esc(b.text);
      return '<div class="bncard' + (off ? " off" : "") + '"><img src="' + esc(b.image) + '" alt="" onerror="this.style.opacity=.2">' +
        '<div><div class="pname">' + title + (off ? '<span class="badge">Hidden</span>' : "") + (b.imageMobile ? '<span class="badge">Phone photo</span>' : "") + "</div>" +
        '<div class="pmeta">' + meta + "</div>" +
        '<div class="pmeta">Opens: ' + esc(b.buttonLink || "shop.html") + (photo ? "" : " · " + esc(THEME[b.theme] || b.theme)) + "</div></div>" +
        '<div class="bnacts"><button class="btn sm" data-a="up" data-id="' + b.id + '"' + (i === 0 ? " disabled" : "") + ' aria-label="Move earlier">↑</button>' +
        '<button class="btn sm" data-a="down" data-id="' + b.id + '"' + (i === banners.length - 1 ? " disabled" : "") + ' aria-label="Move later">↓</button>' +
        '<button class="btn sm" data-a="edit" data-id="' + b.id + '">Edit</button>' +
        '<button class="btn sm" data-a="toggle" data-id="' + b.id + '">' + (off ? "Show" : "Hide") + "</button>" +
        '<span style="flex:1"></span><button class="btn sm danger" data-a="del" data-id="' + b.id + '">Delete</button></div></div>';
    }).join("");
  }
  function find(id) { return banners.filter(function (b) { return String(b.id) === String(id); })[0]; }

  async function loadBanners() {
    $("bnStatus").textContent = "Loading…";
    try {
      var d = await adminCall("admin_list_banners");
      if (!d || !d.success) { $("bnStatus").textContent = (d && /password|unauthorized/i.test(d.error || "")) ? "Session expired — log out and log in again." : ((d && d.error) || "Could not load banners. Did you deploy the new Apps Script version?"); return; }
      banners = d.banners || []; loaded = true; render(); $("bnStatus").textContent = "";
    } catch (e) { $("bnStatus").textContent = "Error: " + (e && e.message ? e.message : e); }
  }

  /* ---------- form ---------- */
  function syncLayout() {
    var photo = $("bnLayout").value === "photo";
    $("bnTextFields").classList.toggle("hidden", photo);
    $("bnLayoutHint").textContent = photo
      ? "Your photo is shown as it is (like a poster). Nothing is written on top. Best for designed banners that already have text and a button in the picture. Upload a phone version below so it looks right on mobile."
      : "We write the heading, text and button on top of your photo. Leave every text box empty if you want only the photo (full screen, tap opens the link).";
  }
  function setPrev(imgId, url) { var p = $(imgId); if (url) { p.src = url; p.classList.remove("hidden"); } else p.classList.add("hidden"); }
  function openForm(b) {
    editing = b ? b.id : null; imgUrl = b ? b.image : ""; imgUrlM = b ? b.imageMobile : "";
    $("bnTitle").textContent = b ? "Edit banner" : "Add banner";
    $("bnLayout").value = b ? b.layout : "overlay";
    $("bnKicker").value = b ? b.kicker : ""; $("bnL1").value = b ? b.line1 : ""; $("bnL2").value = b ? b.line2 : "";
    $("bnText").value = b ? b.text : ""; $("bnBtn").value = b ? b.buttonText : "Shop now"; $("bnLink").value = b ? b.buttonLink : "shop.html";
    $("bnTheme").value = b ? b.theme : "ink"; $("bnVis").value = b ? b.status : "Active";
    $("bnImg").value = ""; $("bnImgM").value = ""; $("bnImgStatus").textContent = ""; $("bnImgMStatus").textContent = ""; $("bnErr").textContent = "";
    setPrev("bnPrev", imgUrl); setPrev("bnPrevM", imgUrlM); $("bnImgMClear").classList.toggle("hidden", !imgUrlM);
    syncLayout(); $("bnDlg").showModal();
  }
  $("bnAdd").addEventListener("click", function () { openForm(null); });
  $("bnCancel").addEventListener("click", function () { $("bnDlg").close(); });
  $("bnLayout").addEventListener("change", syncLayout);

  function compress(file, maxDim, quality) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onerror = function () { reject(new Error("Could not read file")); };
      r.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error("Could not read image")); };
        img.onload = function () {
          var w = img.width, h = img.height;
          if (Math.max(w, h) > maxDim) { var s = maxDim / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
          var c = document.createElement("canvas"); c.width = w; c.height = h;
          c.getContext("2d").drawImage(img, 0, 0, w, h);
          c.toBlob(function (b) {
            if (!b) return reject(new Error("Compression failed"));
            var o = new FileReader();
            o.onload = function () { resolve({ base64: o.result.split(",")[1], mimeType: "image/jpeg", fileName: "banner-" + Date.now() + ".jpg", w: w, h: h }); };
            o.readAsDataURL(b);
          }, "image/jpeg", quality);
        };
        img.src = r.result;
      };
      r.readAsDataURL(file);
    });
  }

  function wireUpload(inputId, statusId, prevId, setUrl, isMain) {
    $(inputId).addEventListener("change", async function () {
      var f = this.files[0]; if (!f) return;
      $(statusId).textContent = "Uploading…"; $("bnSave").disabled = true;
      try {
        var c = await compress(f, 1600, 0.82);
        var d = await adminCall("admin_upload_image", { imageBase64: c.base64, mimeType: c.mimeType, fileName: c.fileName });
        if (d && d.success) { setUrl(d.url); setPrev(prevId, d.url); $(statusId).textContent = "Uploaded ✓";
          if (isMain && c.w > c.h * 1.25 && $("bnLayout").value === "overlay") { $("bnLayout").value = "photo"; syncLayout(); $(statusId).textContent = "Uploaded ✓ Wide picture, so style was changed to “Photo only” (your text is already in the picture). Change it back above if this is a plain photo."; } $("bnImgMClear").classList.toggle("hidden", !imgUrlM); }
        else $(statusId).textContent = (d && d.error) || "Upload failed.";
      } catch (e) { $(statusId).textContent = "Upload failed — try a smaller photo."; }
      $("bnSave").disabled = false;
    });
  }
  wireUpload("bnImg", "bnImgStatus", "bnPrev", function (u) { imgUrl = u; }, true);
  wireUpload("bnImgM", "bnImgMStatus", "bnPrevM", function (u) { imgUrlM = u; });
  $("bnImgMClear").addEventListener("click", function () { imgUrlM = ""; setPrev("bnPrevM", ""); $("bnImgMClear").classList.add("hidden"); $("bnImgMStatus").textContent = "Removed."; });

  $("bnForm").addEventListener("submit", async function (e) {
    e.preventDefault(); $("bnErr").textContent = "";
    if (!imgUrl) { $("bnErr").textContent = "Please add a photo."; return; }
    var photo = $("bnLayout").value === "photo";
    $("bnSave").disabled = true; $("bnSave").textContent = "Saving…";
    try {
      var d = await adminCall("admin_save_banner", { banner: { id: editing, image: imgUrl, imageMobile: imgUrlM, layout: $("bnLayout").value,
        kicker: $("bnKicker").value, line1: $("bnL1").value, line2: $("bnL2").value,
        text: $("bnText").value, buttonText: $("bnBtn").value, buttonLink: $("bnLink").value, theme: $("bnTheme").value, status: $("bnVis").value } });
      if (d && d.success) { banners = d.banners; render(); $("bnDlg").close(); showAdminToast("Banner saved."); }
      else $("bnErr").textContent = (d && d.error) || "Could not save.";
    } catch (err) { $("bnErr").textContent = "Network error — try again."; }
    $("bnSave").disabled = false; $("bnSave").textContent = "Save banner";
  });

  $("bnList").addEventListener("click", async function (e) {
    var t = e.target.closest("[data-a]"); if (!t) return;
    var b = find(t.dataset.id), a = t.dataset.a; if (!b) return;
    try {
      var d;
      if (a === "edit") return openForm(b);
      if (a === "up" || a === "down") d = await adminCall("admin_move_banner", { id: b.id, dir: a === "up" ? -1 : 1 });
      else if (a === "toggle") d = await adminCall("admin_save_banner", { banner: Object.assign({}, b, { status: b.status === "Hidden" ? "Active" : "Hidden" }) });
      else if (a === "del") { if (!confirm("Delete this banner?")) return; d = await adminCall("admin_delete_banner", { id: b.id }); }
      if (d && d.success) { banners = d.banners; render(); showAdminToast("Done."); } else showAdminToast((d && d.error) || "Something went wrong.");
    } catch (err) { showAdminToast("Network error — try again."); }
  });

  /* ---------- Connect a product + quick labels (UI is added here, admin.html needs no change) ---------- */
  var prodList = [];
  var prodBox = document.createElement("div");
  prodBox.className = "field"; prodBox.id = "bnProdBox";
  prodBox.innerHTML = '<label for="bnProd">Connect a product (tapping the banner opens it)</label>' +
    '<select id="bnProd"><option value="">— No product (use the link below) —</option></select>' +
    '<p class="hint" id="bnProdHint">Pick your new launch or top seller. Empty boxes below fill in by themselves (photo, heading, price) — you can change anything.</p>';
  var layoutField = $("bnLayout").closest(".field");
  layoutField.parentNode.insertBefore(prodBox, layoutField.nextSibling);

  var chips = document.createElement("div");
  chips.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-top:8px";
  ["New launch", "Trending now", "Top selling", "Back in stock", "Limited drop"].forEach(function (t) {
    var b = document.createElement("button"); b.type = "button"; b.className = "btn sm"; b.textContent = t;
    b.addEventListener("click", function () { $("bnKicker").value = t; });
    chips.appendChild(b);
  });
  $("bnKicker").parentNode.appendChild(chips);

  async function loadProds() {
    if (prodList.length) return;
    var list = (typeof currentProducts !== "undefined" && currentProducts && currentProducts.length) ? currentProducts : null;
    if (!list) { try { var d = await adminCall("admin_list_products"); list = (d && d.products) || []; } catch (e) { list = []; } }
    prodList = list.filter(function (p) { return p.status !== "Hidden"; });
    var sel = $("bnProd");
    sel.innerHTML = '<option value="">— No product (use the link below) —</option>' + prodList.map(function (p) {
      return '<option value="' + esc(p.id) + '">' + esc(p.name) + " — ₹" + esc(p.price) + "</option>";
    }).join("");
    selectFromLink();
  }
  function selectFromLink() {
    var m = /product\.html\?id=([^&#]+)/.exec($("bnLink").value || "");
    $("bnProd").value = m ? decodeURIComponent(m[1]) : "";
    if (m && $("bnProd").value !== decodeURIComponent(m[1])) $("bnProd").value = "";
  }
  $("bnProd").addEventListener("change", function () {
    var p = prodList.filter(function (x) { return String(x.id) === String($("bnProd").value); })[0];
    if (!p) return;
    $("bnLink").value = "product.html?id=" + encodeURIComponent(p.id);
    if (!imgUrl && p.image) { imgUrl = p.image; setPrev("bnPrev", imgUrl); $("bnImgStatus").textContent = "Using the product photo. Upload your own above if you want a different one."; }
    if (!$("bnKicker").value.trim()) $("bnKicker").value = "New launch";
    if (!$("bnL1").value.trim()) {
      var w = String(p.name).trim().split(/\s+/), cut = Math.ceil(w.length / 2);
      $("bnL1").value = w.slice(0, cut).join(" ").toUpperCase().slice(0, 22);
      $("bnL2").value = w.slice(cut).join(" ").toUpperCase().slice(0, 22);
    }
    if (!$("bnText").value.trim()) $("bnText").value = "Only ₹" + p.price + (p.compareAt && p.compareAt > p.price ? " (was ₹" + p.compareAt + ")" : "");
    if (/^(shop now|)$/i.test($("bnBtn").value.trim())) $("bnBtn").value = "Buy now";
  });
  $("bnLink").addEventListener("input", selectFromLink);
  $("bnAdd").addEventListener("click", loadProds);
  $("bnList").addEventListener("click", function (e) { if (e.target.closest('[data-a="edit"]')) loadProds().then(selectFromLink); });
})();
