/*! diwali-fireworks.js - a 5-second Diwali fireworks show over the page.
 *  window.vsFireworks.play()  -> dims the page to a night sky, fires rockets that burst into gold, orange,
 *  red, pink, green and violet sparks, then fades away. It never blocks clicks (pointer-events: none) and
 *  is skipped for visitors who ask their device for reduced motion. */
(function () {
  'use strict';

  var DURATION = 5000;            // total show, in ms
  var LAUNCH_UNTIL = 3500;        // stop launching new rockets after this
  var running = false;

  var PALETTES = [
    ['#ffd36b', '#ffb02e', '#fff2c2'],   // gold
    ['#ff8a3d', '#ff5a1f', '#ffd0a0'],   // saffron / orange
    ['#ff4d6d', '#ff1f4b', '#ffc2cf'],   // red
    ['#ff6ad5', '#d63fd0', '#ffd1f4'],   // pink
    ['#6dffb0', '#2ee89a', '#d1ffe9'],   // green
    ['#8f7bff', '#6a4cff', '#d9d1ff'],   // violet
    ['#7fd8ff', '#33b5ff', '#d6f2ff']    // sky blue
  ];

  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(a) { return a[(Math.random() * a.length) | 0]; }

  function play() {
    if (running) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    running = true;

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = window.innerWidth, H = window.innerHeight;
    var small = W < 700;
    var perBurst = small ? 46 : 78;

    // Night-sky dim behind the sparks, so they glow on the light page
    var dim = document.createElement('div');
    dim.setAttribute('aria-hidden', 'true');
    dim.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;background:radial-gradient(ellipse at 50% 100%,#2a1238 0%,#0b0716 70%);opacity:0;transition:opacity .45s ease';

    var canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:2147483001;pointer-events:none';
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    document.body.appendChild(dim);
    document.body.appendChild(canvas);
    requestAnimationFrame(function () { dim.style.opacity = '0.8'; });

    var rockets = [], sparks = [];
    var start = performance.now(), last = start, nextLaunch = 0, launched = 0;

    function launch(x) {
      var tx = x != null ? x : rand(W * 0.12, W * 0.88);
      var ty = rand(H * 0.16, H * 0.5);
      rockets.push({
        x: tx + rand(-40, 40), y: H + 10, tx: tx, ty: ty,
        vx: 0, vy: 0,
        pal: pick(PALETTES), trail: []
      });
      var r = rockets[rockets.length - 1];
      // aim the rocket at its target
      var t = 62;                                   // frames to reach the target
      r.vx = (r.tx - r.x) / t;
      r.vy = (r.ty - r.y) / t;
      r.life = t;
      launched++;
    }

    function burst(x, y, pal) {
      var n = perBurst + ((Math.random() * 20) | 0);
      var kind = Math.random();
      for (var i = 0; i < n; i++) {
        var a, sp;
        if (kind < 0.55) {                          // round peony
          a = Math.random() * Math.PI * 2; sp = rand(1.2, small ? 4.2 : 5.4);
        } else if (kind < 0.8) {                    // ring
          a = (i / n) * Math.PI * 2; sp = small ? 3.6 : 4.6;
        } else {                                    // heart-ish double ring
          a = (i / n) * Math.PI * 2; sp = (i % 2 ? 2.6 : 4.4) * (small ? 0.85 : 1);
        }
        sparks.push({
          x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: rand(55, 95), age: 0, color: pick(pal), size: rand(1.2, 2.6),
          twinkle: Math.random() < 0.25
        });
      }
      // a few slow golden glitter pieces that drift down
      for (var g = 0; g < 14; g++) {
        sparks.push({ x: x, y: y, vx: rand(-1.6, 1.6), vy: rand(-1.6, 0.6), life: rand(80, 120), age: 0,
                      color: '#ffe9a8', size: rand(0.9, 1.6), twinkle: true, drag: 0.96 });
      }
    }

    function frame() {
      var now = performance.now();   // same clock as `start` (rAF timestamps can differ in some browsers)
      var dt = Math.min((now - last) / 16.667, 2.5); last = now;
      var el = now - start;

      // launch schedule: quick opening salvo, then a steady rhythm
      if (el < LAUNCH_UNTIL && el >= nextLaunch) {
        launch();
        if (launched === 1) launch(W * 0.5);
        nextLaunch = el + (launched < 4 ? rand(180, 320) : rand(300, 520));
      }

      // fade old pixels to leave streaky trails
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';

      var i;
      for (i = rockets.length - 1; i >= 0; i--) {
        var r = rockets[i];
        r.x += r.vx * dt; r.y += r.vy * dt; r.life -= dt;
        r.trail.push(r.x, r.y); if (r.trail.length > 14) r.trail.splice(0, 2);
        ctx.strokeStyle = '#ffd9a0'; ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(r.trail[0], r.trail[1]);
        for (var k = 2; k < r.trail.length; k += 2) ctx.lineTo(r.trail[k], r.trail[k + 1]);
        ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(r.x, r.y, 2.2, 0, 6.2832); ctx.fill();
        if (r.life <= 0) { burst(r.x, r.y, r.pal); rockets.splice(i, 1); }
      }

      for (i = sparks.length - 1; i >= 0; i--) {
        var s = sparks[i];
        s.age += dt;
        if (s.age >= s.life) { sparks.splice(i, 1); continue; }
        var drag = s.drag || 0.975;
        s.vx *= drag; s.vy = s.vy * drag + 0.045 * dt;      // gravity
        s.x += s.vx * dt; s.y += s.vy * dt;
        var p = s.age / s.life;
        var alpha = (1 - p) * (s.twinkle && ((s.age | 0) % 6 < 2) ? 0.35 : 1);
        var rad = s.size * (1 - p * 0.5);
        ctx.fillStyle = s.color;
        ctx.globalAlpha = alpha * 0.22;                              // soft halo (cheaper than shadowBlur)
        ctx.beginPath(); ctx.arc(s.x, s.y, rad * 3.2, 0, 6.2832); ctx.fill();
        ctx.globalAlpha = alpha;                                     // bright core
        ctx.beginPath(); ctx.arc(s.x, s.y, rad, 0, 6.2832); ctx.fill();
      }
      ctx.globalAlpha = 1;

      // finale: fade the night sky out over the last 700 ms
      if (el > DURATION - 700) {
        dim.style.transition = 'opacity .7s ease'; dim.style.opacity = '0';
        canvas.style.transition = 'opacity .7s ease'; canvas.style.opacity = '0';
      }
      if (el < DURATION) requestAnimationFrame(frame);
      else {
        if (dim.parentNode) dim.parentNode.removeChild(dim);
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        running = false;
      }
    }
    requestAnimationFrame(frame);
  }

  window.vsFireworks = { play: play };
})();
