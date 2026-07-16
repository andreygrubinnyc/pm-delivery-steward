const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { extractDsuUpdates, segmentIdentifiesStory } = require('../lib/delivery-integrity');

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

test('DSU matching does not persist fuzzy same-sentence summary matches as evidence', () => {
  const updates = extractDsuUpdates(
    projectData,
    { id: 'transcript-1', title: 'Daily stand-up' },
    'Database backups are healthy while the office migration starts next month.'
  );
  assert.deepEqual(updates, []);
  assert.equal(segmentIdentifiesStory('Database migration planning guidance was reviewed.', projectData.stories[0]), false);
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

test('DSU extraction indexes explicit identifiers instead of scanning every segment for every story', () => {
  const stories = Array.from({ length: 400 }, (_, index) => ({
    id: `story-${index}`,
    jiraId: `PM-${index}`,
    summary: `Unrelated work item ${index}`
  }));
  const source = Array.from({ length: 3000 }, (_, index) => `General stand-up note ${index}.`).join(' ');
  const startedAt = performance.now();
  const updates = extractDsuUpdates({ stories }, {}, source);
  const elapsedMs = performance.now() - startedAt;
  assert.deepEqual(updates, []);
  assert.ok(elapsedMs < 500, `expected indexed DSU matching under 500 ms, took ${elapsedMs.toFixed(1)} ms`);
});
