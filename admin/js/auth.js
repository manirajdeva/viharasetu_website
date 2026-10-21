/**
 * auth.js
 * Session handling for the admin portal.
 *
 * The session ({ token, username, canDelete, mobile, email, expiresAt }) is
 * kept in sessionStorage — it survives navigation between login.html and
 * portal.html and a page refresh, but is cleared the moment the browser tab
 * is closed. If "Keep me signed in" is ticked at login it is kept in
 * localStorage instead, so it also survives closing the browser - but only
 * until the server-side token expires (6 hours); logging out clears it.
 * The token is minted server-side on login and must accompany every
 * subsequent request.
 */

const Auth = (() => {
  const KEY = 'vih_admin_session';

  const where = () => {
    try { if (sessionStorage.getItem(KEY)) return sessionStorage; } catch { /* storage blocked */ }
    try { if (localStorage.getItem(KEY)) return localStorage; } catch { /* storage blocked */ }
    return null;
  };

  function saveSession(data, keep) {
    const role = data.role || (data.canDelete ? 'admin' : 'employee');
    clearSession();
    let target = sessionStorage;
    if (keep) { try { target = localStorage; localStorage.getItem(KEY); } catch { target = sessionStorage; } }
    target.setItem(KEY, JSON.stringify({
      token: data.token,
      username: data.username,
      role,
      canManageUsers: data.canManageUsers !== undefined ? !!data.canManageUsers : role === 'admin',
      canEdit: true,      // admin and employee both edit / delete records
      canDelete: true,
      mobile: data.mobile || '',
      email: data.email || '',
      expiresAt: data.expiresAt
    }));
  }

  function getSession() {
    try {
      const store = where();
      const raw = store && store.getItem(KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s.expiresAt || s.expiresAt < Date.now()) { clearSession(); return null; }
      // Backfill fields for sessions saved before roles existed, so nobody is
      // locked out of Edit until their token expires.
      if (!s.role) s.role = s.canDelete ? 'admin' : 'employee';
      s.canEdit = true;     // sessions saved before employees got full data access
      s.canDelete = true;
      if (s.canManageUsers === undefined) s.canManageUsers = s.role === 'admin' || !!s.canDelete;
      return s;
    } catch { return null; }
  }

  function patchSession(patch) {
    const s = getSession();
    if (!s) return;
    (where() || sessionStorage).setItem(KEY, JSON.stringify(Object.assign(s, patch)));
  }

  const getToken = () => getSession()?.token || null;
  const getUser = () => getSession() || null;
  const isLoggedIn = () => !!getSession();
  function clearSession() {
    try { sessionStorage.removeItem(KEY); } catch { /* storage blocked */ }
    try { localStorage.removeItem(KEY); } catch { /* storage blocked */ }
  }

  /** Call at the top of portal.html. Redirects to the login page if there is no valid session. */
  function guardPage() {
    if (!isLoggedIn()) { location.replace('index.html'); return false; }
    return true;
  }

  /** Redirect an idle tab back to login once the token's 6-hour window lapses. */
  function watchExpiry() {
    setInterval(() => {
      if (!isLoggedIn()) location.replace('index.html?expired=1');
    }, 30000);
  }

  async function logout() {
    try { await Api.logout(); } catch { /* best-effort */ }
    clearSession();
    location.replace('index.html');
  }

  return { saveSession, getSession, patchSession, getToken, getUser, isLoggedIn, clearSession, guardPage, watchExpiry, logout };
})();
