import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {publicPaths,legacyHashRoutes,retiredPublicRoutes} from '../cloudflare/public-routes.mjs';
const root=resolve('apps/web/dist');
const routes=new Map(publicPaths.map(path=>[path,path==='/'?'index.html':path.slice(1)+'/index.html']));
const pages=new Map([...routes].map(([route,file])=>[route,readFileSync(join(root,file),'utf8')]));
const titles=new Set();let images=0,links=0;
for(const [route,html]of pages){
 assert.match(html,/data-page="marketing"/);assert.equal((html.match(/<h1[ >]/g)||[]).length,1);assert.match(html,/<meta name="robots" content="index,follow,max-image-preview:large">/);assert.doesNotMatch(html,/<script[^>]+src="\/assets\//);
 const title=html.match(/<title>(.*?)<\/title>/)[1];assert.ok(!titles.has(title));titles.add(title);assert.match(html,/<meta name="description" content="[^"]{20,}"/);
 for(const [,src]of html.matchAll(/<img[^>]+src="([^"]+)"/g)){assert.ok(existsSync(join(root,src)),'Missing image '+src);images++;}
 for(const [,href]of html.matchAll(/<a[^>]+href="([^"]+)"/g)){
  if(href.startsWith('mailto:')){assert.equal(href,'mailto:geyaovip@163.com','Unapproved contact address');links++;continue;}
  const parsed=new URL(href,'https://zhixingark.cn'+route),path=parsed.pathname,anchor=parsed.hash.slice(1);assert.ok(routes.has(path)||['/login','/register','/brand/identity.html'].includes(path),'Unknown public link '+href);if(anchor)assert.ok(pages.get(path)?.includes('id="'+anchor+'"'),'Broken anchor '+href);links++;
 }
}
const home=pages.get('/');
assert.deepEqual(publicPaths,['/','/employees','/solutions','/products','/knowledge','/contact']);
for(const [path,count]of [['/employees',5],['/products',6],['/solutions',12]]){
 const html=pages.get(path);assert.equal((html.match(/role="tab"/g)||[]).length,count);assert.equal((html.match(/role="tabpanel"/g)||[]).length,count);
 for(const [,id]of html.matchAll(/aria-controls="([^"]+)"/g))assert.ok(html.includes('id="'+id+'"'),'Missing controlled element '+id);
 assert.match(html,/准备哪些资料|业务功能/);assert.match(html,/协作示例/);
}
for(const html of pages.values()){
 assert.doesNotMatch(html,/<form\b|自动群发|自动发券|零误差|100%准确|数据不出厂/);
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);assert.equal(new Set(ids).size,ids.length,'Duplicate public HTML id');
}
assert.doesNotMatch(readFileSync(join(root,'site.js'),'utf8'),/\bfetch\s*\(|XMLHttpRequest|WebSocket|\/api\//,'Public examples must not call business APIs');
for(const [route,html]of pages){assert.match(html,new RegExp('<link rel="canonical" href="https://zhixingark\\.cn'+route+'"'));assert.match(html,/og:url/);const icon=html.match(/<link rel="icon" href="([^"]+)/)[1];assert.equal(icon,'/brand/'+(/^\/(products|employees)\//.test(route)?route.split('/').at(-1):'ark')+'.svg');}
const app=readFileSync(join(root,'app.html'),'utf8');assert.match(app,/data-page="app"/);assert.match(app,/noindex,nofollow/);assert.match(app,/type="module"[^>]+src="\/assets\//);assert.doesNotMatch(app,/hero|产品中心/);
assert.match(pages.get('/products'),/客户与交易导入|购买与复购指标/);assert.doesNotMatch(pages.get('/products'),/CRM AI|自动群发|自动发券|敬请期待|后续规划/);assert.match(pages.get('/products'),/BOM|工单/);assert.match(pages.get('/employees'),/人员|确认/);
for(const [route,html]of pages){
 assert.match(html,/href="\/login">前往工作台/);
 assert.doesNotMatch(html,/\/marketing\/(?:ui-(?:erp|crm|mes|geo)-v\d+\.webp|content-studio\.webp|[^"]+\.jpg)/,'Product screenshots in public markup: '+route);
 for(const [,src]of html.matchAll(/<img[^>]+src="([^"]+\.webp)"/g)){
  const file=readFileSync(join(root,src));assert.equal(file.subarray(0,4).toString(),'RIFF');assert.equal(file.subarray(8,12).toString(),'WEBP');
 }
}
console.log(JSON.stringify({publicPages:pages.size,uniqueTitles:titles.size,images,links,privateShellIsolated:true,productImageFormatVerified:true}));
// File-backed ASSETS with html_handling=none: directories never implicitly become index.html.
const worker=(await import(pathToFileURL(resolve('cloudflare/frontend-worker.js')).href)).default;
const assetEnv={FRONTEND_PREFIX:'',ASSETS:{fetch(request){const path=new URL(request.url).pathname;const p=join(root,path);if(!existsSync(p)||!path.split('/').at(-1).includes('.'))return new Response('Missing asset',{status:404});return new Response(readFileSync(p),{headers:{'content-type':path.endsWith('.html')?'text/html':'application/octet-stream'}});}}};
for(const [path]of routes){const response=await worker.fetch(new Request('https://qa.example'+path),assetEnv);assert.equal(response.status,200,'File-backed public route '+path);assert.equal(await response.text(),pages.get(path));}
for(const path of ['/login','/register','/t/demo/erp','/t/demo/crm']){const response=await worker.fetch(new Request('https://qa.example'+path),assetEnv);assert.equal(response.status,200);assert.equal(await response.text(),app);}
assert.equal((await worker.fetch(new Request('https://qa.example/products/missing'),assetEnv)).status,404);
for(const [oldPath,anchors]of Object.entries(legacyHashRoutes)){const html=pages.get(oldPath);assert.ok(html);const embedded=JSON.parse(html.match(/<script id="legacy-routes" type="application\/json">(.*?)<\/script>/s)[1]);assert.deepEqual(embedded,anchors);for(const target of Object.values(anchors))assert.ok(routes.has(new URL(target,'https://zhixingark.cn').pathname));}
for(const [old,target]of Object.entries(retiredPublicRoutes)){
 const expected=new URL(target,'https://qa.example');assert.ok(routes.has(expected.pathname));assert.ok(pages.get(expected.pathname).includes('id="'+expected.hash.slice(1)+'"'));
 for(const suffix of ['','/','/index.html']){
  const response=await worker.fetch(new Request('https://qa.example'+old+suffix+'?ref=old'),assetEnv);assert.equal(response.status,308);const actual=new URL(response.headers.get('location'));assert.equal(actual.pathname,expected.pathname);assert.equal(actual.hash,expected.hash);assert.equal(actual.searchParams.get('ref'),'old');
 }
}
for(const [path,html]of pages)for(const [,href]of html.matchAll(/<a[^>]+href="([^"]+)"/g)){if(href.startsWith('mailto:'))continue;const target=new URL(href,'https://qa.example'+path);assert.ok(!Object.hasOwn(retiredPublicRoutes,target.pathname),'Internal link still requires a retired detail page: '+href);}
assert.match(home, /href="#work"/);
const homeFeatures = [...home.matchAll(/<article class="application-feature [^"]+">([\s\S]+?)<\/article>/g)];
assert.equal(homeFeatures.length,6);
for(const [,feature]of homeFeatures){
 const links = [...feature.matchAll(/<a [^>]*href="([^"]+)"/g)].map(([,href])=>href);
 assert.equal(links.length,1,'One scenario link per homepage card');
 assert.match(links[0],/^\/solutions#/);
}
console.log('File-backed static binding verified: '+routes.size+' public routes, private shell, missing page 404 and legacy destinations.');

assert.match(home, /href="\/products#geo"/);
assert.match(home, /href="\/solutions#manufacturing-fulfillment"/);
assert.match(pages.get('/products'), /products-tab-manufacturing/);
assert.match(pages.get('/products'), /platform-manufacturing-render\.webp/);
assert.match(pages.get('/products'), /WorkBuddy 制造进销存专家/);
assert.match(pages.get('/solutions'), /solutions-tab-manufacturing-fulfillment/);
assert.match(pages.get('/products'), /products-tab-geo/);
assert.match(pages.get('/products'), /platform-geo-render\.webp/);
assert.match(pages.get('/products'), /href="\/solutions#brand-visibility"/);
assert.match(pages.get('/solutions'), /solutions-tab-brand-visibility/);
assert.doesNotMatch(pages.get('/solutions'), /<img[^>]+src="\/marketing\/platform-\w+-render\.webp"/);
assert.match(pages.get('/solutions'), /装配清单\.xlsx/);
assert.match(pages.get('/solutions'), /待确认用量/);
assert.match(pages.get('/products'), /products-tab-content/);
assert.doesNotMatch(pages.get('/products'), /按企业开通/);
assert.match(pages.get('/products'), /href="\/login"[^>]*>前往工作台/);
assert.match(pages.get('/products'), /content-original.webp/);
assert.match(pages.get('/products'), /content-edited.webp/);
assert.match(pages.get('/solutions'), /solutions-tab-brand-content/);
assert.doesNotMatch(pages.get('/products'), /视频生成|立即免费使用/);

// Validate the artifacts deployed behind the gateway, not only the router implementation.
for(const [app,prefix]of [['admin','/tenant-admin/'],['platform-admin','/platform-admin/']]){
 const html=readFileSync(resolve('apps',app,'dist/index.html'),'utf8');
 const entries=[...html.matchAll(/(?:src|href)="([^\"]*assets\/[^\"]+)"/g)].map(m=>m[1]);
 assert.ok(entries.length>=2,'Missing admin entry bundles');
 for(const entry of entries){assert.ok(entry.startsWith(prefix+'assets/'),'Wrong published base: '+entry);assert.ok(existsSync(resolve('apps',app,'dist',entry.slice(prefix.length))));}
}
console.log('Both admin artifacts use the correct gateway asset prefixes.');

assert.match(pages.get('/employees'), /employees-tab-content/);
assert.match(pages.get('/employees'), /品牌内容创作官/);
assert.match(pages.get('/employees'), /GEO 品牌分析官/);
assert.match(pages.get('/employees'), /content-example/);
assert.match(pages.get('/solutions'), /品牌内容创作官/);
