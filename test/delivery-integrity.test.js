const test = require('node:test');
const assert = require('node:assert/strict');
const { extractDsuUpdates } = require('../lib/delivery-integrity');

const projectData = {
  stories: [
    { id: 'story-1', jiraId: 'PM-42', summary: 'Database migration' }
  ]
};

test('DSU matching does not combine unrelated words across separate sentences', () => {
  const updates = extractDsuUpdates(
    projectData,
    { id: 'transcript-1', title: 'Daily stand-up' },
    'Database backups are healthy. The office migration is next month.'
  );
  assert.deepEqual(updates, []);
});

test('DSU matching keeps the exact segment that identifies the work item', () => {
  const updates = extractDsuUpdates(
    projectData,
    { id: 'transcript-1', title: 'Daily stand-up' },
    'PM-42 database migration completed its rehearsal today. Other notes follow.'
  );
  assert.equal(updates.length, 1);
  assert.equal(updates[0].storyId, 'story-1');
  assert.equal(updates[0].excerpt, 'PM-42 database migration completed its rehearsal today.');
});

test('DSU identifiers require token boundaries', () => {
  const updates = extractDsuUpdates(
    { stories: [{ id: 'story-2', jiraId: 'PM-4', summary: 'API login' }] },
    { id: 'transcript-1', title: 'Daily stand-up' },
    'PM-42 database migration completed its rehearsal today.'
  );
  assert.deepEqual(updates, []);
});
