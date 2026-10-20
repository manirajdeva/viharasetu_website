/**
 * time.js
 * India Standard Time (UTC+05:30, no daylight saving) helpers.
 *
 * The database stores every timestamp in UTC (the pool runs with timezone 'Z'),
 * and the API keeps returning UTC. The history tables also keep a ready-to-read
 * IST copy of each timestamp, so people looking at the raw table see local time.
 */

const IST_OFFSET_MIN = 330;

/** 'YYYY-MM-DD HH:MM:SS' wall-clock time in IST for the given instant. */
function istString(date = new Date()) {
  return new Date(date.getTime() + IST_OFFSET_MIN * 60000).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Makes sure `table` has an IST copy column and that older rows are filled in.
 * Idempotent. Table / column names come from our own code, never from a request.
 */
async function ensureIstColumn(pool, table, istCol, afterCol, utcCol) {
  const [found] = await pool.query(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, istCol],
  );
  if (!found.length) {
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${istCol}\` DATETIME NULL AFTER \`${afterCol}\``);
  }
  await pool.query(
    `UPDATE \`${table}\` SET \`${istCol}\` = DATE_ADD(\`${utcCol}\`, INTERVAL ${IST_OFFSET_MIN} MINUTE) WHERE \`${istCol}\` IS NULL`,
  );
}

module.exports = { istString, ensureIstColumn, IST_OFFSET_MIN };
