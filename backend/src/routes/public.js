/**
 * routes/public.js
 * Unauthenticated, read-only-ish endpoints for the public website.
 *
 *   GET  /api/public/health            -> { ok, time }
 *   POST /api/public/enquiries         { name, email, phone, destination, travel,
 *                                        no_of_people?, hotel_preference?, special_req?, notes? }
 *                                      -> { ok, enquiryId }   (rate limited)
 *
 * The homepage contact form currently posts to /exec (legacy path); this
 * RESTful alias is provided for any future public client. Nothing here can
 * read admin data.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');

const siteEnquiries = require('../services/siteEnquiries');
const antiSpam = require('../antiSpam');

const router = express.Router();

const enquiryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many submissions. Please try again later.' } },
});

router.get('/public/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

router.get('/public/form-token', (req, res) => res.json({ ok: true, token: antiSpam.issueToken() }));

router.post('/public/enquiries', enquiryLimiter, async (req, res, next) => {
  try {
    const verdict = await antiSpam.inspect(req, req.body);
    if (verdict.action === 'drop') return res.status(201).json({ ok: true });
    if (verdict.action === 'reject') {
      return res.status(verdict.status).json({ ok: false, error: { code: verdict.code, message: verdict.message } });
    }
    const result = await siteEnquiries.submit(req.body);
    antiSpam.markSubmitted(req.body);
    return res.status(201).json({ ok: true, enquiryId: result.enquiryId });
  } catch (err) {
    if (err && err.code === 'VALIDATION') {
      return res.status(422).json({ ok: false, error: { code: 'VALIDATION', message: err.message } });
    }
    return next(err);
  }
});

module.exports = router;
