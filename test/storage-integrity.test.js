const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  stageUploadFiles,
  commitStagedUploads,
  commitFileDeletions,
  reconcileUploadDirectory
} = require('../lib/storage-integrity');

test('failed JSON persistence rolls uploaded files back', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-storage-'));
  try {
    const staged = stageUploadFiles([{ buffer: Buffer.from('evidence'), originalname: 'note.txt', mimetype: 'text/plain' }], dir, () => 'a'.repeat(32));
    assert.equal(fs.existsSync(staged[0].path), true);
    assert.throws(() => commitStagedUploads(staged, () => { throw new Error('write failed'); }), /write failed/);
    assert.equal(fs.existsSync(staged[0].path), false);
    assert.equal(fs.existsSync(staged[0].finalPath), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('failed JSON deletion restores files and successful deletion removes them', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-delete-'));
  const file = path.join(dir, 'b'.repeat(32));
  try {
    fs.writeFileSync(file, 'evidence');
    assert.throws(() => commitFileDeletions([file], () => { throw new Error('write failed'); }), /write failed/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'evidence');
    commitFileDeletions([file], () => {});
    assert.equal(fs.existsSync(file), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('startup reconciliation restores a trashed file still referenced by JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-reconcile-'));
  const name = 'c'.repeat(32);
  const trashed = path.join(dir, `.trash-${name}-abcdef123456`);
  try {
    fs.writeFileSync(trashed, 'evidence');
    const data = { projects: { Demo: { transcripts: [{ file: `/uploads/transcripts/${name}` }] } } };
    const changes = reconcileUploadDirectory(data, dir);
    assert.equal(fs.readFileSync(path.join(dir, name), 'utf8'), 'evidence');
    assert.equal(fs.existsSync(trashed), false);
    assert.deepEqual(changes, [`restored:${name}`]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
