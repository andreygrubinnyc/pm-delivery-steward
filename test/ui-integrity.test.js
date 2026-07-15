const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('UI uses canonical project names and routes quiet badges to Follow-Up', () => {
  assert.match(appSource, /selectedProject\s*=\s*result\.name/);
  assert.match(appSource, /counts\.tracking\s*=\s*quiet/);
});

test('Workspace search and Story editor preserve their HTML and API contracts', () => {
  assert.match(appSource, /value="\$\{escapeHtml\(manageSearch\)\}"/);
  assert.match(appSource, /manageEditData\.detailsField\s*===\s*'description'/);
  assert.match(appSource, /type\s*!==\s*'Story'.*payload\.date/s);
  assert.doesNotMatch(appSource, /saveManageEdit\([^\n]+item\.type\.toLowerCase\(\)/);
});

test('reference uploads expose only validated local download links', () => {
  assert.match(appSource, /PMSecurity\.safeTranscriptUrl\(t\.file\)/);
  assert.match(appSource, />Download</);
});

test('the retired free-form AI extraction path cannot be reactivated accidentally', () => {
  assert.doesNotMatch(serverSource, /runLlmExtraction|defaultDsuExtractionPrompt/);
});
