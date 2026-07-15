class ValidationError extends Error {}

const transcriptTypes = new Set(['DSU', 'Meeting', 'Interview', 'Call', 'Notes', 'Other', '1:1']);
const timelineStatuses = new Set(['Planned', 'Upcoming', 'Active', 'In progress', 'Blocked', 'At risk', 'Done', 'Complete', 'Not started']);

function plainObject(value, name = 'request body') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError(`${name} must be a JSON object.`);
  return value;
}

function rejectUnknownFields(value, allowed, name = 'request body') {
  const unexpected = Object.keys(value).filter(field => !allowed.has(field));
  if (unexpected.length) throw new ValidationError(`${name} contains an unexpected field: ${unexpected[0]}.`);
}

function text(value, name, { required = false, max = 20000, allowEmpty = true } = {}) {
  if (value === undefined) {
    if (required) throw new ValidationError(`${name} is required.`);
    return undefined;
  }
  if (typeof value !== 'string') throw new ValidationError(`${name} must be text.`);
  const cleaned = value.trim();
  if ((!allowEmpty || required) && !cleaned) throw new ValidationError(`${name} is required.`);
  if (cleaned.length > max) throw new ValidationError(`${name} is too long (max ${max} characters).`);
  return cleaned;
}

function bool(value, name) {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new ValidationError(`${name} must be true or false.`);
  return value;
}

function textList(value, name, { maxItems = 100, maxItem = 2000 } = {}) {
  if (value === undefined) return undefined;
  const items = typeof value === 'string' ? value.split(/[,\n]/) : value;
  if (!Array.isArray(items)) throw new ValidationError(`${name} must be a list of text values.`);
  if (items.length > maxItems) throw new ValidationError(`${name} contains too many values.`);
  return items.map((item, index) => text(item, `${name}[${index}]`, { max: maxItem })).filter(Boolean);
}

function dateOnly(value, name, { allowEmpty = true } = {}) {
  const cleaned = text(value, name, { max: 10, allowEmpty });
  if (cleaned === undefined || cleaned === '') return cleaned;
  const match = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new ValidationError(`${name} must use YYYY-MM-DD.`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) {
    throw new ValidationError(`${name} is not a valid calendar date.`);
  }
  return cleaned;
}

function dateTime(value, name) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const cleaned = text(value, name, { max: 40 });
  if (!Number.isFinite(new Date(cleaned).getTime())) throw new ValidationError(`${name} must be a valid date or timestamp.`);
  return cleaned;
}

function assertTimelineReference(projectData, timelineId) {
  if (!timelineId) return;
  if (!(projectData.timeline || []).some(entry => entry.id === timelineId)) throw new ValidationError('timelineId must reference an existing milestone.');
}

function validateStoryFields(body, projectData, { requireSummary = false } = {}) {
  plainObject(body);
  rejectUnknownFields(body, new Set([
    'summary', 'title', 'description', 'dependencies', 'environment', 'notes', 'timelineId', 'jiraId',
    'owner', 'assignee', 'sprint', 'lastUpdate', 'lastComment', 'lastUpdateNotes', 'project', 'id',
    'acceptanceCriteria', 'labels', 'tracked', 'contacted', 'commentAdded', 'logComment',
    'lastCommentedAt', 'sourceRow'
  ]));
  const out = {};
  const stringFields = {
    summary: [500, requireSummary], title: [500, false], description: [20000, false], dependencies: [10000, false],
    environment: [10000, false], notes: [50000, false], timelineId: [200, false], jiraId: [100, false],
    owner: [200, false], assignee: [200, false], sprint: [200, false], lastUpdate: [50000, false],
    lastComment: [50000, false], lastUpdateNotes: [50000, false], project: [120, false], id: [200, false]
  };
  Object.entries(stringFields).forEach(([field, [max, required]]) => {
    const value = text(body[field], field, { max, required, allowEmpty: !required });
    if (value !== undefined) out[field] = value;
  });
  if (requireSummary && out.summary === undefined) throw new ValidationError('summary is required.');
  const criteria = textList(body.acceptanceCriteria, 'acceptanceCriteria');
  if (criteria !== undefined) out.acceptanceCriteria = criteria;
  const labels = textList(body.labels, 'labels', { maxItems: 100, maxItem: 200 });
  if (labels !== undefined) out.labels = labels;
  ['tracked', 'contacted', 'commentAdded', 'logComment'].forEach(field => {
    const value = bool(body[field], field);
    if (value !== undefined) out[field] = value;
  });
  const commentedAt = dateTime(body.lastCommentedAt, 'lastCommentedAt');
  if (commentedAt !== undefined) out.lastCommentedAt = commentedAt;
  if (out.timelineId !== undefined) assertTimelineReference(projectData, out.timelineId);
  return out;
}

function validateStoryCreate(body, projectData) {
  return validateStoryFields(body, projectData, { requireSummary: true });
}

function validateStoryUpdate(body, projectData) {
  return validateStoryFields(body, projectData);
}

function validateTimelineFields(body, { requireTitle = false } = {}) {
  plainObject(body);
  rejectUnknownFields(body, new Set(['project', 'id', 'title', 'date', 'status', 'notes']));
  const out = {};
  const title = text(body.title, 'title', { required: requireTitle, max: 500, allowEmpty: !requireTitle });
  if (title !== undefined) out.title = title;
  const date = dateOnly(body.date, 'date');
  if (date !== undefined) out.date = date;
  const status = text(body.status, 'status', { max: 100 });
  if (status !== undefined) {
    if (!timelineStatuses.has(status)) throw new ValidationError('status is not supported.');
    out.status = status;
  }
  const notes = text(body.notes, 'notes', { max: 50000 });
  if (notes !== undefined) out.notes = notes;
  return out;
}

function validateTimelineCreate(body) { return validateTimelineFields(body, { requireTitle: true }); }
function validateTimelineUpdate(body) { return validateTimelineFields(body); }

function validateTranscriptUpdate(body) {
  plainObject(body);
  rejectUnknownFields(body, new Set(['project', 'id', 'title', 'notes', 'date', 'type']));
  const out = {};
  ['title', 'notes'].forEach(field => {
    const value = text(body[field], field, { max: field === 'title' ? 500 : 50000 });
    if (value !== undefined) out[field] = value;
  });
  const date = dateOnly(body.date, 'date');
  if (date !== undefined) out.date = date;
  if (body.type !== undefined) {
    const type = text(body.type, 'type', { max: 20, allowEmpty: false });
    if (!transcriptTypes.has(type)) throw new ValidationError('type is not supported.');
    out.type = type;
  }
  return out;
}

function validateTranscriptUpload(body) {
  plainObject(body, 'upload details');
  rejectUnknownFields(body, new Set(['notes', 'date', 'title', 'type', 'metadata']), 'upload details');
  const out = {
    notes: text(body.notes, 'notes', { max: 50000 }) || '',
    date: dateOnly(body.date, 'date') || '',
    title: text(body.title, 'title', { max: 500 }) || '',
    type: text(body.type, 'type', { max: 20 }) || 'Notes'
  };
  if (!transcriptTypes.has(out.type)) throw new ValidationError('type is not supported.');
  if (!Array.isArray(body.metadata)) throw new ValidationError('metadata must be an array.');
  if (body.metadata.length > 5) throw new ValidationError('metadata contains too many entries.');
  out.metadata = body.metadata.map((entry, index) => {
    plainObject(entry, `metadata[${index}]`);
    rejectUnknownFields(entry, new Set(['title', 'type']), `metadata[${index}]`);
    const title = text(entry.title, `metadata[${index}].title`, { max: 500 }) || '';
    const type = text(entry.type, `metadata[${index}].type`, { max: 20 }) || out.type;
    if (!transcriptTypes.has(type)) throw new ValidationError(`metadata[${index}].type is not supported.`);
    return { title, type };
  });
  return out;
}

module.exports = {
  ValidationError,
  plainObject,
  rejectUnknownFields,
  text,
  bool,
  textList,
  dateOnly,
  dateTime,
  validateStoryCreate,
  validateStoryUpdate,
  validateTimelineCreate,
  validateTimelineUpdate,
  validateTranscriptUpdate,
  validateTranscriptUpload,
  transcriptTypes
};
