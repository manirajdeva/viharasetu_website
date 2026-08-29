/**
 * logger.js
 * Minimal structured logging. Request logs carry method / path / status /
 * latency and — at most — the action name. Request bodies, tokens, passwords
 * and Authorization headers are NEVER logged.
 */

const SENSITIVE = /pass(word)?|token|secret|authorization|currentpassword/i;

function ts() {
  return new Date().toISOString();
}

/** Deep-copy an object with sensitive keys replaced by '[redacted]'. */
function redact(value, depth = 0) {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  const out = Array.isArray(value) ? [] : {};
  for (const key of Object.keys(value)) {
    out[key] = SENSITIVE.test(key) ? '[redacted]' : redact(value[key], depth + 1);
  }
  return out;
}

const info = (...a) => console.log(ts(), '[info]', ...a);
const warn = (...a) => console.warn(ts(), '[warn]', ...a);
const error = (msg, err) =>
  console.error(ts(), '[error]', msg, err ? (err.stack || err.message || String(err)) : '');

/** Express middleware: logs once per response, no body content. */
function middleware(req, res, next) {
  const started = Date.now();
  res.on('finish', () => {
    const action = req.body && typeof req.body === 'object' && req.body.action ? ` action=${req.body.action}` : '';
    console.log(ts(), '[req]', req.method, req.path, res.statusCode, `${Date.now() - started}ms${action}`);
  });
  next();
}

module.exports = { info, warn, error, redact, middleware };
