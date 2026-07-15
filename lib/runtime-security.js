const crypto = require('crypto');

const DEFAULT_AI_TIMEOUT_MS = 45_000;
const MAX_AI_TIMEOUT_MS = 120_000;
const MIN_AI_TIMEOUT_MS = 1_000;

class ProviderTimeoutError extends Error {
  constructor(message = 'The AI provider did not respond before the request timed out.') {
    super(message);
    this.name = 'ProviderTimeoutError';
  }
}

class ProviderRequestError extends Error {
  constructor(message = 'The AI provider request could not be completed.') {
    super(message);
    this.name = 'ProviderRequestError';
  }
}

function createPersistentId(kind) {
  return `${kind}-${crypto.randomUUID()}`;
}

function getAiTimeoutMs(value = process.env.AI_REQUEST_TIMEOUT_MS) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_AI_TIMEOUT_MS;
  return Math.min(Math.max(parsed, MIN_AI_TIMEOUT_MS), MAX_AI_TIMEOUT_MS);
}

function getTrustedClaudeApiUrl(value = process.env.CLAUDE_API_URL) {
  const apiUrl = value || 'https://api.anthropic.com/v1/messages';
  let url;
  try {
    url = new URL(apiUrl);
  } catch (_) {
    throw new ProviderRequestError('CLAUDE_API_URL must be a valid Anthropic HTTPS URL.');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'api.anthropic.com' || url.pathname !== '/v1/messages') {
    throw new ProviderRequestError('CLAUDE_API_URL must use https://api.anthropic.com/v1/messages.');
  }
  return url.toString();
}

async function fetchWithTimeout(url, options, { fetchImpl = fetch, timeoutMs = getAiTimeoutMs() } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new ProviderTimeoutError();
    throw new ProviderRequestError('The AI provider could not be reached.');
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  ProviderRequestError,
  ProviderTimeoutError,
  createPersistentId,
  fetchWithTimeout,
  getAiTimeoutMs,
  getTrustedClaudeApiUrl
};
