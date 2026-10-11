/*!
 * airplane-loader.js — Viharasetu blueprint airplane loading overlay.
 *
 * Built from airplane_assembly_loader.html (same SVG drawing, keyframes and
 * status messages), packaged as one framework-free script for the static site
 * and the admin portal. Everything it adds is prefixed "vhpl-", and its CSS is
 * injected once, so it cannot clash with page styles.
 *
 * API (window.AirplaneLoader):
 *   show(opts)    Show the overlay. Calls are counted, so overlapping loads
 *                 keep it up until the last one finishes.
 *                   delay      ms to wait before appearing (fast loads never flash it)
 *                   slowAfter  ms after which a "taking longer" note + Continue button appear
 *                   slowMessage text for that note
 *                   maxWait    ms after which it gives up and hides (or calls onTimeout)
 *   hide()        Finish one show(). Fades out once every show() has finished,
 *                 after a short minimum display time so it never just blinks.
 *   track(p, o)   show(o), then hide() when promise p settles. Returns p.
 *   fail(o)       Switch to an error state: { message, onRetry, retryText }.
 *                 "Try again" runs onRetry (default: reload); "Continue" closes.
 *
 * Page-load mode: include the script with data-page-load as the first thing in
 * <body>. It covers the page from first paint until window "load" — on the
 * first page of a visit straight away, on later pages only if loading takes
 * longer than ~0.8 s — with a 15 s safety limit.
 */
(function () {
  'use strict';
  if (window.AirplaneLoader) return; // included twice: keep the first instance

  var MESSAGES = [
    [0, 'Aligning the airframe…'],
    [1150, 'Fitting wings and tail…'],
    [2150, 'Installing engines and landing gear…'],
    [2950, 'Running final checks…'],
    [3650, 'Ready for departure…'],
    [4100, 'Taking off…']
  ];
  var MIN_VISIBLE = 900;   // once shown, stay at least this long
  var FADE = 350;          // fade-out duration (matches the CSS transition)
  var reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  var CSS = [
    '.vhpl{--vhpl-ink:#102d50;--vhpl-blue:#2776b9;--vhpl-cyan:#75c8e8;--vhpl-muted:#6586a5;',
    'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;',
    'background:rgba(244,248,252,.80);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);',
    'opacity:0;transition:opacity .35s ease;color:var(--vhpl-ink);',
    'font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;cursor:progress;box-sizing:border-box}',
    '.vhpl[hidden]{display:none}',
    '.vhpl.vhpl-on{opacity:1}',
    '.vhpl *,.vhpl *::before,.vhpl *::after{box-sizing:border-box}',
    '.vhpl-card{width:min(560px,100%);text-align:center}',
    '.vhpl-svg{display:block;width:100%;height:auto;max-height:52vh;overflow:visible;margin:0 auto}',
    '.vhpl-grid{opacity:.48}',
    '.vhpl-line{fill:none;stroke:var(--vhpl-blue);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}',
    '.vhpl-fine{fill:none;stroke:var(--vhpl-cyan);stroke-width:1.15;stroke-linecap:round;stroke-linejoin:round}',
    '.vhpl-dim{fill:none;stroke:var(--vhpl-muted);stroke-width:1;stroke-dasharray:3 4;opacity:.8}',
    '.vhpl-label{font-size:10px;letter-spacing:1.7px;fill:var(--vhpl-muted);font-weight:650}',
    '.vhpl-part{transform-box:fill-box;transform-origin:center;opacity:0}',
    '.vhpl-assembled,.vhpl-trail{opacity:0}',
    '.vhpl-run .vhpl-fuselage{animation:vhpl-fuselage 5.2s cubic-bezier(.2,.75,.25,1) infinite}',
    '.vhpl-run .vhpl-wing{animation:vhpl-wing 5.2s cubic-bezier(.2,.75,.25,1) infinite}',
    '.vhpl-run .vhpl-tail{animation:vhpl-tail 5.2s cubic-bezier(.2,.75,.25,1) infinite}',
    '.vhpl-run .vhpl-engine{animation:vhpl-engine 5.2s cubic-bezier(.2,.75,.25,1) infinite}',
    '.vhpl-run .vhpl-gear{animation:vhpl-gear 5.2s cubic-bezier(.2,.75,.25,1) infinite}',
    '.vhpl-run .vhpl-assembled{animation:vhpl-assembled 5.2s ease-in-out infinite}',
    '.vhpl-run .vhpl-trail{animation:vhpl-trail 5.2s ease-in-out infinite}',
    '.vhpl-copy{margin-top:-4px}',
    '.vhpl-eyebrow{font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:#4783b3;font-weight:750}',
    '.vhpl-title{margin:8px 0 6px;font-size:clamp(19px,3.6vw,27px);letter-spacing:-.035em;font-weight:650;line-height:1.2}',
    '.vhpl-status{color:#52728f;font-size:14px;min-height:22px;line-height:1.5}',
    '.vhpl-note{color:#52728f;font-size:13px;margin-top:4px;line-height:1.5}',
    '.vhpl-bar{width:min(220px,60%);height:3px;border-radius:9px;margin:16px auto 0;background:#d5e6f3;overflow:hidden}',
    '.vhpl-bar span{display:block;height:100%;width:35%;border-radius:9px;background:var(--vhpl-blue)}',
    '.vhpl-run .vhpl-bar span{animation:vhpl-progress 5.2s ease-in-out infinite}',
    '.vhpl-actions{margin-top:18px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap}',
    '.vhpl-actions[hidden]{display:none}',
    '.vhpl-btn{border:1px solid #b9d2e7;border-radius:999px;padding:10px 18px;background:#fff;color:var(--vhpl-ink);cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;line-height:1.2}',
    '.vhpl-btn:hover{background:#edf6fd}',
    '.vhpl-btn:focus-visible{outline:2px solid var(--vhpl-blue);outline-offset:2px}',
    '.vhpl-btn-primary{background:var(--vhpl-blue);border-color:var(--vhpl-blue);color:#fff}',
    '.vhpl-btn-primary:hover{background:#1f679f}',
    /* error / reduced motion: the finished aircraft, standing still */
    '.vhpl-still .vhpl-part,.vhpl-still .vhpl-trail{animation:none!important;opacity:0}',
    '.vhpl-still .vhpl-assembled{animation:none!important;opacity:1}',
    '.vhpl-still .vhpl-bar span{animation:none!important;width:100%;opacity:.45}',
    '.vhpl-error .vhpl-eyebrow{color:#b3261e}',
    '.vhpl-error .vhpl-bar{display:none}',
    'html.vhpl-lock,html.vhpl-lock body{overflow:hidden!important}',
    '@keyframes vhpl-fuselage{0%,8%{transform:translate(-95px,20px) rotate(-7deg);opacity:0}20%,68%{transform:translate(0,0) rotate(0);opacity:1}78%{transform:translate(0,-5px) rotate(-1deg);opacity:1}100%{transform:translate(360px,-115px) rotate(-8deg);opacity:0}}',
    '@keyframes vhpl-wing{0%,12%{transform:translate(0,-80px) rotate(-16deg);opacity:0}25%,68%{transform:translate(0,0) rotate(0);opacity:1}78%{transform:translate(0,-5px);opacity:1}100%{transform:translate(360px,-115px) rotate(-8deg);opacity:0}}',
    '@keyframes vhpl-tail{0%,17%{transform:translate(95px,-55px) rotate(20deg);opacity:0}29%,68%{transform:translate(0,0) rotate(0);opacity:1}78%{transform:translate(0,-5px);opacity:1}100%{transform:translate(360px,-115px) rotate(-8deg);opacity:0}}',
    '@keyframes vhpl-engine{0%,23%{transform:translate(-70px,65px) scale(.75);opacity:0}36%,68%{transform:translate(0,0) scale(1);opacity:1}78%{transform:translate(0,-5px);opacity:1}100%{transform:translate(360px,-115px) rotate(-8deg);opacity:0}}',
    '@keyframes vhpl-gear{0%,29%{transform:translate(30px,70px);opacity:0}41%,68%{transform:translate(0,0);opacity:1}78%{transform:translate(0,-5px);opacity:1}100%{transform:translate(360px,-115px) rotate(-8deg);opacity:0}}',
    '@keyframes vhpl-assembled{0%,39%{opacity:0}44%,69%{opacity:1}78%,100%{opacity:0}}',
    '@keyframes vhpl-trail{0%,68%{opacity:0;transform:translateX(-20px)}77%{opacity:.9;transform:translateX(0)}100%{opacity:0;transform:translateX(180px)}}',
    '@keyframes vhpl-progress{0%{transform:translateX(-120%)}75%{transform:translateX(220%)}100%{transform:translateX(400%)}}',
    '@media (prefers-reduced-motion:reduce){.vhpl{transition:none}.vhpl .vhpl-part,.vhpl .vhpl-trail{animation:none!important;opacity:0}.vhpl .vhpl-assembled{animation:none!important;opacity:1}.vhpl .vhpl-bar span{animation:none!important;width:100%;opacity:.45}}'
  ].join('\n');

  // The drawing from airplane_assembly_loader.html; ids prefixed so they can't collide with the page.
  var SVG =
    '<svg class="vhpl-svg" viewBox="0 0 680 360" aria-hidden="true" focusable="false">' +
      '<defs>' +
        '<pattern id="vhpl-grid-pattern" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#b7d6eb" stroke-width=".65"/></pattern>' +
        '<linearGradient id="vhpl-wash" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7fbff"/><stop offset="1" stop-color="#eaf5fc"/></linearGradient>' +
      '</defs>' +
      '<rect x="18" y="12" width="644" height="316" rx="16" fill="url(#vhpl-wash)" stroke="#c9dfef"/>' +
      '<rect class="vhpl-grid" x="18" y="12" width="644" height="316" rx="16" fill="url(#vhpl-grid-pattern)"/>' +
      '<path class="vhpl-dim" d="M92 190H590 M340 42V290 M135 245V270H555V245"/>' +
      '<path class="vhpl-fine" d="M55 48h24m-12-12v24M615 48h-24m12-12v24M55 292h24m-12-12v24M615 292h-24m12-12v24"/>' +
      '<text x="42" y="34" class="vhpl-label">AIRFRAME / A-01</text>' +
      '<text x="526" y="314" class="vhpl-label">ASSEMBLY SEQUENCE</text>' +
      '<g class="vhpl-part vhpl-fuselage">' +
        '<path class="vhpl-line" d="M174 172 Q205 163 260 166 L424 181 Q449 184 466 192 Q449 199 424 201 L260 208 Q205 210 174 198 Q164 192 174 172Z"/>' +
        '<path class="vhpl-fine" d="M190 178 Q202 173 224 173 L420 188"/><path class="vhpl-fine" d="M193 194 L420 196"/>' +
        '<path class="vhpl-line" d="M432 182l17 10-17 8"/>' +
        '<path class="vhpl-fine" d="M242 174l-4 30m18-29-4 28m18-27-4 26m18-25-4 24m18-23-4 22m18-21-4 20m18-19-4 18m18-17-4 16"/>' +
      '</g>' +
      '<g class="vhpl-part vhpl-wing">' +
        '<path class="vhpl-line" d="M300 184 L353 91 Q360 82 370 87 L390 98 L354 190Z"/>' +
        '<path class="vhpl-fine" d="M354 105L343 178 M365 100L354 181"/>' +
        '<path class="vhpl-line" d="M310 194 L350 248 Q355 254 364 250 L382 242 L352 190Z"/>' +
        '<path class="vhpl-fine" d="M326 208L357 243"/>' +
      '</g>' +
      '<g class="vhpl-part vhpl-tail">' +
        '<path class="vhpl-line" d="M202 174 L179 132 L193 128 L235 169Z"/><path class="vhpl-fine" d="M190 137l28 32"/>' +
        '<path class="vhpl-line" d="M207 202 L179 235 L192 239 L237 207Z"/>' +
      '</g>' +
      '<g class="vhpl-part vhpl-engine">' +
        '<ellipse class="vhpl-line" cx="350" cy="162" rx="18" ry="10"/><ellipse class="vhpl-fine" cx="350" cy="162" rx="11" ry="6"/><path class="vhpl-line" d="M333 162h34"/>' +
        '<ellipse class="vhpl-line" cx="372" cy="220" rx="18" ry="10"/><ellipse class="vhpl-fine" cx="372" cy="220" rx="11" ry="6"/><path class="vhpl-line" d="M355 220h34"/>' +
      '</g>' +
      '<g class="vhpl-part vhpl-gear">' +
        '<path class="vhpl-line" d="M275 205l-4 24m0 0h-11m11 0h10"/><circle class="vhpl-line" cx="264" cy="234" r="5"/><circle class="vhpl-line" cx="282" cy="234" r="5"/>' +
        '<path class="vhpl-line" d="M411 201l-3 21m0 0h-9m9 0h9"/><circle class="vhpl-line" cx="399" cy="226" r="4"/><circle class="vhpl-line" cx="417" cy="226" r="4"/>' +
      '</g>' +
      '<g class="vhpl-assembled">' +
        '<path class="vhpl-line" d="M135 181 Q162 169 218 174 L525 190 Q550 192 567 200 Q550 208 525 210 L218 226 Q162 231 135 218 Q122 200 135 181Z"/>' +
        '<path class="vhpl-line" d="M300 188L370 72Q375 65 384 71L410 86L362 196 M307 207L366 270Q372 277 381 269L402 253L361 196"/>' +
        '<path class="vhpl-line" d="M170 176L139 139L154 135L211 174 M170 222L139 258L154 262L212 224"/>' +
        '<path class="vhpl-fine" d="M163 186L516 198 M164 211L516 203 M227 178l-4 45m20-44-4 43m20-42-4 41m20-40-4 39m20-38-4 37m20-36-4 35"/>' +
        '<path class="vhpl-line" d="M325 201q-3-22 19-22t19 22 M400 205q-3-22 19-22t19 22"/>' +
        '<ellipse class="vhpl-line" cx="344" cy="201" rx="17" ry="9"/><ellipse class="vhpl-line" cx="419" cy="205" rx="17" ry="9"/>' +
        '<path class="vhpl-fine" d="M336 201h16m59 4h16"/>' +
        '<path class="vhpl-line" d="M275 224l-3 21h-12m12 0h12 M475 211l-2 18h-10m10 0h10"/>' +
        '<circle class="vhpl-line" cx="263" cy="248" r="5"/><circle class="vhpl-line" cx="284" cy="248" r="5"/>' +
        '<circle class="vhpl-line" cx="459" cy="232" r="4"/><circle class="vhpl-line" cx="480" cy="232" r="4"/>' +
      '</g>' +
      '<g class="vhpl-trail vhpl-fine"><path d="M70 185h70M48 200h83M80 215h56"/></g>' +
      '<text x="42" y="314" class="vhpl-label">PRECISION / ENGINEERED FOR THE JOURNEY</text>' +
    '</svg>';

  var root = null, el = {};
  var count = 0;            // outstanding show() calls
  var visible = false, shownAt = 0, state = 'idle';
  var opts = {};
  var showTimer = 0, hideTimer = 0, slowTimer = 0, maxTimer = 0, msgTimers = [];

  function build() {
    if (root) return;
    var style = document.createElement('style');
    style.id = 'vhpl-style';
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);

    root = document.createElement('div');
    root.className = 'vhpl';
    root.hidden = true;
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    root.innerHTML =
      '<div class="vhpl-card">' + SVG +
        '<div class="vhpl-copy">' +
          '<div class="vhpl-eyebrow">Your journey is taking shape</div>' +
          '<div class="vhpl-title">Assembling your aircraft</div>' +
          '<div class="vhpl-status"></div>' +
          '<div class="vhpl-note" hidden></div>' +
          '<div class="vhpl-bar" aria-hidden="true"><span></span></div>' +
          '<div class="vhpl-actions" hidden>' +
            '<button type="button" class="vhpl-btn vhpl-btn-primary vhpl-retry">Try again</button>' +
            '<button type="button" class="vhpl-btn vhpl-continue">Continue</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    (document.body || document.documentElement).appendChild(root);

    el = {
      eyebrow: root.querySelector('.vhpl-eyebrow'),
      title: root.querySelector('.vhpl-title'),
      status: root.querySelector('.vhpl-status'),
      note: root.querySelector('.vhpl-note'),
      actions: root.querySelector('.vhpl-actions'),
      retry: root.querySelector('.vhpl-retry'),
      cont: root.querySelector('.vhpl-continue'),
      fuselage: root.querySelector('.vhpl-fuselage')
    };
    // Wired once, here — never per show().
    el.retry.addEventListener('click', function () {
      var fn = opts.onRetry;
      forceHide();
      if (typeof fn === 'function') fn(); else location.reload();
    });
    el.cont.addEventListener('click', forceHide);
    // Keep the status line in step with each 5.2 s animation cycle.
    el.fuselage.addEventListener('animationstart', scheduleMessages);
    el.fuselage.addEventListener('animationiteration', scheduleMessages);
  }

  function clearMessages() { msgTimers.forEach(clearTimeout); msgTimers = []; }
  function scheduleMessages() {
    clearMessages();
    if (state !== 'loading') return;
    el.status.textContent = MESSAGES[0][1];
    MESSAGES.slice(1).forEach(function (m) {
      msgTimers.push(setTimeout(function () { if (state === 'loading') el.status.textContent = m[1]; }, m[0]));
    });
  }

  function resetCopy() {
    root.classList.remove('vhpl-error', 'vhpl-still');
    el.eyebrow.textContent = 'Your journey is taking shape';
    el.title.textContent = 'Assembling your aircraft';
    el.status.textContent = reduceMotion.matches ? 'Preparing your journey…' : MESSAGES[0][1];
    el.note.hidden = true;
    el.note.textContent = '';
    el.actions.hidden = true;
    el.retry.hidden = false;
    el.retry.textContent = 'Try again';
    el.cont.textContent = 'Continue';
    root.setAttribute('aria-busy', 'true');
    root.setAttribute('aria-label', 'Loading');
  }

  function reveal() {
    showTimer = 0;
    root.hidden = false;
    // Restart the assembly sequence from the beginning on every appearance.
    root.classList.remove('vhpl-run');
    void root.offsetWidth;
    if (reduceMotion.matches) root.classList.add('vhpl-still');
    else root.classList.add('vhpl-run');
    document.documentElement.classList.add('vhpl-lock');
    visible = true;
    shownAt = Date.now();
    requestAnimationFrame(function () { if (visible) root.classList.add('vhpl-on'); });
  }

  function clearTimers() {
    clearTimeout(showTimer); clearTimeout(slowTimer); clearTimeout(maxTimer); clearTimeout(hideTimer);
    showTimer = slowTimer = maxTimer = hideTimer = 0;
  }

  function show(o) {
    build();
    count++;
    if (count > 1 && state === 'loading') {     // already up (or about to be)
      clearTimeout(hideTimer); hideTimer = 0;
      if (!visible && !showTimer) reveal();
      else if (visible && !root.classList.contains('vhpl-on')) root.classList.add('vhpl-on'); // was fading out
      return;
    }
    o = o || {};
    clearTimers();
    clearMessages();
    opts = o;
    state = 'loading';
    resetCopy();
    if (visible) { root.classList.add('vhpl-on'); }
    else if (o.delay > 0) showTimer = setTimeout(reveal, o.delay);
    else reveal();
    if (o.slowAfter) slowTimer = setTimeout(markSlow, o.slowAfter);
    if (o.maxWait) maxTimer = setTimeout(function () {
      if (state !== 'loading') return;
      if (typeof o.onTimeout === 'function') o.onTimeout(); else forceHide();
    }, o.maxWait);
  }

  function markSlow() {
    if (state !== 'loading') return;
    if (!visible) reveal();
    el.note.textContent = opts.slowMessage || 'This is taking a little longer than usual…';
    el.note.hidden = false;
    el.actions.hidden = false;
    el.retry.hidden = !opts.onRetry;            // "Try again" only where it makes sense
    el.cont.textContent = opts.continueText || 'Continue';
  }

  function finish() {
    clearTimers();
    state = 'idle';
    if (!visible) { if (root) root.hidden = true; clearMessages(); return; }
    var wait = Math.max(0, MIN_VISIBLE - (Date.now() - shownAt));
    hideTimer = setTimeout(function () {
      root.classList.remove('vhpl-on');
      hideTimer = setTimeout(function () {
        hideTimer = 0;
        root.hidden = true;
        root.classList.remove('vhpl-run');      // stop animating while hidden
        root.removeAttribute('aria-busy');
        visible = false;
        clearMessages();
        document.documentElement.classList.remove('vhpl-lock');
      }, reduceMotion.matches ? 0 : FADE);
    }, wait);
  }

  function hide() {
    if (count === 0) return;                    // nothing outstanding (or already failed/closed)
    count--;
    if (count === 0 && state === 'loading') finish();
  }

  function forceHide() { count = 0; finish(); }

  function fail(o) {
    o = o || {};
    build();
    clearTimers();
    clearMessages();
    count = 0;                                  // later hide() calls must not close the error
    opts = { onRetry: o.onRetry };
    state = 'error';
    if (!visible) reveal();
    root.classList.add('vhpl-on', 'vhpl-error', 'vhpl-still');
    root.classList.remove('vhpl-run');
    root.removeAttribute('aria-busy');
    root.setAttribute('aria-label', 'Loading failed');
    el.eyebrow.textContent = 'We hit some turbulence';
    el.title.textContent = o.title || 'Couldn’t finish loading';
    el.status.textContent = o.message || 'Please check your connection and try again.';
    el.note.hidden = true;
    el.actions.hidden = false;
    el.retry.hidden = false;
    el.retry.textContent = o.retryText || 'Try again';
    el.cont.textContent = o.continueText || 'Continue';
    setTimeout(function () { try { el.retry.focus({ preventScroll: true }); } catch (e) { /* old browsers */ } }, 0);
  }

  function track(promise, o) {
    show(o);
    return Promise.resolve(promise).then(
      function (v) { hide(); return v; },
      function (e) { hide(); throw e; }
    );
  }

  window.AirplaneLoader = {
    show: show,
    hide: hide,
    track: track,
    fail: fail,
    isVisible: function () { return visible; }
  };

  /* ---------- page-load mode ---------- */
  var me = document.currentScript;
  if (me && me.hasAttribute('data-page-load') && document.readyState !== 'complete') {
    var KEY = 'vhpl-seen';
    var seen = false;
    try { seen = sessionStorage.getItem(KEY) === '1'; sessionStorage.setItem(KEY, '1'); } catch (e) { /* storage blocked */ }
    show({
      delay: seen ? 800 : 0,                    // later pages: only if loading is actually slow
      slowAfter: 7000,
      slowMessage: 'Still loading — you can continue while the rest of the page arrives.',
      continueText: 'Continue to site',
      maxWait: 15000                            // never block the site for longer than this
    });
    window.addEventListener('load', hide, { once: true });
    // Restored from the back/forward cache: the page is already there.
    window.addEventListener('pageshow', function (e) { if (e.persisted) forceHide(); });
  }
})();
