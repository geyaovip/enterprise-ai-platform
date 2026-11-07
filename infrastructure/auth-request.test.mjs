import { strict as assert } from 'node:assert';
import { api, ApiError } from '../packages/frontend/src/api.ts';

const originalFetch = globalThis.fetch;
let calls = 0;
try {
  for (const stage of ['headers', 'body']) {
    let signal;
    globalThis.fetch = async (_url, options) => {
      calls++; signal = options.signal;
      return stage === 'headers' ? new Promise(() => {}) : { ok: true, json: () => new Promise(() => {}) };
    };
    const before = calls;
    await assert.rejects(api.post('/auth/register', {}, { timeoutMs: 25, timeoutMessage: '结果待确认' }),
      error => error instanceof ApiError && error.code === 'REQUEST_TIMEOUT' && error.message === '结果待确认');
    assert.equal(signal.aborted, true);
    assert.equal(calls, before + 1, 'Registration is never retried automatically');
  }
  let signal;
  globalThis.fetch = async (_url, options) => { signal = options.signal; return Response.json({ ok: true }); };
  assert.deepEqual(await api.post('/auth/register', {}, { timeoutMs: 25 }), { ok: true });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(signal.aborted, false, 'Successful requests clear the timer');
  globalThis.fetch = async () => Response.json({ error: { code: 'CONFLICT', message: '该账号已被注册' } }, { status: 409 });
  await assert.rejects(api.post('/auth/register', {}, { timeoutMs: 25 }), error => error.status === 409 && error.message === '该账号已被注册');
  globalThis.fetch = async () => { await new Promise(resolve => setTimeout(resolve, 40)); return Response.json({ ok: true }); };
  assert.deepEqual(await api.post('/ai/tasks', {}), { ok: true }, 'Other requests retain their existing duration');
  console.log('PASS: header/body deadlines, abort, no retry, success timer cleanup, server errors, unaffected long requests');
} finally { globalThis.fetch = originalFetch; }
