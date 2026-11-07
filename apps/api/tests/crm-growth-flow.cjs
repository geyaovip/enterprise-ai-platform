const assert=require('node:assert/strict'),{randomUUID:k}=require('node:crypto');
const {createApp}=require('../dist/server'),{PrismaService}=require('../dist/modules/prisma.service'),{AuthService}=require('../dist/modules/platform/auth.service');
const {CrmCore}=require('../dist/modules/crm/crm-core.service'),{CrmMetricsService}=require('../dist/modules/crm/metrics.service'),{ConnectorBusinessService}=require('../dist/modules/connectors/connector-business.service');
const {createFixture,fixtureHttp,cleanupFixture}=require('../scripts/workflow-fixture.cjs');
(async()=>{
 if(!/^postgresql:\/\/[^@]+@127\.0\.0\.1:54329\/suite_phase1_qa(?:\?|$)/.test(process.env.DATABASE_URL??''))throw Error('Dedicated growth QA required');
 const db=new PrismaService(),now=new Date('2026-10-27T04:00:00Z');let app,f,other,checks=0;
 const eq=(a,b)=>{assert.deepEqual(a,b);checks++},ok=x=>{assert.ok(x);checks++};
 try{
  f=await createFixture(db,'erp-flow-test-growth-'+k().slice(0,8));other=await createFixture(db,'erp-flow-test-growth-other-'+k().slice(0,8));
  for(const x of [f,other])await db.tenantApp.create({data:{tenantId:x.tenant.id,appId:'crm'}});
  app=await createApp();app.get(CrmCore).now=()=>now;const h=await fixtureHttp(app,f),base='/tenants/'+f.tenant.slug+'/apps/crm';
  const get=async(p,who='admin',status=200)=>(await h.request(base+p,'GET',undefined,who,status)).data;
  const post=async(p,b,who='admin',status=201)=>(await h.request(base+p,'POST',b,who,status)).data;
  const org=await db.orgUnit.create({data:{tenantId:f.tenant.id,name:'机会组织'}}),org2=await db.orgUnit.create({data:{tenantId:f.tenant.id,name:'隔离组织'}});
  const ch=await post('/settings/channels',{code:'GROWTH',name:'机会来源',defaultOrgUnitId:org.id,requestKey:k()}),ch2=await post('/settings/channels',{code:'OTHER',name:'隔离来源',defaultOrgUnitId:org2.id,requestKey:k()});
  const grant=async(who,role,version=0)=>h.request(base+'/settings/access','PUT',{membershipId:f.accounts[who].memberId,roles:[{role,scopeBindings:[{orgUnitIds:[org.id],channelIds:[ch.id]}]}],extraPermissions:[],version,reason:'经营机会隔离验证',requestKey:k()});
  await grant('finance','manager');await grant('buyer','operator');await grant('warehouse','viewer');await grant('sales','sales');await grant('reviewer','csm');
  const customers=[];
  for(const [n,channel,orgUnitId,age] of [['沉睡客户',ch,org.id,200],['首购客户',ch,org.id,100],['新客',ch,org.id,10],['隔离客户',ch2,org2.id,10]]){
   const c=await post('/customers',{displayName:n,kind:'consumer',orgUnitId,channelId:channel.id,ownerMembershipId:channel.id===ch.id?f.accounts.sales.memberId:f.accounts.admin.memberId,requestKey:k()});customers.push(c);
   await db.crmCustomer.update({where:{id:c.id},data:{sourceCreatedAt:new Date(now.getTime()-age*86400000)}});
  }
  for(const [customer,currency,days,paid]of [[customers[0],'CNY',100,'1500'],[customers[1],'CNY',10,'200'],[customers[1],'USD',10,'3000']]){
   const o=await db.crmCommerceOrder.create({data:{tenantId:f.tenant.id,customerId:customer.id,channelId:ch.id,externalOrderId:k(),status:'paid',currency,paidAt:new Date(now.getTime()-days*86400000),paidAmount:paid,refundAmount:'0',importBatchId:k(),sourceHash:'growth-synthetic',sourceUpdatedAt:now,unallocatedPaidAmount:'0',unallocatedRefundAmount:'0'}});
   await db.crmCommerceOrderItem.create({data:{tenantId:f.tenant.id,orderId:o.id,lineKey:'one',externalSkuId:'SYN-SKU',name:'合成商品',quantity:'1',paidAmount:paid,refundAmount:'0'}});
  }
  for(const channel of[ch,ch2])await app.get(CrmMetricsService).recalculate(f.tenant.id,channel.id);
  const before=await db.crmSegmentEvaluation.count({where:{tenantId:f.tenant.id}}),board=await get('/growth','finance');
  eq(board.scenarios.map(x=>x.memberCount),[1,1,1,1]);eq(board.currency,'CNY');eq(await db.crmSegmentEvaluation.count({where:{tenantId:f.tenant.id}}),before);
  const usd=await get('/growth?currency=USD','finance');eq(usd.scenarios[0].memberCount,0);eq(usd.scenarios[1].memberCount,1);
  eq((await get('/growth','sales')).scenarios.length,0);eq((await get('/growth','reviewer')).signals.length,2);
  await get('/growth?currency=JPY','admin',400);
  const p=await post('/segments/preview',{rule:{match:'all',currency:'CNY',conditions:[{field:'status',op:'eq',value:'active'}]}},'finance');eq(p.memberCount,3);
  const allPreview=await post('/segments/preview',{rule:{match:'all',currency:'CNY',conditions:[{field:'status',op:'eq',value:'active'}]}});
  const mixed=await post('/tasks',{title:'部分范围任务',evaluationId:allPreview.evaluationId,previewHash:allPreview.previewHash,requestKey:k()});
  eq((await get('/tasks/'+mixed.id,'finance')).restricted,true);eq((await get('/tasks/'+mixed.id+'/customers','finance')).total,3);
  let task=await post('/tasks',{title:'逐客户回访',goal:'记录需求和下一步',planText:'逐一人工回访，记录客户结果。',checklist:[{stableId:'review',text:'核对需求'}],trackCustomers:true,ownerMembershipId:f.accounts.finance.memberId,dueAt:'2026-11-01T00:00:00Z',evaluationId:p.evaluationId,previewHash:p.previewHash,requestKey:k()},'finance');
  const action=async(action,extra={},status=201)=>{const r=await post('/tasks/'+task.id+'/actions',{action,version:task.version,requestKey:k(),...extra},'finance',status);if(status===201)task=r;return r;};
  await action('submit');await action('confirm',{planVersion:1,evaluationId:p.evaluationId,previewHash:p.previewHash});await action('start');
  const targetPath='/tasks/'+task.id+'/customers';eq((await get(targetPath,'finance')).summary,{total:3,recorded:0,pending:3,followUp:0});
  await action('complete',{summary:'不能跳过客户明细'},409);
  const payload={version:0,outcome:'follow_up',summary:'客户需要进一步了解服务',occurredAt:now.toISOString(),nextAt:'2026-10-28T04:00:00Z',requestKey:k()};
  const resultPath=targetPath+'/'+customers[0].id+'/outcomes';
  await post(resultPath,{...payload,nextAt:null},'finance',400);
  await post(resultPath,{...payload,occurredAt:'2027-01-01T00:00:00Z'},'finance',400);
  await post(resultPath,{...payload,summary:'phone 13812345678'},'finance',400);
  await post(resultPath,payload,'warehouse',403);await post(resultPath,payload,'buyer',403);
  await post(targetPath+'/'+customers[3].id+'/outcomes',payload,'finance',404);
  const foreignOrg=await db.orgUnit.create({data:{tenantId:other.tenant.id,name:'外部组织'}}),foreign=await db.crmCustomer.create({data:{tenantId:other.tenant.id,orgUnitId:foreignOrg.id,displayName:'外部客户',sourceHash:'synthetic'}});
  await post(targetPath+'/'+foreign.id+'/outcomes',payload,'finance',404);
  const first=await post(resultPath,payload,'finance'),replay=await post(resultPath,payload,'finance');eq(first.id,replay.id);eq(replay.repeated,true);
  await post(resultPath,{...payload,requestKey:k()},'finance',409);
  await post(resultPath,{...payload,requestKey:payload.requestKey,summary:'参数发生变化'},'finance',409);
  await post(resultPath,{...payload,requestKey:k(),version:1,outcome:'interested',nextAt:null,summary:'客户表达意向，尚未成交'},'finance');
  eq(await db.crmOperationTaskLog.count({where:{tenantId:f.tenant.id,taskId:task.id,customerId:customers[0].id}}),2);
  const latest=await get(targetPath+'?page_size=1','finance');eq(latest.summary,{total:3,recorded:1,pending:2,followUp:0});eq(latest.total,3);eq(latest.items.length,1);
  eq((await get(targetPath+'?status=pending','finance')).total,2);
  const log1=(await db.crmOperationTaskLog.findMany({where:{taskId:task.id,customerId:customers[0].id},orderBy:{outcomeVersion:'desc'}}))[0];eq(log1.correctsLogId,first.id);
  for(const c of customers.slice(1,3))await post(targetPath+'/'+c.id+'/outcomes',{version:0,outcome:'skipped',summary:'当前无需联系，保留后续跟进安排',occurredAt:now.toISOString(),requestKey:k()},'finance');
  task=await get('/tasks/'+task.id,'finance');await action('complete',{summary:'已逐客户记录处理结果'});eq(task.status,'completed');
  await post(resultPath,{...payload,requestKey:k(),version:2},'finance',409);
  const observed=await get('/tasks/'+task.id+'/results','finance');ok(observed.executionRecorded);ok(observed.notice.includes('没有外部送达'));
  // Another customer's specific feedback must never leak into this customer's timeline.
  const detail=await get('/customers/'+customers[1].id,'finance');ok(!detail.operationRecords.some(x=>x.id===first.id));
  // Read queries expose only allowed fields; static schemas and scope are discovered dynamically.
  const auth=app.get(AuthService),req={cookies:{suite_session:h.cookies.finance.split('=')[1]},headers:{cookie:h.cookies.finance}},ctx=await auth.context(req,f.tenant.slug,'crm'),svc=app.get(ConnectorBusinessService),tools=svc.tools('crm',{scopes:['crm.read','crm.draft']},ctx),readTools=svc.tools('crm',{scopes:['crm.read']},ctx);
  eq(tools.length,22);ok(!readTools.some(t=>t.name==='crm_preview_segment'||t.name==='crm_prepare_task_draft'));ok(readTools.every(t=>t.readOnly));
  const call=async(name,i)=>{const t=tools.find(t=>t.name===name);return t.run(t.schema.parse(i));};
  const list=await call('crm_customers',{page_size:1});eq(list.total,3);eq(list.items.length,1);eq(list.hasMore,true);ok(!JSON.stringify(list).includes('sourceHash'));
  const cd=await call('crm_customer_detail',{id:customers[0].id});ok(!JSON.stringify(cd).includes('encrypted'));ok(!JSON.stringify(cd).includes('sourceHash'));
  const orders=await call('crm_customer_orders',{customerId:customers[1].id});eq(orders.total,2);eq(orders.items[0].items[0].externalSkuId,'SYN-SKU');ok(!JSON.stringify(orders).includes('sourceHash'));
  eq((await call('crm_task_customers',{id:task.id})).summary.pending,0);
  for(const [name,input]of [['crm_growth_opportunities',{}],['crm_segments',{}],['crm_tasks',{}],['crm_task_detail',{id:task.id}],['crm_task_results',{id:task.id}],['crm_leads',{}],['crm_opportunities',{}],['crm_service_records',{kind:'plans'}],['crm_service_records',{kind:'risks'}]])await call(name,input);
  const viewctx=await auth.context({cookies:{suite_session:h.cookies.warehouse.split('=')[1]},headers:{}},f.tenant.slug,'crm');const viewerTools=svc.tools('crm',{scopes:['crm.read','crm.draft']},viewctx);ok(!viewerTools.some(t=>t.name==='crm_leads'||t.name==='crm_service_records'||t.name==='crm_prepare_task_draft'));
  // Revoked role/scope is rechecked on the next actual query.
  await grant('finance','viewer',1);await post(resultPath,{...payload,requestKey:k(),version:2},'finance',403);
  console.log(JSON.stringify({ok:true,assertions:checks,httpChecks:h.checks(),crmTools:tools.length,readOnlyTools:readTools.length,nativeModelCalls:0}));
 }finally{if(app)await app.close();if(f)await cleanupFixture(db,f);if(other)await cleanupFixture(db,other);await db.$disconnect();}
})().catch(e=>{console.error(e);process.exitCode=1});
