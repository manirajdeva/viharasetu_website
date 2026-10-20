/**
 * password-toggle.js
 * Adds a "show / hide password" eye button to every <input type="password"> in
 * the portal — the Users add/edit form, the Profile page, anything added later.
 * Popups are built on demand, so a MutationObserver enhances fields as they
 * appear. Fields that already carry their own toggle (the login page) are skipped.
 *
 * Each field also shows a small Caps Lock badge while it is focused:
 *   amber "CAPS ON" / green "caps off". The state is read from every key and mouse
 *   event (getModifierState), so it is right the moment you click or Tab into a field.
 */
(function () {
  'use strict';

  var EYE =
    '<svg class="pw-ico pw-on" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF =
    '<svg class="pw-ico pw-off" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M3 3l18 18"/><path d="M10.6 5.1A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.1 4.1"/>' +
      '<path d="M6.5 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a9.8 9.8 0 0 0 4.2-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

  var css =
    '.pw-wrap{position:relative;display:block;width:100%}' +
    '.pw-wrap>input{padding-right:112px!important}' +
    '.pw-wrap input::-ms-reveal,.pw-wrap input::-ms-clear{display:none}' +
    '.pw-eye{position:absolute;right:5px;top:50%;transform:translateY(-50%);width:32px;height:32px;padding:0;border:0;' +
      'border-radius:7px;background:transparent;color:var(--ink-soft,#5C554A);cursor:pointer;display:grid;place-items:center;' +
      'transition:color .15s,background .15s}' +
    '.pw-eye:hover{color:var(--accent,#BB5A34);background:rgba(187,90,52,.08)}' +
    '.pw-eye:focus-visible{outline:2px solid var(--accent,#BB5A34);outline-offset:1px}' +
    '.pw-caps{position:absolute;right:42px;top:50%;transform:translateY(-50%);display:none;align-items:center;gap:5px;' +
      'padding:3px 8px 3px 7px;border-radius:999px;font-family:inherit;font-weight:600;font-size:10.5px;line-height:1.2;letter-spacing:.05em;text-transform:uppercase;' +
      'white-space:nowrap;pointer-events:none;user-select:none}' +
    '.pw-caps::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}' +
    '.pw-wrap:focus-within .pw-caps.known{display:inline-flex}' +
    '.pw-caps.on{background:#FDECC8;color:#8A4B00}' +
    '.pw-caps.off{background:rgba(42,92,69,.1);color:#2A5C45}' +
    '.pw-eye .pw-off{display:none}' +
    '.pw-eye[aria-pressed="true"] .pw-on{display:none}' +
    '.pw-eye[aria-pressed="true"] .pw-off{display:block}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var capsOn = null;                       // null = not known yet
  var badges = [];

  function paint(b) {
    b.classList.toggle('on', capsOn === true);
    b.classList.toggle('off', capsOn === false);
    b.classList.toggle('known', capsOn !== null);
    b.textContent = capsOn ? 'Caps on' : 'Caps off';
  }
  function readCaps(e) {
    if (!e || !e.getModifierState) return;
    var now = e.getModifierState('CapsLock');
    if (now === capsOn) return;
    capsOn = now;
    badges = badges.filter(function (b) { return b.isConnected; });
    badges.forEach(paint);
  }
  ['keydown', 'keyup', 'mousedown', 'mouseup'].forEach(function (t) {
    document.addEventListener(t, readCaps, true);
  });

  function enhance(input) {
    if (input.dataset.pwToggle) return;
    if (input.closest('.vs-input, .pw-wrap')) return;           // login page has its own eye
    input.dataset.pwToggle = '1';

    var wrap = document.createElement('span');
    wrap.className = 'pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-eye';
    btn.setAttribute('aria-label', 'Show password');
    btn.setAttribute('aria-pressed', 'false');
    btn.title = 'Show password';
    btn.innerHTML = EYE + EYE_OFF;
    wrap.appendChild(btn);

    var badge = document.createElement('span');
    badge.className = 'pw-caps';
    badge.setAttribute('role', 'status');
    badge.setAttribute('aria-live', 'polite');
    wrap.appendChild(badge);
    badges.push(badge);
    paint(badge);

    // keep the caret where it is: don't let the click pull focus off the field
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    btn.addEventListener('click', function () {
      var show = input.type === 'password';
      var s = input.selectionStart, e = input.selectionEnd;
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', show ? 'true' : 'false');
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      btn.title = show ? 'Hide password' : 'Show password';
      input.focus();
      try { input.setSelectionRange(s, e); } catch (_) { /* some types don't support it */ }
    });
  }

  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.matches && root.matches('input[type="password"]')) enhance(root);
    var list = root.querySelectorAll ? root.querySelectorAll('input[type="password"]') : [];
    for (var i = 0; i < list.length; i++) enhance(list[i]);
  }

  scan(document.body);
  new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      for (var j = 0; j < muts[i].addedNodes.length; j++) scan(muts[i].addedNodes[j]);
    }
  }).observe(document.body, { childList: true, subtree: true });
})();
