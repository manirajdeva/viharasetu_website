/**
 * mock-server/static-server.js
 * Zero-dependency static file server for local testing — serves the repo
 * root so the site (and the admin portal at /admin/) opens over http://
 * instead of file://.
 *
 *   node mock-server/static-server.js      # http://localhost:5500
 *
 * Pair it with `node mock-server/server.js` (the mock API on :3001) for a
 * fully offline portal. Local development only.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5500;
const ROOT = path.join(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf', '.woff2': 'font/woff2'
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath.endsWith('/')) urlPath += 'index.html';

  let filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) filePath = path.join(filePath, 'index.html');
    fs.readFile(filePath, (err2, content) => {
      if (err2) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not found: ' + urlPath);
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(content);
    });
  });
});

server.listen(PORT, () => {
  console.log(`Viharasetu site  →  http://localhost:${PORT}/`);
  console.log(`Admin portal     →  http://localhost:${PORT}/admin/`);
});
