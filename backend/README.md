# Viharasetu backend API

Node.js + Express + MySQL. Replaces the old Google Apps Script + Google Sheets
backend for both the admin portal (`admin/`) and the public contact form
(`index.html`). It speaks the **exact same request/response envelope** as the
old `/exec` endpoint, so the frontend only needed its API URL changed.

```
Admin Portal ─┐
              ├─▶  Backend API (this)  ─▶  MySQL
Public site ──┘
```

## Architecture

| Path | What it is |
|---|---|
| `POST/GET /exec` | **Compatibility endpoint.** Byte-for-byte the old Apps Script API (`login`, `logout`, `bootstrap`, `dashboardStats`, `reports`, `updateProfile`, `create`, `update`, `delete`, and the legacy no-action enquiry create). The admin portal and the contact form use this. |
| `/api/*` | RESTful surface (`GET/POST/PUT/PATCH/DELETE`) over the same service layer — for future clients and scripts. Not used by the portal today. |
| `/api/public/*` | Unauthenticated: `health`, and a REST alias for submitting an enquiry. |

| File | Responsibility |
|---|---|
| `src/server.js` | Middleware (helmet, CORS allowlist, body parsing, rate limits), route mounting, error handler, startup DB check. |
| `src/config.js` | All config from env vars — throws if a `DB_*` var is missing. Nothing hard-coded. |
| `src/db.js` | One `mysql2` pool. UTC datetimes, decimals as numbers. |
| `src/auth.js` | bcrypt password check, token sessions in the `sessions` table (6h TTL). |
| `src/ids.js` | `VH-YYYYMMDD-NN` / `PMT-000001` minting from the `counters` table, transactional. |
| `src/mappers.js` | The compatibility layer: DB `snake_case`/`id` ⇄ display `"Header"`/`rowIndex`. |
| `src/validation.js` | Server-side validation, mirroring + hardening the portal's client rules. |
| `src/services/*` | `sheets` (CRUD), `payments` (overpayment guard + derived Pending), `dashboard`, `reports`, `bootstrap`, `profile`. |
| `migrate/schema.sql` | `CREATE TABLE` for all 7 tables. |
| `migrate/run-schema.js` | Applies `schema.sql` using the `.env` connection. |
| `migrate/seed-admin.js` | Create / reset an admin login (bcrypt). |
| `migrate/import-from-sheets.js` | One-off: Google Sheets CSV export → MySQL, idempotent, FK-safe, no row loss. |

## Security

- **SQL injection:** every query uses `?` placeholders; table/column names come only from `src/mappers.js`, never the request.
- **Passwords:** bcrypt (`BCRYPT_ROUNDS`, default 12). Plaintext never stored, never logged.
- **Auth:** opaque 32-hex session tokens, server-side TTL, swept every 30 min. `can_delete` gate enforced server-side.
- **CORS:** locked to `CORS_ORIGINS` (an allowlist). Non-allowlisted browser origins get `403 CORS`.
- **Rate limiting:** 600 req / 15 min per IP globally; 20 / 15 min on login; 30 / hour on public enquiry submit.
- **Headers:** `helmet`, `x-powered-by` disabled.
- **Env:** credentials only in `.env` (git-ignored). `.env.example` is the template.
- **Logging:** method / path / status / latency / action name only — never bodies, tokens or passwords.
- **Errors:** always `{ ok:false, error:{ code, message } }`; 500s do not leak internals.

## Environment variables

Copy `.env.example` → `.env`:

| Var | Notes |
|---|---|
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASSWORD` | MySQL connection. Required. |
| `DB_SSL` | `true` for managed MySQL requiring TLS (PlanetScale, some Railway/Aiven). |
| `DB_SSL_REJECT_UNAUTHORIZED` | Leave `true` unless the provider says otherwise. |
| `DB_POOL` | Pool size (default 10). |
| `PORT` | API port (default 3001). Managed platforms set this for you. |
| `NODE_ENV` | `production` in prod. |
| `CORS_ORIGINS` | Comma-separated. Must list every origin the site is served from. |
| `SESSION_TTL_HOURS` | Admin session lifetime (default 6). |
| `BCRYPT_ROUNDS` | bcrypt cost (default 12). |

## Local run

```bash
cd backend
cp .env.example .env          # fill in DB_* for a local or remote MySQL
npm install
npm run schema                # create tables
npm run seed-admin -- admin 'somePassword123' --can-delete --email you@viharasetu.co.in
npm start                     # API on http://localhost:3001
```

Smoke test:

```bash
curl http://localhost:3001/health
curl -X POST http://localhost:3001/exec -H 'Content-Type: text/plain' \
  -d '{"action":"login","username":"admin","password":"somePassword123"}'
```

> The offline test in `../` (`node scratchpad/test.js` during development) exercises
> the whole `/exec` + `/api` flow against an in-memory fake DB — 43 assertions.

## Deploy (Railway example)

1. **MySQL:** Railway → *New* → *Database* → *MySQL*. Copy its connection vars.
2. **API service:** *New* → *GitHub Repo* → this repo. Set **Root Directory** to `backend`.
   Build `npm install`, start `npm start` (from `package.json`).
3. **Variables:** add every row from `.env.example` with real values.
   `CORS_ORIGINS=https://viharasetu.co.in,https://www.viharasetu.co.in`.
   `DB_SSL=true` if Railway's MySQL requires it.
4. **Schema + data** (run once, from your machine, `.env` pointed at the Railway MySQL —
   enable "public networking" on the DB or use `railway run`):
   ```bash
   npm run schema
   node migrate/import-from-sheets.js --dry-run      # review
   node migrate/import-from-sheets.js --fresh        # load
   npm run seed-admin -- <username> <password> --can-delete
   ```
5. **Domain:** Railway gives `https://<name>.up.railway.app`. Optionally map
   `api.viharasetu.co.in` to it.
6. **Point the frontend at it:** set `PRODUCTION_SCRIPT_URL` in
   `../admin/js/api.js` and `scriptUrl` in `../index.html` to
   `https://<that host>/exec`, commit, and let GitHub Pages redeploy.
7. Once verified, the Google Apps Script deployment can be retired (or left
   read-only as a cold backup — the Sheet is untouched by any of this).

Any Node PaaS works the same way (Render: root dir `backend`, build `npm install`,
start `npm start`; Fly.io: `fly launch` in `backend/`).
