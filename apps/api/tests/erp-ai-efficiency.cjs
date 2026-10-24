// Real application + isolated PostgreSQL + local model HTTP fixture. No paid model.
const assert=require('node:assert/strict'),http=require('node:http'),{randomUUID}=require('node:crypto');
const {createApp}=require('../dist/server'),{PrismaService}=require('../dist/modules/prisma.service'),{AuthService}=require('../dist/modules/platform/auth.service'),{AiService}=require('../dist/modules/ai/ai.service'),{AgentExecutionService}=require('../dist/modules/ai/agent.runtime'),{ModelGateway}=require('../dist/modules/ai/model.gateway'),{ErpAiProvider}=require('../dist/modules/erp/erp-ai.provider'),{ReplenishmentService}=require('../dist/modules/erp/replenishment.service'),{infrastructureSecret}=require('../dist/modules/platform/infrastructure-contract'),{createFixture,fixtureHttp,cleanupFixture}=require('../scripts/workflow-fixture.cjs');
(async()=>{
 assert.match(process.env.DATABASE_URL??'',/^postgresql:\/\/[^@]+@127\.0\.0\.1:54329\/suite_phase1_qa(?:\?|$)/);
 process.env.NODE_ENV='test';delete process.env.RUNTIME_MANAGER_SOCKET;delete process.env.AGENT_RUNTIME_PROVIDER;delete process.env.MEMORY_CORE_URL;
 const db=new PrismaService();let app,f,server,mode='text',inputs=[],afterResponse;let checks=0,stockReads=0,physicalRequests=0;
 const eq=(a,b)=>{assert.deepEqual(a,b);checks++;},ok=a=>{assert.ok(a);checks++;};
 try{
  server=http.createServer(async(req,res)=>{
   let raw='';for await(const b of req)raw+=b;const p=JSON.parse(raw);inputs.push(p);physicalRequests++;
   let text='仅依据当前提供的事实回答。',output;
   if(mode==='extract')text=JSON.stringify({partyCode:'SUP-AI',lines:[{sku:'SKU-AI',quantity:2}]});
   if(mode==='bad-extract')text='invalid JSON';
   if(mode==='review')text=JSON.stringify({summary:'当前单据仍需人工核对履约。',actions:['核对供应商交期'],missing_data:['交期']});
   if(mode==='draft'||mode==='unexpected-write')output=[{type:'function_call',name:'erp__purchase__create_draft',call_id:randomUUID(),arguments:JSON.stringify({supplierId:supplier.id,lines:[{productId:product.id,quantity:2}]})}];
   else output=[{type:'message',content:[{type:'output_text',text}]}];
   if(afterResponse){const run=afterResponse;afterResponse=null;await run();}
   res.setHeader('content-type','application/json');res.end(JSON.stringify({id:randomUUID(),model:'erp-local-usage-fixture',status:'completed',usage:{input_tokens:100,output_tokens:10,total_tokens:110},output}));
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  app=await createApp();f=await createFixture(db,'erp-flow-test-'+randomUUID().slice(0,8));
  await db.tenantCapability.create({data:{tenantId:f.tenant.id,capability:'ai',delivered:true,enabled:true}});
  const h=await fixtureHttp(app,f),auth=app.get(AuthService),ai=app.get(AiService),provider=app.get(ErpAiProvider),runtime=app.get(AgentExecutionService),gateway=app.get(ModelGateway),replenishment=app.get(ReplenishmentService);
  const ctx=await auth.taskContext({tenantId:f.tenant.id,userId:f.accounts.admin.userId,membershipId:f.accounts.admin.memberId,appId:'erp',taskId:randomUUID()});
  const supplier=await h.post('/suppliers',{code:'SUP-AI',name:'SUPPLIER_PRIVATE_SENTINEL'});
  const product=await h.post('/products',{sku:'SKU-AI',name:'PRODUCT_PRIVATE_SENTINEL',salePrice:'20',purchasePrice:'10',reorderPoint:5});
  const customer=await h.post('/customers',{code:'CUS-AI',name:'AI客户'});
  const purchase=await h.post('/purchases',{number:'AI-EFF-PO',supplierId:supplier.id,lines:[{productId:product.id,quantity:2}]});
  const contract=await h.post('/contracts',{number:'AI-EFF-SO',customerId:customer.id,lines:[{productId:product.id,quantity:2}]});
  // Bind only to a loopback fixture. Never read real model credentials.
  await db.infrastructureBinding.create({data:{tenantId:f.tenant.id,kind:'runtime',scopeKey:ctx.membershipId,provider:'openclaw',baseUrl:'http://127.0.0.1:'+server.address().port,secretCiphertext:infrastructureSecret('erp-local-fixture-only'),options:{agentId:'erp-assistant',fastAgentId:'erp-assistant-fast',readAgentId:'erp-assistant-read',ephemeralTurns:true}}});
  const originalStock=replenishment.facts.bind(replenishment);replenishment.facts=async(...args)=>{stockReads++;return originalStock(...args);};
  const originalFacts=provider.resourceFacts.bind(provider);
  eq(provider.selectTools('请审核采购单'),['erp.purchase.confirm']);eq(provider.selectTools('帮我建一个采购单'),['erp.purchase.create_draft']);eq(provider.selectTools('不创建采购草稿，只给方案'),[]);
  async function turn(content,extra={},resource){inputs=[];const c=await ai.create(ctx,{title:'ERP AI用量检查',...(resource?{resource}:{})});const r=await ai.send(ctx,c.id,{content,version:c.version,allowAction:true,requireConfirmation:true,useMemory:false,thinkingMode:'auto',...extra});return {c,r,p:inputs.at(-1)};}
  let t=await turn('分析采购风险');eq(t.r.failed,false);eq(t.p.tools,[]);ok(!JSON.stringify(t.p).includes('SUPPLIER_PRIVATE_SENTINEL'));ok(!JSON.stringify(t.p).includes('PRODUCT_PRIVATE_SENTINEL'));eq(stockReads,0);
  t=await turn('你好');eq(t.r.failed,false);eq(t.p.tools,[]);eq(stockReads,0);
  t=await turn('如何创建采购草稿');eq(t.p.tools,[]);eq(stockReads,0);
  t=await turn('不要创建采购草稿，只分析风险');eq(t.p.tools,[]);eq(stockReads,0);
  t=await turn('请创建客户，编号C2名称测试客户');eq(t.p.tools.map(x=>x.name),['erp__customer__create']);ok(!JSON.stringify(t.p).includes('SUPPLIER_PRIVATE_SENTINEL'));eq(stockReads,0);
  t=await turn('请创建商机');eq(t.p.tools.map(x=>x.name),['erp__opportunity__create']);ok(JSON.stringify(t.p).includes(customer.id));eq(stockReads,0);
  t=await turn('请分析补货建议',{allowAction:false});eq(t.p.tools,[]);ok(JSON.stringify(t.p).includes('snapshotHash'));eq(stockReads,1);
  t=await turn('请创建补货计划',{}, {type:'inventory'});eq(stockReads,1);eq(t.p.tools.map(x=>x.name),['erp__workflow__create_replenishment_plan']);eq((JSON.stringify(t.p).match(/PRODUCT_PRIVATE_SENTINEL/g)||[]).length,1);
  const noStock={...ctx,permissions:ctx.permissions.filter(x=>x!=='erp.inventory.read')};
  const restricted=JSON.parse((await provider.resourceFacts(noStock,'contract',contract.id)).text);ok(!('available'in restricted.facts[0]));ok(!('balanceVersion'in restricted.facts[0]));ok(restricted.facts[0].inventoryStatus.includes('无库存'));
  eq(provider.canUse(noStock,'erp.workflow.create_replenishment_plan'),false);
  const full=JSON.parse((await provider.resourceFacts(ctx,'contract',contract.id)).text);eq(full.facts[0].available,0);
  // Scope receipts invalidate prior replies after role/permission changes.
  t=await turn('分析合同履约风险',{}, {type:'contract',id:contract.id});ok(t.r.message.sources.some(x=>x.type.startsWith('scope_')));
  await db.membership.update({where:{id:ctx.membershipId},data:{role:'sales'}});
  const hidden=await ai.get(ctx,t.c.id);ok(hidden.messages.at(-1).content.includes('不可访问'));
  await db.membership.update({where:{id:ctx.membershipId},data:{role:'admin'}});
  // Partial reference lists must be explicit and cannot expand beyond 50.
  await db.erpSupplier.createMany({data:Array.from({length:51},(_,i)=>({tenantId:f.tenant.id,code:'ZZ'+i.toString().padStart(2,'0'),name:'额外候选'}))});
  const opts=await provider.options(ctx,'请创建采购草稿');eq(opts.suppliers.length,50);eq(opts.suppliersTruncated,true);eq(opts.replenishment,undefined);
  mode='draft';const before=await db.erpPurchaseOrder.count({where:{tenantId:ctx.tenantId}});t=await turn('请创建采购草稿');eq(t.r.failed,false);const action=await db.aiAction.findUnique({where:{id:t.r.message.actionId}});eq(action.status,'pending');eq(await db.erpPurchaseOrder.count({where:{tenantId:ctx.tenantId}}),before);eq(inputs.length,1);
  mode='unexpected-write';t=await turn('分析采购风险');eq(t.r.failed,true);eq(await db.aiAction.count({where:{conversationId:t.c.id}}),0);eq(inputs.length,1);
  // A stale analysis cannot be presented as current; its paid-equivalent receipt survives.
  mode='text';afterResponse=()=>db.erpPurchaseOrder.update({where:{id:purchase.id},data:{version:{increment:1}}});
  await assert.rejects(()=>ai.analyze(ctx,{type:'purchase',id:purchase.id,question:'分析风险'}),/业务数据已更新/);checks++;
  const analysis=await ai.analyze(ctx,{type:'purchase',id:purchase.id,question:'分析风险'});eq(analysis.status,'suggestion');ok(analysis.sources.some(x=>x.type.startsWith('scope_')));
  const callCount=inputs.length;
  provider.resourceFacts=async(c,type,id)=>type==='purchase'?{text:'业'.repeat(25000)}:originalFacts(c,type,id);
  await assert.rejects(()=>ai.analyze(ctx,{type:'purchase',id:purchase.id,question:'分析风险'}),/输入超过/);checks++;
  provider.resourceFacts=async(c,type,id)=>type==='purchase'?{text:'业'.repeat(25000),facts:[]}:originalFacts(c,type,id);
  await assert.rejects(()=>ai.review(ctx,{type:'purchase',id:purchase.id}),/输入超过/);checks++;
  await assert.rejects(()=>runtime.complete({request:ctx,sessionId:'oversize'},[{role:'user',content:'业'.repeat(25000)}]),/输入超过/);checks++;
  await assert.rejects(()=>gateway.complete(ctx,[{role:'user',content:'业'.repeat(25000)}]),/输入超过/);checks++;eq(inputs.length,callCount);provider.resourceFacts=originalFacts;
  mode='extract';const extracted=await ai.extract(ctx,{kind:'purchase',text:'请向SUP-AI采购SKU-AI，共计2件。'});eq(extracted.requiresReview,true);eq(extracted.missingReferences,[]);eq(extracted.draft.lines[0].product.id,product.id);eq(await db.erpPurchaseOrder.count({where:{tenantId:ctx.tenantId}}),before);
  mode='bad-extract';await assert.rejects(()=>ai.extract(ctx,{kind:'purchase',text:'请向SUP-AI采购SKU-AI，共计2件。'}),/不是有效 JSON/);checks++;
  mode='review';const review=await ai.review(ctx,{type:'purchase',id:purchase.id});eq(review.review.facts.length,1);
  const beforeRead=physicalRequests;eq((await ai.latestReview(ctx,'purchase',purchase.id)).review.summary,review.review.summary);eq(physicalRequests,beforeRead);
  mode='text';afterResponse=()=>db.aiExecution.updateMany({where:{tenantId:ctx.tenantId,status:'running'},data:{status:'cancelled'}});
  await assert.rejects(()=>runtime.execute({request:ctx,sessionId:'cancel-receipt'},[{role:'user',content:'取消同时返回用量'}]),/取消/);checks++;
  const cancelled=await db.aiModelUsage.findFirst({where:{tenantId:ctx.tenantId,sessionId:'cancel-receipt'}});eq(cancelled.status,'cancelled');eq(cancelled.totalTokens,110);
  const usage=await db.aiModelUsage.findMany({where:{tenantId:ctx.tenantId}});eq(usage.length,physicalRequests);eq(usage.every(x=>x.usageStatus==='reported'&&x.totalTokens===110),true);
  for(const purpose of ['analysis','risk_review','document_extract','reply'])ok(usage.some(x=>x.purpose===purpose));
  const report=JSON.parse(require('node:child_process').execFileSync(process.execPath,[require('node:path').resolve(__dirname,'../scripts/report-model-usage.cjs'),'--since=2000-01-01','--tenant='+ctx.tenantId,'--app=erp','--purpose=document_extract'],{encoding:'utf8',env:process.env}));eq(report.knownTotalTokens,220);eq(report.groups.every(x=>x.appId==='erp'&&x.purpose==='document_extract'),true);
  eq(await db.aiAction.count({where:{tenantId:ctx.tenantId}}),1);
 }finally{
  if(app)await app.close();if(server)await new Promise(r=>server.close(r));
  if(f){const rows=await db.aiModelUsage.count({where:{tenantId:f.tenant.id}});await db.usageRecord.deleteMany({where:{tenantId:f.tenant.id}});await cleanupFixture(db,f);eq(await db.aiModelUsage.count({where:{tenantId:f.tenant.id}}),rows);}
  await db.$disconnect();
 }
 console.log(JSON.stringify({ok:true,checks,model:'local HTTP fixture',paidModelCalls:0}));
})().catch(e=>{console.error(e);process.exitCode=1;});
