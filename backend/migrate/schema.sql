-- Viharasetu — MySQL schema
-- Replaces the five Google Sheet tabs (Enquiries / Suppliers / Bookings /
-- Payments / Admins) plus the Apps Script "Script Properties" store used for
-- session tokens and the Enquiry ID / Payment ID counters.
--
-- Apply with:  node migrate/run-schema.js      (uses the .env connection)
-- or:          mysql -h <host> -u <user> -p <db> < migrate/schema.sql
--
-- Physical columns are snake_case; the API maps them back to the exact display
-- headers the admin portal expects ("Enquiry ID", "Amount Paid", ...), and maps
-- each row's `id` to the frontend's `rowIndex`, so no portal UI code changes.

SET NAMES utf8mb4;

/* ------------------------------------------------------------------ *
 *  enquiries  (sheet tab: "Enquiries")
 *  Traveller enquiries from the website contact form and by phone.
 * ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS enquiries (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  enquiry_id   VARCHAR(20)  NOT NULL,                                   -- "Enquiry ID"  e.g. VH-20260828-01
  received_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,         -- "Timestamp" (set once at creation)
  name         VARCHAR(160) NOT NULL,                                   -- "Name"
  email        VARCHAR(190) NOT NULL,                                   -- "Email"
  phone        VARCHAR(20)      NULL,                                   -- "Phone"
  destination  VARCHAR(160)     NULL,                                   -- "Destination"
  travel       VARCHAR(120)     NULL,                                   -- "Travel" (free text: a date OR "10 days / March")
  status       ENUM('New','Contacted','Booked','Closed') NOT NULL DEFAULT 'New',  -- "Status"
  notes        TEXT             NULL,                                   -- "Notes"
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_enquiries_enquiry_id (enquiry_id),
  KEY idx_enquiries_status (status),
  KEY idx_enquiries_received_at (received_at),
  KEY idx_enquiries_email (email),
  KEY idx_enquiries_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ------------------------------------------------------------------ *
 *  suppliers  (sheet tab: "Suppliers")
 *  Local partners / DMCs / vendors, grouped loosely by region.
 * ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS suppliers (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  added_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,       -- "Timestamp"
  company_name   VARCHAR(200) NOT NULL,                                 -- "Supplier Company Name"
  states         VARCHAR(255)     NULL,                                 -- "States" (regions covered, free text)
  contact_person VARCHAR(160)     NULL,                                 -- "Supplier Name"
  supplier_code  VARCHAR(40)      NULL,                                 -- "Supplier ID" (optional internal code, e.g. SUP-GOA-01)
  contact_no     VARCHAR(20)      NULL,                                 -- "Contact No"
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_suppliers_company (company_name),
  KEY idx_suppliers_code (supplier_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ------------------------------------------------------------------ *
 *  bookings  (sheet tab: "Bookings")
 *  Confirmed trips and their payment status. enquiry_id is a soft link
 *  back to enquiries — nullable, because a booking may predate the
 *  system or reference an enquiry that was never logged.
 * ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS bookings (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  enquiry_id     VARCHAR(20)      NULL,                                 -- "Enquiry ID" (link, may be blank)
  booked_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,       -- "Timestamp"
  customer       VARCHAR(160) NOT NULL,                                 -- "Customer"
  destination    VARCHAR(200)     NULL,                                 -- "Destination" (same field name as enquiries)
  travel_dates   VARCHAR(120)     NULL,                                 -- "Travel Dates" (free-text range)
  pax            INT              NULL,                                 -- "Pax"
  amount         DECIMAL(12,2) NOT NULL DEFAULT 0,                      -- "Amount"
  payment_status ENUM('Pending','Partial','Paid') NOT NULL DEFAULT 'Pending',  -- "Payment Status"
  notes          TEXT             NULL,                                 -- "Notes"
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bookings_enquiry_id (enquiry_id),
  KEY idx_bookings_customer (customer),
  KEY idx_bookings_payment_status (payment_status),
  CONSTRAINT fk_bookings_enquiry FOREIGN KEY (enquiry_id)
    REFERENCES enquiries (enquiry_id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ------------------------------------------------------------------ *
 *  payments  (sheet tab: "Payments")
 *  Money received. Several payments can share one enquiry (or, if the
 *  Enquiry ID is blank, one Customer name). pending_amount is DERIVED
 *  on every write — Total - SUM(Amount Paid across the group) — and an
 *  overpayment is rejected server-side, exactly as Code.gs did.
 * ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS payments (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  payment_id      VARCHAR(20)  NOT NULL,                                -- "Payment ID"  e.g. PMT-000001
  installment_no  INT              NULL,                                -- "Instalment" — 1,2,3… within the enquiry/customer group; app-maintained
  enquiry_id      VARCHAR(20)      NULL,                                -- "Enquiry ID" (link, may be blank)
  recorded_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,      -- "Timestamp"
  customer        VARCHAR(160) NOT NULL,                                -- "Customer"
  total_amount    DECIMAL(12,2) NOT NULL DEFAULT 0,                     -- "Total Amount"
  amount_paid     DECIMAL(12,2) NOT NULL,                               -- "Amount Paid"
  pending_amount  DECIMAL(12,2) NOT NULL DEFAULT 0,                     -- "Pending Amount" (derived, stored)
  payment_mode    ENUM('Cash','UPI','Card','Bank Transfer') NOT NULL DEFAULT 'UPI',  -- "Payment Mode"
  transaction_ref VARCHAR(120)     NULL,                                -- "Transaction Ref"
  notes           TEXT             NULL,                                -- "Notes"
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_payment_id (payment_id),
  KEY idx_payments_enquiry_id (enquiry_id),
  KEY idx_payments_customer (customer),
  KEY idx_payments_mode (payment_mode),
  CONSTRAINT fk_payments_enquiry FOREIGN KEY (enquiry_id)
    REFERENCES enquiries (enquiry_id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ------------------------------------------------------------------ *
 *  admins  (sheet tab: "Admins")
 *  Login accounts. Passwords are bcrypt hashes now (were plaintext in
 *  the sheet). Seed with:  node migrate/seed-admin.js <user> <pass> --can-delete
 * ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS admins (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username      VARCHAR(80)  NOT NULL,                                  -- "Username"
  password_hash VARCHAR(255) NOT NULL,                                  -- was "Password" (plaintext) — now bcrypt
  role          ENUM('admin','employee') NOT NULL DEFAULT 'employee',   -- admin = full access; employee = view + add only
  can_delete    TINYINT(1)   NOT NULL DEFAULT 0,                        -- kept in sync with role (admin = 1)
  mobile        VARCHAR(20)      NULL,                                  -- "Mobile"
  email         VARCHAR(190)     NULL,                                  -- "Email"
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admins_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ------------------------------------------------------------------ *
 *  sessions  — replaces the SESS_<token> Script Properties entries.
 *  One row per logged-in admin; swept when expired.
 * ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS sessions (
  token      CHAR(32)    NOT NULL,
  username   VARCHAR(80) NOT NULL,
  expires_at DATETIME    NOT NULL,
  created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (token),
  KEY idx_sessions_expires_at (expires_at),
  CONSTRAINT fk_sessions_admin FOREIGN KEY (username)
    REFERENCES admins (username) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ------------------------------------------------------------------ *
 *  counters  — replaces ENQ_COUNTER / PMT_COUNTER Script Properties.
 *  name = 'ENQ:YYYYMMDD' (daily-resetting enquiry sequence) or 'PMT'
 *  (running payment number). Bumped with INSERT ... ON DUPLICATE KEY
 *  UPDATE value = value + 1 inside the same transaction as the insert.
 * ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS counters (
  name       VARCHAR(40)     NOT NULL,
  value      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
