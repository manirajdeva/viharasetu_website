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

/**
 * Tidy a "+<code> <number>" value before validation: drop spaces, dashes,
 * dots and brackets from the number and, for India, the trunk "0" or a
 * repeated "91" that visitors often type in front of a 10-digit mobile
 * ("+91 06363895647" -> "+91 6363895647"). Other values are only trimmed.
 */
function normalizePhone(value) {
  const s = String(value == null ? '' : value).trim();
  const m = /^\+(\d{1,4})\s*(.*)$/.exec(s);
  if (!m) return s;
  let local = m[2].replace(/[\s\-().]/g, '');
  if (m[1] === '91') {
    if (/^0[6-9]\d{9}$/.test(local)) local = local.slice(1);
    else if (/^91[6-9]\d{9}$/.test(local)) local = local.slice(2);
  }
  return local ? `+${m[1]} ${local}` : '';
}

module.exports = { isValidPhone, normalizePhone };
