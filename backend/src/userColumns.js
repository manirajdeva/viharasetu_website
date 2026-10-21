/**
 * userColumns.js
 * "Who did it" columns on the record tables the portal edits (enquiries, suppliers,
 * bookings, payments, supplier payments, expenses):
 *   created_id  the signed-in user's name when the row was added     (e.g. maniraj_dev)
 *   updated_id  the signed-in user's name on the latest real change
 * Enquiries that arrive from the public website are created by 'website'.
 * The values come from the login session, never from the request body, so a
 * client cannot set them. (They hold the user NAME, not a numeric id.)
 */

const USER_TRACKED = ['enquiries', 'suppliers', 'bookings', 'payments', 'supplier_ments', 'expenses'];

const userTracked = (table) => USER_TRACKED.includes(table);

/** The portal shows these two as extra columns on the tracked tables. */
const USER_HEADERS = ['Created By', 'Updated By'];

/** Adds Created By / Updated By to a display row built from `raw` (the DB row). */
function decorateRow(table, display, raw) {
  if (!userTracked(table)) return display;
  display['Created By'] = raw.created_id || '';
  display['Updated By'] = raw.updated_id || '';
  return display;
}

const headersWithUsers = (table, headers) => (userTracked(table) ? headers.concat(USER_HEADERS) : headers);
const actorName = (actor) => (actor ? String(actor).slice(0, 80) : null);

/** Adds the two columns where missing and labels website-origin enquiries. Idempotent. */
async function ensureSchema(pool) {
  for (const table of USER_TRACKED) {
    const [cols] = await pool.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME IN ('created_id', 'updated_id')",
      [table],
    );
    const have = new Set(cols.map((c) => c.COLUMN_NAME));
    if (!have.has('created_id')) await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN created_id VARCHAR(80) NULL AFTER updated_at`);
    if (!have.has('updated_id')) await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN updated_id VARCHAR(80) NULL AFTER created_id`);
  }
  // enquiries that came in through the website form already have a site_enquirys row
  await pool.query(
    "UPDATE enquiries e SET e.created_id = 'website' WHERE e.created_id IS NULL AND EXISTS (SELECT 1 FROM site_enquirys s WHERE s.enquiry_id = e.enquiry_id)",
  );
}

module.exports = { USER_TRACKED, USER_HEADERS, userTracked, actorName, decorateRow, headersWithUsers, ensureSchema };
