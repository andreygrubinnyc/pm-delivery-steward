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
  return identifiers.some(identifier => containsIdentifier(segmentRaw, identifier));
}

function extractDsuUpdates(projectData, _transcript, sourceText) {
  if (!String(sourceText || '').trim()) return [];
  const segments = String(sourceText)
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map(segment => segment.replace(/^[#>*\-\s]+/, '').trim())
    .filter(Boolean);
  const stories = projectData && Array.isArray(projectData.stories) ? projectData.stories : [];
  const storiesByIdentifier = new Map();
  stories.forEach(story => {
    [story && story.id, story && story.jiraId]
      .map(value => String(value || '').trim().toLowerCase())
      .filter(Boolean)
      .forEach(identifier => {
        const matches = storiesByIdentifier.get(identifier) || [];
        matches.push(story);
        storiesByIdentifier.set(identifier, matches);
      });
  });

  const firstSegmentByStoryId = new Map();
  for (const segment of segments) {
    const tokens = new Set((segment.match(/[a-z0-9]+(?:[-_][a-z0-9]+)*/gi) || []).map(token => token.toLowerCase()));
    for (const token of tokens) {
      const matchingStories = storiesByIdentifier.get(token) || [];
      matchingStories.forEach(story => {
        if (!firstSegmentByStoryId.has(story.id)) firstSegmentByStoryId.set(story.id, segment);
      });
    }
  }

  return stories
    .filter(story => firstSegmentByStoryId.has(story.id))
    .map(story => ({
      storyId: story.id,
      excerpt: firstSegmentByStoryId.get(story.id).replace(/\s+/g, ' ').trim().slice(0, 220)
    }));
}

module.exports = { extractDsuUpdates, segmentIdentifiesStory };
