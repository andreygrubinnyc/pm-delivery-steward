const test = require('node:test');
const assert = require('node:assert/strict');
const {
  csvCell,
  markdownCell,
  isTrustedMutationRequest,
  operatingStatusFromValue,
  operatingStatusFromLabels,
  daysSinceIso,
  localDateKey,
  calendarDayDelta,
  parseLocalDateOnly,
  safeTranscriptUrl
} = require('../public/security');

test('CSV cells neutralize spreadsheet formula prefixes', () => {
  assert.equal(csvCell('=1+1'), "\"'=1+1\"");
  assert.equal(csvCell('  @SUM(A1:A2)'), "\"'  @SUM(A1:A2)\"");
  assert.equal(csvCell('ordinary value'), '"ordinary value"');
  assert.equal(csvCell('a"b'), '"a""b"');
});

test('Markdown table cells escape backslashes, pipes, and line breaks', () => {
  assert.equal(markdownCell('a\\|b\r\nc'), 'a\\\\\\|b c');
  assert.equal(markdownCell('ordinary value'), 'ordinary value');
  assert.equal(markdownCell('[run](javascript:alert(1))'), '\\[run\\](javascript:alert(1))');
  assert.equal(markdownCell('![remote](https://attacker.example/pixel)'), '\\!\\[remote\\](https://attacker.example/pixel)');
});

test('same-origin browser mutations and local non-browser clients remain allowed', () => {
  assert.equal(isTrustedMutationRequest({ method: 'POST', host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', fetchSite: 'same-origin' }), true);
  assert.equal(isTrustedMutationRequest({ method: 'POST', host: 'localhost:3000' }), true);
});

test('cross-origin mutations and untrusted Host headers are rejected', () => {
  assert.equal(isTrustedMutationRequest({ method: 'POST', host: '127.0.0.1:3000', origin: 'https://attacker.example', fetchSite: 'cross-site' }), false);
  assert.equal(isTrustedMutationRequest({ method: 'GET', host: 'attacker.example:3000' }), false);
  assert.equal(isTrustedMutationRequest({ method: 'DELETE', host: 'localhost:3000', origin: 'http://localhost:4000' }), false);
});

test('operating statuses require complete canonical values, not misleading substrings', () => {
  assert.equal(operatingStatusFromValue('completed'), 'Done');
  assert.equal(operatingStatusFromValue('in-progress'), 'In progress');
  assert.equal(operatingStatusFromValue('on hold'), 'Blocked');
  assert.equal(operatingStatusFromValue('not done'), '');
  assert.equal(operatingStatusFromValue('incomplete'), '');
  assert.equal(operatingStatusFromValue('unresolved'), '');
  assert.equal(operatingStatusFromValue('unblocked'), '');
  assert.equal(operatingStatusFromValue('inactive'), '');
  assert.equal(operatingStatusFromLabels(['customer-impact', 'not done']), '');
  assert.equal(operatingStatusFromLabels(['customer-impact', 'done']), 'Done');
});

test('future comment timestamps cannot suppress stale-comment warnings', () => {
  const now = Date.parse('2026-07-15T12:00:00.000Z');
  assert.equal(daysSinceIso('2026-07-14T12:00:00.000Z', now), 1);
  assert.equal(daysSinceIso('2026-07-15T12:02:00.000Z', now), 0);
  assert.equal(daysSinceIso('2099-01-01T00:00:00.000Z', now), null);
});

test('date-only values stay on their local calendar day', () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    const evening = new Date('2026-07-15T02:00:00.000Z');
    assert.equal(localDateKey(evening), '2026-07-14');
    assert.equal(calendarDayDelta('2026-07-14', '2026-07-14'), 0);
    assert.equal(calendarDayDelta('2026-07-15', '2026-07-14'), 1);
    const local = parseLocalDateOnly('2026-07-14');
    assert.equal(local.getFullYear(), 2026);
    assert.equal(local.getMonth(), 6);
    assert.equal(local.getDate(), 14);
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test('Markdown export neutralizes raw HTML and transcript links stay in the upload directory', () => {
  assert.equal(markdownCell('<img src=x onerror=alert(1)> & text'), '&lt;img src=x onerror=alert(1)&gt; &amp; text');
  assert.equal(safeTranscriptUrl('/uploads/transcripts/0123456789abcdef0123456789abcdef'), '/uploads/transcripts/0123456789abcdef0123456789abcdef');
  assert.equal(safeTranscriptUrl('https://attacker.example/file'), '');
  assert.equal(safeTranscriptUrl('/uploads/transcripts/../../secret'), '');
});
