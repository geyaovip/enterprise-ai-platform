// Real database/API/worker boundaries; the Runtime alone is replaced to avoid paid calls.
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),fs=require('node:fs');
const {infrastructureSecret}=require('../dist/modules/platform/infrastructure-contract');
const {createApp}=require('../dist/server'),{PrismaService}=require('../dist/modules/prisma.service'),{AuthService}=require('../dist/modules/platform/auth.service'),{AiService}=require('../dist/modules/ai/ai.service'),{AgentExecutionService}=require('../dist/modules/ai/agent.runtime'),{QuotaService}=require('../dist/modules/orchestration/quota.service'),{processNextTask}=require('../dist/worker'),{createFixture,cleanupFixture}=require('../scripts/workflow-fixture.cjs'),{newSessionToken,tokenHash}=require('../dist/modules/platform/security');
(async()=>{
 assert.match(process.env.DATABASE_URL??'',/@127\.0\.0\.1:54339\/suite_native_qa$/);process.env.NODE_ENV='test';process.env.NATIVE_AI_MODEL_ENABLED='true';process.env.MES_AI_RELEASE_ENABLED='true';
 let app,f,g,calls=0,fail=false,checks=0,db=new PrismaService(),held,entered;
 const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
 try{
  f=await createFixture(db,'erp-flow-test-'+randomUUID().slice(0,8));g=await createFixture(db,'erp-flow-test-'+randomUUID().slice(0,8));
  const shared=await db.membership.create({data:{tenantId:g.tenant.id,userId:f.accounts.admin.userId,role:'admin'}});
  for(const t of [f,g]){await db.tenantCapability.create({data:{tenantId:t.tenant.id,capability:'ai',delivered:true,enabled:true}});await db.tenantApp.createMany({data:['crm','mes'].map(appId=>({tenantId:t.tenant.id,appId}))});}
  app=await createApp();
  if(process.env.AI_CHAT_QA_KEEP==='1'){
    for(const key of ['admin','buyer'])await db.infrastructureBinding.create({data:{tenantId:f.tenant.id,kind:'runtime',scopeKey:f.accounts[key].memberId,provider:'openclaw',baseUrl:'http://127.0.0.1:9',secretCiphertext:infrastructureSecret('synthetic-only-runtime'),options:{agentId:'fixture'}}});
    app.getHttpAdapter().getInstance().get('/api/v1/__qa/open/:actor',async(req,res)=>{const actor=f.accounts[req.params.actor];if(!actor)return res.status(404).end();const token=newSessionToken();await db.session.create({data:{userId:actor.userId,tokenHash:tokenHash(token),expiresAt:new Date(Date.now()+3600000)}});res.cookie('suite_session',token,{httpOnly:true,sameSite:'lax',path:'/'});res.redirect('/t/'+f.tenant.slug+'/'+(req.query.app||'erp')+'/ai');});
  }
  await app.listen(process.env.AI_CHAT_QA_KEEP==='1'?4633:0,'127.0.0.1');const base='http://127.0.0.1:'+app.getHttpServer().address().port+'/api/v1',cookies={};
  for(const [key,a]of Object.entries(f.accounts)){const token=newSessionToken();await db.session.create({data:{userId:a.userId,tokenHash:tokenHash(token),expiresAt:new Date(Date.now()+3600000)}});cookies[key]='suite_session='+token;}
  const runtime=app.get(AgentExecutionService);runtime.execute=async()=>{calls++;if(entered)entered();if(held)await held;if(fail)throw new Error('Synthetic provider unavailable');return {text:'隔离测试回答',toolRequests:[]};};
  const req=async(path,method='GET',body,key='admin',status=method==='POST'?201:200)=>{const r=await fetch(base+path,{method,headers:{Origin:'http://127.0.0.1:4601','content-type':'application/json',Cookie:cookies[key]},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(status!==null)eq(r.status,status);return data;};
  const paths=[`/tenants/${f.tenant.slug}/apps/erp/ai`,`/tenants/${g.tenant.slug}/apps/erp/ai`,`/tenants/${f.tenant.slug}/apps/mes/ai`],p=paths[0];
  const quota=(key='admin',path=p)=>req(path+'/chat-quota','GET',undefined,key);
  const conversation=async(path=p,key='admin')=>req(path+'/conversations','POST',{title:'累计额度隔离测试'},key);
  const turn=(path,c,key=randomUUID(),who='admin')=>req(path+'/conversations/'+c.id+'/turns','POST',{content:'隔离测试问题',version:c.version,requestKey:key},who);
  const worker=()=>processNextTask(db,app.get(AuthService),app.get(AiService));
  eq((await quota()).remaining,3);
  let c=await conversation();fail=true;const failure=await req(p+'/conversations/'+c.id+'/messages','POST',{content:'测试失败退额',version:1});eq(failure.failed,true);eq((await quota()).used,0);fail=false;
  c=await conversation();const cancelled=await turn(p,c);eq((await quota()).remaining,2);await req(p+'/tasks/'+cancelled.id+'/cancel','POST',{});eq((await quota()).remaining,3);
  c=await conversation();const requestKey=randomUUID(),first=await turn(p,c,requestKey),repeated=await turn(p,c,requestKey);eq(first.id,repeated.id);eq((await quota()).used,1);
  await req(p+'/conversations/'+c.id+'/turns','POST',{content:'不同内容',version:1,requestKey},'admin',409);await worker();eq((await quota()).used,1);
  const cs=await Promise.all(paths.map(path=>conversation(path)));
  const attempts=await Promise.all(paths.map((path,i)=>req(path+'/conversations/'+cs[i].id+'/turns','POST',{content:'并发跨应用请求',version:1,requestKey:randomUUID()},'admin',null)));
  // req accepts null to record the status separately below.
  eq(attempts.filter(x=>x.id).length,2);eq(attempts.filter(x=>x.error?.code==='AI_CHAT_LIMIT_REACHED'||x.code==='AI_CHAT_LIMIT_REACHED').length,1);eq((await quota()).remaining,0);
  await worker();await worker();eq(calls,4); // one failed call + three successful user turns
  await req(p+'/conversations/'+c.id+'/messages','POST',{content:'旧同步接口不能绕过',version:3},'admin',409);
  for(const path of paths)eq((await quota('admin',path)).remaining,0);
  await req(p+'/conversations/'+c.id,'DELETE');eq((await quota()).remaining,0);
  eq((await app.get(QuotaService).chatSummary({tenantId:f.tenant.id,userId:f.accounts.admin.userId})).used,3);
  // A second account has an independent allowance. Failed authorization after
  // enqueue is terminal and releases the reservation without invoking Runtime.
  const otherPath=`/tenants/${f.tenant.slug}/apps/erp/ai`;
  eq((await quota('buyer')).remaining,3);const buyer=await conversation(otherPath,'buyer'),queued=await turn(otherPath,buyer,randomUUID(),'buyer');
  await db.membership.update({where:{id:f.accounts.buyer.memberId},data:{active:false}});await worker();eq((await db.aiTask.findUnique({where:{id:queued.id}})).status,'failed');
  await db.membership.update({where:{id:f.accounts.buyer.memberId},data:{active:true}});eq((await quota('buyer')).remaining,3);eq(calls,4);
  // A cancelled in-flight model keeps its reservation until execution exits.
  const running=await conversation(otherPath,'buyer'),job=await turn(otherPath,running,randomUUID(),'buyer');let release;held=new Promise(r=>release=r);const started=new Promise(r=>entered=r);const work=worker();await started;entered=null;
  await req(otherPath+'/tasks/'+job.id+'/cancel','POST',{},'buyer');eq((await quota('buyer')).remaining,2);release();await work;held=null;eq((await quota('buyer')).remaining,3);
  // Global gate still rejects model requests when explicitly disabled.
  process.env.NATIVE_AI_MODEL_ENABLED='false';await req(p+'/conversations','POST',{title:'模型关闭'},'buyer',503);process.env.NATIVE_AI_MODEL_ENABLED='true';eq((await quota('buyer')).remaining,3);
  const quotaService=app.get(QuotaService),user=f.accounts.finance.userId;
  const races=await Promise.allSettled(Array.from({length:10},(_,i)=>db.$transaction(tx=>quotaService.reserveChat({tenantId:f.tenant.id,userId:user},'concurrency-'+i,tx))));eq(races.filter(x=>x.status==='fulfilled').length,3);eq((await quotaService.chatSummary({tenantId:f.tenant.id,userId:user})).remaining,0);
  // Persisted storage, rather than any process counter, owns the limit.
  const fresh=new QuotaService(db);eq((await fresh.chatSummary({tenantId:f.tenant.id,userId:f.accounts.admin.userId})).used,3);
  // The same exhausted account can use a custom channel without consuming or
  // resetting the default-channel trial, across sync and durable worker paths.
  const customSettings=`/tenants/${f.tenant.slug}/ai/settings`;
  await req(customSettings,'PUT',{model:'synthetic-custom',baseUrl:'http://127.0.0.1:9',apiKey:'synthetic-custom-key'});
  eq(await quota(),{limit:null,used:0,remaining:null,period:'unlimited'});
  const callsBeforeCustom=calls;
  for(let i=0;i<5;i++){
   const next=await conversation();
   if(i%2===0){const reply=await req(p+'/conversations/'+next.id+'/messages','POST',{content:'自定义渠道同步对话',version:1});eq(reply.failed,false);}
   else{const customTurn=await turn(p,next);await worker();eq((await req(p+'/tasks/'+customTurn.id)).status,'completed');}
  }
  eq(calls,callsBeforeCustom+5);
  const customConversation=await conversation(),customKey=randomUUID(),customTurn=await turn(p,customConversation,customKey);
  eq((await turn(p,customConversation,customKey)).id,customTurn.id);await worker();
  eq((await quota('admin',paths[2])).period,'unlimited');
  eq((await quota('admin',paths[1])).remaining,0);
  eq(await db.aiChatTurn.count({where:{userId:f.accounts.admin.userId,status:{not:'released'}}}),3);
  await req(customSettings,'DELETE');eq((await quota()).remaining,0);
  const restoredDefault=await conversation();await req(p+'/conversations/'+restoredDefault.id+'/messages','POST',{content:'恢复默认后仍受试用限制',version:1},'admin',409);
  const report={at:new Date().toISOString(),assertions:checks,trial:'3 successful turns per account lifetime; all tenants/apps; no history backfill',runtime:'synthetic only',parallelReservations:10,acceptedReservations:3,modelCalls:calls};fs.writeFileSync(process.env.AI_CHAT_QA_REPORT??'../../output/knowledge-rag-20261027/chat-trial.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  if(process.env.AI_CHAT_QA_KEEP==='1'){fs.writeFileSync('../../var/operations/20261027-rag-trial/browser.private.json',JSON.stringify({tenant:f.tenant.slug,userId:f.accounts.admin.userId}));const timer=setInterval(()=>void worker(),1000);console.log('Synthetic QA API retained at 4633');await new Promise(r=>{process.once('SIGTERM',r);process.once('SIGINT',r);});clearInterval(timer);}
 }finally{if(app)await app.close();if(f){await db.aiChatTurn.deleteMany({where:{userId:{in:f.users}}});await db.membership.deleteMany({where:{tenantId:g?.tenant.id,userId:f.accounts.admin.userId}});await cleanupFixture(db,f);}if(g)await cleanupFixture(db,g);await db.$disconnect();}
})().catch(e=>{console.error(e);process.exitCode=1;});
