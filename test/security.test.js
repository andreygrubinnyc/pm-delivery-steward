const test = require('node:test');
const assert = require('node:assert/strict');
const { csvCell, markdownCell, isTrustedMutationRequest } = require('../public/security');

test('CSV cells neutralize spreadsheet formula prefixes', () => {
  assert.equal(csvCell('=1+1'), "\"'=1+1\"");
  assert.equal(csvCell('  @SUM(A1:A2)'), "\"'  @SUM(A1:A2)\"");
  assert.equal(csvCell('ordinary value'), '"ordinary value"');
  assert.equal(csvCell('a"b'), '"a""b"');
});

test('Markdown table cells escape backslashes, pipes, and line breaks', () => {
  assert.equal(markdownCell('a\\|b\r\nc'), 'a\\\\\\|b c');
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
