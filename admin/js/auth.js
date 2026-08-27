/**
 * auth.js
 * Session handling for the admin portal.
 *
 * The session ({ token, username, canDelete, mobile, email, expiresAt }) is
 * kept in sessionStorage — it survives navigation between login.html and
 * portal.html and a page refresh, but is cleared the moment the browser tab
 * is closed. The token is minted server-side by Code.gs on login and must
 * accompany every subsequent request; Code.gs expires it after 6 hours.
 */

const Auth = (() => {
  const KEY = 'vih_admin_session';

  function saveSession(data) {
    sessionStorage.setItem(KEY, JSON.stringify({
      token: data.token,
      username: data.username,
      canDelete: !!data.canDelete,
      mobile: data.mobile || '',
      email: data.email || '',
      expiresAt: data.expiresAt
    }));
  }

  function getSession() {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s.expiresAt || s.expiresAt < Date.now()) { clearSession(); return null; }
      return s;
    } catch { return null; }
  }

  function patchSession(patch) {
    const s = getSession();
    if (!s) return;
    sessionStorage.setItem(KEY, JSON.stringify(Object.assign(s, patch)));
  }

  const getToken = () => getSession()?.token || null;
  const getUser = () => getSession() || null;
  const isLoggedIn = () => !!getSession();
  const clearSession = () => sessionStorage.removeItem(KEY);

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
