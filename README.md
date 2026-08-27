# Viharasetu

Static website for **Viharasetu** ("From Aastha to Eternal Anubhav"), a travel-planning
brand for India-focused pilgrimage and leisure packages. Live at **[viharasetu.co.in](https://viharasetu.co.in)**.

## Tech stack

- Plain HTML/CSS/JavaScript — no framework, no build step, no bundler.
- Deployed via **GitHub Pages** from the `main` branch (custom domain via the `CNAME` file).
- Backend for forms and the admin portal is a **Google Apps Script** web app writing to a
  Google Sheet (see [`google-apps-script/Code.gs`](google-apps-script/Code.gs)).
- The admin portal (`admin/`) additionally loads Chart.js, SheetJS (xlsx) and jsPDF from
  CDNs at runtime — still no build step.

## Project structure

```
index.html                     Homepage — hero, journeys, packages, contact form
feedback.html                  Traveler feedback page
admin.html                     Redirect stub → admin/ (kept so old bookmarks still work)
CNAME                          GitHub Pages custom domain (viharasetu.co.in)
.nojekyll                      Disables Jekyll processing on GitHub Pages (this is a plain static site)

admin/                         Admin portal (multi-file, server-side token auth)
  index.html                   Login page (entry point — /admin/ lands here)
  portal.html                  App shell: Dashboard / Enquiries / Suppliers / Bookings / Payments / Reports / Profile
  css/admin.css                Portal design system (Viharasetu brand + reference-portal layout)
  js/api.js                    Apps Script fetch wrapper (GET reads, POST actions), token injection
  js/auth.js                   sessionStorage session, page guard, logout
  js/utils.js                  Toasts, confirm dialog, formatting, pagination, sort, CSV/Excel/PDF export
  js/shell.js                  Sidebar + routing + shared form modal + Profile + makeSheetModule() factory
  js/dashboard.js              Stat cards + Chart.js charts + recent activity
  js/{enquiries,suppliers,bookings,payments,reports}.js   Thin per-view modules over the factory

mock-server/                   Local-dev stand-in for the Apps Script backend (zero-dependency Node)
  server.js                    Mock admin API on :3001 — same envelope + in-memory seed data
  static-server.js             Static file server on :5500 (serves the repo root, incl. /admin/)

images/                        Site imagery, incl. images/Travel_pngs/small/ (nav-bar monument train icons)
pdf_files/                     Downloadable PDFs (e.g. "About" brochure)
google-apps-script/Code.gs     Apps Script backend: Enquiries / Suppliers / Bookings / Payments / Admins sheets

destinations/
  destinations-common.css      Shared stylesheet used by most package pages
  gallery-lightbox.js          Turns gallery photo links into an in-page popup (no new-tab navigation)
  itinerary-modal.js           Powers the "View itinerary" modal on package pages
  All_packages/
    Explore_Destination.html   Destinations hub — lists/sorts every package as a card grid
    <STATE_NAME>/*.html        One detail page per package (gallery, itinerary, highlights, etc.)
```

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

Most package pages link the shared `destinations-common.css`. The five Jammu & Kashmir
pages and three Uttarakhand pages (`kedarnath-badrinath`, `rishikesh-haridwar`,
`tungnath-chandrashila`) instead carry their own styles duplicated inline — keep both in
sync when changing shared button/header/gallery styling.

## Key features

- **Explore India hub** (`Explore_Destination.html`) — all packages sorted alphabetically
  by state, with a live "N destinations found" count computed from the actual card list.
- **Animated monument-train nav strip** — a scrolling row of monument icons + an inline
  SVG train, used in the sticky header of both the homepage and the destinations hub.
  Positioned with `transform: translateX()` (GPU-composited) rather than the `left`
  property, to avoid layout-driven jank on mobile.
- **Liquid-glass buttons** — "Home" / "Back to Destinations" on every package page use a
  glassmorphism style (`backdrop-filter: blur()` + translucent gradient), not solid fill.
- **Gallery lightbox** — clicking a gallery photo opens it in an in-page popup
  (`gallery-lightbox.js`) instead of navigating to the raw image URL.
- **Itinerary modal** — package pages render day-by-day itineraries in a modal
  (`itinerary-modal.js`).
- **Admin portal** (`admin/`) — a multi-file portal (Dashboard with Chart.js, Enquiries,
  Suppliers, Bookings, Payments, Reports, Profile) with per-table search / sort /
  pagination and CSV / Excel / PDF export. Login is checked server-side against an
  **Admins** tab in the sheet; `Code.gs` returns a 6-hour session token that is held in
  `sessionStorage` (cleared when the tab closes) and sent with every request. No password
  ever lives in the frontend after login.

## Backend (Google Apps Script)

`google-apps-script/Code.gs` is deployed as a Google Apps Script web app and backs both
the public contact form (`index.html`) and the admin portal (`admin/`):

- `GET /exec?sheet=enquiries|suppliers|bookings|payments&token=…` → JSON rows (token required).
- `POST /exec` with no `sheet`/`action` → legacy path, appends a new **Enquiries** row
  (used by the homepage contact form; still unauthenticated).
- `POST /exec` `{action:'login', username, password}` → `{ token, expiresAt, user }`.
- `POST /exec` `{action:'logout', token}` → invalidates the token.
- `POST /exec` `{token, sheet, action:'create'|'update'|'delete', values, rowIndex}` → row CRUD.
  For `sheet:'payments'` the server mints a `Payment ID` (`PMT-000001`) on create, and derives
  `Pending Amount` = `Total Amount` − Σ(`Amount Paid` for the same `Enquiry ID`, or same
  `Customer` when the ID is blank), rejecting an overpayment.
- `POST /exec` `{token, action:'updateProfile', values}` → change own mobile / email / password.
- `POST /exec` `{token, action:'bootstrap'}` → `{ sheets:{enquiries,suppliers,bookings,payments},
  stats }` in **one** request. The portal calls this once on load and serves every view from
  the result (Refresh re-runs it), so navigating between sections costs no further round trips.
- `POST /exec` `{token, action:'dashboardStats'}` → aggregate numbers + 6-month series + recent feed.
- `POST /exec` `{token, action:'reports', data:{filters}}` → one row per enquiry joined to its
  bookings + payments, with the filters applied.

**Admins tab** — add one row per admin: `Username`, `Password`, `CanDelete` (TRUE/FALSE),
`Mobile`, `Email`. Until at least one row exists, nobody can log in. Passwords are stored
in plaintext in the sheet, so keep the sheet access-controlled.

**Schema changes** — `getSheetInfo_` appends any newly-added column to an existing sheet's
header row automatically, so new columns must be added at the *end* of the `SHEETS.<key>.headers`
array to stay position-aligned. `resetData()` (run from the Apps Script editor — not web-exposed)
clears all data rows from Enquiries/Suppliers/Bookings/Payments, leaves Admins alone,
normalises each header row to the canonical order, and resets the Enquiry ID / Payment ID
counters so they restart from 1.

### Redeploying `Code.gs`

**Via the editor:** open the Sheet → Extensions → Apps Script → paste the file in →
**Deploy → Manage deployments → edit the existing deployment → New version → Deploy**
(keep the *same* deployment so the `/exec` URL used by `index.html` and `admin/` doesn't
change).

**Via `clasp`** (the Sheet-bound script — owner account `viharasetu@gmail.com`, needs the
Apps Script API enabled at <https://script.google.com/home/usersettings>):

```bash
clasp login                                             # once, as viharasetu@gmail.com
mkdir gas-deploy && cd gas-deploy
clasp clone-script 1cHmRTT6ji_HMuc0QI2WUI7yOFV-NJq9WiOE8Pby002_rxBGaeACEYiXJ
cp ../google-apps-script/Code.gs Code.js                # google-apps-script/Code.gs is the source of truth
clasp push -f
clasp create-version "what changed"
clasp update-deployment AKfycby16uHDPLkWFMHOQtKH3ggej7MnRNW4Lfrn5RPrLkNpN-6Vj8aFitTBHjgvIqi1qaDQzA --versionNumber <n>
```

`gas-deploy/` is git-ignored — it's just a local clasp working copy. The project also has a
separate `@HEAD` deployment used for testing; leave it alone.

## Deployment

Pushing to `main` triggers GitHub Pages' `pages build and deployment` workflow
automatically — no separate build step is needed since this is a plain static site.

```bash
git add -A
git commit -m "..."
git push origin main
```

To check deployment status:

```bash
gh run list --limit 5
gh api repos/manirajdeva/viharasetu_website/pages/builds/latest
```

Browser caching: `destinations-common.css` is referenced with a version query string
(`destinations-common.css?v=N`) from every package page. Bump `N` on every edit to that
file so browsers pick up the change instead of serving a cached copy.

## Local development

No build tooling is required — serve the folder with any static file server, e.g.:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/index.html`.

### Admin portal with the mock backend

Hitting the live Google Apps Script backend from localhost is slow (a few seconds per
call). `mock-server/` is a zero-dependency Node stand-in with the **same request/response
envelope**, the same sheet headers, the same payments math (Pending Amount + overpayment
guard) and the same auto IDs — backed by an in-memory store seeded with sample data.

```bash
node mock-server/server.js          # mock admin API  → http://localhost:3001/exec
node mock-server/static-server.js   # site + /admin/   → http://localhost:5500
```

Open **http://localhost:5500/admin/** and log in with **`admin` / `admin123`**.
`admin/js/api.js` points at the mock automatically on `localhost` / `127.0.0.1`; a console
line states which backend is active. To hit the real Google backend from localhost instead,
load any admin page once with `?api=live` (remembered until `?api=mock`). Mock data lives
only in the Node process — restart `server.js` to reset to the seed set.

(Any static server works for the frontend — `python -m http.server 8000` is fine too; only
the `?api` hostname check matters, not the port.)

## Utility scripts

- [`refactor_css.py`](refactor_css.py) / [`update_all_packages_css.py`](update_all_packages_css.py)
  — one-off scripts used to bulk-edit CSS/markup across the package pages during earlier
  redesigns. Re-check their contents before rerunning, since they target specific
  strings/patterns that may no longer match the current markup.
