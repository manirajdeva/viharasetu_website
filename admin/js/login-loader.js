/* Login credential-check animation: window.VSLoader { show, hide, fail }. Markup is injected on first use. */
(function () {
  var PLANE = '../images/Login_images/viharasetu-plane.webp';
  var HTML = "<div id=\"vs-loader\" role=\"status\" aria-live=\"polite\" aria-hidden=\"true\">\n  <!-- clouds -->\n  <div class=\"vs-cloud vs-far vs-f1\"></div>\n  <div class=\"vs-cloud vs-far vs-f2\"></div>\n  <div class=\"vs-cloud vs-far vs-f3\"></div>\n  <div class=\"vs-cloud vs-mid vs-m1\"></div>\n  <div class=\"vs-cloud vs-mid vs-m2\"></div>\n  <div class=\"vs-cloud vs-near vs-n1\"></div>\n  <div class=\"vs-cloud vs-near vs-n2\"></div>\n\n  <div class=\"vs-stage\" aria-hidden=\"true\">\n    <span class=\"vs-trail vs-t1\"></span>\n    <span class=\"vs-trail vs-t2\"></span>\n\n    \n    <img class=\"vs-plane\" alt=\"\" src=\"__PLANE__\">\n\n    <!-- parachute (only appears when login fails) -->\n    <div class=\"vs-chute\">\n      <div class=\"vs-chute-sway\">\n        <svg viewBox=\"0 0 160 200\" width=\"130\" xmlns=\"http://www.w3.org/2000/svg\">\n          <g class=\"vs-canopy\">\n            <path d=\"M8 64 Q80 -22 152 64 Q134 54 116 64 Q98 54 80 64 Q62 54 44 64 Q26 54 8 64 Z\" fill=\"#0f6e78\"/>\n            <path d=\"M80 12 Q58 30 44 64 Q62 54 80 64 Z\" fill=\"#f39a1e\"/>\n            <path d=\"M80 12 Q102 30 116 64 Q98 54 80 64 Z\" fill=\"#f39a1e\"/>\n            <path d=\"M80 12 Q74 34 80 64\" fill=\"none\" stroke=\"#fff\" stroke-width=\"1.2\" opacity=\".6\"/>\n            <path d=\"M30 34 Q50 16 74 14\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3\" stroke-linecap=\"round\" opacity=\".35\"/>\n          </g>\n          <g class=\"vs-lines\" stroke=\"#e8eef3\" stroke-width=\"1.1\">\n            <line x1=\"8\" y1=\"64\" x2=\"76\" y2=\"146\"/><line x1=\"44\" y1=\"64\" x2=\"77\" y2=\"146\"/>\n            <line x1=\"80\" y1=\"64\" x2=\"80\" y2=\"146\"/><line x1=\"116\" y1=\"64\" x2=\"83\" y2=\"146\"/>\n            <line x1=\"152\" y1=\"64\" x2=\"84\" y2=\"146\"/>\n          </g>\n          <!-- admin parachutist -->\n          <g>\n            <circle cx=\"80\" cy=\"136\" r=\"8\" fill=\"#f2c7a0\"/>\n            <path d=\"M72 133 Q80 124 88 133 Z\" fill=\"#0f6e78\"/>\n            <path d=\"M71 146 Q80 141 89 146 L88 170 L72 170 Z\" fill=\"#0f3d4a\"/>\n            <path d=\"M72 148 L64 132 M88 148 L96 132\" stroke=\"#0f3d4a\" stroke-width=\"4\" stroke-linecap=\"round\"/>\n            <path d=\"M75 169 L72 190 M85 169 L88 190\" stroke=\"#16313d\" stroke-width=\"5\" stroke-linecap=\"round\"/>\n            <rect x=\"71\" y=\"152\" width=\"18\" height=\"4\" fill=\"#f39a1e\"/>\n          </g>\n        </svg>\n      </div>\n    </div>\n  </div>\n\n  <div class=\"vs-route\" aria-hidden=\"true\">\n    <span class=\"vs-dot vs-from\"></span>\n    <span class=\"vs-dot vs-to\"></span>\n    <svg class=\"vs-mini\" viewBox=\"0 0 24 24\"><path fill=\"#fff\" d=\"M21 15.5v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V8.5l-8 5v2l8-2.5V18l-2 1.5V21l3.5-1 3.5 1v-1.5L13 18v-5z\" transform=\"rotate(90 12 12)\"/></svg>\n  </div>\n\n  <div class=\"vs-text\">\n    Taking off…\n    <div class=\"vs-sub\">Verifying your credentials</div>\n  </div>\n</div>\n\n\n<!-- =========================================================\n     3) LOADER JS — paste after the HTML above".replace('__PLANE__', PLANE);
  var el, text, original;
  function build() {
    if (el) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = HTML;
    el = wrap.firstElementChild;
    document.body.appendChild(el);
    text = el.querySelector('.vs-text');
    original = text.innerHTML;
  }
  function reset() { el.classList.remove('vs-fail'); void el.offsetWidth; }
  window.VSLoader = {
    show: function (msg) {
      build(); reset();
      text.innerHTML = original;
      if (msg) text.querySelector('.vs-sub').textContent = msg;
      el.classList.add('vs-show');
      el.setAttribute('aria-hidden', 'false');
    },
    hide: function () {
      if (!el) return;
      el.classList.remove('vs-show', 'vs-fail');
      el.setAttribute('aria-hidden', 'true');
    },
    // Wrong credentials: plane bails out, parachute opens. onRetry runs on "Try again".
    fail: function (msg, onRetry) {
      build(); reset();
      text.innerHTML = 'Oops! Wrong credentials<div class="vs-sub"></div>' +
        '<button type="button" class="vs-retry">Try again</button>';
      text.querySelector('.vs-sub').textContent = msg || 'Your username or password didn\u2019t match. Please try again.';
      el.classList.add('vs-show', 'vs-fail');
      el.setAttribute('aria-hidden', 'false');
      var btn = text.querySelector('.vs-retry');
      btn.addEventListener('click', function () { window.VSLoader.hide(); if (onRetry) onRetry(); });
      setTimeout(function () { btn.focus(); }, 1300);
    }
  };
  window.addEventListener('pageshow', function (e) { if (e.persisted) window.VSLoader.hide(); });
})();
