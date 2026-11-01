/* Heavy Soul — login/signup brand scene.
   A boy and a girl paint "HEAVY SOUL" on a giant weight plate, then show how to log in / sign up.
   The scene reacts to the form: HSScene.mood('otp' | 'sending' | 'ok' | 'bad' | 'idle').
   Pure SVG + CSS, no libraries. Pauses when the tab is hidden. Respects reduced motion. */
(function () {
  "use strict";
  var host = document.getElementById("hsScene");
  if (!host) return;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- one kid (boy faces right; girl is mirrored) ---------- */
  function kid(o) {
    return '' +
    '<g class="kid ' + o.id + '">' +
      '<ellipse class="shd" cx="88" cy="350" rx="46" ry="7" fill="rgba(14,12,11,.16)"/>' +
      '<g class="body">' +
        '<g class="legs">' +
          '<rect x="64" y="288" width="26" height="58" rx="12" fill="' + o.pants + '"/>' +
          '<rect x="92" y="288" width="26" height="58" rx="12" fill="' + o.pants + '"/>' +
          '<ellipse cx="73" cy="348" rx="19" ry="8" fill="#EFE8DA" stroke="#0E0C0B" stroke-width="2"/>' +
          '<ellipse cx="111" cy="348" rx="19" ry="8" fill="#EFE8DA" stroke="#0E0C0B" stroke-width="2"/>' +
        '</g>' +
        '<g class="torso">' +
          '<path d="M40 304 C34 238 56 206 88 206 C120 206 142 238 136 304 C122 316 54 316 40 304 Z" fill="' + o.hood + '"/>' +
          '<path d="M64 270 Q88 286 112 270" fill="none" stroke="rgba(0,0,0,.22)" stroke-width="3" stroke-linecap="round"/>' +
          '<ellipse cx="88" cy="209" rx="27" ry="10" fill="' + o.hoodDark + '"/>' +
          '<g class="arm arm-l" style="transform-origin:50px 228px">' +
            '<path d="M50 228 L36 290" stroke="' + o.hood + '" stroke-width="22" stroke-linecap="round"/>' +
            '<circle cx="36" cy="292" r="10" fill="' + o.skin + '"/>' +
          '</g>' +
          '<g class="arm arm-w" style="transform-origin:126px 228px">' +
            '<path d="M126 228 L158 182" stroke="' + o.hood + '" stroke-width="22" stroke-linecap="round"/>' +
            '<circle cx="159" cy="180" r="10" fill="' + o.skin + '"/>' +
            '<path d="M163 176 L180 156" stroke="#2A2420" stroke-width="4" stroke-linecap="round"/>' +
            '<circle class="tip" cx="182" cy="153" r="6" fill="#C42B38"/>' +
          '</g>' +
          '<g class="head">' +
            '<circle cx="60" cy="172" r="6" fill="' + o.skin + '"/><circle cx="116" cy="172" r="6" fill="' + o.skin + '"/>' +
            (o.hair === "bun"
              ? '<circle cx="88" cy="134" r="13" fill="' + o.hairC + '"/><path d="M59 170 C56 138 120 138 117 170 C108 152 68 152 59 170 Z" fill="' + o.hairC + '"/>'
              : '') +
            '<circle cx="88" cy="170" r="29" fill="' + o.skin + '"/>' +
            (o.hair === "bun"
              ? '<path d="M60 168 C62 142 114 142 116 168 C106 156 70 156 60 168 Z" fill="' + o.hairC + '"/><circle cx="58" cy="186" r="5" fill="none" stroke="#E0A526" stroke-width="2.5"/><circle cx="118" cy="186" r="5" fill="none" stroke="#E0A526" stroke-width="2.5"/>'
              : '<path d="M58 166 C58 134 118 134 118 166 Z" fill="#0E0C0B"/><path d="M57 163 Q88 152 119 163 L119 171 Q88 162 57 171 Z" fill="#5C1A22"/>') +
            '<g class="eyes"><g class="eye"><circle cx="78" cy="174" r="3.4" fill="#0E0C0B"/></g><g class="eye"><circle cx="98" cy="174" r="3.4" fill="#0E0C0B"/></g></g>' +
            '<path class="brow" d="M72 164 L83 166 M104 164 L93 166" stroke="#0E0C0B" stroke-width="2.4" stroke-linecap="round" fill="none"/>' +
            '<circle cx="71" cy="184" r="4.5" fill="#E0707A" opacity=".35"/><circle cx="105" cy="184" r="4.5" fill="#E0707A" opacity=".35"/>' +
            '<path class="m m-smile" d="M80 185 Q88 192 96 185" stroke="#0E0C0B" stroke-width="2.6" stroke-linecap="round" fill="none"/>' +
            '<path class="m m-big" d="M77 183 Q88 199 99 183 Z" fill="#7A1C25" stroke="#0E0C0B" stroke-width="2.2" stroke-linejoin="round"/>' +
            '<ellipse class="m m-o" cx="88" cy="187" rx="4.5" ry="5.5" fill="#7A1C25" stroke="#0E0C0B" stroke-width="2"/>' +
            '<path class="m m-sad" d="M80 191 Q88 182 96 191" stroke="#0E0C0B" stroke-width="2.6" stroke-linecap="round" fill="none"/>' +
            '<path class="sweat" d="M118 150 q5 9 0 12 q-5 -3 0 -12 Z" fill="#7FB8E6"/>' +
          '</g>' +
        '</g>' +
      '</g>' +
    '</g>';
  }

  var svg = '' +
  '<svg viewBox="0 0 460 372" class="hs-svg" role="img" aria-label="A boy and a girl painting the Heavy Soul name on a giant weight plate">' +
    '<defs>' +
      '<mask id="hsW1" maskUnits="userSpaceOnUse"><rect class="wipe w1" x="118" y="92" width="224" height="58" fill="#fff"/></mask>' +
      '<mask id="hsW2" maskUnits="userSpaceOnUse"><rect class="wipe w2" x="118" y="152" width="224" height="58" fill="#fff"/></mask>' +
    '</defs>' +
    '<ellipse cx="230" cy="352" rx="200" ry="10" fill="rgba(14,12,11,.10)"/>' +
    '<g class="plate">' +
      '<circle cx="230" cy="152" r="112" fill="#17120F"/>' +
      '<circle cx="230" cy="152" r="104" fill="none" stroke="#C42B38" stroke-width="3"/>' +
      '<circle cx="230" cy="152" r="96" fill="none" stroke="rgba(239,232,218,.16)" stroke-width="1.5" stroke-dasharray="3 7"/>' +
      '<circle cx="144" cy="152" r="3.5" fill="#EFE8DA" opacity=".55"/><circle cx="316" cy="152" r="3.5" fill="#EFE8DA" opacity=".55"/>' +
      '<circle cx="230" cy="66" r="3.5" fill="#EFE8DA" opacity=".55"/><circle cx="230" cy="238" r="3.5" fill="#EFE8DA" opacity=".55"/>' +
      '<g mask="url(#hsW1)"><text x="230" y="142" text-anchor="middle" class="hs-word" font-size="50">HEAVY</text></g>' +
      '<g mask="url(#hsW2)"><text x="230" y="198" text-anchor="middle" class="hs-word red" font-size="50">SOUL</text></g>' +
      '<path class="swoosh" d="M158 214 Q230 232 302 212" fill="none" stroke="#EFE8DA" stroke-width="3.5" stroke-linecap="round" pathLength="1"/>' +
    '</g>' +
    kid({ id: "boy", hood: "#C42B38", hoodDark: "#9E1F2B", skin: "#C98B63", pants: "#2A2421", hair: "beanie" }) +
    '<g transform="translate(460 0) scale(-1 1)">' +
      kid({ id: "girl", hood: "#5C1A22", hoodDark: "#451218", skin: "#E3AE86", pants: "#3A332E", hair: "bun", hairC: "#2A1A14" }) +
    '</g>' +
    '<g class="phone" transform="translate(116 232) rotate(-10)">' +
      '<rect x="-17" y="-28" width="34" height="56" rx="10" fill="#0E0C0B"/>' +
      '<rect x="-13" y="-22" width="26" height="40" rx="6" fill="#EFE8DA"/>' +
      '<g class="pd"><circle class="d1" cx="-7.5" cy="-2" r="3.6"/><circle class="d2" cx="-2.5" cy="-2" r="3.6"/><circle class="d3" cx="2.5" cy="-2" r="3.6"/><circle class="d4" cx="7.5" cy="-2" r="3.6"/></g>' +
      '<rect x="-7" y="7" width="14" height="4" rx="2" fill="#C42B38"/>' +
      '<circle class="ping" cx="0" cy="-2" r="10" fill="none" stroke="#C42B38" stroke-width="2"/>' +
    '</g>' +
    '<g class="plane" fill="#C42B38"><path d="M0 0 L26 -10 L16 14 L11 5 Z"/><path d="M11 5 L26 -10 L8 3 Z" fill="#9E1F2B"/></g>' +
    '<g class="burst">' +
      [0,1,2,3,4,5,6,7,8,9,10,11].map(function (i) {
        var a = (i / 12) * Math.PI * 2, r = 70 + (i % 3) * 22;
        return '<circle class="bit b' + (i % 3) + '" cx="230" cy="150" r="' + (3 + (i % 3)) + '" style="--dx:' + Math.round(Math.cos(a) * r) + 'px;--dy:' + Math.round(Math.sin(a) * r - 10) + 'px;animation-delay:' + (i * 18) + 'ms"/>';
      }).join("") +
    '</g>' +
  '</svg>';

  host.innerHTML = svg +
    '<div class="hs-b hs-b-boy" aria-hidden="true"></div>' +
    '<div class="hs-b hs-b-girl" aria-hidden="true"></div>';

  var boyB = host.querySelector(".hs-b-boy"), girlB = host.querySelector(".hs-b-girl");
  function say(el, t) {
    if (!t) { el.classList.remove("on"); return; }
    el.textContent = t; el.classList.remove("on"); void el.offsetWidth; el.classList.add("on");
  }

  /* ---------- timeline ---------- */
  var timers = [], looping = false, curMood = "idle", tabs = {};
  function later(ms, fn) { timers.push(setTimeout(fn, ms)); }
  function clearAll() { timers.forEach(clearTimeout); timers = []; }
  function step(s) { host.setAttribute("data-step", s); }
  function hint(which) {
    ["uTabLogin", "uTabSignup"].forEach(function (id) {
      var el = tabs[id] || (tabs[id] = document.getElementById(id));
      if (el) el.classList.toggle("hs-hint", id === which);
    });
  }

  var boyEl = host.querySelector(".kid.boy"), girlEl = host.querySelector(".kid.girl");
  function writing(el, on) {
    if (!on) { el.classList.remove("pose-write", "sweep"); return; }
    el.classList.add("pose-write");
    later(90, function () { el.classList.add("sweep"); });
  }

  function loop() {
    if (looping || reduce) return;
    looping = true;
    clearAll();
    host.classList.remove("written", "w1on", "w2on");
    writing(boyEl, false); writing(girlEl, false);
    step("write1"); say(boyB, ""); say(girlB, ""); hint("");
    later(150, function () { host.classList.add("w1on"); writing(boyEl, true); });
    later(1750, function () { writing(boyEl, false); step("write2"); host.classList.add("w2on"); writing(girlEl, true); });
    later(3500, function () { writing(girlEl, false); step("tada"); host.classList.add("written"); say(boyB, "Heavy Soul!"); say(girlB, "Wear it heavy."); });
    later(5600, function () { step("login"); say(girlB, ""); say(boyB, "Been here? Log in."); hint("uTabLogin"); });
    later(8400, function () { step("signup"); say(boyB, ""); say(girlB, "New? Sign up in a minute."); hint("uTabSignup"); });
    later(11200, function () { step("phone"); hint(""); say(girlB, ""); say(boyB, "We text you 4 digits."); });
    later(14000, function () { step("plates"); say(boyB, ""); say(girlB, "Type them. Or let it auto-fill."); });
    later(17000, function () { say(girlB, ""); step("fade"); host.classList.remove("w1on", "w2on", "written"); });
    later(18000, function () { looping = false; if (curMood === "idle" && !document.hidden) loop(); });
  }
  function stopLoop() { clearAll(); looping = false; writing(boyEl, false); writing(girlEl, false); hint(""); say(boyB, ""); say(girlB, ""); }

  var moodMsg = {
    sending: ["", "Off it goes…"],
    otp: ["Got the SMS?", ""],
    ok: ["You're in!", "Welcome to the crew."],
    bad: ["Oops.", "That code's off."]
  };
  var back = null;
  function mood(name, holdMs) {
    clearTimeout(back);
    curMood = name || "idle";
    host.setAttribute("data-mood", curMood);
    if (curMood === "idle") {
      say(boyB, ""); say(girlB, "");
      if (!reduce && !document.hidden && !looping) { step("write1"); loop(); }
      return;
    }
    stopLoop();
    host.classList.add("written");
    step("mood");
    var m = moodMsg[curMood] || ["", ""];
    say(boyB, m[0]); say(girlB, m[1]);
    if (holdMs) back = setTimeout(function () { mood(curMood === "bad" ? "otp" : "idle"); }, holdMs);
  }
  function setMode(m) { host.setAttribute("data-mode", m); }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { if (curMood === "idle") stopLoop(); }
    else if (curMood === "idle") loop();
  });

  if (reduce) { host.classList.add("written", "w1on", "w2on"); step("tada"); }
  else { setTimeout(loop, 400); }

  window.HSScene = { mood: mood, mode: setMode, say: function (who, t) { say(who === "girl" ? girlB : boyB, t); } };
})();
