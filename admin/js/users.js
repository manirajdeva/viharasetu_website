/**
 * users.js — Users view (admin only).
 * Manage portal accounts: username, role, mobile, email, password.
 *   admin    — full access: add / edit / delete + manage users
 *   employee — can view and add records, but not edit or delete
 * Backed by the /exec actions listUsers / createUser / updateUser / deleteUser.
 */

const Users = (() => {
  let rows = [];
  let search = '';
  const root = () => document.getElementById('view-users');

  async function render() {
    if (!Auth.getUser()?.canManageUsers) {
      root().innerHTML = '<div class="error-msg">You do not have access to user management.</div>';
      return;
    }
    if (!root().querySelector('.card')) shell();
    await load();
  }

  function shell() {
    root().innerHTML = `
      <div class="card">
        <div class="toolbar">
          <div class="grp"><input type="search" id="users-search" placeholder="Search username, role, email…" /></div>
          <div class="grp"><button class="btn primary" id="users-add">+ Add user</button></div>
        </div>
        <div class="table-wrap" id="users-tw"><div class="loading">Loading…</div></div>
      </div>`;
    root().querySelector('#users-add').addEventListener('click', () => openForm(null));
    root().querySelector('#users-search').addEventListener('input', Utils.debounce((e) => { search = e.target.value; paint(); }));
  }

  async function load() {
    const tw = root().querySelector('#users-tw');
    tw.innerHTML = '<div class="loading">Loading…</div>';
    try {
      rows = await Api.listUsers();
      paint();
    } catch (err) {
      tw.innerHTML = `<div class="error-msg">${Utils.escapeHtml(err.message || 'Could not load users.')}</div>`;
    }
  }

  function paint() {
    const tw = root().querySelector('#users-tw');
    const me = Auth.getUser()?.username;
    const q = search.trim().toLowerCase();
    const list = rows.filter(u => !q || [u.username, u.role, u.email, u.mobile].join(' ').toLowerCase().includes(q));

    if (!list.length) { tw.innerHTML = '<div class="empty">No users match.</div>'; return; }

    tw.innerHTML = `<table class="data-table">
      <thead><tr><th>Username</th><th>Role</th><th>Access</th><th>Mobile</th><th>Email</th><th>Actions</th></tr></thead>
      <tbody>${list.map(u => `
        <tr>
          <td class="primary-col mono">${Utils.escapeHtml(u.username)}${u.username === me ? ' <span style="color:var(--ink-soft)">(you)</span>' : ''}</td>
          <td><b>${Utils.escapeHtml(u.role)}</b></td>
          <td>${u.role === 'admin' ? 'Add, edit, delete, manage users' : 'View &amp; add only'}</td>
          <td>${Utils.escapeHtml(u.mobile || '-')}</td>
          <td>${Utils.escapeHtml(u.email || '-')}</td>
          <td class="actions">
            <button class="btn sm" data-edit="${Utils.escapeAttr(u.username)}">Edit</button>
            ${u.username === me ? '' : `<button class="btn sm danger" data-del="${Utils.escapeAttr(u.username)}">Delete</button>`}
          </td>
        </tr>`).join('')}</tbody></table>`;

    tw.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openForm(b.dataset.edit)));
    tw.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => del(b.dataset.del)));
  }

  function openForm(username) {
    const u = username ? rows.find(r => r.username === username) : null;
    const fields = [
      { key: 'username', label: 'Username', required: !u, readonly: !!u,
        hint: u ? '' : '3–80 characters: letters, digits, dot, dash or underscore' },
      { key: 'role', label: 'Role', type: 'select', options: ['employee', 'admin'], default: 'employee',
        hint: 'admin = full access · employee = view & add only' },
      { key: 'password', label: u ? 'New password' : 'Password', type: 'password', required: !u,
        placeholder: u ? 'leave blank to keep current' : '', hint: 'At least 6 characters' },
      { key: 'mobile', label: 'Mobile', type: 'phone' },
      { key: 'email', label: 'Email', type: 'email', full: true },
    ];
    const values = u
      ? { username: u.username, role: u.role, password: '', mobile: u.mobile || '', email: u.email || '' }
      : { role: 'employee' };

    Form.open({
      title: u ? 'Edit user' : 'Add user',
      fields,
      values,
      save: async (vals) => {
        const name = String(vals.username || '').trim();
        if (!u && !/^[A-Za-z0-9._-]{3,80}$/.test(name)) throw new Error('Username must be 3–80 chars: letters, digits, dot, dash or underscore.');
        if ((!u || vals.password) && String(vals.password || '').length < 6) throw new Error('Password must be at least 6 characters.');
        if (vals.mobile && !Utils.isValidMobile(vals.mobile)) throw new Error('Enter a valid mobile number.');
        if (vals.email && !Utils.isValidEmail(vals.email)) throw new Error('Enter a valid email address.');

        if (u) {
          await Api.updateUser(u.username, {
            role: vals.role,
            password: vals.password || undefined,
            mobile: vals.mobile,
            email: vals.email,
          });
        } else {
          await Api.createUser({ username: name, password: vals.password, role: vals.role, mobile: vals.mobile, email: vals.email });
        }
        Utils.success(u ? 'User updated.' : 'User created.');
        await load();
      }
    });
  }

  async function del(username) {
    const ok = await Utils.confirmDialog({
      title: 'Delete user?',
      text: `Remove "${username}"? They will be signed out and can no longer log in.`,
      confirmText: 'Delete', danger: true
    });
    if (!ok) return;
    try {
      await Api.deleteUser(username);
      Utils.success('User deleted.');
      await load();
    } catch (err) {
      Utils.error(err.message || 'Could not delete user.');
    }
  }

  return { render };
})();

App.onView('users', () => Users.render());
