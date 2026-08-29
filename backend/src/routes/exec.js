/**
 * routes/exec.js
 * Drop-in replacement for the Google Apps Script /exec endpoint. Same URL
 * shape, same actions, same JSON envelope as Code.gs — so admin/js/api.js and
 * the public contact form only need their base URL pointed here.
 *
 *   GET  /exec?sheet=<key>&token=<token>              -> { ok, headers, rows }
 *   POST /exec  { name,email,... }  (no sheet/action) -> create enquiry, { ok, enquiryId }
 *   POST /exec  { action:'login', username, password }
 *   POST /exec  { action:'logout', token }
 *   POST /exec  { token, action:'bootstrap' | 'dashboardStats' | 'reports'
 *                         | 'updateProfile' | 'create' | 'update' | 'delete', ... }
 */

const express = require('express');
const rateLimit = require('express-rate-limit');

const auth = require('../auth');
const sheets = require('../services/sheets');
const dashboard = require('../services/dashboard');
const reports = require('../services/reports');
const bootstrap = require('../services/bootstrap');
const users = require('../services/users');
const passwordReset = require('../services/passwordReset');
const { updateProfile } = require('../services/profile');
const { validate } = require('../validation');
const { ENTITY_KEYS } = require('../mappers');

const isAdmin = (admin) => auth.roleOf(admin) === 'admin';

const router = express.Router();

const fail = (res, code, message) => res.json({ ok: false, error: { code, message } });

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again later.' } },
});

const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many reset attempts. Try again later.' } },
});

function sheetKey(body) {
  const key = String(body.sheet || 'enquiries').toLowerCase();
  return ENTITY_KEYS.includes(key) ? key : null;
}

/* ---------------------------- GET: list reads ---------------------------- */

router.get('/', async (req, res, next) => {
  try {
    const { sheet, token } = req.query;
    if (!sheet) return res.json({ ok: true, message: 'Viharasetu admin API is running.' });
    if (!(await auth.sessionUsername(token))) {
      return fail(res, 'SESSION_EXPIRED', 'Your session has expired. Please log in again.');
    }
    const key = String(sheet).toLowerCase();
    if (!ENTITY_KEYS.includes(key)) return fail(res, 'BAD_SHEET', 'Unknown sheet.');
    const data = await sheets.listRows(key);
    return res.json({ ok: true, headers: data.headers, rows: data.rows });
  } catch (err) {
    return next(err);
  }
});

/* --------------------------- POST: everything --------------------------- */

router.post(
  '/',
  (req, res, next) => {
    const a = req.body && req.body.action;
    if (a === 'login') return loginLimiter(req, res, next);
    if (a === 'forgotPassword' || a === 'resetPassword') return resetLimiter(req, res, next);
    return next();
  },
  async (req, res, next) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};

    try {
      // Legacy public contact form: no sheet, no action -> append an enquiry.
      if (!body.sheet && !body.action) {
        const values = {
          'Name': body.name || '',
          'Email': body.email || '',
          'Phone': body.phone || '',
          'Destination': body.destination || '',
          'Travel': body.travel || '',
          'Status': 'New',
          'Notes': body.notes || body.message || '',
        };
        const vErr = validate('enquiries', values);
        if (vErr) return fail(res, 'VALIDATION', vErr);
        const result = await sheets.createRow('enquiries', values);
        return res.json({ ok: true, enquiryId: result.enquiryId });
      }

      if (body.action === 'login') {
        const admin = await auth.verifyAdmin(body.username, body.password);
        if (!admin) return fail(res, 'BAD_LOGIN', 'Invalid username or password.');
        const sess = await auth.createSession(admin.username);
        return res.json({ ok: true, token: sess.token, expiresAt: sess.expiresAt, user: auth.publicAdmin(admin) });
      }

      if (body.action === 'logout') {
        await auth.deleteSession(body.token);
        return res.json({ ok: true });
      }

      // Self-service password reset by email OTP (no session).
      if (body.action === 'forgotPassword') {
        return res.json(await passwordReset.forgotPassword(body.email));
      }
      if (body.action === 'resetPassword') {
        try {
          return res.json(await passwordReset.resetPassword(body.email, body.otp, body.newPassword));
        } catch (err) {
          return fail(res, err.code || 'ERROR', err.message || 'Could not reset the password.');
        }
      }

      // Everything below needs a valid session.
      let admin;
      try {
        admin = await auth.requireAdmin(body);
      } catch (authErr) {
        return fail(res, 'SESSION_EXPIRED', 'Your session has expired. Please log in again.');
      }

      switch (body.action) {
        case 'bootstrap':
          return res.json({ ok: true, data: await bootstrap.build() });

        case 'dashboardStats':
          return res.json({ ok: true, data: await dashboard.load() });

        case 'reports':
          return res.json({ ok: true, data: await reports.run(body.data || {}) });

        case 'updateProfile':
          return res.json(await updateProfile(admin, body.values || {}));

        case 'listUsers':
          if (!isAdmin(admin)) return fail(res, 'FORBIDDEN', 'Only admins can manage users.');
          return res.json({ ok: true, users: await users.listUsers() });

        case 'createUser':
          if (!isAdmin(admin)) return fail(res, 'FORBIDDEN', 'Only admins can manage users.');
          return res.json(await users.createUser(body.values || {}));

        case 'updateUser':
          if (!isAdmin(admin)) return fail(res, 'FORBIDDEN', 'Only admins can manage users.');
          return res.json(await users.updateUser(body.username, body.values || {}, admin.username));

        case 'deleteUser':
          if (!isAdmin(admin)) return fail(res, 'FORBIDDEN', 'Only admins can manage users.');
          return res.json(await users.deleteUser(body.username, admin.username));

        case 'create': {
          const key = sheetKey(body);
          if (!key) return fail(res, 'BAD_SHEET', 'Unknown sheet.');
          const vErr = validate(key, body.values || {});
          if (vErr) return fail(res, 'VALIDATION', vErr);
          return res.json(await sheets.createRow(key, body.values || {}));
        }

        case 'update': {
          if (!isAdmin(admin)) return fail(res, 'FORBIDDEN', 'Employee accounts cannot edit entries.');
          const key = sheetKey(body);
          if (!key) return fail(res, 'BAD_SHEET', 'Unknown sheet.');
          const vErr = validate(key, body.values || {});
          if (vErr) return fail(res, 'VALIDATION', vErr);
          return res.json(await sheets.updateRow(key, Number(body.rowIndex), body.values || {}));
        }

        case 'delete': {
          const key = sheetKey(body);
          if (!key) return fail(res, 'BAD_SHEET', 'Unknown sheet.');
          return res.json(await sheets.deleteRow(key, admin, Number(body.rowIndex)));
        }

        default:
          return fail(res, 'UNKNOWN_ACTION', `Unknown action: ${body.action}`);
      }
    } catch (err) {
      // Known, user-facing errors carry a .code; surface their message
      // (matches how Code.gs returned { ok:false, error:{ code, message } }).
      if (err && err.code) return fail(res, err.code, err.message || 'Something went wrong.');
      return next(err);
    }
  },
);

module.exports = router;
