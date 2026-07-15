const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ValidationError,
  rejectUnknownFields,
  validateStoryCreate,
  validateStoryUpdate,
  validateTimelineCreate,
  validateTranscriptUpload
} = require('../lib/input-validation');

const project = { timeline: [{ id: 'timeline-1' }] };

test('request schemas reject fields outside their explicit contracts', () => {
  assert.throws(() => rejectUnknownFields({ name: 'Demo', injected: true }, new Set(['name'])), /unexpected field/);
});

test('story schemas reject non-string fields and dangling milestone references', () => {
  assert.throws(() => validateStoryCreate({ summary: {}, timelineId: '' }, project), ValidationError);
  assert.throws(() => validateStoryCreate({ summary: 'Valid', timelineId: 'missing' }, project), /timelineId/);
  assert.throws(() => validateStoryUpdate({ notes: { nested: true } }, project), ValidationError);
  assert.throws(() => validateStoryUpdate({ date: '2026-07-14' }, project), /unexpected field/);
  assert.deepEqual(validateStoryCreate({ summary: ' Valid ', timelineId: 'timeline-1', tracked: false }, project), {
    summary: 'Valid',
    timelineId: 'timeline-1',
    tracked: false
  });
});

test('timeline and transcript schemas reject invalid dates, types, and metadata shapes', () => {
  assert.throws(() => validateTimelineCreate({ title: 'Milestone', date: '2026-02-30' }), /date/);
  assert.throws(() => validateTimelineCreate({ title: 'Milestone', status: 'Anything goes' }), /status/);
  assert.throws(() => validateTranscriptUpload({ notes: 'note', date: '2026-07-14', metadata: null }), /metadata/);
  assert.throws(() => validateTranscriptUpload({ notes: 'note', date: '2026-07-14', metadata: [{ type: 'Executable' }] }), /type/);
  assert.equal(validateTimelineCreate({ title: ' Milestone ', date: '2026-07-14' }).title, 'Milestone');
  assert.equal(validateTimelineCreate({ title: 'Milestone', status: 'Upcoming' }).status, 'Upcoming');
});
