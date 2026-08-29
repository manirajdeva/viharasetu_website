/**
 * ids.js
 * Auto-generated identifiers, matching the old Apps Script formats exactly:
 *
 *   Enquiry ID : VH-YYYYMMDD-NN   (date in Asia/Kolkata + a same-day sequence)
 *   Payment ID : PMT-000001       (plain running number)
 *
 * Both are minted from the `counters` table with an atomic
 * INSERT ... ON DUPLICATE KEY UPDATE value = value + 1, and MUST be called
 * with a transaction-scoped connection so the bump and the row insert commit
 * together.
 */

/** yyyymmdd for "now" in Asia/Kolkata (the deploy timezone in appsscript.json). */
function ymdKolkata(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const o = {};
  for (const p of parts) o[p.type] = p.value;
  return `${o.year}${o.month}${o.day}`;
}

async function bumpCounter(conn, name) {
  await conn.query(
    'INSERT INTO counters (name, value) VALUES (?, 1) ON DUPLICATE KEY UPDATE value = value + 1',
    [name],
  );
  const [rows] = await conn.query('SELECT value FROM counters WHERE name = ?', [name]);
  return Number(rows[0].value);
}

async function nextEnquiryId(conn) {
  const ymd = ymdKolkata();
  const seq = await bumpCounter(conn, `ENQ:${ymd}`);
  return `VH-${ymd}-${String(seq).padStart(2, '0')}`;
}

async function nextPaymentId(conn) {
  const seq = await bumpCounter(conn, 'PMT');
  return `PMT-${String(seq).padStart(6, '0')}`;
}

module.exports = { nextEnquiryId, nextPaymentId, ymdKolkata };
