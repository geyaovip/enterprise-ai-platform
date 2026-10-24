require('dotenv/config');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { writeFile, mkdir } = require('node:fs/promises');
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('../dist/generated/prisma/client');
const { createApp } = require('../dist/server');
const { hashPassword } = require('../dist/modules/platform/security');
const { KnowledgeProcessor } = require('../dist/modules/knowledge/knowledge.processor');
const { NativeKnowledgeAdapter } = require('../dist/modules/knowledge/native.adapter');
const { NativeEmbedding } = require('../dist/modules/knowledge/native-embedding');
const { parseNativeDocument } = require('../dist/modules/knowledge/native-parser');
const { infrastructureSecret } = require('../dist/modules/platform/infrastructure-contract');
const { parserChecks } = require('./native-knowledge-enhancements.cjs');
const { removeOriginal } = require('../dist/modules/knowledge/knowledge-storage');

function pdf(text) {
  const stream = text ? `BT /F1 12 Tf 30 750 Td (${text}) Tj ET` : '';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let result = '%PDF-1.4\n'; const offsets = [0];
  for (const [i, obj] of objects.entries()) { offsets.push(Buffer.byteLength(result)); result += `${i + 1} 0 obj\n${obj}\nendobj\n`; }
  const xref = Buffer.byteLength(result); result += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(x => String(x).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(result);
}
function officeFixtures() {
  const result = spawnSync(process.env.KNOWLEDGE_PYTHON_PATH ?? 'python3', ['-c', `
import io, zipfile, json, base64
def zipped(files):
 out=io.BytesIO()
 with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
  for name, content in files.items(): z.writestr(name,content)
 return base64.b64encode(out.getvalue()).decode()
print(json.dumps({
 'docx':zipped({'word/document.xml':'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>采购审批阈值是 13579 元。</w:t></w:r></w:p><w:p><w:r><w:t>超过阈值需由管理员审核。</w:t></w:r></w:p></w:body></w:document>'}),
 'xlsx':zipped({'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="审批标准" sheetId="1" r:id="rId1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>','xl/sharedStrings.xml':'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>采购审批</t></si></sst>','xl/worksheets/sheet1.xml':'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>13579</v></c></row></sheetData></worksheet>'}),
 'dtd':zipped({'word/document.xml':'<!DOCTYPE x [<!ENTITY y SYSTEM "file:///etc/passwd">]><x>&y;</x>'}),
 'bomb':zipped({'word/document.xml':'x'* (9*1024*1024)})
}))`], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  assert.equal(result.status, 0); return Object.fromEntries(Object.entries(JSON.parse(result.stdout)).map(([key, value]) => [key, Buffer.from(value, 'base64')]));
}
async function main() {
  const url = process.env.DATABASE_URL;
  if (!/^postgresql:\/\/[^@]+@127\.0\.0\.1:54339\/suite_native_qa(?:\?|$)/.test(url ?? '')) throw Error('Requires isolated pgvector suite_native_qa on port 54339');
  process.env.NODE_ENV = 'test';
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const marker = randomUUID().slice(0, 8); const password = 'Native-QA-Password-2026!'; const tenantIds = [], userIds = [];
  let app, mock, keep = false; let requests = 0; const checks = []; const datasets = new Map();
  let failEmbedding = false, badDimension = false, invalidEmbedding = false, delayEmbedding = 0, ragParseFail = false, ragFailure = false, revokeDuringSearch; let rerankFailure = false, rerankInvalid = false, ocrInvalid = false, rerankCalls = 0; const sentPassages = [];
  const record = name => checks.push(name);
  try {
    const imageFixtures = await parserChecks(); record('Real local PNG/JPEG/scanned PDF OCR; structure boundaries, pixel limits, cancellation and temporary cleanup');
    const fixtures = officeFixtures();
    assert.ok((await parseNativeDocument('rules.docx', fixtures.docx))[0].locator.paragraph === 1);
    assert.equal((await parseNativeDocument('rules.xlsx', fixtures.xlsx))[0].locator.sheet, '审批标准');
    assert.equal((await parseNativeDocument('rules.pdf', pdf('Purchase approval threshold is 13579 yuan.')))[0].locator.positions[0][0], 1);
    for (const [name, bytes, code] of [['bad.docx', fixtures.dtd, 'DOCUMENT_INVALID'], ['bomb.docx', fixtures.bomb, 'DOCUMENT_TOO_LARGE'], ['scan.pdf', pdf(''), 'PDF_NO_TEXT'], ['legacy.doc', Buffer.from('test'), 'DOCUMENT_FORMAT_UNSUPPORTED'], ['gbk.txt', Buffer.from([0xff, 0xfe]), 'DOCUMENT_ENCODING']]) await assert.rejects(() => parseNativeDocument(name, bytes, { disabled: name === 'scan.pdf' }), e => e.code === code);
    record('PDF/DOCX/XLSX provenance, unsafe XML, expanded ZIP bounds, no-text PDF, legacy format and invalid encoding');
    await assert.rejects(() => parseNativeDocument('oversized-lines.txt', Buffer.alloc(180001, 10)), error => error.code === 'DOCUMENT_TOO_LARGE');
    mock = http.createServer(async (req, res) => {
      try {
        const buffers = []; for await (const chunk of req) buffers.push(chunk); const raw = Buffer.concat(buffers).toString(); const body = req.headers['content-type']?.includes('application/json') && raw ? JSON.parse(raw) : {};
        const path = new URL(req.url, 'http://test'); res.setHeader('content-type', 'application/json');
        if (path.pathname.startsWith('/embeddings')) {
          assert.equal(req.headers.authorization, 'Bearer native-test-secret');
          if (failEmbedding) { res.writeHead(503).end('{}'); return; }
          if (delayEmbedding) await new Promise(r => setTimeout(r, delayEmbedding));
          if (revokeDuringSearch) { const fn = revokeDuringSearch; let rerankFailure = false, rerankInvalid = false, ocrInvalid = false, rerankCalls = 0; const sentPassages = []; revokeDuringSearch = null; await fn(); }
          const text = path.pathname.endsWith('/multimodal') ? body.input[0].text : body.input[0];
          const vector = invalidEmbedding ? [null] : new Array(badDimension ? 8 : 2048).fill(0); if (!invalidEmbedding) vector[/采购|purchase/i.test(text) ? 0 : 1] = 1;
          res.end(JSON.stringify({ data: path.pathname.endsWith('/multimodal') ? { embedding: vector } : [{ index: 0, embedding: vector }] })); return;
        }
        if (path.pathname === '/rerank') {
          assert.equal(req.headers.authorization, 'Bearer addon-test-secret'); rerankCalls++; sentPassages.push(...body.documents);
          if (rerankFailure) { res.writeHead(503).end('{}'); return; }
          res.end(JSON.stringify({ results: body.documents.map((text, index) => ({ index: rerankInvalid ? 999 : index, relevance_score: text.includes('SKU-ZX9') ? 1 : 0.1 })) })); return;
        }
        if (path.pathname === '/chat/completions') {
          assert.equal(req.headers.authorization, 'Bearer addon-test-secret');
          assert.ok(body.messages[0].content[1].image_url.url.startsWith('data:image/png;base64,'));
          res.end(JSON.stringify({ choices: [{ finish_reason: ocrInvalid ? 'length' : 'stop', message: { content: '采购 云端 OCR 测试 86420' } }] })); return;
        }
        assert.equal(req.headers.authorization, 'Bearer rag-test-secret');
        if (ragFailure) { res.writeHead(503).end('{}'); return; }
        const end = data => res.end(JSON.stringify({ code: 0, data }));
        if (path.pathname === '/api/v1/datasets') {
          if (req.method === 'POST') { const id = randomUUID(); datasets.set(id, { id, name: body.name, docs: new Map() }); end({ id }); return; }
          if (req.method === 'DELETE') { body.ids.forEach(id => datasets.delete(id)); end(true); return; }
          end([...datasets.values()].filter(d => (!path.searchParams.get('name') || d.name === path.searchParams.get('name')) && (!path.searchParams.get('id') || d.id === path.searchParams.get('id'))).map(d => ({ id: d.id, name: d.name }))); return;
        }
        const match = path.pathname.match(/^\/api\/v1\/datasets\/([^/]+)\/(documents|chunks)$/);
        if (match) {
          const dataset = datasets.get(match[1]); assert.ok(dataset);
          if (match[2] === 'chunks') { for (const doc of dataset.docs.values()) doc.run = ragParseFail ? 'FAIL' : 'DONE'; end(true); return; }
          if (req.method === 'POST') { const id = randomUUID(); dataset.docs.set(id, { id, run: 'DONE', progress: 1 }); end([{ id }]); return; }
          end({ docs: [...dataset.docs.values()] }); return;
        }
        if (path.pathname === '/api/v1/retrieval') { end({ chunks: body.document_ids.map(id => ({ document_id: id, dataset_id: body.dataset_ids.find(ds => datasets.get(ds)?.docs.has(id)), content: '采购审批规则：阈值 13579 元。', positions: [[1]] })) }); return; }
        res.writeHead(404).end('{}');
      } catch (error) { res.writeHead(500).end('{}'); process.stderr.write(`Synthetic upstream failure: ${error.message}\n`); }
    });
    await new Promise(r => mock.listen(0, '127.0.0.1', r)); const upstream = `http://127.0.0.1:${mock.address().port}`;
    const tenant = await db.tenant.create({ data: { slug: `native-a-${marker}`, name: '轻量知识库验收企业' } }); const otherTenant = await db.tenant.create({ data: { slug: `native-b-${marker}`, name: '隔离企业' } }); tenantIds.push(tenant.id, otherTenant.id);
    for (const t of [tenant, otherTenant]) { await db.tenantApp.create({ data: { tenantId: t.id, appId: 'erp' } }); await db.tenantCapability.create({ data: { tenantId: t.id, capability: 'knowledge', delivered: true, enabled: true } }); }
    const makeUser = async (role, t) => { const user = await db.user.create({ data: { email: `${role}-${marker}@native.test`, name: { admin: '知识库管理员', sales: '销售成员', finance: '其他企业成员', operator: '平台运营' }[role], passwordHash: hashPassword(password), ...(role === 'operator' ? { platformRole: 'operator' } : {}) } }); userIds.push(user.id); const member = t ? await db.membership.create({ data: { tenantId: t.id, userId: user.id, role } }) : null; return { user, member }; };
    const admin = await makeUser('admin', tenant), sales = await makeUser('sales', tenant), other = await makeUser('finance', otherTenant), operator = await makeUser('operator', null);
    app = await createApp(); await app.listen(process.env.NATIVE_QA_KEEP === '1' ? 4630 : 0, '127.0.0.1'); const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    const request = async (path, method = 'GET', body, cookie) => { requests++; const response = await fetch(base + path, { method, headers: { origin: 'http://127.0.0.1:4601', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie') }; };
    const login = async user => { const r = await request('/auth/login', 'POST', { email: user.email, password }); assert.equal(r.status, 201); return r.cookie.split(';')[0]; };
    const ac = await login(admin.user), sc = await login(sales.user), bc = await login(other.user), oc = await login(operator.user);
    const root = `/tenants/${tenant.slug}/knowledge`, configPath = `/operator/tenants/${tenant.id}`;
    const nativeOptions = { embeddingModel: 'synthetic-2048', embeddingFormat: 'openai' };
    let configured = await request(`${configPath}/infrastructure/knowledge/tenant`, 'PUT', { provider: 'native', baseUrl: upstream, secret: 'native-test-secret', version: 0, options: nativeOptions }, oc); assert.equal(configured.status, 200);
    const processor = app.get(KnowledgeProcessor);
    const tick = async (count = 12) => { for (let i = 0; i < count; i++) await processor.tick(); };
    const engine = async () => { const r = await request(root + '/engine', 'GET', undefined, ac); assert.equal(r.status, 200); return r.body; };
    const configureProfile = async (provider, version = 0, options = { embeddingModel: 'synthetic-rag' }) => request(`${configPath}/knowledge-profiles/${provider}`, 'PUT', { provider, baseUrl: upstream, secret: provider === 'native' ? 'native-test-secret' : 'rag-test-secret', version, options }, oc);
    assert.equal((await configureProfile('ragflow')).status, 200);
    const configuration = await request(configPath + '/configuration', 'GET', undefined, oc); assert.ok(!JSON.stringify(configuration.body).includes('secretCiphertext')); assert.ok(!JSON.stringify(configuration.body).includes('native-test-secret'));
    const bindingId = configuration.body.bindings[0].id;
    assert.equal((await request(`${configPath}/infrastructure/${bindingId}/health`, 'GET', undefined, oc)).body.state, 'reachable');
    assert.equal((await request(root + '/engine', 'GET', undefined, bc)).status, 403);
    assert.equal((await request(root + '/engine/select', 'POST', { provider: 'ragflow', version: 1 }, sc)).status, 403);
    const sampleBinding = { ...await db.infrastructureBinding.findUniqueOrThrow({ where: { id: bindingId } }), options: { ...nativeOptions, embeddingFormat: 'ark-multimodal' } };
    assert.equal((await new NativeEmbedding(sampleBinding).embed('采购')).length, 2048);
    invalidEmbedding = true; await assert.rejects(() => new NativeEmbedding(sampleBinding).embed('采购'), error => error.code === 'EMBEDDING_INVALID'); invalidEmbedding = false;
    record('Native/RAGFlow profile configuration, encrypted secrets, member/operator separation, OpenAI and Ark protocols');
    const space = (await request(root + '/spaces', 'POST', { name: '采购制度', grants: [{ subjectType: 'member', subjectId: sales.member.id, access: 'read' }] }, ac)).body;
    const hidden = (await request(root + '/spaces', 'POST', { name: '管理层资料' }, ac)).body;
    const upload = async (spaceId, filename, bytes, doc) => { const r = await request(`${root}/spaces/${spaceId}/documents${doc ? `/${doc.id}/versions` : ''}`, 'POST', { title: filename, filename, contentBase64: bytes.toString('base64'), ...(doc ? { expectedVersion: doc.currentVersion } : {}) }, ac); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body; };
    const textDoc = await upload(space.id, '采购制度.md', Buffer.from('采购审批阈值是 13579 元。\n超过阈值需要管理员审核。'));
    const officeDoc = await upload(space.id, '审批规则.docx', fixtures.docx);
    await upload(space.id, '审批标准.xlsx', fixtures.xlsx); await upload(space.id, '采购流程.pdf', pdf('Purchase approval threshold is 13579 yuan.'));
    const hiddenDoc = await upload(hidden.id, 'secret.txt', Buffer.from('采购机密不得对销售显示。'));
    assert.equal((await request(`${root}/spaces/${space.id}/documents`, 'POST', { title: 'legacy', filename: 'legacy.doc', contentBase64: Buffer.from('legacy').toString('base64') }, ac)).status, 400);
    await tick();
    let docs = (await request(`${root}/spaces/${space.id}/documents`, 'GET', undefined, ac)).body;
    assert.equal(docs.items.length, 4); assert.ok(docs.items.every(d => d.versions[0].processingStatus === 'ready'), JSON.stringify(docs));
    assert.equal(await db.nativeKnowledgeDataset.count({ where: { tenantId: tenant.id, dimension: 2048, status: 'ready' } }), 5);
    const search = async (cookie = sc, spaceId = space.id) => request(root + '/search', 'POST', { query: '采购审批阈值', ...(spaceId ? { spaceId } : {}) }, cookie);
    const found = await search(); assert.equal(found.status, 201, JSON.stringify(found.body)); assert.equal(found.body.length, 4); assert.ok(found.body.every(c => c.excerpt.includes('13579')));
    const citation = found.body.find(c => c.documentId === textDoc.id); assert.ok(citation);
    assert.equal((await search()).body.find(c => c.documentId === textDoc.id).id, citation.id);
    assert.ok((await search(sc, null)).body.every(c => c.documentId !== hiddenDoc.id));
    assert.equal((await search(bc)).status, 403);
    assert.equal((await request(root + '/citations/' + citation.id, 'GET', undefined, bc)).status, 403);
    const actualBinding = await db.infrastructureBinding.findUniqueOrThrow({ where: { id: bindingId } });
    const native = new NativeKnowledgeAdapter(actualBinding, db);
    const hiddenIndex = await db.knowledgeIndex.findFirstOrThrow({ where: { version: { documentId: hiddenDoc.id }, status: 'ready' } });
    assert.equal((await native.retrieve('采购', [{ datasetId: hiddenIndex.datasetId, documentId: randomUUID() }])).length, 0);
    await assert.rejects(() => new NativeKnowledgeAdapter({ ...actualBinding, tenantId: otherTenant.id }, db).remove({ datasetId: hiddenIndex.datasetId, documentId: hiddenIndex.versionId }), e => e.code === 'SOURCE_CHANGED');
    record('Real pgvector 2048-dimensional retrieval; four parsed formats; stable citations; source-pair and cross-tenant isolation');
    const extraSpace = (await request(root + '/spaces', 'POST', { name: '检索增强验收', grants: [{ subjectType: 'member', subjectId: sales.member.id, access: 'read' }] }, ac)).body;
    const exactDoc = await upload(extraSpace.id, '编号规则.md', Buffer.from('# 采购规则\nSKU-ZX9 的审核阈值是 24680。'));
    const unrelated = await upload(extraSpace.id, '其他规则.md', Buffer.from('# 采购规则\nABC-777 的审核阈值是 11111。')); await tick(8);
    const exactResult = await request(root + '/search', 'POST', { query: 'SKU-ZX9', spaceId: extraSpace.id }, sc);
    assert.equal(exactResult.status, 201); assert.equal(exactResult.body.length, 1); assert.equal(exactResult.body[0].documentId, exactDoc.id);
    assert.equal(exactResult.body[0].retrieval.mode, 'hybrid'); assert.equal(exactResult.body[0].retrieval.reranker, 'local-rules');
    const configureAddon = async (kind, version = 0, enabled = true) => request(`${configPath}/infrastructure/${kind}/tenant`, 'PUT', { provider: kind === 'knowledge-ocr' ? 'openai-vision' : 'api-rerank', baseUrl: upstream, secret: 'addon-test-secret', version, enabled, options: { model: 'synthetic-addon' } }, oc);
    assert.equal((await configureAddon('knowledge-rerank')).status, 200);
    const rankSearch = () => request(root + '/search', 'POST', { query: '采购', spaceId: extraSpace.id }, sc);
    const remoteRank = await rankSearch(); assert.equal(remoteRank.body[0].documentId, exactDoc.id); assert.equal(remoteRank.body[0].retrieval.reranker, 'api-rerank');
    assert.ok(sentPassages.every(text => !text.includes('机密')));
    rerankInvalid = true; let degraded = await rankSearch(); assert.equal(degraded.status, 201); assert.ok(degraded.body.every(x => x.retrieval.degraded)); rerankInvalid = false;
    rerankFailure = true; degraded = await rankSearch(); assert.equal(degraded.status, 201); assert.equal(degraded.body[0].retrieval.reranker, 'local-rules'); rerankFailure = false;
    const callsBefore = rerankCalls; revokeDuringSearch = () => db.knowledgeGrant.deleteMany({ where: { spaceId: extraSpace.id } });
    assert.equal((await rankSearch()).status, 409); assert.equal(rerankCalls, callsBefore, 'Revoked passages never sent to reranker');
    await db.knowledgeGrant.create({ data: { tenantId: tenant.id, spaceId: extraSpace.id, subjectType: 'member', subjectId: sales.member.id, access: 'read' } });
    assert.equal((await configureAddon('knowledge-rerank', 1, false)).status, 200);
    const imageDoc = await upload(extraSpace.id, '文字截图.png', imageFixtures.png); const scanDoc = await upload(extraSpace.id, '扫描文件.pdf', imageFixtures.pdf); await tick(10);
    const localFound = await request(root + '/search', 'POST', { query: '24680', spaceId: extraSpace.id }, sc);
    assert.equal(localFound.status, 201); assert.ok(localFound.body.some(c => c.documentId === imageDoc.id && c.locator.ocr)); assert.ok(localFound.body.some(c => c.documentId === scanDoc.id && c.locator.positions[0][0] === 1));
    assert.equal((await configureAddon('knowledge-ocr')).status, 200);
    const cloudDoc = await upload(extraSpace.id, '云端截图.png', imageFixtures.png); await tick(6);
    const cloudFound = await request(root + '/search', 'POST', { query: '86420', spaceId: extraSpace.id }, sc);
    assert.ok(cloudFound.body.some(c => c.documentId === cloudDoc.id && c.locator.ocrProvider === 'openai-vision'));
    ocrInvalid = true; const truncatedDoc = await upload(extraSpace.id, '不完整识别.png', imageFixtures.png); await tick(4); ocrInvalid = false;
    assert.equal((await db.knowledgeIndex.findFirstOrThrow({ where: { version: { documentId: truncatedDoc.id } } })).errorCode, 'OCR_INVALID');
    const addonConfig = await request(configPath + '/configuration', 'GET', undefined, oc); assert.ok(!JSON.stringify(addonConfig.body).includes('addon-test-secret')); assert.ok(!JSON.stringify(addonConfig.body).includes('secretCiphertext'));
    const addonBinding = await db.infrastructureBinding.findUniqueOrThrow({ where: { tenantId_kind_scopeKey: { tenantId: tenant.id, kind: 'knowledge-ocr', scopeKey: 'tenant' } } }); assert.notEqual(addonBinding.secretCiphertext, 'addon-test-secret');
    assert.equal((await configureAddon('knowledge-ocr', 1, false)).status, 200);
    for (const doc of [exactDoc, unrelated, imageDoc, scanDoc, cloudDoc, truncatedDoc]) await request(root + `/documents/${doc.id}`, 'PATCH', { status: 'deleted', version: 1 }, ac);
    await tick(15);
    record('Lexical recovery of an exact SKU beyond vector cutoff; hybrid fusion, local and API reranking, invalid/upstream fallback, revocation before cloud egress, real OCR upload-to-citation, pluggable OCR validation and encrypted credentials');

    revokeDuringSearch = () => db.knowledgeGrant.deleteMany({ where: { spaceId: space.id } });
    const revoked = await search(); assert.equal(revoked.status, 409);
    assert.equal((await request(root + '/citations/' + citation.id, 'GET', undefined, sc)).status, 404);
    await db.knowledgeGrant.create({ data: { tenantId: tenant.id, spaceId: space.id, subjectType: 'member', subjectId: sales.member.id, access: 'read' } });
    badDimension = true; assert.equal((await search()).status, 503); badDimension = false;
    record('Permission revocation during model request blocks results and old citations; incompatible query dimension fails closed');
    await upload(space.id, '采购制度.md', Buffer.from('采购审批新阈值是 24680 元。'), textDoc); await tick();
    const latest = await search(); assert.ok(latest.body.find(c => c.documentId === textDoc.id).excerpt.includes('24680'));
    assert.equal((await request(root + '/citations/' + citation.id, 'GET', undefined, sc)).body.version, 1);
    const original = await fetch(base + root + `/documents/${textDoc.id}/versions/1/original`, { headers: { cookie: sc } }); assert.equal(original.status, 200); assert.ok((await original.text()).includes('13579'));
    await request(root + `/documents/${officeDoc.id}`, 'PATCH', { status: 'archived', version: 1 }, ac); assert.ok(!(await search()).body.some(c => c.documentId === officeDoc.id));
    await request(root + `/documents/${officeDoc.id}`, 'PATCH', { status: 'active', version: 1 }, ac);
    record('Current-version retrieval, archived exclusion, authorized historical original and citation');
    failEmbedding = true; const retryDoc = await upload(space.id, '采购重试.txt', Buffer.from('采购失败重试测试。')); await tick(2);
    let retry = await db.knowledgeIndex.findFirstOrThrow({ where: { version: { documentId: retryDoc.id } } }); assert.equal(retry.status, 'queued'); assert.equal(retry.errorCode, 'EMBEDDING_UNAVAILABLE');
    failEmbedding = false; await db.knowledgeIndex.update({ where: { id: retry.id }, data: { nextAttemptAt: new Date(0) } }); await tick(3);
    retry = await db.knowledgeIndex.findUniqueOrThrow({ where: { id: retry.id } }); assert.equal(retry.status, 'ready');
    await request(root + `/documents/${retryDoc.id}`, 'PATCH', { status: 'deleted', version: 1 }, ac); await tick(3);
    assert.equal(await db.nativeKnowledgeChunk.count({ where: { datasetId: retry.datasetId } }), 0);
    const scan = await upload(space.id, '扫描件.pdf', pdf('')); await tick(3);
    docs = (await request(`${root}/spaces/${space.id}/documents`, 'GET', undefined, ac)).body; assert.equal(docs.items.find(d => d.id === scan.id).versions[0].processingError, 'DOCUMENT_EMPTY');
    await request(root + `/documents/${scan.id}`, 'PATCH', { status: 'deleted', version: 1 }, ac); await tick(3);
    record('Transient model retry, actionable empty OCR PDF failure, deleted vector chunks and original access');
    const raceDoc = await upload(space.id, '采购删除竞争.txt', Buffer.from('采购处理中删除，不得恢复索引。'));
    await tick(1); delayEmbedding = 250; const runningParse = processor.tick();
    for (let i = 0; i < 100; i++) { if (await db.nativeKnowledgeDataset.count({ where: { index: { version: { documentId: raceDoc.id } }, status: 'processing' } })) break; await new Promise(r => setTimeout(r, 10)); }
    assert.equal((await request(root + `/documents/${raceDoc.id}`, 'PATCH', { status: 'deleted', version: 1 }, ac)).status, 200);
    await runningParse; delayEmbedding = 0; await tick(4);
    assert.equal(await db.nativeKnowledgeDataset.count({ where: { index: { version: { documentId: raceDoc.id } } } }), 0);
    record('Deletion during embedding cancels commit, prevents partial/resurrected vectors and cleans originals');
    let state = await engine();
    ragFailure = true; assert.equal((await request(root + '/engine/select', 'POST', { provider: 'ragflow', version: state.version }, ac)).status, 400); assert.equal((await engine()).provider, 'native'); ragFailure = false;
    ragParseFail = true; assert.equal((await request(root + '/engine/select', 'POST', { provider: 'ragflow', version: state.version }, ac)).status, 201);
    assert.equal((await engine()).provider, 'native'); assert.equal((await search()).status, 201);
    await tick(5); state = await engine(); assert.equal(state.transition.status, 'failed'); assert.equal(state.provider, 'native'); assert.equal((await search()).status, 201); ragParseFail = false;
    record('Unavailable target is rejected; candidate parsing failure keeps the active native engine serving');
    assert.equal((await request(root + '/engine/select', 'POST', { provider: 'ragflow', version: state.version }, ac)).status, 201);
    state = await engine(); assert.equal((await request(root + '/engine/cancel', 'POST', { id: state.transition.id }, ac)).status, 201); await tick(5); assert.equal((await engine()).transition.status, 'cancelled');
    assert.equal((await request(root + '/engine/select', 'POST', { provider: 'ragflow', version: state.version }, ac)).status, 201);
    await configureProfile('ragflow', 1); await tick(4); state = await engine(); assert.equal(state.transition.status, 'failed'); assert.equal(state.transition.errorCode, 'CONFIGURATION_CHANGED');
    record('Candidate cancellation cleans staging; changed provider profile invalidates staging without replacing active configuration');
    assert.equal((await request(root + '/engine/select', 'POST', { provider: 'ragflow', version: state.version }, ac)).status, 201);
    const during = await upload(space.id, '切换期间采购.txt', Buffer.from('采购切换期间新增文档 97531。'));
    await tick(30); state = await engine(); assert.equal(state.provider, 'ragflow'); assert.equal(state.transition.status, 'completed'); assert.equal(state.rollbackAvailable, true);
    assert.ok((await search()).body.some(c => c.documentId === during.id));
    assert.equal((await request(root + '/citations/' + citation.id, 'GET', undefined, ac)).body.version, 1);
    assert.equal((await request(root + '/engine/rollback', 'POST', { version: state.version }, ac)).status, 201);
    assert.equal((await engine()).provider, 'ragflow'); await tick(30); state = await engine(); assert.equal(state.provider, 'native'); assert.equal(state.transition.status, 'completed'); assert.ok((await search()).body.some(c => c.documentId === during.id && c.excerpt.includes('97531')));
    assert.equal(datasets.size, 0, 'Retired exclusive RAGFlow datasets are cleaned after native rollback');
    record('Successful native → RAGFlow → native rebuild, concurrent upload coverage, retired index cleanup, historical citations retained');
    assert.equal((await configureProfile('native', 1, { ...nativeOptions, embeddingFormat: 'ark-multimodal' })).status, 200);
    assert.equal((await engine()).choices.find(x => x.provider === 'native').hasUpdate, true);
    assert.equal((await request(root + '/engine/select', 'POST', { provider: 'native', version: state.version }, ac)).status, 201);
    await tick(30); state = await engine(); assert.equal(state.provider, 'native'); assert.equal(state.transition.status, 'completed');
    assert.equal((await engine()).choices.find(x => x.provider === 'native').hasUpdate, false);
    assert.equal((await search()).status, 201);
    record('Current native profile/model changes are rebuilt before activation; Ark protocol through full pipeline');
    assert.equal((await request(root + '/engine/select', 'POST', { provider: 'ragflow', version: 1 }, ac)).status, 409);
    assert.equal((await request(root + '/engine/select', 'POST', { provider: 'ragflow', version: state.version }, ac)).status, 201);
    await db.tenantCapability.update({ where: { tenantId_capability: { tenantId: tenant.id, capability: 'knowledge' } }, data: { enabled: false } }); await tick(3);
    const stage = await db.knowledgeEngineTransition.findFirst({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'desc' } }); assert.equal(stage.status, 'failed'); assert.equal(stage.errorCode, 'CONFIGURATION_CHANGED');
    await db.tenantCapability.update({ where: { tenantId_capability: { tenantId: tenant.id, capability: 'knowledge' } }, data: { enabled: true } });
    assert.equal((await engine()).provider, 'native'); await tick(5);
    record('Stale client version rejected; revoked capability stops staging; originals and active binding preserved');
    await mkdir(resolve('../../output/native-knowledge-20261008'), { recursive: true });
    await writeFile(resolve('../../output/native-knowledge-20261008/verification.json'), JSON.stringify({ timestamp: new Date().toISOString(), database: 'isolated PostgreSQL 17 + pgvector 0.8.1', httpChecks: requests, verified: checks, model: 'synthetic embedding API only', ragflow: 'synthetic API only', production: 'unchanged' }, null, 2));
    process.stdout.write(`Native knowledge integration passed: ${requests} HTTP checks; ${checks.length} scenario groups. Real pgvector and parsers; embedding/RAGFlow API substitutes.\n`);
    keep = process.env.NATIVE_QA_KEEP === '1';
    if (keep) {
      const fixturePath = resolve('../../var/native-browser-fixture.json'); await writeFile(fixturePath, JSON.stringify({ tenant: tenant.slug, admin: admin.user.email, sales: sales.user.email, operator: operator.user.email, password, spaceId: space.id, pid: process.pid }), { mode: 0o600 });
      process.stdout.write('Synthetic QA server retained on port 4630 for browser verification.\n');
      await new Promise(r => { process.once('SIGTERM', r); process.once('SIGINT', r); });
    }
  } finally {
    if (app) await app.close(); if (mock) await new Promise(r => mock.close(r));
    const where = { tenantId: { in: tenantIds } };
    for (const version of await db.knowledgeDocumentVersion.findMany({ where })) await removeOriginal(version.storageKey);
    for (const table of ['knowledgeEngineTransition', 'knowledgeEngineProfile', 'knowledgeCitation', 'knowledgeIndex', 'knowledgeDocumentVersion', 'knowledgeDocument', 'knowledgeGrant', 'knowledgeSpace', 'infrastructureBinding', 'tenantCapability', 'operatorAudit', 'auditEvent', 'tenantApp', 'membership']) await db[table].deleteMany({ where });
    await db.tenant.deleteMany({ where: { id: { in: tenantIds } } }); await db.session.deleteMany({ where: { userId: { in: userIds } } }); await db.user.deleteMany({ where: { id: { in: userIds } } }); await db.$disconnect();
  }
}
main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
