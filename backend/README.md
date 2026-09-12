# Viharasetu backend API

Node.js + Express + MySQL (`mysql2`). This one API serves both the admin portal (`../admin/`) and
the public contact form (`../index.html`). It replaced the old Google Apps Script + Google Sheets
backend and keeps that backend's **`/exec` request/response envelope**, so the frontend only needed
its API URL changed.

```
Admin portal ─┐
              ├─▶  this API  ─▶  MySQL (TiDB Cloud Serverless in production)
Contact form ─┘
```

**Production:** Render web service `viharasetu-api` → https://viharasetu-api.onrender.com
(root directory `backend`, deploys from `main`).

## Endpoints

| Path | What it is |
|---|---|
| `GET /health` | Liveness check, `{ ok, time }`. Used by the uptime monitor. |
| `GET/POST /exec` | **Compatibility endpoint, used by the portal and contact form.** Same envelope as the old Apps Script web app (details below). |
| `/api/*` | RESTful surface over the same service layer, for scripts and future clients. Takes `Authorization: Bearer <token>`. The portal does not use it. |
| `/api/public/*` | Unauthenticated: `GET health`, and `POST enquiries` (a REST alias for the contact form). |

Every response is `{ ok: true, … }` or `{ ok: false, error: { code, message } }`.

### `/exec` actions

The body is a JSON string. Clients send it as `Content-Type: text/plain`, which keeps the browser
from sending a CORS preflight (OPTIONS) first. Real `application/json` also works.

| Request | Auth | Result |
|---|---|---|
| `GET /exec?sheet=enquiries\|suppliers\|bookings\|payments&token=…` | token | `{ headers, rows }` |
| `POST` with no `sheet`/`action`, `{ name, email, phone, destination, travel, no_of_people?, hotel_preference?, special_req?, notes? }` | none (rate-limited) | Creates a `New` enquiry, returns `{ enquiryId }`. `no_of_people` must be a whole number from 1 to 999. `hotel_preference` must be `3 Star`, `4 Star`, or `5 Star`. This is the contact form (and the journey "Enquire" popup). The submission is also logged in `site_enquirys` with its timestamp and optional `source` (`contact_form` / `journey_popup`), in the same transaction. |
| `{ action:'login', username, password }` | none | `{ token, expiresAt, user }` |
| `{ action:'logout', token }` | token | Invalidates the token |
| `{ token, action:'bootstrap' }` | token | All four tables plus dashboard stats, in one call. The portal uses this on load. |
| `{ token, action:'dashboardStats' }` | token | Aggregates, 6-month series, recent activity, and the payments summary |
| `{ token, action:'reports', data:{ filters } }` | token | One row per enquiry, joined to its bookings and payments |
| `{ token, action:'updateProfile', values }` | token | Change your own mobile, email, or password (`currentPassword` required) |
| `{ token, sheet, action:'create', values }` | token | Insert a row |
| `{ token, sheet, action:'update', rowIndex, values }` | **admin** | Update a row |
| `{ token, sheet, action:'delete', rowIndex }` | **admin** | Delete a row |
| `{ token, action:'listUsers' \| 'createUser' \| 'updateUser' \| 'deleteUser', … }` | **admin** | Portal account management |

Rows use the display headers (`"Enquiry ID"`, `"Amount Paid"`, …) and a `rowIndex`. The
`src/mappers.js` module converts between those and the database's `snake_case` columns and `id`.

## Code map

| File | Responsibility |
|---|---|
| `src/server.js` | Middleware (helmet, CORS allowlist, body parsing, rate limits), route mounting, error handler, startup database check |
| `src/config.js` | All configuration, read from environment variables. Throws if a required `DB_*` variable is missing. |
| `src/db.js` | The single `mysql2` pool. UTC datetimes, decimals returned as numbers. |
| `src/auth.js` | bcrypt password check, token sessions in the `sessions` table, role lookups |
| `src/ids.js` | Mints `VH-YYYYMMDD-NN` enquiry IDs and `PMT-000001` payment IDs from the `counters` table, inside a transaction |
| `src/mappers.js` | Compatibility layer: database columns ⇄ display headers, `id` ⇄ `rowIndex` |
| `src/validation.js`, `src/phone.js` | Server-side validation that mirrors the portal's client rules (`phone.js` accepts `"+<code> <number>"` or a bare 10-digit Indian mobile) |
| `src/logger.js` | Request log: method, path, status, latency, action name |
| `src/routes/exec.js` | The `/exec` compatibility endpoint |
| `src/routes/api.js`, `src/routes/public.js` | REST surface and public endpoints |
| `src/services/sheets.js` | Row CRUD for the four data tables |
| `src/services/payments.js` | Overpayment guard, derived Pending Amount, instalment renumbering |
| `src/services/{dashboard,reports,bootstrap,profile,users}.js` | The remaining actions |

## Security

- **SQL injection:** every query uses `?` placeholders. Table and column names come only from
  `src/mappers.js`, never from the request.
- **Passwords:** bcrypt (`BCRYPT_ROUNDS`, default 12). Plaintext is never stored or logged.
- **Sessions:** opaque 32-hex tokens with a server-side TTL (`SESSION_TTL_HOURS`, default 6). Expired
  tokens are swept every 30 minutes.
- **Roles:** `admins.role` is `admin` or `employee`. Employees can read and create but cannot edit,
  delete, or manage users. The server enforces this on both `/exec` and `/api`.
- **CORS:** only origins in `CORS_ORIGINS` are allowed. Other browser origins get `403 CORS`.
- **Rate limits:** 600 requests / 15 min per IP overall, 20 failed logins / 15 min, and 30 public
  enquiry submissions / hour on `/api/public/enquiries`.
- **Headers:** `helmet`, with `x-powered-by` disabled.
- **Logs** never contain request bodies, tokens, or passwords. 500 errors don't leak internals.
- **Secrets** live only in `.env` (git-ignored) and in the host's environment variables.
  `.env.example` is the template.

## Environment variables

Copy `.env.example` to `.env` and fill it in:

| Variable | Notes |
|---|---|
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASSWORD` | MySQL connection. Required. |
| `DB_SSL` | `true` for managed MySQL that requires TLS. **TiDB Cloud needs `true`.** |
| `DB_SSL_REJECT_UNAUTHORIZED` | Leave as `true` unless your provider says otherwise. |
| `DB_POOL` | Pool size (default 10). |
| `PORT` | API port (default 3001). Managed hosts set this for you. |
| `NODE_ENV` | `production` in production. |
| `CORS_ORIGINS` | Comma-separated list of every origin that serves the site. For local work, add `http://localhost:5500`. |
| `SESSION_TTL_HOURS` | Portal session lifetime (default 6). |
| `BCRYPT_ROUNDS` | bcrypt cost (default 12). |

## Local run

```bash
cd backend
cp .env.example .env          # fill in DB_* for a local or remote MySQL
npm install
npm run schema                # create all tables (safe to re-run)
npm run seed-admin -- admin 'somePassword123'
npm run dev                   # API on http://localhost:3001, restarts on file changes
```

Smoke test:

```bash
curl http://localhost:3001/health
curl -X POST http://localhost:3001/exec -H 'Content-Type: text/plain' \
  -d '{"action":"login","username":"admin","password":"somePassword123"}'
```

**Using it from the portal:** the portal on `localhost` calls `http://localhost:3001/exec`. That is
the mock server's address, and this API's address too. Stop `mock-server/server.js`, start this API
instead, and serve the site with `node ../mock-server/static-server.js`. Make sure `CORS_ORIGINS`
includes `http://localhost:5500`.

On startup the server checks that the database is reachable and that the `admins` table exists. If
either check fails it exits with an error, which usually means `.env` is wrong or `npm run schema`
hasn't been run.

## Accounts

```bash
npm run seed-admin -- <username> <password> [--role admin|employee] [--mobile 98XXXXXXXX] [--email a@b.c]
```

- The role defaults to `admin`. (`--can-delete` is accepted as a legacy alias for `--role admin`.)
- If the username already exists, the command **resets** that account's password and role. Use this
  to recover when no admin can log in.
- Everything else is done in the portal. Admins add and edit users under **Users**, and anyone can
  change their own password under **Profile**.

## Database migrations

- **Fresh database:** run `npm run schema`. `migrate/schema.sql` always describes the current full
  schema: `enquiries`, `site_enquirys`, `suppliers`, `bookings`, `payments`, `admins`, `sessions`,
  and `counters`.
  `bookings.enquiry_id` and `payments.enquiry_id` are nullable foreign keys to `enquiries`
  (`ON DELETE SET NULL`).
- **Existing database:** apply the dated scripts in `migrate/` that it hasn't had yet, oldest first:

  ```bash
  node migrate/2026-09-05-backfill-phone-country-code.js
  node migrate/2026-09-12-create-site-enquirys.js
  node migrate/2026-09-12-add-enquiry-trip-details.js
  ```

  Every dated script is idempotent: it checks before altering, so running it twice does nothing.
  When unsure whether production has one, it is safe to run it again.

When you change the schema:

1. Add `migrate/YYYY-MM-DD-<what>.js`, following the existing scripts. Read the connection from
   `src/config`, check whether the change is already there, then apply it.
2. Make the same change in `migrate/schema.sql` so fresh databases match.
3. Before merging the code that depends on it, run the script against production from your machine,
   with `.env` pointed at the production database.

### Importing the old Google Sheet (optional, one-off)

`migrate/import-from-sheets.js` loads a CSV export of the old Sheet (`sheets-export/`, git-ignored)
into MySQL. It never drops rows and respects foreign keys. Production started empty and did **not**
use it.

```bash
node migrate/import-from-sheets.js --dry-run        # report only, writes nothing
node migrate/import-from-sheets.js --fresh          # TRUNCATE the 4 data tables first, then import
node migrate/import-from-sheets.js --dir=/path/to/csvs
```

## Deploy

Production runs on **Render** (web service) with **TiDB Cloud Serverless** (MySQL-compatible).
Any Node host with a MySQL database works the same way:

1. **Database:** create a MySQL database (for TiDB, also set `DB_SSL=true`).
2. **Web service:** point it at this repo with root directory `backend`, build command
   `npm install`, and start command `npm start`.
3. **Environment:** add every variable from `.env.example` with real values. Set `NODE_ENV=production`
   and `CORS_ORIGINS=https://viharasetu.co.in,https://www.viharasetu.co.in`.
4. **Schema and first login:** from your machine, with `.env` pointed at the new database, run
   `npm run schema`, then `npm run seed-admin -- <username> <password>`.
5. **Frontend:** if the API URL changed, update `PRODUCTION_SCRIPT_URL` in `../admin/js/api.js` and
   `scriptUrl` in `../index.html`, then push to `main`.

After that, pushing to `main` redeploys the service.

## Known quirks

- **Free-tier sleep:** Render's free plan spins the service down after ~15 minutes idle, and the
  first request afterwards takes ~50 s. An UptimeRobot monitor on `/health` keeps it warm.
- **TiDB `NOW()` skew:** on TiDB Serverless, database `NOW()` runs a few hours behind real UTC.
  Timestamps the app writes (through `mysql2`) round-trip consistently, so this is normally invisible.
  It breaks any logic that compares a time computed in Node with `NOW()` in SQL, so keep such
  comparisons entirely on the database side, or entirely in Node.
- **No outbound email:** Render's free plan blocks SMTP. That is why there is no emailed password
  reset. Admins reset passwords from the portal instead.
