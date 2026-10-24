const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {createApp}=require('../dist/server'),{PrismaService}=require('../dist/modules/prisma.service'),{AiService}=require('../dist/modules/ai/ai.service'),{AgentExecutionService}=require('../dist/modules/ai/agent.runtime'),{CrmAiProvider}=require('../dist/modules/crm/crm-ai.provider'),{KnowledgeService}=require('../dist/modules/knowledge/knowledge.service'),{createCrmFixture,cleanupFixture}=require('../scripts/crm-fixture.cjs'),{infrastructureSecret}=require('../dist/modules/platform/infrastructure-contract'),{responseReceipt,usageColumns}=require('../dist/modules/ai/runtime-usage'),{TurnReadCache}=require('../dist/modules/ai/turn-read-cache'),{PaidTestBudget}=require('../scripts/paid-test-budget.cjs');
(async()=>{
 assert.match(process.env.DATABASE_URL??'',/127\.0\.0\.1:54329\/suite_phase1_qa/);delete process.env.RUNTIME_MANAGER_SOCKET;delete process.env.AGENT_RUNTIME_PROVIDER;delete process.env.MEMORY_CORE_URL;
 let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
 const parsed=responseReceipt({id:'r',model:'qa-usage-fixture',usage:{input_tokens:100,output_tokens:10,total_tokens:110,input_tokens_details:{cached_tokens:60},output_tokens_details:{reasoning_tokens:7}}});eq(usageColumns(parsed).totalTokens,110);eq(usageColumns(parsed).cachedInputTokens,60);eq(usageColumns({usage:{transportTiming:{}}}).usageStatus,'unknown');eq(usageColumns({usage:{inputTokens:0,outputTokens:0}}).usageStatus,'reported');eq(responseReceipt({model:'openclaw/a'}).model,undefined);
 eq(responseReceipt({status:'completed',usage:{input_tokens:0,output_tokens:0,total_tokens:0}},'openclaw/a').usage,undefined);
 let stamp='v1',loads=0;const cache=new TurnReadCache(),load=async()=>++loads;
 await cache.read('r',{a:1,b:2},async()=>stamp,load);eq((await cache.read('r',{b:2,a:1},async()=>stamp,load)).reused,true);eq(loads,1);stamp='v2';await cache.read('r',{a:1,b:2},async()=>stamp,load);eq(loads,2);await assert.rejects(()=>cache.read('r',{},async()=>{throw Error('revoked');},load));checks++;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'suite-budget-'));try{const b=new PaidTestBudget({maxCalls:2,maxTokens:50,file:path.join(dir,'usage.jsonl')});b.begin();b.record({inputTokens:40,outputTokens:10,totalTokens:50});assert.throws(()=>b.begin(),/BUDGET_STOP/);checks++;eq(JSON.parse(fs.readFileSync(path.join(dir,'usage.jsonl'))).budget.knownTokens,50);const unknown=new PaidTestBudget({maxCalls:2,maxTokens:50});unknown.begin();unknown.record({usageStatus:'unknown'});assert.throws(()=>unknown.begin(),/BUDGET_STOP/);checks++;}finally{fs.rmSync(dir,{recursive:true,force:true});}
 const db=new PrismaService();let app,f,server,mode='repeat',round=0,inputs=[],metricsReads=0,knowledgeReads=0,optionsReads=0;
 try{
  server=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;const p=JSON.parse(raw);inputs.push(p);round++;
   const usage={input_tokens:mode==='large'?30000:100,output_tokens:10,total_tokens:mode==='large'?30010:110,input_tokens_details:{cached_tokens:60},output_tokens_details:{reasoning_tokens:7}};
   let output=((['repeat','invalidate'].includes(mode)&&round<=2)||mode==='large')?[{type:'function_call',name:'crm__metrics',call_id:randomUUID(),arguments:'{}'}]:[{type:'message',content:[{type:'output_text',text:'已查询当前授权事实。'}]}];
   if(mode==='bad-rule'&&round<=2)output=[{type:'function_call',name:'crm__preview_segment',call_id:randomUUID(),arguments:JSON.stringify({rule:{match:'all',currency:'CNY',conditions:[{field:'monetary',op:'gte',value:round===1?1000:'1000.00'}]}})}];
   if(mode==='invalidate'&&round===2)await db.crmSettings.update({where:{tenantId:f.tenant.id},data:{version:{increment:1}}});
   const result={id:'fixture-'+randomUUID(),model:'qa-usage-fixture',status:mode==='incomplete'?'incomplete':'completed',output,...(mode==='missing'?{}:{usage})};
   if(mode==='revoke')await db.membership.update({where:{id:f.accounts.admin.memberId},data:{active:false}});
   if(p.stream){res.setHeader('content-type','text/event-stream');res.end('event: response.'+(mode==='incomplete'?'incomplete':'completed')+'\ndata: '+JSON.stringify({response:result})+'\n\ndata: [DONE]\n\n');}
   else {res.setHeader('content-type','application/json');res.end(JSON.stringify(mode==='invalid'?{...result,output:[]}:result));}
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  app=await createApp();f=await createCrmFixture(db,app);const ctx=f.contexts.admin,ai=app.get(AiService),runtime=app.get(AgentExecutionService),provider=app.get(CrmAiProvider),knowledge=app.get(KnowledgeService),original=provider.execute.bind(provider),opts=provider.options.bind(provider);
  eq(provider.tools['crm.preview_segment'].input.safeParse({rule:{match:'all',currency:'CNY',conditions:[{field:'monetary',op:'gte',value:1000}]}}).success,false);
  eq(provider.tools['crm.preview_segment'].input.safeParse({rule:{match:'all',currency:'CNY',conditions:[{field:'sql',op:'eq',value:'anything'}]}}).success,false);
  eq(provider.tools['crm.preview_segment'].input.safeParse({rule:{match:'all',currency:'CNY',conditions:[{field:'recencyDays',op:'gte',value:-1}]}}).success,false);
  provider.execute=async(c,id,input)=>{if(id==='crm.metrics')metricsReads++;return original(c,id,input);};provider.options=async(...args)=>{optionsReads++;return opts(...args);};knowledge.search=async()=>{knowledgeReads++;return [];};
  await db.infrastructureBinding.create({data:{tenantId:f.tenant.id,kind:'runtime',scopeKey:ctx.membershipId,provider:'openclaw',baseUrl:'http://127.0.0.1:'+server.address().port,secretCiphertext:infrastructureSecret('qa-usage-fixture-only'),options:{agentId:'crm-assistant',fastAgentId:'erp-assistant-fast',ephemeralTurns:true}}});
  async function conversation(){return ai.create(ctx,{title:'用量修复替身验证'});}
  let c=await conversation(),answer=await ai.send(ctx,c.id,{content:'查询最近90天净消费。',version:c.version,allowAction:true,requireConfirmation:true,useMemory:false,thinkingMode:'deep'});
  eq(answer.failed,false);eq(metricsReads,1);eq(round,3);eq(inputs[0].tools.find(t=>t.name==='crm__load_skill').parameters.properties.name.enum.includes('crm-customer-insight'),false);eq(answer.message.process.tools.filter(t=>t.toolId==='crm.load_skill').length,1);
  let ledger=await db.aiModelUsage.findMany({where:{tenantId:f.tenant.id,sessionId:c.id}});eq(ledger.length,3);eq(ledger.reduce((n,r)=>n+r.totalTokens,0),330);eq(ledger.every(r=>r.model==='qa-usage-fixture'&&r.usageStatus==='reported'),true);
  mode='invalidate';round=0;metricsReads=0;c=await conversation();answer=await ai.send(ctx,c.id,{content:'查询最近90天净消费。',version:c.version,allowAction:true,useMemory:false,thinkingMode:'deep'});eq(answer.failed,false);eq(metricsReads,2);
  mode='large';round=0;metricsReads=0;c=await conversation();answer=await ai.send(ctx,c.id,{content:'查询最近90天净消费。',version:c.version,allowAction:true,useMemory:false,thinkingMode:'deep'});eq(answer.failed,true);eq(round,2);eq(metricsReads,1);assert.match(answer.message.content,/用量上限/);checks++;
  mode='bad-rule';round=0;inputs=[];c=await conversation();answer=await ai.send(ctx,c.id,{content:'找净消费至少1000元的客户，请实际预览。',version:c.version,allowAction:true,useMemory:false,thinkingMode:'deep'});eq(answer.failed,false);eq(round,3);eq(JSON.stringify(inputs[1]).includes('INVALID_REQUEST'),true);eq(await db.crmSegmentEvaluation.count({where:{tenantId:f.tenant.id}}),1);
  mode='normal';round=0;inputs=[];optionsReads=0;knowledgeReads=0;c=await conversation();answer=await ai.send(ctx,c.id,{content:'你好',version:c.version,allowAction:true,requireConfirmation:true,useKnowledge:true,useMemory:false,thinkingMode:'auto'});eq(answer.failed,false);eq(optionsReads,0);eq(knowledgeReads,0);eq(inputs[0].tools,[]);eq(inputs[0].model,'openclaw/erp-assistant-fast');
  mode='invalid';c=await conversation();await assert.rejects(()=>runtime.execute({request:ctx,sessionId:c.id},[{role:'user',content:'invalid'}]));checks++;let row=await db.aiModelUsage.findFirst({where:{tenantId:f.tenant.id,sessionId:c.id}});eq(row.status,'failed');eq(row.totalTokens,110);
  mode='incomplete';c=await conversation();await assert.rejects(()=>runtime.execute({request:ctx,sessionId:c.id},[{role:'user',content:'incomplete'}],[],async()=>{}));checks++;row=await db.aiModelUsage.findFirst({where:{tenantId:f.tenant.id,sessionId:c.id}});eq(row.status,'failed');eq(row.totalTokens,110);
  mode='missing';c=await conversation();await runtime.execute({request:ctx,sessionId:c.id},[{role:'user',content:'missing'}]);row=await db.aiModelUsage.findFirst({where:{tenantId:f.tenant.id,sessionId:c.id}});eq(row.usageStatus,'unknown');eq(row.totalTokens,null);
  // A model response was paid for, but delivery is rejected after permission revocation.
  mode='revoke';c=await conversation();await assert.rejects(()=>runtime.execute({request:ctx,sessionId:c.id},[{role:'user',content:'revocation'}]));checks++;
  row=await db.aiModelUsage.findFirst({where:{tenantId:f.tenant.id,sessionId:c.id}});eq(row.status,'failed');eq(row.totalTokens,110);await db.membership.update({where:{id:ctx.membershipId},data:{active:true}});
 }finally{
  if(app)await app.close();if(server)await new Promise(r=>server.close(r));
  if(f){const count=await db.aiModelUsage.count({where:{tenantId:f.tenant.id}});await db.usageRecord.deleteMany({where:{tenantId:f.tenant.id}});await cleanupFixture(db,f);eq(await db.aiModelUsage.count({where:{tenantId:f.tenant.id}}),count);}
  await db.$disconnect();
 }
 console.log(JSON.stringify({ok:true,checks,model:'synthetic HTTP fixture; no paid model calls'}));
})().catch(e=>{console.error(e);process.exitCode=1;});
