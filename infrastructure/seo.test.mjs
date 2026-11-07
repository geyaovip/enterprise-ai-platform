import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {publicPaths,retiredPublicRoutes} from '../cloudflare/public-routes.mjs';
const root='apps/web/dist';
const origin='https://zhixingark.cn';
const routes=publicPaths;
const worker=(await import(pathToFileURL(resolve('cloudflare/frontend-worker.js')).href)).default;
const env={PUBLIC_SITE_ORIGIN:origin,FRONTEND_PREFIX:'',ASSETS:{fetch(request){
 const path=new URL(request.url).pathname,file=root+path;
 const found=existsSync(file)&&path.split('/').at(-1).includes('.');
 const type=path.endsWith('.html')?'text/html':path.endsWith('.jpg')?'image/jpeg':path.endsWith('.svg')?'image/svg+xml':'text/plain';
 return new Response(found?readFileSync(file):'Missing',{status:found?200:404,headers:{'content-type':type}});
}}};
const meta=(html,key)=>html.match(new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)"`))?.[1];
for(const route of routes){
 const response=await worker.fetch(new Request(origin+route),env);assert.equal(response.status,200);assert.equal(response.headers.get('x-robots-tag'),null);
 const html=await response.text(),data=JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
 assert.equal(data['@context'],'https://schema.org');const graph=data['@graph'];
 const page=graph.find(x=>['WebPage','CollectionPage'].includes(x['@type']));assert.equal(page.url,origin+route);
 assert.equal(graph.find(x=>x['@type']==='WebSite').url,origin+'/');
 assert.equal(graph.find(x=>x['@type']==='Organization').logo.url,origin+'/brand/ark.svg');
 assert.equal(meta(html,'og:title'),meta(html,'twitter:title'));assert.equal(meta(html,'og:description'),meta(html,'twitter:description'));assert.equal(meta(html,'og:image'),meta(html,'twitter:image'));
 assert.ok(Number(meta(html,'og:image:width'))>0);assert.ok(Number(meta(html,'og:image:height'))>0);assert.ok(meta(html,'og:image:alt'));assert.match(meta(html,'robots'),/max-image-preview:large/);
 const ids=new Set(graph.map(x=>x['@id']));
 const checkRefs=(node)=>{if(!node||typeof node!=='object')return;if(Object.keys(node).length===1&&node['@id'])assert.ok(ids.has(node['@id']),'Dangling JSON-LD reference');Object.values(node).forEach(checkRefs);};graph.forEach(checkRefs);
 if(route!=='/'){
  const crumb=graph.find(x=>x['@type']==='BreadcrumbList');assert.equal(crumb.itemListElement.length,2);
  crumb.itemListElement.forEach((x,i)=>{assert.equal(x.position,i+1);assert.ok(routes.includes(new URL(x.item).pathname));assert.ok(html.includes(x.name));});
  assert.match(html,/<nav class="breadcrumb"/);
 }
 if(route==='/products')assert.deepEqual(graph.find(x=>x['@type']==='ItemList').itemListElement.map(x=>x.url),['erp','crm','mes','content','geo'].map(x=>origin+'/products#'+x));
 if(route==='/products'){
  const apps=graph.filter(x=>x['@type']==='SoftwareApplication');assert.equal(apps.length,5);
  for(const app of apps){assert.equal(new URL(app.url).pathname,'/products');assert.ok(html.includes('id="'+new URL(app.url).hash.slice(1)+'"'));assert.equal(app.featureList.length,['#content','#geo'].includes(new URL(app.url).hash)?4:6);app.featureList.forEach(x=>assert.ok(html.includes(x)));assert.ok(!('screenshot'in app)&&!('offers'in app)&&!('aggregateRating'in app)&&!('review'in app));}
 }
 for(const agent of ['Googlebot','bingbot','Baiduspider']){const crawler=await worker.fetch(new Request(origin+route,{headers:{'user-agent':agent}}),env);assert.equal(await crawler.text(),html);}
}
for(const route of ['/','/products/mes','/products/erp/index.html','/products/crm/','/robots.txt','/sitemap.xml']){
 const r=await worker.fetch(new Request('https://enterprise-ai-platform.492746023.workers.dev'+route+'?from=seo'),env);
 assert.equal(r.status,308);assert.equal(new URL(r.headers.get('location')).origin,origin);assert.equal(new URL(r.headers.get('location')).search,'?from=seo');
 let followed=await worker.fetch(new Request(r.headers.get('location')),env);if(followed.status===308)followed=await worker.fetch(new Request(followed.headers.get('location')),env);assert.equal(followed.status,200,'Broken retired or canonical destination');
}
for(const path of ['/not-a-page','/products/not-an-app','/employees/not-a-role','/solutions/not-a-task','/future-app','/products/not-an-app.json']){
 const r=await worker.fetch(new Request(origin+path),env);assert.equal(r.status,404);assert.match(r.headers.get('x-robots-tag'),/noindex/);assert.match(await r.text(),/页面不存在/);
}
for(const path of ['/login','/register','/join','/onboarding','/tenants','/t/demo/erp','/t/demo/crm','/t/demo/mes']){
 for(const base of [origin,'https://enterprise-ai-platform.492746023.workers.dev']){
  const r=await worker.fetch(new Request(base+path),env);assert.equal(r.status,200);assert.match(r.headers.get('x-robots-tag'),/noindex/);assert.match(await r.text(),/data-page="app"/);
 }
}
for(const path of ['/marketing/crm-overview.jpg','/marketing/erp-inventory.jpg','/marketing/mes-production.jpg','/brand/ark.svg']){
 const r=await worker.fetch(new Request(origin+path),env);assert.equal(r.status,200);assert.equal(r.headers.get('x-robots-tag'),null);
}
assert.match((await worker.fetch(new Request(origin+'/brand/identity.html'),env)).headers.get('x-robots-tag'),/noindex/);
const robots=await(await worker.fetch(new Request(origin+'/robots.txt'),env)).text();assert.match(robots,/Sitemap: https:\/\/zhixingark.cn\/sitemap.xml/);assert.doesNotMatch(robots,/Disallow: \/(?:login|register|t\/)/);
const xml=await(await worker.fetch(new Request(origin+'/sitemap.xml'),env)).text();assert.deepEqual([...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(x=>x[1]),routes.map(x=>origin+x));
for(const path of ['/','/robots.txt','/sitemap.xml','/missing']){const r=await worker.fetch(new Request(origin+path,{method:'HEAD'}),env);assert.equal(await r.text(),'');}
console.log(JSON.stringify({seoPages:routes.length,structuredDataGraphs:routes.length,crawlerAgents:3,legacyPublicRedirects:6,real404Cases:6,privateRoutes:8,imageIndexing:'passed',headRequests:'passed',fakeCommercialClaims:0}));

for(const old of Object.keys(retiredPublicRoutes)){const response=await worker.fetch(new Request(origin+old),env);assert.equal(response.status,308);assert.ok(routes.includes(new URL(response.headers.get('location')).pathname));assert.ok(!xml.includes('<loc>'+origin+old+'</loc>'));}
