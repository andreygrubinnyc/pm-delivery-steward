const { createPersistentId } = require('./runtime-security');

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sourceRefFrom(transcript, item) {
  return {
    transcriptId: String(transcript.id || ''),
    transcriptTitle: String(transcript.title || ''),
    date: String(transcript.date || transcript.uploadedAt || new Date().toISOString()),
    source: String(item.source || transcript.title || '')
  };
}

function normalizeSourceRefs(update) {
  const refs = Array.isArray(update.sourceRefs)
    ? update.sourceRefs.filter(ref => ref && ref.transcriptId).map(ref => ({
      transcriptId: String(ref.transcriptId),
      transcriptTitle: String(ref.transcriptTitle || ''),
      date: String(ref.date || ''),
      source: String(ref.source || ref.transcriptTitle || '')
    }))
    : [];
  if (!refs.length && update.transcriptId) {
    refs.push({
      transcriptId: String(update.transcriptId),
      transcriptTitle: String(update.transcriptTitle || ''),
      date: String(update.date || ''),
      source: String(update.source || update.transcriptTitle || '')
    });
  }
  return refs;
}

function dateScore(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function synchronizeUpdate(update) {
  update.sourceRefs = normalizeSourceRefs(update);
  if (update.sourceRefs.length) {
    const latest = [...update.sourceRefs].sort((a, b) => dateScore(b.date) - dateScore(a.date))[0];
    update.transcriptId = latest.transcriptId;
    update.transcriptTitle = latest.transcriptTitle;
    update.date = latest.date;
    update.source = latest.source;
  }
  return update;
}

function recalculateStoryDerivedFields(story, { clearWhenEmpty = false } = {}) {
  story.updates = (Array.isArray(story.updates) ? story.updates : []).map(synchronizeUpdate);
  const latest = [...story.updates].sort((a, b) => dateScore(b.date) - dateScore(a.date))[0];
  if (latest && latest.date) story.lastUpdate = latest.date;
  else if (clearWhenEmpty || /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(String(story.lastUpdate || ''))) story.lastUpdate = '';
  return story;
}

function attachUpdatesToStories(projectData, transcript, updates, options = {}) {
  const createId = options.createId || createPersistentId;
  const storyMap = new Map((projectData.stories || []).map(story => [story.id, story]));
  (updates || []).forEach(item => {
    const story = storyMap.get(item.storyId);
    if (!story) return;
    if (!Array.isArray(story.updates)) story.updates = [];
    const text = cleanText(item.update || item.excerpt);
    if (!text) return;
    const ref = sourceRefFrom(transcript, item);
    const existing = story.updates.find(update => cleanText(update.update || update.excerpt) === text);
    if (existing) {
      existing.sourceRefs = normalizeSourceRefs(existing);
      if (!existing.sourceRefs.some(current => current.transcriptId === ref.transcriptId)) existing.sourceRefs.push(ref);
      synchronizeUpdate(existing);
    } else {
      story.updates.unshift(synchronizeUpdate({
        id: createId('update'),
        transcriptId: ref.transcriptId,
        transcriptTitle: ref.transcriptTitle,
        excerpt: String(item.excerpt || ''),
        update: String(item.update || item.excerpt || ''),
        date: ref.date,
        source: ref.source,
        sourceRefs: [ref]
      }));
    }
    recalculateStoryDerivedFields(story);
  });
}

function removeTranscriptEvidence(projectData, transcriptId) {
  (projectData.stories || []).forEach(story => {
    story.updates = (Array.isArray(story.updates) ? story.updates : []).flatMap(update => {
      const refs = normalizeSourceRefs(update).filter(ref => ref.transcriptId !== transcriptId);
      if (!refs.length) return [];
      update.sourceRefs = refs;
      return [synchronizeUpdate(update)];
    });
    recalculateStoryDerivedFields(story, { clearWhenEmpty: true });
  });
}

function removeStoryUpdate(story, updateId) {
  story.updates = (Array.isArray(story.updates) ? story.updates : []).filter(update => update.id !== updateId);
  return recalculateStoryDerivedFields(story, { clearWhenEmpty: true });
}

function storyLastCommentText(story) {
  const comment = String(story && story.lastComment || '').trim();
  if (comment) return comment;
  const legacy = String(story && story.lastUpdate || '').trim();
  return /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(legacy) ? '' : legacy;
}

module.exports = {
  attachUpdatesToStories,
  removeTranscriptEvidence,
  removeStoryUpdate,
  recalculateStoryDerivedFields,
  storyLastCommentText
};
