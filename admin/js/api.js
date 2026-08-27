/**
 * api.js
 * Single point of contact with the Viharasetu Google Apps Script web app
 * (google-apps-script/Code.gs), which also backs the public contact form.
 *
 * Reads are GET /exec?sheet=<key>&token=<token>. Writes are POST /exec with
 * a text/plain body containing JSON — text/plain keeps the request a CORS
 * "simple request" so the browser never fires an OPTIONS preflight, which
 * Apps Script web apps cannot answer. The auth token is attached to every
 * call; Code.gs rejects an expired or unknown token with SESSION_EXPIRED,
 * which bounces the user back to the login page.
 *
 * On localhost / 127.0.0.1 this points at the zero-dependency mock backend in
 * mock-server/server.js instead (same envelope, in-memory data) so the portal
 * loads instantly without a round trip to Google. Visit any admin page once
 * with ?api=live to force the real backend from localhost (remembered on this
 * device until ?api=mock); a console line states which backend is active.
 */

const PRODUCTION_SCRIPT_URL = "https://script.google.com/macros/s/AKfycby16uHDPLkWFMHOQtKH3ggej7MnRNW4Lfrn5RPrLkNpN-6Vj8aFitTBHjgvIqi1qaDQzA/exec";
const LOCAL_MOCK_URL = "http://localhost:3001/exec";

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

    getSheet,

    create: (sheet, values) => post({ action: 'create', sheet, values }),
    update: (sheet, rowIndex, values) => post({ action: 'update', sheet, rowIndex, values }),
    remove: (sheet, rowIndex) => post({ action: 'delete', sheet, rowIndex }),

    updateProfile: (values) => post({ action: 'updateProfile', values }),
    // One call → every sheet's rows + dashboard stats. Used on portal load so
    // navigating between views costs nothing after the first fetch.
    bootstrap: () => post({ action: 'bootstrap' }).then(j => j.data || j),
    dashboardStats: () => post({ action: 'dashboardStats' }).then(j => j.data || j.stats || j),
    reports: (filters) => post({ action: 'reports', data: filters }).then(j => j.data || j)
  };
})();
