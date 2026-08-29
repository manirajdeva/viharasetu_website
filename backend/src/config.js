/**
 * config.js
 * Loads and validates configuration from environment variables only.
 * Nothing here is ever hard-coded — a missing DB var is a hard startup error.
 */

require('dotenv').config();

function required(name) {
  const v = process.env[name];
  if (v === undefined || v === '') {
    throw new Error(`Missing required environment variable: ${name}. Copy backend/.env.example to backend/.env and fill it in.`);
  }
  return v;
}

const int = (name, dflt) => {
  const v = process.env[name];
  if (v === undefined || v === '') return dflt;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? dflt : n;
};

const bool = (name, dflt) => {
  const v = process.env[name];
  if (v === undefined || v === '') return dflt;
  return /^(1|true|yes)$/i.test(v.trim());
};

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: int('PORT', 3001),

  db: {
    host: required('DB_HOST'),
    port: int('DB_PORT', 3306),
    database: required('DB_NAME'),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    connectionLimit: int('DB_POOL', 10),
    ssl: bool('DB_SSL', false)
      ? { rejectUnauthorized: bool('DB_SSL_REJECT_UNAUTHORIZED', true) }
      : undefined,
  },

  sessionTtlMs: int('SESSION_TTL_HOURS', 6) * 60 * 60 * 1000,
  bcryptRounds: int('BCRYPT_ROUNDS', 12),
  corsOrigins: (process.env.CORS_ORIGINS || 'https://viharasetu.co.in,https://www.viharasetu.co.in')
    .split(',').map((s) => s.trim()).filter(Boolean),

  otpTtlMs: int('OTP_TTL_MINUTES', 10) * 60 * 1000,
  mail: {
    transport: (process.env.MAIL_TRANSPORT || 'console').toLowerCase(),
    from: process.env.MAIL_FROM || 'Viharasetu Admin <noreply@viharasetu.co.in>',
    appName: process.env.APP_NAME || 'Viharasetu Admin',
    smtp: {
      host: process.env.SMTP_HOST || '',
      port: int('SMTP_PORT', 587),
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
    resendApiKey: process.env.RESEND_API_KEY || '',
  },
};
