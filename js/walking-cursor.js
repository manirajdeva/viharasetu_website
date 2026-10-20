/**
 * premium-cursor.js — ViharaSetu "traveller" cursor.
 *
 *  - a tiny backpacker (hat, rucksack) whose head is the pointer's exact spot
 *  - he really walks: legs and arms swing in step with how far you move the mouse,
 *    he leans into a fast move, turns to face left / right, and stands still and
 *    breathes when you stop
 *  - he leaves fading gold footprints behind him
 *  - over links / buttons he stops and waves, with a gold ring on the ground
 *  - over any element carrying data-cursor-text="Explore" a jade pill with that word
 *    appears beside him
 *  - over text fields he steps aside for a slim caret bar
 *  - click = he crouches and a ripple spreads across the ground
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

  var SAFFRON = '#C8611A', SAFFRON_DARK = '#8B3E0D', GOLD = '#B8913F', JADE = '#2A5C45',
      CREAM = '#FAF6F0', INK = '#1A160F', SKIN = '#E7B98F';
  var FEET_DY = 31;          // feet sit this far below the pointer (the head)
  var STEP_PX = 38;          // distance between footprints
  var PRINT_MS = 1900;       // footprint lifetime

  var css = [
    'html.vsc-on, html.vsc-on * { cursor: none !important; }',
    '.vsc-layer { position: fixed; z-index: 2147482990; pointer-events: none; opacity: 0; transition: opacity .25s ease; }',
    '.vsc-layer.vsc-live { opacity: 1; }',
    '.vsc-layer.vsc-away { opacity: 0; }',
    'canvas.vsc-layer { left: 0; top: 0; width: 100vw; height: 100vh; }',

    '.vsc-walker { left: 0; top: 0; z-index: 2147483000; will-change: transform; }',

    /* the exact click point + ground ring */
    '.vsc-spot { display: none; }', // the click point is his head — no separate dot
    '.vsc-ground { position: absolute; left: -22px; top: 23px; width: 44px; height: 16px; border-radius: 50%;',
    '  border: 1.5px solid ' + GOLD + '; background: rgba(184,145,63,.14); opacity: 0; transform: scale(.4);',
    '  transition: opacity .3s, transform .4s cubic-bezier(.2,.8,.2,1); }',
    '.vsc-walker.is-link .vsc-ground, .vsc-walker.is-label .vsc-ground { opacity: 1; transform: scale(1); }',

    /* the man */
    '.vsc-man { position: absolute; left: -15.75px; top: -8px; width: 30px; height: 42px; transform-origin: 50% 94%;',
    '  transition: transform .25s cubic-bezier(.2,.8,.2,1), opacity .2s; }',
    '.vsc-flip { position: absolute; inset: 0; transition: transform .16s ease; }',
    '.vsc-breathe { position: absolute; inset: 0; animation: vsc-breathe 2.8s ease-in-out infinite; transform-origin: 50% 100%; }',
    '@keyframes vsc-breathe { 0%,100% { transform: scaleY(1); } 50% { transform: scaleY(1.025); } }',
    '.vsc-man svg { width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0 2px 2.5px rgba(26,22,15,.38)); }',
    '.vsc-walker.is-down .vsc-man { transform: scaleY(.86) scaleX(1.05); }',
    '.vsc-walker.is-text .vsc-man { opacity: 0; transform: scale(.5); }',
    
    /* word pill */
    '.vsc-pill { position: absolute; left: 22px; top: -10px; padding: 7px 13px 6px; border-radius: 999px;',
    '  background: ' + JADE + '; color: ' + CREAM + '; white-space: nowrap;',
    '  font: 500 9.5px/1 "Jost", system-ui, sans-serif; letter-spacing: .18em; text-transform: uppercase;',
    '  box-shadow: 0 6px 20px rgba(26,22,15,.28), 0 0 0 1px rgba(184,145,63,.55);',
    '  opacity: 0; transform: translateX(-6px) scale(.9); transform-origin: left center;',
    '  transition: opacity .25s, transform .3s cubic-bezier(.2,.8,.2,1); }',
    '.vsc-walker.is-label .vsc-pill { opacity: 1; transform: none; }',

    /* caret */
    '.vsc-caret { position: absolute; left: -1.5px; top: -12px; width: 3px; height: 24px; border-radius: 2px;',
    '  background: ' + SAFFRON + '; box-shadow: 0 0 0 1.5px rgba(255,255,255,.9); opacity: 0; transform: scaleY(.4);',
    '  transition: opacity .2s, transform .25s cubic-bezier(.2,.8,.2,1); }',
    '.vsc-walker.is-text .vsc-caret { opacity: 1; transform: none; }',

    /* click ripple on the ground */
    '.vsc-ripple { position: fixed; z-index: 2147482995; pointer-events: none; width: 44px; height: 44px; margin: -22px 0 0 -22px;',
    '  border-radius: 50%; border: 1.5px solid ' + SAFFRON + '; opacity: .75; transform: scale(.3);',
    '  animation: vsc-ripple .65s cubic-bezier(.2,.7,.2,1) forwards; }',
    '@keyframes vsc-ripple { to { transform: scale(2); opacity: 0; } }'
  ].join('\n');

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  /* ---- the figure (faces right; hip at 20,31; feet at y≈52) ---- */
  var leg = function (id, shade) {
    return '<g id="' + id + '" opacity="' + shade + '">' +
             '<line x1="20" y1="31" x2="20" y2="42" stroke="' + INK + '" stroke-width="4.2" stroke-linecap="round"/>' +
             '<g id="' + id + 'L">' +
               '<line x1="20" y1="42" x2="20" y2="51" stroke="' + INK + '" stroke-width="3.8" stroke-linecap="round"/>' +
               '<ellipse cx="21.6" cy="52.2" rx="3.4" ry="1.7" fill="' + SAFFRON_DARK + '"/>' +
             '</g></g>';
  };
  var arm = function (id, shade) {
    return '<g id="' + id + '" opacity="' + shade + '">' +
             '<line x1="20" y1="19.5" x2="20" y2="26.5" stroke="' + JADE + '" stroke-width="3.4" stroke-linecap="round"/>' +
             '<g id="' + id + 'L">' +
               '<line x1="20" y1="26.5" x2="20" y2="32" stroke="' + JADE + '" stroke-width="3" stroke-linecap="round"/>' +
               '<circle cx="20" cy="33" r="1.9" fill="' + SKIN + '"/>' +
             '</g></g>';
  };

  var figure =
    '<svg viewBox="0 0 40 56" focusable="false"><g id="vscBody">' +
      arm('vscArmF', 0.7) +
      leg('vscLegF', 0.72) +
      /* rucksack + bedroll on his back */
      '<rect x="9.5" y="17" width="7.5" height="12.5" rx="3" fill="' + SAFFRON_DARK + '"/>' +
      '<rect x="10.2" y="14.6" width="6.2" height="3.4" rx="1.7" fill="' + GOLD + '"/>' +
      '<line x1="17" y1="19" x2="21" y2="19.5" stroke="' + SAFFRON_DARK + '" stroke-width="1.2"/>' +
      /* torso */
      '<rect x="15.4" y="15.8" width="9.4" height="16.4" rx="4.4" fill="' + JADE + '"/>' +
      leg('vscLegN', 1) +
      /* head + hat */
      '<circle cx="21" cy="10.6" r="5" fill="' + SKIN + '"/>' +
      '<path d="M14.6 8.2 Q21 0.6 27.4 8.2 Z" fill="' + SAFFRON + '"/>' +
      '<ellipse cx="21" cy="8.3" rx="9.2" ry="1.9" fill="' + SAFFRON + '" stroke="' + SAFFRON_DARK + '" stroke-width=".6"/>' +
      arm('vscArmN', 1) +
    '</g></svg>';

  /* ---- DOM ---- */
  var canvas = document.createElement('canvas');
  canvas.className = 'vsc-layer';
  canvas.setAttribute('aria-hidden', 'true');
  var ctx = canvas.getContext('2d');

  var walker = document.createElement('div');
  walker.className = 'vsc-layer vsc-walker';
  walker.setAttribute('aria-hidden', 'true');
  walker.innerHTML =
    '<div class="vsc-ground"></div>' +
    '<div class="vsc-man"><div class="vsc-flip"><div class="vsc-breathe">' + figure + '</div></div></div>' +
    '<div class="vsc-spot"></div>' +
    '<div class="vsc-caret"></div>' +
    '<span class="vsc-pill"></span>';

  document.body.appendChild(canvas);
  document.body.appendChild(walker);

  var $ = function (id) { return walker.querySelector('#' + id); };
  var body = $('vscBody'), flip = walker.querySelector('.vsc-flip'), pill = walker.querySelector('.vsc-pill');
  var legN = $('vscLegN'), legNL = $('vscLegNL'), legF = $('vscLegF'), legFL = $('vscLegFL');
  var armN = $('vscArmN'), armNL = $('vscArmNL'), armF = $('vscArmF'), armFL = $('vscArmFL');
  var root = document.documentElement;

  var rot = function (el, a, cx, cy) { el.setAttribute('transform', 'rotate(' + a.toFixed(1) + ' ' + cx + ' ' + cy + ')'); };

  /* ---- canvas ---- */
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  function resize() {
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  /* ---- state ---- */
  var x = -100, y = -100, lastX = null, lastY = null;
  var moved = 0;                 // px travelled since the last frame
  var amp = 0, phase = 0;        // walk intensity (0 = standing) and stride phase
  var wave = 0, waveTarget = 0, waveT = 0;
  var dir = 1;                   // 1 = facing right, -1 = left
  var heading = 0;               // radians, direction of travel (for footprints)
  var stepAcc = 0, side = 1;
  var prints = [];
  var raf = 0, last = 0, started = false;

  function drawPrints(now) {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    while (prints.length && now - prints[0].t > PRINT_MS) prints.shift();
    for (var i = 0; i < prints.length; i++) {
      var p = prints[i];
      var life = 1 - (now - p.t) / PRINT_MS;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      ctx.fillStyle = 'rgba(184,145,63,' + (life * 0.55).toFixed(3) + ')';
      ctx.beginPath(); ctx.ellipse(0, 0, 3.3, 2.1, 0, 0, Math.PI * 2); ctx.fill();            // sole
      ctx.beginPath(); ctx.ellipse(4.6, 0, 1.8, 1.4, 0, 0, Math.PI * 2); ctx.fill();          // toes
      ctx.restore();
    }
  }

  function frame(now) {
    raf = 0;
    var dt = Math.min(48, now - (last || now - 16)) || 16;
    last = now;

    var speed = moved / dt * 16;                       // px per 16 ms
    moved = 0;
    amp += (Math.min(1, speed / 4.5) - amp) * 0.2;
    if (speed > 0.15) phase += speed * 0.075;

    wave += (waveTarget - wave) * 0.22;
    waveT += dt * 0.014;

    var s = Math.sin(phase) * amp;
    var c = Math.cos(phase) * amp;
    var sF = Math.sin(phase + Math.PI) * amp;
    var cF = Math.cos(phase + Math.PI) * amp;

    rot(legN, -s * 34, 20, 31);   rot(legNL, Math.max(0, c) * 46, 20, 42);
    rot(legF, -sF * 34, 20, 31);  rot(legFL, Math.max(0, cF) * 46, 20, 42);

    var walkArmN = s * 30, walkArmF = sF * 30;
    var armNangle = walkArmN * (1 - wave) + (-152 + Math.sin(waveT) * 14) * wave;
    var foreN = (-16 * amp - 6) * (1 - wave) + (-8 + Math.sin(waveT * 1.4) * 24) * wave;
    rot(armN, armNangle, 20, 19.5);   rot(armNL, foreN, 20, 26.5);
    rot(armF, walkArmF, 20, 19.5);    rot(armFL, -16 * amp - 6, 20, 26.5);

    var bob = -Math.abs(Math.sin(phase)) * 1.5 * amp;
    body.setAttribute('transform', 'translate(0 ' + bob.toFixed(2) + ') rotate(' + (amp * 5).toFixed(1) + ' 20 52)');

    drawPrints(now);

    if (moved > 0 || amp > 0.01 || prints.length || Math.abs(waveTarget - wave) > 0.01 || wave > 0.01) {
      raf = requestAnimationFrame(frame);
    } else {
      last = 0;
    }
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  /* ---- hover state ---- */
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
    walker.classList.toggle('is-label', isLabel);
    walker.classList.toggle('is-link', isLink);
    walker.classList.toggle('is-text', isText);
    waveTarget = (isLink || isLabel) ? 1 : 0;
    kick();
  }

  function onMove(e) {
    x = e.clientX; y = e.clientY;
    if (!started) {
      started = true;
      lastX = x; lastY = y;
      root.classList.add('vsc-on');
      canvas.classList.add('vsc-live');
      walker.classList.add('vsc-live');
    }
    walker.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';

    var dx = x - lastX, dy = y - lastY;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d > 0) {
      moved += d;
      if (Math.abs(dx) > 1.2 && Math.sign(dx) !== dir) {          // turn to face the way he walks
        dir = Math.sign(dx);
        flip.style.transform = 'scaleX(' + dir + ')';
      }
      if (d > 1.5) heading = Math.atan2(dy, dx);
      stepAcc += d;
      if (stepAcc >= STEP_PX) {                                    // leave a footprint
        stepAcc = 0; side = -side;
        prints.push({
          x: x - Math.sin(heading) * 5 * side,
          y: y + FEET_DY + Math.cos(heading) * 5 * side,
          a: heading, t: performance.now()
        });
        if (prints.length > 40) prints.shift();
      }
    }
    lastX = x; lastY = y;
    kick();
  }

  document.addEventListener('mousemove', onMove, { passive: true });
  document.addEventListener('mouseover', function (e) { setState(e.target); }, { passive: true });
  document.addEventListener('mousedown', function () { walker.classList.add('is-down'); }, { passive: true });
  document.addEventListener('mouseup', function (e) {
    walker.classList.remove('is-down');
    var r = document.createElement('div');
    r.className = 'vsc-ripple';
    r.style.left = e.clientX + 'px';
    r.style.top = e.clientY + 'px';
    document.body.appendChild(r);
    setTimeout(function () { r.remove(); }, 700);
  }, { passive: true });

  root.addEventListener('mouseleave', function () {
    walker.classList.add('vsc-away'); canvas.classList.add('vsc-away'); prints.length = 0;
  });
  root.addEventListener('mouseenter', function () {
    walker.classList.remove('vsc-away'); canvas.classList.remove('vsc-away');
  });
})();
