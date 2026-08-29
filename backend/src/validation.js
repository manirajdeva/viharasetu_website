/**
 * validation.js
 * Server-side validation for every create/update. Mirrors the per-module
 * `validate()` rules in the admin portal (admin/js/enquiries.js etc.) and
 * hardens them — the client checks are a convenience, these are the gate.
 * Returns an error string, or null when the values are acceptable.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE = /^[6-9]\d{9}$/;

const ENUMS = {
  enquiries: { 'Status': ['New', 'Contacted', 'Booked', 'Closed'] },
  bookings: { 'Payment Status': ['Pending', 'Partial', 'Paid'] },
  payments: { 'Payment Mode': ['Cash', 'UPI', 'Card', 'Bank Transfer'] },
};

const MAX_LEN = {
  enquiries: { 'Name': 160, 'Email': 190, 'Phone': 20, 'Destination': 160, 'Travel': 120 },
  suppliers: { 'Supplier Company Name': 200, 'States': 255, 'Supplier Name': 160, 'Supplier ID': 40, 'Contact No': 20 },
  bookings: { 'Customer': 160, 'Destination': 200, 'Travel Dates': 120 },
  payments: { 'Customer': 160, 'Transaction Ref': 120 },
};

function validate(entity, values) {
  const v = values || {};
  const s = (k) => String(v[k] == null ? '' : v[k]).trim();
  const has = (k) => Object.prototype.hasOwnProperty.call(v, k) && s(k) !== '';

  if (entity === 'enquiries') {
    if (!s('Name')) return 'Name is required.';
    if (!EMAIL.test(s('Email'))) return 'Enter a valid email address.';
    if (has('Phone') && !MOBILE.test(s('Phone').replace(/\s+/g, ''))) return 'Enter a valid 10-digit phone number.';
  } else if (entity === 'suppliers') {
    if (!s('Supplier Company Name')) return 'Company name is required.';
    if (has('Contact No') && !MOBILE.test(s('Contact No').replace(/\s+/g, ''))) return 'Enter a valid 10-digit phone number.';
  } else if (entity === 'bookings') {
    if (!s('Customer')) return 'Customer is required.';
    if (!s('Destination')) return 'Destination is required.';
    if (has('Amount') && Number(v['Amount']) < 0) return 'Amount cannot be negative.';
    if (has('Pax') && Number(v['Pax']) < 0) return 'Pax cannot be negative.';
  } else if (entity === 'payments') {
    if (!s('Customer')) return 'Customer is required.';
    if (!(Number(v['Total Amount']) >= 0)) return 'Total amount must be a number of 0 or more.';
    if (!(Number(v['Amount Paid']) > 0)) return 'Amount paid must be greater than zero.';
  } else {
    return 'Unknown entity.';
  }

  for (const [field, allowed] of Object.entries(ENUMS[entity] || {})) {
    if (has(field) && !allowed.includes(s(field))) return `Invalid ${field}: "${s(field)}".`;
  }
  for (const [field, max] of Object.entries(MAX_LEN[entity] || {})) {
    if (s(field).length > max) return `${field} is too long (max ${max} characters).`;
  }
  return null;
}

module.exports = { validate };
