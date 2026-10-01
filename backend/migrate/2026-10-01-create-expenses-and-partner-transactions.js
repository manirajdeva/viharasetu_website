#!/usr/bin/env node
/**
 * migrate/2026-10-01-create-expenses-and-partner-transactions.js
 * Creates the `expenses` and `partner_transactions` tables used by the Expenses
 * and Account Statement pages. Idempotent.
 *
 *   cd backend && node migrate/2026-10-01-create-expenses-and-partner-transactions.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const config = require('../src/config');

const TABLES = {
  expenses: `CREATE TABLE IF NOT EXISTS expenses (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  expense_date VARCHAR(10)  NOT NULL,                                  -- "Expense Date" (yyyy-mm-dd)
  category     VARCHAR(80)      NULL,                                  -- "Category"
  description  VARCHAR(255) NOT NULL,                                  -- "Description"
  amount       DECIMAL(12,2) NOT NULL DEFAULT 0,                       -- "Amount"
  paid_by      VARCHAR(80)      NULL,                                  -- "Paid By" (partner name or Business)
  notes        TEXT             NULL,                                  -- "Notes"
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,        -- "Created Date"
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,  -- "Updated Date"
  PRIMARY KEY (id),
  KEY idx_expenses_date (expense_date),
  KEY idx_expenses_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  partner_transactions: `CREATE TABLE IF NOT EXISTS partner_transactions (
  id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  txn_date  VARCHAR(10)  NOT NULL,                                     -- "Date" (yyyy-mm-dd)
  partner   VARCHAR(80)  NOT NULL,                                     -- "Partner"
  txn_type  ENUM('Investment','Withdrawal') NOT NULL,                  -- "Type"
  amount    DECIMAL(12,2) NOT NULL DEFAULT 0,                          -- "Amount"
  notes     TEXT             NULL,                                     -- "Notes"
  created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,           -- "Created Date"
  updated_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,  -- "Updated Date"
  PRIMARY KEY (id),
  KEY idx_ptx_date (txn_date),
  KEY idx_ptx_partner (partner)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
};

(async () => {
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    ssl: config.db.ssl,
  });

  for (const [name, ddl] of Object.entries(TABLES)) {
    const [t] = await conn.query('SHOW TABLES LIKE ?', [name]);
    if (t.length) { console.log(`• ${name} already exists`); continue; }
    await conn.query(ddl);
    console.log(`✓ created ${name}`);
  }
  await conn.end();
})().catch((err) => {
  console.error('✗ migration failed:', err.message);
  process.exit(1);
});
