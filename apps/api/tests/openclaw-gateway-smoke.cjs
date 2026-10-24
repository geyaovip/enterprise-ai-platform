require('dotenv/config');
const assert = require('node:assert/strict');
const http = require('node:http');
const { readFile, writeFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { OpenClawAdapter } = require('../dist/modules/ai/openclaw.adapter');
const { infrastructureSecret } = require('../dist/modules/platform/infrastructure-contract');
async function main() {
  process.env.NODE_ENV = 'test';
  const root = resolve('../..');
  const profile = '00000000-0000-4000-8000-000000000001';
  const binding = JSON.parse(await readFile(resolve(root, 'var/openclaw-members', profile, 'binding.json'), 'utf8'));
  const configPath = resolve(root, 'var/openclaw-members', profile, 'openclaw.json');
  const originalConfig = await readFile(configPath, 'utf8');
  const modelConfig = JSON.parse(originalConfig);
  assert.equal(modelConfig.models.providers['suite-model'].baseUrl, 'http://127.0.0.1:4899/v1', 'Only the explicitly prepared fixture Gateway is allowed');
  const calls = [];
  const model = http.createServer(async (req, res) => {
    if (req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
    const parts = []; for await (const p of req) parts.push(p);
    const input = JSON.parse(Buffer.concat(parts)); calls.push(input);
    const wantsTool = JSON.stringify(input.messages).includes('请创建客户');
    const tool = input.tools?.find(t => t.function?.name === 'erp__customer__create');
    const message = wantsTool && tool ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_fixture', type: 'function', function: { name: tool.function.name, arguments: JSON.stringify({ code: 'GATEWAY-SMOKE', name: 'Gateway 客户' }) } }] } : { role: 'assistant', content: '企业采购规则：先核对库存，再提交审核。' };
    const id = randomUUID(); const finish = message.tool_calls ? 'tool_calls' : 'stop';
    if (input.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = message.tool_calls ? { role: 'assistant', tool_calls: [{ index: 0, ...message.tool_calls[0] }] } : message;
      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: input.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: input.model, choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 8, completion_tokens: 9, total_tokens: 17 } })}\n\n`);
      res.end('data: [DONE]\n\n');
    } else res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id, object: 'chat.completion', created: 1, model: input.model, choices: [{ index: 0, message, finish_reason: finish }], usage: { prompt_tokens: 8, completion_tokens: 9, total_tokens: 17 } }));
  });
  let child; let diagnostic = '';
  try {
    modelConfig.agents.defaults.contextInjection = 'never';
    modelConfig.agents.ownership = 'explicit';
    modelConfig.agents.defaults.systemAgent = { agentId:'erp-assistant' };
    modelConfig.session = { ...modelConfig.session, notifyOnCreate: false };
    for (const suffix of ['fast','read']) {
      const entry = JSON.parse(JSON.stringify(modelConfig.agents.entries['erp-assistant']));
      delete entry.default;
      entry.tools = { allow: ['session_status'] };
      entry.agentDir = resolve(root, 'var/openclaw-members', profile, 'agents', 'erp-assistant-' + suffix, 'agent');
      if (suffix === 'fast') entry.params = { ...entry.params, extra_body: { thinking: { type: 'disabled' } } };
      modelConfig.agents.entries['erp-assistant-' + suffix] = entry;
    }
    modelConfig.tools.allow = [...new Set([...modelConfig.tools.allow, 'session_status'])];
    await writeFile(configPath, JSON.stringify(modelConfig), { mode: 0o600 });
    await new Promise(r => model.listen(4899, '127.0.0.1', r));
    child = spawn(process.execPath, ['infrastructure/openclaw-member.mjs', 'start', profile], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, OPENCLAW_NO_RESPAWN: '1' } });
    child.stdout.on('data', d => { diagnostic = (diagnostic + d).slice(-12000); }); child.stderr.on('data', d => { diagnostic = (diagnostic + d).slice(-12000); });
    let ready = false;
    for (let i = 0; i < 60; i++) { if (child.exitCode !== null) throw Error(`Gateway startup failed: ${diagnostic.replace(/Bearer\s+\S+/g, 'Bearer [redacted]')}`); try { ready = (await fetch(binding.baseUrl + '/readyz', { headers: { authorization: `Bearer ${binding.secret}` } })).ok; } catch {} if (ready) break; await new Promise(r => setTimeout(r, 500)); }
    if (!ready) { const probe = await fetch(binding.baseUrl + '/readyz', { headers: { authorization: `Bearer ${binding.secret}` } }); process.stderr.write(JSON.stringify(await probe.json()) + '\n'); }
    assert.ok(ready, 'Gateway readiness timeout');
    const adapter = new OpenClawAdapter({ ...binding, secretCiphertext: infrastructureSecret(binding.secret), options: { ...binding.options, agentId:'erp-assistant', ephemeralTurns:true } });
    try { await adapter.health(); } catch (error) {
      const readyResponse = await fetch(binding.baseUrl + '/readyz', { headers: { authorization: `Bearer ${binding.secret}` } });
      const modelsResponse = await fetch(binding.baseUrl + '/v1/models', { headers: { authorization: `Bearer ${binding.secret}` } });
      const models = await modelsResponse.json();
      process.stderr.write(JSON.stringify({ readyStatus: readyResponse.status, modelsStatus: modelsResponse.status, models: models.data?.map(m => m.id) }) + '\n'); throw error;
    }
    const context = { request: { membershipId: profile }, sessionId: 'platform-conversation-smoke' };
    const tool = { id: 'erp.customer.create', description: '创建 ERP 客户草稿', parameters: { type: 'object', properties: { code: { type: 'string' }, name: { type: 'string' } }, required: ['code','name'], additionalProperties: false } };
    const plain = await adapter.execute({ context, runId: randomUUID(), messages: [{ role: 'user', content: '请核对采购规则' }], tools: [tool], signal: AbortSignal.timeout(55000) }).catch(error => { process.stderr.write(diagnostic.slice(-3000) + '\n'); throw error; });
    assert.ok(plain.text.includes('采购规则'));
    let partial = '';
    const streamed = await adapter.execute({ context, runId: randomUUID(), messages: [{ role: 'user', content: '请核对采购规则' }], tools: [tool], signal: AbortSignal.timeout(55000), onTextDelta: async delta => { partial += delta; } });
    assert.ok(streamed.text.includes('采购规则'));
    assert.ok(partial.includes('采购规则'), 'Gateway must forward readable SSE text before completion');
    assert.ok(streamed.usage.transportTiming.gatewayFirstDeltaMs !== null);
    const toolEvents=[];
    const action = await adapter.execute({ context, runId: randomUUID(), messages: [{ role: 'user', content: '请创建客户' }], tools: [tool], signal: AbortSignal.timeout(55000),onTextDelta:async()=>{},onEvent:async event=>{toolEvents.push(event);} });
    if (!action.toolRequests.length) process.stderr.write(JSON.stringify({ text: action.text, calls: calls.map(c => ({ tools: c.tools?.map(t => t.function.name), message: c.messages?.at(-1) })) }) + '\n');
    assert.equal(toolEvents.length,1);assert.equal(toolEvents[0].toolId,'erp.customer.create');assert.equal(toolEvents[0].callId,action.toolRequests[0].callId);assert.deepEqual(Object.keys(toolEvents[0]).sort(),['callId','toolId','type']);
    assert.equal(action.toolRequests[0]?.toolId, 'erp.customer.create'); assert.equal(action.toolRequests[0].input.code, 'GATEWAY-SMOKE');
    for (const c of calls) assert.ok((c.tools ?? []).every(t => t.function.name === 'erp__customer__create'), 'Built-in tools must never reach the model');
    {
      const fast = new OpenClawAdapter({ ...binding, secretCiphertext: infrastructureSecret(binding.secret), options: { agentId: 'erp-assistant', fastAgentId: 'erp-assistant-fast', readAgentId:'erp-assistant-read', ephemeralTurns:true } });
      await fast.health();
      const fastReply = await fast.execute({ context, runId: randomUUID(), messages: [{ role: 'user', content: '你好' }], thinkingMode:'fast', signal: AbortSignal.timeout(55000) });
      assert.equal(fastReply.toolRequests.length,0);
      assert.equal(calls.at(-1)?.tools?.length,1,'Only the fast agent read-only tool should remain');
      assert.equal(calls.at(-1)?.tools?.[0]?.function?.name,'session_status');
      assert.equal(calls.at(-1)?.thinking?.type, 'disabled', 'Fast agent must forward the vendor thinking override');
      assert.equal(calls[0]?.thinking, undefined, 'Standard agent must retain its default reasoning mode');
      let readPartial = '';
      const readReply = await fast.execute({ context, runId: randomUUID(), messages: [{role:'user',content:'详细解释采购规则，只回答问题'}], thinkingMode:'deep', signal:AbortSignal.timeout(55000), onTextDelta:async delta=>{readPartial+=delta;} });
      assert.equal(readReply.toolRequests.length,0);
      assert.ok(readPartial.includes('采购规则'));
      assert.equal(calls.at(-1)?.tools?.[0]?.function?.name,'session_status');
      assert.equal(calls.at(-1)?.thinking,undefined,'Read-only deep agent retains model reasoning');
    }
    process.stdout.write('Real OpenClaw 2026.9.7 Gateway health, HTTP execution and streaming, platform client Tool round trip and built-in Tool isolation passed; downstream model is a test fixture.\n');
  } finally { if (child && child.exitCode === null) { child.kill('SIGTERM'); await new Promise(r => child.once('exit', r)); } await new Promise(r => model.close(r)); await writeFile(configPath,originalConfig,{mode:0o600}); }
}
main().catch(e => { process.stderr.write(e.stack + '\n'); process.exitCode = 1; });
