const assert=require('node:assert/strict'),{randomUUID,randomBytes,createHash}=require('node:crypto');
const {createApp}=require('../dist/server'),{PrismaService}=require('../dist/modules/prisma.service'),{newSessionToken,tokenHash}=require('../dist/modules/platform/security'),{createFixture,cleanupFixture}=require('../scripts/workflow-fixture.cjs');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StreamableHTTPClientTransport}=require('@modelcontextprotocol/sdk/client/streamableHttp.js');
(async()=>{
 const u=new URL(process.env.DATABASE_URL||'postgresql://invalid');if(process.env.CRM_UNIFIED_QA==='20261026'){assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'54329');assert.equal(u.pathname,'/suite_phase1_qa');}else{assert.equal(process.env.WB_ISOLATED_QA,'20261024');assert.equal(u.hostname,'postgres');assert.equal(u.pathname,'/suite_workbuddy_qa_20261024');}
 const Filter=require('../dist/modules/api-exception.filter').ApiExceptionFilter;const filterCatch=Filter.prototype.catch;Filter.prototype.catch=function(e,h){if(process.env.WB_QA_DEBUG&&!(e.getStatus&&e.getStatus()<500))console.error('QA server error',{name:e.name,code:e.code,kind:e?.meta?.driverAdapterError?.cause?.kind});return filterCatch.call(this,e,h)};
 process.env.NODE_ENV='test';process.env.NATIVE_AI_MODEL_ENABLED='false';delete process.env.RUNTIME_MANAGER_SOCKET;
 const db=new PrismaService();let app,f,checks=0,http=0;const clients=[],registered=[];const eq=(a,b)=>{assert.deepEqual(a,b);checks++};const ok=x=>{assert.ok(x);checks++};
 try{
 f=await createFixture(db,'erp-flow-test-wb-'+randomUUID().slice(0,8));await db.tenantApp.createMany({data:['crm','mes'].map(appId=>({tenantId:f.tenant.id,appId}))});await db.tenantCapability.create({data:{tenantId:f.tenant.id,capability:'ai',enabled:true,delivered:true}});
 const token=newSessionToken();await db.session.create({data:{userId:f.accounts.admin.userId,tokenHash:tokenHash(token),expiresAt:new Date(Date.now()+3600000)}});const cookie='suite_session='+token;
 app=await createApp();await app.listen(0,'127.0.0.1');const origin='http://127.0.0.1:'+app.getHttpServer().address().port;process.env.CONNECTOR_PUBLIC_ORIGIN=origin;
 async function req(path,body,expected=body?201:200,extra={}){const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...extra},body:body?JSON.stringify(body):undefined,redirect:'manual'});http++;eq(r.status,expected);let data;try{data=await r.json()}catch{data={}}return {r,data};}
 const web=(path,body,status)=>req('/api/v1'+path,body,status,{Cookie:cookie,Origin:'http://127.0.0.1:4601'});
 eq((await req('/.well-known/oauth-authorization-server')).data.code_challenge_methods_supported,['S256']);
 for(const appId of ['erp','crm','mes']){const r=await req('/api/v1/mcp/'+appId,undefined,401);ok(r.r.headers.get('www-authenticate').includes('/'+appId));eq((await req('/.well-known/oauth-protected-resource/api/v1/mcp/'+appId)).data.resource,origin+'/api/v1/mcp/'+appId);}
 await req('/api/v1/oauth/register',{redirect_uris:['https://evil.example/callback']},400);
 const callback='http://127.0.0.1:4609/oauth/callback';const c=(await req('/api/v1/oauth/register',{client_name:'WorkBuddy隔离验收',redirect_uris:[callback],token_endpoint_auth_method:'none'})).data;registered.push(c.client_id);
 async function connect(appId,draft=true){
  const resource=origin+'/api/v1/mcp/'+appId,verifier=randomBytes(32).toString('base64url'),state=randomUUID();const q=new URLSearchParams({client_id:c.client_id,redirect_uri:callback,response_type:'code',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',resource,scope:appId+'.read '+appId+'.draft',state});
  const auth=await req('/api/v1/oauth/authorize?'+q,undefined,302),id=new URL(auth.r.headers.get('location')).searchParams.get('request');const details=(await web('/connect/requests/'+id)).data;ok(details.tenants.some(t=>t.key===f.tenant.slug));
  await req('/api/v1/connect/requests/'+id,{nonce:details.nonce,decision:'allow',tenantKey:f.tenant.slug,allowDraft:draft},403,{Cookie:cookie});
  const answer=(await web('/connect/requests/'+id,{nonce:details.nonce,decision:'allow',tenantKey:f.tenant.slug,allowDraft:draft})).data;const url=new URL(answer.redirect);eq(url.searchParams.get('state'),state);const code=url.searchParams.get('code'),body={grant_type:'authorization_code',client_id:c.client_id,code,code_verifier:verifier,redirect_uri:callback,resource};
  await req('/api/v1/oauth/token',{...body,code_verifier:randomBytes(32).toString('base64url')},400);const tokens=(await req('/api/v1/oauth/token',body,200)).data;await req('/api/v1/oauth/token',body,400);ok(tokens.expires_in<=3600&&tokens.expires_in>3500);
  const client=new Client({name:'workbuddy-qa',version:'1.0.0'});await client.connect(new StreamableHTTPClientTransport(new URL(resource),{requestInit:{headers:{Authorization:'Bearer '+tokens.access_token}}}));clients.push(client);
  return {client,tokens,resource,call:async(name,args={})=>{const r=await client.callTool({name,arguments:args});if(r.isError)throw Error(JSON.stringify(r));return r.structuredContent||JSON.parse(r.content[0].text)}};
 }
 // The official SDK discovers metadata, dynamically registers, and performs the PKCE token exchange.
 const oauthState={};const provider={redirectUrl:callback,clientMetadata:{client_name:'WorkBuddy SDK OAuth QA',redirect_uris:[callback],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'},clientInformation:()=>oauthState.client,saveClientInformation:v=>{oauthState.client=v;registered.push(v.client_id)},tokens:()=>oauthState.tokens,saveTokens:v=>oauthState.tokens=v,saveCodeVerifier:v=>oauthState.verifier=v,codeVerifier:()=>oauthState.verifier,redirectToAuthorization:v=>oauthState.url=v};
 const sdkAuth=require('@modelcontextprotocol/sdk/client/auth.js').auth;eq(await sdkAuth(provider,{serverUrl:origin+'/api/v1/mcp/erp',scope:'erp.read'}),'REDIRECT');
 const sdkRedirect=await req(oauthState.url.pathname+oauthState.url.search,undefined,302);const sdkRequest=new URL(sdkRedirect.r.headers.get('location')).searchParams.get('request');const sdkDetails=(await web('/connect/requests/'+sdkRequest)).data;
 const sdkConsent=(await web('/connect/requests/'+sdkRequest,{nonce:sdkDetails.nonce,decision:'allow',tenantKey:f.tenant.slug,allowDraft:false})).data;
 eq(await sdkAuth(provider,{serverUrl:origin+'/api/v1/mcp/erp',authorizationCode:new URL(sdkConsent.redirect).searchParams.get('code')}),'AUTHORIZED');ok(oauthState.tokens.access_token);
 const erp=await connect('erp'),crm=await connect('crm'),mes=await connect('mes'),readOnly=await connect('erp',false);
 for(const [appId,x]of Object.entries({erp,crm,mes})){const tools=(await x.client.listTools()).tools;ok(tools.every(t=>t.name.startsWith('ark_')||t.name.startsWith(appId+'_')));ok(tools.some(t=>t.name.includes('prepare')));eq((await x.call('ark_context')).appId,appId);}
 ok(!(await readOnly.client.listTools()).tools.some(t=>t.name.includes('prepare')));
 await req('/api/v1/mcp/crm',undefined,401,{Authorization:'Bearer '+erp.tokens.access_token});
 await req('/api/v1/mcp/erp',undefined,403,{Authorization:'Bearer '+erp.tokens.access_token,Origin:'https://evil.example'});
 const tenantId=f.tenant.id;
 const supplier=await db.erpSupplier.create({data:{tenantId,code:'WB-QA',name:'隔离供应商'}}),product=await db.erpProduct.create({data:{tenantId,sku:'WB-QA',name:'隔离商品',unit:'件',purchasePrice:'12.50',salePrice:'20.00'}});
 eq((await erp.call('erp_master_search',{kind:'suppliers'})).items[0].id,supplier.id);await erp.call('erp_inventory_overview');
 const p=(await web('/tenants/'+f.tenant.slug+'/apps/mes/materials',{requestKey:randomUUID(),sku:'WB-FG',name:'隔离成品',kind:'finished',unit:'件'})).data;
 const raw=(await web('/tenants/'+f.tenant.slug+'/apps/mes/materials',{requestKey:randomUUID(),sku:'WB-RAW',name:'隔离原料',kind:'raw',unit:'千克'})).data;
 const bom=(await web('/tenants/'+f.tenant.slug+'/apps/mes/boms',{requestKey:randomUUID(),draft:{productId:p.id,lines:[{materialId:raw.id,quantity:'2',wastePercent:'5'}]}})).data;
 await web('/tenants/'+f.tenant.slug+'/apps/mes/boms/'+bom.id+'/publish',{requestKey:randomUUID(),version:bom.version});
 await crm.call('crm_metrics');await mes.call('mes_production_overview');
 for(const [name,args]of [['crm_workbench',{}],['crm_sales_pools',{}],['crm_growth_opportunities',{}],['crm_customers',{page_size:1}],['crm_segments',{}],['crm_tasks',{}],['crm_leads',{}],['crm_opportunities',{}],['crm_service_records',{kind:'plans'}],['crm_service_records',{kind:'risks'}]])await crm.call(name,args);
 eq((await crm.client.listTools()).tools.length,22);
 const crmRead=await connect('crm',false);const crmReadTools=(await crmRead.client.listTools()).tools;eq(crmReadTools.length,20);ok(crmReadTools.every(t=>t.annotations.readOnlyHint));ok(!crmReadTools.some(t=>t.name==='crm_preview_segment'));

 const drafts={erp:{supplierId:supplier.id,lines:[{productId:product.id,quantity:3,unitPrice:'12.50'}]},crm:{title:'隔离复购计划',goal:'核对复购需求',planText:'由负责人核对客户需求并人工记录结果。',checklist:[{stableId:'step1',text:'核对需求'}]},mes:{code:'WB-PLAN-'+randomUUID().slice(0,8),productId:p.id,bomId:bom.id,targetQty:10,dueAt:new Date(Date.now()+86400000*3).toISOString()}};
 for(const [appId,x]of Object.entries({erp,crm,mes})){
  const tool={erp:'erp_prepare_purchase_draft',crm:'crm_prepare_task_draft',mes:'mes_prepare_plan_draft'}[appId],key=randomUUID();const a=await x.call(tool,{requestKey:key,draft:drafts[appId]}),a2=await x.call(tool,{requestKey:key,draft:drafts[appId]});eq(a.actionId,a2.actionId);eq(a.status,'pending');
  const count=()=>appId==='erp'?db.erpPurchaseOrder.count({where:{tenantId}}):appId==='crm'?db.crmOperationTask.count({where:{tenantId}}):db.mesPlan.count({where:{tenantId}});eq(await count(),0);
  await web('/connect/actions/'+a.actionId,{decision:'confirm',version:a.version,fingerprint:'0'.repeat(64)},409);
  const confirmed=(await web('/connect/actions/'+a.actionId,{decision:'confirm',version:a.version,fingerprint:a.fingerprint})).data;eq(confirmed.status,'completed');ok(confirmed.receipt.id);eq(confirmed.receipt.status,'draft');eq(await count(),1);
  const repeat=(await web('/connect/actions/'+a.actionId,{decision:'confirm',version:a.version,fingerprint:a.fingerprint})).data;eq(repeat.receipt.id,confirmed.receipt.id);eq(await count(),1);
  const receipt=await x.call('ark_action_status',{actionId:a.actionId});eq(receipt.currentBusiness.id,confirmed.receipt.id);eq(receipt.currentBusiness.status,'draft');
  const other=await (appId==='erp'?crm:erp).client.callTool({name:'ark_action_status',arguments:{actionId:a.actionId}});eq(other.isError,true);
 }
 // Concurrent confirmations create only one extra draft.
 const concurrent=await erp.call('erp_prepare_purchase_draft',{requestKey:randomUUID(),draft:{supplierId:supplier.id,lines:[{productId:product.id,quantity:1}]}});
 const confirmBody={decision:'confirm',version:concurrent.version,fingerprint:concurrent.fingerprint};
 const responses=await Promise.all([1,2].map(()=>fetch(origin+'/api/v1/connect/actions/'+concurrent.actionId,{method:'POST',headers:{Cookie:cookie,Origin:'http://127.0.0.1:4601','Content-Type':'application/json'},body:JSON.stringify(confirmBody)})));
 for(const r of responses)if(![201,409].includes(r.status))console.error('concurrent response',r.status,await r.clone().text());ok(responses.every(r=>[201,409].includes(r.status)));ok(responses.some(r=>r.status===201));eq(await db.erpPurchaseOrder.count({where:{tenantId}}),2);eq((await web('/connect/actions/'+concurrent.actionId,confirmBody)).data.status,'completed');
 // Changed business price is rejected, without creating a second order.
 const stale=await erp.call('erp_prepare_purchase_draft',{requestKey:randomUUID(),draft:{supplierId:supplier.id,lines:[{productId:product.id,quantity:1}]}});await db.erpProduct.update({where:{id:product.id},data:{purchasePrice:'13.00'}});await web('/connect/actions/'+stale.actionId,{decision:'confirm',version:stale.version,fingerprint:stale.fingerprint},409);eq(await db.erpPurchaseOrder.count({where:{tenantId}}),2);
 for(const appId of ['erp','crm','mes']){const path=appId==='erp'?'/tenants/'+f.tenant.slug+'/ai':'/tenants/'+f.tenant.slug+'/apps/'+appId+'/ai';const r=await web(path+'/conversations',{title:'不得调用模型'},503);eq(r.data.error.code,'AI_NOT_OPEN');}
 eq(await db.aiTask.count({where:{tenantId}}),0);eq(await db.aiExecution.count({where:{tenantId}}),0);
 // Refresh rotation and replay revoke the grant, including freshly issued tokens.
 const rotated=(await req('/api/v1/oauth/token',{grant_type:'refresh_token',client_id:c.client_id,refresh_token:readOnly.tokens.refresh_token,resource:readOnly.resource},200)).data;
 await req('/api/v1/oauth/token',{grant_type:'refresh_token',client_id:c.client_id,refresh_token:readOnly.tokens.refresh_token,resource:readOnly.resource},400);
 await req('/api/v1/mcp/erp',undefined,401,{Authorization:'Bearer '+rotated.access_token});
 const connections=(await web('/connect/connections')).data;const grant=connections.find(g=>g.appId==='mes'&&g.status==='active');await web('/connect/connections/'+grant.id+'/revoke',{});await req('/api/v1/mcp/mes',undefined,401,{Authorization:'Bearer '+mes.tokens.access_token});
 await db.membership.update({where:{id:f.accounts.admin.memberId},data:{active:false}});await req('/api/v1/mcp/crm',undefined,401,{Authorization:'Bearer '+crm.tokens.access_token});
 console.log(JSON.stringify({ok:true,assertions:checks,httpChecks:http,officialSdk:true,officialSdkOAuthDiscovery:true,threeAppReadPrepareConfirmReceipt:true,pkce:true,resourceIsolation:true,readOnlyScope:true,receiptIdempotency:true,stalePreviewRejected:true,refreshReplayRevokes:true,revocation:true,currentMembership:true,concurrentConfirmation:true,nativeModelCalls:0}));
 }finally{
  for(const c of clients)await c.close().catch(()=>{});if(app)await app.close();
  if(f){const grants=await db.connectorGrant.findMany({where:{tenantId:f.tenant.id},select:{id:true}});await db.connectorToken.deleteMany({where:{grantId:{in:grants.map(g=>g.id)}}});await db.connectorAction.deleteMany({where:{tenantId:f.tenant.id}});await db.connectorGrant.deleteMany({where:{tenantId:f.tenant.id}});await cleanupFixture(db,f);}
  if(registered.length){await db.connectorAuthorization.deleteMany({where:{clientId:{in:registered}}});await db.connectorClient.deleteMany({where:{id:{in:registered}}});}await db.$disconnect();
 }
})().catch(e=>{console.error(e);process.exitCode=1});
