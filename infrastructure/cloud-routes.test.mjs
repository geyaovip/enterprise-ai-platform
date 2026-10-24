import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function loadWorker(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default;
}

const gateway = await loadWorker('../cloudflare/worker.js');
const frontend = await loadWorker('../cloudflare/frontend-worker.js');
const routed = [];
function binding(name) {
  return { async fetch(request) {
    routed.push([name, new URL(request.url).pathname, request.headers.get('cookie')]);
    return new Response(name);
  } };
}
const env = { WORKSPACE: binding('workspace'), TENANT_ADMIN: binding('tenant'), PLATFORM_ADMIN: binding('platform') };
for (const [path, expected] of [['/', 'workspace'], ['/t/demo/erp', 'workspace'], ['/t/demo/crm', 'workspace'], ['/t/demo/crm/customers/customer-id', 'workspace'], ['/t/demo/crm/tasks/task-id', 'workspace'], ['/tenant-admin/', 'tenant'], ['/tenant-admin/t/demo/users', 'tenant'], ['/platform-admin/', 'platform'], ['/platform-admin/operators', 'platform']]) {
  const response = await gateway.fetch(new Request('https://qa.example' + path, { headers: { cookie: 'suite_session=example' } }), env);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), expected);
}
assert.deepEqual(routed.map(([name]) => name), ['workspace', 'workspace', 'workspace', 'workspace', 'workspace', 'tenant', 'tenant', 'platform', 'platform']);
assert.ok(routed.every(([, , cookie]) => cookie === 'suite_session=example'));
for (const prefix of ['/tenant-admin', '/platform-admin']) {
  const redirect = await gateway.fetch(new Request('https://qa.example' + prefix), env);
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get('location'), 'https://qa.example' + prefix + '/');
}
assert.equal((await gateway.fetch(new Request('https://qa.example/api/v1/health'), env)).status, 503);
assert.equal((await gateway.fetch(new Request('https://qa.example/api/v1/health'), { ...env, API_ORIGIN: 'http://example.com' })).status, 503);
assert.equal((await gateway.fetch(new Request('https://qa.example/'), { ...env, WORKSPACE: { fetch() { throw Error('down'); } } })).status, 502);

for (const prefix of ['', '/tenant-admin', '/platform-admin']) {
  const paths = [];
  const childEnv = { FRONTEND_PREFIX: prefix, ASSETS: { fetch(request) {
    const path = new URL(request.url).pathname;
    paths.push(path);
    return new Response(path, { headers: { 'content-type': path.endsWith('.js') ? 'application/javascript' : 'text/html' } });
  } } };
  for (const [input, expected] of [[prefix + '/', prefix ? '/' : '/index.html'], [prefix ? prefix + '/deep/link' : '/t/demo/erp', prefix ? '/' : '/app.html'], [prefix + '/assets/app.js', '/assets/app.js']]) {
    const result = await frontend.fetch(new Request('https://qa.example' + input), childEnv);
    assert.equal(result.status, 200);
    assert.equal(await result.text(), expected);
    if (prefix && !input.endsWith('.js')) assert.equal(result.headers.get('x-robots-tag'), 'noindex, nofollow');
  }
  assert.deepEqual(paths, [prefix ? '/' : '/index.html', prefix ? '/' : '/app.html', '/assets/app.js']);
  assert.equal((await frontend.fetch(new Request('https://qa.example' + prefix + '/', { method: 'POST' }), childEnv)).status, 405);
  if (prefix) assert.equal((await frontend.fetch(new Request('https://qa.example/'), childEnv)).status, 404);
}
console.log('Cloudflare gateway, cookie forwarding, split frontend routes, deep links, asset paths and failures passed.');

const publicPaths=[];
const publicEnv={FRONTEND_PREFIX:'',ASSETS:{fetch(request){const path=new URL(request.url).pathname;publicPaths.push(path);return new Response(path,{headers:{'content-type':'text/html'}});}}};
for(const [path,asset]of [['/','/index.html'],['/products','/products/index.html'],['/products/erp','/products/erp/index.html'],['/products/crm','/products/crm/index.html'],['/products/mes','/products/mes/index.html']]){const r=await frontend.fetch(new Request('https://qa.example'+path),publicEnv);assert.equal(r.status,200);assert.equal(await r.text(),asset);assert.equal(r.headers.get('x-robots-tag'),null);}
for(const path of ['/products/','/products/erp/','/products/crm/index.html']){const r=await frontend.fetch(new Request('https://qa.example'+path+'?ref=qa'),publicEnv);assert.equal(r.status,308);assert.match(r.headers.get('location'),/\?ref=qa$/);}
for(const path of ['/login','/register','/t/demo/crm','/t/demo/erp']){const r=await frontend.fetch(new Request('https://qa.example'+path),publicEnv);assert.equal(await r.text(),'/app.html');assert.equal(r.headers.get('x-robots-tag'),'noindex, nofollow');}
const notFound=await frontend.fetch(new Request('https://qa.example/products/unreleased'),publicEnv);assert.equal(notFound.status,404);assert.equal(await notFound.text(),'/404.html');
const sitemap=await frontend.fetch(new Request('https://qa.example/sitemap.xml'),publicEnv);const xml=await sitemap.text();assert.equal((xml.match(/<url>/g)||[]).length,5);assert.ok(!xml.includes('/login'));assert.ok(!xml.includes('/t/'));
console.log('Public static pages, private application shell, product 404, canonical route redirects and sitemap boundaries passed.');

for(const url of ["https://www.zhixingark.cn/products/mes?from=qa","http://zhixingark.cn/products/erp?from=qa"]){const r=await gateway.fetch(new Request(url),env);assert.equal(r.status,308);assert.ok(r.headers.get("location").startsWith("https://zhixingark.cn/products/"));assert.match(r.headers.get("location"),/from=qa/);}
