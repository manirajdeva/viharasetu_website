/**
 * Runs inside the admin pages (https://viharasetu.co.in only).
 * - On the login page: pre-fills the saved username and password and offers
 *   "Forget saved login".
 * - On submit: hands the typed credentials to the main process, which keeps
 *   them (encrypted with Windows DPAPI) only once the portal actually opens,
 *   i.e. once the login succeeded.
 * The page itself never gets access to the stored password except by the form
 * fields being filled in, exactly as a browser's password manager would do.
 */
const { ipcRenderer } = require('electron');

if (location.hostname.endsWith('viharasetu.co.in') && /\/admin\/(index\.html)?$/.test(location.pathname)) {
  window.addEventListener('DOMContentLoaded', async () => {
    const user = document.getElementById('vsUser');
    const pass = document.getElementById('vsPass');
    const form = document.getElementById('adminLoginForm');
    if (!user || !pass || !form) return;

    const fill = (el, value) => {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };

    const saved = await ipcRenderer.invoke('creds:get');
    if (saved) {
      fill(user, saved.username);
      fill(pass, saved.password);
      pass.focus();

      const forget = document.createElement('a');
      forget.href = '#';
      forget.textContent = 'Forget saved login';
      forget.className = 'vs-link';
      forget.style.cssText = 'display:block;text-align:center;margin-top:14px;font-size:13px;';
      forget.addEventListener('click', async (e) => {
        e.preventDefault();
        await ipcRenderer.invoke('creds:clear');
        fill(user, ''); fill(pass, '');
        forget.remove();
        user.focus();
      });
      const secure = form.querySelector('.vs-secure');
      (secure || form).appendChild(forget);
    }

    form.addEventListener('submit', () => {
      if (user.value.trim() && pass.value) ipcRenderer.send('creds:pending', { username: user.value.trim(), password: pass.value });
    }, true);
  });
}
