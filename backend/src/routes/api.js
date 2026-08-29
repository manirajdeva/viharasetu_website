/**
 * routes/api.js
 * RESTful surface requested in the migration spec — GET / POST / PUT / PATCH /
 * DELETE — over the same service layer as /exec. The admin portal does not use
 * these routes today (it talks to /exec); they are here for future clients,
 * integrations and scripts.
 *
 *   POST   /api/auth/login          { username, password }        -> { ok, token, expiresAt, user }
 *   POST   /api/auth/logout         (Bearer token)
 *   GET    /api/dashboard           (Bearer token)                -> { ok, data }
 *   GET    /api/reports?dateFrom=&dateTo=&destination=&status=&paymentStatus=
 *   GET    /api/profile             -> { ok, user }
 *   PATCH  /api/profile             { mobile?, email?, currentPassword?, password? }
 *   GET    /api/:entity             ?search=&limit=&offset=       -> { ok, headers, rows, total }
 *   GET    /api/:entity/:id         -> { ok, row }
 *   POST   /api/:entity             { values }                    -> 201 { ok, ... }
 *   PUT    /api/:entity/:id         { values }
 *   PATCH  /api/:entity/:id         { values }
 *   DELETE /api/:entity/:id
 *
 * entity ∈ enquiries | suppliers | bookings | payments
 */

const express = require('express');
const rateLimit = require('express-rate-limit');

const auth = require('../auth');
const sheets = require('../services/sheets');
const dashboard = require('../services/dashboard');
const reports = require('../services/reports');
const { updateProfile } = require('../services/profile');
const { validate } = require('../validation');
const { ENTITY_KEYS, headersFor } = require('../mappers');

const router = express.Router();

const ok = (res, extra, status = 200) => res.status(status).json(Object.assign({ ok: true }, extra));
const fail = (res, status, code, message) => res.status(status).json({ ok: false, error: { code, message } });

function bearer(req) {
  const h = req.get('authorization') || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return req.query.token || (req.body && req.body.token) || null;
}

async function requireSession(req, res, next) {
  try {
    const username = await auth.sessionUsername(bearer(req));
    if (!username) return fail(res, 401, 'SESSION_EXPIRED', 'Your session has expired. Please log in again.');
    req.admin = await auth.findAdmin(username);
    if (!req.admin) return fail(res, 401, 'SESSION_EXPIRED', 'Your session has expired. Please log in again.');
    return next();
  } catch (err) {
    return next(err);
  }
}

function requireEntity(req, res, next) {
  req.entity = String(req.params.entity || '').toLowerCase();
  if (!ENTITY_KEYS.includes(req.entity)) return fail(res, 404, 'BAD_ENTITY', 'Unknown entity.');
  return next();
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ------------------------------- auth ------------------------------- */

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again later.' } },
});

router.post('/auth/login', loginLimiter, wrap(async (req, res) => {
  const admin = await auth.verifyAdmin(req.body.username, req.body.password);
  if (!admin) return fail(res, 401, 'BAD_LOGIN', 'Invalid username or password.');
  const sess = await auth.createSession(admin.username);
  return ok(res, { token: sess.token, expiresAt: sess.expiresAt, user: auth.publicAdmin(admin) });
}));

router.post('/auth/logout', wrap(async (req, res) => {
  await auth.deleteSession(bearer(req));
  return ok(res, {});
}));

/* --------------------------- dashboard / reports --------------------------- */

router.get('/dashboard', requireSession, wrap(async (req, res) => ok(res, { data: await dashboard.load() })));

router.get('/reports', requireSession, wrap(async (req, res) => {
  const f = req.query;
  const data = await reports.run({
    dateFrom: f.dateFrom || '',
    dateTo: f.dateTo || '',
    destination: f.destination || '',
    status: f.status || '',
    paymentStatus: f.paymentStatus || '',
  });
  return ok(res, { data });
}));

/* ------------------------------- profile ------------------------------- */

router.get('/profile', requireSession, wrap(async (req, res) => ok(res, { user: auth.publicAdmin(req.admin) })));

router.patch('/profile', requireSession, wrap(async (req, res) => {
  const result = await updateProfile(req.admin, req.body.values || req.body || {});
  return res.status(result.ok ? 200 : 400).json(result);
}));

/* --------------------------- entity CRUD --------------------------- */

router.get('/:entity', requireSession, requireEntity, wrap(async (req, res) => {
  const { rows } = await sheets.listRows(req.entity);
  let out = rows;

  const search = String(req.query.search || '').trim().toLowerCase();
  if (search) {
    out = out.filter((r) => Object.values(r).join(' ').toLowerCase().includes(search));
  }
  const total = out.length;

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 0, 0), 1000);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  if (limit) out = out.slice(offset, offset + limit);

  return ok(res, { headers: headersFor(req.entity), rows: out, total });
}));

router.get('/:entity/:id', requireSession, requireEntity, wrap(async (req, res) => {
  const row = await sheets.getRow(req.entity, req.params.id);
  if (!row) return fail(res, 404, 'NOT_FOUND', 'Row not found.');
  return ok(res, { row });
}));

router.post('/:entity', requireSession, requireEntity, wrap(async (req, res) => {
  const values = req.body.values || req.body || {};
  const vErr = validate(req.entity, values);
  if (vErr) return fail(res, 422, 'VALIDATION', vErr);
  try {
    const result = await sheets.createRow(req.entity, values);
    return ok(res, result, 201);
  } catch (err) {
    if (err && err.code) return fail(res, 400, err.code, err.message);
    throw err;
  }
}));

const doUpdate = wrap(async (req, res) => {
  const values = req.body.values || req.body || {};
  const vErr = validate(req.entity, values);
  if (vErr) return fail(res, 422, 'VALIDATION', vErr);
  try {
    const result = await sheets.updateRow(req.entity, Number(req.params.id), values);
    return ok(res, result);
  } catch (err) {
    if (err && err.code === 'NOT_FOUND') return fail(res, 404, err.code, err.message);
    if (err && err.code) return fail(res, 400, err.code, err.message);
    throw err;
  }
});
router.put('/:entity/:id', requireSession, requireEntity, doUpdate);
router.patch('/:entity/:id', requireSession, requireEntity, doUpdate);

router.delete('/:entity/:id', requireSession, requireEntity, wrap(async (req, res) => {
  try {
    const result = await sheets.deleteRow(req.entity, req.admin, Number(req.params.id));
    return ok(res, result);
  } catch (err) {
    if (err && err.code === 'FORBIDDEN') return fail(res, 403, err.code, err.message);
    if (err && err.code) return fail(res, 400, err.code, err.message);
    throw err;
  }
}));

module.exports = router;
