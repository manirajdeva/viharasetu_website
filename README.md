# Viharasetu

Static website for **Viharasetu** ("From Aastha to Eternal Anubhav"), a travel-planning
brand for India-focused pilgrimage and leisure packages. Live at **[viharasetu.co.in](https://viharasetu.co.in)**.

## Tech stack

- Plain HTML/CSS/JavaScript — no framework, no build step, no bundler.
- Deployed via **GitHub Pages** from the `main` branch (custom domain via the `CNAME` file).
- Backend for forms (enquiries / suppliers / bookings) is a **Google Apps Script** web app
  writing to a Google Sheet (see [`google-apps-script/Code.gs`](google-apps-script/Code.gs)).

## Project structure

```
index.html                     Homepage — hero, journeys, packages, contact form
feedback.html                  Traveler feedback page
admin.html                     Admin portal (enquiries / suppliers / bookings) — client-side login gate
CNAME                          GitHub Pages custom domain (viharasetu.co.in)
.nojekyll                      Disables Jekyll processing on GitHub Pages (this is a plain static site)

images/                        Site imagery, incl. images/Travel_pngs/small/ (nav-bar monument train icons)
pdf_files/                     Downloadable PDFs (e.g. "About" brochure)
google-apps-script/Code.gs     Apps Script backend: Enquiries / Suppliers / Bookings sheets

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
- **Admin portal** (`admin.html`) — views/edits the Enquiries, Suppliers, and Bookings
  sheets behind a client-side password gate. Because this is a static site, credentials
  live in the page's own JavaScript and are visible to anyone who views source — treat
  this as a basic access gate, not real authentication.

## Backend (Google Apps Script)

`google-apps-script/Code.gs` is deployed as a Google Apps Script web app and backs both
the public contact form (`index.html`) and the admin portal (`admin.html`):

- `GET /exec?sheet=enquiries|suppliers|bookings` → JSON rows for that sheet.
- `POST /exec` with no `sheet`/`action` → legacy path, appends a new **Enquiries** row
  (used by the homepage contact form).
- `POST /exec` with `{sheet, action: 'create'|'update'|'delete', ...}` → used by the admin
  portal to manage rows across all three sheets.

To redeploy after editing `Code.gs`: open the target Google Sheet → Extensions → Apps
Script → paste the file's contents in → **Deploy → Manage deployments → edit existing
deployment → New version → Deploy** (keep the same deployment so the `/exec` URL used by
`index.html`/`admin.html` doesn't change).

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

## Utility scripts

- [`refactor_css.py`](refactor_css.py) / [`update_all_packages_css.py`](update_all_packages_css.py)
  — one-off scripts used to bulk-edit CSS/markup across the package pages during earlier
  redesigns. Re-check their contents before rerunning, since they target specific
  strings/patterns that may no longer match the current markup.
