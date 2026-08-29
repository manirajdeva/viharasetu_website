/**
 * server.js
 * Express app wiring: security headers, CORS allowlist, body parsing (accepts
 * the text/plain JSON that admin/js/api.js and the contact form send, plus real
 * application/json), rate limiting, routes, and a JSON error handler.
 *
 *   npm start           # production
 *   npm run dev         # watch mode
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const log = require('./logger');
const auth = require('./auth');

const app = express();

// Managed platforms (Railway/Render/Fly) sit behind a proxy; needed for correct
// client IPs in rate limiting. '1' = trust exactly one proxy hop.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: false,                    // JSON API, no HTML to protect
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

/* ------------------------------- CORS ------------------------------- */

const corsOptions = {
  origin(origin, cb) {
    // Allow non-browser callers (curl, health checks: no Origin header) and
    // any explicitly allowlisted site origin.
    if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('CORS: origin not allowed'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

/* --------------------------- body parsing --------------------------- */

// api.js / the contact form send a JSON string with Content-Type text/plain
// (to avoid a CORS preflight from a static host). Accept that and real JSON.
app.use(express.text({ type: ['text/*', 'application/json', 'application/*+json'], limit: '100kb' }));
app.use((req, res, next) => {
  if (typeof req.body === 'string') {
    const raw = req.body.trim();
    if (!raw) { req.body = {}; return next(); }
    try {
      req.body = JSON.parse(raw);
    } catch (e) {
      return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Malformed request body.' } });
    }
  } else if (req.body == null || typeof req.body !== 'object') {
    req.body = {};
  }
  return next();
});

app.use(log.middleware);

/* ------------------------------ routes ------------------------------ */

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down and try again.' } },
});
app.use('/exec', globalLimiter);
app.use('/api', globalLimiter);

app.get('/', (req, res) => res.json({ ok: true, service: 'viharasetu-api' }));
app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/exec', require('./routes/exec'));
app.use('/api', require('./routes/public')); // /api/public/*
app.use('/api', require('./routes/api'));

/* --------------------------- error handling --------------------------- */

app.use((req, res) => res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found.' } }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const isCors = err && /^CORS:/.test(err.message || '');
  if (isCors) {
    return res.status(403).json({ ok: false, error: { code: 'CORS', message: 'Origin not allowed.' } });
  }
  log.error('Unhandled request error', err);
  return res.status(500).json({ ok: false, error: { code: 'SERVER_ERROR', message: 'Internal server error.' } });
});

/* ------------------------------- start ------------------------------- */

async function start() {
  // Fail fast if the DB is unreachable or the schema is missing.
  const pool = require('./db');
  try {
    await pool.query('SELECT 1');
    await pool.query('SELECT 1 FROM admins LIMIT 1');
  } catch (err) {
    log.error('Database check failed on startup — is the schema applied and .env correct?', err);
    process.exit(1);
  }

  await auth.purgeExpiredSessions().catch(() => {});
  setInterval(() => auth.purgeExpiredSessions().catch(() => {}), 30 * 60 * 1000).unref();

  app.listen(config.port, () => {
    log.info(`Viharasetu API listening on :${config.port} (${config.nodeEnv})`);
    log.info(`CORS allowlist: ${config.corsOrigins.join(', ') || '(none)'}`);
  });
}

// Only boot when run directly (`node src/server.js`); `require()` for tests
// gets the configured app without opening a port or touching the DB.
if (require.main === module) start();

module.exports = app;
