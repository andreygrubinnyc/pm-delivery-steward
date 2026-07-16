const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_CSV_DATA_ROWS, parseCsv } = require('../lib/csv-import');

test('CSV parsing rejects excess row cardinality before materializing the preview', () => {
  const csv = ['Summary', ...Array.from({ length: MAX_CSV_DATA_ROWS + 1 }, () => 'x')].join('\n');
  assert.throws(() => parseCsv(csv), /limited to 1,000 data rows/i);
});

test('CSV parsing preserves a legitimate preview at the row limit', () => {
  const csv = ['Summary', ...Array.from({ length: MAX_CSV_DATA_ROWS }, (_, index) => `Story ${index}`)].join('\n');
  const rows = parseCsv(csv);
  assert.equal(rows.length, MAX_CSV_DATA_ROWS + 1);
  assert.deepEqual(rows[1], ['Story 0']);
  assert.deepEqual(rows.at(-1), [`Story ${MAX_CSV_DATA_ROWS - 1}`]);
});
