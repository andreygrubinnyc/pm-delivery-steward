const test = require('node:test');
const assert = require('node:assert/strict');
const {
  attachUpdatesToStories,
  removeTranscriptEvidence,
  removeStoryUpdate,
  storyLastCommentText
} = require('../lib/evidence-integrity');

test('deduplicated DSU updates retain every source reference and recalculate derived dates', () => {
  const project = { stories: [{ id: 'story-1', summary: 'Database migration', updates: [] }] };
  const first = { id: 'source-1', title: 'Daily Standup', date: '2026-07-13' };
  const second = { id: 'source-2', title: 'Daily Standup', date: '2026-07-14' };
  const extracted = [{ storyId: 'story-1', excerpt: 'Database migration rehearsal completed.' }];

  attachUpdatesToStories(project, first, extracted, { createId: () => 'update-1' });
  attachUpdatesToStories(project, second, extracted, { createId: () => 'unused' });

  const story = project.stories[0];
  assert.equal(story.updates.length, 1);
  assert.deepEqual(story.updates[0].sourceRefs.map(ref => ref.transcriptId), ['source-1', 'source-2']);
  assert.equal(story.lastUpdate, '2026-07-14');

  removeTranscriptEvidence(project, 'source-1');
  assert.equal(story.updates.length, 1);
  assert.deepEqual(story.updates[0].sourceRefs.map(ref => ref.transcriptId), ['source-2']);
  assert.equal(story.lastUpdate, '2026-07-14');

  removeTranscriptEvidence(project, 'source-2');
  assert.deepEqual(story.updates, []);
  assert.equal(story.lastUpdate, '');
});

test('manual update deletion recalculates lastUpdate and dates are not shown as comment text', () => {
  const story = {
    lastComment: '',
    lastUpdate: '2026-07-14',
    updates: [
      { id: 'new', date: '2026-07-14', update: 'New evidence' },
      { id: 'old', date: '2026-07-13', update: 'Old evidence' }
    ]
  };
  removeStoryUpdate(story, 'new');
  assert.equal(story.lastUpdate, '2026-07-13');
  assert.equal(storyLastCommentText(story), '');
});
