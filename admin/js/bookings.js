/**
 * bookings.js — Bookings module.
 * A confirmed trip. Link it back to an enquiry with the Enquiry ID picker
 * (type to search by ID / name / phone / destination); picking one fills in
 * the customer name automatically. "Destination" uses the same label as the
 * enquiry form.
 */

const Bookings = makeSheetModule({
  key: 'bookings',
  title: 'Bookings',
  singular: 'Booking',
  primaryKey: 'Customer',
  defaultSort: 'Timestamp',
  enquiryPicker: true,
  badgeCol: 'Payment Status',
  badgeOptions: ['Pending', 'Partial', 'Paid'],
  searchCols: ['Enquiry ID', 'Customer', 'Destination', 'Travel Dates'],
  columns: [
    { key: 'Enquiry ID', label: 'Enquiry ID', cls: 'mono' },
    { key: 'Timestamp', label: 'Created', type: 'datetime' },
    { key: 'Customer', label: 'Customer', primary: true },
    { key: 'Destination', label: 'Destination' },
    { key: 'Travel Dates', label: 'Travel dates' },
    { key: 'Pax', label: 'Pax' },
    { key: 'Amount', label: 'Amount', type: 'currency' },
    { key: 'Payment Status', label: 'Payment' },
    { key: 'Notes', label: 'Notes' }
  ],
  formFields: [
    { key: 'Enquiry ID', label: 'Enquiry ID', type: 'picker', list: 'enquiryIdList', placeholder: 'Search by enquiry ID, name, phone or destination…', full: true },
    { key: 'Customer', label: 'Customer', required: true },
    { key: 'Destination', label: 'Destination', required: true },
    { key: 'Travel Dates', label: 'Travel dates', type: 'daterange' },
    { key: 'Pax', label: 'Pax', type: 'number' },
    { key: 'Amount', label: 'Amount (₹)', type: 'number' },
    { key: 'Payment Status', label: 'Payment status', type: 'select', options: ['Pending', 'Partial', 'Paid'], default: 'Pending' },
    { key: 'Notes', label: 'Notes', type: 'textarea' }
  ],
  validate: (v) => {
    if (!v.Customer.trim()) return 'Customer is required.';
    if (!v.Destination.trim()) return 'Destination is required.';
    if (v.Amount && Number(v.Amount) < 0) return 'Amount cannot be negative.';
    if (v.Pax && Number(v.Pax) < 0) return 'Pax cannot be negative.';
    return null;
  }
});

App.onView('bookings', () => Bookings.load());
