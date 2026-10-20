/*! ViharaSetu Trekker Cursor — trekker-cursor.js
 *  Two trekkers follow the pointer:
 *    move left/right  -> they walk (and turn to face the way they go)
 *    move up          -> they climb
 *    move down        -> they rappel down a rope
 *    stop             -> they breathe, poles planted
 *    click            -> a summit flag is planted and the lead trekker hops
 *  One file, no dependencies. Just load it with a script tag before the end of body.
 *  Optional: data-cursor-link on any element to make the target dot grow like a link.
 */
(function () {
  'use strict';
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return; // desktop mouse only

  /* ---------- styles ---------- */
  var css = [
    ':root{--vt-sun:#f28c28;--vt-sea:#1f5fa8;--vt-ink:#0f1b2d}',
    'html.vt-on,html.vt-on *{cursor:none!important}',
    'html.vt-on input:not([type=checkbox]):not([type=radio]),html.vt-on textarea{cursor:text!important}',

    '.vt{position:fixed;left:0;top:0;width:56px;height:72px;z-index:2147483646;pointer-events:none;',
    'transform-origin:0 0;opacity:0;transition:opacity .35s ease;will-change:transform}',
    '.vt.on{opacity:1}',
    'html.vt-text .vt{opacity:.18}',
    '.vt-flip{transform-origin:28px 70px;transition:transform .22s ease}',
    '.vt.left .vt-flip{transform:scaleX(-1)}',
    '.vt-svg{display:block;overflow:visible;',
    'filter:drop-shadow(0 0 .8px rgba(255,255,255,.95)) drop-shadow(0 3px 4px rgba(15,27,45,.35))}',
    '.vt-svg *{transform-box:view-box}',
    '.vt-svg line,.vt-svg path{stroke-linecap:round;fill:none}',

    /* parts */
    '.vt-svg .shadow{fill:rgba(15,27,45,.22)}',
    '.vt-svg .pants{stroke:#0f1b2d;stroke-width:5.4}',
    '.vt-svg .boot{stroke:#0b1220;stroke-width:4}',
    '.vt-svg .jacket{stroke:var(--jacket,#1f5fa8);stroke-width:8.5}',
    '.vt-svg .sleeve{stroke:var(--jacket,#1f5fa8);stroke-width:4.6}',
    '.vt-svg .glove{fill:#0f1b2d}',
    '.vt-svg .pack{fill:var(--pack,#f28c28)}',
    '.vt-svg .skin{fill:#f3c9a5}',
    '.vt-svg .cap{fill:var(--pack,#f28c28)}',
    '.vt-svg .pole{stroke:#cbd5e1;stroke-width:1.5}',
    '.vt-svg .rope{stroke:var(--vt-sun);stroke-width:1.6;display:none}',

    /* pivots */
    '.vt-svg .leg,.vt-svg .body{transform-origin:28px 44px}',
    '.vt-svg .shin{transform-origin:28px 56px}',
    '.vt-svg .arm{transform-origin:28px 24px}',
    '.vt-svg .fore{transform-origin:28px 33px}',
    '.vt-svg .leg,.vt-svg .shin,.vt-svg .arm,.vt-svg .fore,.vt-svg .body{transition:transform .25s ease}',

    /* IDLE */
    '[data-state=idle] .body{transform:rotate(2deg)}',
    '[data-state=idle] .legF{transform:rotate(-7deg)}',
    '[data-state=idle] .legB{transform:rotate(6deg)}',
    '[data-state=idle] .armF{transform:rotate(-10deg)}',
    '[data-state=idle] .armB{transform:rotate(8deg)}',
    '[data-state=idle] .fore{transform:rotate(-22deg)}',
    '[data-state=idle] .bob{animation:vt-breathe 3.2s ease-in-out infinite}',

    /* WALK */
    '[data-state=walk] .body{transform:rotate(5deg)}',
    '[data-state=walk] .fore{transform:rotate(-26deg)}',
    '[data-state=walk] .legF{animation:vt-leg var(--d,.7s) linear infinite}',
    '[data-state=walk] .legB{animation:vt-leg var(--d,.7s) linear infinite;animation-delay:calc(var(--d,.7s)*-.5)}',
    '[data-state=walk] .legF .shin{animation:vt-shin var(--d,.7s) linear infinite}',
    '[data-state=walk] .legB .shin{animation:vt-shin var(--d,.7s) linear infinite;animation-delay:calc(var(--d,.7s)*-.5)}',
    '[data-state=walk] .armF{animation:vt-arm var(--d,.7s) ease-in-out infinite}',
    '[data-state=walk] .armB{animation:vt-arm var(--d,.7s) ease-in-out infinite;animation-delay:calc(var(--d,.7s)*-.5)}',
    '[data-state=walk] .bob{animation:vt-bob calc(var(--d,.7s)/2) ease-in-out infinite}',

    /* CLIMB UP */
    '[data-state=up] .body{transform:rotate(14deg)}',
    '[data-state=up] .fore{transform:rotate(-8deg)}',
    '[data-state=up] .pole{display:none}',
    '[data-state=up] .legF{animation:vt-climbleg var(--d,.9s) ease-in-out infinite}',
    '[data-state=up] .legB{animation:vt-climbleg var(--d,.9s) ease-in-out infinite;animation-delay:calc(var(--d,.9s)*-.5)}',
    '[data-state=up] .legF .shin{animation:vt-climbshin var(--d,.9s) ease-in-out infinite}',
    '[data-state=up] .legB .shin{animation:vt-climbshin var(--d,.9s) ease-in-out infinite;animation-delay:calc(var(--d,.9s)*-.5)}',
    '[data-state=up] .armF{animation:vt-reach var(--d,.9s) ease-in-out infinite}',
    '[data-state=up] .armB{animation:vt-reach var(--d,.9s) ease-in-out infinite;animation-delay:calc(var(--d,.9s)*-.5)}',
    '[data-state=up] .bob{animation:vt-climbbob var(--d,.9s) ease-in-out infinite}',

    /* RAPPEL DOWN */
    '[data-state=down] .body{transform:rotate(-28deg)}',
    '[data-state=down] .fore{transform:rotate(-6deg)}',
    '[data-state=down] .pole{display:none}',
    '[data-state=down] .rope{display:block}',
    '[data-state=down] .legF{animation:vt-kick var(--d,.9s) ease-in-out infinite}',
    '[data-state=down] .legB{animation:vt-kick var(--d,.9s) ease-in-out infinite;animation-delay:calc(var(--d,.9s)*-.5)}',
    '[data-state=down] .legF .shin{animation:vt-kickshin var(--d,.9s) ease-in-out infinite}',
    '[data-state=down] .legB .shin{animation:vt-kickshin var(--d,.9s) ease-in-out infinite;animation-delay:calc(var(--d,.9s)*-.5)}',
    '[data-state=down] .armF{animation:vt-grip var(--d,.9s) ease-in-out infinite}',
    '[data-state=down] .armB{animation:vt-grip var(--d,.9s) ease-in-out infinite;animation-delay:calc(var(--d,.9s)*-.5)}',
    '[data-state=down] .bob{animation:vt-dropbob var(--d,.9s) ease-in-out infinite}',

    /* keyframes */
    '@keyframes vt-breathe{0%,100%{transform:translateY(0)}50%{transform:translateY(-.9px)}}',
    '@keyframes vt-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.8px)}}',
    '@keyframes vt-leg{0%{transform:rotate(28deg)}50%{transform:rotate(-28deg)}100%{transform:rotate(28deg)}}',
    '@keyframes vt-shin{0%{transform:rotate(0)}25%{transform:rotate(55deg)}50%{transform:rotate(4deg)}100%{transform:rotate(0)}}',
    '@keyframes vt-arm{0%{transform:rotate(-26deg)}50%{transform:rotate(26deg)}100%{transform:rotate(-26deg)}}',
    '@keyframes vt-climbleg{0%,100%{transform:rotate(-70deg)}50%{transform:rotate(8deg)}}',
    '@keyframes vt-climbshin{0%,100%{transform:rotate(75deg)}50%{transform:rotate(6deg)}}',
    '@keyframes vt-reach{0%,100%{transform:rotate(-168deg)}50%{transform:rotate(-132deg)}}',
    '@keyframes vt-climbbob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}',
    '@keyframes vt-kick{0%,100%{transform:rotate(-80deg)}50%{transform:rotate(-96deg)}}',
    '@keyframes vt-kickshin{0%,100%{transform:rotate(0)}50%{transform:rotate(16deg)}}',
    '@keyframes vt-grip{0%,100%{transform:rotate(-118deg)}50%{transform:rotate(-126deg)}}',
    '@keyframes vt-dropbob{0%,100%{transform:translateY(0)}50%{transform:translateY(2.5px)}}',
    '@keyframes vt-hop{0%{transform:translateY(0)}40%{transform:translateY(-16px)}100%{transform:translateY(0)}}',
    '.vt-jump.hop{animation:vt-hop .55s cubic-bezier(.3,.7,.4,1)}',

    /* target dot */
    '.vt-dot{position:fixed;left:0;top:0;width:8px;height:8px;margin:-4px 0 0 -4px;border-radius:50%;',
    'background:var(--vt-sun);box-shadow:0 0 0 1.5px rgba(255,255,255,.9);z-index:2147483647;pointer-events:none;',
    'opacity:0;transition:width .3s,height .3s,margin .3s,background .3s,opacity .3s}',
    '.vt-dot.on{opacity:1}',
    '.vt-dot.is-link{width:34px;height:34px;margin:-17px 0 0 -17px;background:rgba(242,140,40,.18);',
    'box-shadow:0 0 0 1.5px var(--vt-sun)}',
    'html.vt-text .vt-dot{opacity:0}',

    /* word pill: data-cursor-text="Explore" */
    '.vt-pill{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;padding:7px 13px 6px;border-radius:999px;',
    'background:#2A5C45;color:#FAF6F0;white-space:nowrap;font:500 9.5px/1 Jost,system-ui,sans-serif;letter-spacing:.18em;text-transform:uppercase;',
    'box-shadow:0 6px 20px rgba(26,22,15,.28),0 0 0 1px rgba(184,145,63,.55);opacity:0;transition:opacity .25s;will-change:transform}',
    '.vt-pill.on{opacity:1}',

    /* footprints + flag */
    '.vt-print{position:fixed;width:5px;height:5px;margin:-2.5px 0 0 -2.5px;border-radius:50%;',
    'background:var(--vt-sun);opacity:.55;pointer-events:none;z-index:2147483640;animation:vt-fade 1.4s ease-out forwards}',
    '@keyframes vt-fade{to{opacity:0;transform:scale(.4)}}',
    '.vt-flag{position:fixed;width:26px;height:32px;pointer-events:none;z-index:2147483641;',
    'transform-origin:3px 30px;animation:vt-flag 1.8s ease-out forwards}',
    '@keyframes vt-flag{0%{transform:scale(0) rotate(-12deg);opacity:0}12%{transform:scale(1.15) rotate(4deg);opacity:1}',
    '22%{transform:scale(1) rotate(0)}85%{opacity:1}100%{opacity:0}}',

    '@media (prefers-reduced-motion:reduce){.vt-svg *{animation:none!important}.vt-jump.hop{animation:none}.vt-print{display:none}}'
  ].join('\n');
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  /* ---------- trekker markup (side view, facing right) ---------- */
  var arm = function (cls) {
    return '<g class="arm ' + cls + '"><line class="sleeve" x1="28" y1="24" x2="28" y2="33"/>' +
      '<g class="fore"><line class="sleeve" x1="28" y1="33" x2="28" y2="41"/>' +
      '<circle class="glove" cx="28" cy="41.5" r="2.1"/>' +
      '<line class="pole" x1="28" y1="41" x2="35" y2="68.5"/></g></g>';
  };
  var leg = function (cls) {
    return '<g class="leg ' + cls + '"><line class="pants" x1="28" y1="44" x2="28" y2="56"/>' +
      '<g class="shin"><line class="pants" x1="28" y1="56" x2="28" y2="66"/>' +
      '<line class="boot" x1="27" y1="67.5" x2="34" y2="67.5"/></g></g>';
  };
  var SVG =
    '<div class="vt-flip"><div class="vt-jump">' +
    '<svg class="vt-svg" viewBox="0 0 56 72" width="56" height="72" data-state="idle">' +
    '<ellipse class="shadow" cx="28" cy="69.6" rx="13" ry="2.2"/>' +
    '<line class="rope" x1="27" y1="11" x2="40" y2="-60"/>' +
    '<g class="bob">' + leg('legB') +
    '<g class="body">' + arm('armB') +
    '<rect class="pack" x="16.5" y="21" width="10.5" height="19" rx="4"/>' +
    '<line class="jacket" x1="28" y1="23.5" x2="28" y2="44"/>' +
    '<circle class="skin" cx="29.5" cy="14.5" r="5"/>' +
    '<path class="cap" d="M24 14 a5.8 5.8 0 0 1 11.6 0 z" style="fill:var(--pack,#f28c28)"/>' +
    '<rect class="cap" x="31" y="13.2" width="7" height="2" rx="1"/>' +
    arm('armF') + '</g>' + leg('legF') + '</g></svg></div></div>';

  /* ---------- trekker ---------- */
  function Trekker(o) {
    var el = document.createElement('div');
    el.className = 'vt';
    el.style.setProperty('--jacket', o.jacket);
    el.style.setProperty('--pack', o.pack);
    el.innerHTML = SVG;
    document.body.appendChild(el);
    this.el = el;
    this.svg = el.querySelector('.vt-svg');
    this.jump = el.querySelector('.vt-jump');
    this.s = o.scale || 1;
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.state = 'idle'; this.cand = 'idle'; this.cc = 0;
    this.face = 1; this.dist = 0; this.d = 0; this.first = true;
  }
  Trekker.prototype.step = function (tx, ty, ease, maxSp) {
    if (this.first) { this.x = tx; this.y = ty; this.first = false; }
    var dx = tx - this.x, dy = ty - this.y, dd = Math.sqrt(dx * dx + dy * dy);
    var sp = dd < 1.6 ? 0 : Math.min(maxSp, dd * ease);
    var sx = dd ? dx / dd * sp : 0, sy = dd ? dy / dd * sp : 0;
    this.x += sx; this.y += sy;
    this.vx += (sx - this.vx) * 0.25;
    this.vy += (sy - this.vy) * 0.25;
    var speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);

    var cand;
    if (speed < 0.45) cand = 'idle';
    else if (Math.abs(this.vy) > Math.abs(this.vx) * 1.2) cand = this.vy < 0 ? 'up' : 'down';
    else cand = 'walk';

    if (cand === 'walk') {
      var f = this.vx > 0 ? 1 : -1;
      if (f !== this.face) { this.face = f; this.el.classList.toggle('left', f < 0); }
    }
    if (cand === this.cand) this.cc++; else { this.cand = cand; this.cc = 0; }
    if (this.cc >= (cand === 'idle' ? 8 : 4) && this.state !== cand) {
      this.state = cand;
      this.svg.setAttribute('data-state', cand);
    }

    if (this.state !== 'idle') {
      var base = 1.5 / (1 + speed * 0.45);
      if (this.state !== 'walk') base *= 1.45;
      base = Math.max(0.38, Math.min(1.15, base));
      if (Math.abs(base - this.d) > 0.05) {
        this.d = base;
        this.svg.style.setProperty('--d', base.toFixed(2) + 's');
      }
    }
    this.travel = sp;
    this.el.style.transform = 'translate3d(' + (this.x - 28 * this.s).toFixed(1) + 'px,' +
      (this.y - 69 * this.s).toFixed(1) + 'px,0) scale(' + this.s + ')';
  };

  var lead = new Trekker({ jacket: '#1f5fa8', pack: '#f28c28', scale: 0.637 });
  var mate = new Trekker({ jacket: '#c2410c', pack: '#0f766e', scale: 0.564 });

  var dot = document.createElement('div');
  dot.className = 'vt-dot';
  document.body.appendChild(dot);
  var pill = document.createElement('span');
  pill.className = 'vt-pill';
  document.body.appendChild(pill);
  document.documentElement.classList.add('vt-on');

  var mx = window.innerWidth / 2, my = window.innerHeight / 2, shown = false;

  function show() {
    if (shown) return;
    shown = true;
    lead.el.classList.add('on'); mate.el.classList.add('on'); dot.classList.add('on');
  }
  document.addEventListener('mousemove', function (e) { mx = e.clientX; my = e.clientY; show(); }, { passive: true });
  document.addEventListener('mouseleave', function () {
    shown = false;
    lead.el.classList.remove('on'); mate.el.classList.remove('on'); dot.classList.remove('on'); pill.classList.remove('on');
  });

  var LINK = 'a,button,[role=button],summary,[data-cursor-link],[onclick],label[for],select';
  var TEXT = 'input:not([type=checkbox]):not([type=radio]):not([type=range]),textarea,[contenteditable=true]';
  document.addEventListener('mouseover', function (e) {
    var t = e.target; if (!(t instanceof Element)) return;
    var inner = t.closest(LINK), tag = t.closest('[data-cursor-text]');
    var isLabel = !!tag && !(inner && inner !== tag && tag.contains(inner)); // a button inside a labelled card stays a button
    dot.classList.toggle('is-link', !!inner || isLabel);
    document.documentElement.classList.toggle('vt-text', !!t.closest(TEXT));
    if (isLabel) pill.textContent = tag.getAttribute('data-cursor-text');
    pill.classList.toggle('on', isLabel && shown);
  });

  /* click: plant a flag, lead trekker hops */
  document.addEventListener('mousedown', function (e) {
    var f = document.createElement('div');
    f.className = 'vt-flag';
    f.style.left = (e.clientX - 3) + 'px';
    f.style.top = (e.clientY - 30) + 'px';
    f.innerHTML = '<svg viewBox="0 0 26 32" width="26" height="32"><line x1="3" y1="2" x2="3" y2="30" ' +
      'stroke="#0f1b2d" stroke-width="2" stroke-linecap="round"/><path d="M4 3 L24 9 L4 15 Z" fill="#f28c28" ' +
      'stroke="#fff" stroke-width="1" stroke-linejoin="round"/></svg>';
    document.body.appendChild(f);
    f.addEventListener('animationend', function () { f.remove(); });
    lead.jump.classList.remove('hop'); void lead.jump.offsetWidth; lead.jump.classList.add('hop');
  });

  /* footprints */
  function print(x, y) {
    var p = document.createElement('div');
    p.className = 'vt-print';
    p.style.left = x + 'px'; p.style.top = (y + 1) + 'px';
    document.body.appendChild(p);
    p.addEventListener('animationend', function () { p.remove(); });
  }

  /* main loop */
  function loop() {
    dot.style.left = mx + 'px';
    dot.style.top = my + 'px';
    pill.style.transform = 'translate3d(' + (mx + 12) + 'px,' + (my - 24) + 'px,0)';

    // lead trekker walks beside/below the pointer so it never hides what you point at
    var tx = Math.min(mx + 15, window.innerWidth - 17);
    var ty = Math.min(my + 41, window.innerHeight - 2);
    lead.step(tx, ty, 0.09, 10);

    lead.dist += lead.travel;
    if (lead.state !== 'idle' && lead.dist > 15) { print(lead.x, lead.y); lead.dist = 0; }

    // teammate trails the lead along the trail
    var ox = 0, oy = 0;
    if (lead.state === 'up') oy = 27;
    else if (lead.state === 'down') oy = -27;
    else ox = -lead.face * 25;
    mate.step(lead.x + ox, lead.y + oy, 0.07, 9.5);

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
