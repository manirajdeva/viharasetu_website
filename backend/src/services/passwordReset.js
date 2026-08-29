/**
 * services/passwordReset.js
 * Self-service password reset by email OTP (unauthenticated).
 *
 *   forgotPassword(email)                 -> always { ok:true, message } (no user enumeration)
 *   resetPassword(email, otp, newPassword) -> { ok:true } | throws { code }
 *
 * A 6-digit code is emailed, bcrypt-hashed into `password_resets`, valid for
 * OTP_TTL_MINUTES, single-use, and locked after 5 wrong tries. On success the
 * password is changed and every existing session for that user is dropped.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const config = require('../config');
const log = require('../logger');
const { sendMail } = require('../mailer');

const MAX_ATTEMPTS = 5;
const GENERIC = 'If that email is on an account, a reset code has been sent. It expires shortly.';

const invalid = () => Object.assign(new Error('That code is invalid or has expired. Request a new one.'), { code: 'OTP_INVALID' });

/** Exactly one account for this email, or null (0 or 2+ matches → treat as none). */
async function findUserByEmail(email) {
  const e = String(email || '').trim();
  if (!e) return null;
  const [rows] = await pool.query(
    "SELECT * FROM admins WHERE email <> '' AND LOWER(email) = LOWER(?) LIMIT 2",
    [e],
  );
  return rows.length === 1 ? rows[0] : null;
}

async function forgotPassword(email) {
  const user = await findUserByEmail(email);
  const out = { ok: true, message: GENERIC };

  if (user) {
    const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const otpHash = await bcrypt.hash(otp, 8);
    const expiresAt = new Date(Date.now() + config.otpTtlMs);

    await pool.query('DELETE FROM password_resets WHERE username = ?', [user.username]);
    await pool.query(
      'INSERT INTO password_resets (username, otp_hash, expires_at) VALUES (?, ?, ?)',
      [user.username, otpHash, expiresAt],
    );

    const mins = Math.max(1, Math.round(config.otpTtlMs / 60000));
    try {
      await sendMail({
        to: user.email,
        subject: `${config.mail.appName} — password reset code`,
        text:
          `Hi ${user.username},\n\n` +
          `Your ${config.mail.appName} password reset code is: ${otp}\n\n` +
          `It expires in ${mins} minutes. If you didn't ask to reset your password, ignore this email.\n`,
      });
    } catch (err) {
      log.error('Password-reset email failed to send', err);
    }

    // Dev convenience only: surface the code when nothing real is wired up yet.
    if (config.nodeEnv !== 'production' && config.mail.transport === 'console') {
      out.devOtp = otp;
    }
  }

  return out;
}

async function resetPassword(email, otp, newPassword) {
  if (String(newPassword || '').length < 6) {
    throw Object.assign(new Error('New password must be at least 6 characters.'), { code: 'VALIDATION' });
  }
  const user = await findUserByEmail(email);
  if (!user) throw invalid();

  const [rows] = await pool.query(
    'SELECT * FROM password_resets WHERE username = ? ORDER BY id DESC LIMIT 1',
    [user.username],
  );
  const row = rows[0];
  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
    if (row) await pool.query('DELETE FROM password_resets WHERE id = ?', [row.id]);
    throw invalid();
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    await pool.query('DELETE FROM password_resets WHERE id = ?', [row.id]);
    throw Object.assign(new Error('Too many incorrect attempts. Request a new code.'), { code: 'OTP_LOCKED' });
  }
  const match = await bcrypt.compare(String(otp || ''), row.otp_hash);
  if (!match) {
    await pool.query('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?', [row.id]);
    throw invalid();
  }

  const hash = await bcrypt.hash(String(newPassword), config.bcryptRounds);
  await pool.query('UPDATE admins SET password_hash = ? WHERE username = ?', [hash, user.username]);
  await pool.query('DELETE FROM password_resets WHERE username = ?', [user.username]);
  await pool.query('DELETE FROM sessions WHERE username = ?', [user.username]);

  return { ok: true, message: 'Password updated. Please log in with your new password.' };
}

module.exports = { forgotPassword, resetPassword };
