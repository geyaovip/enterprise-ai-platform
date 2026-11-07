const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
process.env.NODE_ENV = 'test';
process.env.NATIVE_AI_MODEL_ENABLED = 'true';
process.env.NATIVE_CHAT_MODEL_ID = 'deepseek-v4-1-flash-economy-261017';
process.env.AI_PROVIDER_ALLOWED_HOSTS = 'models.example,ark.cn-beijing.volces.com';
process.env.AI_ENCRYPTION_KEY = randomBytes(32).toString('base64');
const { ModelGateway } = require('../dist/modules/ai/model.gateway');

(async () => {
  const rows = new Map(), audits = [], ledgers = [], calls = [];
  let active = false;
  const db = {
    aiProviderSettings: {
      findUnique: async ({where}) => rows.get(where.tenantId) ?? null,
      upsert: async ({where, create, update}) => rows.set(where.tenantId, {...(rows.get(where.tenantId) ?? create), ...update}),
    },
    aiExecution: {count: async () => active ? 1 : 0},
    auditEvent: {create: async ({data}) => audits.push(data)},
    aiModelUsage: {create: async ({data}) => ledgers.push(data), update: async () => {}},
    aiUsage: {create: async () => {}},
    $transaction: async fn => fn(db),
  };
  const gateway = new ModelGateway(db, {require: (ctx, permission) => {
    assert.equal(permission, 'platform.manage');
    if (!ctx.admin) throw new Error('FORBIDDEN');
  }});
  const ctx = {tenantId: 'tenant-a', userId: 'user-a', membershipId: 'member-a', requestId: 'request-a', admin: true, app: {appId: 'erp'}};
  const input = {model: 'customer-model', baseUrl: 'https://models.example/v1', apiKey: 'synthetic-customer-key'};
  const oldFetch = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({url, options, body: JSON.parse(options.body)});
    return {ok: true, json: async () => ({choices: [{message: {content: 'synthetic reply'}}], usage: {prompt_tokens: 2, completion_tokens: 2}})};
  };
  try {
    const saved = await gateway.save(ctx, input);
    assert.equal(calls.length, 0, 'saving must not call or probe the model');
    assert.equal(saved.model, input.model);
    assert.ok(!JSON.stringify(saved).includes(input.apiKey));
    assert.notEqual(rows.get(ctx.tenantId).keyCiphertext, input.apiKey);
    assert.equal((await gateway.status(ctx)).model, input.model);
    assert.ok(!JSON.stringify(await gateway.status(ctx)).includes(input.apiKey));
    assert.deepEqual(await gateway.runtimeSettings(ctx.tenantId), input);
    assert.deepEqual(await gateway.status({...ctx, tenantId: 'tenant-b'}), {configured: false});
    assert.equal(await gateway.runtimeSettings('tenant-b'), null);
    await assert.rejects(() => gateway.save({...ctx, admin: false}, input), /FORBIDDEN/);
    active = true;
    await assert.rejects(() => gateway.save(ctx, {...input, model: 'changed'}), /仍有 AI 请求/);
    active = false;
    await assert.rejects(() => gateway.save(ctx, {...input, baseUrl: 'https://unapproved.example/v1'}), /允许名单/);
    assert.equal(await gateway.complete(ctx, [{role: 'user', content: 'synthetic question'}]), 'synthetic reply');
    assert.equal(calls[0].url, input.baseUrl + '/chat/completions');
    assert.equal(calls[0].body.model, input.model);
    assert.equal(calls[0].options.headers.authorization, 'Bearer ' + input.apiKey);
    assert.equal(calls[0].body.thinking, undefined);
    assert.equal(ledgers[0].requestedModel, input.model);
    global.fetch = async () => ({ok: false, status: 401});
    await assert.rejects(() => gateway.complete(ctx, [{role: 'user', content: 'synthetic question'}]), /模型服务返回 401/);
    assert.equal(audits.length, 1);
    console.log('Enterprise model checks passed: save without probe, selected model/key, isolation, permissions, encryption, in-flight protection, real-use error path. Synthetic provider only.');
  } finally {
    global.fetch = oldFetch;
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
