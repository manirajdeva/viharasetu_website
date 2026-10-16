/*! enquiry-chat.js - Viharasetu enquiry chatbot (floating "Plan your trip" button on every page).
 *  Asks the same questions as the contact form, saves the enquiry through the same API,
 *  then opens WhatsApp with the details ready to send. Add to any page with:
 *    <script src="<path>/js/enquiry-chat.js" defer></script>
 */
(function () {
  if (document.getElementById("ec-launcher")) return;
  var API = "https://viharasetu-api.onrender.com/exec";   // keep in sync with sendEnquiry() in index.html
  window.ecPost = function (formData) {
    return fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(formData) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) { var e = new Error((d.error && d.error.message) || "Unknown error"); e.userMessage = d.error && d.error.message; throw e; }
        return d;
      });
  };
  var ecPost = window.ecPost;

  if (!document.querySelector('link[href*="family=Jost"]')) {
    var f = document.createElement("link"); f.rel = "stylesheet";
    f.href = "https://fonts.googleapis.com/css2?family=Jost:wght@300;400;500&display=swap";
    document.head.appendChild(f);
  }
  var st = document.createElement("style"); st.textContent = "#ec-launcher,#ec-chat{--ec-green:#2d5a45;--ec-green-dark:#244a39;--ec-field:#3f6b55;--ec-line:#5d8671;--ec-gold:#b8923e;--ec-text:#f2f5f1;--ec-muted:#9db8a9}\n#ec-chat,#ec-chat *{box-sizing:border-box}\n#ec-chat{font-family:'Jost',sans-serif}\n/* ---------- Floating launcher ---------- */\n  #ec-launcher{\n    position:fixed;right:24px;bottom:24px;width:62px;height:62px;border-radius:50%;\n    background:var(--ec-gold);border:none;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.3);\n    display:flex;align-items:center;justify-content:center;z-index:80;transition:transform .2s\n  }\n  #ec-launcher:hover{transform:scale(1.07)}\n  #ec-launcher svg{width:26px;height:26px;fill:#1d1d1d}\n\n  /* ---------- Chat window ---------- */\n  #ec-chat{\n    position:fixed;right:24px;bottom:100px;width:380px;max-width:calc(100vw - 32px);\n    height:560px;max-height:calc(100vh - 120px);background:var(--ec-green);color:var(--ec-text);\n    border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.35);display:none;flex-direction:column;\n    overflow:hidden;z-index:85\n  }\n  #ec-chat.open{display:flex;animation:ecpop .25s ease}\n  @keyframes ecpop{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}\n\n  .ec-head{background:var(--ec-green-dark);padding:14px 18px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--ec-line)}\n  .ec-head h3{margin:0;font-size:16px;font-weight:500;letter-spacing:.5px}\n  .ec-head small{color:var(--ec-muted);font-size:12px;display:block;margin-top:2px}\n  .ec-close{background:none;border:none;color:var(--ec-text);font-size:22px;cursor:pointer;line-height:1}\n  .ec-progress{height:3px;background:var(--ec-green-dark)}\n  .ec-progress div{height:100%;width:0;background:var(--ec-gold);transition:width .3s}\n\n  .ec-body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}\n  .ec-msg{max-width:84%;padding:10px 14px;border-radius:12px;font-size:14.5px;line-height:1.45;animation:ecpop .2s ease;word-wrap:break-word}\n  .ec-bot{background:var(--ec-field);border:1px solid var(--ec-line);align-self:flex-start;border-bottom-left-radius:3px}\n  .ec-user{background:var(--ec-gold);color:#1d1d1d;align-self:flex-end;border-bottom-right-radius:3px;font-weight:500}\n  .ec-typing{display:flex;gap:4px;padding:12px 14px}\n  .ec-typing span{width:7px;height:7px;border-radius:50%;background:var(--ec-muted);animation:ecblink 1s infinite}\n  .ec-typing span:nth-child(2){animation-delay:.15s}.ec-typing span:nth-child(3){animation-delay:.3s}\n  @keyframes ecblink{0%,80%,100%{opacity:.3}40%{opacity:1}}\n\n  .ec-summary{align-self:flex-start;width:92%;background:var(--ec-field);border:1px solid var(--ec-line);border-radius:12px;padding:12px 14px;font-size:13.5px}\n  .ec-summary div{display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px dashed var(--ec-line)}\n  .ec-summary div{align-items:center}\n  .ec-summary div:last-child{border:none}\n  .ec-summary b{color:var(--ec-muted);font-weight:400;flex-shrink:0;min-width:84px}\n  .ec-summary span{flex:1;text-align:right;word-break:break-word}\n  .ec-edit{flex-shrink:0;background:none;border:1px solid var(--ec-gold);color:var(--ec-gold);font:inherit;font-size:11.5px;padding:2px 8px;border-radius:12px;cursor:pointer}\n  .ec-edit:hover{background:var(--ec-gold);color:#1d1d1d}\n\n  /* ---------- Input area ---------- */\n  .ec-foot{padding:12px;border-top:1px solid var(--ec-line);background:var(--ec-green-dark)}\n  .ec-row{display:flex;gap:8px}\n  .ec-foot input,.ec-foot select,.ec-foot textarea{\n    flex:1;min-width:0;background:var(--ec-field);border:1px solid var(--ec-line);color:#fff;\n    padding:11px 12px;font:inherit;font-size:14.5px;border-radius:4px;outline:none\n  }\n  .ec-foot input::placeholder,.ec-foot textarea::placeholder{color:var(--ec-muted)}\n  .ec-foot input:focus,.ec-foot select:focus,.ec-foot textarea:focus{border-color:var(--ec-gold)}\n  .ec-foot select.cc{flex:0 0 112px}\n  .ec-foot textarea{resize:none;height:70px}\n  .ec-send{background:var(--ec-gold);color:#1d1d1d;border:none;padding:0 16px;font:inherit;font-weight:500;letter-spacing:1px;font-size:13px;text-transform:uppercase;cursor:pointer;border-radius:4px}\n  .ec-send:hover{filter:brightness(1.1)}\n  .ec-send:disabled{opacity:.5;cursor:default}\n  .ec-chips{display:flex;flex-wrap:wrap;gap:8px}\n  .ec-chip{background:transparent;border:1px solid var(--ec-gold);color:var(--ec-text);padding:8px 14px;border-radius:20px;font:inherit;font-size:13.5px;cursor:pointer}\n  .ec-chip:hover{background:var(--ec-gold);color:#1d1d1d}\n  .ec-skip{background:none;border:none;color:var(--ec-muted);font:inherit;font-size:12.5px;text-decoration:underline;cursor:pointer;margin-top:8px;padding:0}\n  .ec-err{color:#ffb4a8;font-size:12.5px;margin:0 0 8px}\n  .ec-note{text-align:center;color:var(--ec-muted);font-size:11.5px;margin-top:8px}\n\n/* keep clear of the mobile contact bar and use the full width on phones */\n@media (max-width:768px){\n  #ec-launcher{right:16px;bottom:calc(88px + env(safe-area-inset-bottom));height:52px;padding:0 18px 0 14px}\n    #ec-chat{right:8px;left:8px;width:auto;max-width:none;bottom:calc(154px + env(safe-area-inset-bottom));height:min(560px,calc(100vh - 190px))}\n}\n.ec-open-link{display:inline-flex;align-items:center;gap:10px;margin-top:22px;background:none;border:1px solid rgba(255,255,255,.35);color:#fff;font:inherit;font-size:.78rem;letter-spacing:.14em;text-transform:uppercase;padding:.8rem 1.4rem;cursor:pointer;transition:background .25s,border-color .25s}\n.ec-open-link:hover{background:rgba(255,255,255,.12);border-color:#b8923e}\n.ec-open-link svg{width:18px;height:18px;fill:none;stroke:#e0bf80;stroke-width:1.6;stroke-linejoin:round}\n\n.ec-direct{display:block;text-align:center;font:inherit;font-size:12.5px;color:var(--ec-muted);text-decoration:underline;margin-top:8px}\n.ec-direct:hover{color:#fff}\n\n/* ---- round WhatsApp launcher ---- */\n#ec-launcher{width:60px;height:60px;padding:0;border-radius:50%;right:28px;bottom:28px;position:fixed;\n  background:linear-gradient(145deg,#d4ac55,#b8923e);box-shadow:0 10px 26px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.35);\n  transition:transform .25s cubic-bezier(.2,.9,.3,1.3),box-shadow .25s}\n#ec-launcher:hover{transform:scale(1.1);box-shadow:0 14px 32px rgba(0,0,0,.42),inset 0 1px 0 rgba(255,255,255,.4)}\n#ec-launcher:active{transform:scale(.94)}\n#ec-launcher .ec-launcher-label{display:none}\n#ec-launcher svg{position:absolute;width:28px;height:28px;transition:transform .45s cubic-bezier(.2,.9,.3,1.2),opacity .25s}\n#ec-launcher .ec-ico-x{opacity:0;transform:rotate(-90deg) scale(.5);fill:none;stroke:#1d1d1d;stroke-width:2.4;stroke-linecap:round}\n#ec-launcher.ec-active .ec-ico-wa{opacity:0;transform:rotate(90deg) scale(.5)}\n#ec-launcher.ec-active .ec-ico-x{opacity:1;transform:none}\n#ec-launcher::after{content:\"\";position:absolute;inset:-6px;border-radius:50%;border:2px solid rgba(184,146,62,.6);animation:ecpulse 2.2s ease-out 4;pointer-events:none}\n#ec-launcher.ec-active::after{animation:none;opacity:0}\n@keyframes ecpulse{0%{opacity:.9;transform:scale(.92)}100%{opacity:0;transform:scale(1.35)}}\n\n/* ---- chat window opens / closes with a spring animation from the button ---- */\n#ec-chat{display:flex!important;visibility:hidden;opacity:0;pointer-events:none;transform-origin:bottom right;\n  transform:translateY(22px) scale(.82);bottom:100px;\n  transition:opacity .22s ease,transform .38s cubic-bezier(.2,.9,.3,1.18),visibility 0s linear .38s;animation:none!important}\n#ec-chat.open{visibility:visible;opacity:1;pointer-events:auto;transform:none;\n  transition:opacity .22s ease,transform .38s cubic-bezier(.2,.9,.3,1.18),visibility 0s}\n#ec-chat.open .ec-head,#ec-chat.open .ec-body,#ec-chat.open .ec-foot{animation:ecfade .5s ease .12s both}\n@keyframes ecfade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}\n@media (prefers-reduced-motion:reduce){\n  #ec-launcher::after{animation:none}\n  #ec-chat,#ec-chat.open{transition:opacity .01s;transform:none}\n  #ec-chat.open .ec-head,#ec-chat.open .ec-body,#ec-chat.open .ec-foot{animation:none}\n}\n@media (max-width:900px){#ec-launcher{right:16px;bottom:calc(122px + env(safe-area-inset-bottom));width:54px;height:54px}#ec-chat{bottom:calc(188px + env(safe-area-inset-bottom))}}\n"; document.head.appendChild(st);
  var wrap = document.createElement("div"); wrap.innerHTML = "<button id=\"ec-launcher\" aria-label=\"Chat with us on WhatsApp\" title=\"Chat with us\">\n  <svg class=\"ec-ico-wa\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12.04 2c-5.52 0-10 4.48-10 10 0 1.77.46 3.45 1.27 4.9L2 22l5.25-1.38A9.95 9.95 0 0 0 12.04 22c5.52 0 10-4.48 10-10s-4.48-10-10-10Zm0 18.06c-1.63 0-3.15-.46-4.44-1.26l-.32-.19-3.12.82.83-3.04-.2-.31A8.06 8.06 0 0 1 3.98 12c0-4.44 3.62-8.06 8.06-8.06 4.44 0 8.06 3.62 8.06 8.06 0 4.44-3.62 8.06-8.06 8.06Zm4.42-6.04c-.24-.12-1.43-.7-1.65-.79-.22-.08-.38-.12-.54.12-.16.24-.62.79-.76.95-.14.16-.28.18-.52.06-.24-.12-1.02-.38-1.94-1.2-.72-.64-1.2-1.43-1.34-1.67-.14-.24-.02-.37.1-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.2-.47-.4-.4-.54-.41h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.6 4.12 3.64.58.25 1.03.4 1.38.51.58.18 1.11.16 1.53.1.47-.07 1.43-.58 1.63-1.15.2-.56.2-1.04.14-1.14-.06-.1-.22-.16-.46-.28Z\"/></svg>\n  <svg class=\"ec-ico-x\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M6 6l12 12M18 6 6 18\"/></svg>\n  <span class=\"ec-launcher-label\">Plan your trip</span>\n</button>\n\n<div id=\"ec-chat\" role=\"dialog\" aria-label=\"Travel enquiry chat\">\n  <div class=\"ec-head\">\n    <div><h3>Plan Your Trip</h3><small>We respond within 24 hours</small></div>\n    <button class=\"ec-close\" id=\"ec-close\" aria-label=\"Close\">&times;</button>\n  </div>\n  <div class=\"ec-progress\"><div id=\"ec-bar\"></div></div>\n  <div class=\"ec-body\" id=\"ec-body\"></div>\n  <div class=\"ec-foot\" id=\"ec-foot\"></div>\n</div>";
  while (wrap.firstChild) document.body.appendChild(wrap.firstChild);

(function () {
  /* ================= CONFIG ================= */
  var CONFIG = {
    botName: "Travel Desk",
    hotelOptions: ["3 Star", "4 Star", "5 Star"], // same choices as the enquiry form
    countryCodes: [
      ["India", "+91"], ["Nepal", "+977"], ["USA", "+1"], ["UK", "+44"], ["UAE", "+971"],
      ["Singapore", "+65"], ["Australia", "+61"], ["Canada", "+1"]
    ]
  };

  /* ================= STEPS (same fields as your form) ================= */
  var steps = [
    { key: "name",        type: "text",  q: "Hello! Let's plan your dream journey. What's your name?", ph: "Your Name" },
    { key: "email",       type: "email", q: "Nice to meet you, {name}! What's your email address?", ph: "Email Address" },
    { key: "phone",       type: "phone", q: "And your contact number?", ph: "Contact Number" },
    { key: "destination", type: "text",  q: "Where would you love to go?", ph: "e.g. Varanasi, Ladakh, Kerala..." },
    { key: "dates",       type: "text",  q: "When are you planning to travel, and for how long?", ph: "e.g. 10–17 Dec, 7 days" },
    { key: "people",      type: "number",q: "How many people will be travelling?", ph: "No. of People" },
    { key: "hotel",       type: "choice",q: "What kind of stay do you prefer?", options: CONFIG.hotelOptions },
    { key: "requests",    type: "area",  q: "Any special requests — flights, celebrations, meals...?", ph: "Type here (optional)", optional: true }
  ];

  var body = document.getElementById("ec-body");
  var foot = document.getElementById("ec-foot");
  var bar  = document.getElementById("ec-bar");
  var chat = document.getElementById("ec-chat");
  var data = {}, idx = 0, started = false, busy = false, editIdx = null, lastBox = null;

  /* ---------- open / close ---------- */
  document.getElementById("ec-launcher").onclick = function () {
    chat.classList.toggle("open");
    if (chat.classList.contains("open") && !started) { started = true; askStep(); }
  };
  window.ecOpenChat = function () {
    chat.classList.add("open");
    if (!started) { started = true; askStep(); }
  };
  document.getElementById("ec-close").onclick = function () { chat.classList.remove("open"); };

  /* ---------- helpers ---------- */
  function scroll() { body.scrollTop = body.scrollHeight; }
  function addMsg(text, who) {
    var d = document.createElement("div");
    d.className = "ec-msg " + (who === "user" ? "ec-user" : "ec-bot");
    d.textContent = text;
    body.appendChild(d); scroll();
  }
  function botSay(text, cb) {
    busy = true; foot.style.visibility = "hidden";
    var t = document.createElement("div");
    t.className = "ec-msg ec-bot ec-typing";
    t.innerHTML = "<span></span><span></span><span></span>";
    body.appendChild(t); scroll();
    setTimeout(function () {
      t.remove(); addMsg(text, "bot");
      busy = false; foot.style.visibility = "visible";
      if (cb) cb();
    }, 650);
  }
  function fill(str) {
    return str.replace(/\{(\w+)\}/g, function (_, k) { return (data[k] || "").split(" ")[0]; });
  }
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (html) e.innerHTML = html;
    return e;
  }

  /* ---------- validation ---------- */
  function validate(step, v) {
    if (!v) return step.optional ? "" : "Please fill this in to continue.";
    if (step.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return "Please enter a valid email address.";
    if (step.type === "phone") {
      var d = v.replace(/[\s\-().]/g, ""), cc = (document.querySelector("#ec-foot select.cc") || {}).value;
      if (cc === "+91") {
        if (/^0[6-9]\d{9}$/.test(d)) d = d.slice(1); else if (/^91[6-9]\d{9}$/.test(d)) d = d.slice(2);
        if (!/^[6-9]\d{9}$/.test(d)) return "Please enter a valid 10-digit Indian mobile number.";
      } else if (!/^\d{6,14}$/.test(d)) return "Please enter a valid phone number (digits only).";
    }
    if (step.type === "number" && !(parseInt(v, 10) > 0)) return "Please enter a number greater than 0.";
    return "";
  }

  /* ---------- ask current step ---------- */
  function askStep() {
    bar.style.width = (idx / steps.length * 100) + "%";
    if (idx >= steps.length) return showSummary();
    var s = steps[idx];
    botSay(fill(s.q), function () { renderInput(s); });
  }

  function renderInput(s) {
    foot.innerHTML = "";
    var err = el("p", { "class": "ec-err" }); err.style.display = "none";
    foot.appendChild(err);

    function submit(display, value, prevalidated) {
      var msg = prevalidated ? "" : validate(s, value);
      if (msg) { err.textContent = msg; err.style.display = "block"; return; }
      data[s.key] = value;
      addMsg(display || value || "(skipped)", "user");
      foot.innerHTML = "";
      if (editIdx !== null) { editIdx = null; showSummary(true); }
      else { idx++; askStep(); }
    }

    if (s.type === "choice") {
      var chips = el("div", { "class": "ec-chips" });
      s.options.forEach(function (o) {
        var b = el("button", { "class": "ec-chip", type: "button" }); b.textContent = o;
        b.onclick = function () { submit(o, o); };
        chips.appendChild(b);
      });
      foot.appendChild(chips);
      return;
    }

    var row = el("div", { "class": "ec-row" });
    var input, cc;

    if (s.type === "area") {
      input = el("textarea", { placeholder: s.ph });
    } else if (s.type === "phone") {
      cc = el("select", { "class": "cc" });
      CONFIG.countryCodes.forEach(function (c) {
        var o = el("option", { value: c[1] }); o.textContent = c[0] + " (" + c[1] + ")";
        cc.appendChild(o);
      });
      row.appendChild(cc);
      input = el("input", { type: "tel", placeholder: s.ph, inputmode: "tel" });
    } else {
      input = el("input", {
        type: s.type === "email" ? "email" : (s.type === "number" ? "number" : "text"),
        placeholder: s.ph, min: "1"
      });
    }
    row.appendChild(input);

    /* prefill current answer when editing */
    if (editIdx !== null && data[s.key]) {
      if (s.type === "phone") {
        var parts = data[s.key].split(" ");
        input.value = parts.slice(1).join("");
        for (var i = 0; i < cc.options.length; i++) if (cc.options[i].value === parts[0]) { cc.selectedIndex = i; break; }
      } else { input.value = data[s.key]; }
    }

    var btn = el("button", { "class": "ec-send", type: "button" }); btn.textContent = editIdx !== null ? "Update" : "Send";
    row.appendChild(btn);
    foot.appendChild(row);

    function go() {
      var v = input.value.trim();
      if (s.type === "phone") {
        var pmsg = validate(s, v);
        if (pmsg) { err.textContent = pmsg; err.style.display = "block"; return; }
        var digits = v.replace(/[\s\-().]/g, "");
        submit(cc.value + " " + digits, cc.value + " " + digits, true);
        return;
      }
      submit(v, v);
    }
    btn.onclick = go;
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !(s.type === "area" && e.shiftKey)) { e.preventDefault(); go(); }
    });

    if (s.optional) {
      var skip = el("button", { "class": "ec-skip", type: "button" }); skip.textContent = "Skip this";
      skip.onclick = function () { submit("Skipped", ""); };
      foot.appendChild(skip);
    }
    setTimeout(function () { input.focus(); }, 50);
  }

  /* ---------- summary + submit ---------- */
  var labels = {
    name: "Name", email: "Email", phone: "Contact", destination: "Destination",
    dates: "Dates / Duration", people: "People", hotel: "Hotel", requests: "Special requests"
  };

  function startEdit(i) {
    if (busy) return;
    if (lastBox) { lastBox.remove(); lastBox = null; }
    editIdx = i;
    foot.innerHTML = "";
    botSay("Sure — please enter your new " + labels[steps[i].key].toLowerCase() + ":", function () {
      renderInput(steps[i]);
    });
  }

  function showSummary(updated) {
    bar.style.width = "100%";
    var intro = updated
      ? "Updated! Here are your details:"
      : "Thanks, " + data.name.split(" ")[0] + "! Please check your details:";
    botSay(intro, function () {
      var box = el("div", { "class": "ec-summary" });
      steps.forEach(function (s, i) {
        var row = el("div"), b = el("b"), v = el("span"), e = el("button", { "class": "ec-edit", type: "button", title: "Edit" });
        b.textContent = labels[s.key]; v.textContent = data[s.key] || "—";
        e.innerHTML = "&#9998; Edit";
        e.onclick = function () { startEdit(i); };
        row.appendChild(b); row.appendChild(v); row.appendChild(e); box.appendChild(row);
      });
      body.appendChild(box); lastBox = box; scroll();

      foot.innerHTML = "";
      var send = el("button", { "class": "ec-send", type: "button" });
      send.style.cssText = "width:100%;padding:13px";
      send.textContent = "Send Enquiry →";
      var restart = el("button", { "class": "ec-skip", type: "button" }); restart.textContent = "Start over";
      restart.onclick = reset;
      send.onclick = function () { submitEnquiry(send); };
      foot.appendChild(send); foot.appendChild(restart);
      foot.appendChild(el("p", { "class": "ec-note" }, "Your details are saved, then WhatsApp opens with them ready to send. We respond within 24 hours."));
    });
  }

  /* WhatsApp number that receives the chat enquiries (same as the site's WhatsApp links) */
  var WA_NUMBER = "919885180515";

  function cap(v) { v = String(v || "").trim(); return v ? v.charAt(0).toUpperCase() + v.slice(1) : v; }
  function waText(enquiryId) {
    // Plain symbols (no emoji) so the message looks the same on every phone and WhatsApp version
    var people = String(data.people || "").trim();
    var who = people === "1" ? "1 traveller" : (people + " travellers");
    var lines = [
      "✦ *Namaste Viharasetu Team!* ✦",
      "",
      "I'm *" + data.name + "* and I'd love to plan a journey with you.",
      "",
      "❖ *MY DREAM JOURNEY*",
      "➤ Destination: *" + cap(data.destination) + "*",
      "➤ When & how long: " + data.dates,
      "➤ Travelling: " + who,
      "➤ Stay: " + data.hotel,
      "➤ Special requests: " + (data.requests ? cap(data.requests) : "None"),
      "",
      "☎ *REACH ME AT*",
      "➤ Phone: " + data.phone,
      "➤ Email: " + data.email,
      "",
      "Please share a tailor-made itinerary and quote. Looking forward to hearing from you! ❀",
      "",
      "— Sent from viharasetu.co.in"
    ];
    return lines.join("\n");
  }
  function waUrl(enquiryId) {
    return "https://wa.me/" + WA_NUMBER + "?text=" + encodeURIComponent(waText(enquiryId));
  }

  function submitEnquiry(btn) {
    btn.disabled = true; btn.textContent = "Sending...";
    // Open the WhatsApp tab right away (inside the click) so pop-up blockers allow it;
    // it is pointed at the finished message once the enquiry has been saved.
    var wa = window.open("", "_blank");
    if (wa) { try { wa.document.title = "Opening WhatsApp..."; wa.document.body.innerHTML = "<p style='font-family:sans-serif;padding:24px'>Opening WhatsApp&hellip;</p>"; } catch (e) {} }

    var payload = {
      name: data.name, email: data.email, phone: data.phone,
      destination: data.destination, travel: data.dates, no_of_people: data.people,
      hotel_preference: data.hotel, special_req: data.requests || "",
      source: "chatbot"
    };

    function finish(enquiryId, saved) {
      var url = waUrl(enquiryId);
      var opened = false;
      if (wa && !wa.closed) { wa.location.href = url; opened = true; }
      foot.innerHTML = "";
      var msg = saved
        ? "Your enquiry has been saved" + (enquiryId ? " (ID: " + enquiryId + ")" : "") + ". " + (opened ? "WhatsApp is opening with your details \u2014 just press Send there to reach us instantly." : "Tap the button below to send the same details on WhatsApp.")
        : "We couldn't save your enquiry online, but your details are ready on WhatsApp \u2014 tap Send there and our team will get them straight away.";
      botSay(msg, function () {
        var w = el("a", { "class": "ec-send", href: url, target: "_blank", rel: "noopener" });
        w.style.cssText = "display:block;text-align:center;text-decoration:none;width:100%;padding:13px;line-height:1.2";
        w.textContent = opened ? "Open WhatsApp again" : "Continue on WhatsApp";
        foot.appendChild(w);
        var b = el("button", { "class": "ec-skip", type: "button" }); b.textContent = "New enquiry";
        b.onclick = reset; foot.appendChild(b);
      });
    }

    // sendEnquiry() is the site's own function (same API as the contact form)
    (window.sendEnquiry || ecPost)(payload).then(function (res) {
      finish(res && res.enquiryId, true);
    }).catch(function (err) {
      if (err && err.userMessage) {
        // the API rejected the details (e.g. invalid phone): stay in the chat so they can be fixed
        if (wa && !wa.closed) wa.close();
        btn.disabled = false; btn.textContent = "Send Enquiry \u2192";
        addMsg(err.userMessage + " Please use Edit to correct it.", "bot");
      } else {
        finish("", false);
      }
    });
  }

  function reset() {
    data = {}; idx = 0; editIdx = null; lastBox = null; body.innerHTML = ""; foot.innerHTML = ""; askStep();
  }
})();

  // swap the launcher icon (WhatsApp <-> x) whenever the chat opens or closes
  (function () {
    var l = document.getElementById("ec-launcher"), c = document.getElementById("ec-chat");
    if (!l || !c) return;
    new MutationObserver(function () { l.classList.toggle("ec-active", c.classList.contains("open")); })
      .observe(c, { attributes: true, attributeFilter: ["class"] });
  })();

  // direct WhatsApp option under the first question
  var foot0 = document.getElementById("ec-chat");
  if (foot0) {
    var d = document.createElement("a");
    d.className = "ec-direct"; d.target = "_blank"; d.rel = "noopener";
    d.href = "https://wa.me/919885180515?text=" + encodeURIComponent("Namaste Viharasetu Team! I'd like to plan a journey.");
    d.textContent = "Prefer WhatsApp? Message us directly";
    foot0.querySelector(".ec-head > div").appendChild(d);
  }
})();
