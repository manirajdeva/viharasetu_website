/**
 * expenses.js — Expenses module.
 * Money spent by the business or by a partner. Every expense is a debit on the
 * Account Statement page, which reads this sheet directly. "Paid by" is free
 * text (a partner's name, or "Business") so the statement can show what each
 * partner has put out of pocket.
 */

const EXPENSE_CATEGORIES = ['', 'Website', 'Travel', 'Cards & Posters', 'Others'];
const PARTNERS = ['', 'Devamani Raju', 'Satya', 'Sirisha'];

const Expenses = makeSheetModule({
  key: 'expenses',
  title: 'Expenses',
  singular: 'Expense',
  primaryKey: 'Description',
  defaultSort: 'Expense Date',
  totalBox: { label: 'Total expenses', key: 'Amount' },
  searchCols: ['Category', 'Description', 'Paid By', 'Notes'],
  columns: [
    { key: 'Expense Date', label: 'Date', type: 'date-dmy' },
    { key: 'Category', label: 'Category' },
    { key: 'Description', label: 'Description', primary: true },
    { key: 'Amount', label: 'Amount', type: 'currency' },
    { key: 'Paid By', label: 'Paid by' },
    { key: 'Notes', label: 'Notes' },
    { key: 'Created Date', label: 'Created', type: 'datetime' }
  ],
  formFields: [
    { key: 'Expense Date', label: 'Date', type: 'date', required: true, default: Utils.todayISO() },
    { key: 'Category', label: 'Category', type: 'select', options: EXPENSE_CATEGORIES },
    { key: 'Description', label: 'Description', required: true, full: true },
    { key: 'Amount', label: 'Amount (₹)', type: 'number', required: true },
    { key: 'Paid By', label: 'Paid by', type: 'select', options: PARTNERS },
    { key: 'Notes', label: 'Notes', type: 'textarea' }
  ],
  validate: (v) => {
    if (!v['Expense Date']) return 'Date is required.';
    if (!String(v.Description || '').trim()) return 'Description is required.';
    if (!(Number(v.Amount) > 0)) return 'Amount must be greater than zero.';
    return null;
  }
});

App.onView('expenses', () => Expenses.load());
