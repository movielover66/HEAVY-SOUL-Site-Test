// Heavy Soul — Admin: "Site content" tab. The form is built from HS.SCHEMA (js/site-content.js).
(function () {
  var loaded = false, saved = {}, built = false;
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var IMG = {}; // current value for image / images fields: key -> url | [urls]

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
            o.onload = function () { resolve({ base64: o.result.split(",")[1], mimeType: "image/jpeg", fileName: "site-" + Date.now() + ".jpg" }); };
            o.readAsDataURL(b);
          }, "image/jpeg", quality);
        };
        img.src = r.result;
      };
      r.readAsDataURL(file);
    });
  }
  async function upload(file) {
    var c = await compress(file, 1200, 0.82);
    var d = await adminCall("admin_upload_image", { imageBase64: c.base64, mimeType: c.mimeType, fileName: c.fileName });
    if (!d || !d.success) throw new Error((d && d.error) || "Upload failed");
    return d.url;
  }

  function fieldHTML(f) {
    var v = HS.content[f.k];
    var cur = (v != null && v !== "") ? v : f.def;
    var id = "c_" + f.k.replace(/\./g, "_");
    if (f.type === "long") return '<div class="field"><label for="' + id + '">' + esc(f.label) + '</label><textarea id="' + id + '" data-k="' + f.k + '" rows="3" maxlength="600">' + esc(cur) + "</textarea></div>";
    if (f.type === "text") return '<div class="field"><label for="' + id + '">' + esc(f.label) + '</label><input id="' + id + '" data-k="' + f.k + '" maxlength="200" value="' + esc(cur) + '"></div>';
    if (f.type === "image") {
      IMG[f.k] = v || "";
      return '<div class="field"><label>' + esc(f.label) + '</label><div class="cimg" data-img="' + f.k + '"><img class="' + (v ? "" : "hidden") + '" alt="" src="' + esc(v || "") + '"><div><input type="file" accept="image/*" data-up="' + f.k + '"><p class="status" data-st="' + f.k + '"></p><button type="button" class="btn sm ' + (v ? "" : "hidden") + '" data-clr="' + f.k + '">Use automatic photo</button></div></div></div>';
    }
    if (f.type === "images") {
      IMG[f.k] = HS.list(f.k);
      return '<div class="field"><label>' + esc(f.label) + '</label><div class="cthumbs" data-imgs="' + f.k + '"></div><input type="file" accept="image/*" multiple data-upm="' + f.k + '"><p class="status" data-st="' + f.k + '"></p></div>';
    }
    return "";
  }
  function drawThumbs(k) {
    var box = document.querySelector('[data-imgs="' + k + '"]'); if (!box) return;
    box.innerHTML = (IMG[k] || []).map(function (u, i) { return '<div class="th"><img src="' + esc(u) + '" alt=""><button type="button" data-rm="' + k + '" data-i="' + i + '" aria-label="Remove photo">×</button></div>'; }).join("");
  }
  function build() {
    $("conList").innerHTML = HS.SCHEMA.map(function (s) {
      return '<details class="csec"' + (s.id === "top" ? " open" : "") + "><summary>" + esc(s.title) + '</summary><div class="cbody">' + s.fields.map(fieldHTML).join("") +
        '<button type="button" class="btn sm" data-reset="' + s.id + '">Reset this section to the original text</button></div></details>';
    }).join("");
    HS.SCHEMA.forEach(function (s) { s.fields.forEach(function (f) { if (f.type === "images") drawThumbs(f.k); }); });
    built = true;
  }

  async function load() {
    $("conStatus").textContent = "Loading…";
    try {
      var d = await adminCall("admin_get_content");
      if (!d || !d.success) { $("conStatus").textContent = (d && /password|unauthorized/i.test(d.error || "")) ? "Session expired — log out and log in again." : ((d && d.error) || "Could not load. Did you deploy the new Apps Script version?"); return; }
      HS.content = d.content || {}; loaded = true; build(); $("conStatus").textContent = "";
    } catch (e) { $("conStatus").textContent = "Error: " + (e && e.message ? e.message : e); }
  }
  window.addEventListener("hs:tab", function (e) { if (e.detail === "content" && !loaded) load(); });

  $("conList").addEventListener("change", async function (e) {
    var t = e.target, k = t.getAttribute("data-up") || t.getAttribute("data-upm"); if (!k || !t.files.length) return;
    var st = document.querySelector('[data-st="' + k + '"]'), multi = !!t.getAttribute("data-upm");
    $("conSave").disabled = true;
    try {
      var files = [].slice.call(t.files);
      for (var n = 0; n < files.length; n++) {
        st.textContent = "Uploading " + (n + 1) + " of " + files.length + "…";
        var url = await upload(files[n]);
        if (multi) { IMG[k] = (IMG[k] || []).concat(url).slice(0, 12); drawThumbs(k); }
        else { IMG[k] = url; var box = document.querySelector('[data-img="' + k + '"]'); var im = box.querySelector("img"); im.src = url; im.classList.remove("hidden"); box.querySelector("[data-clr]").classList.remove("hidden"); }
      }
      st.textContent = "Uploaded ✓ — tap “Save all changes”.";
    } catch (err) { st.textContent = "Upload failed — try a smaller photo."; }
    t.value = ""; $("conSave").disabled = false;
  });

  $("conList").addEventListener("click", function (e) {
    var t = e.target.closest("button"); if (!t) return;
    if (t.hasAttribute("data-rm")) { var k = t.getAttribute("data-rm"); IMG[k].splice(+t.getAttribute("data-i"), 1); drawThumbs(k); }
    if (t.hasAttribute("data-clr")) { var k2 = t.getAttribute("data-clr"); IMG[k2] = ""; var box = document.querySelector('[data-img="' + k2 + '"]'); box.querySelector("img").classList.add("hidden"); t.classList.add("hidden"); }
    if (t.hasAttribute("data-reset")) {
      var sec = HS.SCHEMA.filter(function (s) { return s.id === t.getAttribute("data-reset"); })[0];
      sec.fields.forEach(function (f) {
        var el = document.querySelector('[data-k="' + f.k + '"]'); if (el) el.value = f.def;
        if (f.type === "image") { IMG[f.k] = ""; var b = document.querySelector('[data-img="' + f.k + '"]'); b.querySelector("img").classList.add("hidden"); b.querySelector("[data-clr]").classList.add("hidden"); }
        if (f.type === "images") { IMG[f.k] = []; drawThumbs(f.k); }
      });
      $("conMsg").textContent = "Section reset — tap “Save all changes” to apply.";
    }
  });

  $("conSave").addEventListener("click", async function () {
    var values = {}, clear = [];
    HS.SCHEMA.forEach(function (s) { s.fields.forEach(function (f) {
      var v;
      if (f.type === "image") v = IMG[f.k] || "";
      else if (f.type === "images") v = (IMG[f.k] && IMG[f.k].length) ? JSON.stringify(IMG[f.k]) : "";
      else { var el = document.querySelector('[data-k="' + f.k + '"]'); v = el ? el.value.trim() : ""; if (v === f.def) v = ""; }
      if (v === "") clear.push(f.k); else values[f.k] = v;
    }); });
    $("conSave").disabled = true; $("conSave").textContent = "Saving…"; $("conMsg").textContent = "";
    try {
      var d = await adminCall("admin_save_content", { values: values, clear: clear });
      if (d && d.success) { HS.content = d.content || {}; $("conMsg").textContent = "Saved ✓ Live on the site within a minute."; showAdminToast("Site content saved."); }
      else $("conMsg").textContent = (d && d.error) || "Could not save.";
    } catch (err) { $("conMsg").textContent = "Network error — try again."; }
    $("conSave").disabled = false; $("conSave").textContent = "Save all changes";
  });
})();
