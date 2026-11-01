/* HEAVY SOUL — tiny confetti engine (no dependencies).
   Public API:  HSConfetti.burst({x,y,count,angle,spread,power})
                HSConfetti.cannons()      two cannons from the bottom corners
                HSConfetti.rain(ms)       confetti rain from the top
   Colours are read from css/theme.css, so they follow the theme. */
(function (global) {
  'use strict';
  var reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canvas, ctx, parts = [], raf = 0, rainUntil = 0, dpr = 1;

  function css(name, fb) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fb;
  }
  function palette() {
    return [css('--hs-accent', '#C42B38'), css('--hs-accent-text', '#E0505A'), css('--hs-text', '#EFE8DA'),
            css('--hs-warn', '#E3C16F'), css('--hs-accent-deep', '#5C1A22')];
  }
  function ensure() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:200';
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    resize();
    global.addEventListener('resize', resize);
  }
  function resize() {
    dpr = Math.min(global.devicePixelRatio || 1, 2);
    canvas.width = Math.round(global.innerWidth * dpr);
    canvas.height = Math.round(global.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  function spawn(x, y, angle, spread, power) {
    var cols = palette(), a = angle + rnd(-spread / 2, spread / 2), s = rnd(power * .45, power);
    parts.push({
      x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      w: rnd(7, 13), h: rnd(5, 9), rot: rnd(0, 6.28), vr: rnd(-.3, .3), flip: rnd(0, 6.28),
      shape: ['rect', 'rect', 'circle', 'tag'][Math.floor(rnd(0, 4))],
      color: cols[Math.floor(rnd(0, cols.length))], life: rnd(110, 190)
    });
  }
  function draw(p) {
    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    ctx.scale(1, Math.cos(p.flip));
    ctx.fillStyle = p.color;
    ctx.globalAlpha = Math.min(1, p.life / 40);
    ctx.beginPath();
    if (p.shape === 'circle') { ctx.arc(0, 0, p.h * .55, 0, 6.283); }
    else if (p.shape === 'tag') {
      ctx.moveTo(-p.w * .5, -p.h * .5); ctx.lineTo(p.w * .5, -p.h * .5); ctx.lineTo(p.w * .5, p.h * .2);
      ctx.lineTo(0, p.h * .7); ctx.lineTo(-p.w * .5, p.h * .2); ctx.closePath();
    } else { ctx.rect(-p.w / 2, -p.h / 2, p.w, p.h); }
    ctx.fill();
    ctx.restore();
  }
  function tick() {
    ctx.clearRect(0, 0, global.innerWidth, global.innerHeight);
    if (Date.now() < rainUntil) for (var i = 0; i < 3; i++) spawn(rnd(0, global.innerWidth), -12, Math.PI / 2, .5, 5);
    for (var j = parts.length - 1; j >= 0; j--) {
      var p = parts[j];
      p.vy += .32; p.vx *= .985; p.vy *= .985;
      p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.flip += .18; p.life--;
      if (p.life <= 0 || p.y > global.innerHeight + 30) { parts.splice(j, 1); continue; }
      draw(p);
    }
    if (parts.length || Date.now() < rainUntil) { raf = requestAnimationFrame(tick); }
    else { raf = 0; if (canvas) { canvas.remove(); canvas = null; global.removeEventListener('resize', resize); } }
  }
  function run() { if (!raf) raf = requestAnimationFrame(tick); }

  global.HSConfetti = {
    burst: function (o) {
      if (reduce) return; o = o || {}; ensure();
      var n = o.count || 70;
      for (var i = 0; i < n; i++) spawn(o.x != null ? o.x : global.innerWidth / 2, o.y != null ? o.y : global.innerHeight / 2,
        o.angle != null ? o.angle : -Math.PI / 2, o.spread != null ? o.spread : Math.PI * 1.1, o.power || 13);
      run();
    },
    cannons: function () {
      if (reduce) return; ensure();
      var h = global.innerHeight, w = global.innerWidth;
      for (var i = 0; i < 55; i++) { spawn(0, h, -Math.PI / 3, .7, 22); spawn(w, h, -Math.PI * 2 / 3, .7, 22); }
      run();
    },
    rain: function (ms) { if (reduce) return; ensure(); rainUntil = Date.now() + (ms || 2000); run(); }
  };
})(window);
