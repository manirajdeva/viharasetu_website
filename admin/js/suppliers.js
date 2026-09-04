/**
 * suppliers.js — Suppliers module.
 * Local partners / DMCs / vendors, grouped loosely by the regions they cover.
 */

const Suppliers = makeSheetModule({
  key: 'suppliers',
  title: 'Suppliers',
  singular: 'Supplier',
  primaryKey: 'Supplier Company Name',
  defaultSort: '#',
  defaultSortDir: 'asc',
  serialCol: { key: '#', by: 'Timestamp' },
  searchCols: ['Supplier Company Name', 'Supplier Name', 'States', 'Contact No', 'Supplier ID'],
  columns: [
    { key: '#', label: '#', cls: 'mono' },
    { key: 'Supplier ID', label: 'Supplier ID', primary: true, cls: 'mono' },
    { key: 'Timestamp', label: 'Added', type: 'datetime' },
    { key: 'Supplier Company Name', label: 'Company' },
    { key: 'Supplier Name', label: 'Contact person' },
    { key: 'States', label: 'Regions' },
    { key: 'Contact No', label: 'Phone' }
  ],
  formFields: [
    { key: 'Supplier Company Name', label: 'Company name', required: true },
    { key: 'Supplier Name', label: 'Contact person' },
    { key: 'States', label: 'Regions / states covered', full: true },
    { key: 'Contact No', label: 'Phone', type: 'tel' },
    { key: 'Supplier ID', label: 'Supplier ID', hint: 'Optional internal code, e.g. SUP-GOA-01' }
  ],
  validate: (v) => {
    if (!v['Supplier Company Name'].trim()) return 'Company name is required.';
    if (v['Contact No'] && !Utils.isValidMobile(v['Contact No'])) return 'Enter a valid 10-digit phone number.';
    return null;
  }
});

App.onView('suppliers', () => Suppliers.load());
