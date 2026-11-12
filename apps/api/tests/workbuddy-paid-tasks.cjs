const assert = require('node:assert/strict');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

assert.match(process.env.DATABASE_URL || '', /^postgresql:\/\/[^@]+@127\.0\.0\.1:54329\/suite_phase1_qa$/);
const storage = mkdtempSync(join(tmpdir(), 'workbuddy-paid-qa-'));
Object.assign(process.env, {
  NODE_ENV: 'test', WEB_ORIGIN: 'http://127.0.0.1:4601',
  PUBLIC_WEB_ORIGIN: 'http://127.0.0.1:4601', NATIVE_AI_MODEL_ENABLED: 'false',
  AI_ENCRYPTION_KEY: randomBytes(32).toString('base64'), CONTENT_ARK_API_KEY: 'isolated-qa-key',
  CONTENT_STORAGE_PATH: storage,
});
const { createApp } = require('../dist/server');
const { PrismaService } = require('../dist/modules/prisma.service');
const { ContentService } = require('../dist/modules/content/content.service');
const { GeoProvider } = require('../dist/modules/geo/geo.provider');
const { GeoWorker } = require('../dist/modules/geo/geo.worker');
const { createFixture, fixtureHttp, cleanupFixture } = require('../scripts/workflow-fixture.cjs');

(async () => {
  const app = await createApp(), db = app.get(PrismaService);
  const clients = [], registrations = [];
  let fixture, http, checks = 0, imageCalls = 0, geoCalls = 0, videoCalls = 0;
  const eq = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const ok = value => { assert.ok(value); checks++; };
  try {
    const content = app.get(ContentService);
    const png = spawnSync('python3', ['-c',
      "from PIL import Image;import io,base64;b=io.BytesIO();Image.new('RGB',(128,128),'#bc9c72').save(b,format='PNG');print(base64.b64encode(b.getvalue()).decode())",
    ], { encoding: 'utf8' });
    assert.equal(png.status, 0, png.stderr);
    content.provider.generate = async () => {
      imageCalls++;
      return { image: png.stdout.trim(), model: content.provider.model(), externalId: 'qa-image', usage: { generated_images: 1 } };
    };
    content.video.submit = async () => { videoCalls++; throw Error('Video queue test must not invoke a provider'); };
    app.get(GeoProvider).invoke = async () => {
      geoCalls++;
      return { text: '1. 推荐合成品牌。', inputTokens: 20, outputTokens: 10, searchCalls: 0,
        finishReason: 'stop', providerRequestId: 'qa-report', citations: [{title:'证据',url:'https://example.test/geo'}] };
    };
    fixture = await createFixture(db, 'erp-flow-test-workbuddy-paid-' + randomUUID().slice(0, 8));
    const tenantId = fixture.tenant.id;
    await db.tenantApp.createMany({ data: ['content','geo'].map(appId => ({ tenantId,appId })) });
    await db.tenantCapability.create({ data: { tenantId, capability: 'ai', enabled: true, delivered: true } });
    await db.contentGrant.create({ data: { tenantId, membershipId: fixture.accounts.buyer.memberId, role: 'viewer' } });
    http = await fixtureHttp(app, fixture);
    const origin = 'http://127.0.0.1:' + app.getHttpServer().address().port;
    process.env.CONNECTOR_PUBLIC_ORIGIN = origin;
    const [ipThird,ipFourth]=randomBytes(2);
    const headers={'Content-Type':'application/json','X-Forwarded-For':'198.18.'+ipThird+'.'+ipFourth};
    const req = async (path, expected, body) => {
      const r = await fetch(origin + path, {
        method: body ? 'POST' : 'GET', redirect: 'manual',
        headers, body: body ? JSON.stringify(body) : undefined,
      });
      assert.equal(r.status, expected, path);
      checks++;
      return r;
    };
    const connect = async (appId, execute, actor = 'admin', rejectExecution = false) => {
      const resource = origin + '/api/v1/mcp/' + appId;
      const callback = 'http://127.0.0.1:4609/oauth/callback';
      const {client_id} = await (await req('/api/v1/oauth/register',201,{redirect_uris:[callback]})).json();
      registrations.push(client_id);
      const verifier = randomBytes(32).toString('base64url');
      const q = new URLSearchParams({client_id,redirect_uri:callback,response_type:'code',
        code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',resource});
      q.set('scope', appId + '.read ' + appId + '.draft');
      await req('/api/v1/oauth/authorize?'+q,400);
      q.delete('scope');
      const start = await req('/api/v1/oauth/authorize?'+q,302);
      const path = '/connect/requests/' + new URL(start.headers.get('location')).searchParams.get('request');
      const {data:details} = await http.request(path,'GET',undefined,actor);
      eq(details.requestedScopes,[appId+'.read',appId+'.execute']);
      eq(details.tenants.find(t=>t.key===fixture.tenant.slug).executionAllowed,actor==='admin');
      const consent = {nonce:details.nonce,decision:'allow',tenantKey:fixture.tenant.slug,allowExecution:execute};
      if(rejectExecution)await http.request(path,'POST',{...consent,allowExecution:true},actor,403);
      const {data:allowed}=await http.request(path,'POST',consent,actor);
      const code=new URL(allowed.redirect).searchParams.get('code');
      const token=await (await req('/api/v1/oauth/token',200,{
        grant_type:'authorization_code',client_id,code,code_verifier:verifier,redirect_uri:callback,resource,
      })).json();
      eq(token.scope, appId+'.read'+(execute?' '+appId+'.execute':''));
      const client=new Client({name:'workbuddy-qa',version:'1.0.0'});
      await client.connect(new StreamableHTTPClientTransport(new URL(resource),{requestInit:{headers:{Authorization:'Bearer '+token.access_token}}}));
      clients.push(client);
      return client;
    };
    const call = async (client,name,args={},error=false) => {
      const r=await client.callTool({name,arguments:args});
      assert.equal(Boolean(r.isError),error,name+' '+JSON.stringify(r.content));
      checks++;
      return r.structuredContent || JSON.parse(r.content[0].text);
    };
    for(const id of ['content','geo']){
      const metadata=await (await req('/.well-known/oauth-protected-resource/api/v1/mcp/'+id,200)).json();
      eq(metadata.scopes_supported,[id+'.read',id+'.execute']);
      const unauthorized=await req('/api/v1/mcp/'+id,401);
      ok(unauthorized.headers.get('www-authenticate').includes('scope="'+id+'.read '+id+'.execute"'));
    }
    const prefix='/tenants/'+fixture.tenant.slug+'/apps';
    const post=(path,body)=>http.request(path,'POST',body);
    const contentClient=await connect('content',true), contentViewer=await connect('content',false,'buyer',true);
    const geoClient=await connect('geo',true), geoRead=await connect('geo',false);
    const tools=async client=>(await client.listTools()).tools.map(t=>t.name).sort();
    eq((await tools(contentClient)).length,6);
    eq((await tools(geoClient)).length,8);
    ok((await tools(contentViewer)).every(name=>!name.includes('quote_')&&!name.includes('submit_')));
    ok((await tools(geoRead)).every(name=>!name.includes('quote_')&&!name.includes('submit_')));

    const {data:canvas}=await post(prefix+'/content/canvases',{name:'隔离内容项目'});
    const project=canvas.project;
    eq((await call(contentClient,'content_projects')).items.map(p=>p.id),[project.id]);
    eq((await call(contentViewer,'content_projects')).items,[]);
    await call(contentViewer,'content_assets',{projectId:project.id},true);
    const request={mode:'image',projectVersion:project.version,instruction:'合成产品宣传图'};
    const image=await call(contentClient,'content_quote_generation',{projectId:project.id,request});
    eq(image.estimatedCost,null);
    eq((await call(contentClient,'content_generation_status',{quoteId:image.quoteId})).status,'not_submitted');
    eq(await db.contentBatch.count({where:{tenantId}}),0);
    await call(geoClient,'geo_analysis_status',{quoteId:image.quoteId},true);
    const imageResult=await Promise.all([1,2].map(()=>call(contentClient,'content_submit_generation',{quoteId:image.quoteId})));
    eq(imageResult[0].batchId,imageResult[1].batchId);
    eq(await db.contentBatch.count({where:{tenantId}}),1);
    await content.tick();
    const imageStatus=await call(contentClient,'content_generation_status',{quoteId:image.quoteId});
    eq(imageStatus.items[0].status,'succeeded');
    ok(imageStatus.items[0].assetId);
    eq(imageCalls,1);
    const edit=await call(contentClient,'content_quote_generation',{
      projectId:project.id,request:{...request,referenceAssetId:imageStatus.items[0].assetId,instruction:'只换背景'},
    });
    ok(edit.quoteId);
    const video=await call(contentClient,'content_quote_generation',{
      projectId:project.id,request:{...request,mode:'video',video:{ratio:'1:1',duration:4,resolution:'480p'}},
    });
    eq((await call(contentClient,'content_submit_generation',{quoteId:video.quoteId})).items[0].status,'queued');
    eq(videoCalls,0);
    await db.connectorAction.update({where:{id:edit.quoteId},data:{expiresAt:new Date(0)}});
    await call(contentClient,'content_submit_generation',{quoteId:edit.quoteId},true);
    await db.connectorAction.update({where:{id:image.quoteId},data:{expiresAt:new Date(0)}});
    eq((await call(contentClient,'content_submit_generation',{quoteId:image.quoteId})).batchId,imageStatus.batchId);
    await http.request('/connect/actions/'+image.quoteId,'GET',undefined,'admin',404);

    const {data:geoProject}=await post(prefix+'/geo/projects',{name:'隔离 GEO 项目',brandName:'合成品牌'});
    const {data:question}=await post(prefix+'/geo/projects/'+geoProject.id+'/questions',{text:'推荐哪些合成品牌？'});
    const {data:model}=await post(prefix+'/geo/models',{name:'测试模型',family:'doubao',code:'qa-doubao',
      apiMode:'responses',apiKey:'qa-credential-only',inputPriceMicrosPerMillion:1000000,outputPriceMicrosPerMillion:2000000});
    const options=await call(geoClient,'geo_analysis_options',{projectId:geoProject.id});
    eq(options.questions.map(q=>q.id),[question.id]);
    eq(options.models.map(m=>m.id),[model.id]);
    ok(!JSON.stringify(options).includes('qa-credential-only'));
    const selection={questionIds:[question.id],modelIds:[model.id],maxCostMicros:1000000};
    await call(geoClient,'geo_quote_analysis',{projectId:geoProject.id,selection:{...selection,maxCostMicros:1}},true);
    const quote=await call(geoClient,'geo_quote_analysis',{projectId:geoProject.id,selection});
    ok(quote.estimatedCostMicros>0);
    eq(await db.geoAnalysis.count({where:{tenantId}}),0);
    await call(geoRead,'geo_analysis_status',{quoteId:quote.quoteId},true);
    const queued=await Promise.all([1,2].map(()=>call(geoClient,'geo_submit_analysis',{quoteId:quote.quoteId})));
    eq(queued[0].analysisId,queued[1].analysisId);
    eq(await db.geoAnalysis.count({where:{tenantId}}),1);
    await app.get(GeoWorker).tick();
    const done=await call(geoClient,'geo_analysis_status',{quoteId:quote.quoteId});
    eq(done.status,'completed');
    const summary=await call(geoRead,'geo_report_summary',{id:done.analysisId});
    eq(summary.report.validSamples,1);
    eq(summary.report.topCitationDomains,[{domain:'example.test',count:1}]);
    eq(geoCalls,1);
    const connections=(await http.request('/connect/connections')).data;
    const grant=connections.find(c=>c.appId==='geo'&&c.scopes.includes('geo.execute'));
    await post('/connect/connections/'+grant.id+'/revoke',{});
    await assert.rejects(()=>geoClient.listTools(),error=>error.code===401&&error.message.includes('invalid_token'));
    checks++;
    console.log(JSON.stringify({ok:true,checks,stubbedCalls:{image:imageCalls,geo:geoCalls},videoQueueOnly:true,realModelCalls:0}));
  } finally {
    for(const client of clients)await client.close().catch(()=>{});
    if(fixture){
      const where={tenantId:fixture.tenant.id};
      const grants=await db.connectorGrant.findMany({where,select:{id:true}});
      await db.connectorToken.deleteMany({where:{grantId:{in:grants.map(g=>g.id)}}});
      await db.connectorAction.deleteMany({where});
      await db.connectorGrant.deleteMany({where});
      for(const table of ['geoRun','geoAnalysis','geoQuestion','geoModelVersion','geoModel','geoProject'])await db[table].deleteMany({where});
      await cleanupFixture(db,fixture);
    }
    await db.connectorAuthorization.deleteMany({where:{clientId:{in:registrations}}});
    await db.connectorClient.deleteMany({where:{id:{in:registrations}}});
    await app.close();
    rmSync(storage,{recursive:true,force:true});
  }
})().catch(error => { console.error(error); process.exitCode=1; });
