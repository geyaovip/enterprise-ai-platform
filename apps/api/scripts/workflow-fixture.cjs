const {randomUUID,randomBytes}=require('node:crypto');
const {hashPassword}=require('../dist/modules/platform/security');
async function createFixture(db,slug,ownerEmail){
 if(!slug.startsWith('erp-flow-test-'))throw Error('Dedicated test namespace required');
 if(await db.tenant.findUnique({where:{slug}}))throw Error('Test tenant already exists; preserve it or clean its saved batch explicitly');
 const tenant=await db.tenant.create({data:{slug,name:'ERP 流转测试（假数据）'}});await db.tenantApp.create({data:{tenantId:tenant.id,appId:'erp'}});
 const users=[],accounts={};const password='Test-'+randomBytes(18).toString('base64url')+'!';
 for(const [key,role,name]of [['admin','admin','测试管理员'],['reviewer','finance','测试采购负责人'],['reviewer2','purchasing','测试复核负责人'],['buyer','purchasing','测试采购员'],['sales','sales','测试销售员'],['warehouse','warehouse','测试仓库员'],['finance','finance','测试财务员']]){
  const user=await db.user.create({data:{email:`${key}-${slug}@example.test`,name,passwordHash:hashPassword(password)}});users.push(user.id);const member=await db.membership.create({data:{tenantId:tenant.id,userId:user.id,role}});accounts[key]={email:user.email,password,userId:user.id,memberId:member.id,role};
 }
 if(ownerEmail){const user=await db.user.findUnique({where:{email:ownerEmail}});if(!user?.active)throw Error('Active owner account required');const member=await db.membership.create({data:{tenantId:tenant.id,userId:user.id,role:'admin'}});accounts.owner={email:user.email,userId:user.id,memberId:member.id,role:'admin'};}
 return{batch:slug,tenant,users,accounts,createdAt:new Date().toISOString()};
}
async function fixtureHttp(app,fixture){
 await app.listen(0,'127.0.0.1');const base=`http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;const prefix=`/tenants/${fixture.tenant.slug}/erp`;const origin=process.env.PUBLIC_WEB_ORIGIN||'http://127.0.0.1:4601';const cookies={};let checks=0;
 async function request(path,method='GET',body,key='admin',expected=method==='POST'?201:200){const r=await fetch(base+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookies[key]?{Cookie:cookies[key]}:{})},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(expected!==null&&r.status!==expected)throw Error(`${method} ${path}: expected ${expected}, got ${r.status} ${JSON.stringify(data)}`);checks++;return{status:r.status,data,cookie:r.headers.get('set-cookie')};}
 for(const [key,a]of Object.entries(fixture.accounts)){if(!a.password)continue;const r=await request('/auth/login','POST',{email:a.email,password:a.password},key);cookies[key]=r.cookie.split(';')[0];}
 return{request,cookies,prefix,post:async(p,b,key='admin',expected=201)=>(await request(prefix+p,'POST',b,key,expected)).data,get:async(p,key='admin',expected=200)=>(await request(prefix+p,'GET',undefined,key,expected)).data,checks:()=>checks};
}
async function cleanupFixture(db,f){
 const current=await db.tenant.findUnique({where:{id:f.tenant.id}});if(!current||current.slug!==f.batch||!f.batch.startsWith('erp-flow-test-')||current.name!=='ERP 流转测试（假数据）')throw Error('Cleanup batch identity mismatch');
 if(await db.knowledgeDocument.count({where:{tenantId:current.id}}))throw Error('Test tenant has additional knowledge files; review them before cleanup');
 await db.$transaction(async tx=>{const where={tenantId:current.id};
 const connections=await tx.channelConnection.findMany({where,select:{id:true}});await tx.channelInbound.deleteMany({where:{connectionId:{in:connections.map(c=>c.id)}}});
 for(const table of ['applicationCommandReceipt','mesCommandReceipt','mesReport','mesWorkOrder','mesPlan','mesBomReview','mesBom','mesMaterial','mesMemberGrant','crmOperationTaskLog','crmTaskPlanVersion','crmOperationTask','crmSegmentMember','crmSegmentEvaluation','crmSegment','crmImportChange','crmImportRow','crmImportFile','crmImportBatch','crmMetricSnapshot','crmCommerceOrderItem','crmCommerceOrder','crmCustomerTagAssignment','crmCustomerTag','crmCustomerContact','crmCustomerIdentity','crmCustomer','crmScopeRevision','crmSalesChannel','crmMemberPermissionGrant','crmMemberGrant','crmCommandReceipt','crmSettings','aiComposerDraft'])await tx[table].deleteMany({where});
 for(const table of ['aiMemoryIndexPurge','aiMemorySetting','aiMemoryEntry','personalNotification','aiTask','aiExecution','aiAction','aiConversation','infrastructureBinding','aiProviderSettings','businessTaskStep','businessTask','channelConnectAttempt','channelChatSession','erpWorkflow','memberInvitation','channelDelivery','channelIdentity','channelPairCode','channelConnection','erpAccountEntry','erpAdvance','erpTradeReturn','erpOpeningBatch','erpQuotation','erpCustomerPrice','erpBusinessSettings','erpWarehouseStock','erpWarehouse','erpPayment','erpInvoiceRequest','erpReceiptClaim','erpIncomingReceipt','erpStockMovement','erpStockDocument','erpReceivable','erpPayable','erpPurchaseChange'])if(tx[table])await tx[table].deleteMany({where});
 await tx.erpPurchaseLine.deleteMany({where:{order:where}});await tx.erpSalesLine.deleteMany({where:{contract:where}});
 for(const table of ['erpPurchaseOrder','erpSalesContract','erpOpportunityFollowup','erpOpportunity','erpCustomer','erpInventoryBalance','erpProduct','erpSupplier','erpAnnouncementRead','erpAnnouncement','erpNotification','erpTask','auditEvent','membershipOrg','orgUnit','tenantCapability','tenantApp','membership'])await tx[table].deleteMany({where});
 await tx.tenant.delete({where:{id:current.id}});await tx.session.deleteMany({where:{userId:{in:f.users}}});await tx.user.deleteMany({where:{id:{in:f.users}}});
 },{timeout:30000});
}
module.exports={createFixture,fixtureHttp,cleanupFixture};
