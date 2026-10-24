require('dotenv/config');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { writeFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const { PrismaService } = require('../dist/modules/prisma.service');
const { NativeKnowledgeAdapter } = require('../dist/modules/knowledge/native.adapter');
const { infrastructureSecret } = require('../dist/modules/platform/infrastructure-contract');
const { storeOriginal, removeOriginal } = require('../dist/modules/knowledge/knowledge-storage');
async function main() {
  if (!/^postgresql:\/\/[^@]+@127\.0\.0\.1:54339\/suite_native_qa(?:\?|$)/.test(process.env.DATABASE_URL ?? '') || !process.env.NATIVE_EMBEDDING_KEY) throw Error('Isolated native QA database and private Ark key required');
  const db = new PrismaService(); let tenant, key;
  const report = { model: 'doubao-embedding-vision-251215', protocol: 'ark-multimodal', data: 'generated public sample only', production: 'unchanged' };
  try {
    tenant = await db.tenant.create({ data: { slug: `ark-native-${randomUUID().slice(0, 8)}`, name: '公开嵌入样本验收' } });
    await db.tenantCapability.create({ data: { tenantId: tenant.id, capability: 'knowledge', enabled: true, delivered: true } });
    const binding = await db.infrastructureBinding.create({ data: { tenantId: tenant.id, kind: 'knowledge', scopeKey: 'tenant', provider: 'native', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', secretCiphertext: infrastructureSecret(process.env.NATIVE_EMBEDDING_KEY), options: { embeddingModel: report.model, embeddingFormat: report.protocol } } });
    const engine = new NativeKnowledgeAdapter(binding, db); await engine.health();
    const bytes = Buffer.from('本文件是公开生成的测试样本，不包含任何客户数据。\n测试仓库采购审批阈值为 13579 元，超过该金额需要管理员审核。'); key = await storeOriginal(bytes);
    const space = await db.knowledgeSpace.create({ data: { tenantId: tenant.id, name: '公开样本', ownerMembershipId: randomUUID() } });
    const document = await db.knowledgeDocument.create({ data: { tenantId: tenant.id, spaceId: space.id, title: '公开采购规则', createdByMembershipId: randomUUID() } });
    const version = await db.knowledgeDocumentVersion.create({ data: { tenantId: tenant.id, documentId: document.id, version: 1, filename: 'public-rule.md', mimeType: 'text/plain', byteSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), storageKey: key, createdByMembershipId: randomUUID() } });
    const index = await db.knowledgeIndex.create({ data: { tenantId: tenant.id, versionId: version.id, bindingId: binding.id, bindingVersion: binding.version, bindingSnapshot: binding, provider: 'native', status: 'running', startedAt: new Date() } });
    const datasetId = await engine.createDataset(`suite-${index.id}`); const documentId = await engine.upload(datasetId, { filename: version.filename, mimeType: version.mimeType, bytes });
    await engine.parse({ datasetId, documentId }); assert.equal(await engine.status({ datasetId, documentId }), 'ready');
    await db.knowledgeIndex.update({ where: { id: index.id }, data: { status: 'ready', datasetId, externalDocumentId: documentId } });
    const chunks = await engine.retrieve('测试仓库的采购审批阈值是多少？', [{ datasetId, documentId }]); assert.ok(chunks.some(c => c.text.includes('13579')));
    const dataset = await db.nativeKnowledgeDataset.findUniqueOrThrow({ where: { id: datasetId } }); assert.equal(dataset.dimension, 2048);
    Object.assign(report, { status: 'passed', dimension: dataset.dimension, matchedFact: '13579', retrievedChunks: chunks.length });
    process.stdout.write('Real Ark embedding → platform original parsing → pgvector retrieval passed; 2048 dimensions, public generated sample only.\n');
  } catch (error) {
    Object.assign(report, { status: 'blocked', errorCode: error.code ?? error.name });
    process.stderr.write(`Real Ark smoke did not pass: ${error.code ?? error.name}. No secrets or provider response bodies logged.\n`); process.exitCode = 1;
  } finally {
    await writeFile(resolve('../../output/native-knowledge-20261008/ark-smoke.json'), JSON.stringify(report, null, 2) + '\n');
    if (tenant) { const where = { tenantId: tenant.id }; for (const table of ['knowledgeIndex', 'knowledgeDocumentVersion', 'knowledgeDocument', 'knowledgeSpace', 'infrastructureBinding', 'tenantCapability']) await db[table].deleteMany({ where }); await db.tenant.delete({ where: { id: tenant.id } }); }
    if (key) await removeOriginal(key); await db.$disconnect();
  }
}
main().catch(error => { process.stderr.write(`Public sample cleanup failed: ${error.name}\n`); process.exitCode = 1; });
