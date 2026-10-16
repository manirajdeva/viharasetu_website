/**
 * Viharasetu Admin — desktop shell.
 * A thin window around the live admin portal, so staff get a normal Windows app
 * (own icon, taskbar entry, Start-menu shortcut) while the portal itself keeps
 * updating through the website. No credentials or data are stored by this shell.
 */
const { app, BrowserWindow, shell, Menu, ipcMain, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const ADMIN_URL = 'https://viharasetu.co.in/admin/';
const ALLOWED_HOST = 'viharasetu.co.in';

let win = null;

/* ---------------- Remembered login (encrypted with Windows DPAPI) ---------------- */
const credsFile = () => path.join(app.getPath('userData'), 'login.bin');
let pending = null;   // typed credentials, kept in memory until the portal opens

function saveCreds(c) {
  if (!safeStorage.isEncryptionAvailable()) return;
  fs.writeFileSync(credsFile(), safeStorage.encryptString(JSON.stringify(c)));
}
function readCreds() {
  try {
    if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(credsFile())) return null;
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(credsFile())));
  } catch { return null; }
}
function clearCreds() { pending = null; try { fs.unlinkSync(credsFile()); } catch { /* none saved */ } }

const fromAdminPage = (e) => { try { return new URL(e.senderFrame.url).hostname.endsWith('viharasetu.co.in'); } catch { return false; } };
ipcMain.handle('creds:get', (e) => (fromAdminPage(e) ? readCreds() : null));
ipcMain.handle('creds:clear', (e) => { if (fromAdminPage(e)) clearCreds(); });
ipcMain.on('creds:pending', (e, c) => {
  if (fromAdminPage(e) && c && typeof c.username === 'string' && typeof c.password === 'string') pending = { username: c.username, password: c.password };
});

function isAppUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === ALLOWED_HOST || u.hostname === 'www.' + ALLOWED_HOST);
  } catch { return false; }
}

function load() {
  win.loadURL(ADMIN_URL).catch(() => { /* did-fail-load shows the offline page */ });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#fbf7ef',
    title: 'Viharasetu Admin',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win.show());
  win.maximize();

  // Links to other sites open in the normal browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file:') || isAppUrl(url)) return;
    e.preventDefault();
    shell.openExternal(url);
  });

  // No internet / site unreachable: friendly page with a retry button.
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* aborted */ || url.startsWith('file:')) return;
    win.loadFile(path.join(__dirname, 'offline.html'));
  });

  // The offline page asks to retry by setting its title (no preload / IPC needed).
  win.webContents.on('page-title-updated', (ev, title) => { if (title === '__retry__') { ev.preventDefault(); load(); } });

  // The portal page opening means the login worked: keep the credentials just typed.
  win.webContents.on('did-navigate', (_e, url) => {
    if (pending && /\/admin\/portal\.html/.test(url)) { saveCreds(pending); pending = null; }
  });

  win.on('closed', () => { win = null; });
  load();
}

// One window only: opening the app again focuses the existing one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => { if (!win) createWindow(); });
  });
  app.on('window-all-closed', () => app.quit());
}
