const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),{randomUUID}=require('node:crypto');
const{createApp}=require('../dist/server'),{PrismaService}=require('../dist/modules/prisma.service'),{processNextTask,prepareMemberGateways}=require('../dist/worker'),{AuthService}=require('../dist/modules/platform/auth.service'),{AiService}=require('../dist/modules/ai/ai.service'),{ManagedRuntimeService}=require('../dist/modules/ai/managed-runtime.service'),{createFixture,fixtureHttp,cleanupFixture}=require('../scripts/workflow-fixture.cjs');
(async()=>{
 if(!/^postgresql:\/\/[^@]+@127\.0\.0\.1:54329\/suite_phase1_qa(?:\?|$)/.test(process.env.DATABASE_URL??''))throw Error('Dedicated isolation DB required');
 process.env.NODE_ENV='test';delete process.env.AGENT_RUNTIME_PROVIDER;
 const socket='/tmp/suite-runtime-qa-'+randomUUID()+'.sock';process.env.RUNTIME_MANAGER_SOCKET=socket;
 const db=new PrismaService();let app,other,f,g,manager,model,modelCalls=0,mode='ready',delay=0,planInput,lastModelInput,lastSessionKey;
 let count=0;const eq=(a,b)=>{assert.deepEqual(a,b);count++;},ok=v=>{assert.ok(v);count++;};const leases=new Map(),provisioned=new Set(),prepared=new Map();
 const wait=async(fn)=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out');};
 try{
  f=await createFixture(db,'erp-flow-test-'+randomUUID().slice(0,8));g=await createFixture(db,'erp-flow-test-'+randomUUID().slice(0,8));
  await db.tenantCapability.createMany({data:[f,g].flatMap(x=>['ai','knowledge'].map(capability=>({tenantId:x.tenant.id,capability,delivered:true,enabled:true})))});
  model=http.createServer(async(req,res)=>{res.setHeader('content-type','application/json');let raw='';for await(const c of req)raw+=c;
   if(req.url==='/readyz'){res.end('{}');return;}if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:'openclaw/erp-assistant'}]}));return;}
   modelCalls++;const input=JSON.parse(raw);lastModelInput=input;lastSessionKey=req.headers['x-openclaw-session-key'];
   const request=input.input.at(-1).content[0].text;
   const plan=request.includes('补货');const purchase=request.includes('采购草稿');
   const final={id:randomUUID(),status:'completed',output:plan||purchase?[{type:'function_call',name:plan?'erp__workflow__create_replenishment_plan':'erp__purchase__create_draft',call_id:randomUUID(),arguments:JSON.stringify(plan?planInput:{supplierId:planInput.supplierId,lines:planInput.lines.map(line=>({productId:line.productId,quantity:line.quantity}))})}]:[{type:'message',content:[{type:'output_text',text:request.includes('假预览')?'这是待确认的采购草稿操作预览，请回复确认创建。':'已核对当前记录。'}]}]};
   if(input.stream){
    res.setHeader('content-type','text/event-stream');
    res.write('event: response.reasoning_summary_text.delta\ndata: '+JSON.stringify({delta:'PRIVATE_REASONING_SENTINEL'})+'\n\n');
    res.write('event: response.output_item.added\ndata: '+JSON.stringify({item:{type:'function_call',name:'native__fs_read',call_id:'hidden-native',arguments:'PRIVATE_TOOL_SENTINEL'}})+'\n\n');
    if(plan||purchase)res.write('event: response.output_item.added\ndata: '+JSON.stringify({item:final.output[0]})+'\n\n');
    res.write('event: response.output_text.delta\ndata: '+JSON.stringify({delta:'已核对'})+'\n\n');
    if(delay)await new Promise(r=>setTimeout(r,delay));
    res.write('event: response.output_text.delta\ndata: '+JSON.stringify({delta:'当前记录。'})+'\n\n');
    res.write('event: response.completed\ndata: '+JSON.stringify({response:final})+'\n\n');
    res.end('data: [DONE]\n\n');return;
   }
   if(delay)await new Promise(r=>setTimeout(r,delay));res.end(JSON.stringify(final));
  });await new Promise(r=>model.listen(0,'127.0.0.1',r));const endpoint='http://127.0.0.1:'+model.address().port;
  manager=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;const b=JSON.parse(raw);res.setHeader('content-type','application/json');
   if(req.url==='/list')res.end(JSON.stringify({members:[...prepared].map(([membershipId,tenantId])=>({membershipId,tenantId,warm:true}))}));
   else if(req.url==='/prepare'){prepared.set(b.membershipId,b.tenantId);provisioned.add(b.membershipId);res.end(JSON.stringify({state:'preparing'}));}
   else if(req.url==='/unprepare'){prepared.delete(b.membershipId);res.end(JSON.stringify({state:'suspended'}));}
   else if(req.url==='/status')res.end(JSON.stringify({available:true,state:provisioned.has(b.membershipId)?'suspended':'unprovisioned'}));
   else if(req.url==='/release'){leases.delete(b.leaseId);res.end('{}');}
   else{leases.set(b.leaseId,b.membershipId);provisioned.add(b.membershipId);res.end(JSON.stringify(mode==='ready'?{state:'ready',baseUrl:endpoint,secret:'isolated-runtime-token',agentId:'erp-assistant',fastAgentId:'erp-assistant-fast',readAgentId:'erp-assistant-read',ephemeralTurns:true}:{state:mode}));}
  });await new Promise(r=>manager.listen(socket,r));app=await createApp();const h=await fixtureHttp(app,f),base='/tenants/'+f.tenant.slug+'/ai';
  await prepareMemberGateways(db,app.get(AuthService),app.get(ManagedRuntimeService));
  ok(prepared.has(f.accounts.buyer.memberId));
  await db.tenantCapability.update({where:{tenantId_capability:{tenantId:f.tenant.id,capability:'ai'}},data:{enabled:false}});
  await prepareMemberGateways(db,app.get(AuthService),app.get(ManagedRuntimeService));
  ok(!prepared.has(f.accounts.buyer.memberId));
  await db.tenantCapability.update({where:{tenantId_capability:{tenantId:f.tenant.id,capability:'ai'}},data:{enabled:true}});
  // Per-member uniqueness remains enforced; mock uses a distinct endpoint only for buyer.
  const c=(await h.request(base+'/conversations','POST',{title:'后台消息测试'},'buyer')).data;
  const body={content:'检查记录',version:1,requestKey:randomUUID(),allowAction:false,useKnowledge:false};
  const queued=(await h.request(base+'/conversations/'+c.id+'/turns','POST',body,'buyer')).data;
  eq((await h.request(base+'/conversations/'+c.id+'/turns','POST',body,'buyer')).data.id,queued.id);
  await h.request(base+'/conversations/'+c.id+'/turns','POST',{...body,content:'其他请求'},'buyer',409);
  const pending=(await h.request(base+'/conversations/'+c.id,'GET',undefined,'buyer')).data;eq(pending.messages.at(-1).content,body.content);eq(pending.activeTask.id,queued.id);
  await h.request(base+'/conversations/'+c.id,'GET',undefined,'sales',404);
  await h.request(base+'/tasks/'+queued.id,'GET',undefined,'sales',404);
  const liveUrl=`http://127.0.0.1:${app.getHttpServer().address().port}/api/v1${base}/tasks/${queued.id}/events`;
  eq((await fetch(liveUrl,{headers:{Cookie:h.cookies.sales}})).status,404);
  const live=await fetch(liveUrl,{headers:{Cookie:h.cookies.buyer}});eq(live.status,200);
  const liveEvents=live.text();
  const tick=()=>processNextTask(db,app.get(AuthService),app.get(AiService));delay=800;
  const first=tick();await wait(async()=>Boolean((await db.aiTask.findUnique({where:{id:queued.id}}))?.result?.partialText));
  eq((await h.request(base+'/tasks/'+queued.id,'GET',undefined,'buyer')).data.result.partialText,'已核对');
  ok((await h.request(base+'/tasks/'+queued.id,'GET',undefined,'buyer')).data.result.firstReadableMs>=0);
  eq((await h.request(base+'/tasks/'+queued.id,'GET',undefined,'buyer')).data.result.progress.mode,'fast');
  ok((await h.request(base+'/tasks/'+queued.id,'GET',undefined,'buyer')).data.result.progress.steps.some(s=>s.stage==='model_processing'));
  ok((await h.request(base+'/tasks/'+queued.id,'GET',undefined,'buyer')).data.result.progress.steps.some(s=>s.stage==='generating_answer'));
  await h.request(base+'/tasks/'+queued.id,'GET',undefined,'sales',404);
  await first;delay=0;const streamed=await liveEvents;ok(streamed.includes('已核对'));ok(streamed.includes('generating_answer'));
  const terminalPayload=streamed.split('\n').filter(line=>line.startsWith('data:')).map(line=>JSON.parse(line.slice(5))).find(value=>value.status==='completed');
  eq(terminalPayload.result.message.role,'assistant');eq(terminalPayload.result.version,3);
  eq(terminalPayload.text,terminalPayload.result.message.content);eq(terminalPayload.progress.status,'completed');
  ok(!JSON.stringify(terminalPayload).includes('PRIVATE_'));
  eq((await db.aiTask.findUnique({where:{id:queued.id}})).status,'completed');eq(modelCalls,1);eq(leases.size,0);
  const firstTiming=(await db.aiExecution.findFirst({where:{requestId:'task:'+queued.id}})).usage.timing;
  ok(firstTiming.firstDeltaMs>=firstTiming.runtimeWaitMs);ok(firstTiming.totalMs>=firstTiming.firstDeltaMs);
  ok(/^agent:erp-assistant-fast:dashboard:incognito-[a-f0-9-]{36}$/.test(lastSessionKey));
  eq(lastModelInput.tool_choice,'none');eq(lastModelInput.tools,[]);
  const transport=(await db.aiExecution.findFirst({where:{requestId:'task:'+queued.id}})).usage.transportTiming;
  ok(transport.gatewayFirstDeltaMs>=transport.gatewayHeadersMs);
  const done=(await h.request(base+'/conversations/'+c.id,'GET',undefined,'buyer')).data;eq(done.messages.map(m=>m.role),['user','assistant']);eq(done.activeTask,null);
  eq(done.messages.at(-1).process.mode,'fast');eq(done.messages.at(-1).process.status,'completed');eq(done.messages.at(-1).process.tools,[]);ok(done.messages.at(-1).process.steps.every(step=>step.summary&&step.status==='completed'&&step.durationMs>=0));ok(!JSON.stringify(done).includes('PRIVATE_')); ok(done.messages.at(-1).process.steps.some(s=>s.stage==='saving_reply'));
  eq(await db.infrastructureBinding.count({where:{tenantId:f.tenant.id,kind:'runtime',scopeKey:f.accounts.buyer.memberId}}),1);
  const analysis=(await h.request(base+'/conversations','POST',{title:'只读深入分析'},'buyer')).data;
  const readOnly=(await h.request(base+'/conversations/'+analysis.id+'/turns','POST',{...body,content:'请详细分析库存周转',thinkingMode:'deep',requestKey:randomUUID()},'buyer')).data;
  await tick();eq((await db.aiTask.findUnique({where:{id:readOnly.id}})).status,'completed');
  ok(!lastModelInput.tools.some(tool=>tool.name?.startsWith('erp__')));
  eq(lastModelInput.model,'openclaw/erp-assistant-read');eq(lastModelInput.tool_choice,'none');eq(lastModelInput.tools,[]);
  eq((await db.aiExecution.findFirst({where:{requestId:'task:'+readOnly.id}})).usage.thinkingMode,'deep');
  const fake=(await h.request(base+'/conversations','POST',{title:'模型假预览防护'},'buyer')).data;
  const fakeTask=(await h.request(base+'/conversations/'+fake.id+'/turns','POST',{...body,content:'请生成假预览',allowAction:true,requestKey:randomUUID()},'buyer')).data;
  await tick();eq((await db.aiTask.findUnique({where:{id:fakeTask.id}})).status,'completed');
  const fakeAnswer=(await h.request(base+'/conversations/'+fake.id,'GET',undefined,'buyer')).data.messages.at(-1);
  ok(fakeAnswer.content.includes('未生成可确认的业务操作'));ok(!fakeAnswer.actionId);eq((await h.request(base+'/conversations/'+fake.id+'/actions','GET',undefined,'buyer')).data.length,0);
  const feed=(await h.request('/tenants/'+f.tenant.slug+'/notifications','GET',undefined,'buyer')).data;ok(feed.items.some(n=>n.kind==='conversation'&&n.resourceId===c.id));
  const notice=feed.items.find(n=>n.kind==='conversation');await h.request('/tenants/'+f.tenant.slug+'/notifications/'+notice.id+'/read','POST',{},'sales',404);await h.request('/tenants/'+f.tenant.slug+'/notifications/'+notice.id+'/read','POST',{},'buyer');
  // Recovery after a crash between conversation commit and task commit never repeats the model.
  await db.aiTask.update({where:{id:queued.id},data:{status:'queued'}});await tick();eq(modelCalls,3);eq(await db.personalNotification.count({where:{tenantId:f.tenant.id,dedupeKey:'ai:'+queued.id}}),1);
  const c2=(await h.request(base+'/conversations','POST',{title:'排队取消'},'buyer')).data;
  const q2=(await h.request(base+'/conversations/'+c2.id+'/turns','POST',{...body,version:1,requestKey:randomUUID()},'buyer')).data;
  await h.request(base+'/tasks/'+q2.id+'/cancel','POST',{},'buyer');await tick();eq(modelCalls,3);eq((await h.request(base+'/conversations/'+c2.id,'GET',undefined,'buyer')).data.messages.at(-1).role,'assistant');
  // Cross-process cancellation: separate Nest app has no controller from the worker app.
  other=await createApp();const h2=await fixtureHttp(other,f);delay=2500;
  const q3=(await h.request(base+'/conversations/'+c.id+'/turns','POST',{...body,version:done.version,requestKey:randomUUID()},'buyer')).data;
  const running=tick();await wait(async()=>Boolean(await db.aiExecution.findFirst({where:{requestId:'task:'+q3.id,status:'running'}})));
  await h2.request(base+'/tasks/'+q3.id+'/cancel','POST',{},'buyer');await running;eq((await db.aiTask.findUnique({where:{id:q3.id}})).status,'cancelled');eq(leases.size,0);delay=0;
  const stoppedRecord=(await h.request(base+'/conversations/'+c.id,'GET',undefined,'buyer')).data.messages.at(-1).process;eq(stoppedRecord.status,'cancelled');ok(stoppedRecord.steps.some(step=>step.status==='cancelled')); 
  // Queue and boot states survive refresh, and long waits aren't mistaken for abandoned turns.
  const c3=(await h.request(base+'/conversations','POST',{title:'运行资源排队'},'buyer')).data;
  const q4=(await h.request(base+'/conversations/'+c3.id+'/turns','POST',{...body,requestKey:randomUUID()},'buyer')).data;mode='queued';const waiting=tick();
  await wait(async()=>Boolean(await db.aiExecution.findFirst({where:{requestId:'task:'+q4.id,status:'queued'}})));
  await db.aiConversation.update({where:{id:c3.id},data:{updatedAt:new Date(Date.now()-180000)}});
  eq((await h.request(base+'/conversations/'+c3.id,'GET',undefined,'buyer')).data.activeTask.id,q4.id);mode='preparing';
  await wait(async()=>Boolean(await db.aiExecution.findFirst({where:{requestId:'task:'+q4.id,status:'preparing'}})));mode='ready';await waiting;eq((await db.aiTask.findUnique({where:{id:q4.id}})).status,'completed');
  // Failure is terminal, releases resources, and does not create a business operation.
  mode='failed';const c4=(await h.request(base+'/conversations','POST',{title:'启动失败'},'buyer')).data;
  const q5=(await h.request(base+'/conversations/'+c4.id+'/turns','POST',{...body,requestKey:randomUUID()},'buyer')).data;await tick();eq((await db.aiTask.findUnique({where:{id:q5.id}})).status,'failed');eq(leases.size,0);eq((await h.request(base+'/conversations/'+c4.id,'GET',undefined,'buyer')).data.messages.at(-1).process.status,'failed');mode='ready';
  // Structured preview + exact task destination, both authorized in the owning app.
  const supplier=await h.post('/suppliers',{code:'UX-'+randomUUID().slice(0,6),name:'体验测试供应商'},'buyer');
  const product=await h.post('/products',{sku:'UX-'+randomUUID().slice(0,6),name:'体验测试商品',unit:'箱',salePrice:'10.00',purchasePrice:'8.00',reorderPoint:8},'buyer');
  const row=(await h.get('/replenishment','buyer')).items.find(p=>p.productId===product.id);planInput={number:'UX-'+randomUUID().slice(0,8),supplierId:supplier.id,lines:[{productId:product.id,quantity:row.suggestedQty,snapshotHash:row.snapshotHash}]};
  const c5=(await h.request(base+'/conversations','POST',{title:'补货计划'},'buyer')).data;
  const q6=(await h.request(base+'/conversations/'+c5.id+'/turns','POST',{...body,content:'请创建补货计划',allowAction:true,requestKey:randomUUID()},'buyer')).data;await tick();const latest=(await h.request(base+'/conversations/'+c5.id,'GET',undefined,'buyer')).data;
  ok(lastModelInput.tools.some(tool=>tool.name==='erp__workflow__create_replenishment_plan'));
  const actionId=latest.messages.at(-1).actionId;ok(actionId);const action=(await h.request(base+'/actions/'+actionId,'GET',undefined,'buyer')).data;eq(action.presentation.parameters['供应商'],supplier.code+' · '+supplier.name);ok(action.presentation.parameters['商品与数量'][0].includes('箱'));
  ok(latest.messages.at(-1).process.steps.some(s=>s.stage==='preparing_action'));
  const pendingTool=latest.messages.at(-1).process.tools.find(tool=>tool.kind==='operation');eq(pendingTool.status,'pending');eq(pendingTool.actionId,actionId);ok(pendingTool.parameters['供应商'].includes(supplier.code));ok(pendingTool.durationMs>=0);ok(!JSON.stringify(latest).includes('PRIVATE_'));
  const confirmed=(await h.request(base+'/actions/'+actionId+'/confirm','POST',{previewHash:action.previewHash},'buyer')).data;const shown=(await h.request(base+'/actions/'+actionId,'GET',undefined,'buyer')).data;eq(shown.presentation.destination,'/tasks?task='+confirmed.result.id);eq(shown.presentation.receipt['当前状态'],'待确认计划');
  const completedTool=(await h.request(base+'/conversations/'+c5.id,'GET',undefined,'buyer')).data.messages.at(-1).process.tools.find(tool=>tool.actionId===actionId);eq(completedTool.status,'completed');eq(completedTool.receipt['当前状态'],'待确认计划');
  await h.request('/tenants/'+f.tenant.slug+'/tasks/'+confirmed.result.id,'GET',undefined,'sales',404);
  const callsBeforeRecovery=modelCalls;
  await db.aiConversation.update({where:{id:c5.id},data:{messages:latest.messages.slice(0,-1),version:2}});await db.aiTask.update({where:{id:q6.id},data:{status:'queued'}});await tick();eq(modelCalls,callsBeforeRecovery);eq((await h.request(base+'/conversations/'+c5.id,'GET',undefined,'buyer')).data.messages.at(-1).actionId,actionId);eq(await db.businessTask.count({where:{tenantId:f.tenant.id}}),1);
  const binding=await db.infrastructureBinding.findFirst({where:{tenantId:f.tenant.id,scopeKey:f.accounts.buyer.memberId}});await db.infrastructureBinding.update({where:{id:binding.id},data:{enabled:false}});eq((await h.request('/tenants/'+f.tenant.slug+'/service-status','GET',undefined,'buyer')).data.ai.configured,false);await db.infrastructureBinding.update({where:{id:binding.id},data:{enabled:true}});eq((await h.request('/tenants/'+f.tenant.slug+'/service-status','GET',undefined,'buyer')).data.ai.configured,true);
  eq((await h.request(base+'/tasks','GET',undefined,'buyer')).data.length,0);
  const ownCustomer=await h.post('/customers',{code:'UX-C-'+randomUUID().slice(0,6),name:'上下文测试客户'},'sales');
  eq((await h.get('/customers?id='+ownCustomer.id,'sales')).items.map(x=>x.id),[ownCustomer.id]);eq((await h.get('/customers?id='+randomUUID(),'sales')).total,0);
  const pay=await db.erpPayable.create({data:{tenantId:f.tenant.id,supplierId:supplier.id,openingReference:'UX-OPEN',amount:'5.00'}});eq((await h.get('/finance/payables?id='+pay.id,'finance')).items.map(x=>x.id),[pay.id]);eq((await h.get('/finance/payables?id='+randomUUID(),'finance')).total,0);
  const scoped=(await h.request(base+'/conversations','POST',{title:'客户分析',resource:{type:'customer',id:ownCustomer.id}},'sales')).data;ok(scoped.title.includes(ownCustomer.name));await db.erpCustomer.update({where:{id:ownCustomer.id},data:{ownerMembershipId:f.accounts.admin.memberId}});await h.request(base+'/conversations/'+scoped.id,'GET',undefined,'sales',404);

  // Two independent conversations for one member can occupy separate worker
  // lanes and Gateway sessions without sharing their conversation state.
  delay=1200;
  const parallel=[];
  for(const title of ['并发会话甲','并发会话乙']){
   const conversation=(await h.request(base+'/conversations','POST',{title},'buyer')).data;
   const job=(await h.request(base+'/conversations/'+conversation.id+'/turns','POST',{...body,requestKey:randomUUID()},'buyer')).data;
   parallel.push(job.id);
  }
  const firstParallel=tick();await wait(async()=>Boolean(await db.aiExecution.findFirst({where:{requestId:'task:'+parallel[0],status:'running'}})));
  const secondParallel=tick();await wait(async()=>Boolean(await db.aiExecution.findFirst({where:{requestId:'task:'+parallel[1],status:'running'}})));
  eq(await db.aiExecution.count({where:{requestId:{in:parallel.map(id=>'task:'+id)},status:'running'}}),2);
  await Promise.all([firstParallel,secondParallel]);delay=0;
  eq(await db.aiTask.count({where:{id:{in:parallel},status:'completed'}}),2);

  // Tool request metadata may stream, but arguments remain hidden until platform validation.
  const draft=(await h.request(base+'/conversations','POST',{title:'采购草稿过程'},'buyer')).data;
  const draftTask=(await h.request(base+'/conversations/'+draft.id+'/turns','POST',{...body,content:'请创建采购草稿',allowAction:true,requestKey:randomUUID()},'buyer')).data;
  delay=900;const draftRun=tick();await wait(async()=>Boolean((await db.aiTask.findUnique({where:{id:draftTask.id}}))?.result?.progress?.tools?.some(tool=>tool.kind==='operation')));
  const draftLive=(await h.request(base+'/tasks/'+draftTask.id,'GET',undefined,'buyer')).data.result.progress.tools.find(tool=>tool.kind==='operation');eq(draftLive.status,'requested');eq(draftLive.parameters,undefined);eq(draftLive.actionId,undefined);ok(!JSON.stringify(draftLive).includes('PRIVATE_'));
  await draftRun;delay=0;
  const previewMessage=(await h.request(base+'/conversations/'+draft.id,'GET',undefined,'buyer')).data.messages.at(-1);
  const previewTool=previewMessage.process.tools.find(tool=>tool.kind==='operation');eq(previewTool.status,'pending');ok(previewTool.parameters['供应商'].includes(supplier.code));ok(!previewTool.receipt);
  await h.request(base+'/actions/'+previewMessage.actionId+'/cancel','POST',{},'buyer');
  const cancelledView=(await h.request(base+'/conversations/'+draft.id,'GET',undefined,'buyer')).data.messages.at(-1).process.tools.find(tool=>tool.kind==='operation');eq(cancelledView.status,'cancelled');ok(cancelledView.summary.includes('不执行'));
  const memberRole=await db.membership.findUnique({where:{id:f.accounts.buyer.memberId}});
  await db.membership.update({where:{id:f.accounts.buyer.memberId},data:{role:'sales'}});
  // ERP replies now carry an authorization receipt: revoke the whole derived reply,
  // not only operation parameters, since its prose may contain prior private facts.
  const redacted=(await h.request(base+'/conversations/'+draft.id,'GET',undefined,'buyer')).data.messages.at(-1);ok(redacted.content.includes('不可访问'));eq(redacted.process,undefined);ok(!JSON.stringify(redacted).includes(supplier.code));
  await h.request(base+'/tasks/'+draftTask.id,'GET',undefined,'buyer',404);
  await db.membership.update({where:{id:f.accounts.buyer.memberId},data:{role:memberRole.role}});
  await h.request(base+'/tasks/'+draftTask.id,'GET',undefined,'sales',404);
  await db.tenantCapability.update({where:{tenantId_capability:{tenantId:f.tenant.id,capability:'ai'}},data:{enabled:false}});await h.request(base+'/tasks/'+q6.id,'GET',undefined,'buyer',403);
  console.log(JSON.stringify({ok:true,assertions:count,httpChecks:h.checks()+h2.checks(),modelCalls,scope:['durable-message','idempotency','refresh','auto-binding','cross-process-cancel','queue-preparing','boot-failure','lease-release','notifications','structured-receipt','exact-task-link','permission-revocation']}));
 }finally{
  if(other)await other.close();if(app)await app.close();if(manager)await new Promise(r=>manager.close(r));if(model)await new Promise(r=>model.close(r));fs.rmSync(socket,{force:true});
  for(const x of [f,g])if(x){for(const table of ['personalNotification','aiTask','aiExecution','aiAction','aiConversation','infrastructureBinding','businessTaskStep','businessTask','usageRecord'])await db[table].deleteMany({where:{tenantId:x.tenant.id}});await cleanupFixture(db,x);}await db.$disconnect();
 }
})().catch(e=>{console.error(e);process.exitCode=1});
