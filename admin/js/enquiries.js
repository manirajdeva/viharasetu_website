/**
 * enquiries.js — Enquiries module.
 * Traveller enquiries. The Enquiry ID (e.g. VH-20260828-01) and the
 * received timestamp are minted by Code.gs, so neither appears in the form.
 */

const Enquiries = makeSheetModule({
  key: 'enquiries',
  title: 'Enquiries',
  singular: 'Enquiry',
  primaryKey: 'Name',
  defaultSort: 'Timestamp',
  badgeCol: 'Status',
  badgeOptions: ['New', 'Contacted', 'Booked', 'Closed'],
  searchCols: ['Enquiry ID', 'Name', 'Email', 'Phone', 'Destination'],
  columns: [
    { key: 'Enquiry ID', label: 'Enquiry ID', primary: true, cls: 'mono' },
    { key: 'Timestamp', label: 'Received', type: 'date-dmy' },
    { key: 'Name', label: 'Name' },
    { key: 'Email', label: 'Email' },
    { key: 'Phone', label: 'Phone' },
    { key: 'Destination', label: 'Destination' },
    { key: 'Travel', label: 'Travel date', type: 'date-dmy' },
    { key: 'Status', label: 'Status' },
    { key: 'Notes', label: 'Notes' }
  ],
  formFields: [
    { key: 'Name', label: 'Name', required: true },
    { key: 'Email', label: 'Email', type: 'email', required: true },
    { key: 'Phone', label: 'Phone', type: 'tel' },
    { key: 'Destination', label: 'Destination' },
    { key: 'Travel', label: 'Travel date', type: 'date' },
    { key: 'Status', label: 'Status', type: 'select', options: ['New', 'Contacted', 'Booked', 'Closed'], default: 'New' },
    { key: 'Notes', label: 'Notes', type: 'textarea' }
  ],
  validate: (v) => {
    if (!v.Name.trim()) return 'Name is required.';
    if (!Utils.isValidEmail(v.Email)) return 'Enter a valid email address.';
    if (v.Phone && !Utils.isValidMobile(v.Phone)) return 'Enter a valid 10-digit phone number.';
    return null;
  }
});

App.onView('enquiries', () => Enquiries.load());
