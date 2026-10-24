import assert from 'node:assert/strict';

const origin = process.argv[2];
const mode = process.argv[3] || 'gateway';
if (!origin) throw new Error('Usage: node infrastructure/cloud-live-smoke.mjs <https-origin> [gateway|workspace|tenant|platform]');
const targets = {
  workspace: [['/', '/t/xiaogai-studio/erp']],
  tenant: [['/tenant-admin/', '/tenant-admin/t/xiaogai-studio']],
  platform: [['/platform-admin/', '/platform-admin/operators']],
  gateway: [['/', '/t/xiaogai-studio/erp'], ['/tenant-admin/', '/tenant-admin/t/xiaogai-studio'], ['/platform-admin/', '/platform-admin/operators']],
}[mode];
if (!targets) throw new Error('Invalid mode');

for (const [root, deep] of targets) {
  const response = await fetch(new URL(deep, origin));
  assert.equal(response.status, 200, `${deep}: ${response.status}`);
  const html = await response.text();
  assert.match(html, /<div id="root"><\/div>/, `${deep}: wrong frontend document`);
  const script = html.match(/<script[^>]+src="([^"]+\.js)"/i)?.[1];
  const css = html.match(/<link[^>]+href="([^"]+\.css)"/i)?.[1];
  assert.ok(script && css, `${deep}: missing bundles`);
  if (root !== '/') {
    assert.ok(script.startsWith(root), `${deep}: wrong script base`);
    assert.ok(css.startsWith(root), `${deep}: wrong CSS base`);
  }
  for (const asset of [script, css]) {
    const result = await fetch(new URL(asset, origin));
    assert.equal(result.status, 200, `${asset}: ${result.status}`);
    assert.doesNotMatch(result.headers.get('content-type') || '', /text\/html/, `${asset}: SPA fallback instead of asset`);
    assert.ok((await result.arrayBuffer()).byteLength > 1000, `${asset}: empty asset`);
  }
  console.log(`${mode}: ${deep}, ${script}, ${css} OK`);
}
if (mode === 'gateway') {
  const result = await fetch(new URL('/api/v1/health', origin));
  assert.equal(result.status, 200, `API health: ${result.status}`);
  assert.equal((await result.json()).database, 'ready');
  console.log('Gateway API health OK');
}
