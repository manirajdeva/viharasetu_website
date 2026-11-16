# Contributing to Viharasetu

Thank you for your interest. This is a **proprietary** project (see [LICENSE](LICENSE)), so contributions
are **by invitation only**. Please do not open pull requests unless the Owner has asked you to work on
this repository.

## Reporting an issue

- **Broken page, wrong price, wrong itinerary or typo:** email info@viharasetu.co.in or WhatsApp
  +91 98851 80515 with the page link and a screenshot.
- **Security problem:** please do **not** post it publicly or in a GitHub issue. Email
  info@viharasetu.co.in with the subject "Security" and the steps to reproduce. We will reply as soon as we can.
- **Copyright or brand misuse:** write to the same email with links to the material.

## For invited contributors

1. Branches: do your work on the `viharasetu` branch. `main` is the live site (GitHub Pages), so changes
   reach it only after the Owner approves and merges.
2. Keep each change small and focused, with a clear commit message such as
   `Add Kerala hero slide` or `Fix price on Ladakh page`.
3. Test locally before asking for a merge. Serve the folder with
   `py -m http.server 8000 --bind 127.0.0.1` and open `http://127.0.0.1:8000/`. On Windows use `127.0.0.1`,
   not `localhost`.
4. Check small screens (about 390px wide) as well as desktop.
5. The site is plain HTML, CSS and vanilla JavaScript. Do not add frameworks or build steps without approval.
6. The admin portal lives in its own repo, `viharasetu_admin`. Do not copy admin code into this one.

## Content rules

- Prices, itineraries, timings and airport or baggage facts must come from, or be approved by, the Owner.
  Mark any figure you are unsure of so it can be checked.
- Only use images and text you have the right to use. For third-party images (for example Wikimedia
  Commons), keep the credit and licence with the image.
- Never commit secrets: passwords, API keys, database URLs, `.env` files or customer data.
  Enquiries and testimonials are personal data and must not be copied into the repo without consent.

## Your contribution

Anything you contribute to this repository becomes the property of Vihara Setu, and you confirm that you
have the right to give it. No payment or credit is implied unless agreed in writing beforehand.
