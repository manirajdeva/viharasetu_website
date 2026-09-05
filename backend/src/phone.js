/**
 * phone.js
 * Shared phone validation for values shaped "+<country code> <local number>"
 * (as produced by the admin portal's phone field) or a bare legacy 10-digit
 * Indian mobile number. Mirrored client-side by Utils.isValidMobile in
 * admin/js/utils.js.
 */

const LOCAL_INDIA = /^[6-9]\d{9}$/;
const LOCAL_GENERIC = /^\d{6,14}$/;

function isValidPhone(value) {
  const s = String(value == null ? '' : value).trim();
  const m = /^\+(\d{1,4})\s*(.*)$/.exec(s);
  if (m) {
    const local = m[2].replace(/\s+/g, '');
    return m[1] === '91' ? LOCAL_INDIA.test(local) : LOCAL_GENERIC.test(local);
  }
  return LOCAL_INDIA.test(s.replace(/\s+/g, ''));
}

module.exports = { isValidPhone };
