/**
 * routes/public.js
 * Unauthenticated, read-only-ish endpoints for the public website.
 *
 *   GET  /api/public/health            -> { ok, time }
 *   POST /api/public/enquiries         { name, email, phone, destination, travel, notes? }
 *                                      -> { ok, enquiryId }   (rate limited)
 *
 * The homepage contact form currently posts to /exec (legacy path); this
 * RESTful alias is provided for any future public client. Nothing here can
 * read admin data.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');

const sheets = require('../services/sheets');
const { validate } = require('../validation');

const router = express.Router();

const enquiryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many submissions. Please try again later.' } },
});

router.get('/public/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

router.post('/public/enquiries', enquiryLimiter, async (req, res, next) => {
  try {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const values = {
      'Name': b.name || '',
      'Email': b.email || '',
      'Phone': b.phone || '',
      'Destination': b.destination || '',
      'Travel': b.travel || '',
      'Status': 'New',
      'Notes': b.notes || b.message || '',
    };
    const vErr = validate('enquiries', values);
    if (vErr) return res.status(422).json({ ok: false, error: { code: 'VALIDATION', message: vErr } });
    const result = await sheets.createRow('enquiries', values);
    return res.status(201).json({ ok: true, enquiryId: result.enquiryId });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
