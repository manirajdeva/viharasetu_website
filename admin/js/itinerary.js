/**
 * itinerary.js — Itinerary Preparation page.
 * Paste a hand-written itinerary (up to 500 lines) and export it as a branded,
 * customer-ready A4 PDF. Everything runs in the browser with jsPDF; nothing is
 * sent to the API.
 *
 *   ItineraryParser : turns raw text into typed blocks (day heading, section
 *                     heading, bullet, numbered item, "Label: value" line,
 *                     plain text, blank). It only classifies lines — the words
 *                     themselves are never rewritten, reordered or dropped.
 *   ItineraryPdf    : lays the blocks out on A4 pages with the logo top-left on
 *                     every page and "Page X of Y" footers. Text uses the bundled
 *                     Noto Sans (admin/fonts) so ₹, ā, é etc. render; a line with
 *                     glyphs that font lacks (Devanagari, Tamil, emoji …) is
 *                     drawn by the browser onto a canvas and placed as an image.
 *   Itinerary       : the page UI (editor, counters, logo, preview, download).
 */

/* ============================ Parser ============================ */
const ItineraryParser = (() => {
  // "Day 1", "DAY 01", "Day-1", "Day1", "Day 1-3", "Day 1 & 2", "Day 1 to Day 3"
  const DAY_RE = /^day\s*[-–—.]?\s*(\d{1,3})(?:\s*(?:-|–|—|to|&|and|,)\s*(?:day\s*)?\d{1,3})?(?=$|[\s:–—\-.|)(,])/i;
  // "1st Day", "2nd day", "First Day", "Final Day" (the rest of the line decides, as for "Day 1")
  const ORDINALS = 'first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|last|final';
  const ORDINAL_DAY_RE = new RegExp('^(?:\\d{1,3}(?:st|nd|rd|th)|' + ORDINALS + ')\\s*day(?=$|[\\s:–—\\-.|)(,])', 'i');
  // "Day One" … "Day Fifteen"
  const DAY_WORD_RE = /^day\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen)(?=$|[\s:–—\-.|)(,])/i;
  const SEP_RE = /^\s*[:\-–—|.)]+\s*/;
  // Markdown-style emphasis a heading may be wrapped in: "## Day 1", "**Day 1: Goa**"
  const MD_PREFIX_RE = /^(?:#{1,6}\s+|\*\*|__)/;
  const MD_SUFFIX_RE = /(?:\*\*|__)\s*$/;

  const SECTION_WORDS = [
    'overview', 'tour overview', 'trip overview', 'itinerary', 'detailed itinerary', 'day wise itinerary',
    'day-wise itinerary', 'daywise itinerary', 'tour itinerary', 'itinerary details', 'trip summary', 'tour summary',
    'package details', 'tour details', 'stay distribution', 'stay details', 'hotel stay', 'stay plan', 'highlights', 'tour highlights', 'trip highlights', 'package highlights',
    'inclusions', 'exclusions', 'package inclusions', 'package exclusions', 'cost includes', 'cost excludes',
    'what\'s included', 'what\'s not included', 'hotel details', 'hotels', 'accommodation', 'accommodation details',
    'package cost', 'package price', 'cost', 'price', 'pricing', 'tour cost', 'transport', 'transport details',
    'flight details', 'train details', 'meal plan', 'terms and conditions', 'terms & conditions',
    'cancellation policy', 'payment policy', 'payment terms', 'booking policy', 'important notes',
    'important information', 'notes', 'note', 'things to carry', 'contact', 'contact details', 'emergency contacts',
    'transportation', 'transportation details', 'tour ends', 'pricing details', 'package pricing'
  ];
  const LABEL_WORDS = [
    'hotel', 'hotels', 'stay', 'accommodation', 'overnight', 'overnight stay', 'night stay', 'room', 'room type',
    'meals', 'meal', 'meal plan', 'breakfast', 'lunch', 'dinner', 'transfer', 'transfers', 'transport',
    'transportation', 'vehicle', 'cab', 'pickup', 'pick-up', 'pick up', 'drop', 'drop-off', 'drop off',
    'sightseeing', 'activities', 'activity', 'places to visit', 'places covered', 'visit', 'check-in', 'check in',
    'check-out', 'check out', 'flight', 'train', 'bus', 'ferry', 'date', 'dates', 'time', 'timing', 'timings',
    'duration', 'distance', 'travel time', 'drive', 'drive time', 'departure', 'arrival', 'note', 'notes', 'tip',
    'destination', 'location', 'route', 'guide', 'entry', 'entry fee', 'entry fees', 'tickets', 'inclusions',
    'exclusions', 'highlights', 'altitude', 'weather', 'tour ends', 'tour starts', 'duration of tour',
    'travel type', 'transportation', 'accommodation type', 'price', 'cost', 'package cost'
  ];
  const sectionSet = new Set(SECTION_WORDS);
  const labelSet = new Set(LABEL_WORDS);

  // Leading icons people paste in front of lines: emoji, Word/Wingdings bullets
  // (private-use glyphs that show as "□"), arrows, ticks, shapes, or a plain
  // "-", "*", "–" followed by a space. They are treated as list markers, so the
  // same layout comes out whatever bullet style the text used.
  const ICON = '[\\p{So}\\p{Co}\\p{Cn}\\u2022\\u2023\\u2043\\u00B7\\u2190-\\u21FF\\u25A0-\\u25FF\\uFE0F\\u200D\\u20E3\\u{1F3FB}-\\u{1F3FF}]';
  const DECOR_RE = new RegExp('^(?:' + ICON + '+\\s*|[-*–—>]\\s+)+', 'u');
  const NUMBER_RE = /^((?:\d{1,3}|[a-zA-Z]|[ivxIVX]{1,4})[.)])\s+(.*)$/;
  const LABEL_RE = /^([A-Za-z][A-Za-z '&/-]{0,30}?)\s*(:|\s[-–—]\s)\s*(.*)$/;

  /** Leading whitespace → indent level (tab = 4 spaces, 4 spaces = one level, max 4). */
  function indentOf(line) {
    const m = line.match(/^[ \t]*/)[0];
    const spaces = m.replace(/\t/g, '    ').length;
    return Math.min(4, Math.floor(spaces / 4));
  }

  function stripMarkdown(s) {
    if (!MD_PREFIX_RE.test(s) && !MD_SUFFIX_RE.test(s)) return s;
    return s.replace(MD_PREFIX_RE, '').replace(MD_SUFFIX_RE, '').trim();
  }

  /**
   * Is this line a "Day N" heading?
   * Returns { kind: 'heading' } when confident, { kind: 'inline', label, rest }
   * when the line starts with "Day N:" but is really a long paragraph (the
   * "Day N" part becomes the heading and the rest a paragraph under it), or null.
   */
  function matchDay(text) {
    const s = stripMarkdown(text);
    const m = s.match(DAY_RE) || s.match(ORDINAL_DAY_RE) || s.match(DAY_WORD_RE);
    if (!m) return null;
    const after = s.slice(m[0].length);
    if (!after.trim() || /^[\s:\-–—|.)]*$/.test(after)) return { kind: 'heading', text: s };

    const sep = after.match(SEP_RE);
    if (sep) {
      const title = after.slice(sep[0].length);
      const longOrMulti = title.length > 110 || /[.!?]\s+\S/.test(title);
      if (!longOrMulti) return { kind: 'heading', text: s };
      return { kind: 'inline', label: s.slice(0, m[0].length).trim(), rest: title };
    }
    // No separator: "Day 1 Arrival in Goa" — only if the title reads like one.
    const title = after.trim();
    if (/^[\p{Lu}\d(]/u.test(title) && title.length <= 80 && !/[.!?]\s+\S/.test(title)) {
      return { kind: 'heading', text: s };
    }
    return null; // "Day 1 was relaxed…" — ordinary sentence, leave it alone
  }

  /**
   * Is this line a section heading ("Inclusions", "Stay Distribution", …)?
   * `next` is the following non-blank line, used for short Title Case lines:
   * they only count as headings when a list or a day follows them.
   */
  function isSection(text, next) {
    const s = stripMarkdown(text);
    const key = s.replace(/[:\s]+$/, '').toLowerCase();
    if (sectionSet.has(key)) return s;
    if (/^#{1,6}\s+\S/.test(text)) return s; // explicit markdown heading
    // Short ALL-CAPS line such as "HOTEL DETAILS" or "TERMS & CONDITIONS:"
    if (s.length <= 50 && /^[A-Z][A-Z &/'()-]*:?$/.test(s) && /[A-Z]{3}/.test(s) && !/\d/.test(s)) return s;
    // Short Title Case line ("Stay Distribution", "Package Details:") that
    // introduces a list or the day-by-day plan.
    const words = s.replace(/:$/, '').split(/\s+/);
    const titleCase = words.every((w) => /^[\p{Lu}&(]/u.test(w) || (w.length <= 3 && /^\p{Ll}+$/u.test(w)));
    const introduces = /:$/.test(s) || (next && (next.listy || matchDay(next.core)));
    const labelValue = /:\s*\S/.test(s); // "Transportation: Private AC Cab" is a detail, not a title
    if (s.length <= 40 && words.length <= 5 && titleCase && !labelValue && !/[\d.!?,;]/.test(s) && introduces) return s;
    return null;
  }

  /** "Hotel: Taj Exotica" → [{bold 'Hotel:'}, {' Taj Exotica'}] for known labels only. */
  function runsFor(text) {
    const m = text.match(LABEL_RE);
    if (m && m[3] && labelSet.has(m[1].trim().toLowerCase())) {
      const label = text.slice(0, text.length - m[3].length).trimEnd();
      return [{ text: label, bold: true }, { text: ' ' + m[3] }];
    }
    return [{ text }];
  }

  /* Markdown emphasis, as produced by ChatGPT / Notion / WhatsApp-style text. */
  const MD_BOLD_RE = /(\*\*|__)(?=\S)(.*?\S)\1/g;
  const MD_ITALIC_RE = /(^|[\s(])\*(?=\S)([^*]*?\S)\*(?=$|[\s).,;:!?])/g;
  const unemphasise = (s) => s.replace(MD_BOLD_RE, '$2').replace(MD_ITALIC_RE, '$1$2');

  /**
   * Runs for a body line: "**Meals:** Breakfast" → bold "Meals:" + " Breakfast"
   * (markers removed). Lines without markdown bold fall back to known labels.
   */
  function inlineRuns(text) {
    if (!/(\*\*|__)\S/.test(text)) return runsFor(unemphasise(text));
    const runs = [];
    let last = 0;
    for (const m of text.matchAll(MD_BOLD_RE)) {
      if (m.index > last) runs.push({ text: text.slice(last, m.index).replace(MD_ITALIC_RE, '$1$2') });
      runs.push({ text: m[2].replace(MD_ITALIC_RE, '$1$2'), bold: true });
      last = m.index + m[0].length;
    }
    if (last < text.length) runs.push({ text: text.slice(last).replace(MD_ITALIC_RE, '$1$2') });
    return runs.filter((r) => r.text);
  }

  /** One input line → { blank } | { rule } | { indent, text, core, plain, icon, listy }. */
  function describe(original) {
    const line = original.replace(/\s+$/, '');
    if (!line.trim()) return { blank: true };
    const text = line.trim();
    // "---", "***", "___", "====" on their own are dividers.
    if (/^([-_*=])(?:\s*\1){2,}$/.test(text)) return { rule: true };
    const deco = text.match(DECOR_RE);
    // A line made only of symbols ("★★★") is kept exactly as typed.
    const core = deco && deco[0].length < text.length ? text.slice(deco[0].length) : text;
    const icon = core !== text;
    const plain = unemphasise(core);
    return { indent: indentOf(line), text, core, plain, icon, listy: icon || NUMBER_RE.test(core) };
  }

  /**
   * Split text into blocks, in input order. Every word of every line is kept;
   * only leading icons/bullet characters are swapped for the template's own
   * markers, so any bullet or emoji style produces the same layout.
   */
  /** Is `L` a line that starts something new (heading, list item, label line)? */
  function startsBlock(L) {
    if (L.icon || NUMBER_RE.test(L.core) || /^#{1,6}\s/.test(L.core)) return true;
    if (matchDay(L.plain)) return true;
    if (sectionSet.has(L.plain.replace(/[:\s]+$/, '').toLowerCase())) return true;
    return runsFor(L.plain)[0].bold === true; // "Hotel: …", "Meals: …"
  }

  /**
   * Text copied out of a PDF or e-mail arrives hard-wrapped: one sentence is
   * split over several lines. Join a line onto the one above only when it is
   * clearly a continuation:
   *   - it starts in lower case ("… journey with" / "unforgettable memories …"), or
   *   - the line above ends on a comma, "&", "and", "via", "with" … , or
   *   - the line above is a long bullet / "Day N – …" line cut off mid-sentence
   *     and this line has no bullet of its own.
   * One-item-per-line lists (activities, transfers, terms) always stay separate.
   */
  const DANGLING_RE = /(?:[,;&+/]|\s[-–—]|\b(?:and|or|with|via|to|of|the|for|in|at|from|by|on|including|covering|visit|towards))$/i;
  function unwrap(lines) {
    const out = [];
    for (const L of lines) {
      const prev = out[out.length - 1];
      let canJoin = false;
      if (prev && !prev.blank && !prev.rule && !L.blank && !L.rule && !startsBlock(L)) {
        const day = matchDay(prev.plain);
        // A short "Day 1: Arrival" or "Inclusions" line is a title; nothing joins onto it.
        const titleLine = prev.plain.length < 60 && (day || isSection(prev.plain, null));
        const wrappedItem = prev.plain.length >= 60 && !/[.!?:]["')\]]*$/.test(prev.plain) && (prev.icon || day);
        canJoin = !titleLine && (/^\p{Ll}/u.test(L.plain) || DANGLING_RE.test(prev.plain) || wrappedItem);
      }
      if (canJoin) {
        for (const k of ['text', 'core', 'plain']) prev[k] += ' ' + L[k];
      } else out.push(L);
    }
    return out;
  }

  /**
   * Text pasted from WhatsApp, websites, Excel or "fancy text" tools can carry
   * look-alike characters: bold/italic maths letters ("𝟏st Day"), fullwidth
   * characters ("１st Day"), keycap emoji ("1️⃣"), superscript ordinals ("1ˢᵗ")
   * and invisible zero-width characters. They look the same but break heading
   * detection and the PDF font can't draw them, so they become the plain
   * character they stand for. Words and numbers stay exactly the same.
   */
  const LOOKALIKE_RE = /[\u{1D400}-\u{1D7FF}！-～ʰ-ʸˠ-ˤᴬ-ᵪ]/gu;
  function normalizeInput(raw) {
    return String(raw || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[​⁠﻿­]/g, '')            // zero-width space / word joiner / BOM / soft hyphen
      .replace(/([0-9#*])️?⃣/g, '$1')               // keycap 1️⃣ → 1
      // superscript digits only as ordinals ("¹st" → "1st"); "m²" stays as it is
      .replace(/[¹²³⁰⁴-⁹]+(?=(?:st|nd|rd|th|ˢᵗ|ⁿᵈ|ʳᵈ|ᵗʰ)\b)/gu, (d) => d.normalize('NFKC'))
      .replace(LOOKALIKE_RE, (ch) => ch.normalize('NFKC'));
  }

  function parse(raw) {
    const lines = unwrap(normalizeInput(raw).split('\n').map(describe));
    const blocks = [];
    lines.forEach((L, i) => {
      if (L.blank) {
        // Collapse runs of blank lines into one paragraph gap; ignore leading ones.
        if (blocks.length && blocks[blocks.length - 1].type !== 'blank') blocks.push({ type: 'blank' });
        return;
      }
      if (L.rule) {
        if (blocks.length && blocks[blocks.length - 1].type !== 'rule') blocks.push({ type: 'rule' });
        return;
      }
      const { indent, core, plain, icon } = L;

      const day = matchDay(plain);
      if (day && day.kind === 'heading') { blocks.push({ type: 'day', text: day.text }); return; }
      if (day && day.kind === 'inline') {
        blocks.push({ type: 'day', text: day.label });
        blocks.push({ type: 'text', indent: 0, runs: inlineRuns(day.rest) });
        return;
      }
      const next = lines.slice(i + 1).find((n) => !n.blank && !n.rule);
      const section = isSection(plain, next && { listy: next.listy, core: next.plain });
      if (section) { blocks.push({ type: 'section', text: section }); return; }

      if (icon) { blocks.push({ type: 'bullet', indent, marker: '•', runs: inlineRuns(core) }); return; }
      const m = core.match(NUMBER_RE);
      if (m) { blocks.push({ type: 'bullet', indent, marker: m[1], runs: inlineRuns(m[2]) }); return; }

      blocks.push({ type: 'text', indent, runs: inlineRuns(core) });
    });
    // Two or more plain lines right under a section title or a day heading are a
    // list whose bullets were lost (or never typed) — give them the same bullets
    // as a real list, so every itinerary comes out in one layout. The text of
    // each line is untouched; a single paragraph under a day stays a paragraph.
    blocks.forEach((b, i) => {
      if (b.type !== 'section' && b.type !== 'day') return;
      let start = i + 1;
      if (blocks[start] && blocks[start].type === 'blank') start++;
      const isItem = (x) => x && x.type === 'text' && !x.indent && !x.runs[0].bold &&
        x.runs.map((r) => r.text).join('').length <= 300;
      let j = start;
      while (isItem(blocks[j])) j++;
      if (j - start >= 2) {
        for (let k = start; k < j; k++) Object.assign(blocks[k], { type: 'bullet', marker: '•' });
      }
    });
    while (blocks.length && blocks[blocks.length - 1].type === 'blank') blocks.pop();

    // The itinerary's own first line ("4 NIGHTS / 5 DAYS … TOUR PACKAGE",
    // "# GOA 5 DAYS …") becomes the document title — shown once, never invented.
    // A first line that is a known section ("Stay Distribution"), a day, a list
    // item, a label line or a full sentence is left in the body instead.
    let title = '';
    const first = blocks[0];
    const firstText = first && (first.text || (first.runs || []).map((r) => r.text).join(''));
    if (first && blocks.length > 1 && firstText.length <= 120 && !/[.!?:]$/.test(firstText) &&
        ((first.type === 'section' && !sectionSet.has(firstText.toLowerCase())) ||
         (first.type === 'text' && !first.indent && !first.runs.some((r) => r.bold)))) {
      title = firstText;
      blocks.shift();
      while (blocks.length && blocks[0].type === 'blank') blocks.shift();
    }
    return { title, blocks };
  }

  /* ---------- content check ---------- */

  /** Every word and number, in order (punctuation, icons and markdown ignored). */
  const tokensOf = (s) => String(s || '').match(/[\p{L}\p{N}]+/gu) || [];
  const blockText = (b) => [b.text || '', b.marker || '', ...(b.runs || []).map((r) => r.text)].join(' ');

  /**
   * Proof that formatting changed presentation only: the words and numbers in
   * the parsed document must be exactly the words and numbers of the input,
   * in the same order. Returns '' when they match, otherwise a description of
   * the first difference.
   */
  function verify(raw, parsed) {
    const want = tokensOf(normalizeInput(raw));
    const got = tokensOf([parsed.title, ...parsed.blocks.map(blockText)].join(' '));
    const n = Math.min(want.length, got.length);
    for (let i = 0; i < n; i++) {
      if (want[i] !== got[i]) return `expected “${want.slice(i, i + 6).join(' ')}” but found “${got.slice(i, i + 6).join(' ')}”`;
    }
    if (want.length !== got.length) return `the input has ${want.length} words but the document has ${got.length}`;
    return '';
  }

  return { parse, matchDay, verify };
})();

/* ============================ PDF builder ============================ */
const ItineraryPdf = (() => {
  const FONT = 'NotoSans';
  const FONT_FILES = { normal: 'fonts/NotoSans-Regular.ttf', bold: 'fonts/NotoSans-Bold.ttf' };
  const RASTER_FACE = 'ItineraryNotoSans';
  let fontData = null; // { normal: base64, bold: base64 } once loaded

  // Layout in mm (A4 portrait 210 × 297).
  const PAGE_W = 210, PAGE_H = 297;
  const M_X = 18;
  const HEADER_TOP = 10, LOGO_MAX_H = 20, LOGO_MAX_W = 55, HEADER_RULE_Y = 34;
  const CONTENT_TOP = 42; // the bottom depends on how many footer lines there are
  const BODY_PT = 10.5, LINE_H = 5.3;
  const PT = 0.3528; // mm per point
  const INDENT_MM = 6, BULLET_W = 5;

  // Colours picked from the logo (navy lettering, saffron sun).
  const NAVY = [30, 38, 110], SAFFRON = [232, 134, 30], INK = [38, 34, 28], SOFT = [110, 104, 96];
  const TINT = [243, 245, 251], RULE = [218, 222, 236];

  async function loadFonts() {
    if (fontData) return fontData;
    const toB64 = (buf) => {
      const bytes = new Uint8Array(buf);
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(s);
    };
    const get = async (url, weight) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Could not load the PDF font (' + url + ').');
      const buf = await res.arrayBuffer();
      // Also register it with the page so canvas-drawn fallback lines use the
      // same face for their Latin text as the rest of the PDF.
      try {
        const face = new FontFace(RASTER_FACE, buf.slice(0), { weight });
        document.fonts.add(await face.load());
      } catch { /* system fonts are an acceptable fallback */ }
      return toB64(buf);
    };
    const [normal, bold] = await Promise.all([get(FONT_FILES.normal, '400'), get(FONT_FILES.bold, '700')]);
    fontData = { normal, bold };
    return fontData;
  }

  function newDoc(fonts) {
    const ctor = window.jspdf && window.jspdf.jsPDF;
    if (!ctor) throw new Error('PDF library failed to load. Check your connection and reload the page.');
    const doc = new ctor({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    doc.addFileToVFS('NotoSans-Regular.ttf', fonts.normal);
    doc.addFileToVFS('NotoSans-Bold.ttf', fonts.bold);
    doc.addFont('NotoSans-Regular.ttf', FONT, 'normal', 'Identity-H');
    doc.addFont('NotoSans-Bold.ttf', FONT, 'bold', 'Identity-H');
    doc.setFont(FONT, 'normal');
    return doc;
  }

  /** Does the embedded font have a glyph for every character in `s`? */
  function makeCoverage(doc) {
    const maps = ['normal', 'bold'].map((st) => {
      const f = doc.internal.getFont(FONT, st);
      return f && f.metadata && f.metadata.cmap && f.metadata.cmap.unicode && f.metadata.cmap.unicode.codeMap;
    });
    const cache = new Map();
    return (s) => {
      if (cache.has(s)) return cache.get(s);
      let ok = true;
      for (const ch of s) {
        const cp = ch.codePointAt(0);
        if (cp < 0x20 || cp === 0xA0) continue;
        if (!maps[0] || !maps[0][cp] || !maps[1] || !maps[1][cp]) { ok = false; break; }
      }
      cache.set(s, ok);
      return ok;
    };
  }

  /* ---------- text measurement + wrapping with mixed bold/normal runs ---------- */

  function widthOf(doc, text, bold, pt) {
    doc.setFont(FONT, bold ? 'bold' : 'normal');
    return doc.getStringUnitWidth(text) * pt * PT;
  }

  /**
   * Word-wrap runs into lines of segments that fit `maxW`. Words wider than a
   * whole line (URLs, long hotel names without spaces) are broken by character.
   */
  function wrapRuns(doc, runs, maxW, pt) {
    const tokens = [];
    runs.forEach((r) => (r.text.match(/\s+|[^\s]+/g) || []).forEach((t) => tokens.push({ text: t, bold: !!r.bold })));
    const lines = [];
    let cur = [], curW = 0;
    const push = (seg, w) => {
      const last = cur[cur.length - 1];
      if (last && last.bold === seg.bold) last.text += seg.text; else cur.push({ text: seg.text, bold: seg.bold });
      curW += w;
    };
    const flush = () => {
      // Trailing spaces never render; trim so the next line starts clean.
      if (cur.length) cur[cur.length - 1].text = cur[cur.length - 1].text.replace(/\s+$/, '');
      lines.push(cur.filter((s) => s.text));
      cur = []; curW = 0;
    };
    for (const tok of tokens) {
      const isSpace = /^\s+$/.test(tok.text);
      if (isSpace) { if (cur.length) push({ text: ' ', bold: tok.bold }, widthOf(doc, ' ', tok.bold, pt)); continue; }
      let w = widthOf(doc, tok.text, tok.bold, pt);
      if (curW + w <= maxW) { push(tok, w); continue; }
      if (cur.length) flush();
      if (w <= maxW) { push(tok, w); continue; }
      // Hard-break an over-long word.
      let piece = '';
      for (const ch of tok.text) {
        const cw = widthOf(doc, piece + ch, tok.bold, pt);
        if (cw > maxW && piece) { push({ text: piece, bold: tok.bold }, widthOf(doc, piece, tok.bold, pt)); flush(); piece = ch; }
        else piece += ch;
      }
      if (piece) { w = widthOf(doc, piece, tok.bold, pt); push({ text: piece, bold: tok.bold }, w); }
    }
    if (cur.length || !lines.length) flush();
    return lines;
  }

  /* ---------- canvas fallback for scripts Noto Sans (Latin) doesn't cover ---------- */

  const RASTER_SCALE = 4; // px per pt → crisp at print resolution
  const RASTER_FONT = '"' + RASTER_FACE + '","Nirmala UI", "Noto Sans Devanagari", "Noto Sans Tamil", "Noto Sans Telugu", "Noto Sans Kannada", "Noto Sans Malayalam", "Noto Sans Bengali", "Mangal", "Segoe UI", "Segoe UI Emoji", sans-serif';

  /** Wrap + draw `text` with the browser's own shaping; returns one PNG per line. */
  function rasterLines(text, maxW, pt, bold, color) {
    const px = pt * RASTER_SCALE;
    const pxPerMm = px / (pt * PT);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = `${bold ? 700 : 400} ${px}px ${RASTER_FONT}`;
    ctx.font = font;
    const maxPx = maxW * pxPerMm;
    const words = text.split(/(\s+)/);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const next = cur + w;
      if (ctx.measureText(next.trimEnd()).width <= maxPx || !cur.trim()) { cur = next; continue; }
      lines.push(cur.trimEnd()); cur = w.trimStart();
    }
    if (cur.trim()) lines.push(cur.trimEnd());
    // Break any line that is still too wide (no spaces) by character.
    const out = [];
    lines.forEach((l) => {
      if (ctx.measureText(l).width <= maxPx) return out.push(l);
      let piece = '';
      for (const ch of l) {
        if (ctx.measureText(piece + ch).width > maxPx && piece) { out.push(piece); piece = ch; } else piece += ch;
      }
      if (piece) out.push(piece);
    });
    const lineHpx = Math.ceil(px * 1.5);
    return out.map((l) => {
      const wpx = Math.max(1, Math.ceil(ctx.measureText(l).width) + 4);
      canvas.width = wpx; canvas.height = lineHpx;
      ctx.font = font; // resizing a canvas resets its state
      ctx.fillStyle = `rgb(${color.join(',')})`;
      ctx.textBaseline = 'middle';
      ctx.fillText(l, 0, lineHpx / 2);
      return { data: canvas.toDataURL('image/png'), w: wpx / pxPerMm, h: lineHpx / pxPerMm };
    });
  }

  /* ---------- page chrome ---------- */

  function drawHeader(doc, opts) {
    const { logo } = opts;
    if (logo) {
      let h = LOGO_MAX_H, w = h * (logo.w / logo.h);
      if (w > LOGO_MAX_W) { w = LOGO_MAX_W; h = w * (logo.h / logo.w); }
      doc.addImage(logo.dataUrl, logo.format, M_X, HEADER_TOP + (LOGO_MAX_H - h) / 2, w, h, 'logo' + (logo.id || 0), 'FAST');
    }
    doc.setDrawColor(...SAFFRON); doc.setLineWidth(0.6);
    doc.line(M_X, HEADER_RULE_Y, M_X + 24, HEADER_RULE_Y);
    doc.setDrawColor(...RULE); doc.setLineWidth(0.3);
    doc.line(M_X + 24, HEADER_RULE_Y, PAGE_W - M_X, HEADER_RULE_Y);
  }

  /* ---------- footer ---------- */

  const FOOT_BOTTOM = PAGE_H - 9, FOOT_LH = 3.9, PAGENO_W = 26;
  // Phone numbers, e-mail addresses and web links in the footer become clickable.
  const LINK_RE = /(\+?\d[\d -]{8,}\d)|([\w.+-]+@[\w-]+(?:\.[\w-]+)+)|((?:https?:\/\/|www\.)[^\s·|,]+|(?:linkedin|instagram|facebook|youtube)\.com\/[^\s·|,]+)/gi;

  /**
   * Lay out the footer once: the first line (business name) bold, the rest as
   * contact lines, each wrapped to the page. Returns the lines and the y where
   * body content must stop.
   */
  function layoutFooter(doc, footerText, covered) {
    const src = String(footerText || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 4);
    const lines = [];
    src.forEach((text, i) => {
      const bold = i === 0, pt = bold ? 8.5 : 8;
      const maxW = PAGE_W - 2 * M_X - (lines.length === 0 ? PAGENO_W : 0);
      if (!covered(text)) { lines.push({ text, bold, pt, raster: true, maxW }); return; }
      doc.setFont(FONT, bold ? 'bold' : 'normal'); doc.setFontSize(pt);
      doc.splitTextToSize(text, maxW).forEach((t) => lines.push({ text: t, bold, pt, maxW }));
    });
    const count = Math.max(1, lines.length);
    const firstBaseline = FOOT_BOTTOM - (count - 1) * FOOT_LH;
    return { lines, firstBaseline, ruleY: firstBaseline - 4.5, contentBottom: firstBaseline - 7.5 };
  }

  function drawFooters(doc, foot) {
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setDrawColor(...RULE); doc.setLineWidth(0.3);
      doc.line(M_X, foot.ruleY, PAGE_W - M_X, foot.ruleY);
      foot.lines.forEach((l, k) => {
        const y = foot.firstBaseline + k * FOOT_LH;
        const color = l.bold ? NAVY : SOFT;
        if (l.raster) {
          const img = rasterLines(l.text, l.maxW, l.pt, l.bold, color)[0];
          if (img) doc.addImage(img.data, 'PNG', M_X, y - img.h * 0.68, img.w, img.h);
          return;
        }
        doc.setFont(FONT, l.bold ? 'bold' : 'normal'); doc.setFontSize(l.pt); doc.setTextColor(...color);
        doc.text(l.text, M_X, y);
        for (const m of l.text.matchAll(LINK_RE)) {
          const v = m[0];
          const url = m[1] ? 'tel:' + v.replace(/[^\d+]/g, '') : m[2] ? 'mailto:' + v : (/^https?:/i.test(v) ? v : 'https://' + v);
          const x = M_X + widthOf(doc, l.text.slice(0, m.index), l.bold, l.pt);
          doc.link(x, y - l.pt * PT, widthOf(doc, v, l.bold, l.pt), l.pt * PT * 1.3, { url });
        }
      });
      doc.setFont(FONT, 'normal'); doc.setFontSize(8.5); doc.setTextColor(...SOFT);
      doc.text(`Page ${i} of ${n}`, PAGE_W - M_X, foot.firstBaseline, { align: 'right' });
    }
  }

  /* ---------- main entry ---------- */

  /**
   * Build the PDF. opts: { text, customer, footer, logo:{dataUrl,format,w,h}|null }
   * The title comes from the itinerary itself. Returns the jsPDF document.
   */
  async function build(opts) {
    const parsed = ItineraryParser.parse(opts.text);
    const mismatch = ItineraryParser.verify(opts.text, parsed);
    if (mismatch) throw new Error('Formatting stopped: the document would not match your text exactly (' + mismatch + ').');
    const blocks = parsed.blocks;
    opts = Object.assign({}, opts, {
      title: parsed.title,
      subtitle: opts.customer ? 'Prepared for: ' + opts.customer : ''
    });
    const fonts = await loadFonts();
    const doc = newDoc(fonts);
    const covered = makeCoverage(doc);
    const contentW = PAGE_W - 2 * M_X;
    const foot = layoutFooter(doc, opts.footer, covered);
    const CONTENT_BOTTOM = foot.contentBottom;
    let y = CONTENT_TOP;

    const newPage = () => { doc.addPage(); drawHeader(doc, opts); y = CONTENT_TOP; };
    const ensure = (h) => { if (y + h > CONTENT_BOTTOM && y > CONTENT_TOP) newPage(); };

    drawHeader(doc, opts);

    // Title block on page 1.
    if (opts.title) {
      // Long package names ("4 NIGHTS / 5 DAYS BANGALORE, MYSORE & OOTY TOUR PACKAGE") get a smaller size.
      const pt = opts.title.length > 45 ? 16 : 20;
      doc.setFont(FONT, 'bold'); doc.setFontSize(pt); doc.setTextColor(...NAVY);
      const tl = doc.splitTextToSize(opts.title, contentW);
      if (covered(opts.title)) { doc.text(tl, M_X, y + pt * 0.2); y += tl.length * pt * 0.4 + 1; }
      else { y = placeRaster(opts.title, M_X, y, contentW, pt, true, NAVY) + 1; }
    }
    if (opts.subtitle) {
      doc.setFont(FONT, 'normal'); doc.setFontSize(11.5); doc.setTextColor(...SOFT);
      if (covered(opts.subtitle)) {
        const sl = doc.splitTextToSize(opts.subtitle, contentW);
        doc.text(sl, M_X, y + 3.5); y += sl.length * 5.5 + 1;
      } else { y = placeRaster(opts.subtitle, M_X, y, contentW, 11.5, false, SOFT); }
    }
    if (opts.title || opts.subtitle) y += 5;

    function placeRaster(text, x, yy, w, pt, bold, color) {
      rasterLines(text, w, pt, bold, color).forEach((img) => {
        if (yy + img.h > CONTENT_BOTTOM && yy > CONTENT_TOP) { newPage(); yy = y; }
        doc.addImage(img.data, 'PNG', x, yy, img.w, img.h);
        yy += img.h;
      });
      y = yy;
      return yy;
    }

    /** Draw wrapped runs; lines may flow onto the next page one at a time. */
    function drawRuns(runs, x, w, pt, lineH, color, keepLines) {
      const plain = runs.map((r) => r.text).join('');
      if (!covered(plain)) {
        const lines = rasterLines(plain, w, pt, runs.every((r) => r.bold), color);
        const total = lines.reduce((s, l) => s + l.h, 0);
        if (lines.length <= keepLines) ensure(total);
        lines.forEach((img) => { ensure(img.h); doc.addImage(img.data, 'PNG', x, y, img.w, img.h); y += img.h; });
        return;
      }
      const lines = wrapRuns(doc, runs, w, pt);
      if (lines.length <= keepLines) ensure(lines.length * lineH); // short paragraph: keep it together
      doc.setFontSize(pt); doc.setTextColor(...color);
      lines.forEach((segs) => {
        ensure(lineH);
        let cx = x;
        const baseline = y + lineH * 0.72;
        segs.forEach((seg) => {
          doc.setFont(FONT, seg.bold ? 'bold' : 'normal');
          doc.text(seg.text, cx, baseline);
          cx += widthOf(doc, seg.text, seg.bold, pt);
        });
        y += lineH;
      });
    }

    blocks.forEach((b, i) => {
      if (b.type === 'blank') { if (y > CONTENT_TOP) y += 2.6; return; }

      if (b.type === 'rule') {
        if (y <= CONTENT_TOP) return; // never start a page with a divider
        ensure(6);
        y += 2.5;
        doc.setDrawColor(...RULE); doc.setLineWidth(0.3);
        doc.line(M_X, y, PAGE_W - M_X, y);
        y += 3;
        return;
      }

      if (b.type === 'day') {
        const pt = 12.5, padY = 2.4, lineH = 6;
        const lines = covered(b.text) ? wrapRuns(doc, [{ text: b.text, bold: true }], contentW - 8, pt) : null;
        const bandH = (lines ? lines.length * lineH : rasterLines(b.text, contentW - 8, pt, true, NAVY).reduce((s, l) => s + l.h, 0)) + padY * 2;
        if (y > CONTENT_TOP) y += 3;
        ensure(bandH + LINE_H * 2 + 2); // never strand a day heading at the foot of a page
        doc.setFillColor(...TINT); doc.rect(M_X, y, contentW, bandH, 'F');
        doc.setFillColor(...SAFFRON); doc.rect(M_X, y, 1.4, bandH, 'F');
        const top = y;
        y += padY;
        if (lines) {
          doc.setFont(FONT, 'bold'); doc.setFontSize(pt); doc.setTextColor(...NAVY);
          lines.forEach((segs) => { doc.text(segs.map((s) => s.text).join(''), M_X + 5, y + lineH * 0.72); y += lineH; });
        } else {
          rasterLines(b.text, contentW - 8, pt, true, NAVY).forEach((img) => { doc.addImage(img.data, 'PNG', M_X + 5, y, img.w, img.h); y += img.h; });
        }
        y = top + bandH + 2.5;
        return;
      }

      if (b.type === 'section') {
        const pt = 11.5;
        if (y > CONTENT_TOP) y += 2.5;
        ensure(6 + LINE_H * 2);
        drawRuns([{ text: b.text, bold: true }], M_X, contentW, pt, 5.8, NAVY, 99);
        doc.setDrawColor(...SAFFRON); doc.setLineWidth(0.4);
        doc.line(M_X, y + 0.3, M_X + 14, y + 0.3);
        y += 2.2;
        return;
      }

      const x = M_X + (b.indent || 0) * INDENT_MM;
      if (b.type === 'bullet') {
        const markerW = Math.max(BULLET_W, widthOf(doc, b.marker, false, BODY_PT) + 2);
        const w = contentW - (x - M_X) - markerW;
        const plainText = b.runs.map((r) => r.text).join('');
        // Keep short items whole and long ones at least two lines deep, so the
        // marker never sits alone at the foot of a page.
        const n = covered(plainText) ? wrapRuns(doc, b.runs, w, BODY_PT).length : 1;
        ensure(LINE_H * (n <= 3 ? n : 2));
        doc.setFont(FONT, 'normal'); doc.setFontSize(BODY_PT);
        doc.setTextColor(...(b.marker === '•' ? SAFFRON : INK));
        doc.text(b.marker, x + (b.marker === '•' ? 1 : 0), y + LINE_H * 0.72);
        drawRuns(b.runs, x + markerW, w, BODY_PT, LINE_H, INK, 0);
        y += 0.6;
        return;
      }

      drawRuns(b.runs, x, contentW - (x - M_X), BODY_PT, LINE_H, INK, 3);
      // Lines that sit directly together in the input stay tight; a small
      // breathing gap is added only where the input had a blank line.
      if (blocks[i + 1] && blocks[i + 1].type !== 'blank') y += 0.4;
    });

    drawFooters(doc, foot);
    doc.setProperties({ title: opts.title || opts.customer || 'Itinerary', creator: 'Viharasetu Admin Portal' });
    return doc;
  }

  return { build, loadFonts };
})();

/* ============================ Page ============================ */
const Itinerary = (() => {
  const MAX_LINES = 500;
  const MAX_CHARS = 60000;
  const DEFAULT_LOGO = '../images/new_Logo.jpg';
  const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
  const LOGO_MAX_BYTES = 2 * 1024 * 1024;
  // Contact details as published on the public site (index.html footer / Contact Us).
  const DEFAULTS = {
    footer: [
      'Viharasetu  ·  From Aastha to Eternal Anubhav',
      'Call / WhatsApp: +91 98851 80515  ·  Email: viharasetu@gmail.com  ·  Web: www.viharasetu.co.in',
      'Instagram: instagram.com/viharasetu  ·  LinkedIn: linkedin.com/company/viharasetu'
    ].join('\n')
  };

  let logoSeq = 0;
  const root = () => document.getElementById('view-itinerary');
  const $ = (sel) => root().querySelector(sel);
  const state = {
    logo: null,          // { dataUrl, format, w, h, source: 'default' | 'upload', name }
    defaultLogo: null,   // cached processed default logo (or false if it failed to load)
    previewUrl: null,
    previewOpen: false,
    busy: false,
    queued: false,
    lastLookup: ''      // enquiry ID whose name is currently filled in
  };

  /* ---------- logo handling ---------- */

  /**
   * Decode an image, trim plain white / transparent margins (so the mark is
   * not tiny in the header), cap its size and re-encode through a canvas.
   * Re-encoding means only pixels — never the uploaded file's bytes — reach
   * the page or the PDF. Aspect ratio is preserved exactly.
   */
  function processLogo(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const W = img.naturalWidth, H = img.naturalHeight;
          if (!W || !H) return reject(new Error('That image has no size.'));
          if (W < 16 || H < 16) return reject(new Error('That image is too small to use as a logo.'));
          if (W > 10000 || H > 10000) return reject(new Error('That image is too large (max 10000 px per side).'));
          const c = document.createElement('canvas');
          c.width = W; c.height = H;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const px = ctx.getImageData(0, 0, W, H).data;
          let x0 = W, y0 = H, x1 = -1, y1 = -1, alpha = false;
          for (let yy = 0; yy < H; yy++) {
            for (let xx = 0; xx < W; xx++) {
              const k = (yy * W + xx) * 4;
              const a = px[k + 3];
              if (a < 250) alpha = true;
              if (a < 12 || (px[k] > 244 && px[k + 1] > 244 && px[k + 2] > 244)) continue;
              if (xx < x0) x0 = xx; if (xx > x1) x1 = xx;
              if (yy < y0) y0 = yy; if (yy > y1) y1 = yy;
            }
          }
          if (x1 < 0) return reject(new Error('That image looks blank.'));
          const pad = Math.round(Math.max(W, H) * 0.01);
          x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
          x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
          const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
          const scale = Math.min(1, 800 / Math.max(cw, ch));
          const out = document.createElement('canvas');
          out.width = Math.round(cw * scale); out.height = Math.round(ch * scale);
          const octx = out.getContext('2d');
          if (!alpha) { octx.fillStyle = '#fff'; octx.fillRect(0, 0, out.width, out.height); }
          octx.imageSmoothingQuality = 'high';
          octx.drawImage(c, x0, y0, cw, ch, 0, 0, out.width, out.height);
          const format = alpha ? 'PNG' : 'JPEG';
          resolve({
            id: ++logoSeq, // unique image alias: jsPDF reuses images that share an alias
            dataUrl: out.toDataURL(alpha ? 'image/png' : 'image/jpeg', 0.92),
            format, w: out.width, h: out.height
          });
        } catch (err) { reject(new Error('Could not read that image.')); }
      };
      img.onerror = () => reject(new Error('That file is not a valid image.'));
      img.src = src;
    });
  }

  async function loadDefaultLogo() {
    if (state.defaultLogo !== null) return state.defaultLogo;
    try {
      state.defaultLogo = Object.assign(await processLogo(DEFAULT_LOGO), { source: 'default', name: 'Viharasetu logo' });
    } catch {
      state.defaultLogo = false;
    }
    return state.defaultLogo;
  }

  async function onLogoFile(file) {
    const input = $('#it-logo-file');
    try {
      if (!file) return;
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      if (!LOGO_TYPES.includes(file.type) || !['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
        throw new Error('Please choose a PNG, JPG or WebP image.');
      }
      if (file.size > LOGO_MAX_BYTES) throw new Error('Logo must be 2 MB or smaller.');
      const url = URL.createObjectURL(file);
      try {
        state.logo = Object.assign(await processLogo(url), { source: 'upload', name: file.name });
      } finally { URL.revokeObjectURL(url); }
      Utils.success('Logo updated.');
      drawLogo();
      contentChanged();
    } catch (err) {
      Utils.error(err.message);
    } finally {
      input.value = '';
    }
  }

  function drawLogo() {
    const box = $('#it-logo-box');
    const useDefault = $('#it-logo-default');
    if (state.logo) {
      box.innerHTML = '';
      const img = document.createElement('img');
      img.src = state.logo.dataUrl;
      img.alt = 'Logo used in the PDF';
      box.appendChild(img);
    } else {
      box.innerHTML = '<span class="muted">No logo found — upload one, or the PDF is made without a logo.</span>';
    }
    $('#it-logo-name').textContent = state.logo
      ? (state.logo.source === 'default' ? 'Using the Viharasetu logo from the website.' : 'Using uploaded logo: ' + state.logo.name)
      : '';
    useDefault.hidden = !(state.logo && state.logo.source === 'upload' && state.defaultLogo);
  }

  /* ---------- input + counters ---------- */

  const text = () => $('#it-text').value;
  const lineCount = (t) => (t ? t.replace(/\r\n?/g, '\n').split('\n').length : 0);

  function validate() {
    const t = text();
    if (!t.trim()) return 'Paste an itinerary to get started.';
    if (lineCount(t) > MAX_LINES) return `The itinerary has more than ${MAX_LINES} lines. Please shorten it.`;
    if (t.length > MAX_CHARS) return `The itinerary is longer than ${MAX_CHARS.toLocaleString('en-IN')} characters. Please shorten it.`;
    return '';
  }

  function updateCounts() {
    const t = text();
    const lines = lineCount(t), chars = t.length;
    const el = $('#it-counts');
    el.innerHTML = `<span class="${lines > MAX_LINES ? 'over' : ''}">${lines} / ${MAX_LINES} lines</span>` +
      `<span class="${chars > MAX_CHARS ? 'over' : ''}">${chars.toLocaleString('en-IN')} / ${MAX_CHARS.toLocaleString('en-IN')} characters</span>`;
    const problem = validate();
    const empty = !t.trim();
    $('#it-preview').disabled = !!problem || state.busy;
    $('#it-download').disabled = !!problem || state.busy;
    $('#it-clear').disabled = !t;
    const msg = $('#it-msg');
    msg.textContent = empty ? '' : problem;
    msg.hidden = empty || !problem;
  }

  const options = () => ({
    text: text(),
    customer: $('#it-customer').value.trim(),
    footer: $('#it-footer').value.trim(),
    logo: state.logo
  });

  /** "goa-5-days-4-nights-travel-itinerary-satya-kumar.pdf" from the itinerary's title and the customer. */
  function fileName() {
    const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-');
    const title = slug(ItineraryParser.parse(text()).title).slice(0, 60);
    const who = slug($('#it-customer').value).slice(0, 30) || slug($('#it-enquiry').value);
    const base = [title, who].filter(Boolean).join('-') || 'itinerary';
    return (base.includes('itinerary') ? base : 'itinerary-' + base) + '.pdf';
  }

  /* ---------- enquiry lookup ---------- */

  /** "SATYA kumar" → "Satya Kumar": first letter of every word capital, the rest small. */
  const titleCase = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase()
    .replace(/(^|[\s\-'.(])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

  /** Find the enquiry for the typed ID and fill the customer name from it. */
  async function lookupEnquiry() {
    const input = $('#it-enquiry'), hint = $('#it-enquiry-hint');
    const id = input.value.trim().toUpperCase();
    if (id !== input.value) input.value = id;
    hint.classList.remove('err');
    if (!id) { hint.textContent = ''; return; }
    if (state.lastLookup === id) return;
    hint.textContent = 'Looking up…';
    try {
      const find = (rows) => rows.find((r) => String(r['Enquiry ID'] || '').trim().toUpperCase() === id);
      let row = find((await Data.fetch('enquiries')).rows);
      if (!row) row = find((await Data.fetch('enquiries', true)).rows); // created since the cache was filled?
      if ($('#it-enquiry').value.trim().toUpperCase() !== id) return; // typed on meanwhile
      if (!row) {
        state.lastLookup = '';
        hint.textContent = 'No enquiry found with this ID.';
        hint.classList.add('err');
        return;
      }
      state.lastLookup = id;
      const name = titleCase(row['Name']);
      $('#it-customer').value = name;
      hint.textContent = name
        ? `Customer: ${name}${row['Destination'] ? ' · ' + row['Destination'] : ''}`
        : 'This enquiry has no customer name.';
      contentChanged();
    } catch (err) {
      state.lastLookup = '';
      hint.textContent = err.message || 'Could not look up the enquiry.';
      hint.classList.add('err');
    }
  }

  /* ---------- generate ---------- */

  function setBusy(on, label) {
    state.busy = on;
    $('#it-status').textContent = on ? (label || 'Generating PDF…') : '';
    updateCounts();
  }

  async function generate() {
    const problem = validate();
    if (problem) throw new Error(problem);
    return ItineraryPdf.build(options());
  }

  async function preview() {
    if (state.busy) { state.queued = true; return; }
    setBusy(true, 'Generating preview…');
    try {
      const doc = await generate();
      if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
      state.previewUrl = URL.createObjectURL(doc.output('blob'));
      state.previewOpen = true;
      $('#it-preview-card').hidden = false;
      $('#it-frame').src = state.previewUrl;
      $('#it-open').href = state.previewUrl;
      $('#it-pages').textContent = `${doc.getNumberOfPages()} page${doc.getNumberOfPages() === 1 ? '' : 's'}`;
      $('#it-stale').hidden = true;
    } catch (err) {
      Utils.error(err.message || 'Could not generate the preview.');
    } finally {
      setBusy(false);
      if (state.queued) { state.queued = false; if (state.previewOpen && !validate()) preview(); }
    }
  }

  async function download() {
    if (state.busy) return;
    setBusy(true, 'Generating PDF…');
    try {
      const doc = await generate();
      doc.save(fileName());
      Utils.success('PDF downloaded.');
    } catch (err) {
      Utils.error(err.message || 'Could not generate the PDF.');
    } finally { setBusy(false); }
  }

  function hidePreview() {
    state.previewOpen = false;
    $('#it-preview-card').hidden = true;
    $('#it-frame').removeAttribute('src');
    if (state.previewUrl) { URL.revokeObjectURL(state.previewUrl); state.previewUrl = null; }
  }

  // Keep an open preview in sync with edits (debounced so typing stays smooth).
  const refreshPreview = Utils.debounce(() => { if (state.previewOpen && !validate()) preview(); }, 900);
  function contentChanged() {
    updateCounts();
    if (!state.previewOpen) return;
    if (validate()) { $('#it-stale').hidden = false; return; }
    $('#it-stale').hidden = false;
    refreshPreview();
  }

  /* ---------- clear / reset ---------- */

  async function clear() {
    if (!text()) return;
    const ok = await Utils.confirmDialog({ title: 'Clear itinerary?', text: 'This removes the itinerary text you entered.', confirmText: 'Clear', danger: true });
    if (!ok) return;
    $('#it-text').value = '';
    hidePreview();
    updateCounts();
    $('#it-text').focus();
  }

  async function reset() {
    const changed = text() || $('#it-enquiry').value || $('#it-customer').value ||
      $('#it-footer').value !== DEFAULTS.footer || (state.logo && state.logo.source === 'upload');
    if (changed) {
      const ok = await Utils.confirmDialog({ title: 'Reset the form?', text: 'This clears the itinerary text, enquiry and customer name, and restores the default footer and logo.', confirmText: 'Reset', danger: true });
      if (!ok) return;
    }
    $('#it-text').value = '';
    $('#it-enquiry').value = '';
    $('#it-customer').value = '';
    $('#it-enquiry-hint').textContent = '';
    state.lastLookup = '';
    $('#it-footer').value = DEFAULTS.footer;
    state.logo = state.defaultLogo || null;
    drawLogo();
    hidePreview();
    updateCounts();
  }

  /* ---------- layout ---------- */

  function shell() {
    root().innerHTML = `
      <div class="card">
        <div class="section-title">Itinerary content</div>
        <div class="section-sub">Paste or type the itinerary exactly as you want the customer to read it. Lines starting with
          <b>Day 1</b>, <b>DAY 02</b>, <b>Day-3:</b> … become bold day headings; bullets, numbering, “Hotel:” / “Meals:” lines and blank-line
          paragraphs are kept. Text from Word, WhatsApp, PDFs or ChatGPT (Markdown) all comes out in the same layout.
          The first line (e.g. “4 NIGHTS / 5 DAYS … TOUR PACKAGE”) is used as the title. Your wording is never changed —
          the PDF is only made when it contains exactly your words, in your order.</div>
        <div class="itin-meta form-grid">
          <div class="field">
            <label for="it-enquiry">Enquiry ID <span class="muted">(optional)</span></label>
            <input id="it-enquiry" type="text" maxlength="40" list="enquiryIdList" autocomplete="off" placeholder="e.g. VH-20261011-01" />
            <div class="hint" id="it-enquiry-hint"></div>
            <div class="hint">For your reference only — fills the customer name; not printed on the PDF.</div>
          </div>
          <div class="field">
            <label for="it-customer">Customer name</label>
            <input id="it-customer" type="text" maxlength="120" placeholder="Filled from the enquiry, or type it" />
            <div class="hint">Shown on the PDF as “Prepared for”.</div>
          </div>
        </div>
        <div class="field">
          <label for="it-text">Itinerary</label>
          <textarea id="it-text" class="itin-text" spellcheck="true" maxlength="${MAX_CHARS + 5000}"
            placeholder="Paste your itinerary here. Supports up to ${MAX_LINES} lines…&#10;&#10;Day 1: Arrival in Goa&#10;- Pickup from Dabolim Airport&#10;Hotel: Taj Fort Aguada&#10;&#10;Day 2 – North Goa Sightseeing&#10;…"></textarea>
          <div class="itin-foot">
            <div class="itin-counts" id="it-counts"></div>
            <div class="itin-msg" id="it-msg" hidden></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="section-title">Branding</div>
        <div class="section-sub">Shown at the top-left of every page. PNG, JPG or WebP, up to 2 MB.</div>
        <div class="itin-brand">
          <div class="itin-logo" id="it-logo-box"><span class="muted">Loading logo…</span></div>
          <div class="itin-brand-side">
            <div class="itin-logo-name muted" id="it-logo-name"></div>
            <div class="grp" style="display:flex;gap:10px;flex-wrap:wrap;">
              <label class="btn sm" for="it-logo-file" style="margin:0">Replace logo…</label>
              <input id="it-logo-file" type="file" accept="image/png,image/jpeg,image/webp" hidden />
              <button class="btn sm" id="it-logo-default" hidden>Use Viharasetu logo</button>
            </div>
            <div class="field" style="margin-top:14px;">
              <label for="it-footer">Footer (every page)</label>
              <textarea id="it-footer" rows="3" maxlength="400">${Utils.escapeHtml(DEFAULTS.footer)}</textarea>
              <div class="hint">Up to 4 lines. The first line is shown in bold; phone numbers, e-mail and web links are clickable in the PDF.</div>
            </div>
          </div>
        </div>
      </div>

      <div class="card itin-actions">
        <div class="grp">
          <button class="btn primary" id="it-preview" disabled>👁 Preview PDF</button>
          <button class="btn" id="it-download" disabled>⬇ Download PDF</button>
          <button class="btn danger" id="it-clear" disabled>Clear</button>
          <button class="btn" id="it-reset">Reset</button>
        </div>
        <span class="itin-status" id="it-status" aria-live="polite"></span>
      </div>

      <div class="card" id="it-preview-card" hidden>
        <div class="toolbar">
          <div>
            <div class="section-title">Preview</div>
            <div class="section-sub" style="margin:0"><span id="it-pages"></span> · A4 · identical to the downloaded file
              <span class="itin-stale" id="it-stale" hidden>· updating…</span></div>
          </div>
          <div class="grp">
            <a class="btn sm" id="it-open" target="_blank" rel="noopener">Open in new tab</a>
            <button class="btn sm" id="it-back">← Back to editing</button>
          </div>
        </div>
        <iframe class="itin-frame" id="it-frame" title="Itinerary PDF preview"></iframe>
      </div>`;

    $('#it-text').addEventListener('input', contentChanged);
    ['#it-customer', '#it-footer'].forEach((s) => $(s).addEventListener('input', contentChanged));
    // Look the enquiry up when an ID is picked from the list, typed and left, or Enter is pressed.
    const lookupSoon = Utils.debounce(lookupEnquiry, 600);
    $('#it-enquiry').addEventListener('input', () => { state.lastLookup = ''; lookupSoon(); contentChanged(); });
    $('#it-enquiry').addEventListener('change', lookupEnquiry);
    $('#it-enquiry').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); lookupEnquiry(); } });
    $('#it-customer').addEventListener('blur', () => { const el = $('#it-customer'); const v = titleCase(el.value); if (v !== el.value) { el.value = v; contentChanged(); } });
    $('#it-logo-file').addEventListener('change', (e) => onLogoFile(e.target.files && e.target.files[0]));
    $('#it-logo-default').addEventListener('click', () => { state.logo = state.defaultLogo || null; drawLogo(); contentChanged(); });
    $('#it-preview').addEventListener('click', preview);
    $('#it-download').addEventListener('click', download);
    $('#it-clear').addEventListener('click', clear);
    $('#it-reset').addEventListener('click', reset);
    $('#it-back').addEventListener('click', () => {
      hidePreview();
      $('#it-text').scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('#it-text').focus({ preventScroll: true });
    });

    updateCounts();
    loadDefaultLogo().then((logo) => { if (!state.logo) state.logo = logo || null; drawLogo(); });
    ItineraryPdf.loadFonts().catch(() => {}); // warm the font cache; errors surface on generate
    if (typeof ensureEnquiryIds === 'function') ensureEnquiryIds(); // suggestions for the Enquiry ID field
  }

  function load() {
    if (!root().firstElementChild) shell();
  }

  return { load };
})();

App.onView('itinerary', () => Itinerary.load());
