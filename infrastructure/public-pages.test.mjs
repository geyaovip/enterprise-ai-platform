import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
const root=resolve('apps/web/dist');
const routes=new Map([['/','index.html'],['/products','products/index.html'],['/products/erp','products/erp/index.html'],['/products/crm','products/crm/index.html'],['/products/mes','products/mes/index.html']]);
const pages=new Map([...routes].map(([route,file])=>[route,readFileSync(join(root,file),'utf8')]));
const titles=new Set();let images=0,links=0;
for(const [route,html]of pages){
 assert.match(html,/data-page="marketing"/);assert.equal((html.match(/<h1[ >]/g)||[]).length,1);assert.match(html,/<meta name="robots" content="index,follow,max-image-preview:large">/);assert.doesNotMatch(html,/<script[^>]+src="\/assets\//);
 const title=html.match(/<title>(.*?)<\/title>/)[1];assert.ok(!titles.has(title));titles.add(title);assert.match(html,/<meta name="description" content="[^"]{20,}"/);
 for(const [,src]of html.matchAll(/<img[^>]+src="([^"]+)"/g)){assert.ok(existsSync(join(root,src)),'Missing image '+src);images++;}
 for(const [,href]of html.matchAll(/<a[^>]+href="([^"]+)"/g)){
  const [target,anchor]=href.split('#'),path=target||route;assert.ok(routes.has(path)||['/login','/register','/brand/identity.html'].includes(path),'Unknown public link '+href);if(anchor)assert.ok(pages.get(path)?.includes('id="'+anchor+'"'),'Broken anchor '+href);links++;
 }
}
for(const [route,html]of pages){assert.match(html,new RegExp('<link rel="canonical" href="https://zhixingark\\.cn'+route+'"'));assert.match(html,/og:url/);const icon=html.match(/<link rel="icon" href="([^"]+)/)[1];assert.equal(icon,'/brand/'+(route.startsWith('/products/')?route.split('/').at(-1):'ark')+'.svg');}
const app=readFileSync(join(root,'app.html'),'utf8');assert.match(app,/data-page="app"/);assert.match(app,/noindex,nofollow/);assert.match(app,/type="module"[^>]+src="\/assets\//);assert.doesNotMatch(app,/hero|产品中心/);
assert.match(pages.get('/products/crm'),/CRM AI助手尚未开放/);assert.doesNotMatch(pages.get('/products'),/敬请期待|后续规划/);assert.match(pages.get('/products/mes'),/BOM|工单/);assert.match(pages.get('/products/mes'),/人工|确认/);
const crmImage=readFileSync(join(root,'marketing/crm-overview.jpg'));assert.equal(crmImage.subarray(0,3).toString('hex'),'ffd8ff');
const erpImage=readFileSync(join(root,'marketing/erp-inventory.jpg'));assert.equal(erpImage.subarray(0,3).toString('hex'),'ffd8ff');
console.log(JSON.stringify({publicPages:pages.size,uniqueTitles:titles.size,images,links,privateShellIsolated:true,productImageFormatVerified:true}));
// File-backed ASSETS with html_handling=none: directories never implicitly become index.html.
const source=readFileSync('cloudflare/frontend-worker.js','utf8');const worker=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).default;
const assetEnv={FRONTEND_PREFIX:'',ASSETS:{fetch(request){const path=new URL(request.url).pathname;const p=join(root,path);if(!existsSync(p)||!path.split('/').at(-1).includes('.'))return new Response('Missing asset',{status:404});return new Response(readFileSync(p),{headers:{'content-type':path.endsWith('.html')?'text/html':'application/octet-stream'}});}}};
for(const [path]of routes){const response=await worker.fetch(new Request('https://qa.example'+path),assetEnv);assert.equal(response.status,200,'File-backed public route '+path);assert.equal(await response.text(),pages.get(path));}
for(const path of ['/login','/register','/t/demo/erp','/t/demo/crm']){const response=await worker.fetch(new Request('https://qa.example'+path),assetEnv);assert.equal(response.status,200);assert.equal(await response.text(),app);}
assert.equal((await worker.fetch(new Request('https://qa.example/products/missing'),assetEnv)).status,404);
console.log('File-backed static binding verified: five public routes, four private routes and missing product 404.');
