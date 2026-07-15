function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function significantWords(value) {
  return normalizeText(value).split(' ').filter(word => word.length > 3);
}

function containsIdentifier(segment, identifier) {
  const escaped = String(identifier || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!escaped) return false;
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i').test(String(segment || ''));
}

function segmentIdentifiesStory(segment, story) {
  const segmentRaw = String(segment || '');
  const identifiers = [story && story.id, story && story.jiraId]
    .map(value => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  if (identifiers.some(identifier => containsIdentifier(segmentRaw, identifier))) return true;

  const storySummary = normalizeText(story && story.summary);
  const words = significantWords(story && story.summary);
  if (words.length < 2) return false;

  const segmentText = normalizeText(segmentRaw);
  if (storySummary && segmentText.includes(storySummary)) return true;

  const segmentWords = new Set(segmentText.split(' '));
  const matchedWords = words.filter(word => segmentWords.has(word)).length;
  const required = words.length <= 3 ? words.length : Math.max(3, Math.ceil(words.length * 0.75));
  return matchedWords >= required;
}

function extractDsuUpdates(projectData, _transcript, sourceText) {
  if (!normalizeText(sourceText)) return [];
  const segments = String(sourceText)
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map(segment => segment.replace(/^[#>*\-\s]+/, '').trim())
    .filter(Boolean);

  const updates = [];
  (projectData && Array.isArray(projectData.stories) ? projectData.stories : []).forEach(story => {
    const evidenceSegment = segments.find(segment => segmentIdentifiesStory(segment, story));
    if (!evidenceSegment) return;
    updates.push({
      storyId: story.id,
      excerpt: evidenceSegment.replace(/\s+/g, ' ').trim().slice(0, 220)
    });
  });
  return updates;
}

module.exports = { extractDsuUpdates, segmentIdentifiesStory };
