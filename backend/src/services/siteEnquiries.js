/**
 * services/siteEnquiries.js
 * Enquiries from the public website (homepage contact form and the Signature
 * Journeys "Enquire" popup). One submission creates the `enquiries` row the
 * admin portal works with AND a `site_enquirys` log row of what the visitor
 * sent, in a single transaction, so the two never disagree.
 *
 * Throws an error with code 'VALIDATION' when the input is rejected.
 */

const sheets = require('./sheets');
const { validate } = require('../validation');
const { normalizePhone } = require('../phone');

// Which website form sent the enquiry; anything else is stored as NULL.
const SOURCES = ['contact_form', 'journey_popup'];

const str = (v) => String(v == null ? '' : v).trim();
const orNull = (v) => str(v) || null;

/** Returns { ok, enquiryId }. */
async function submit(body) {
  const b = body && typeof body === 'object' ? body : {};
  const values = {
    'Name': b.name || '',
    'Email': b.email || '',
    'Phone': normalizePhone(b.phone),
    'Destination': b.destination || '',
    'Travel': b.travel || '',
    'No. of People': str(b.no_of_people),
    'Hotel Preference': b.hotel_preference || '',
    'Special Requests': b.special_req || '',
    'Status': 'New',
    'Notes': b.notes || b.message || '',
  };
  const vErr = validate('enquiries', values);
  if (vErr) {
    const e = new Error(vErr);
    e.code = 'VALIDATION';
    throw e;
  }

  return sheets.createRow('enquiries', values, {
    // submitted_at comes from Node, not the column DEFAULT (TiDB's NOW() runs behind UTC).
    afterInsert: (conn, { enquiryId }) => conn.query(
      `INSERT INTO site_enquirys
         (enquiry_id, submitted_at, source, name, email, phone, destination, travel,
          no_of_people, hotel_preference, special_req, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        enquiryId,
        new Date(),
        SOURCES.includes(b.source) ? b.source : null,
        str(values['Name']),
        str(values['Email']),
        orNull(values['Phone']),
        orNull(values['Destination']),
        orNull(values['Travel']),
        values['No. of People'] ? Number(values['No. of People']) : null, // validated as 1–999
        orNull(values['Hotel Preference']),
        orNull(values['Special Requests']),
        orNull(values['Notes']),
      ],
    ),
  });
}

module.exports = { submit };
