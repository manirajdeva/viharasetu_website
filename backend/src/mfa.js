/**
 * mfa.js
 * Time-based one-time passwords (RFC 6238) for Microsoft Authenticator — and
 * any other authenticator app. No external dependencies: HMAC-SHA1, 6 digits,
 * 30-second step, which is what Microsoft Authenticator expects.
 *
 *  - Secrets are stored AES-256-GCM encrypted (key = MFA_ENC_KEY).
 *  - After the password is accepted, login returns a short-lived signed
 *    "challenge" token instead of a session; the session is only minted once
 *    a valid code is presented (see routes/exec.js).
 *  - A code can be used once (admins.totp_last_step), and repeated wrong codes
 *    lock the account's MFA step for a while.
 */

const crypto = require('crypto');

const STEP_SECONDS = 30;
const DIGITS = 6;
const WINDOW = 1;                         // accept the previous / next step too (clock drift)
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;
const ISSUER = 'Viharasetu Admin';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function masterKey() {
  const raw = process.env.MFA_ENC_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw Object.assign(new Error('MFA is not configured on the server (MFA_ENC_KEY is missing).'), { code: 'MFA_NOT_CONFIGURED' });
    }
    return crypto.createHash('sha256').update('viharasetu-dev-only-mfa-key').digest();   // local dev only
  }
  return crypto.createHash('sha256').update(raw).digest();
}

const subKey = (label) => crypto.createHmac('sha256', masterKey()).update(label).digest();

/* ------------------------------ base32 / TOTP ------------------------------ */

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of String(str).toUpperCase().replace(/=+$/, '')) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

const generateSecret = () => base32Encode(crypto.randomBytes(20));   // 160-bit, 32 chars

function hotp(secretB32, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secretB32)).update(buf).digest();
  const o = h[h.length - 1] & 0x0f;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** DIGITS).padStart(DIGITS, '0');
}

const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

/** Returns the matching time step, or null. `lastStep` blocks re-use of an already accepted code. */
function verifyCode(secretB32, code, lastStep) {
  const clean = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const now = currentStep();
  for (let d = -WINDOW; d <= WINDOW; d++) {
    const step = now + d;
    if (lastStep != null && step <= Number(lastStep)) continue;
    const expected = Buffer.from(hotp(secretB32, step));
    if (crypto.timingSafeEqual(expected, Buffer.from(clean))) return step;
  }
  return null;
}

/** The otpauth:// URI that Microsoft Authenticator reads from a QR code. */
function otpauthUri(username, secretB32) {
  const label = encodeURIComponent(`${ISSUER}:${username}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

/* ------------------------- secret encryption at rest ------------------------ */

function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', subKey('totp-secret'), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}

function decryptSecret(stored) {
  const [v, iv, tag, enc] = String(stored || '').split(':');
  if (v !== 'v1' || !iv || !tag || !enc) throw new Error('Unreadable MFA secret.');
  const d = crypto.createDecipheriv('aes-256-gcm', subKey('totp-secret'), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
}

/* ----------------------- challenge token (stateless) ------------------------ */

const b64u = (b) => Buffer.from(b).toString('base64url');

function issueChallenge(username) {
  const payload = b64u(JSON.stringify({ u: username, exp: Date.now() + CHALLENGE_TTL_MS }));
  const sig = crypto.createHmac('sha256', subKey('challenge')).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/** Returns the username inside a valid, unexpired challenge, else null. */
function readChallenge(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const want = crypto.createHmac('sha256', subKey('challenge')).update(payload).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return exp > Date.now() ? u : null;
  } catch { return null; }
}

/* ----------------------------- failure lock-out ----------------------------- */

const failures = new Map();   // username -> { n, until }

function lockedFor(username) {
  const f = failures.get(username);
  if (f && f.until > Date.now()) return Math.ceil((f.until - Date.now()) / 60000);
  return 0;
}
function recordFailure(username) {
  const f = failures.get(username) || { n: 0, until: 0 };
  if (f.until && f.until <= Date.now()) { f.n = 0; f.until = 0; }
  f.n += 1;
  if (f.n >= MAX_FAILURES) { f.until = Date.now() + LOCK_MS; f.n = 0; }
  failures.set(username, f);
}
const clearFailures = (username) => failures.delete(username);

module.exports = {
  generateSecret, verifyCode, otpauthUri,
  encryptSecret, decryptSecret,
  issueChallenge, readChallenge,
  lockedFor, recordFailure, clearFailures,
  base32Encode, base32Decode, hotp,
};
