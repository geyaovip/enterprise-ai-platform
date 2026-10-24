require('dotenv/config');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { RagflowAdapter } = require('../dist/modules/knowledge/ragflow.adapter');
const { infrastructureSecret } = require('../dist/modules/platform/infrastructure-contract');

// Only an explicitly configured Cloud account and generated, non-business sample are used.
async function main() {
  const secret = process.env.RAGFLOW_API_KEY?.trim();
  const embeddingModel = process.env.RAGFLOW_EMBEDDING_MODEL?.trim();
  if (!secret || !embeddingModel) throw Error('Save RAGFLOW_API_KEY and RAGFLOW_EMBEDDING_MODEL in the private QA env first.');
  const baseUrl = process.env.RAGFLOW_BASE_URL ?? 'https://cloud.ragflow.io';
  if (baseUrl !== 'https://cloud.ragflow.io') throw Error('This smoke test targets only the user-selected RAGFlow Cloud.');
  process.env.INFRASTRUCTURE_ALLOWED_HOSTS = 'cloud.ragflow.io';
  const engine = new RagflowAdapter({ provider: 'ragflow', baseUrl, secretCiphertext: infrastructureSecret(secret), options: { embeddingModel } });
  const marker = randomUUID().slice(0, 8); let datasetId; let documentId;
  try {
    await engine.health();
    datasetId = await engine.createDataset(`suite-cloud-smoke-${marker}`);
    documentId = await engine.upload(datasetId, { filename: 'public-qa-rule.md', mimeType: 'text/markdown', bytes: Buffer.from('# 公开测试采购规则\n\n本文件由测试程序生成，不包含客户数据。\n测试仓库的采购审批阈值是 13579 元；超过此金额需要管理员审核。\n') });
    const source = { datasetId, documentId }; await engine.parse(source);
    const deadline = Date.now() + 240_000; let state;
    do { state = await engine.status(source); if (state === 'failed') throw Error('Cloud sample parsing failed'); if (state !== 'ready') await new Promise(r => setTimeout(r, 5000)); } while (state !== 'ready' && Date.now() < deadline);
    assert.equal(state, 'ready', 'Cloud parsing timeout; parsing quality remains unverified');
    const chunks = await engine.retrieve('测试仓库采购审批阈值是多少元？', [source]);
    assert.ok(chunks.some(c => c.text.includes('13579')), 'Cloud sample retrieval did not return the known fact');
    assert.ok(chunks.every(c => c.source.datasetId === datasetId && c.source.documentId === documentId));
    process.stdout.write('RAGFlow Cloud authenticated access, public sample upload/parse/retrieval and source mapping passed.\n');
  } finally {
    if (datasetId) { await engine.remove({ datasetId, documentId: documentId ?? '' }); process.stdout.write('Only the dataset created by this smoke test was removed.\n'); }
  }
}
main().catch(error => { process.stderr.write(`${error.name}: ${error.message}\n`); process.exitCode = 1; });
