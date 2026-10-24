const assert = require('node:assert/strict');
const { readFile, writeFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const { createHash } = require('node:crypto');
const origin = 'http://localhost:4620';
const path = '/api/v1/tenants/phase1-container-qa/knowledge';
const fixtureFile = resolve('../../var/phase1-container-fixture.json');
async function main() {
  const login = await fetch(origin + '/api/v1/auth/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'phase1-container-admin@example.test', password: 'Phase1-Container-QA-Only!' }) });
  assert.equal(login.status, 201); const cookie = login.headers.get('set-cookie').split(';')[0];
  const request = async (route, method = 'GET', body) => {
    const response = await fetch(origin + route, { method, headers: { origin, cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    assert.ok(response.ok, `QA request failed: ${method} ${route} ${response.status}`); return response.json();
  };
  let fixture;
  if (process.argv[2] === 'create') {
    const space = await request(path + '/spaces', 'POST', { name: '容器原件持久化验收', visibility: 'restricted' });
    const content = Buffer.from('公开容器验收样本：采购前先核对库存，不包含客户数据。');
    const doc = await request(`${path}/spaces/${space.id}/documents`, 'POST', { title: '容器公开测试文档', filename: 'container-qa.md', contentBase64: content.toString('base64') });
    fixture = { spaceId: space.id, documentId: doc.id, sha256: createHash('sha256').update(content).digest('hex') };
    await writeFile(fixtureFile, JSON.stringify(fixture), { mode: 0o600, flag: 'wx' });
  } else if (process.argv[2] === 'verify') fixture = JSON.parse(await readFile(fixtureFile, 'utf8'));
  else throw Error('Use create or verify for the dedicated Phase1 container QA');
  const docs = await request(`${path}/spaces/${fixture.spaceId}/documents`);
  const canonicalDoc = docs.items.find(doc => doc.id === fixture.documentId);
  assert.ok(canonicalDoc, 'The persisted QA document must remain in its canonical space');
  assert.equal(canonicalDoc.currentVersion, 1);
  const response = await fetch(`${origin}${path}/documents/${fixture.documentId}/versions/1/original`, { headers: { cookie } }); assert.equal(response.status, 200);
  assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), fixture.sha256);
  for (const route of ['/tenant-admin', '/platform-admin']) {
    const redirect = await fetch(origin + route, { redirect: 'manual' }); assert.equal(redirect.status, 308);
    const html = await fetch(origin + route + '/t/phase1-container-qa/knowledge'); assert.equal(html.status, 200);
    const content = await html.text(); assert.ok(content.includes(route + '/assets/'), 'Deep link returned the wrong frontend bundle');
    for (const asset of [...content.matchAll(/(?:src|href)="([^"]+\/assets\/[^"]+)"/g)].map(m => m[1])) assert.equal((await fetch(origin + asset)).status, 200);
  }
  assert.equal((await fetch(origin + '/api/v1/health')).status, 200); assert.equal((await fetch('http://127.0.0.1:4622/health')).status, 200);
  await request('/api/v1/auth/logout', 'POST', {});
  console.log(`Phase1 container ${process.argv[2]}: API/Worker health, independent admin deep links/assets, canonical document version and shared-volume original SHA-256 passed.`);
}
main().catch(error => { console.error(`${error.name}: ${error.message}`); process.exitCode = 1; });
