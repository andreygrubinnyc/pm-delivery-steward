const MAX_CSV_DATA_ROWS = 1000;

function parseCsv(text, options = {}) {
  const maxDataRows = Number.isInteger(options.maxDataRows) && options.maxDataRows >= 0
    ? options.maxDataRows
    : MAX_CSV_DATA_ROWS;
  const maxRows = maxDataRows + 1;
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const input = String(text || '').replace(/^\uFEFF/, '');

  function appendRow(nextRow) {
    if (rows.length >= maxRows) {
      throw new Error(`CSV preview is limited to ${maxDataRows.toLocaleString('en-US')} data rows.`);
    }
    rows.push(nextRow);
  }

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell); appendRow(row); row = []; cell = ''; }
    else if (char !== '\r') cell += char;
  }
  row.push(cell);
  if (row.some(value => value.trim())) appendRow(row);
  return rows;
}

module.exports = { MAX_CSV_DATA_ROWS, parseCsv };
