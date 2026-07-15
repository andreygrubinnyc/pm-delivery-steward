const express = require('express');
const fs = require('fs');
const path = require('path');
const Busboy = require('busboy');
const { rateLimit } = require('express-rate-limit');
const {
  isTrustedMutationRequest,
  operatingStatusFromValue,
  operatingStatusFromLabels,
  daysSinceIso,
  localDateKey,
  daysUntilDateOnly
} = require('./public/security');
const {
  ProviderRequestError,
  ProviderTimeoutError,
  createPersistentId,
  fetchWithTimeout,
  getTrustedClaudeApiUrl
} = require('./lib/runtime-security');
const { extractDsuUpdates } = require('./lib/delivery-integrity');
const {
  attachUpdatesToStories,
  removeTranscriptEvidence,
  removeStoryUpdate,
  storyLastCommentText
} = require('./lib/evidence-integrity');
const {
  stageUploadFiles,
  rollbackStagedUploads,
  commitStagedUploads,
  commitFileDeletions,
  transcriptDiskPath,
  reconcileUploadDirectory
} = require('./lib/storage-integrity');
const {
  ValidationError,
  plainObject,
  rejectUnknownFields,
  text: validateText,
  bool: validateBoolean,
  textList: validateTextList,
  validateStoryCreate,
  validateStoryUpdate,
  validateTimelineCreate,
  validateTimelineUpdate,
  validateTranscriptUpdate,
  validateTranscriptUpload
} = require('./lib/input-validation');
const {
  buildEvidenceRecords,
  formatGroundedEvidence,
  selectGroundedClaims
} = require('./lib/grounded-ai');

// Lightweight .env loader (dependency-free). Loads the local optional config into process.env
// without overriding variables already set in the real environment.
function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && !(key in process.env)) process.env[key] = value;
    }
  } catch (error) {
    console.warn('Unable to read .env file:', error.message);
  }
}
loadEnvFile();

const app = express();
// Wrap async route handlers so thrown errors / rejected promises reach the error
// middleware (Express 4 doesn't auto-catch async errors — they'd otherwise hang the request).
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const dataDir = path.join(__dirname, 'data');
const dataFile = path.join(dataDir, 'pilot-data.json');
const demoDataFile = path.join(dataDir, 'demo-data.json');
const transcriptsDir = path.join(dataDir, 'uploads', 'transcripts');

fs.mkdirSync(transcriptsDir, { recursive: true });

const allowedUploadExtensions = new Set(['.txt', '.md', '.csv', '.json', '.log', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.png', '.jpg', '.jpeg']);
const maxUploadSize = 10 * 1024 * 1024;
const maxUploadRequestSize = 20 * 1024 * 1024;

function parseMultipart(req, { maxFiles = 5, allowedFields = [] } = {}) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const files = [];
    let failure = null;
    let receivedBytes = 0;
    let parser;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: {
          files: maxFiles,
          fileSize: maxUploadSize,
          fields: Math.max(allowedFields.length, 1),
          fieldSize: 256 * 1024
        }
      });
    } catch (_) {
      reject(new Error('Expected a multipart form upload.'));
      return;
    }
    parser.on('field', (name, value, info) => {
      if (info.valueTruncated) failure = new Error('Each upload field must be 256 KB or smaller.');
      if (!allowedFields.length || allowedFields.includes(name)) fields[name] = value;
    });
    parser.on('file', (fieldname, stream, info) => {
      const extension = path.extname(info.filename || '').toLowerCase();
      const chunks = [];
      if (!allowedUploadExtensions.has(extension)) failure = new Error('This file type is not supported.');
      stream.on('data', chunk => { if (!failure) chunks.push(chunk); });
      stream.on('limit', () => { failure = new Error('Each uploaded file must be 10 MB or smaller.'); });
      stream.on('end', () => {
        if (!failure) files.push({ fieldname, originalname: info.filename, mimetype: info.mimeType, buffer: Buffer.concat(chunks) });
      });
    });
    parser.on('filesLimit', () => { failure = new Error(`Upload up to ${maxFiles} files at a time.`); });
    parser.on('fieldsLimit', () => { failure = new Error('Too many upload fields.'); });
    parser.on('error', reject);
    parser.on('finish', () => failure ? reject(failure) : resolve({ fields, files }));
    // Count the entire request, not only file payloads, so large text fields cannot bypass the aggregate limit.
    req.on('data', chunk => {
      receivedBytes += chunk.length;
      if (receivedBytes > maxUploadRequestSize) failure = new Error('Uploads are limited to 20 MB per request.');
    });
    req.pipe(parser);
  });
}

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'");
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use((req, res, next) => {
  if (!isTrustedMutationRequest({
    method: req.method,
    host: req.headers.host,
    origin: req.headers.origin,
    fetchSite: req.headers['sec-fetch-site']
  })) {
    return res.status(403).json({ error: 'Request origin is not allowed.' });
  }
  next();
});
const generalRateLimit = rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false });
const uploadRateLimit = rateLimit({ windowMs: 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });
app.use(generalRateLimit);
app.use(express.json({ limit: '1mb' }));
app.use('/static', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(dataDir, 'uploads'), {
  setHeaders(res) { res.setHeader('Content-Disposition', 'attachment'); }
}));

function readData() {
  if (!fs.existsSync(dataFile)) {
    if (fs.existsSync(demoDataFile)) fs.copyFileSync(demoDataFile, dataFile);
    else fs.writeFileSync(dataFile, JSON.stringify({ projects: {} }, null, 2));
  }
  const raw = fs.readFileSync(dataFile, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    // Do NOT overwrite/reset on parse failure — that would destroy data. Surface a clear
    // error (handled by the error middleware → clean 500) so the file can be fixed/restored.
    throw new Error('The local data file is invalid JSON. It was left unchanged; restore it from a backup or replace it with demo data.');
  }
}

function writeData(data) {
  // Write to a temp file then rename, so a crash or concurrent write can never
  // leave pilot-data.json half-written (rename is atomic on the same filesystem).
  const tmpFile = `${dataFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
  fs.renameSync(tmpFile, dataFile);
}

function sanitizeName(name) {
  return name.replace(/[\/\\?%*:|"<>]/g, '').trim();
}

function isSafeObjectKey(value) {
  return !['__proto__', 'prototype', 'constructor'].includes(String(value || '').toLowerCase());
}

function getProject(data, name) {
  if (!isSafeObjectKey(name) || !data.projects || !Object.hasOwn(data.projects, name)) return null;
  return data.projects[name];
}

try {
  const storageChanges = reconcileUploadDirectory(readData(), transcriptsDir);
  if (storageChanges.length) console.warn(`Reconciled ${storageChanges.length} interrupted or orphaned upload file(s).`);
} catch (error) {
  console.warn('Upload storage reconciliation could not run:', error.message);
}

// Remove an uploaded transcript's file from disk (basename guards against path traversal).
function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function getAssigneeDirectory(projectData) {
  const source = (projectData && projectData.assigneeDirectory) || {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([alias, name]) => [normalizeText(alias), String(name || '').trim()])
      .filter(([alias, name]) => alias && name)
  );
}

function resolveProjectAssignee(projectData, assignee) {
  const recorded = String(assignee || '').trim();
  return getAssigneeDirectory(projectData)[normalizeText(recorded)] || recorded;
}

const operatingStatuses = new Set(['Blocked', 'In progress', 'Active', 'Planned', 'Done', 'Not started']);

function statusMappingKey(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function getProjectStatusMappings(projectData) {
  const source = (projectData && projectData.statusMappings) || {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([jiraStatus, operatingStatus]) => [statusMappingKey(jiraStatus), String(operatingStatus || '').trim()])
      .filter(([jiraStatus, operatingStatus]) => jiraStatus && operatingStatuses.has(operatingStatus))
  );
}

function mappedOperatingStatus(projectData, jiraStatus) {
  return getProjectStatusMappings(projectData)[statusMappingKey(jiraStatus)] || '';
}

function defaultOperatingStatus(jiraStatus) {
  return operatingStatusFromValue(jiraStatus);
}

function applyOperatingStatusLabel(labels, operatingStatus) {
  const standardLabels = new Set(['done', 'in progress', 'in-progress', 'blocked', 'active', 'planned', 'not started', 'not-started']);
  const next = (Array.isArray(labels) ? labels : []).filter(label => !standardLabels.has(normalizeText(label)));
  return operatingStatus ? [...new Set([operatingStatus.toLowerCase(), ...next])] : next;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const input = String(text || '').replace(/^\uFEFF/, '');
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (char !== '\r') cell += char;
  }
  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

function csvHeaderKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const csvColumnAliases = {
  jiraId: ['issue key', 'issuekey', 'jira key', 'jira id', 'key'],
  summary: ['summary', 'issue summary', 'title'],
  description: ['description', 'issue description'],
  status: ['status', 'issue status'],
  assignee: ['assignee', 'owner', 'assigned to'],
  sprint: ['sprint'],
  labels: ['labels', 'label'],
  dependencies: ['dependencies', 'dependency', 'blocks', 'blocked by'],
  environment: ['environment'],
  acceptanceCriteria: ['acceptance criteria', 'acceptance criteria text'],
  lastComment: ['last comment', 'comment', 'comments', 'pm note', 'last update'],
  lastCommentedAt: ['comment date', 'last commented', 'last comment date']
};

function csvValue(row, columns, name) {
  const index = columns[name];
  return index === undefined ? '' : String(row[index] || '').trim();
}

function labelsFromImportedStatus(projectData, status, labels) {
  const statusLabel = mappedOperatingStatus(projectData, status) || defaultOperatingStatus(status);
  const imported = String(labels || '').split(',').map(value => value.trim()).filter(Boolean);
  const originalStatusLabel = statusMappingKey(status) ? [`original-status:${statusMappingKey(status)}`] : [];
  return applyOperatingStatusLabel([...imported, ...originalStatusLabel], statusLabel);
}

function mapCsvWorkItems(csvText, projectData) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error('CSV needs a header row and at least one data row');
  const headers = rows[0].map(csvHeaderKey);
  const columns = {};
  Object.entries(csvColumnAliases).forEach(([field, aliases]) => {
    const index = headers.findIndex(header => aliases.includes(header));
    if (index !== -1) columns[field] = index;
  });
  if (columns.summary === undefined) throw new Error('CSV needs a Summary, Issue Summary, or Title column');

  const existingJiraIds = new Set((projectData.stories || []).map(story => normalizeText(story.jiraId)).filter(Boolean));
  const seenJiraIds = new Set();
  const items = [];
  const skipped = [];
  rows.slice(1).forEach((row, index) => {
    const summary = csvValue(row, columns, 'summary');
    const jiraId = csvValue(row, columns, 'jiraId');
    if (!summary) { skipped.push({ row: index + 2, reason: 'Missing summary' }); return; }
    const normalizedJiraId = normalizeText(jiraId);
    if (normalizedJiraId && (existingJiraIds.has(normalizedJiraId) || seenJiraIds.has(normalizedJiraId))) {
      skipped.push({ row: index + 2, reason: `Duplicate Jira key: ${jiraId}` });
      return;
    }
    if (normalizedJiraId) seenJiraIds.add(normalizedJiraId);
    items.push({
      summary,
      jiraId,
      description: csvValue(row, columns, 'description'),
      acceptanceCriteria: csvValue(row, columns, 'acceptanceCriteria').split(/\r?\n/).map(value => value.trim()).filter(Boolean),
      dependencies: csvValue(row, columns, 'dependencies'),
      labels: labelsFromImportedStatus(projectData, csvValue(row, columns, 'status'), csvValue(row, columns, 'labels')),
      environment: csvValue(row, columns, 'environment'),
      assignee: resolveProjectAssignee(projectData, csvValue(row, columns, 'assignee')),
      sprint: csvValue(row, columns, 'sprint'),
      lastComment: csvValue(row, columns, 'lastComment'),
      lastCommentedAt: csvValue(row, columns, 'lastCommentedAt'),
      sourceRow: index + 2
    });
  });
  return { columns: Object.keys(columns), items, skipped };
}

const defaultStatusReportPrompt = 'Prioritize current operating status, explicit blockers and dependencies, milestone pressure, recent captured updates, and evidence gaps. Prefer concise evidence that will help a project manager verify the deterministic status summary.';

function getAiPrompts(data) {
  if (!data.aiPrompts) {
    data.aiPrompts = {};
  }
  return {
    statusReport: data.aiPrompts.statusReport || defaultStatusReportPrompt
  };
}

function storyAssignee(story) {
  return String((story && (story.assignee || story.owner)) || '').trim();
}

function storySprint(story) {
  return String((story && story.sprint) || '').trim();
}

// App-wide settings for follow-up nudges and controlled vocab like sprint names.
// Stored under data.settings; falls back to defaults when absent or invalid.
const defaultSettings = { commentStaleDays: 7, sprintOptions: [] };
function getSettings(data) {
  const s = (data && data.settings) || {};
  const n = parseInt(s.commentStaleDays, 10);
  const sprintOptions = Array.isArray(s.sprintOptions)
    ? s.sprintOptions.map(value => String(value || '').trim()).filter(Boolean)
    : [];
  return {
    commentStaleDays: Number.isFinite(n) && n > 0 ? n : defaultSettings.commentStaleDays,
    sprintOptions
  };
}

function getProvider() {
  const provider = (process.env.AI_PROVIDER || '').toLowerCase();
  if (provider === 'claude' && process.env.CLAUDE_API_KEY) return 'claude';
  if (provider === 'openai' && process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.CLAUDE_API_KEY) return 'claude';
  return null;
}

function normalizeLlmRequest(request) {
  if (request && typeof request === 'object') {
    return {
      system: String(request.system || 'You are a helpful project delivery operations assistant.'),
      user: String(request.user || '')
    };
  }
  return {
    system: 'You are a helpful project delivery operations assistant. Follow the user\'s instructions exactly and return only what they ask for, in the requested format.',
    user: String(request || '')
  };
}

async function callOpenAIApi(request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');

  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  const maxTokens = parseInt(process.env.OPENAI_MAX_TOKENS, 10) || 2000;
  const llmRequest = normalizeLlmRequest(request);
  const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: llmRequest.system },
        { role: 'user', content: llmRequest.user }
      ],
      temperature: 0.1,
      max_tokens: maxTokens
    })
  });

  let data;
  try { data = await response.json(); }
  catch (_) { throw new ProviderRequestError('OpenAI returned an unreadable response.'); }
  if (!response.ok) {
    throw new ProviderRequestError(`OpenAI API error ${response.status}: ${data?.error?.message || 'unknown error'}`);
  }
  return data?.choices?.[0]?.message?.content || '';
}

async function callClaudeApi(request) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('Missing CLAUDE_API_KEY');

  const apiUrl = getTrustedClaudeApiUrl();
  const llmRequest = normalizeLlmRequest(request);
  const response = await fetchWithTimeout(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL || 'claude-opus-4-8',
      max_tokens: parseInt(process.env.CLAUDE_MAX_TOKENS, 10) || 2000,
      system: llmRequest.system,
      messages: [{ role: 'user', content: llmRequest.user }]
    })
  });

  let data;
  try { data = await response.json(); }
  catch (_) { throw new ProviderRequestError('Claude returned an unreadable response.'); }
  if (!response.ok) {
    throw new ProviderRequestError(`Claude API error ${response.status}: ${data?.error?.message || 'unknown error'}`);
  }
  // The Messages API returns a content array of typed blocks; concatenate the text blocks.
  if (Array.isArray(data?.content)) {
    return data.content.filter(block => block.type === 'text').map(block => block.text).join('');
  }
  return '';
}

async function callLlm(request) {
  const provider = getProvider();
  if (!provider) {
    throw new Error('No AI provider configured. Set OPENAI_API_KEY or CLAUDE_API_KEY.');
  }
  if (provider === 'openai') {
    return await callOpenAIApi(request);
  }
  return await callClaudeApi(request);
}


function inferStoryStatus(story) {
  const recordedStatus = operatingStatusFromLabels(story && story.labels);
  if (recordedStatus) return recordedStatus;
  if (story.updates && story.updates.length) return 'Active';
  if (story.timelineId) return 'Planned';
  return 'Not started';
}

function itemNeedsFollowupServer(story) {
  return !!story.tracked && inferStoryStatus(story) !== 'Done' && !story.contacted;
}

function itemNeedsCommentServer(story, settings) {
  if (!story.tracked || inferStoryStatus(story) === 'Done') return false;
  const d = daysSinceIso(story.lastCommentedAt);
  return d === null || d >= ((settings && settings.commentStaleDays) || 7);
}

function milestoneHealthLabel(entry) {
  if (operatingStatusFromValue(entry && entry.status) === 'Done') return 'Complete';
  const until = daysUntilDateOnly(entry && entry.date);
  if (until === null) return 'No date';
  if (until < 0) return 'Overdue';
  if (until <= 7) return 'Due soon';
  if (until <= 21) return 'Upcoming';
  return 'On horizon';
}

function storyDisplay(story) {
  return story.jiraId ? `${story.jiraId} · ${story.summary}` : story.summary;
}

function generateHeuristicStatusReport(projectData, projectName, settings) {
  const timeline = [...projectData.timeline].sort((a, b) => {
    return String(a.date || '').localeCompare(String(b.date || ''));
  });
  const stories = [...projectData.stories];
  const transcripts = [...projectData.transcripts];
  const blocked = stories.filter(story => inferStoryStatus(story) === 'Blocked');
  const active = stories.filter(story => ['In progress', 'Active'].includes(inferStoryStatus(story)));
  const done = stories.filter(story => inferStoryStatus(story) === 'Done');
  const followup = stories.filter(story => itemNeedsFollowupServer(story));
  const quiet = stories.filter(story => itemNeedsCommentServer(story, settings));
  const overdue = timeline.filter(entry => milestoneHealthLabel(entry) === 'Overdue');
  const dueSoon = timeline.filter(entry => milestoneHealthLabel(entry) === 'Due soon');
  const undated = timeline.filter(entry => milestoneHealthLabel(entry) === 'No date');
  const linkedMilestones = timeline.filter(entry => stories.some(story => story.timelineId === entry.id)).length;
  const updates = [];
  stories.forEach(story => {
    (story.updates || []).forEach(update => updates.push({
      story,
      update
    }));
  });
  updates.sort((a, b) => new Date(b.update.date || 0) - new Date(a.update.date || 0));

  let overallSignal = 'Mixed signals based on recorded data.';
  if (blocked.length || overdue.length) {
    overallSignal = 'At risk based on recorded blockers or overdue milestones.';
  } else if (active.length && !followup.length && !quiet.length && !dueSoon.length) {
    overallSignal = 'In motion with no explicit blockers recorded.';
  } else if (!stories.length && !timeline.length && !transcripts.length) {
    overallSignal = 'Insufficient recorded data to assess status.';
  } else if (!blocked.length && !overdue.length && (followup.length || quiet.length || dueSoon.length)) {
    overallSignal = 'Mixed signals based on follow-up or milestone pressure.';
  }

  const lines = [];
  lines.push(`# ${projectName} Status Summary`);
  lines.push('');
  lines.push('## Overall Status');
  lines.push(`- Status signal: ${overallSignal}`);
  lines.push(`- Executive summary: ${stories.length} work item(s), ${timeline.length} milestone(s), and ${transcripts.length} captured source(s) are recorded. ${done.length} work item(s) are marked done, ${active.length} are active or in progress, and ${blocked.length} are blocked. ${updates.length ? `${updates.length} captured update(s) are available to support the narrative.` : 'No captured work-item updates are available yet.'}`);
  lines.push('');
  lines.push('## Delivery Highlights');
  if (done.length) {
    lines.push(`- ${done.length} work item(s) are recorded as done.`);
  }
  if (active.length) {
    lines.push(`- ${active.length} work item(s) are recorded as active or in progress.`);
  }
  if (updates.length) {
    const latest = updates[0];
    lines.push(`- Latest captured work-item evidence: ${storyDisplay(latest.story)}${latest.update.date ? ` (${latest.update.date})` : ''}.`);
  }
  if (timeline.length) {
    lines.push(`- ${linkedMilestones} of ${timeline.length} milestone(s) are linked to work items.`);
  }
  if (!done.length && !active.length && !updates.length && !timeline.length) {
    lines.push('- No explicit delivery progress is recorded yet.');
  }

  lines.push('');
  lines.push('## Risks and Blockers');
  if (blocked.length || followup.length || quiet.length || overdue.length || dueSoon.length) {
    blocked.slice(0, 5).forEach(story => {
      lines.push(`- ${storyDisplay(story)} is blocked${story.dependencies ? ` by ${story.dependencies}` : ''}.`);
    });
    followup.slice(0, 5).forEach(story => {
      lines.push(`- ${storyDisplay(story)} needs assignee follow-up${storyAssignee(story) ? ` (${storyAssignee(story)})` : ''}.`);
    });
    quiet.slice(0, 5).forEach(story => {
      lines.push(`- ${storyDisplay(story)} has no recent Jira comment recorded${story.lastCommentedAt ? ` since ${story.lastCommentedAt}` : ''}.`);
    });
    overdue.slice(0, 5).forEach(entry => {
      lines.push(`- Milestone "${entry.title}" is overdue${entry.date ? ` (${entry.date})` : ''}.`);
    });
    dueSoon.slice(0, 5).forEach(entry => {
      lines.push(`- Milestone "${entry.title}" is due soon${entry.date ? ` (${entry.date})` : ''}.`);
    });
  } else {
    lines.push('- No explicit risks recorded.');
  }

  lines.push('');
  lines.push('## Milestones');
  if (timeline.length) {
    timeline.slice(0, 10).forEach(entry => {
      const health = milestoneHealthLabel(entry);
      const meta = [entry.date || 'No date', entry.status || health].filter(Boolean).join(' · ');
      lines.push(`- ${entry.title} — ${meta}`);
      if (entry.notes) lines.push(`  - Notes: ${entry.notes}`);
    });
  } else {
    lines.push('- No milestones recorded.');
  }

  lines.push('');
  lines.push('## Work Items Needing Attention');
  if (stories.length) {
    const attention = stories
      .map(story => ({
        story,
        status: inferStoryStatus(story),
        score:
          (inferStoryStatus(story) === 'Blocked' ? 5 : 0) +
          (itemNeedsFollowupServer(story) ? 4 : 0) +
          (itemNeedsCommentServer(story, settings) ? 3 : 0) +
          ((story.updates || []).length ? 0 : 1)
      }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    if (attention.length) {
      attention.forEach(entry => {
        const notes = [];
        if (entry.status === 'Blocked') notes.push('blocked');
        if (itemNeedsFollowupServer(entry.story)) notes.push('assignee follow-up needed');
        if (itemNeedsCommentServer(entry.story, settings)) notes.push('quiet Jira thread');
        if (!(entry.story.updates || []).length) notes.push('no captured updates');
        lines.push(`- ${storyDisplay(entry.story)}${notes.length ? ` — ${notes.join(', ')}` : ''}.`);
      });
    } else {
      lines.push('- No specific work items are currently flagged for attention.');
    }
  } else {
    lines.push('- No work items recorded.');
  }

  lines.push('');
  lines.push('## Evidence Gaps');
  if (!stories.length) lines.push('- No work items are recorded yet.');
  if (!updates.length) lines.push('- No captured work-item updates are available.');
  if (!transcripts.length) lines.push('- No transcript or DSU sources are available.');
  if (!timeline.length) lines.push('- No milestones are recorded.');
  if (undated.length) lines.push(`- ${undated.length} milestone(s) do not have dates.`);
  if (timeline.length && linkedMilestones < timeline.length) lines.push(`- ${timeline.length - linkedMilestones} milestone(s) are not linked to work items.`);
  if (transcripts.length) {
    transcripts.slice(0, 5).forEach(transcript => {
      if (transcript.notes || transcript.date || transcript.type) return;
      lines.push(`- Transcript "${transcript.title}" has limited structured metadata.`);
    });
  }
  if (lines[lines.length - 1] === '## Evidence Gaps') {
    lines.push('- No obvious evidence gaps are visible from the recorded data.');
  }

  return lines.join('\n');
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/projects', (req, res) => {
  const data = readData();
  res.json(data.projects || {});
});

app.post('/api/projects', (req, res) => {
  plainObject(req.body);
  rejectUnknownFields(req.body, new Set(['name', 'description']));
  const name = validateText(req.body.name, 'name', { required: true, max: 120 });
  const description = validateText(req.body.description, 'description', { max: 10000 }) || '';

  const projectName = sanitizeName(name);
  if (!projectName || !isSafeObjectKey(projectName)) {
    return res.status(400).json({ error: 'Invalid project name' });
  }
  const data = readData();
  if (!data.projects) {
    data.projects = {};
  }
  if (getProject(data, projectName)) {
    return res.status(409).json({ error: 'Project already exists' });
  }

  const projectData = {
    description,
    stories: [],
    timeline: [],
    transcripts: []
  };
  Object.defineProperty(data.projects, projectName, { value: projectData, enumerable: true, configurable: true, writable: true });
  writeData(data);

  res.json({ name: projectName, project: projectData });
});

app.put('/api/project', (req, res) => {
  plainObject(req.body);
  rejectUnknownFields(req.body, new Set(['name', 'description']));
  const name = validateText(req.body.name, 'name', { required: true, max: 120 });
  const description = validateText(req.body.description, 'description', { max: 10000 });
  const data = readData();
  const projectData = getProject(data, name);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }
  if (description !== undefined) projectData.description = description;
  writeData(data);
  res.json({ name, project: projectData });
});

app.delete('/api/project', (req, res) => {
  const name = req.query.name;
  if (!name) {
    return res.status(400).json({ error: 'Missing project name' });
  }
  const data = readData();
  const projectData = getProject(data, name);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const filePaths = (projectData.transcripts || []).map(transcript => transcriptDiskPath(transcript, transcriptsDir)).filter(Boolean);
  delete data.projects[name];
  const cleanupWarnings = commitFileDeletions(filePaths, () => writeData(data));
  res.json({ success: true, warnings: cleanupWarnings });
});

app.get('/api/project', (req, res) => {
  const name = req.query.name;
  if (!name) {
    return res.status(400).json({ error: 'Missing project name' });
  }

  const data = readData();
  const project = getProject(data, name);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  res.json(project);
});

app.get('/api/ai/prompts', (req, res) => {
  const data = readData();
  const prompts = getAiPrompts(data);
  res.json(prompts);
});

app.put('/api/ai/prompts', (req, res) => {
  plainObject(req.body);
  rejectUnknownFields(req.body, new Set(['statusReport']));
  const statusReport = validateText(req.body.statusReport, 'statusReport', { max: 50000 });
  if (statusReport === undefined) {
    return res.status(400).json({ error: 'Missing prompt updates' });
  }

  const data = readData();
  const prompts = getAiPrompts(data);
  if (statusReport !== undefined) prompts.statusReport = statusReport;
  data.aiPrompts = prompts;
  writeData(data);
  res.json(prompts);
});

app.get('/api/settings', (req, res) => {
  const data = readData();
  res.json(getSettings(data));
});

// Read-only environment info for the UI (e.g. the sidebar AI-mode footer). Never leaks the
// key itself — only which provider (if any) is active. null → fully heuristic mode.
app.get('/api/meta', (req, res) => {
  res.json({ provider: getProvider() });
});

app.put('/api/settings', (req, res) => {
  plainObject(req.body);
  rejectUnknownFields(req.body, new Set(['commentStaleDays', 'sprintOptions']));
  const { commentStaleDays, sprintOptions } = req.body;
  if (commentStaleDays === undefined && sprintOptions === undefined) {
    return res.status(400).json({ error: 'Missing settings updates' });
  }
  const data = readData();
  if (!data.settings) data.settings = {};
  if (commentStaleDays !== undefined) {
    if (!Number.isInteger(commentStaleDays) || commentStaleDays < 1 || commentStaleDays > 365) {
      return res.status(400).json({ error: 'commentStaleDays must be a number between 1 and 365' });
    }
    data.settings.commentStaleDays = commentStaleDays;
  }
  if (sprintOptions !== undefined) {
    data.settings.sprintOptions = validateTextList(sprintOptions, 'sprintOptions', { maxItems: 200, maxItem: 200 });
  }
  writeData(data);
  res.json(getSettings(data));
});

app.post('/api/project/status-report', wrap(async (req, res) => {
  plainObject(req.body);
  rejectUnknownFields(req.body, new Set(['project', 'mode']));
  const project = validateText(req.body.project, 'project', { required: true, max: 120 });
  const mode = validateText(req.body.mode, 'mode', { max: 20 }) || 'heuristic';
  if (!['heuristic', 'ai'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid status summary mode' });
  }

  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const settings = getSettings(data);
  const prompts = getAiPrompts(data);
  let report = '';
  let source = 'heuristic';
  let warning = '';

  if (mode === 'heuristic') {
    report = generateHeuristicStatusReport(projectData, project, settings);
  } else {
    if (!getProvider()) {
      return res.status(400).json({ error: 'AI drafting is not configured. Add a provider key in web/.env and restart the app.' });
    }
    const heuristicReport = generateHeuristicStatusReport(projectData, project, settings);
    const statusByStoryId = Object.fromEntries((projectData.stories || []).map(story => [story.id, inferStoryStatus(story)]));
    const records = buildEvidenceRecords(projectData, { statusByStoryId });
    const operatorGuidance = String(prompts.statusReport || '').replace(/\{\{\w+\}\}/g, '').slice(0, 4000);
    const selection = await selectGroundedClaims({
      callProvider: callLlm,
      task: `Select the most important recorded evidence for this project status summary. ${operatorGuidance}`,
      records,
      maxClaims: 12
    });
    if (selection.source === 'ai-grounded') {
      report = `${heuristicReport}\n\n${formatGroundedEvidence(selection.claims)}`;
      source = selection.source;
    } else {
      console.warn('Grounded AI status selection rejected; using deterministic fallback:', selection.error);
      report = heuristicReport;
      source = selection.source;
      warning = 'The AI output could not be verified against saved sources, so the deterministic grounded summary was used.';
    }
  }

  res.json({ report, source, warning });
}));

app.post('/api/project/story', (req, res) => {
  plainObject(req.body);
  const project = validateText(req.body.project, 'project', { required: true, max: 120 });

  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const input = validateStoryCreate(req.body, projectData);
  const lastCommentValue = input.lastComment !== undefined ? input.lastComment : (input.lastUpdate || '');

  const story = {
    id: createPersistentId('story'),
    summary: input.summary,
    description: input.description || '',
    acceptanceCriteria: input.acceptanceCriteria || [],
    dependencies: input.dependencies || '',
    labels: input.labels || [],
    environment: input.environment || '',
    notes: input.notes || '',
    timelineId: input.timelineId || '',
    createdAt: new Date().toISOString(),
    updates: [],
    // Unified item: a story may also be "tracked" (the follow-up/Jira chase list). These
    // fields are the former Ticket fields; absent/false when the item isn't tracked.
    tracked: input.tracked || false,
    jiraId: input.jiraId || '',
    assignee: input.assignee !== undefined ? input.assignee : (input.owner || ''),
    owner: input.assignee !== undefined ? input.assignee : (input.owner || ''),
    sprint: input.sprint || '',
    contacted: input.contacted || false,
    commentAdded: input.commentAdded || false,
    lastCommentedAt: input.lastCommentedAt !== undefined ? input.lastCommentedAt : (input.commentAdded ? new Date().toISOString() : null),
    lastComment: lastCommentValue,
    lastUpdate: '',
    lastUpdateNotes: input.lastUpdateNotes || ''
  };

  projectData.stories.unshift(story);
  writeData(data);
  res.json(story);
});

app.post('/api/project/story/import/preview', wrap(async (req, res) => {
  const { fields, files } = await parseMultipart(req, { maxFiles: 1, allowedFields: ['project'] });
  const project = fields.project;
  const file = files.find(item => item.fieldname === 'file');
  if (!project || !file) return res.status(400).json({ error: 'Choose a CSV file and project' });
  if (!/\.csv$/i.test(file.originalname || '')) return res.status(400).json({ error: 'Only .csv files can be imported' });
  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) return res.status(404).json({ error: 'Project not found' });
  try {
    const preview = mapCsvWorkItems(file.buffer.toString('utf8'), projectData);
    res.json({ ...preview, fileName: file.originalname });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to read CSV' });
  }
}));

app.post('/api/project/story/import', (req, res) => {
  plainObject(req.body);
  rejectUnknownFields(req.body, new Set(['project', 'items']));
  const project = validateText(req.body.project, 'project', { required: true, max: 120 });
  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'Missing project or imported work items' });
  if (items.length > 1000) return res.status(400).json({ error: 'Import is limited to 1,000 work items at a time' });
  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) return res.status(404).json({ error: 'Project not found' });

  const existingJiraIds = new Set((projectData.stories || []).map(story => normalizeText(story.jiraId)).filter(Boolean));
  const created = [];
  const skipped = [];
  items.forEach((item, index) => {
    let input;
    try {
      input = validateStoryCreate(item, projectData);
    } catch (error) {
      skipped.push({ row: Number(item && item.sourceRow) || index + 1, reason: error.message || 'Invalid work item' });
      return;
    }
    const summary = input.summary;
    const jiraId = input.jiraId || '';
    const normalizedJiraId = normalizeText(jiraId);
    if (normalizedJiraId && existingJiraIds.has(normalizedJiraId)) {
      skipped.push({ row: Number(item && item.sourceRow) || index + 1, reason: `Duplicate Jira key: ${jiraId}` });
      return;
    }
    if (normalizedJiraId) existingJiraIds.add(normalizedJiraId);
    const lastCommentedAt = input.lastCommentedAt || '';
    const story = {
      id: createPersistentId('story'),
      summary,
      description: input.description || '',
      acceptanceCriteria: input.acceptanceCriteria || [],
      dependencies: input.dependencies || '',
      labels: input.labels || [],
      environment: input.environment || '',
      notes: 'Imported from CSV',
      timelineId: '',
      createdAt: new Date().toISOString(),
      updates: [],
      tracked: false,
      jiraId,
      assignee: resolveProjectAssignee(projectData, input.assignee),
      owner: resolveProjectAssignee(projectData, input.assignee),
      sprint: input.sprint || '',
      contacted: false,
      commentAdded: !!lastCommentedAt,
      lastCommentedAt: lastCommentedAt || null,
      lastComment: input.lastComment || '',
      lastUpdate: '',
      lastUpdateNotes: ''
    };
    projectData.stories.unshift(story);
    created.push(story);
  });
  writeData(data);
  res.json({ created: created.length, skipped, stories: created });
});

app.put('/api/project/assignee-directory', (req, res) => {
  plainObject(req.body);
  rejectUnknownFields(req.body, new Set(['project', 'entries', 'applyExisting']));
  const project = validateText(req.body.project, 'project', { required: true, max: 120 });
  const { entries } = req.body;
  const applyExisting = validateBoolean(req.body.applyExisting, 'applyExisting') || false;
  if (!Array.isArray(entries) || entries.length > 500) return res.status(400).json({ error: 'Missing or excessive assignee directory entries' });
  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) return res.status(404).json({ error: 'Project not found' });

  const directory = {};
  entries.forEach((entry, index) => {
    plainObject(entry, `entries[${index}]`);
    rejectUnknownFields(entry, new Set(['alias', 'name']), `entries[${index}]`);
    const alias = normalizeText(validateText(entry.alias, `entries[${index}].alias`, { required: true, max: 200 }));
    const name = validateText(entry.name, `entries[${index}].name`, { required: true, max: 200 });
    if (alias && name) directory[alias] = name;
  });
  projectData.assigneeDirectory = directory;

  let updated = 0;
  if (applyExisting) {
    (projectData.stories || []).forEach(story => {
      const current = String(story.assignee || story.owner || '').trim();
      const resolved = resolveProjectAssignee(projectData, current);
      if (resolved && resolved !== current) {
        story.assignee = resolved;
        story.owner = resolved;
        updated += 1;
      }
    });
  }
  writeData(data);
  res.json({ directory, updated });
});

app.put('/api/project/status-mappings', (req, res) => {
  plainObject(req.body);
  rejectUnknownFields(req.body, new Set(['project', 'entries', 'applyExisting']));
  const project = validateText(req.body.project, 'project', { required: true, max: 120 });
  const { entries } = req.body;
  const applyExisting = validateBoolean(req.body.applyExisting, 'applyExisting') || false;
  if (!Array.isArray(entries) || entries.length > 500) return res.status(400).json({ error: 'Missing or excessive status mappings' });
  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) return res.status(404).json({ error: 'Project not found' });

  const mappings = {};
  entries.forEach((entry, index) => {
    plainObject(entry, `entries[${index}]`);
    rejectUnknownFields(entry, new Set(['jiraStatus', 'operatingStatus']), `entries[${index}]`);
    const jiraStatus = statusMappingKey(validateText(entry.jiraStatus, `entries[${index}].jiraStatus`, { required: true, max: 200 }));
    const operatingStatus = validateText(entry.operatingStatus, `entries[${index}].operatingStatus`, { required: true, max: 30 });
    if (jiraStatus && operatingStatuses.has(operatingStatus)) mappings[jiraStatus] = operatingStatus;
    else throw new ValidationError(`entries[${index}].operatingStatus is not supported.`);
  });
  projectData.statusMappings = mappings;

  let updated = 0;
  if (applyExisting) {
    (projectData.stories || []).forEach(story => {
      const labels = Array.isArray(story.labels) ? story.labels : [];
      const originalStatus = labels.map(label => String(label).match(/^original-status:(.+)$/i)?.[1]).find(Boolean);
      const operatingStatus = originalStatus && mappedOperatingStatus(projectData, originalStatus);
      if (!operatingStatus) return;
      const nextLabels = applyOperatingStatusLabel(labels, operatingStatus);
      if (nextLabels.join('|') !== labels.join('|')) {
        story.labels = nextLabels;
        updated += 1;
      }
    });
  }
  writeData(data);
  res.json({ mappings, updated });
});

app.post('/api/project/timeline', (req, res) => {
  plainObject(req.body);
  const project = validateText(req.body.project, 'project', { required: true, max: 120 });
  const input = validateTimelineCreate(req.body);

  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const entry = {
    id: createPersistentId('timeline'),
    title: input.title,
    date: input.date || localDateKey(),
    status: input.status || 'Planned',
    notes: input.notes || ''
  };

  projectData.timeline.unshift(entry);
  writeData(data);
  res.json(entry);
});

app.put('/api/project/story/link', (req, res) => {
  plainObject(req.body);
  rejectUnknownFields(req.body, new Set(['project', 'storyId', 'timelineId']));
  const project = validateText(req.body.project, 'project', { required: true, max: 120 });
  const storyId = validateText(req.body.storyId, 'storyId', { required: true, max: 200 });
  const timelineId = validateText(req.body.timelineId, 'timelineId', { required: true, max: 200 });

  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const story = projectData.stories.find(s => s.id === storyId);
  if (!story) {
    return res.status(404).json({ error: 'Story not found' });
  }

  const timelineItem = projectData.timeline.find(t => t.id === timelineId);
  if (!timelineItem) {
    return res.status(404).json({ error: 'Timeline item not found' });
  }

  story.timelineId = timelineId;
  writeData(data);
  res.json(story);
});

app.put('/api/project/story', (req, res) => {
  plainObject(req.body);
  const project = validateText(req.body.project, 'project', { required: true, max: 120 });
  const id = validateText(req.body.id, 'id', { required: true, max: 200 });

  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const story = projectData.stories.find(s => s.id === id);
  if (!story) {
    return res.status(404).json({ error: 'Story not found' });
  }
  const input = validateStoryUpdate(req.body, projectData);

  if (input.summary !== undefined) story.summary = input.summary;
  if (input.title !== undefined) story.summary = input.title;
  if (input.description !== undefined) story.description = input.description;
  if (input.acceptanceCriteria !== undefined) story.acceptanceCriteria = input.acceptanceCriteria;
  if (input.dependencies !== undefined) story.dependencies = input.dependencies;
  if (input.labels !== undefined) story.labels = input.labels;
  if (input.environment !== undefined) story.environment = input.environment;
  if (input.notes !== undefined) story.notes = input.notes;
  if (input.timelineId !== undefined) story.timelineId = input.timelineId;

  // --- Tracking (follow-up) fields — the former Ticket fields, now on the unified item ---
  if (input.tracked !== undefined) story.tracked = input.tracked;
  if (input.jiraId !== undefined) story.jiraId = input.jiraId;
  if (input.assignee !== undefined) {
    story.assignee = input.assignee;
    story.owner = input.assignee;
  } else if (input.owner !== undefined) {
    story.owner = input.owner;
    if (story.assignee === undefined) story.assignee = input.owner;
  }
  if (input.sprint !== undefined) story.sprint = input.sprint;
  if (input.contacted !== undefined) story.contacted = input.contacted;
  if (input.commentAdded !== undefined) {
    story.commentAdded = input.commentAdded;
    if (input.commentAdded) story.lastCommentedAt = new Date().toISOString();
  }
  if (input.logComment) {
    story.lastCommentedAt = new Date().toISOString();
    story.commentAdded = true;
  }
  if (input.lastCommentedAt !== undefined) story.lastCommentedAt = input.lastCommentedAt;
  if (input.lastComment !== undefined) story.lastComment = input.lastComment;
  else if (input.lastUpdate !== undefined) story.lastComment = input.lastUpdate;
  if (input.lastUpdateNotes !== undefined) story.lastUpdateNotes = input.lastUpdateNotes;
  writeData(data);
  res.json(story);
});

app.put('/api/project/timeline', (req, res) => {
  plainObject(req.body);
  const project = validateText(req.body.project, 'project', { required: true, max: 120 });
  const id = validateText(req.body.id, 'id', { required: true, max: 200 });
  const input = validateTimelineUpdate(req.body);

  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const entry = projectData.timeline.find(t => t.id === id);
  if (!entry) {
    return res.status(404).json({ error: 'Timeline entry not found' });
  }

  if (input.title !== undefined) entry.title = input.title;
  if (input.date !== undefined) entry.date = input.date;
  if (input.status !== undefined) entry.status = input.status;
  if (input.notes !== undefined) entry.notes = input.notes;
  writeData(data);
  res.json(entry);
});

app.put('/api/project/transcript', (req, res) => {
  plainObject(req.body);
  const project = validateText(req.body.project, 'project', { required: true, max: 120 });
  const id = validateText(req.body.id, 'id', { required: true, max: 200 });
  const input = validateTranscriptUpdate(req.body);

  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const transcript = projectData.transcripts.find(t => t.id === id);
  if (!transcript) {
    return res.status(404).json({ error: 'Transcript not found' });
  }

  if (input.title !== undefined) transcript.title = input.title;
  if (input.notes !== undefined) transcript.notes = input.notes;
  if (input.date !== undefined) transcript.date = input.date;
  if (input.type !== undefined) transcript.type = input.type;
  writeData(data);
  res.json(transcript);
});

app.delete('/api/project/story', (req, res) => {
  const project = req.query.project;
  const id = req.query.id;
  if (!project || !id) {
    return res.status(400).json({ error: 'Missing project or story id' });
  }
  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }
  projectData.stories = projectData.stories.filter(s => s.id !== id);
  writeData(data);
  res.json({ success: true });
});

app.delete('/api/project/timeline', (req, res) => {
  const project = req.query.project;
  const id = req.query.id;
  if (!project || !id) {
    return res.status(400).json({ error: 'Missing project or timeline id' });
  }
  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }
  projectData.timeline = projectData.timeline.filter(t => t.id !== id);
  projectData.stories.forEach(s => {
    if (s.timelineId === id) s.timelineId = '';
  });
  writeData(data);
  res.json({ success: true });
});

app.delete('/api/project/transcript', (req, res) => {
  const project = validateText(req.query.project, 'project', { required: true, max: 120 });
  const id = validateText(req.query.id, 'id', { required: true, max: 200 });
  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const transcript = projectData.transcripts.find(t => t.id === id);
  projectData.transcripts = projectData.transcripts.filter(t => t.id !== id);
  if (transcript) removeTranscriptEvidence(projectData, id);
  const diskPath = transcriptDiskPath(transcript, transcriptsDir);
  const cleanupWarnings = commitFileDeletions(diskPath ? [diskPath] : [], () => writeData(data));
  res.json({ success: true, warnings: cleanupWarnings });
});

app.delete('/api/project/story/update', (req, res) => {
  const { project, storyId, updateId } = req.query;
  if (!project || !storyId || !updateId) {
    return res.status(400).json({ error: 'Missing project, storyId, or updateId' });
  }
  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const story = projectData.stories.find(s => s.id === storyId);
  if (!story) {
    return res.status(404).json({ error: 'Story not found' });
  }
  removeStoryUpdate(story, updateId);
  writeData(data);
  res.json({ success: true });
});

app.post('/api/project/transcript', uploadRateLimit, wrap(async (req, res) => {
  const { fields, files: uploadedFiles } = await parseMultipart(req, { maxFiles: 5, allowedFields: ['project', 'notes', 'date', 'metadata', 'type', 'title'] });
  const project = validateText(fields.project, 'project', { required: true, max: 120 });
  let metadata;
  try { metadata = JSON.parse(fields.metadata || '[]'); }
  catch (_) { throw new ValidationError('Upload details could not be read.'); }
  const uploadInput = validateTranscriptUpload({
    notes: fields.notes || '',
    date: fields.date || '',
    title: fields.title || '',
    type: fields.type || 'Notes',
    metadata
  });

  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }

  if (!uploadedFiles.length && !uploadInput.notes) return res.status(400).json({ error: 'Choose at least one file or add meeting notes' });

  const files = stageUploadFiles(uploadedFiles, transcriptsDir);
  const transcripts = [];
  const warnings = [];
  try {
    const total = Math.max(files.length, 1);
    for (let index = 0; index < total; index += 1) {
      const file = files[index];
      const details = uploadInput.metadata[index] || { title: '', type: uploadInput.type };
      const type = details.type || uploadInput.type;
      const isTextFile = !file || String(file.mimetype || '').startsWith('text/') || /\.(txt|md|csv|json|log)$/i.test(file.originalname || '');
      const transcript = {
        id: createPersistentId('transcript'),
        title: details.title || (file && file.originalname) || uploadInput.title || 'Meeting note',
        file: file ? `/uploads/transcripts/${file.filename}` : '',
        originalName: file ? file.originalname : '',
        notes: uploadInput.notes,
        date: uploadInput.date,
        type,
        sourceKind: isTextFile ? 'text' : 'reference',
        extractionNote: !isTextFile ? 'Reference only: this file type is saved but is not read for DSU extraction.' : '',
        uploadedAt: new Date().toISOString()
      };
      projectData.transcripts.unshift(transcript);

      let transcriptText = uploadInput.notes;
      if (file && isTextFile) {
        try { transcriptText += '\n' + fs.readFileSync(file.path, 'utf8'); }
        catch (error) {
          transcript.extractionNote = 'The file was saved, but its text could not be read for extraction.';
          warnings.push(`${file.originalname}: text could not be read`);
          console.warn('Unable to read transcript file for DSU extraction:', error.message);
        }
      }
      if (type === 'DSU' && isTextFile) {
        const extracted = extractDsuUpdates(projectData, transcript, transcriptText);
        if (extracted.length) {
          transcript.extractedUpdates = extracted;
          attachUpdatesToStories(projectData, transcript, extracted);
        }
      } else if (type === 'DSU' && !isTextFile) {
        warnings.push(`${file.originalname}: saved as reference only; no text extraction was run`);
      }
      transcripts.push(transcript);
    }
    commitStagedUploads(files, () => writeData(data));
  } catch (error) {
    rollbackStagedUploads(files);
    throw error;
  }
  res.json({ transcripts, warnings });
}));

// --- Teams update message generation (from selected unified items) ---

const defaultTeamsUpdatePrompt = `You are writing a short, friendly status update for a manager to read in Microsoft Teams. Use ONLY the information provided below — do not invent IDs, statuses, names, dates, or events that are not present, and do not add a "looking ahead", speculation, or next-steps section unless it is explicitly supported by the data. Tone: warm, concise, professional. Structure: begin with "Hi {{recipient}}," then a one-line intro that references {{subject}} if it is provided, then a short bulleted summary of the selected items (note each item's status; if an item has a Jira id, bold it using **markdown**), then a brief sign-off such as "Thanks!". Keep it scannable.\n\nRecipient: {{recipient}}\nSubject/board: {{subject}}\n\nSelected items:\n{{itemList}}`;

function generateTeamsTemplate(recipient, subject, items) {
  const lines = [];
  lines.push(`Hi ${recipient || 'there'},`);
  lines.push('');
  lines.push(subject ? `Quick update on ${subject}:` : 'Quick update:');
  lines.push('');
  items.forEach(s => {
    const bits = [];
    if (s.jiraId) bits.push(`**${s.jiraId}**`);
    bits.push(s.summary);
    bits.push(`— ${inferStoryStatus(s)}`);
    let line = bits.join(' ');
    const recent = Array.isArray(s.updates) && s.updates[0] ? (s.updates[0].update || s.updates[0].excerpt || '') : '';
    if (recent) line += `. ${recent}`;
    else if (storyLastCommentText(s)) line += `. ${storyLastCommentText(s)}`;
    lines.push(`* ${line}`);
  });
  lines.push('');
  lines.push('Thanks!');
  return lines.join('\n');
}

app.post('/api/project/teams-update', wrap(async (req, res) => {
  // storyIds are the selected item ids; ticketIds accepted for backward-compat and merged.
  plainObject(req.body);
  rejectUnknownFields(req.body, new Set(['project', 'recipient', 'subject', 'storyIds', 'ticketIds', 'mode']));
  const project = validateText(req.body.project, 'project', { required: true, max: 120 });
  const recipient = validateText(req.body.recipient, 'recipient', { max: 500 }) || '';
  const subject = validateText(req.body.subject, 'subject', { max: 1000 }) || '';
  const mode = validateText(req.body.mode, 'mode', { max: 20 }) || 'heuristic';
  const storyIds = validateTextList(req.body.storyIds, 'storyIds', { maxItems: 1000, maxItem: 200 }) || [];
  const ticketIds = validateTextList(req.body.ticketIds, 'ticketIds', { maxItems: 1000, maxItem: 200 }) || [];
  if (!['heuristic', 'ai'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid Teams draft mode' });
  }

  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const want = [...(Array.isArray(storyIds) ? storyIds : []), ...(Array.isArray(ticketIds) ? ticketIds : [])];
  const items = (projectData.stories || []).filter(s => want.includes(s.id));
  if (!items.length) {
    return res.status(400).json({ error: 'Select at least one item' });
  }

  let message = '';
  let source = 'heuristic';
  let warning = '';
  if (mode === 'heuristic') {
    message = generateTeamsTemplate(recipient, subject, items);
  } else {
    if (!getProvider()) {
      return res.status(400).json({ error: 'AI drafting is not configured. Add a provider key in web/.env and restart the app.' });
    }
    const deterministicMessage = generateTeamsTemplate(recipient, subject, items);
    const statusByStoryId = Object.fromEntries(items.map(story => [story.id, inferStoryStatus(story)]));
    const records = buildEvidenceRecords(projectData, {
      stories: items,
      statusByStoryId,
      includeTimeline: false,
      includeTranscripts: false
    });
    const selection = await selectGroundedClaims({
      callProvider: callLlm,
      task: 'Select concise supporting evidence for a Microsoft Teams update about only the selected work items.',
      records,
      maxClaims: 8
    });
    if (selection.source === 'ai-grounded') {
      message = `${deterministicMessage}\n\n${formatGroundedEvidence(selection.claims, 'AI-selected supporting evidence')}`;
      source = selection.source;
    } else {
      console.warn('Grounded AI Teams selection rejected; using deterministic fallback:', selection.error);
      message = deterministicMessage;
      source = selection.source;
      warning = 'The AI output could not be verified against the selected work items, so the deterministic draft was used.';
    }
  }

  res.json({ message, source, warning });
}));

// Return a clean JSON error instead of a stack trace / hung request — e.g. when
// pilot-data.json is corrupt. Must be registered after all routes.
app.use((err, req, res, next) => {
  console.error('Request error:', err && err.message);
  if (res.headersSent) return next(err);
  if (err instanceof ProviderTimeoutError) return res.status(504).json({ error: err.message });
  if (err instanceof ProviderRequestError) return res.status(502).json({ error: err.message });
  if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
  if (/file type|multipart|uploaded file|upload up to|uploads are limited|too many upload fields|upload field/i.test(err && err.message)) return res.status(400).json({ error: err.message });
  res.status(500).json({ error: 'The request could not be completed. Check the local server log for details.' });
});

// Bind to loopback only so the app is reachable from this machine, not the local network.
const port = Number.parseInt(process.env.PORT || '3000', 10);

app.listen(port, '127.0.0.1', () => {
  console.log(`PM Delivery Steward listening on http://127.0.0.1:${port}`);
});
