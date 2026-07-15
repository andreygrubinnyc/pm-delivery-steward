const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Busboy = require('busboy');
const { rateLimit } = require('express-rate-limit');
const { isTrustedMutationRequest } = require('./public/security');
const {
  ProviderRequestError,
  ProviderTimeoutError,
  createPersistentId,
  fetchWithTimeout,
  getTrustedClaudeApiUrl
} = require('./lib/runtime-security');

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

function persistUpload(file) {
  const filename = crypto.randomBytes(16).toString('hex');
  const diskPath = path.join(transcriptsDir, filename);
  fs.writeFileSync(diskPath, file.buffer);
  return { ...file, filename, path: diskPath };
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

// Remove an uploaded transcript's file from disk (basename guards against path traversal).
function deleteTranscriptFile(transcript) {
  if (!transcript || !transcript.file) return;
  try {
    const diskPath = path.join(transcriptsDir, path.basename(transcript.file));
    if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
  } catch (error) {
    console.warn('Could not delete transcript file:', error.message);
  }
}

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
  const statusText = normalizeText(jiraStatus);
  if (/done|resolved|closed|complete/.test(statusText)) return 'Done';
  if (/in progress|in-progress|ongoing/.test(statusText)) return 'In progress';
  if (/blocked|on hold/.test(statusText)) return 'Blocked';
  if (/active/.test(statusText)) return 'Active';
  if (/planned|to do|todo|backlog|open/.test(statusText)) return 'Planned';
  return '';
}

function applyOperatingStatusLabel(labels, operatingStatus) {
  const standardLabels = new Set(['done', 'in progress', 'in-progress', 'blocked', 'active', 'planned', 'not started', 'not-started']);
  const next = (Array.isArray(labels) ? labels : []).filter(label => !standardLabels.has(normalizeText(label)));
  return operatingStatus ? [...new Set([operatingStatus.toLowerCase(), ...next])] : next;
}

function extractJsonFromText(text) {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch (_error) {
      return null;
    }
  }
  return null;
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

const defaultDsuExtractionPrompt = `You are given a DSU transcript and a list of active stories for a project. Extract concise update items that refer to one or more of these stories and return valid JSON only. The JSON must be an array of objects with keys: storyId, excerpt, update, source. Use only the provided storyId values. excerpt must be a phrase copied directly from the transcript (do not paraphrase it); update should be a Jira-friendly summary of that same update; source should identify the transcript title or file name. Only extract updates that are explicitly supported by the transcript text — do not infer, assume, or invent. If a story is not clearly discussed in the transcript, omit it. If the transcript contains no relevant updates, return an empty array []. You must not include any explanation outside the JSON array.\n\nProject stories:\n{{storyList}}\n\nTranscript title: {{transcriptTitle}}\nTranscript type: {{transcriptType}}\nTranscript text:\n{{transcriptText}}`;

const defaultStatusReportPrompt = `You are a delivery lead writing a concise, professional project status summary in Markdown for leadership or stakeholder readouts. Use only the information provided below. Do not invent or overstate anything: no made-up progress, risks, dates, owners, next steps, confidence, percentages, or milestone health. If the data is missing or mixed, say that explicitly. When the evidence does not support a clean green/yellow/red call, use cautious phrasing such as "mixed signals based on recorded data" rather than guessing. Preserve any date marked "(estimated)" as estimated.\n\nFormat the summary exactly with these sections:\n# {{projectName}} Status Summary\n## Overall Status\n- Status signal: <one short line grounded in the data>\n- Executive summary: <2-4 sentences, factual and scannable>\n## Delivery Highlights\n- Bullet list only from explicit completed/in-progress/active evidence\n## Risks and Blockers\n- Bullet list of explicit blockers, dependency issues, follow-up concerns, milestone pressure, or "No explicit risks recorded"\n## Milestones\n- Bullet list of milestone title, date, and recorded status/notes only\n## Work Items Needing Attention\n- Bullet list of explicit blocked, stale, unowned, or follow-up-needing items, or say none are recorded\n## Evidence Gaps\n- Bullet list of missing or weak data that limits confidence in the summary\n\nUse Jira IDs only when they are provided. Keep it factual, concise, and ready to paste into a status update.\n\nProject: {{projectName}}\n\nTimeline:\n{{timelineList}}\n\nStories:\n{{storyList}}\n\nTranscripts:\n{{transcriptList}}`;

function getAiPrompts(data) {
  if (!data.aiPrompts) {
    data.aiPrompts = {};
  }
  return {
    dsuExtraction: data.aiPrompts.dsuExtraction || defaultDsuExtractionPrompt,
    statusReport: data.aiPrompts.statusReport || defaultStatusReportPrompt
  };
}

function renderPrompt(template, context) {
  return String(template || '').replace(/\{\{(\w+)\}\}/g, (_, key) => context[key] || '');
}

function storyAssignee(story) {
  return String((story && (story.assignee || story.owner)) || '').trim();
}

function storySprint(story) {
  return String((story && story.sprint) || '').trim();
}

function storyLastCommentText(story) {
  return String((story && (story.lastComment || story.lastUpdate)) || '').trim();
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

async function callOpenAIApi(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');

  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  const maxTokens = parseInt(process.env.OPENAI_MAX_TOKENS, 10) || 2000;
  const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        // Neutral system prompt: callOpenAIApi serves all features (extraction, status
        // reports, Teams updates), so it must not bias toward any one task/format.
        { role: 'system', content: 'You are a helpful project delivery operations assistant. Follow the user\'s instructions exactly and return only what they ask for, in the requested format.' },
        { role: 'user', content: prompt }
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

async function callClaudeApi(prompt) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('Missing CLAUDE_API_KEY');

  const apiUrl = getTrustedClaudeApiUrl();
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
      messages: [{ role: 'user', content: prompt }]
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

async function callLlm(prompt) {
  const provider = getProvider();
  if (!provider) {
    throw new Error('No AI provider configured. Set OPENAI_API_KEY or CLAUDE_API_KEY.');
  }
  if (provider === 'openai') {
    return await callOpenAIApi(prompt);
  }
  return await callClaudeApi(prompt);
}

function renderStoryListForPrompt(projectData) {
  return projectData.stories.map(story => `- id: ${story.id}\n  summary: ${story.summary.trim()}\n  description: ${story.description ? story.description.trim() : ''}`).join('\n');
}

// Richer story rendering for the status-report prompt: includes inferred status, labels,
// dependencies, notes, and the most recent updates so the report reflects real state
// (blockers, done items, DSU-derived progress) rather than just titles/descriptions.
function renderStoryListForReport(projectData) {
  return projectData.stories.map(story => {
    const labels = Array.isArray(story.labels) ? story.labels.join(', ') : String(story.labels || '');
    const recent = Array.isArray(story.updates) ? story.updates.slice(0, 3) : [];
    const linkedMilestone = story.timelineId ? (projectData.timeline.find(entry => entry.id === story.timelineId) || null) : null;
    const lines = [
      `- summary: ${story.summary.trim()}`,
      `  status: ${inferStoryStatus(story)}`
    ];
    if (story.jiraId) lines.push(`  jiraId: ${story.jiraId}`);
    if (storyAssignee(story)) lines.push(`  assignee: ${storyAssignee(story)}`);
    if (storySprint(story)) lines.push(`  sprint: ${storySprint(story)}`);
    if (story.tracked) lines.push(`  tracked: yes`);
    if (typeof story.contacted === 'boolean') lines.push(`  contacted: ${story.contacted ? 'yes' : 'no'}`);
    if (story.lastCommentedAt) lines.push(`  lastCommentedAt: ${story.lastCommentedAt}`);
    if (storyLastCommentText(story)) lines.push(`  lastComment: ${storyLastCommentText(story)}`);
    if (labels) lines.push(`  labels: ${labels}`);
    if (story.description) lines.push(`  description: ${story.description.trim()}`);
    if (story.dependencies) lines.push(`  dependencies: ${story.dependencies}`);
    if (story.notes) lines.push(`  notes: ${story.notes.trim()}`);
    if (linkedMilestone) lines.push(`  linked milestone: ${linkedMilestone.title}${linkedMilestone.date ? ` (${linkedMilestone.date})` : ''}`);
    if (recent.length) {
      lines.push('  recent updates:');
      recent.forEach(update => {
        const text = (update.update || update.excerpt || '').trim();
        const source = update.source || update.transcriptTitle || '';
        lines.push(`    - ${text}${source ? ` (source: ${source})` : ''}`);
      });
    }
    return lines.join('\n');
  }).join('\n');
}

function renderTimelineListForPrompt(projectData) {
  return projectData.timeline.map(entry => `- id: ${entry.id}\n  title: ${entry.title}\n  date: ${entry.date || ''}\n  status: ${entry.status || ''}\n  notes: ${entry.notes || ''}`).join('\n');
}

function renderTranscriptListForPrompt(projectData) {
  return projectData.transcripts.map(item => `- id: ${item.id}\n  title: ${item.title}\n  type: ${item.type || ''}\n  date: ${item.date || item.uploadedAt || ''}\n  notes: ${item.notes || ''}`).join('\n');
}

function inferStoryStatus(story) {
  const labels = Array.isArray(story.labels) ? story.labels.join(' ').toLowerCase() : String(story.labels || '').toLowerCase();
  if (labels.includes('done') || labels.includes('complete') || labels.includes('completed')) return 'Done';
  if (labels.includes('in progress') || labels.includes('in-progress') || labels.includes('ongoing')) return 'In progress';
  if (labels.includes('blocked') || labels.includes('on hold')) return 'Blocked';
  if (labels.includes('active')) return 'Active';
  if (labels.includes('planned') || labels.includes('to do') || labels.includes('todo') || labels.includes('backlog')) return 'Planned';
  if (story.updates && story.updates.length) return 'Active';
  if (story.timelineId) return 'Planned';
  return 'Not started';
}

function daysSinceIso(value) {
  if (!value) return null;
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return null;
  return Math.floor((Date.now() - then) / 86400000);
}

function itemNeedsFollowupServer(story) {
  return !!story.tracked && inferStoryStatus(story) !== 'Done' && !story.contacted;
}

function itemNeedsCommentServer(story, settings) {
  if (!story.tracked || inferStoryStatus(story) === 'Done') return false;
  const d = daysSinceIso(story.lastCommentedAt);
  return d === null || d >= ((settings && settings.commentStaleDays) || 7);
}

function daysUntilDate(value) {
  if (!value) return null;
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  target.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  return Math.round((target - now) / 86400000);
}

function milestoneHealthLabel(entry) {
  const status = String((entry && entry.status) || '').toLowerCase();
  if (/(done|complete|completed|closed)/.test(status)) return 'Complete';
  const until = daysUntilDate(entry && entry.date);
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
    const aTime = a.date ? new Date(a.date).getTime() : 0;
    const bTime = b.date ? new Date(b.date).getTime() : 0;
    return aTime - bTime;
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

function parseUpdatesResponse(rawText) {
  const trimmed = String(rawText || '').trim();
  const parsed = extractJsonFromText(trimmed);
  if (parsed) return parsed;
  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    return [];
  }
}

async function runLlmExtraction(projectData, transcript, transcriptText, promptTemplate) {
  const prompt = renderPrompt(promptTemplate || defaultDsuExtractionPrompt, {
    storyList: renderStoryListForPrompt(projectData),
    transcriptTitle: transcript.title || '',
    transcriptType: transcript.type || '',
    transcriptText
  });
  const output = await callLlm(prompt);
  const items = parseUpdatesResponse(output);
  if (!Array.isArray(items)) return [];
  return items.filter(item => item && item.storyId && (item.excerpt || item.update));
}

function attachUpdatesToStories(projectData, transcript, updates) {
  const storyMap = new Map(projectData.stories.map(story => [story.id, story]));
  updates.forEach(item => {
    const story = storyMap.get(item.storyId);
    if (!story) return;
    if (!Array.isArray(story.updates)) story.updates = [];
    // Skip if the same update text from a transcript of the same title already exists —
    // prevents duplicate updates when the same DSU is uploaded more than once.
    const newText = (item.update || item.excerpt || '').trim();
    const duplicate = story.updates.some(u =>
      (u.update || u.excerpt || '').trim() === newText &&
      (u.transcriptTitle || '') === (transcript.title || ''));
    if (duplicate) return;
    story.updates.unshift({
      id: createPersistentId('update'),
      transcriptId: transcript.id,
      transcriptTitle: transcript.title,
      excerpt: item.excerpt || '',
      update: item.update || item.excerpt || '',
      date: transcript.date || transcript.uploadedAt || new Date().toISOString(),
      source: item.source || transcript.title
    });
    // Auto-derive lastUpdate from the most recent update's date (Option B design).
    // The lastUpdate field is now auto-populated, with optional lastUpdateNotes for manual annotation.
    if (story.updates.length > 0) {
      story.lastUpdate = story.updates[0].date;
    }
  });
}

function extractDsuUpdates(projectData, transcript, sourceText) {
  const normalized = normalizeText(sourceText);
  if (!normalized) return [];

  // Split into candidate segments on line breaks AND sentence punctuation, then strip
  // leading markdown markers (#, >, *, -) so excerpts aren't one giant header/heading blob.
  const segments = sourceText
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map(s => s.replace(/^[#>*\-\s]+/, '').trim())
    .filter(s => s.length > 15);

  const updates = [];
  projectData.stories.forEach(story => {
    const storySummary = normalizeText(story.summary || '');
    const storyIdToken = (story.id || '').toLowerCase();
    const storyWords = storySummary.split(' ').filter(word => word.length > 3);
    const matchCount = storyWords.reduce((count, word) => count + (normalized.includes(word) ? 1 : 0), 0);
    const threshold = Math.min(3, Math.max(1, storyWords.length));
    const matched = normalized.includes(storyIdToken) || matchCount >= threshold;
    if (!matched) return;

    const excerptSource = segments.find(segment => {
      const segmentText = normalizeText(segment);
      if (storyIdToken && segmentText.includes(storyIdToken)) return true;
      return storyWords.some(word => segmentText.includes(word));
    }) || segments[0] || sourceText;

    const excerpt = excerptSource.replace(/\s+/g, ' ').trim().slice(0, 220);

    // Return items only. attachUpdatesToStories() is the single writer to story.updates
    // here, exactly as it is for the AI path — so neither path double-writes updates.
    updates.push({ storyId: story.id, excerpt });
  });

  return updates;
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/projects', (req, res) => {
  const data = readData();
  res.json(data.projects || {});
});

app.post('/api/projects', (req, res) => {
  const { name, description } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Missing project name' });
  }

  const projectName = sanitizeName(name);
  if (!projectName || !isSafeObjectKey(projectName)) {
    return res.status(400).json({ error: 'Invalid project name' });
  }
  if (projectName.length > 120) {
    return res.status(400).json({ error: 'Project name is too long (max 120 characters)' });
  }

  const data = readData();
  if (!data.projects) {
    data.projects = {};
  }
  if (getProject(data, projectName)) {
    return res.status(409).json({ error: 'Project already exists' });
  }

  const projectData = {
    description: description || '',
    stories: [],
    timeline: [],
    transcripts: []
  };
  Object.defineProperty(data.projects, projectName, { value: projectData, enumerable: true, configurable: true, writable: true });
  writeData(data);

  res.json({ name: projectName, project: projectData });
});

app.put('/api/project', (req, res) => {
  const { name, description } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Missing project name' });
  }
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
  // Clean up uploaded transcript files before dropping the project.
  (projectData.transcripts || []).forEach(deleteTranscriptFile);
  delete data.projects[name];
  writeData(data);
  res.json({ success: true });
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
  const { dsuExtraction, statusReport } = req.body;
  if (dsuExtraction === undefined && statusReport === undefined) {
    return res.status(400).json({ error: 'Missing prompt updates' });
  }

  const data = readData();
  const prompts = getAiPrompts(data);
  if (dsuExtraction !== undefined) prompts.dsuExtraction = dsuExtraction;
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
  const { commentStaleDays, sprintOptions } = req.body;
  if (commentStaleDays === undefined && sprintOptions === undefined) {
    return res.status(400).json({ error: 'Missing settings updates' });
  }
  const data = readData();
  if (!data.settings) data.settings = {};
  if (commentStaleDays !== undefined) {
    const n = parseInt(commentStaleDays, 10);
    if (!Number.isFinite(n) || n < 1 || n > 365) {
      return res.status(400).json({ error: 'commentStaleDays must be a number between 1 and 365' });
    }
    data.settings.commentStaleDays = n;
  }
  if (sprintOptions !== undefined) {
    const nextOptions = Array.isArray(sprintOptions)
      ? sprintOptions
      : String(sprintOptions || '').split('\n');
    data.settings.sprintOptions = nextOptions.map(value => String(value || '').trim()).filter(Boolean);
  }
  writeData(data);
  res.json(getSettings(data));
});

app.post('/api/project/status-report', wrap(async (req, res) => {
  const { project, mode = 'heuristic' } = req.body;
  if (!project) {
    return res.status(400).json({ error: 'Missing project name' });
  }
  if (!['heuristic', 'ai'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid status summary mode' });
  }

  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const prompts = getAiPrompts(data);
  const settings = getSettings(data);
  let report = '';
  let source = 'heuristic';

  const timelineList = renderTimelineListForPrompt(projectData);
  const transcriptList = renderTranscriptListForPrompt(projectData);

  if (mode === 'heuristic') {
    report = generateHeuristicStatusReport(projectData, project, settings);
  } else {
    if (!getProvider()) {
      return res.status(400).json({ error: 'AI drafting is not configured. Add a provider key in web/.env and restart the app.' });
    }
    const prompt = renderPrompt(prompts.statusReport, {
      projectName: project,
      timelineList,
      storyList: renderStoryListForReport(projectData),
      transcriptList
    }) + '\n\nAdditional guardrails: do not use vague group claims. State current Jira status and recorded update separately if they differ.';
    report = await callLlm(prompt);
    source = 'ai-draft';
    if (!report || !report.trim()) {
      throw new Error('Empty report from AI');
    }
  }

  res.json({ report, source });
}));

app.post('/api/project/story', (req, res) => {
  const { project, summary, description, acceptanceCriteria, dependencies, labels, environment, notes,
    tracked, jiraId, owner, assignee, sprint, contacted, commentAdded, lastUpdate, lastComment, lastUpdateNotes } = req.body;
  const timelineId = req.body.timelineId || '';
  if (!project || !summary) {
    return res.status(400).json({ error: 'Missing project or summary' });
  }

  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const story = {
    id: createPersistentId('story'),
    summary,
    description: description || '',
    acceptanceCriteria: Array.isArray(acceptanceCriteria) ? acceptanceCriteria : (acceptanceCriteria ? acceptanceCriteria.split('\n').map(item => item.trim()).filter(Boolean) : []),
    dependencies: dependencies || '',
    labels: Array.isArray(labels) ? labels : (labels ? labels.split(',').map(item => item.trim()).filter(Boolean) : []),
    environment: environment || '',
    notes: notes || '',
    timelineId: timelineId || '',
    createdAt: new Date().toISOString(),
    updates: [],
    // Unified item: a story may also be "tracked" (the follow-up/Jira chase list). These
    // fields are the former Ticket fields; absent/false when the item isn't tracked.
    tracked: !!tracked,
    jiraId: jiraId || '',
    assignee: assignee !== undefined ? assignee || '' : owner || '',
    owner: assignee !== undefined ? assignee || '' : owner || '',
    sprint: sprint || '',
    contacted: !!contacted,
    commentAdded: !!commentAdded,
    lastCommentedAt: commentAdded ? new Date().toISOString() : null,
    lastComment: lastComment !== undefined ? lastComment || '' : lastUpdate || '',
    lastUpdate: lastComment !== undefined ? lastComment || '' : lastUpdate || '',
    lastUpdateNotes: lastUpdateNotes || ''
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
  const { project, items } = req.body;
  if (!project || !Array.isArray(items)) return res.status(400).json({ error: 'Missing project or imported work items' });
  if (items.length > 1000) return res.status(400).json({ error: 'Import is limited to 1,000 work items at a time' });
  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) return res.status(404).json({ error: 'Project not found' });

  const existingJiraIds = new Set((projectData.stories || []).map(story => normalizeText(story.jiraId)).filter(Boolean));
  const created = [];
  const skipped = [];
  items.forEach((item, index) => {
    const summary = String(item.summary || '').trim();
    const jiraId = String(item.jiraId || '').trim();
    const normalizedJiraId = normalizeText(jiraId);
    if (!summary) { skipped.push({ row: item.sourceRow || index + 1, reason: 'Missing summary' }); return; }
    if (normalizedJiraId && existingJiraIds.has(normalizedJiraId)) {
      skipped.push({ row: item.sourceRow || index + 1, reason: `Duplicate Jira key: ${jiraId}` });
      return;
    }
    if (normalizedJiraId) existingJiraIds.add(normalizedJiraId);
    const lastCommentedAt = String(item.lastCommentedAt || '').trim();
    const story = {
      id: createPersistentId('story'),
      summary,
      description: String(item.description || '').trim(),
      acceptanceCriteria: Array.isArray(item.acceptanceCriteria) ? item.acceptanceCriteria.map(value => String(value || '').trim()).filter(Boolean) : [],
      dependencies: String(item.dependencies || '').trim(),
      labels: Array.isArray(item.labels) ? item.labels.map(value => String(value || '').trim()).filter(Boolean) : [],
      environment: String(item.environment || '').trim(),
      notes: 'Imported from CSV',
      timelineId: '',
      createdAt: new Date().toISOString(),
      updates: [],
      tracked: false,
      jiraId,
      assignee: resolveProjectAssignee(projectData, item.assignee),
      owner: resolveProjectAssignee(projectData, item.assignee),
      sprint: String(item.sprint || '').trim(),
      contacted: false,
      commentAdded: !!lastCommentedAt,
      lastCommentedAt: lastCommentedAt || null,
      lastComment: String(item.lastComment || '').trim(),
      lastUpdate: String(item.lastComment || '').trim(),
      lastUpdateNotes: ''
    };
    projectData.stories.unshift(story);
    created.push(story);
  });
  writeData(data);
  res.json({ created: created.length, skipped, stories: created });
});

app.put('/api/project/assignee-directory', (req, res) => {
  const { project, entries, applyExisting } = req.body;
  if (!project || !Array.isArray(entries)) return res.status(400).json({ error: 'Missing project or assignee directory entries' });
  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) return res.status(404).json({ error: 'Project not found' });

  const directory = {};
  entries.forEach(entry => {
    const alias = normalizeText(entry && entry.alias);
    const name = String(entry && entry.name || '').trim();
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
  const { project, entries, applyExisting } = req.body;
  if (!project || !Array.isArray(entries)) return res.status(400).json({ error: 'Missing project or status mappings' });
  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) return res.status(404).json({ error: 'Project not found' });

  const mappings = {};
  entries.forEach(entry => {
    const jiraStatus = statusMappingKey(entry && entry.jiraStatus);
    const operatingStatus = String(entry && entry.operatingStatus || '').trim();
    if (jiraStatus && operatingStatuses.has(operatingStatus)) mappings[jiraStatus] = operatingStatus;
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
  const { project, title, date, status, notes } = req.body;
  if (!project || !title) {
    return res.status(400).json({ error: 'Missing project or title' });
  }

  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const entry = {
    id: createPersistentId('timeline'),
    title,
    date: date || new Date().toISOString().slice(0, 10),
    status: status || 'Planned',
    notes: notes || ''
  };

  projectData.timeline.unshift(entry);
  writeData(data);
  res.json(entry);
});

app.put('/api/project/story/link', (req, res) => {
  const { project, storyId, timelineId } = req.body;
  if (!project || !storyId || !timelineId) {
    return res.status(400).json({ error: 'Missing project, storyId, or timelineId' });
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

  const timelineItem = projectData.timeline.find(t => t.id === timelineId);
  if (!timelineItem) {
    return res.status(404).json({ error: 'Timeline item not found' });
  }

  story.timelineId = timelineId;
  writeData(data);
  res.json(story);
});

app.put('/api/project/story', (req, res) => {
  const { project, id, title, summary, description, acceptanceCriteria, dependencies, labels, environment, notes, timelineId,
    tracked, jiraId, owner, assignee, sprint, contacted, commentAdded, lastUpdate, lastComment, lastUpdateNotes, logComment, lastCommentedAt } = req.body;
  if (!project || !id) {
    return res.status(400).json({ error: 'Missing project or story id' });
  }

  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const story = projectData.stories.find(s => s.id === id);
  if (!story) {
    return res.status(404).json({ error: 'Story not found' });
  }

  if (summary !== undefined) story.summary = summary;
  if (title !== undefined) story.summary = title; // the Manage tab edits via `title`
  if (description !== undefined) story.description = description;
  if (acceptanceCriteria !== undefined) {
    story.acceptanceCriteria = Array.isArray(acceptanceCriteria)
      ? acceptanceCriteria
      : String(acceptanceCriteria).split('\n').map(s => s.trim()).filter(Boolean);
  }
  if (dependencies !== undefined) story.dependencies = dependencies;
  if (Array.isArray(labels)) story.labels = labels;
  else if (typeof labels === 'string') story.labels = labels.split(',').map(s => s.trim()).filter(Boolean);
  if (environment !== undefined) story.environment = environment;
  if (notes !== undefined) story.notes = notes;
  if (timelineId !== undefined) story.timelineId = timelineId; // '' unlinks from timeline

  // --- Tracking (follow-up) fields — the former Ticket fields, now on the unified item ---
  if (tracked !== undefined) story.tracked = !!tracked;
  if (jiraId !== undefined) story.jiraId = jiraId;
  if (assignee !== undefined) {
    story.assignee = assignee;
    story.owner = assignee;
  } else if (owner !== undefined) {
    story.owner = owner;
    if (story.assignee === undefined) story.assignee = owner;
  }
  if (sprint !== undefined) story.sprint = sprint;
  if (contacted !== undefined) story.contacted = !!contacted;
  if (commentAdded !== undefined) {
    story.commentAdded = !!commentAdded;
    if (commentAdded) story.lastCommentedAt = new Date().toISOString();
  }
  if (logComment) { // "✓ today" — (re)stamp the freshness clock; the recurring nudge reset
    story.lastCommentedAt = new Date().toISOString();
    story.commentAdded = true;
  }
  if (lastCommentedAt !== undefined) story.lastCommentedAt = lastCommentedAt;
  if (lastComment !== undefined) {
    story.lastComment = lastComment;
    story.lastUpdate = lastComment;
  } else if (lastUpdate !== undefined) {
    story.lastUpdate = lastUpdate;
    if (story.lastComment === undefined) story.lastComment = lastUpdate;
  }
  if (lastUpdateNotes !== undefined) story.lastUpdateNotes = lastUpdateNotes;
  writeData(data);
  res.json(story);
});

app.put('/api/project/timeline', (req, res) => {
  const { project, id, title, date, status, notes } = req.body;
  if (!project || !id) {
    return res.status(400).json({ error: 'Missing project or timeline id' });
  }

  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const entry = projectData.timeline.find(t => t.id === id);
  if (!entry) {
    return res.status(404).json({ error: 'Timeline entry not found' });
  }

  if (title !== undefined) entry.title = title;
  if (date !== undefined) entry.date = date;
  if (status !== undefined) entry.status = status;
  if (notes !== undefined) entry.notes = notes;
  writeData(data);
  res.json(entry);
});

app.put('/api/project/transcript', (req, res) => {
  const { project, id, title, notes, date, type } = req.body;
  if (!project || !id) {
    return res.status(400).json({ error: 'Missing project or transcript id' });
  }

  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const transcript = projectData.transcripts.find(t => t.id === id);
  if (!transcript) {
    return res.status(404).json({ error: 'Transcript not found' });
  }

  if (title !== undefined) transcript.title = title;
  if (notes !== undefined) transcript.notes = notes;
  if (date !== undefined) transcript.date = date;
  if (type !== undefined) transcript.type = type;
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
  const project = req.query.project;
  const id = req.query.id;
  if (!project || !id) {
    return res.status(400).json({ error: 'Missing project or transcript id' });
  }
  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const transcript = projectData.transcripts.find(t => t.id === id);
  projectData.transcripts = projectData.transcripts.filter(t => t.id !== id);
  if (transcript) {
    deleteTranscriptFile(transcript);
    // Drop updates that were extracted from this transcript (no orphaned updates).
    projectData.stories.forEach(s => {
      if (Array.isArray(s.updates)) s.updates = s.updates.filter(u => u.transcriptId !== id);
    });
  }
  writeData(data);
  res.json({ success: true });
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
  story.updates = (story.updates || []).filter(u => u.id !== updateId);
  writeData(data);
  res.json({ success: true });
});

app.post('/api/project/transcript', uploadRateLimit, wrap(async (req, res) => {
  const { fields, files: uploadedFiles } = await parseMultipart(req, { maxFiles: 5, allowedFields: ['project', 'notes', 'date', 'metadata', 'type', 'title'] });
  const project = fields.project;
  const notes = fields.notes || '';
  const date = fields.date || '';

  if (!project) {
    return res.status(400).json({ error: 'Missing project name' });
  }

  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }

  if (!uploadedFiles.length && !notes.trim()) return res.status(400).json({ error: 'Choose at least one file or add meeting notes' });

  let metadata = [];
  try { metadata = JSON.parse(fields.metadata || '[]'); } catch (_) { return res.status(400).json({ error: 'Upload details could not be read' }); }
  const files = uploadedFiles.map(persistUpload);
  const validTypes = new Set(['DSU', 'Meeting', 'Interview', 'Call', 'Notes', 'Other']);
  const transcripts = [];
  const warnings = [];
  const total = Math.max(files.length, 1);
  for (let index = 0; index < total; index += 1) {
    const file = files[index];
    const details = metadata[index] || {};
    const type = validTypes.has(details.type) ? details.type : (fields.type || 'Notes');
    const isTextFile = !file || file.mimetype.startsWith('text/') || /\.(txt|md|csv|json|log)$/i.test(file.originalname);
    const transcript = {
      id: createPersistentId('transcript'),
      title: String(details.title || (file && file.originalname) || fields.title || 'Meeting note').trim(),
      file: file ? `/uploads/transcripts/${file.filename}` : '',
      originalName: file ? file.originalname : '',
      notes,
      date: date || '',
      type,
      sourceKind: isTextFile ? 'text' : 'reference',
      extractionNote: !isTextFile ? 'Reference only: this file type is saved but is not read for DSU extraction.' : '',
      uploadedAt: new Date().toISOString()
    };
    projectData.transcripts.unshift(transcript);

    let transcriptText = notes || '';
    if (file && isTextFile) {
      try { transcriptText += '\n' + fs.readFileSync(file.path, 'utf8'); }
      catch (error) {
        transcript.extractionNote = 'The file was saved, but its text could not be read for extraction.';
        warnings.push(`${file.originalname}: text could not be read`);
        console.warn('Unable to read transcript file for DSU extraction:', error.message);
      }
    }
    if (type === 'DSU' && isTextFile) {
      // DSU evidence stays deterministic, even when a drafting provider is configured.
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

  writeData(data);
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

function validateTeamsAiDraft(message, items) {
  const allowedJiraIds = new Set(items.map(item => String(item.jiraId || '').toUpperCase()).filter(Boolean));
  const mentionedJiraIds = String(message || '').match(/\b[A-Z][A-Z0-9]+-\d+\b/g) || [];
  const unsupported = [...new Set(mentionedJiraIds.map(id => id.toUpperCase()).filter(id => !allowedJiraIds.has(id)))];
  if (unsupported.length) {
    throw new Error(`AI draft referenced unselected Jira work item${unsupported.length === 1 ? '' : 's'}: ${unsupported.join(', ')}`);
  }
  return message;
}

app.post('/api/project/teams-update', wrap(async (req, res) => {
  // storyIds are the selected item ids; ticketIds accepted for backward-compat and merged.
  const { project, recipient, subject, storyIds, ticketIds, mode = 'heuristic' } = req.body;
  if (!project) {
    return res.status(400).json({ error: 'Missing project name' });
  }
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

  const itemList = items.map(s => {
    const recent = Array.isArray(s.updates) && s.updates[0] ? (s.updates[0].update || s.updates[0].excerpt || '') : '';
    const parts = [];
    if (s.jiraId) parts.push(`jira: ${s.jiraId}`);
    parts.push(`status: ${inferStoryStatus(s)}`);
    if (storyAssignee(s)) parts.push(`assignee: ${storyAssignee(s)}`);
    if (storySprint(s)) parts.push(`sprint: ${storySprint(s)}`);
    if (s.notes) parts.push(`notes: ${s.notes}`);
    if (recent) parts.push(`recent: ${recent}`);
    else if (storyLastCommentText(s)) parts.push(`last comment: ${storyLastCommentText(s)}`);
    return `- ${s.summary} | ${parts.join(' | ')}`;
  }).join('\n') || '(none)';

  let message = '';
  let source = 'heuristic';
  if (mode === 'heuristic') {
    message = generateTeamsTemplate(recipient, subject, items);
  } else {
    if (!getProvider()) {
      return res.status(400).json({ error: 'AI drafting is not configured. Add a provider key in web/.env and restart the app.' });
    }
    const prompt = renderPrompt(defaultTeamsUpdatePrompt, {
      recipient: recipient || 'there',
      subject: subject || '',
      itemList
    }) + '\n\nAdditional guardrails: use only selected Jira IDs. State each current Jira status. If an update sounds different from the status, write both without claiming the status changed.';
    message = validateTeamsAiDraft(await callLlm(prompt), items);
    source = 'ai-draft';
    if (!message || !message.trim()) throw new Error('Empty message from AI');
  }

  res.json({ message, source });
}));

// Return a clean JSON error instead of a stack trace / hung request — e.g. when
// pilot-data.json is corrupt. Must be registered after all routes.
app.use((err, req, res, next) => {
  console.error('Request error:', err && err.message);
  if (res.headersSent) return next(err);
  if (err instanceof ProviderTimeoutError) return res.status(504).json({ error: err.message });
  if (err instanceof ProviderRequestError) return res.status(502).json({ error: err.message });
  if (/file type|multipart|uploaded file|upload up to|uploads are limited|too many upload fields|upload field/i.test(err && err.message)) return res.status(400).json({ error: err.message });
  res.status(500).json({ error: 'The request could not be completed. Check the local server log for details.' });
});

// Bind to loopback only so the app is reachable from this machine, not the local network.
const port = Number.parseInt(process.env.PORT || '3000', 10);

app.listen(port, '127.0.0.1', () => {
  console.log(`PM Delivery Steward listening on http://127.0.0.1:${port}`);
});
