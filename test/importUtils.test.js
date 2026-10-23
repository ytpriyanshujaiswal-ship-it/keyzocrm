import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDelimitedText, parseLeadRows, normalizeImportPhone } from '../src/importUtils.js';

test('CSV pasted content preserves commas inside quoted names and project names', () => {
  const rows = parseDelimitedText('Name,Phone,Project,Location,Source,Budget,Email\n"Rahul, Sharma",9876543210,"Ace Arte, Sector 150",Noida,99acres,1.2 Cr,rahul@example.com');
  const result = parseLeadRows(rows);
  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0].name, 'Rahul, Sharma');
  assert.equal(result.leads[0].project, 'Ace Arte, Sector 150');
  assert.equal(result.leads[0].estimate, '1.2 Cr');
  assert.equal(result.leads[0].email, 'rahul@example.com');
});

test('common header aliases map and duplicate Indian phone formats are skipped', () => {
  const result = parseLeadRows([
    ['Full Name', 'Mobile No.', 'Project Name', 'City', 'Lead Source', 'Budget Range', 'Email ID'],
    ['Priya Nair', '9876543210', 'Ace Arte', 'Noida', 'Reference', '80L', 'priya@example.com'],
    ['Priya Duplicate', '+91 98765 43210', 'Ace Arte', 'Noida', 'Website', '80L', 'other@example.com'],
    ['Missing Phone', '', 'Project X', 'Noida', 'Other', '50L', ''],
  ]);
  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0].sector, 'Noida');
  assert.equal(result.leads[0].source, 'Reference');
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.invalidCount, 1);
});

test('positional rows are supported when a header row is absent', () => {
  const result = parseLeadRows([['Amit Verma', '09876543210', 'Project Y', 'Sector 150', 'Walk-in', 'amit@example.com', '1 Cr']]);
  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0].name, 'Amit Verma');
  assert.equal(result.leads[0].estimate, '1 Cr');
  assert.equal(normalizeImportPhone('09876543210'), '9876543210');
});

test('missing required header produces actionable error instead of importing wrong columns', () => {
  const result = parseLeadRows([['Full Name', 'Email ID'], ['Rohit', 'rohit@example.com']]);
  assert.equal(result.leads.length, 0);
  assert.match(result.error, /Phone\/Mobile/);
});
