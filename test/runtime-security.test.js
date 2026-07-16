const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ProviderTimeoutError,
  createPersistentId,
  fetchWithTimeout,
  getTrustedClaudeApiUrl
} = require('../lib/runtime-security');

test('persistent IDs remain unique during rapid creation', () => {
  const ids = new Set(Array.from({ length: 10_000 }, () => createPersistentId('story')));
  assert.equal(ids.size, 10_000);
  assert.ok([...ids].every(id => /^story-[0-9a-f-]{36}$/.test(id)));
});

test('Claude endpoint is restricted to the official HTTPS Messages endpoint', () => {
  assert.equal(getTrustedClaudeApiUrl('https://api.anthropic.com/v1/messages'), 'https://api.anthropic.com/v1/messages');
  assert.throws(() => getTrustedClaudeApiUrl('https://attacker.example/v1/messages'));
  assert.throws(() => getTrustedClaudeApiUrl('http://api.anthropic.com/v1/messages'));
});

test('provider requests are cancelled after their deadline', async () => {
  const neverResponds = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
  await assert.rejects(
    fetchWithTimeout('https://api.openai.com/v1/chat/completions', {}, {
      fetchImpl: neverResponds,
      timeoutMs: 5,
      consumeResponse: response => response.json()
    }),
    ProviderTimeoutError
  );
});

test('provider response bodies remain covered by the request deadline', async () => {
  let requestSignal;
  const headersThenStalls = async (_url, { signal }) => {
    requestSignal = signal;
    return {
      ok: true,
      status: 200,
      json: () => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      })
    };
  };
  await assert.rejects(
    fetchWithTimeout('https://api.openai.com/v1/chat/completions', {}, {
      fetchImpl: headersThenStalls,
      timeoutMs: 5,
      consumeResponse: response => response.json()
    }),
    ProviderTimeoutError
  );
  assert.equal(requestSignal.aborted, true);
});
