require('dotenv/config');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('../dist/generated/prisma/client');
const { createApp } = require('../dist/server');
const { hashPassword } = require('../dist/modules/platform/security');
const { KnowledgeProcessor } = require('../dist/modules/knowledge/knowledge.processor');
const { KnowledgeEngineRegistry } = require('../dist/modules/knowledge/engine-registry');
const { RuntimeAdapterRegistry } = require('../dist/modules/ai/runtime-registry');
const { RagflowAdapter } = require('../dist/modules/knowledge/ragflow.adapter');
const { OpenClawAdapter } = require('../dist/modules/ai/openclaw.adapter');
const { NativeKnowledgeAdapter } = require('../dist/modules/knowledge/native.adapter');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || !/^postgresql:\/\/[^@]+@127\.0\.0\.1:54329\/suite_phase1_qa(?:\?|$)/.test(url)) throw Error('Phase1 test requires isolated suite_phase1_qa');
  process.env.NODE_ENV = 'test'; delete process.env.AGENT_RUNTIME_PROVIDER;
  const storage = await mkdtemp(join(tmpdir(), 'suite-phase1-')); process.env.KNOWLEDGE_STORAGE_DIR = storage;
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const marker = randomUUID().slice(0, 8); const password = 'Phase1-Test-Password-2026!';
  let app; let mock; const tenantIds = []; const userIds = [];
  const datasets = new Map(); const calls = []; const sessions = []; let malicious = false; let modelFailure = false; let modelDelay = 0; let knowledgeFailure = false; let runtimeHealth = 'ready';
  try {
    mock = http.createServer(async (req, res) => {
      try {
        const parts = []; for await (const part of req) parts.push(part); const raw = Buffer.concat(parts).toString();
        const path = new URL(req.url, 'http://test'); const json = req.headers['content-type']?.includes('application/json') && raw ? JSON.parse(raw) : {};
        calls.push({ path: path.pathname, method: req.method, json }); res.setHeader('content-type', 'application/json');
        if (path.pathname.endsWith('/readyz') || path.pathname.endsWith('/v1/models')) {
          if (req.headers.authorization !== 'Bearer test-runtime-token' || runtimeHealth === 'unauthorized') { res.writeHead(401).end('{}'); return; }
          if (runtimeHealth === 'not-ready') { res.writeHead(503).end('{}'); return; }
          res.end(JSON.stringify(path.pathname.endsWith('/v1/models') ? { data: runtimeHealth === 'missing-agent' ? [] : [{ id: 'openclaw/erp-assistant' }] } : { status: 'ready' })); return;
        }
        if (path.pathname.endsWith('/v1/responses')) {
          assert.equal(req.headers.authorization, 'Bearer test-runtime-token'); sessions.push(req.headers['x-openclaw-session-key']);
          if (modelFailure) { res.writeHead(503).end('{}'); return; }
          if (modelDelay) await new Promise(resolve => setTimeout(resolve, modelDelay));
          const tool = json.tools?.find(x => x.name === 'erp__customer__create');
          const wantsAction = json.input?.at(-1)?.content?.[0]?.text?.includes('创建客户');
          res.end(JSON.stringify({ id: randomUUID(), status: 'completed', output: wantsAction && tool ? [{ type: 'function_call', call_id: randomUUID(), name: tool.name, arguments: JSON.stringify({ code: `AI-${marker}`, name: 'AI 授权客户' }) }] : [{ type: 'message', content: [{ type: 'output_text', text: '参考企业采购规则 [1]，并以当前业务数据核对库存。' }] }], usage: { input_tokens: 10, output_tokens: 20 } })); return;
        }
        assert.equal(req.headers.authorization, 'Bearer test-knowledge-token');
        if (knowledgeFailure) { res.writeHead(503).end('{}'); return; }
        const end = data => res.end(JSON.stringify({ code: 0, data }));
        if (path.pathname === '/api/v1/datasets' && req.method === 'GET') { end([...datasets.values()].filter(d => (!path.searchParams.get('name') || d.name === path.searchParams.get('name')) && (!path.searchParams.get('id') || d.id === path.searchParams.get('id'))).map(d => ({ id: d.id, name: d.name }))); return; }
        if (path.pathname === '/api/v1/datasets' && req.method === 'DELETE') { for (const id of json.ids) datasets.delete(id); end(true); return; }
        if (path.pathname === '/api/v1/datasets' && req.method === 'POST') { const id = randomUUID(); datasets.set(id, { id, name: json.name, docs: new Map() }); end({ id }); return; }
        const match = path.pathname.match(/^\/api\/v1\/datasets\/([^/]+)\/(documents|chunks)$/);
        if (match) {
          const dataset = datasets.get(match[1]); assert.ok(dataset);
          if (match[2] === 'chunks') { end(true); return; }
          if (req.method === 'POST') { assert.ok(raw.includes('企业采购规则')); const id = randomUUID(); dataset.docs.set(id, { id, run: '3', progress: 0.99 }); end([{ id }]); return; }
          if (req.method === 'DELETE') { for (const id of json.ids) dataset.docs.delete(id); end(true); return; }
          end({ docs: [...dataset.docs.values()].filter(d => !path.searchParams.get('id') || d.id === path.searchParams.get('id')) }); return;
        }
        if (path.pathname === '/api/v1/retrieval') { assert.ok(json.document_ids.length); end({ chunks: json.document_ids.map(id => ({ id: randomUUID(), document_id: malicious ? 'unauthorized-document' : id, kb_id: json.dataset_ids.find(ds => datasets.get(ds).docs.has(id)), content: '企业采购规则：采购先核对库存，再由管理员审核。', positions: [[1, 0, 200, 10, 30]] })) }); return; }
        res.writeHead(404).end('{}');
      } catch (e) { res.writeHead(500).end('{}'); process.stderr.write(`Mock contract failure: ${e.message}\n`); }
    });
    await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve)); const upstream = `http://127.0.0.1:${mock.address().port}`;
    const tenantA = await db.tenant.create({ data: { slug: `phase1-a-${marker}`, name: 'Phase1 A' } }); const tenantB = await db.tenant.create({ data: { slug: `phase1-b-${marker}`, name: 'Phase1 B' } }); tenantIds.push(tenantA.id, tenantB.id);
    for (const t of [tenantA, tenantB]) { await db.tenantApp.create({ data: { tenantId: t.id, appId: 'erp' } }); await db.tenantCapability.createMany({ data: ['ai', 'knowledge'].map(capability => ({ tenantId: t.id, capability, delivered: true, enabled: true })) }); }
    const makeUser = async (role, tenant, operator = false) => { const user = await db.user.create({ data: { email: `${role}-${marker}@phase1.test`, name: role, passwordHash: hashPassword(password), ...(operator ? { platformRole: 'operator' } : {}) } }); userIds.push(user.id); return { user, member: tenant ? await db.membership.create({ data: { tenantId: tenant.id, userId: user.id, role } }) : null }; };
    const admin = await makeUser('admin', tenantA); const sales = await makeUser('sales', tenantA); const other = await makeUser('finance', tenantB); const op = await makeUser('operator', null, true);
    app = await createApp(); await app.listen(0, '127.0.0.1'); const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    const request = async (path, method = 'GET', body, cookie) => { const r = await fetch(base + path, { method, headers: { origin: 'http://127.0.0.1:4601', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json(), cookie: r.headers.get('set-cookie') }; };
    const login = async user => { const r = await request('/auth/login', 'POST', { email: user.email, password }); assert.equal(r.status, 201); return r.cookie.split(';')[0]; };
    const ac = await login(admin.user), sc = await login(sales.user), oc = await login(op.user), bc = await login(other.user); const tenantPath = `/tenants/${tenantA.slug}`; const knowledge = `${tenantPath}/knowledge`;
    assert.equal((await request(`${tenantPath}/service-status`)).status, 401);
    assert.equal((await request(`${tenantPath}/service-status`, 'GET', undefined, bc)).status, 403);
    assert.deepEqual((await request(`${tenantPath}/service-status`, 'GET', undefined, sc)).body, { ai: { enabled: true, configured: false }, knowledge: { enabled: true, configured: false } });
    assert.equal((await request('/operator/tenants', 'GET', undefined, ac)).status, 403);
    assert.equal((await request(knowledge + '/spaces', 'GET', undefined, oc)).status, 403);
    assert.equal((await request('/operator/tenants', 'GET', undefined, oc)).status, 200);
    const configure = async (kind, scopeKey, baseUrl, version = 0, provider = kind === 'runtime' ? 'openclaw' : 'ragflow') => request(`/operator/tenants/${tenantA.id}/infrastructure/${kind}/${scopeKey}`, 'PUT', { provider, baseUrl, secret: kind === 'runtime' ? 'test-runtime-token' : 'test-knowledge-token', version, options: kind === 'runtime' ? { agentId: 'erp-assistant' } : { embeddingModel: 'test-embedding' } }, oc);
    for (const [mode, code] of [['not-ready', 'RUNTIME_NOT_READY'], ['unauthorized', 'RUNTIME_CREDENTIALS_REJECTED'], ['missing-agent', 'RUNTIME_ASSISTANT_MISSING']]) {
      runtimeHealth = mode;
      const rejected = await configure('runtime', admin.member.id, `${upstream}/admin`);
      assert.equal(rejected.status, 503); assert.equal(rejected.body.error.code, code);
      assert.equal(await db.infrastructureBinding.count({ where: { tenantId: tenantA.id, kind: 'runtime' } }), 0, 'Failed activation must not create a binding');
      assert.equal((await request(`${tenantPath}/service-status`, 'GET', undefined, ac)).body.ai.configured, false);
    }
    runtimeHealth = 'ready';
    assert.equal((await configure('runtime', admin.member.id, `${upstream}/admin`)).status, 200);
    runtimeHealth = 'not-ready';
    assert.equal((await configure('runtime', admin.member.id, `${upstream}/changed`, 1)).status, 503);
    const preserved = await db.infrastructureBinding.findFirstOrThrow({ where: { tenantId: tenantA.id, kind: 'runtime', scopeKey: admin.member.id } });
    assert.equal(preserved.version, 1); assert.equal(preserved.baseUrl, `${upstream}/admin`, 'Failed change must preserve the old environment');
    const draft = await request(`/operator/tenants/${tenantA.id}/infrastructure/runtime/${admin.member.id}`, 'PUT', { provider: 'openclaw', baseUrl: `${upstream}/admin`, version: 1, enabled: false, options: { agentId: 'erp-assistant' } }, oc);
    assert.equal(draft.status, 200); assert.equal(draft.body.enabled, false);
    assert.equal((await request(`${tenantPath}/service-status`, 'GET', undefined, ac)).body.ai.configured, false);
    assert.equal((await configure('runtime', admin.member.id, `${upstream}/admin`, 2)).status, 503);
    assert.equal((await db.infrastructureBinding.findUnique({ where: { id: preserved.id } })).enabled, false);
    runtimeHealth = 'ready';
    assert.equal((await configure('runtime', admin.member.id, `${upstream}/admin`, 2)).status, 200);
    assert.equal((await request(`${tenantPath}/service-status`, 'GET', undefined, ac)).body.ai.configured, true);
    assert.equal((await request(`${tenantPath}/service-status`, 'GET', undefined, sc)).body.ai.configured, false, 'A member must not inherit another member runtime status');
    assert.equal((await configure('runtime', sales.member.id, `${upstream}/admin`)).status, 409);
    assert.equal((await configure('runtime', sales.member.id, `${upstream}/sales`)).status, 200);
    assert.equal((await configure('knowledge', 'tenant', upstream)).status, 200);
    const nativeOnPlainPg = await db.infrastructureBinding.findFirstOrThrow({ where: { tenantId: tenantA.id, kind: 'knowledge' } });
    await assert.rejects(() => new NativeKnowledgeAdapter({ ...nativeOnPlainPg, provider: 'native' }, db).health(), error => error.code === 'VECTOR_EXTENSION_UNAVAILABLE');
    assert.deepEqual((await request(`${tenantPath}/service-status`, 'GET', undefined, sc)).body, { ai: { enabled: true, configured: true }, knowledge: { enabled: true, configured: true } });
    const config = await request(`/operator/tenants/${tenantA.id}/configuration`, 'GET', undefined, oc); assert.ok(!JSON.stringify(config.body).includes('test-runtime-token')); assert.ok(!JSON.stringify(config.body).includes('secretCiphertext'));
    for (const b of config.body.bindings) { assert.equal((await request(`/operator/tenants/${tenantA.id}/infrastructure/${b.id}/health`, 'GET', undefined, oc)).body.state, 'reachable'); assert.equal((await request(`/operator/tenants/${tenantA.id}/infrastructure/${b.id}/health`, 'GET', undefined, ac)).status, 403); }
    knowledgeFailure = true; const kb = config.body.bindings.find(b => b.kind === 'knowledge'); assert.equal((await request(`/operator/tenants/${tenantA.id}/infrastructure/${kb.id}/health`, 'GET', undefined, oc)).body.state, 'unavailable'); knowledgeFailure = false;
    const space = await request(`${knowledge}/spaces`, 'POST', { name: '企业采购规则', visibility: 'restricted', grants: [{ subjectType: 'member', subjectId: sales.member.id, access: 'read' }] }, ac); assert.equal(space.status, 201);
    const secondSpace = await request(`${knowledge}/spaces`, 'POST', { name: '仅管理员' }, ac); assert.equal(secondSpace.status, 201);
    assert.equal((await request(`${knowledge}/spaces/${space.body.id}/documents`, 'GET', undefined, bc)).status, 403);
    const uploadBody = { filename: '采购规则.md', title: '企业采购规则', contentBase64: Buffer.from('企业采购规则：采购先核对库存，再由管理员审核。').toString('base64') };
    assert.equal((await request(`${knowledge}/spaces/${space.body.id}/documents`, 'POST', uploadBody, sc)).status, 404);
    const upload = await request(`${knowledge}/spaces/${space.body.id}/documents`, 'POST', uploadBody, ac); assert.equal(upload.status, 201);
    const hidden = await request(`${knowledge}/spaces/${secondSpace.body.id}/documents`, 'POST', uploadBody, ac); assert.equal(hidden.status, 201);
    const processor = app.get(KnowledgeProcessor); await processor.tick();
    await request(`/operator/tenants/${tenantA.id}/capabilities/knowledge`, 'PUT', { delivered: false }, oc); const beforePause = calls.length; await processor.tick(); assert.equal(calls.length, beforePause, 'Revoked knowledge delivery must not upload queued originals'); assert.equal((await request(`${knowledge}/spaces`, 'GET', undefined, ac)).status, 403);
    await request(`/operator/tenants/${tenantA.id}/capabilities/knowledge`, 'PUT', { delivered: true }, oc); assert.equal((await request(`${tenantPath}/capabilities/knowledge`, 'PATCH', { enabled: true }, ac)).status, 200);
    knowledgeFailure = true; await processor.tick();
    const retry = await db.knowledgeIndex.findFirst({ where: { tenantId: tenantA.id, errorCode: { not: null } } }); assert.equal(retry.status, 'queued'); assert.equal(retry.attempts, 1); assert.ok(retry.nextAttemptAt > new Date());
    knowledgeFailure = false; await db.knowledgeIndex.update({ where: { id: retry.id }, data: { nextAttemptAt: new Date(0) } });
    for (let i = 0; i < 6; i++) await processor.tick();
    const activeIndex = await db.knowledgeIndex.findFirst({ where: { version: { documentId: upload.body.id } } });
    await db.knowledgeIndex.update({ where: { id: activeIndex.id }, data: { status: 'parsing' } });
    assert.equal((await request(`${knowledge}/documents/${upload.body.id}/reindex`, 'POST', {}, ac)).status, 409);
    await db.knowledgeIndex.update({ where: { id: activeIndex.id }, data: { status: 'ready' } });
    const docs = await request(`${knowledge}/spaces/${space.body.id}/documents`, 'GET', undefined, sc); assert.equal(docs.body.items[0].versions[0].processingStatus, 'ready'); assert.equal(docs.body.total, 1);
    const emptyPage = await request(`${knowledge}/spaces/${space.body.id}/documents?page=2&pageSize=1`, 'GET', undefined, sc); assert.equal(emptyPage.body.items.length, 0); assert.equal(emptyPage.body.total, 1);
    assert.equal((await request(`${knowledge}/spaces/${space.body.id}/documents?page=0`, 'GET', undefined, sc)).status, 400);
    const search = await request(`${knowledge}/search`, 'POST', { query: '采购规则' }, sc); assert.equal(search.status, 201); assert.equal(search.body.length, 1); const citationId = search.body[0].id;
    const searchCall = calls.filter(c => c.path === '/api/v1/retrieval').at(-1); assert.equal(searchCall.json.document_ids.length, 1);
    const original = await fetch(`${base}${knowledge}/documents/${upload.body.id}/versions/1/original`, { headers: { cookie: sc } }); assert.equal(original.status, 200); assert.equal(await original.text(), Buffer.from(uploadBody.contentBase64, 'base64').toString());
    malicious = true; assert.equal((await request(`${knowledge}/search`, 'POST', { query: '采购' }, sc)).status, 503); malicious = false;
    const conversation = await request(`${tenantPath}/ai/conversations`, 'POST', { title: '业务与知识' }, sc); assert.equal(conversation.status, 201);
    const reply = await request(`${tenantPath}/ai/conversations/${conversation.body.id}/messages`, 'POST', { version: 1, content: '请核对企业采购规则', useKnowledge: true }, sc); assert.equal(reply.status, 201); assert.equal(reply.body.message.citations[0].id, citationId);
    const execution = calls.filter(c => c.path.endsWith('/v1/responses')).at(-1); assert.ok(execution.json.instructions.includes('企业采购规则'));
    const action = await request(`${tenantPath}/ai/conversations/${conversation.body.id}/messages`, 'POST', { version: reply.body.version, content: '创建客户', allowAction: true }, sc); assert.equal(action.status, 201); assert.ok(action.body.message.actionId);
    assert.ok(await db.erpCustomer.findFirst({ where: { tenantId: tenantA.id, code: `AI-${marker}` } })); assert.equal(new Set(sessions).size, sessions.length);
    const revoked = await request(`${knowledge}/spaces/${space.body.id}`, 'PATCH', { name: space.body.name, visibility: 'restricted', version: 1, grants: [] }, ac); assert.equal(revoked.status, 200);
    assert.equal((await request(`${knowledge}/citations/${citationId}`, 'GET', undefined, sc)).status, 404);
    assert.equal((await fetch(`${base}${knowledge}/documents/${upload.body.id}/versions/1/original`, { headers: { cookie: sc } })).status, 404);
    const history = await request(`${tenantPath}/ai/conversations/${conversation.body.id}`, 'GET', undefined, sc); assert.ok(history.body.messages.some(m => m.content.includes('不再展示')));
    await request(`/operator/tenants/${tenantA.id}/capabilities/ai`, 'PUT', { delivered: false }, oc); assert.equal((await request(`${tenantPath}/ai/conversations`, 'GET', undefined, sc)).status, 403); assert.equal((await request(`${tenantPath}/capabilities/ai`, 'PATCH', { enabled: true }, ac)).status, 400);
    assert.equal((await request(`${tenantPath}/service-status`, 'GET', undefined, sc)).body.ai.enabled, false);
    await request(`/operator/tenants/${tenantA.id}/capabilities/ai`, 'PUT', { delivered: true }, oc); await request(`${tenantPath}/capabilities/ai`, 'PATCH', { enabled: true }, ac);
    modelFailure = true; const failed = await request(`${tenantPath}/ai/conversations/${conversation.body.id}/messages`, 'POST', { version: action.body.version, content: '核对采购' }, sc); assert.ok(failed.body.message.content.includes('未完成')); modelFailure = false;
    // Contract replacement uses an installed adapter, then restores the designated implementation.
    const runtimeRegistry = app.get(RuntimeAdapterRegistry);
    runtimeRegistry.install('test-runtime', () => ({ provider: 'test-replacement', capabilities: { streaming: false, clientTools: true, cancellation: true }, health: async () => {}, execute: async () => ({ text: '替换适配器回答', toolRequests: [] }) }));
    assert.equal((await configure('runtime', sales.member.id, `${upstream}/sales`, 1, 'test-runtime')).status, 200);
    const switched = await request(`${tenantPath}/ai/conversations/${conversation.body.id}/messages`, 'POST', { version: failed.body.version, content: '核对采购' }, sc); assert.equal(switched.body.message.content, '替换适配器回答');
    assert.equal((await configure('runtime', sales.member.id, `${upstream}/sales`, 2, 'openclaw')).status, 200);
    const restored = await request(`${tenantPath}/ai/conversations/${conversation.body.id}/messages`, 'POST', { version: switched.body.version, content: '核对采购' }, sc); assert.ok(restored.body.message.content.includes('企业采购规则')); assert.equal((await request(`${tenantPath}/ai/conversations/${conversation.body.id}`, 'GET', undefined, sc)).body.id, conversation.body.id);
    modelDelay = 600;
    const cancellation = request(`${tenantPath}/ai/conversations/${conversation.body.id}/messages`, 'POST', { version: restored.body.version, content: '请稍后核对采购' }, sc);
    let running;
    for (let i = 0; i < 30; i++) { const runs = await request(`${tenantPath}/ai/conversations/${conversation.body.id}/runs`, 'GET', undefined, sc); running = runs.body.find(r => r.status === 'running'); if (running) break; await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.ok(running);
    assert.equal((await configure('runtime', sales.member.id, `${upstream}/sales`, 3)).status, 409);
    assert.equal((await request(`${tenantPath}/ai/conversations/${conversation.body.id}/runs/${running.id}/cancel`, 'POST', {}, ac)).status, 404);
    assert.equal((await request(`${tenantPath}/ai/conversations/${conversation.body.id}/runs/${running.id}/cancel`, 'POST', {}, sc)).status, 201);
    assert.ok((await cancellation).body.message.content.includes('未完成'));
    assert.equal((await db.aiExecution.findUnique({ where: { id: running.id } })).status, 'cancelled'); modelDelay = 0;
    const engineRegistry = app.get(KnowledgeEngineRegistry); const realFactory = b => new RagflowAdapter(b);
    engineRegistry.install('test-knowledge', b => { const engine = realFactory(b); return { provider: 'test-replacement', health: () => engine.health(), createDataset: n => engine.createDataset(n), upload: (id, f) => engine.upload(id, f), parse: s => engine.parse(s), status: s => engine.status(s), remove: s => engine.remove(s), retrieve: (q, s) => engine.retrieve(q, s) }; });
    assert.equal((await configure('knowledge', 'tenant', upstream, 1, 'test-knowledge')).status, 200); for (let i = 0; i < 6; i++) await processor.tick();
    const rebuilt = await request(`${knowledge}/search`, 'POST', { query: '采购', spaceId: space.body.id }, ac); assert.equal(rebuilt.body[0].id, citationId);
    assert.equal((await configure('knowledge', 'tenant', upstream, 2, 'ragflow')).status, 200); for (let i = 0; i < 6; i++) await processor.tick(); assert.equal((await request(`${knowledge}/search`, 'POST', { query: '采购', spaceId: space.body.id }, ac)).body[0].id, citationId);
    assert.equal((await request(`${knowledge}/documents/${upload.body.id}`, 'PATCH', { status: 'deleted', version: 1 }, ac)).status, 200); for (let i = 0; i < 4; i++) await processor.tick();
    assert.equal((await request(`${knowledge}/citations/${citationId}`, 'GET', undefined, ac)).status, 404); assert.equal((await request(`${knowledge}/search`, 'POST', { query: '采购', spaceId: space.body.id }, ac)).body.length, 0);
    assert.equal((await request(`/operator/tenants/${tenantA.id}/capabilities/erp`, 'PUT', { delivered: false }, oc)).status, 200); assert.equal((await request(`${tenantPath}/apps/erp`, 'PATCH', { enabled: true }, ac)).status, 400); assert.equal((await request(`${tenantPath}/erp/products`, 'GET', undefined, sc)).status, 403);
    process.stdout.write('Phase1 operator separation, entitlements, OpenClaw/RAGFlow HTTP contracts, originals, ACL/revocation, citations, failure and replacement/rollback: passed\n');
  } finally {
    if (app) await app.close(); if (mock) await new Promise(resolve => mock.close(resolve));
    const where = { tenantId: { in: tenantIds } };
    for (const table of ['knowledgeEngineTransition','knowledgeEngineProfile','knowledgeCitation','knowledgeIndex','knowledgeDocumentVersion','knowledgeDocument','knowledgeGrant','knowledgeSpace','aiExecution','infrastructureBinding','tenantCapability','operatorAudit','aiAction','aiConversation','aiUsage','erpCustomer','auditEvent','membershipOrg','orgUnit','tenantApp','membership']) await db[table].deleteMany({ where });
    await db.tenant.deleteMany({ where: { id: { in: tenantIds } } }); await db.session.deleteMany({ where: { userId: { in: userIds } } }); await db.user.deleteMany({ where: { id: { in: userIds } } }); await db.$disconnect(); await rm(storage, { recursive: true, force: true });
  }
}
main().catch(e => { process.stderr.write(`${e.stack}\n`); process.exitCode = 1; });
