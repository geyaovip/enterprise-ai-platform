require('dotenv/config');
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {PrismaPg}=require('@prisma/adapter-pg'),{PrismaClient}=require('../dist/generated/prisma/client'),{createApp}=require('../dist/server');
const {createFixture,fixtureHttp,cleanupFixture}=require('./workflow-fixture.cjs');
async function main(){
 const production=process.argv.includes('--production');if(!process.env.DATABASE_URL)throw Error('DATABASE_URL required');if(!production&&!process.env.DATABASE_URL.includes('@127.0.0.1:54329/suite_phase1_qa'))throw Error('Only isolated local QA or explicit --production is allowed');
 if(production&&!process.env.TEST_OWNER_EMAIL)throw Error('TEST_OWNER_EMAIL required in production');
 const manifest=process.env.TEST_FIXTURE_MANIFEST||path.resolve('../../var/workflow-demo-'+(production?'production':'local')+'.json');fs.mkdirSync(path.dirname(manifest),{recursive:true});const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});let app;
 try{if(process.argv.includes('--clean')){const f=JSON.parse(fs.readFileSync(manifest,'utf8'));await cleanupFixture(db,f);fs.renameSync(manifest,manifest+'.cleaned');console.log('Dedicated workflow test batch cleaned; existing enterprises and users retained.');return;}
 const slug=production?'erp-flow-test-20261010':'erp-flow-test-local';const f=await createFixture(db,slug,process.env.TEST_OWNER_EMAIL);fs.writeFileSync(manifest,JSON.stringify(f,null,2),{mode:0o600,flag:'wx'});
 app=await createApp();const h=await fixtureHttp(app,f),a=f.accounts,owner=a.owner?.memberId??a.admin.memberId;
 const steps=[{name:'采购负责人审核',members:[a.reviewer.memberId,owner],mode:'any'}],highSteps=[...steps,{name:'大额复核',members:[a.reviewer2.memberId,owner],mode:'any'}];
 const stepNames={purchase:'采购负责人审核',sales:'销售负责人审核',purchase_change:'采购变更审核',return_purchase:'采购退货审核',return_sales:'销售退货审核'};
 const config={};for(const kind of ['purchase','sales','purchase_change','return_purchase','return_sales','invoice','receipt'])config[kind]={steps:['invoice','receipt'].includes(kind)?[]:steps.map(s=>({...s,name:stepNames[kind]})),threshold:['invoice','receipt'].includes(kind)?undefined:'10000',highSteps:['invoice','receipt'].includes(kind)?[]:highSteps,handlers:kind==='purchase'||kind==='sales'?[a.warehouse.memberId,owner]:kind==='invoice'||kind==='receipt'?[a.finance.memberId,owner]:[],fallback:[a.admin.memberId],cc:[owner],hours:24,leadMinutes:60,repeatHours:24,escalateHours:48,escalation:[owner]};
 await h.post('/workflow-config',{version:0,config});
 const supplier=await h.post('/suppliers',{code:'TEST-SUP-001',name:'测试供应商 · 华辰电子',paymentDays:30});
 const product=await h.post('/products',{sku:'TEST-PROD-001',name:'测试商品 · 控制模块',unit:'件',purchasePrice:'120',salePrice:'200',reorderPoint:20});
 const customer=await h.post('/customers',{code:'TEST-CUST-001',name:'测试客户 · 启航科技',industry:'电子制造',paymentDays:30},'sales');
 const customer2=await h.post('/customers',{code:'TEST-CUST-002',name:'测试客户 · 远景设备',industry:'设备制造'},'sales');
 const purchase=async(number,quantity,submit=true)=>{const p=await h.post('/purchases',{number,supplierId:supplier.id,note:'假数据，仅供测试',deliveryAt:new Date(Date.now()+86400000*2).toISOString(),lines:[{productId:product.id,quantity}]},'buyer');return submit?await h.post(`/purchases/${p.id}/submit`,{version:p.version},'buyer'):p;};
 const stock=await purchase('TEST-PO-已入库',50);const approved=await h.post(`/purchases/${stock.id}/confirm`,{version:stock.version},'reviewer');await h.post(`/purchases/${stock.id}/receive`,{version:approved.version,lines:[{lineId:stock.lines[0].id,quantity:50}]},'warehouse');
 const pending=await purchase('TEST-PO-待审核',10);await purchase('TEST-PO-大额审核',100);await purchase('TEST-PO-草稿',8,false);
 const partial=await purchase('TEST-PO-部分入库',20);const pa=await h.post(`/purchases/${partial.id}/confirm`,{version:partial.version},'reviewer');await h.post(`/purchases/${partial.id}/receive`,{version:pa.version,lines:[{lineId:partial.lines[0].id,quantity:5}]},'warehouse');
 const rejected=await purchase('TEST-PO-已退回',4);await h.post(`/purchases/${rejected.id}/reject`,{version:rejected.version,reason:'测试退回：补充交期'},'reviewer');
 const contract=async(number,qty,approve=true)=>{let s=await h.post('/contracts',{number,customerId:customer.id,note:'假数据，仅供测试',lines:[{productId:product.id,quantity:qty}]},'sales');s=await h.post(`/contracts/${s.id}/submit`,{version:s.version},'sales');return approve?await h.post(`/contracts/${s.id}/confirm`,{version:s.version},'reviewer'):s;};
 await contract('TEST-SO-待审核',5,false);await contract('TEST-SO-待发货',8);const so=await contract('TEST-SO-已发货',10);await h.post(`/contracts/${so.id}/ship`,{version:so.version,lines:[{lineId:so.lines[0].id,quantity:10}]},'warehouse');
 const current=await h.get(`/contracts/${so.id}`,'sales');await h.post('/invoices',{contractId:so.id,contractVersion:current.version,amount:'1000',note:'假数据：待财务办理'},'sales');
 const receipt=await h.post('/receipts',{customerId:customer.id,amount:'500',receivedAt:new Date().toISOString(),reference:'TEST-BANK-001',note:'假数据，不代表真实到账'},'finance');const account=await db.erpReceivable.findUnique({where:{contractId:so.id}});await h.post(`/receipts/${receipt.id}/claims`,{version:receipt.version,allocations:[{receivableId:account.id,amount:'500'}]},'sales');
 const partialNow=await h.get(`/purchases/${partial.id}`,'buyer');await h.post(`/purchases/${partial.id}/changes`,{version:partialNow.version,reason:'假数据：客户调整采购数量',lines:[{lineId:partialNow.lines[0].id,quantity:25}]},'buyer');
 const purchaseSources=await h.get(`/trade/purchase/${stock.id}/return-sources`,'buyer');await h.post('/returns',{requestKey:randomUUID(),number:'TEST-PR-待审核',kind:'purchase',sourceId:stock.id,reason:'假数据：供应商换货',lines:[{movementId:purchaseSources[0].id,quantity:2}]},'buyer');
 const salesSources=await h.get(`/trade/sales/${so.id}/return-sources`,'sales');await h.post('/returns',{requestKey:randomUUID(),number:'TEST-SR-待审核',kind:'sales',sourceId:so.id,reason:'假数据：客户退货',lines:[{movementId:salesSources[0].id,quantity:1}]},'sales');
 await h.post('/announcements',{requestKey:randomUUID(),title:'测试公告 · ERP 流转演练',body:'本企业全部记录为假数据，仅供流程测试。'});
 const flow=await db.erpWorkflow.findUnique({where:{tenantId_kind_resourceId:{tenantId:f.tenant.id,kind:'purchase',resourceId:pending.id}}});const stages=flow.steps;stages[0].dueAt=new Date(Date.now()-3600000).toISOString();await db.erpWorkflow.update({where:{id:flow.id},data:{steps:stages,dueAt:new Date(stages[0].dueAt)}});
 await h.post('/tasks',{requestKey:randomUUID(),title:'测试任务 · 核对采购交期',assigneeMembershipId:a.buyer.memberId,dueAt:new Date(Date.now()+86400000).toISOString()});
 f.summary={customers:2,products:1,suppliers:1,purchases:6,contracts:3,returns:2,purchaseChanges:1,workflows:await db.erpWorkflow.count({where:{tenantId:f.tenant.id}}),notifications:await db.erpNotification.count({where:{tenantId:f.tenant.id}})};fs.writeFileSync(manifest,JSON.stringify(f,null,2),{mode:0o600});console.log(JSON.stringify({batch:f.batch,tenantKey:f.tenant.slug,summary:f.summary,manifest,realBusinessDataChanged:false}));
 }finally{if(app)await app.close();await db.$disconnect();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
