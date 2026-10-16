/*! mobile-smooth.js - smoother movement on phones and tablets for every public page.
 *  Press feedback, sheet-style popups, fade-up reveals, swipe in the photo viewer,
 *  no viewport jump when the browser toolbar hides. Everything respects "reduce motion".
 *  Add to a page with:  <script src="<path>/js/mobile-smooth.js" defer></script>
 */
(function () {
  if (window.__msLoaded) return; window.__msLoaded = true;

  var css = [
    '@media (max-width:900px),(hover:none){',
    '  html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}',
    '  a,button,[role=button],.tier,.dest-card,.tour-card,.story,.card,.pill,.inex-card,.dest{-webkit-tap-highlight-color:transparent;touch-action:manipulation}',

    /* tactile press feedback */
    '  .btn,.btn-primary,.btn-ghost,.nav-cta,.nl-btn,.tour-btn,.tier,.tour-card,.card,.story,.pill,.dest,.inex-card,.social-btn,.back-link,.ec-chip,.ec-send{',
    '    transition:transform .2s cubic-bezier(.2,.7,.2,1),box-shadow .3s ease,background .25s ease,border-color .25s ease,color .25s ease}',
    '  .btn:active,.btn-primary:active,.btn-ghost:active,.nav-cta:active,.nl-btn:active,.tour-btn:active,.pill:active,.social-btn:active,.back-link:active,.ec-chip:active,.ec-send:active{transform:scale(.96)}',
    '  .tier:active,.tour-card:active,.card:active,.story:active,.dest:active,.inex-card:active,.dest-card:active{transform:scale(.985)}',

    /* popups slide up like native sheets */
    '  .itin-bd{align-items:flex-end!important;padding:0!important}',
    '  .itin-bd.open{animation:msFade .25s ease both}',
    '  .itin-dialog{width:100%!important;max-height:90vh;border-radius:22px 22px 0 0!important;animation:msSheet .42s cubic-bezier(.2,.9,.3,1) both!important}',
    '  .footer-popup-backdrop.visible{animation:msFade .25s ease both}',
    '  .footer-popup-backdrop.visible .footer-popup{animation:msSheet .42s cubic-bezier(.2,.9,.3,1) both}',
    '  .lb.open{animation:msFade .25s ease both}',
    '  .lb.open img{animation:msZoom .35s cubic-bezier(.2,.9,.3,1) both}',

    /* fade-up reveals added by this script */
    '  .ms-pre{opacity:0;transform:translateY(24px)}',
    '  .ms-show{opacity:1;transform:none;transition:opacity .65s ease,transform .75s cubic-bezier(.2,.7,.2,1)}',
    '}',
    '@keyframes msFade{from{opacity:0}to{opacity:1}}',
    '@keyframes msSheet{from{opacity:0;transform:translateY(46px)}to{opacity:1;transform:none}}',
    '@keyframes msZoom{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:none}}',

    /* the hero should not jump when the mobile toolbar slides away */
    '@supports (height:100svh){',
    '  @media (max-width:900px){.hero{min-height:min(94svh,860px)}}',
    '}',

    '@media (prefers-reduced-motion:reduce){',
    '  .ms-pre{opacity:1!important;transform:none!important}',
    '  .itin-dialog,.itin-bd.open,.footer-popup-backdrop.visible,.footer-popup-backdrop.visible .footer-popup,.lb.open,.lb.open img{animation:none!important}',
    '  html{scroll-behavior:auto!important}',
    '}'
  ].join('\n');

  var st = document.createElement('style');
  st.id = 'ms-css';
  st.textContent = css;
  document.head.appendChild(st);

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn();
  }

  ready(function () {
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var small = window.matchMedia && matchMedia('(max-width:900px),(hover:none)').matches;

    /* sticky header offset for in-page links, only where the page has not set one */
    try {
      var sp = getComputedStyle(document.documentElement).scrollPaddingTop;
      if (!sp || sp === 'auto' || sp === '0px') document.documentElement.style.scrollPaddingTop = '84px';
    } catch (e) {}

    /* images decode off the main thread so scrolling stays fluid */
    Array.prototype.forEach.call(document.querySelectorAll('img:not([decoding])'), function (im) { im.decoding = 'async'; });

    if (!small || reduce) return;

    /* fade-up as items scroll into view (items that already animate themselves are skipped).
       Two triggers - IntersectionObserver and a cheap scroll check - so nothing can stay hidden. */
    var sel = '.tour-card,.exp-item,.inex-card,.footer-top > div,.testimonial-section blockquote';
    var pending = [];
    Array.prototype.forEach.call(document.querySelectorAll(sel), function (el) {
      if (el.closest('.reveal,.scroll-reveal,.fade-in-up')) return;   // the page already animates this one
      var r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.9) return;     // already on screen: leave it alone
      el.classList.add('ms-pre');
      pending.push(el);
    });
    function show(el) {
      var i = pending.indexOf(el);
      if (i === -1) return;
      pending.splice(i, 1);
      el.classList.add('ms-show');
      if (io) io.unobserve(el);
    }
    var io = null;
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) show(en.target); });
      }, { threshold: .1, rootMargin: '0px 0px -30px 0px' });
      pending.forEach(function (el) { io.observe(el); });
    }
    var ticking = false;
    function check() {
      ticking = false;
      var vh = window.innerHeight;
      pending.slice().forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.top < vh * 0.95 && r.bottom > 0) show(el);
      });
      if (!pending.length) { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); }
    }
    function onScroll() { if (!ticking) { ticking = true; setTimeout(check, 50); } }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    var poll = setInterval(function () { if (!pending.length) clearInterval(poll); else check(); }, 400);   // catches anything the events miss
    setTimeout(function () { pending.slice().forEach(show); }, 15000);   // safety net: never leave content hidden

    /* swipe left/right in the photo viewer */
    var lb = document.getElementById('lb');
    if (lb) {
      var sx = 0, sy = 0, tracking = false;
      lb.addEventListener('touchstart', function (e) {
        if (e.touches.length !== 1) return;
        tracking = true; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      }, { passive: true });
      lb.addEventListener('touchend', function (e) {
        if (!tracking) return; tracking = false;
        var t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
        if (Math.abs(dx) < 50 || Math.abs(dy) > 70) return;
        var btn = lb.querySelector(dx < 0 ? '.nx' : '.pv');
        if (btn) btn.click();
      }, { passive: true });
    }
  });
})();
