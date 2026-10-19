/**
 * premium-cursor.js — ViharaSetu "flight path" cursor.
 *
 *  - a small two-tone paper plane that banks toward the direction you move
 *  - a tapering gold contrail (like a route line on a map) that fades behind it
 *  - over links / buttons the plane swells and a dashed "holding pattern" ring orbits it
 *  - over any element carrying data-cursor-text="Explore" a jade pill with that word
 *    follows the plane
 *  - over text fields the plane gives way to a slim caret bar
 *  - click = a passport-stamp ring stamps the spot
 *
 * Self-contained (injects its own CSS + canvas). Only runs for a real mouse:
 * touch devices and "reduce motion" users keep the normal cursor, and the
 * normal cursor stays until the first mouse move so nothing flashes.
 */
(function () {
  'use strict';
  if (window.__vsCursor) return;
  window.__vsCursor = true;

  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var SAFFRON = '#C8611A', SAFFRON_DARK = '#8B3E0D', GOLD = '#B8913F', JADE = '#2A5C45', CREAM = '#FAF6F0';
  var TRAIL_MS = 650;      // how long a trail point lives
  var MAX_POINTS = 60;

  var css = [
    'html.vsc-on, html.vsc-on * { cursor: none !important; }',
    '.vsc-layer { position: fixed; z-index: 2147482990; pointer-events: none; opacity: 0; transition: opacity .25s ease; }',
    '.vsc-layer.vsc-live { opacity: 1; }',
    '.vsc-layer.vsc-away { opacity: 0; }',
    'canvas.vsc-layer { left: 0; top: 0; width: 100vw; height: 100vh; }',

    '.vsc-plane { left: 0; top: 0; z-index: 2147483000; will-change: transform; }',
    '.vsc-fly { position: absolute; left: -15px; top: -15px; width: 30px; height: 30px;',
    '  transition: transform .3s cubic-bezier(.2,.8,.2,1), opacity .2s; }',
    '.vsc-fly svg { width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0 2px 3px rgba(26,22,15,.35)); }',
    '.vsc-bob { position: absolute; inset: 0; animation: vsc-bob 2.4s ease-in-out infinite; }',
    '@keyframes vsc-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-1.6px); } }',

    '.vsc-plane.is-link .vsc-fly { transform: scale(1.3); }',
    '.vsc-plane.is-label .vsc-fly { transform: scale(1.15); }',
    '.vsc-plane.is-text .vsc-fly { transform: scale(.3); opacity: 0; }',
    '.vsc-plane.is-down .vsc-fly { transform: scale(.82); }',
    '.vsc-plane.is-link.is-down .vsc-fly { transform: scale(1.1); }',

    /* dashed holding-pattern ring */
    '.vsc-orbit { position: absolute; left: -26px; top: -26px; width: 52px; height: 52px; border-radius: 50%;',
    '  border: 1.5px dashed ' + GOLD + '; opacity: 0; transform: scale(.5);',
    '  transition: opacity .3s, transform .4s cubic-bezier(.2,.8,.2,1); animation: vsc-spin 9s linear infinite; }',
    '.vsc-plane.is-link .vsc-orbit, .vsc-plane.is-label .vsc-orbit { opacity: .95; transform: scale(1); }',
    '@keyframes vsc-spin { to { rotate: 360deg; } }',

    /* word pill */
    '.vsc-pill { position: absolute; left: 24px; top: 14px; padding: 7px 13px 6px; border-radius: 999px;',
    '  background: ' + JADE + '; color: ' + CREAM + '; white-space: nowrap;',
    '  font: 500 9.5px/1 "Jost", system-ui, sans-serif; letter-spacing: .18em; text-transform: uppercase;',
    '  box-shadow: 0 6px 20px rgba(26,22,15,.28), 0 0 0 1px rgba(184,145,63,.55);',
    '  opacity: 0; transform: translateX(-6px) scale(.9); transform-origin: left center;',
    '  transition: opacity .25s, transform .3s cubic-bezier(.2,.8,.2,1); }',
    '.vsc-plane.is-label .vsc-pill { opacity: 1; transform: none; }',

    /* caret */
    '.vsc-caret { position: absolute; left: -1.5px; top: -12px; width: 3px; height: 24px; border-radius: 2px;',
    '  background: ' + SAFFRON + '; box-shadow: 0 0 0 1.5px rgba(255,255,255,.9); opacity: 0; transform: scaleY(.4);',
    '  transition: opacity .2s, transform .25s cubic-bezier(.2,.8,.2,1); }',
    '.vsc-plane.is-text .vsc-caret { opacity: 1; transform: none; }',

    /* passport stamp */
    '.vsc-stamp { position: fixed; z-index: 2147482995; pointer-events: none; width: 46px; height: 46px; margin: -23px 0 0 -23px;',
    '  border-radius: 50%; border: 2px solid ' + SAFFRON + '; box-shadow: inset 0 0 0 3px rgba(200,97,26,0), inset 0 0 0 4px ' + SAFFRON + ';',
    '  opacity: .8; transform: scale(1.5) rotate(-12deg); animation: vsc-stamp .7s cubic-bezier(.2,.8,.2,1) forwards; }',
    '@keyframes vsc-stamp { 25% { transform: scale(.95) rotate(-12deg); opacity: .85; } 100% { transform: scale(1.15) rotate(-12deg); opacity: 0; } }'
  ].join('\n');

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  /* ---- DOM ---- */
  var canvas = document.createElement('canvas');
  canvas.className = 'vsc-layer';
  canvas.setAttribute('aria-hidden', 'true');
  var ctx = canvas.getContext('2d');

  var plane = document.createElement('div');
  plane.className = 'vsc-layer vsc-plane';
  plane.setAttribute('aria-hidden', 'true');
  plane.innerHTML =
    '<div class="vsc-orbit"></div>' +
    '<div class="vsc-fly"><div class="vsc-bob"><svg viewBox="0 0 24 24" focusable="false">' +
      '<path d="M23 12 L3 3.5 L8.5 12 Z" fill="' + SAFFRON + '"/>' +
      '<path d="M23 12 L8.5 12 L3 20.5 Z" fill="' + SAFFRON_DARK + '"/>' +
      '<path d="M23 12 L3 3.5 L8.5 12 L3 20.5 Z" fill="none" stroke="#fff" stroke-width="1.1" stroke-linejoin="round"/>' +
    '</svg></div></div>' +
    '<div class="vsc-caret"></div>' +
    '<span class="vsc-pill"></span>';

  document.body.appendChild(canvas);
  document.body.appendChild(plane);

  var fly = plane.querySelector('.vsc-fly');
  var pill = plane.querySelector('.vsc-pill');
  var root = document.documentElement;

  /* ---- canvas sizing ---- */
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  function resize() {
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  /* ---- motion ---- */
  var x = -100, y = -100;
  var angle = -45, targetAngle = -45; // degrees; 0 = pointing right
  var pts = [];
  var raf = 0, started = false, lastX = null, lastY = null;

  function shortest(from, to) { return ((to - from + 540) % 360) - 180; }

  function drawTrail(now) {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    while (pts.length && now - pts[0].t > TRAIL_MS) pts.shift();
    if (pts.length < 2) return;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i];
      var life = 1 - (now - b.t) / TRAIL_MS;           // 1 = fresh, 0 = gone
      if (life <= 0) continue;
      var grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      grad.addColorStop(0, 'rgba(184,145,63,' + (life * 0.55).toFixed(3) + ')');
      grad.addColorStop(1, 'rgba(200,97,26,' + (life * 0.75).toFixed(3) + ')');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 0.6 + life * 3.2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  function frame(now) {
    raf = 0;
    var turn = shortest(angle, targetAngle);
    angle += turn * 0.2;
    fly.style.rotate = angle.toFixed(1) + 'deg';
    drawTrail(now);
    if (pts.length > 1 || Math.abs(turn) > 0.3) raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  /* ---- state ---- */
  var LINK = 'a[href], button, [role="button"], summary, label[for], select, input[type="submit"], input[type="button"], input[type="checkbox"], input[type="radio"], [onclick]';
  var TEXT = 'input:not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea, [contenteditable=""], [contenteditable="true"]';

  function setState(el) {
    var can = el && el.closest;
    var tag = can ? el.closest('[data-cursor-text]') : null;
    var inner = can ? el.closest(LINK) : null;
    var isText = !!(can && el.closest(TEXT));
    var isLabel = !!tag && !(inner && inner !== tag && tag.contains(inner)); // a button inside a labelled card stays a button
    var isLink = !isText && !!inner && !isLabel;

    if (isLabel) pill.textContent = tag.getAttribute('data-cursor-text');
    plane.classList.toggle('is-label', isLabel);
    plane.classList.toggle('is-link', isLink);
    plane.classList.toggle('is-text', isText);
  }

  function onMove(e) {
    x = e.clientX; y = e.clientY;
    if (!started) {
      started = true;
      lastX = x; lastY = y;
      root.classList.add('vsc-on');
      canvas.classList.add('vsc-live');
      plane.classList.add('vsc-live');
    }
    plane.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';

    var dx = x - lastX, dy = y - lastY;
    if (dx * dx + dy * dy > 9) {                       // ignore sub-3px jitter when choosing heading
      targetAngle = Math.atan2(dy, dx) * 180 / Math.PI;
      lastX = x; lastY = y;
    }
    pts.push({ x: x, y: y, t: performance.now() });
    if (pts.length > MAX_POINTS) pts.shift();
    kick();
  }

  document.addEventListener('mousemove', onMove, { passive: true });
  document.addEventListener('mouseover', function (e) { setState(e.target); }, { passive: true });
  document.addEventListener('mousedown', function () { plane.classList.add('is-down'); }, { passive: true });
  document.addEventListener('mouseup', function (e) {
    plane.classList.remove('is-down');
    var s = document.createElement('div');
    s.className = 'vsc-stamp';
    s.style.left = e.clientX + 'px';
    s.style.top = e.clientY + 'px';
    document.body.appendChild(s);
    setTimeout(function () { s.remove(); }, 750);
  }, { passive: true });

  root.addEventListener('mouseleave', function () {
    plane.classList.add('vsc-away'); canvas.classList.add('vsc-away'); pts.length = 0;
  });
  root.addEventListener('mouseenter', function () {
    plane.classList.remove('vsc-away'); canvas.classList.remove('vsc-away');
  });
})();
