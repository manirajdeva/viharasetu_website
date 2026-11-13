/**
 * antiSpam.js
 * Bot / spam protection for the PUBLIC enquiry endpoints (website form, journey
 * popup, chatbot). Layers, cheapest first:
 *
 *   1. Honeypot      a hidden form field real visitors never fill. If it has a
 *                    value the submission is silently dropped (the bot is told
 *                    it worked so it does not adapt).
 *   2. Form token    GET /exec?action=ftoken (or /api/public/form-token) returns
 *                    a short-lived HMAC-signed timestamp. A submission must carry
 *                    one that is at least MIN_FILL_MS old, so instant scripted
 *                    posts fail. Submissions with NO token (old cached pages) are
 *                    still accepted but only at a much lower rate.
 *   3. Rate limits   per-IP caps per hour and per day (see limiters in exec.js /
 *                    public.js), plus a per-IP cap for token-less submissions.
 *   4. Duplicates    the same phone or email cannot be submitted again within
 *                    DUPLICATE_WINDOW_MS.
 *   5. CAPTCHA       optional Cloudflare Turnstile. Turned on by setting
 *                    TURNSTILE_SECRET_KEY (and the site key in js/enquiry-guard.js).
 *
 * All state is in memory (fine for one instance; use Redis if you ever scale out).
 */

const crypto = require('crypto');
const config = require('./config');
const log = require('./logger');

const MIN_FILL_MS = 3000;                    // a human cannot fill a form faster
const TOKEN_MAX_AGE_MS = 4 * 60 * 60 * 1000;  // token expires after 4 hours
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
const NO_TOKEN_PER_HOUR = 3;

const SECRET = config.formTokenSecret || crypto.randomBytes(32).toString('hex');
if (!config.formTokenSecret) {
  log.warn('FORM_TOKEN_SECRET is not set: form tokens use a random per-boot secret and reset on restart. Set it in the environment.');
}

const sign = (ts) => crypto.createHmac('sha256', SECRET).update(String(ts)).digest('hex').slice(0, 32);

function issueToken() {
  const ts = Date.now();
  return `${ts}.${sign(ts)}`;
}

/** { ok:true } | { ok:false, reason:'MISSING'|'BAD'|'TOO_FAST'|'EXPIRED' } */
function checkToken(token) {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'MISSING' };
  const [tsStr, mac] = token.split('.');
  const ts = Number(tsStr);
  if (!Number.isFinite(ts) || !mac) return { ok: false, reason: 'BAD' };
  const expected = sign(ts);
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'BAD' };
  const age = Date.now() - ts;
  if (age < MIN_FILL_MS) return { ok: false, reason: 'TOO_FAST' };
  if (age > TOKEN_MAX_AGE_MS) return { ok: false, reason: 'EXPIRED' };
  return { ok: true };
}

/* ---- tiny in-memory counters, swept regularly ---- */
const noTokenHits = new Map();   // ip -> [timestamps]
const recent = new Map();        // phone/email key -> timestamp

setInterval(() => {
  const now = Date.now();
  for (const [k, t] of recent) if (now - t > DUPLICATE_WINDOW_MS) recent.delete(k);
  for (const [k, arr] of noTokenHits) {
    const keep = arr.filter((t) => now - t < 60 * 60 * 1000);
    if (keep.length) noTokenHits.set(k, keep); else noTokenHits.delete(k);
  }
}, 5 * 60 * 1000).unref();

function overNoTokenLimit(ip) {
  const now = Date.now();
  const arr = (noTokenHits.get(ip) || []).filter((t) => now - t < 60 * 60 * 1000);
  if (arr.length >= NO_TOKEN_PER_HOUR) { noTokenHits.set(ip, arr); return true; }
  arr.push(now);
  noTokenHits.set(ip, arr);
  return false;
}

const digits = (v) => String(v == null ? '' : v).replace(/\D/g, '').slice(-10);
const dupKeys = (b) => [
  digits(b.phone) ? 'p:' + digits(b.phone) : null,
  b.email ? 'e:' + String(b.email).trim().toLowerCase() : null,
].filter(Boolean);

async function verifyTurnstile(token, ip) {
  if (!token) return false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: config.turnstileSecret, response: String(token), remoteip: ip || '' }),
    });
    const data = await res.json();
    return !!data.success;
  } catch (e) {
    log.warn('Turnstile verification call failed: ' + (e.message || e));
    return false;                    // fail closed when CAPTCHA is enabled
  }
}

/**
 * Decide what to do with a public enquiry.
 * Returns { action: 'allow' }
 *      or { action: 'drop' }                         (pretend success, store nothing)
 *      or { action: 'reject', status, code, message } (tell the visitor)
 */
async function inspect(req, body) {
  const b = body && typeof body === 'object' ? body : {};

  // 1. honeypot
  if (String(b.hp_website || b.website || '').trim() !== '') {
    log.warn('antiSpam: honeypot filled, dropped');
    return { action: 'drop' };
  }

  // 5. CAPTCHA (only when configured)
  if (config.turnstileSecret) {
    const ok = await verifyTurnstile(b.cf_turnstile || b['cf-turnstile-response'], req.ip);
    if (!ok) {
      return { action: 'reject', status: 400, code: 'CAPTCHA', message: 'Please complete the security check and try again.' };
    }
  }

  // 2. token
  const t = checkToken(b.form_token);
  if (!t.ok) {
    if (t.reason === 'MISSING') {
      if (overNoTokenLimit(req.ip)) {
        return { action: 'reject', status: 429, code: 'RATE_LIMITED', message: 'Too many submissions. Please refresh the page and try again later.' };
      }
    } else if (t.reason === 'TOO_FAST') {
      return { action: 'reject', status: 429, code: 'TOO_FAST', message: 'That was very quick. Please check your details and submit again.' };
    } else if (t.reason === 'EXPIRED') {
      return { action: 'reject', status: 400, code: 'FORM_EXPIRED', message: 'This form has expired. Please refresh the page and try again.' };
    } else {
      return { action: 'reject', status: 400, code: 'BAD_TOKEN', message: 'Security check failed. Please refresh the page and try again.' };
    }
  }

  // 4. duplicates
  const keys = dupKeys(b);
  const now = Date.now();
  if (keys.some((k) => recent.has(k) && now - recent.get(k) < DUPLICATE_WINDOW_MS)) {
    return { action: 'reject', status: 429, code: 'DUPLICATE', message: 'We already received your enquiry a moment ago. Our team will contact you soon.' };
  }
  return { action: 'allow' };
}

/** Call after an enquiry was stored, so only real submissions count as duplicates. */
function markSubmitted(body) {
  const now = Date.now();
  dupKeys(body && typeof body === 'object' ? body : {}).forEach((k) => recent.set(k, now));
}

module.exports = { issueToken, checkToken, inspect, markSubmitted };
