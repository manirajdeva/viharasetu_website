# Viharasetu

Website and back office for **Viharasetu** ("From Aastha to Eternal Anubhav"), a travel-planning
brand for India-focused pilgrimage and leisure packages.

| | |
|---|---|
| Public site | **[viharasetu.co.in](https://viharasetu.co.in)** |
| Admin portal | [viharasetu.co.in/admin/](https://viharasetu.co.in/admin/) |
| API | [viharasetu-api.onrender.com](https://viharasetu-api.onrender.com/health) (`/health` returns `{ ok: true }`) |

## How it fits together

```
 Browser
   │
   ▼
 viharasetu.co.in ── GitHub Pages, static HTML/CSS/JS from this repo's `main` branch
   │  index.html contact form ─┐
   │  admin/ portal ───────────┤  GET / POST  /exec
   │                           ▼
   │           viharasetu-api.onrender.com ── backend/  (Node 18+, Express, mysql2)
   │                           │
   │                           ▼
   │           TiDB Cloud Serverless ── MySQL-compatible database, the system of record
```

- **Frontend:** plain HTML/CSS/JavaScript, with no framework, build step, or bundler. The admin
  portal also loads Chart.js, SheetJS (xlsx) and jsPDF from CDNs at runtime.
- **Backend:** a Node.js + Express + MySQL API in [`backend/`](backend/). It serves both the public
  contact form and the admin portal. For setup, the API reference, and migrations, see
  [`backend/README.md`](backend/README.md).
- **Legacy:** this used to run on Google Apps Script + Google Sheets
  ([`google-apps-script/Code.gs`](google-apps-script/Code.gs)). That backend is retired, and the file
  is kept only as a reference. The new API still uses the old `/exec` request/response shape, so the
  frontend barely changed.

## Quick start (local)

You need **Node 18+**. Python is optional. Nothing needs installing for the frontend or the mock
server, because both have zero dependencies.

### Admin portal against the mock API (fastest, fully offline)

```bash
node mock-server/server.js          # mock API  → http://localhost:3001/exec
node mock-server/static-server.js   # site      → http://localhost:5500
```

Open **http://localhost:5500/admin/** and log in as **`admin` / `admin123`**.

- `admin/js/api.js` switches to `http://localhost:3001/exec` automatically when the page is served
  from `localhost` / `127.0.0.1`. A console line says which backend is active.
- The mock starts with sample data (10 enquiries, 5 suppliers, 4 bookings, 5 payments). It keeps the
  same envelope, auto-generated IDs, payments math, and admin/employee role rules as the real API.
  The data lives only in memory, so restarting `server.js` resets it.
- `?api=live` / `?api=mock` on any admin page overrides the automatic choice. The choice is remembered
  in `localStorage`. Using `live` from localhost only works if the API's `CORS_ORIGINS` includes your
  local origin.

### Admin portal against a real database

Run the real backend instead of the mock. Setup is in [`backend/README.md`](backend/README.md#local-run).
It also listens on **:3001**, so the portal on localhost uses it with no code changes. Add
`http://localhost:5500` to `CORS_ORIGINS` in `backend/.env`.

### Public site only

```bash
node mock-server/static-server.js   # http://localhost:5500
# or any static server, e.g.
python -m http.server 8000          # http://localhost:8000
```

The homepage contact form always posts to the **live** API (`scriptUrl` in `index.html`). The API
rejects origins that aren't in its CORS allowlist, so submitting the form from a local copy normally
fails. That is expected.

## Repository layout

```
index.html                     Homepage: hero slideshow, journeys, packages, testimonials, contact form
feedback.html                  Traveler feedback page (mailto + WhatsApp links, no backend)
admin.html                     Redirect stub → admin/ (so old bookmarks keep working)
CNAME                          GitHub Pages custom domain (viharasetu.co.in)
.nojekyll                      Disables Jekyll processing on GitHub Pages

admin/                         Admin portal
  index.html                   Login page (entry point; /admin/ lands here)
  portal.html                  App shell: sidebar + all views
  css/admin.css                Portal design system
  js/api.js                    API wrapper: picks live vs mock backend, attaches the session token
  js/auth.js                   sessionStorage session, page guard, logout
  js/utils.js                  Toasts, confirm dialog, formatting, phone validation, pagination, CSV/Excel/PDF export
  js/shell.js                  Sidebar, routing, shared form modal, Profile, makeSheetModule() table factory
  js/dashboard.js              Bookings / Payments dashboards (stat cards + Chart.js)
  js/{enquiries,suppliers,bookings,payments,reports}.js   Per-view modules built on the factory
  js/users.js                  User management (admins only)

backend/                       Node/Express + MySQL API. See backend/README.md
  src/                         server, config, db pool, auth, IDs, mappers, validation, routes/, services/
  migrate/schema.sql           CREATE TABLE for every table (fresh databases)
  migrate/YYYY-MM-DD-*.js      Incremental, idempotent migrations for existing databases
  migrate/seed-admin.js        Create / reset a portal login
  migrate/import-from-sheets.js  One-off Google Sheets CSV → MySQL importer

mock-server/                   Local-dev only, not deployed
  server.js                    In-memory mock of the API on :3001
  static-server.js             Static file server for the repo root on :5500

destinations/
  destinations-common.css      Shared stylesheet for most package pages
  gallery-lightbox.js          Opens gallery photos in an in-page popup
  itinerary-modal.js           "View itinerary" modal on package pages
  All_packages/
    Explore_Destination.html   Destinations hub: every package as a filterable card grid
    All_packages.html          Older copy of the hub; no page links to it
    <STATE_NAME>/*.html        One detail page per package

images/                        Site imagery (images/Travel_pngs/small/ = nav-strip monument icons)
pdf_files/                     Downloadable PDFs (the "About" brochure)
google-apps-script/Code.gs     LEGACY Apps Script backend, reference only
refactor_css.py, update_all_packages_css.py   Old one-off bulk-edit scripts (see below)
```

## Public site

### Features

- **Explore India hub** (`Explore_Destination.html`): every package as a card. On load, a script sorts
  the cards alphabetically by their `data-state` and computes the "N destinations found" count, so the
  order in the HTML doesn't matter. Cards also carry `data-seasons`, which no script reads yet.
- **Animated monument-train nav strip**: a scrolling row of monument icons plus an inline SVG train in
  the sticky header of the homepage and the hub. It animates with `transform: translateX()` rather
  than `left` so it stays smooth on mobile.
- **Liquid-glass buttons**: the "Home" and "Back to Destinations" buttons on package pages use
  `backdrop-filter: blur()` with a translucent gradient.
- **Gallery lightbox** and **itinerary modal** on package pages (`destinations/*.js`).
- **Contact form**: creates a `New` enquiry through the API and shows the visitor their Enquiry ID
  (e.g. `VH-20260911-01`). The phone number is sent as `"+<country code> <number>"`.

### Destination packages

Package pages are grouped by state under `destinations/All_packages/`:

| State | Packages |
|---|---|
| Andhra Pradesh | Vizag & Araku Valley |
| Arunachal Pradesh | Tawang |
| Delhi | Delhi–Mathura–Vrindavan–Agra |
| Goa | North Goa–South Goa, North Goa–South Goa–Dudhsagar |
| Himachal Pradesh | Shimla–Manali–Kasol, Spiti Valley |
| Jammu & Kashmir | Gulmarg, Pahalgam, Sonmarg, Srinagar, Vaishno Devi |
| Karnataka | Coorg, Hampi, Mysore |
| Kerala | Alleppey, Munnar, and combined Kochi–Munnar–Thekkady–Alleppey(–Kovalam–Thiruvananthapuram) tours |
| Ladakh | Leh–Ladakh |
| Lakshadweep | Lakshadweep |
| Puducherry | Pondicherry |
| Rajasthan | Jaipur–Jodhpur–Jaisalmer–Udaipur–Pushkar–Mount Abu |
| Tamil Nadu | Ooty, Temple Trail |
| Uttarakhand | Chardham, Kedarnath–Badrinath, Rishikesh(–Haridwar), Tungnath–Chandrashila, Valley of Flowers |
| Uttar Pradesh | Agra, Varanasi |

### Adding a package page

1. Copy a page that uses the shared stylesheet (for example `KARNATAKA/hampi.html`) to
   `destinations/All_packages/<STATE_NAME>/<slug>.html`, and replace its content. Put its photos
   under `images/<Place>/`.
2. Keep its `<link … destinations-common.css?v=N>` at the **same `N`** as the other pages (currently `11`).
3. Add a card to `Explore_Destination.html`:
   `<a class="dest-card" href="<STATE_NAME>/<slug>.html" data-state="…" data-seasons="Winter,Summer">`.
   It can go anywhere in the grid, because the sort and the count are handled automatically.
4. Add it to the table above.

### Shared styles and caching

- Most package pages link `destinations-common.css`. The exceptions are the five Jammu & Kashmir
  pages and three Uttarakhand pages (`kedarnath-badrinath`, `rishikesh-haridwar`,
  `tungnath-chandrashila`), which carry their own copy of the styles inline. When you change shared
  button, header, or gallery styling, update both.
- **Cache busting:** each page references the stylesheet as `destinations-common.css?v=N`. Whenever
  you edit that file, bump `N` on **all** pages that use it, or browsers keep serving the old copy.

## Admin portal

Sidebar sections: **Dashboard** (a dropdown switches between the Bookings and Payments dashboards),
**Enquiries**, **Suppliers**, **Bookings**, **Payments**, **Reports**, **Users** (admins only), and
**Profile**.

- Every table has search, sort, and pagination, plus CSV / Excel / PDF export.
- The portal loads all its data with a single `bootstrap` call on open, and **Refresh** reloads it.
  Moving between sections makes no further requests.
- Picking an **Enquiry ID** in Bookings or Payments fills in Customer, Destination, and Travel Dates
  from that enquiry.
- **Payments:** the server assigns each payment a `PMT-000001`-style ID and an instalment number
  within its enquiry. It works out *Pending Amount* as Total − Σ Amount Paid (grouped by Enquiry ID,
  or by Customer when the ID is blank) and rejects overpayments. The toolbar can filter by Enquiry ID
  and can show only the latest payment per enquiry.
- **Phone fields** take a country code plus a number and are stored as `"+91 9876543210"`. For `+91`,
  the number must be a 10-digit Indian mobile. Other codes accept 6–14 digits.

### Roles

Accounts are either `admin` or `employee`. The server enforces the rules; the UI only hides the
buttons.

| | admin | employee |
|---|:-:|:-:|
| View every section, add entries | ✓ | ✓ |
| Edit / delete entries | ✓ | — |
| Manage users (Users section) | ✓ | — |
| Edit own profile / password | ✓ | ✓ |

At least one admin must always exist, and no one can delete their own account.

### Logins and sessions

- Logging in returns a session token that expires after **6 hours**. It is kept in `sessionStorage`,
  so closing the tab ends the session. An expired token sends the user back to the login page.
- Passwords are stored as bcrypt hashes. There is **no self-service password reset**: "Forgot
  password?" tells the user to ask an admin, who resets it under **Users → Edit**.
- To create the first admin, or to recover when no admin can log in, run
  `npm run seed-admin -- <username> <password>` in `backend/` (see
  [`backend/README.md`](backend/README.md#accounts)).

## Branching and deployment

1. **Work on the `viharasetu` branch.** It is the working/staging branch, and `main` is what gets
   deployed.
2. **Stage explicit paths only; never run `git add -A` or `git add .`** This repo is **public**, and
   local working copies have held untracked secrets such as database credentials.
3. When a change is verified, merge it into `main` and push:

   ```bash
   git checkout viharasetu
   git add path/to/changed-file another/file
   git commit -m "Describe the change"
   git push origin viharasetu

   git checkout main
   git merge --ff-only viharasetu
   git push origin main
   git checkout viharasetu
   ```

4. Pushing to `main` deploys:
   - **Frontend:** GitHub Pages rebuilds the site automatically. Check progress with
     `gh run list --limit 5` or `gh api repos/manirajdeva/viharasetu_website/pages/builds/latest`.
   - **Backend:** the Render web service `viharasetu-api` builds `backend/` from `main`.
5. **Schema changes** don't deploy themselves. Add a dated migration under `backend/migrate/`, run it
   once against the production database, and update `schema.sql` too (see
   [`backend/README.md`](backend/README.md#database-migrations)).

The API URL is set in two places. If the backend ever moves, update both:
`PRODUCTION_SCRIPT_URL` in `admin/js/api.js` and `scriptUrl` in `index.html`.

## Operations notes

- **Cold starts:** Render's free tier puts the API to sleep after ~15 minutes idle, and the next
  request then takes ~50 s. An UptimeRobot monitor pings `/health` to keep it awake. If the portal or
  contact form is suddenly slow, check that monitor first.
- **Secrets** live only in `backend/.env` (git-ignored) locally and in Render's environment variables
  in production. Nothing secret belongs in the frontend or in a commit.
- **TiDB clock quirk:** on TiDB Serverless, the database's `NOW()` runs a few hours behind real UTC.
  Timestamps the app writes round-trip correctly, but don't compare Node's current time with
  database `NOW()`. Keep time comparisons entirely on one side (see
  [`backend/README.md`](backend/README.md#known-quirks)).

## Utility scripts

[`refactor_css.py`](refactor_css.py) and [`update_all_packages_css.py`](update_all_packages_css.py)
are one-off scripts from earlier redesigns. They bulk-edited CSS and markup across package pages.
**They are stale:** both expect package pages directly in `destinations/All_packages/`, but the pages
now live in per-state folders. Read them and fix their paths before running either one.

## Legacy Apps Script

`google-apps-script/Code.gs` is the old Google Apps Script + Google Sheets backend. It is no longer
used and is kept only as a reference and cold backup. `gas-deploy/` (git-ignored) was the local
`clasp` deploy folder for it. Production data was not imported from the Sheet, because the MySQL
database started fresh. The importer (`backend/migrate/import-from-sheets.js`) is still available if
that is ever needed.
