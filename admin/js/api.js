/**
 * api.js
 * Single point of contact with the Viharasetu backend API (backend/ —
 * Node/Express + MySQL), which also backs the public contact form. This
 * replaced the old Google Apps Script + Google Sheets backend; the request
 * and response shapes are unchanged, so only the URL below moved.
 *
 * Reads are GET  <API>/exec?sheet=<key>&token=<token>.
 * Writes are POST <API>/exec with a text/plain body containing JSON —
 * text/plain keeps the request a CORS "simple request" so the browser never
 * fires an OPTIONS preflight, which keeps this working from any static host.
 * The auth token is attached to every call; the API rejects an expired or
 * unknown token with SESSION_EXPIRED, which bounces the user back to login.
 *
 * On localhost / 127.0.0.1 this points at the zero-dependency mock backend in
 * mock-server/server.js instead (same envelope, in-memory data) so the portal
 * loads instantly. Visit any admin page once with ?api=live to force the real
 * backend from localhost (remembered on this device until ?api=mock); a
 * console line states which backend is active.
 */

// The deployed backend's base URL + "/exec". Set this once the API is live,
// e.g. "https://viharasetu-api.up.railway.app/exec".
const PRODUCTION_SCRIPT_URL = "https://viharasetu-api.onrender.com/exec";
const LOCAL_MOCK_URL = "http://localhost:3001/exec";

if (PRODUCTION_SCRIPT_URL.includes('REPLACE-WITH-YOUR-API-HOST')) {
  console.error('[Viharasetu admin] PRODUCTION_SCRIPT_URL in admin/js/api.js is still the placeholder — set it to your deployed API host before going live.');
}

const _forceApiKey = 'vih_force_api';
const _requestedApi = new URLSearchParams(location.search).get('api');
if (_requestedApi === 'live' || _requestedApi === 'mock') {
  try { localStorage.setItem(_forceApiKey, _requestedApi); } catch {}
}
let _forcedApi = null;
try { _forcedApi = localStorage.getItem(_forceApiKey); } catch {}
const _isLocalhost = ['localhost', '127.0.0.1'].includes(location.hostname);
const useMockApi = _isLocalhost && _forcedApi !== 'live';
const SCRIPT_URL = useMockApi ? LOCAL_MOCK_URL : PRODUCTION_SCRIPT_URL;

if (_isLocalhost) {
  console.info(useMockApi
    ? '[Viharasetu admin] Using the LOCAL MOCK backend (mock-server/server.js) — data is in-memory only. Add ?api=live for the real Google backend.'
    : '[Viharasetu admin] Using the REAL Google backend (forced via ?api=live). Add ?api=mock to switch back.');
}

class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const Api = (() => {

  function handleAuthFailure() {
    Auth.clearSession();
    if (!location.pathname.endsWith('index.html')) {
      setTimeout(() => location.replace('index.html?expired=1'), 900);
    }
  }

  async function parseOrThrow(res) {
    let json;
    try { json = await res.json(); }
    catch { throw new ApiError('BAD_RESPONSE', 'Unexpected response from the server.'); }
    if (json.ok === false || json.success === false) {
      const err = json.error || {};
      const code = err.code || (typeof json.error === 'string' ? 'ERROR' : 'ERROR');
      const message = err.message || (typeof json.error === 'string' ? json.error : 'Something went wrong.');
      if (code === 'SESSION_EXPIRED') handleAuthFailure();
      throw new ApiError(code, message);
    }
    return json;
  }

  /** POST an action with the JSON envelope Code.gs expects. */
  async function post(payload) {
    const body = Object.assign({ token: Auth.getToken() }, payload);
    let res;
    try {
      res = await fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body)
      });
    } catch {
      throw new ApiError('NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.');
    }
    return parseOrThrow(res);
  }

  /** GET all rows for a sheet: { ok, headers, rows:[{ rowIndex, ...cols }] }. */
  async function getSheet(key) {
    const url = `${SCRIPT_URL}?sheet=${encodeURIComponent(key)}&token=${encodeURIComponent(Auth.getToken() || '')}`;
    let res;
    try { res = await fetch(url, { method: 'GET' }); }
    catch { throw new ApiError('NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.'); }
    const json = await parseOrThrow(res);
    return { headers: json.headers, rows: json.rows };
  }

  return {
    login: (username, password) => post({ action: 'login', username, password }).then(j => j.user
      ? Object.assign({ token: j.token, expiresAt: j.expiresAt }, j.user)
      : j),
    logout: () => post({ action: 'logout' }),

    // Self-service password reset by email OTP (no session needed).
    forgotPassword: (email) => post({ action: 'forgotPassword', email }),
    resetPassword: (email, otp, newPassword) => post({ action: 'resetPassword', email, otp, newPassword }),

    getSheet,

    create: (sheet, values) => post({ action: 'create', sheet, values }),
    update: (sheet, rowIndex, values) => post({ action: 'update', sheet, rowIndex, values }),
    remove: (sheet, rowIndex) => post({ action: 'delete', sheet, rowIndex }),

    updateProfile: (values) => post({ action: 'updateProfile', values }),

    // User management (admin only).
    listUsers: () => post({ action: 'listUsers' }).then(j => j.users || j.data || []),
    createUser: (values) => post({ action: 'createUser', values }),
    updateUser: (username, values) => post({ action: 'updateUser', username, values }),
    deleteUser: (username) => post({ action: 'deleteUser', username }),
    // One call → every sheet's rows + dashboard stats. Used on portal load so
    // navigating between views costs nothing after the first fetch.
    bootstrap: () => post({ action: 'bootstrap' }).then(j => j.data || j),
    dashboardStats: () => post({ action: 'dashboardStats' }).then(j => j.data || j.stats || j),
    reports: (filters) => post({ action: 'reports', data: filters }).then(j => j.data || j)
  };
})();
