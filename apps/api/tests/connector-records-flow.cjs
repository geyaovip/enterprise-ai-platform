const assert = require('node:assert/strict');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { createApp } = require('../dist/server');
const { PrismaService } = require('../dist/modules/prisma.service');
const { createFixture, fixtureHttp } = require('../scripts/workflow-fixture.cjs');

const apps = ['erp', 'crm', 'mes', 'geo', 'content', 'manufacturing'];
const webOrigin = 'http://127.0.0.1:4601';
const unique = () => randomUUID().slice(0, 8);

async function main() {
  assert.equal(process.env.CONNECTOR_RECORDS_QA, 'isolated');
  assert.match(process.env.DATABASE_URL, /@127\.0\.0\.1:54329\/suite_phase1_qa$/);
  process.env.NODE_ENV = 'test';
  process.env.WEB_ORIGIN = webOrigin;
  process.env.NATIVE_AI_MODEL_ENABLED = 'false';
  const db = new PrismaService();
  const clients = [];
  let app;
  let checks = 0;
  const eq = (actual, expected) => { checks++; assert.deepEqual(actual, expected); };
  try {
    const fixture = await createFixture(db, 'erp-flow-test-records-' + unique());
    const tenantId = fixture.tenant.id;
    const tenantKey = fixture.tenant.slug;
    await db.tenantApp.createMany({
      data: apps.map(appId => ({ tenantId, appId, granted: true, enabled: true })), skipDuplicates: true,
    });
    app = await createApp();
    const http = await fixtureHttp(app, fixture);
    const origin = 'http://127.0.0.1:' + app.getHttpServer().address().port;
    process.env.CONNECTOR_PUBLIC_ORIGIN = origin;
    const cookies = { Cookie: http.cookies.admin, Origin: webOrigin };

    async function request(path, { body, headers = {}, expected = 200 } = {}) {
      const response = await fetch(origin + path, {
        method: body ? 'POST' : 'GET', redirect: 'manual',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
      assert.equal(response.status, expected, path + ' ' + JSON.stringify(data));
      return { response, data };
    }

    async function connect(appId, host, allowRecords) {
      const redirect = host === 'workbuddy'
        ? 'workbuddy://workbuddy/mcp/connector:zhixing-ark-' + appId + '/oauth/callback'
        : 'http://127.0.0.1:4688/oauth/callback';
      const clientName = host === 'workbuddy' ? 'WorkBuddy 测试' : 'DeepSeek Harness · 知行方舟 测试';
      const { data: client } = await request('/api/v1/oauth/register', {
        expected: 201, body: { client_name: clientName, redirect_uris: [redirect], token_endpoint_auth_method: 'none' },
      });
      const verifier = randomBytes(32).toString('base64url');
      const resource = origin + '/api/v1/mcp/' + appId;
      const authorize = new URLSearchParams({
        client_id: client.client_id, redirect_uri: redirect, response_type: 'code', resource,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
        ...(host === 'harness' ? { scope: appId + '.read ' + appId + '.records' } : {}),
      });
      const { response } = await request('/api/v1/oauth/authorize?' + authorize, { expected: 302 });
      const id = new URL(response.headers.get('location')).searchParams.get('request');
      const path = '/api/v1/connect/requests/' + id;
      const { data: consent } = await request(path, { headers: cookies });
      eq(consent.tenants.find(row => row.key === tenantKey).recordsAllowed, true);
      const { data: answer } = await request(path, { body: { nonce: consent.nonce, tenantKey, decision: 'allow', allowRecords },
        headers: cookies, expected: 201 });
      const { data: tokens } = await request('/api/v1/oauth/token', {
        body: { grant_type: 'authorization_code', client_id: client.client_id, resource, redirect_uri: redirect,
          code: new URL(answer.redirect).searchParams.get('code'), code_verifier: verifier },
      });
      eq(tokens.scope, appId + '.read' + (allowRecords ? ' ' + appId + '.records' : ''));
      const mcp = new Client({ name: clientName, version: '1.0.0' });
      await mcp.connect(new StreamableHTTPClientTransport(new URL(resource), {
        requestInit: { headers: { Authorization: 'Bearer ' + tokens.access_token } },
      }));
      clients.push(mcp);
      return { mcp, tokens };
    }
    const call = async (mcp, name, arguments_) => {
      const result = await mcp.callTool({ name, arguments: arguments_ });
      assert.ok(!result.isError, name + ' ' + JSON.stringify(result.content));
      return result.structuredContent;
    };
    const decide = (action, decision, expected = 201) => request('/api/v1/connect/actions/' + action.actionId, {
      body: { decision, version: action.version, fingerprint: action.fingerprint }, expected, headers: cookies,
    });
    const denied = await connect('erp', 'harness', false);
    eq((await denied.mcp.listTools()).tools.some(t => t.name === 'erp_prepare_record_change'), false);

    async function seed(path, body) {
      return (await http.request('/tenants/' + tenantKey + '/apps/manufacturing' + path, 'POST',
        { requestKey: randomUUID(), ...body })).data;
    }
    const customer = await seed('/parties', { kind: 'customer', code: 'QA-C', name: '演示客户' });
    const supplier = await seed('/parties', { kind: 'supplier', code: 'QA-S', name: '演示供应商' });
    const product = await seed('/items', { sku: 'QA-FG', name: '演示成品', kind: 'finished', unit: '件' });
    const raw = await seed('/items', { sku: 'QA-RAW', name: '演示原料', kind: 'raw', unit: '件' });
    await seed('/boms', { draft: { productId: product.id, lines: [{ materialId: raw.id, quantity: '2' }] } });
    const bom = await db.mesBom.findFirstOrThrow({ where: { tenantId, productId: product.id, status: 'published' } });
    const warehouse = await db.erpWarehouse.create({ data: { tenantId, code: 'QA', name: '演示仓库' } });
    const stores = {
      erp: ['erpPurchaseOrder', 'cancelled'], crm: ['crmOperationTask', 'cancelled'],
      mes: ['mesPlan', 'cancelled'], geo: ['geoProject', 'inactive'], content: ['contentProject', 'trashed'],
      manufacturing: ['manufacturingOrder', 'cancelled'],
    };
    async function cycle(appId, host) {
      const prefix = host + '-' + unique(), tool = appId + '_prepare_record_change';
      const { mcp, tokens } = await connect(appId, host, true);
      eq((await mcp.listTools()).tools.some(t => t.name === tool), true);
      const fields = {
        erp: { number: prefix, supplierId: supplier.id, lines: [{ productId: raw.productId, quantity: 2, unitPrice: '2.00' }] },
        crm: { title: prefix, goal: '回访', planText: '准备方案' },
        mes: { code: prefix, productId: product.id, bomId: bom.id, targetQty: 2, dueAt: '2030-12-01T08:00:00+08:00' },
        geo: { name: prefix, brandName: '演示品牌' },
        content: { name: prefix, prompt: '演示短视频脚本' },
        manufacturing: { number: prefix, customerId: customer.id, materialId: product.id, warehouseId: warehouse.id, quantity: 2 },
      }[appId];
      const [table, deleted] = stores[appId];
      const countBefore = await db[table].count({ where: { tenantId } });
      const input = { requestKey: randomUUID(), operation: 'create', fields };
      const preview = await call(mcp, tool, input);
      eq(preview.status, 'pending');
      eq((await call(mcp, tool, input)).actionId, preview.actionId);
      eq(await db[table].count({ where: { tenantId } }), countBefore);
      await request('/api/v1/connect/actions/' + preview.actionId, {
        expected: 401, headers: { Authorization: 'Bearer ' + tokens.access_token, Origin: webOrigin },
        body: { decision: 'confirm', fingerprint: preview.fingerprint, version: preview.version },
      });
      const confirmation = (await decide(preview, 'confirm')).data;
      eq(confirmation.status, 'completed');
      const receipt = confirmation.receipt;
      eq((await decide(preview, 'confirm')).data.receipt.id, receipt.id);
      eq(await db[table].count({ where: { tenantId } }), countBefore + 1);
      eq((await call(mcp, 'ark_action_status', { actionId: preview.actionId })).receipt.id, receipt.id);
      const reader = {
        erp: 'erp_purchase_detail', crm: 'crm_task_detail', mes: 'mes_inspect',
        geo: 'geo_project_detail', content: 'content_project_detail', manufacturing: 'manufacturing_order_status',
      }[appId];
      const fromClient = await call(mcp, reader, { id: receipt.id, ...(appId === 'mes' ? { type: 'plan' } : {}) });
      eq(fromClient.id, receipt.id);
      eq(fromClient.version, receipt.version);

      const existing = await db[table].findUniqueOrThrow({ where: { id: receipt.id } });
      const update = {
        erp: { note: '调整采购备注' }, crm: { title: prefix + '已改' }, mes: { targetQty: 5 },
        geo: { name: prefix + '已改' }, content: { prompt: '已修改分镜' }, manufacturing: { dueDate: '2030-12-03' },
      }[appId];
      const updateInput = { requestKey: randomUUID(), operation: 'update', id: receipt.id, version: existing.version, fields: update };
      const cancelled = await call(mcp, tool, updateInput);
      await decide(cancelled, 'cancel');
      eq((await db[table].findUniqueOrThrow({ where: { id: receipt.id } })).version, existing.version);
      const pendingUpdate = await call(mcp, tool, { ...updateInput, requestKey: randomUUID() });
      const afterUpdate = (await decide(pendingUpdate, 'confirm')).data.receipt;
      eq(afterUpdate.version, existing.version + 1);
      const duplicate = await mcp.callTool({ name: tool, arguments: { ...updateInput, requestKey: randomUUID() } });
      eq(duplicate.isError, true);

      const pendingDelete = await call(mcp, tool, { requestKey: randomUUID(), operation: 'delete',
        id: receipt.id, version: afterUpdate.version, reason: '隔离演示测试' });
      eq((await db[table].findUniqueOrThrow({ where: { id: receipt.id } })).version, afterUpdate.version);
      const removal = (await decide(pendingDelete, 'confirm')).data.receipt;
      eq(removal.status, deleted);
      const retained = await db[table].findUniqueOrThrow({ where: { id: receipt.id } });
      eq(retained.version, afterUpdate.version + 1);
      eq(appId === 'content' ? Boolean(retained.deletedAt) : appId === 'geo' ? !retained.active :
        (retained.status || retained.salesStatus) === 'cancelled', true);
    }
    for (const host of ['harness','workbuddy']) for (const appId of apps) await cycle(appId, host);
    eq(await db.aiExecution.count({ where: { tenantId } }), 0);
    eq(await db.connectorAction.count({ where: { tenantId, status: 'completed' } }), 36);
    console.log(JSON.stringify({ checks, applications: 6, clients: 2, confirmedOperations: 36 }));
  } finally {
    for (const client of clients) await client.close();
    if (app) await app.close();
    await db.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
