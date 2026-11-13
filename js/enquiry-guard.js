/*! enquiry-guard.js - spam / bot protection for the public enquiry forms.
 *
 *  Works with backend/src/antiSpam.js. Every form that sends an enquiry (home contact form,
 *  Enquire popup, enquiry.html, the chatbot) calls  VSGuard.prepare(formData)  before posting;
 *  it returns the same data plus:
 *    form_token      a short-lived signed token fetched when the visitor starts the form
 *                    (the server rejects a token younger than ~3 s, so instant bot posts fail)
 *    hp_website      the hidden "honeypot" field, which real visitors never fill
 *    cf_turnstile    the Cloudflare Turnstile answer, only if a site key is set below
 *
 *  To switch the CAPTCHA on: create a free Turnstile widget at dash.cloudflare.com, paste its
 *  SITE key below, and set TURNSTILE_SECRET_KEY on the API server. Empty = CAPTCHA off.
 */
(function () {
  if (window.VSGuard) return;

  var API = "https://viharasetu-api.onrender.com/exec";   // keep in sync with sendEnquiry() in index.html
  var VS_TURNSTILE_SITEKEY = "";                          // <- Cloudflare Turnstile SITE key (public), or ""

  var MIN_AGE_MS = 3200;           // the server refuses tokens younger than 3 s
  var tokenP = null, tokenAt = 0;

  function warm() {
    if (!tokenP) {
      tokenAt = Date.now();
      tokenP = fetch(API + "?action=ftoken").then(function (r) { return r.json(); })
        .then(function (d) { return d && d.ok ? d.token : ""; })
        .catch(function () { tokenP = null; return ""; });
    }
    return tokenP;
  }

  /* ---- honeypot: a field only a bot would fill, added to every form (including popups built later) ---- */
  function addHoneypot(form) {
    if (!form || form.querySelector(".vs-hp")) return;
    var wrap = document.createElement("div");
    wrap.setAttribute("aria-hidden", "true");
    wrap.style.cssText = "position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden;opacity:0";
    wrap.innerHTML = '<label>Leave this field empty<input class="vs-hp" type="text" name="hp_website" tabindex="-1" autocomplete="off"></label>';
    form.appendChild(wrap);
  }
  function scan(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.tagName === "FORM") addHoneypot(root);
    Array.prototype.forEach.call(root.querySelectorAll("form"), addHoneypot);
  }
  function honeypotValue() {
    var els = document.querySelectorAll(".vs-hp");
    for (var i = 0; i < els.length; i++) if (els[i].value) return els[i].value;
    return "";
  }

  /* ---- optional Cloudflare Turnstile (invisible unless Cloudflare needs to challenge) ---- */
  var tsId = null, tsToken = "", tsWaiters = [];
  function loadTurnstile() {
    if (!VS_TURNSTILE_SITEKEY || document.getElementById("vs-ts-script")) return;
    window.__vsTsReady = function () {
      var box = document.createElement("div");
      box.style.cssText = "position:fixed;right:16px;bottom:84px;z-index:2147483000";
      document.body.appendChild(box);
      tsId = window.turnstile.render(box, {
        sitekey: VS_TURNSTILE_SITEKEY, appearance: "interaction-only",
        callback: function (t) { tsToken = t; tsWaiters.splice(0).forEach(function (f) { f(t); }); },
        "expired-callback": function () { tsToken = ""; }
      });
    };
    var s = document.createElement("script");
    s.id = "vs-ts-script"; s.async = true;
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__vsTsReady";
    document.head.appendChild(s);
  }
  function captcha() {
    if (!VS_TURNSTILE_SITEKEY) return Promise.resolve("");
    if (tsToken) return Promise.resolve(tsToken);
    return new Promise(function (res, rej) {
      tsWaiters.push(res);
      setTimeout(function () { var e = new Error("Please complete the security check and try again."); e.userMessage = e.message; rej(e); }, 15000);
    });
  }

  window.VSGuard = {
    warm: warm,
    /** Returns a Promise of formData + anti-spam fields. Never mutates the object passed in. */
    prepare: function (formData) {
      var tp = warm();
      return Promise.all([tp, captcha()]).then(function (r) {
        var wait = Math.max(0, MIN_AGE_MS - (Date.now() - tokenAt));      // never post inside the first 3 s
        return new Promise(function (res) { setTimeout(res, wait); }).then(function () {
          var out = {};
          Object.keys(formData || {}).forEach(function (k) { out[k] = formData[k]; });
          if (r[0]) out.form_token = r[0];
          out.hp_website = honeypotValue();
          if (r[1]) out.cf_turnstile = r[1];
          if (VS_TURNSTILE_SITEKEY && window.turnstile && tsId !== null) { tsToken = ""; try { window.turnstile.reset(tsId); } catch (e) {} }
          return out;
        });
      });
    }
  };

  function start() {
    scan(document);
    new MutationObserver(function (muts) {
      muts.forEach(function (m) { Array.prototype.forEach.call(m.addedNodes, function (n) { if (n.nodeType === 1) scan(n); }); });
    }).observe(document.documentElement, { childList: true, subtree: true });
    // the token is fetched when the visitor first engages with a form or the chat, not on every page view
    document.addEventListener("focusin", function (e) { if (e.target && e.target.closest && e.target.closest("form,#ec-chat")) { warm(); loadTurnstile(); } }, true);
    document.addEventListener("click", function (e) { if (e.target && e.target.closest && e.target.closest("#ec-launcher,[data-action='enquire']")) { warm(); loadTurnstile(); } }, true);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
