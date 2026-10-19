/**
 * premium-cursor.js — ViharaSetu "compass" cursor.
 *
 *  - a saffron dot that tracks the pointer exactly
 *  - a thin gold compass ring that trails it with a soft lag; a saffron heading
 *    marker orbits the ring and points the way you are travelling
 *  - over links / buttons the ring swells into a translucent gold lens
 *  - over any element carrying data-cursor-text="Explore" the lens shows that word
 *  - over text fields the dot becomes a slim caret bar
 *  - press = a small compression, release = a ripple
 *
 * Self-contained (injects its own CSS). Only runs for a real mouse: touch
 * devices and "reduce motion" users keep the normal cursor, and the normal
 * cursor stays until the first mouse move so nothing flashes.
 */
(function () {
  'use strict';
  if (window.__vsCursor) return;
  window.__vsCursor = true;

  var canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!canHover || reduceMotion) return;

  var SAFFRON = '#C8611A', GOLD = '#B8913F';

  var css = [
    'html.vsc-on, html.vsc-on * { cursor: none !important; }',
    '.vsc { position: fixed; top: 0; left: 0; z-index: 2147483000; pointer-events: none; opacity: 0;',
    '  transition: opacity .25s ease; will-change: transform; }',
    '.vsc.vsc-live { opacity: 1; }',
    '.vsc.vsc-away { opacity: 0; }',

    /* dot */
    '.vsc-dot-body { position: absolute; left: -4px; top: -4px; width: 8px; height: 8px; border-radius: 50%;',
    '  background: ' + SAFFRON + '; box-shadow: 0 0 0 1.5px rgba(255,255,255,.92), 0 1px 6px rgba(0,0,0,.28);',
    '  transition: width .25s cubic-bezier(.2,.8,.2,1), height .25s cubic-bezier(.2,.8,.2,1),',
    '    left .25s cubic-bezier(.2,.8,.2,1), top .25s cubic-bezier(.2,.8,.2,1), border-radius .25s, opacity .2s, transform .2s; }',
    '.vsc-dot.is-link .vsc-dot-body { transform: scale(.5); }',
    '.vsc-dot.is-label .vsc-dot-body { opacity: 0; }',
    '.vsc-dot.is-text .vsc-dot-body { width: 3px; height: 24px; left: -1.5px; top: -12px; border-radius: 2px; }',
    '.vsc-dot.is-down .vsc-dot-body { transform: scale(.7); }',

    /* ring */
    '.vsc-ring-body { box-sizing: border-box; position: absolute; left: -22px; top: -22px; width: 44px; height: 44px; border-radius: 50%;',
    '  border: 1.5px solid ' + GOLD + '; background: rgba(184,145,63,0);',
    '  box-shadow: 0 0 0 1px rgba(255,255,255,.38), 0 2px 14px rgba(26,22,15,.18), inset 0 0 0 1px rgba(255,255,255,.28);',
    '  transition: transform .35s cubic-bezier(.2,.8,.2,1), background .3s, border-color .3s, opacity .3s; }',
    '.vsc-ring svg { position: absolute; left: -22px; top: -22px; width: 44px; height: 44px; overflow: visible; }',
    '.vsc-ring .vsc-ticks { transition: opacity .3s; }',
    '.vsc-ring.is-link .vsc-ring-body { transform: scale(1.7); background: rgba(184,145,63,.16); border-color: rgba(200,97,26,.85); }',
    '.vsc-ring.is-link .vsc-ticks { opacity: 0; }',
    '.vsc-ring.is-label .vsc-ring-body { transform: scale(2.1); background: rgba(250,246,240,.9); border-color: ' + SAFFRON + ';',
    '  box-shadow: 0 6px 26px rgba(26,22,15,.22); }',
    '.vsc-ring.is-label .vsc-ticks { opacity: 0; }',
    '.vsc-ring.is-text .vsc-ring-body { opacity: 0; transform: scale(.4); }',
    '.vsc-ring.is-down .vsc-ring-body { transform: scale(.82); }',
    '.vsc-ring.is-link.is-down .vsc-ring-body { transform: scale(1.45); }',

    /* label */
    '.vsc-label { position: absolute; left: 0; top: 0; transform: translate(-50%, -50%) scale(.6); opacity: 0;',
    '  font: 500 9.5px/1 "Jost", system-ui, sans-serif; letter-spacing: .16em; text-transform: uppercase;',
    '  color: #1A160F; white-space: nowrap; transition: opacity .25s, transform .3s cubic-bezier(.2,.8,.2,1); }',
    '.vsc-ring.is-label .vsc-label { opacity: 1; transform: translate(-50%, -50%) scale(1); }',

    /* click ripple */
    '.vsc-ripple { position: fixed; z-index: 2147482999; pointer-events: none; width: 44px; height: 44px; margin: -22px 0 0 -22px;',
    '  border-radius: 50%; border: 1.5px solid ' + SAFFRON + '; opacity: .7; transform: scale(.5);',
    '  animation: vsc-ripple .6s cubic-bezier(.2,.7,.2,1) forwards; }',
    '@keyframes vsc-ripple { to { transform: scale(2.6); opacity: 0; } }'
  ].join('\n');

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  /* ---- DOM ---- */
  var ring = document.createElement('div');
  ring.className = 'vsc vsc-ring';
  ring.setAttribute('aria-hidden', 'true');
  ring.innerHTML =
    '<div class="vsc-ring-body"></div>' +
    '<svg viewBox="0 0 44 44" focusable="false">' +
      '<g class="vsc-ticks" stroke="' + GOLD + '" stroke-width="1.5" stroke-linecap="round">' +
        '<line x1="22" y1="2.5" x2="22" y2="6.5"/><line x1="22" y1="37.5" x2="22" y2="41.5"/>' +
        '<line x1="2.5" y1="22" x2="6.5" y2="22"/><line x1="37.5" y1="22" x2="41.5" y2="22"/>' +
      '</g>' +
      '<g class="vsc-heading" style="transform-origin:22px 22px"><path d="M22 -3.5 L25.2 2.8 L22 1.4 L18.8 2.8 Z" fill="' + SAFFRON + '" stroke="#fff" stroke-width=".8" stroke-linejoin="round"/></g>' +
    '</svg>' +
    '<span class="vsc-label"></span>';

  var dot = document.createElement('div');
  dot.className = 'vsc vsc-dot';
  dot.setAttribute('aria-hidden', 'true');
  dot.innerHTML = '<div class="vsc-dot-body"></div>';

  document.body.appendChild(ring);
  document.body.appendChild(dot);

  var heading = ring.querySelector('.vsc-heading');
  var label = ring.querySelector('.vsc-label');
  var root = document.documentElement;

  /* ---- motion ---- */
  var tx = -100, ty = -100;       // pointer
  var rx = -100, ry = -100;       // ring (lags)
  var angle = 0, targetAngle = 0; // heading, degrees (0 = north)
  var raf = 0, started = false;

  function shortest(from, to) {
    var d = ((to - from + 540) % 360) - 180;
    return d;
  }

  function frame() {
    raf = 0;
    var dx = tx - rx, dy = ty - ry;
    rx += dx * 0.18;
    ry += dy * 0.18;

    if (Math.abs(dx) + Math.abs(dy) > 3) {
      targetAngle = Math.atan2(dy, dx) * 180 / Math.PI + 90; // marker art points up
    }
    var turn = shortest(angle, targetAngle);
    angle += turn * 0.14;

    ring.style.transform = 'translate3d(' + rx.toFixed(2) + 'px,' + ry.toFixed(2) + 'px,0)';
    heading.style.transform = 'rotate(' + angle.toFixed(1) + 'deg)';

    if (Math.abs(dx) + Math.abs(dy) > 0.1 || Math.abs(turn) > 0.2) raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  /* ---- state ---- */
  var LINK = 'a[href], button, [role="button"], summary, label[for], select, input[type="submit"], input[type="button"], input[type="checkbox"], input[type="radio"], [onclick]';
  var TEXT = 'input:not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea, [contenteditable=""], [contenteditable="true"]';

  function setState(el) {
    var tag = el && el.closest ? el.closest('[data-cursor-text]') : null;
    var isText = !!(el && el.closest && el.closest(TEXT));
    var isLink = !isText && !!(el && el.closest && el.closest(LINK));
    var inner = el && el.closest ? el.closest(LINK) : null;
    var isLabel = !!tag && !(inner && inner !== tag && tag.contains(inner)); // a button inside a labelled card stays a button

    ring.classList.toggle('is-label', isLabel);
    dot.classList.toggle('is-label', isLabel);
    if (isLabel) label.textContent = tag.getAttribute('data-cursor-text');

    ring.classList.toggle('is-text', isText);
    dot.classList.toggle('is-text', isText);

    var link = isLink && !isLabel;
    ring.classList.toggle('is-link', link);
    dot.classList.toggle('is-link', link);
  }

  function place(e) {
    tx = e.clientX; ty = e.clientY;
    dot.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0)';
    if (!started) {
      started = true;
      rx = tx; ry = ty;
      root.classList.add('vsc-on');
      ring.classList.add('vsc-live');
      dot.classList.add('vsc-live');
    }
    kick();
  }

  document.addEventListener('mousemove', place, { passive: true });
  document.addEventListener('mouseover', function (e) { setState(e.target); }, { passive: true });

  document.addEventListener('mousedown', function () {
    ring.classList.add('is-down'); dot.classList.add('is-down');
  }, { passive: true });
  document.addEventListener('mouseup', function (e) {
    ring.classList.remove('is-down'); dot.classList.remove('is-down');
    var r = document.createElement('div');
    r.className = 'vsc-ripple';
    r.style.left = e.clientX + 'px';
    r.style.top = e.clientY + 'px';
    document.body.appendChild(r);
    setTimeout(function () { r.remove(); }, 650);
  }, { passive: true });

  document.documentElement.addEventListener('mouseleave', function () {
    ring.classList.add('vsc-away'); dot.classList.add('vsc-away');
  });
  document.documentElement.addEventListener('mouseenter', function () {
    ring.classList.remove('vsc-away'); dot.classList.remove('vsc-away');
  });
})();
