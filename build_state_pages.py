# -*- coding: utf-8 -*-
"""Builds destinations/All_packages/<STATE_FOLDER>/index.html (one page per state, listing that state's packages).

Source of truth: the destination cards in destinations/All_packages/Explore_Destination.html.
Re-run after adding or removing a card:   python build_state_pages.py
"""
import html, os, re

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "destinations", "All_packages")
src = open(os.path.join(BASE, "Explore_Destination.html"), encoding="utf-8").read().replace("\r\n", "\n")

# ---- cards, grouped by state folder
card_re = re.compile(r'<a class="dest-card".*?</a>', re.S)
states = {}
for m in card_re.finditer(src):
    block = m.group(0)
    href = re.search(r'href="([^"]+)"', block).group(1)
    if "/" not in href:
        continue  # special pages that belong to no single state
    state = re.search(r'data-state="([^"]+)"', block).group(1)
    folder = href.split("/")[0]
    states.setdefault(state, {"folder": folder, "cards": []})["cards"].append(block)
order = sorted(states)

# ---- shared pieces taken from the Explore page
head_css = src[src.index("<style>"):src.index("</style>") + len("</style>")]
header = src[src.index('  <header class="page-header">'):src.index("  </header>") + len("  </header>")]
_mb = src.index('<div class="mobile-contact-bar"')
mobile_bar = src[_mb:src.index("<script", _mb)]
nav_js = re.search(r"  <script>\n  \(function\(\) \{\n    const navToggle.*?</script>", src, re.S).group(0)
icon_js = src[src.rindex("<script>\n/* add thin-line icons"):src.index("</body>")]
tracking = src[src.index("<!-- Google tag"):src.index("</script>", src.index("gtag('config'")) + len("</script>")]
tail_scripts = "\n".join(re.findall(r'<script src="\.\./\.\./js/[^"]+" defer></script>', src))
STATE_ICON = re.search(r"var STATE = (\{.*?\});", icon_js).group(1)


def up(t):  # pages live one folder deeper than Explore_Destination.html
    return t.replace("../../", "../../../")


EXTRA_CSS = """
.sp-hero{padding:clamp(34px,4.5vw,56px) 0 clamp(30px,4vw,48px)}
.sp-hero .crumbs{font-size:.8rem;letter-spacing:.12em;text-transform:uppercase;color:var(--gold-light);margin-bottom:6px}
.sp-hero .crumbs a{text-decoration:underline;text-underline-offset:3px}
.sp-hero h1{margin:8px 0 12px}
.sp-hero .intro{max-width:640px;color:#f0e4cc}
.sp-hero .filter-bar{margin-top:26px;max-width:760px}
.state-nav{padding:22px 0 0}
.state-nav .pills{gap:8px}
.state-nav .pill{padding:7px 14px;font-size:.82rem}
.state-nav .pill.active{pointer-events:none}
.state-nav h2{font:600 .78rem var(--sans);letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
.search-all{display:inline-block;margin-top:14px;font-size:.88rem;text-decoration:underline;text-underline-offset:3px;color:var(--gold-light)}
.grid{grid-template-columns:repeat(4,1fr)}
@media (max-width:1180px){.grid{grid-template-columns:repeat(3,1fr)}}
@media (max-width:820px){.grid{grid-template-columns:repeat(2,1fr)}}
@media (max-width:520px){.grid{grid-template-columns:1fr}}
"""

PAGE_JS = """
<script>
(function () {
  var cards = Array.prototype.slice.call(document.querySelectorAll('.dest-card'));
  var input = document.getElementById('search-input'), num = document.getElementById('result-num'),
      empty = document.getElementById('empty-state'), norm = function (t) { return t.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/&/g, ' and '); };
  var text = cards.map(function (c) {
    return norm([c.querySelector('h3').textContent, (c.querySelector('.tagline') || {}).textContent || '', c.getAttribute('href').replace('.html', '').replace(/-/g, ' ')].join(' '));
  });
  function run() {
    var words = norm(input.value.trim()).split(/\\s+/).filter(Boolean), n = 0;
    cards.forEach(function (c, i) {
      var ok = words.every(function (w) { return text[i].indexOf(w) > -1; });
      c.classList.toggle('hidden', !ok); if (ok) n++;
    });
    num.textContent = n; empty.classList.toggle('show', n === 0);
  }
  input.addEventListener('input', run); run();
})();
</script>
"""


def build(state):
    info = states[state]
    folder, cards = info["folder"], info["cards"]
    n = len(cards)
    pills = '<a class="pill" href="../Explore_Destination.html"><i class="pi" style="--ico:url(../../../images/dest_icons/all.svg)"></i>All States</a>'
    for st in order:
        cls = "pill active" if st == state else "pill"
        pills += f'\n        <a class="{cls}" href="../{states[st]["folder"]}/index.html"><i class="pi" style="--ico:url(../../../images/dest_icons/__{html.escape(st)}__.svg)"></i>{html.escape(st)} <small>{len(states[st]["cards"])}</small></a>'
    # icon names come from the same STATE map the Explore page uses
    smap = dict(re.findall(r"'([^']+)':\s*'([^']+)'", STATE_ICON))
    for st in order:
        pills = pills.replace(f"__{html.escape(st)}__", smap.get(st, "pin"))
    body_cards = up("\n".join("      " + c.replace('href="%s/' % folder, 'href="') for c in cards))
    title = f"{state} Packages — Vihara Setu"
    desc = f"All {n} Vihara Setu travel packages and itineraries for {state}."
    page = f"""<!DOCTYPE html>
<html lang="en">
<head>
{tracking}

<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(desc)}">
<meta name="theme-color" content="#2a0f12">
<link rel="canonical" href="https://viharasetu.co.in/destinations/All_packages/{folder}/">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;0,700;1,500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="icon" href="../../../images/fevicon.png" type="image/png">
{up(head_css).replace("</style>", EXTRA_CSS + "</style>")}
</head>
<body>
{up(header)}

  <section class="hero sp-hero">
    <div class="container">
      <p class="crumbs"><a href="../Explore_Destination.html">All Destinations</a> › {html.escape(state)}</p>
      <span class="eyebrow">State packages</span>
      <h1><em>{html.escape(state)}</em></h1>
      <p class="intro">{n} journey{'s' if n != 1 else ''} in {html.escape(state)}. Open any package for the day-by-day itineraries, photos, map and what's included.</p>
      <div class="filter-bar">
        <label class="search-box">
          <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input type="search" id="search-input" class="search-input" placeholder="Search within {html.escape(state)}" aria-label="Search {html.escape(state)} packages" autocomplete="off">
        </label>
      </div>
      <a class="search-all" href="../Explore_Destination.html">Search every destination instead →</a>
    </div>
  </section>

  <section class="state-nav">
    <div class="container">
      <h2>Browse by state</h2>
      <nav class="pills" aria-label="States">
        {pills}
      </nav>
    </div>
  </section>

  <main class="results">
    <div class="container">
      <p class="result-count"><b id="result-num">{n}</b> journey{'s' if n != 1 else ''} found</p>
      <div class="grid" id="dest-grid">
{body_cards}
      <p class="empty-state" id="empty-state">No packages match your search — try another place name.</p>
      </div>
    </div>
  </main>

  <footer><div class="container">© Vihara Setu · <a href="../Explore_Destination.html">All Destinations</a> · <a href="../../../index.html">Back to Home</a></div></footer>

{up(nav_js)}

{up(mobile_bar)}
{up(tail_scripts)}
{PAGE_JS}
{up(icon_js)}</body>
</html>
"""
    out = os.path.join(BASE, folder, "index.html")
    open(out, "w", encoding="utf-8", newline="\n").write(page)
    return out, n


if __name__ == "__main__":
    total = 0
    for st in order:
        out, n = build(st)
        total += n
        print(f"{st:20s} {n:3d} packages -> {os.path.relpath(out, BASE)}")
    print(f"{len(order)} state pages, {total} packages")
