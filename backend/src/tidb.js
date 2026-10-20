/**
 * tidb.js
 * TiDB-specific table tuning.
 *
 * By default TiDB hands out AUTO_INCREMENT numbers in big per-server blocks
 * (30,000 at a time), so ids jump: 1, 2, 3, 30001, 30002 ... For the history
 * tables people read row by row that looks like missing records. A table created
 * with AUTO_ID_CACHE = 1 allocates ids one at a time from a single counter, so
 * they come out consecutive. (An id used by an insert that is later rolled back or
 * deleted is still never reused - that is how AUTO_INCREMENT works everywhere.)
 *
 * TiDB cannot switch the setting on an existing table, so it is part of CREATE TABLE
 * (see audit.js / loginAudit.js / migrate/schema.sql). This only warns if a table was
 * created without it. On plain MySQL the option comment is ignored.
 */

const log = require('./logger');

/** `table` is always a literal from our own code, never from a request. */
async function ensureConsecutiveIds(pool, table) {
  try {
    const [rows] = await pool.query(`SHOW CREATE TABLE \`${table}\``);
    const ddl = (rows[0] && rows[0]['Create Table']) || '';
    if (!/AUTO_ID_CACHE\s*=\s*1\b/i.test(ddl) && /TiDB/i.test(await version(pool))) {
      log.warn(`${table} was created without AUTO_ID_CACHE=1, so its ids can skip in big jumps on TiDB. ` +
        'Rebuild the table once (copy rows into a new table created with AUTO_ID_CACHE=1) to get consecutive ids.');
    }
  } catch (err) {
    log.warn(`Could not check id allocation on ${table}:`, err.message);
  }
}

async function version(pool) {
  const [[row]] = await pool.query('SELECT VERSION() AS v');
  return row.v;
}

module.exports = { ensureConsecutiveIds };
