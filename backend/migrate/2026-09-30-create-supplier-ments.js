#!/usr/bin/env node
/**
 * migrate/2026-09-30-create-supplier-ments.js
 * Creates the supplier_ments table (one row per enquiry: customer, supplier,
 * total amount, package cost, derived profit). Idempotent.
 *
 *   cd backend && node migrate/2026-09-30-create-supplier-ments.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const config = require('../src/config');

const DDL = `CREATE TABLE IF NOT EXISTS supplier_ments (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,               -- internal row id used by the portal
  enquiry_id    VARCHAR(20)  NOT NULL,                                 -- "Enquiry ID" — the key: one row per enquiry
  customer_name VARCHAR(160)     NULL,                                 -- "Customer Name"
  supplier_name VARCHAR(200)     NULL,                                 -- "Supplier Name"
  total_amount  DECIMAL(12,2) NOT NULL DEFAULT 0,                      -- "Total Amount" (what the customer pays)
  package_cost  DECIMAL(12,2) NOT NULL DEFAULT 0,                      -- "Package Cost" (what the supplier charges)
  profit        DECIMAL(12,2) NOT NULL DEFAULT 0,                      -- "Profit" = total_amount - package_cost (derived, stored)
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,       -- "Created Date"
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,  -- "Updated Date"
  PRIMARY KEY (id),
  UNIQUE KEY uq_supplier_ments_enquiry_id (enquiry_id),
  KEY idx_supplier_ments_supplier (supplier_name),
  CONSTRAINT fk_supplier_ments_enquiry FOREIGN KEY (enquiry_id)
    REFERENCES enquiries (enquiry_id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

(async () => {
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    ssl: config.db.ssl,
  });

  const [t] = await conn.query("SHOW TABLES LIKE 'supplier_ments'");
  if (t.length) {
    console.log('• supplier_ments already exists');
  } else {
    await conn.query(DDL);
    console.log('✓ created supplier_ments');
  }
  await conn.end();
})().catch((err) => {
  console.error('✗ migration failed:', err.message);
  process.exit(1);
});
