/**
 * premium-cursor.js — ViharaSetu "hiker + compass" cursor.
 *
 * Uses the brand's own artwork as REAL custom cursor images, so the click point
 * is exact — no lag, no offset, no gap:
 *
 *   images/cursors/cursor-hiker.png    (+ @2x)  the normal cursor; the click point is her head
 *   images/cursors/cursor-compass.png  (+ @2x)  the pointer over links / buttons / clickable
 *                                               cards; the click point is the compass centre
 *
 * (Both are cut-down copies of cursor.png and cur1.png, which are too big to use
 * as cursors — browsers cap cursor images at 128 px.)
 *
 *  - text fields keep the normal text caret
 *  - over any element carrying data-cursor-text="Explore" a jade pill with that word
 *    sits just below-right of the pointer
 *  - click = a passport-stamp ring is stamped at the exact click point
 *
 * Self-contained (injects its own CSS). Mouse / trackpad only: touch devices keep
 * the normal cursor. With "reduce motion" on you still get the two images but no
 * pill / stamp animation.
 */
(function () {
  'use strict';
  if (window.__vsCursor) return;
  window.__vsCursor = true;

  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var SAFFRON = '#C8611A', GOLD = '#B8913F', JADE = '#2A5C45', CREAM = '#FAF6F0';

  /* ---- cursor images: found relative to this script, so every page depth works ---- */
  var here = document.currentScript && document.currentScript.src;
  var BASE = here ? here.replace(/js\/premium-cursor\.js.*$/, 'images/cursors/') : '/images/cursors/';

  var HIKER = { x1: BASE + 'cursor-hiker.png', x2: BASE + 'cursor-hiker@2x.png', hx: 10, hy: 4 };       // 17×41, click point = head
  var COMPASS = { x1: BASE + 'cursor-compass.png', x2: BASE + 'cursor-compass@2x.png', hx: 12, hy: 16 }; // 24×28, click point = centre

  // Plain url() first, then the 2x-aware image-set(): a browser that can't parse the
  // second declaration simply keeps the first.
  function cursorRule(c, fallback) {
    return 'cursor: url("' + c.x1 + '") ' + c.hx + ' ' + c.hy + ', ' + fallback + ' !important;' +
           ' cursor: -webkit-image-set(url("' + c.x1 + '") 1x, url("' + c.x2 + '") 2x) ' + c.hx + ' ' + c.hy + ', ' + fallback + ' !important;';
  }

  [HIKER.x1, HIKER.x2, COMPASS.x1, COMPASS.x2].forEach(function (u) { new Image().src = u; }); // preload: no flash on first use

  var css = [
    /* !important so the page's own cursor rules can't override the images */
    'html.vsc-on, html.vsc-on * { ' + cursorRule(HIKER, 'default') + ' }',
    'html.vsc-on.vsc-link, html.vsc-on.vsc-link * { ' + cursorRule(COMPASS, 'pointer') + ' }',
    'html.vsc-on.vsc-text, html.vsc-on.vsc-text * { cursor: text !important; }'
  ];

  if (!reduceMotion) {
    css.push(
      '.vsc-layer { position: fixed; left: 0; top: 0; z-index: 2147483000; pointer-events: none; opacity: 0; will-change: transform; transition: opacity .25s ease; }',
      '.vsc-layer.vsc-live { opacity: 1; }',
      '.vsc-layer.vsc-away { opacity: 0; }',
      '.vsc-pill { position: absolute; left: 18px; top: 8px; padding: 7px 13px 6px; border-radius: 999px;',
      '  background: ' + JADE + '; color: ' + CREAM + '; white-space: nowrap;',
      '  font: 500 9.5px/1 "Jost", system-ui, sans-serif; letter-spacing: .18em; text-transform: uppercase;',
      '  box-shadow: 0 6px 20px rgba(26,22,15,.28), 0 0 0 1px rgba(184,145,63,.55);',
      '  opacity: 0; transform: translate(-6px, -4px) scale(.9); transform-origin: left top;',
      '  transition: opacity .25s, transform .3s cubic-bezier(.2,.8,.2,1); }',
      '.vsc-layer.is-label .vsc-pill { opacity: 1; transform: none; }',

      /* passport stamp */
      '.vsc-stamp { position: fixed; z-index: 2147482995; pointer-events: none; width: 44px; height: 44px; margin: -22px 0 0 -22px;',
      '  border-radius: 50%; border: 2px solid ' + SAFFRON + '; box-shadow: inset 0 0 0 3px rgba(200,97,26,0), inset 0 0 0 4px ' + SAFFRON + ';',
      '  opacity: .8; transform: scale(1.6) rotate(-14deg); animation: vsc-stamp .7s cubic-bezier(.2,.8,.2,1) forwards; }',
      '@keyframes vsc-stamp { 25% { transform: scale(.95) rotate(-14deg); opacity: .85; } 100% { transform: scale(1.18) rotate(-14deg); opacity: 0; } }'
    );
  }

  var style = document.createElement('style');
  style.textContent = css.join('\n');
  document.head.appendChild(style);

  var root = document.documentElement;
  var LINK = 'a[href], button, [role="button"], summary, label[for], select, input[type="submit"], input[type="button"], input[type="checkbox"], input[type="radio"], [onclick]';
  var TEXT = 'input:not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea, [contenteditable=""], [contenteditable="true"]';

  /** Is this element something you click? Also catches cards the site styles with cursor:pointer. */
  function isClickable(el) {
    if (el.closest(LINK)) return true;
    root.classList.remove('vsc-on');                    // look at the page's own cursor, then put ours back
    var own = getComputedStyle(el).cursor;
    root.classList.add('vsc-on');
    return own === 'pointer';
  }

  /* ---- label pill layer (skipped for "reduce motion") ---- */
  var tip, pill;
  if (!reduceMotion) {
    tip = document.createElement('div');
    tip.className = 'vsc-layer';
    tip.setAttribute('aria-hidden', 'true');
    tip.innerHTML = '<span class="vsc-pill"></span>';
    pill = tip.firstChild;
    document.body.appendChild(tip);
  }

  /* ---- hover state ---- */
  function setState(el) {
    if (!el || !el.closest) return;
    var isText = !!el.closest(TEXT);
    var tag = el.closest('[data-cursor-text]');
    var inner = el.closest(LINK);
    var isLabel = !isText && !!tag && !(inner && inner !== tag && tag.contains(inner)); // a button inside a labelled card stays a button
    var isLink = !isText && (isLabel || isClickable(el));

    root.classList.toggle('vsc-text', isText);
    root.classList.toggle('vsc-link', isLink);

    if (!reduceMotion) {
      if (isLabel) pill.textContent = tag.getAttribute('data-cursor-text');
      tip.classList.toggle('is-label', isLabel);
    }
  }

  document.addEventListener('mouseover', function (e) { setState(e.target); }, { passive: true });
  root.classList.add('vsc-on');

  if (reduceMotion) return;                            // cursor images only

  var started = false;
  document.addEventListener('mousemove', function (e) {
    if (!started) { started = true; tip.classList.add('vsc-live'); }
    tip.style.transform = 'translate3d(' + e.clientX + 'px,' + e.clientY + 'px,0)';
  }, { passive: true });

  document.addEventListener('mouseup', function (e) {
    var s = document.createElement('div');
    s.className = 'vsc-stamp';
    s.style.left = e.clientX + 'px';
    s.style.top = e.clientY + 'px';
    document.body.appendChild(s);
    setTimeout(function () { s.remove(); }, 750);
  }, { passive: true });

  root.addEventListener('mouseleave', function () { tip.classList.add('vsc-away'); });
  root.addEventListener('mouseenter', function () { tip.classList.remove('vsc-away'); });
})();
