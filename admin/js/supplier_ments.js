/**
 * supplier_ments.js — Supplier Payments module.
 * One row per enquiry: what the customer pays (Total Amount) against what the
 * supplier charges (Package Cost). Profit is Total − Cost, derived by the API
 * on every save, so it is shown live in the form but never sent. Picking an
 * Enquiry ID fills in the customer name.
 */

const SupplierMents = makeSheetModule({
  key: 'supplier_ments',
  title: 'Supplier Payments',
  singular: 'Supplier Payment',
  primaryKey: 'Customer Name',
  defaultSort: 'Created Date',
  enquiryPicker: true,
  enquiryLink: true,
  searchCols: ['Enquiry ID', 'Customer Name', 'Supplier Name'],
  columns: [
    { key: 'Enquiry ID', label: 'Enquiry ID', cls: 'mono', primary: true },
    { key: 'Customer Name', label: 'Customer name' },
    { key: 'Supplier Name', label: 'Supplier name' },
    { key: 'Total Amount', label: 'Total amount', type: 'currency' },
    { key: 'Package Cost', label: 'Package cost', type: 'currency' },
    { key: 'Profit', label: 'Profit', type: 'currency' },
    { key: 'Created Date', label: 'Created', type: 'datetime' },
    { key: 'Updated Date', label: 'Updated', type: 'datetime' }
  ],
  formFields: [
    { key: 'Enquiry ID', label: 'Enquiry ID', type: 'picker', list: 'enquiryIdList', placeholder: 'Search by enquiry ID, name, phone or destination…', full: true, required: true },
    { key: 'Customer Name', label: 'Customer name' },
    { key: 'Supplier Name', label: 'Supplier name' },
    { key: 'Total Amount', label: 'Total amount (₹)', type: 'number' },
    { key: 'Package Cost', label: 'Package cost (₹)', type: 'number' }
  ],
  validate: (v) => {
    if (!String(v['Enquiry ID'] || '').trim()) return 'Enquiry ID is required.';
    if (v['Total Amount'] && Number(v['Total Amount']) < 0) return 'Total amount cannot be negative.';
    if (v['Package Cost'] && Number(v['Package Cost']) < 0) return 'Package cost cannot be negative.';
    return null;
  }
});

App.onView('supplier_ments', () => SupplierMents.load());
