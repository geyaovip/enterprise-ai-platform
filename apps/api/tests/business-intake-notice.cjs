// Disposable QA: prove production notice mode blocks model/OCR intake while deterministic mapping persists.
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const{createApp}=require('../dist/server'),{PrismaService}=require('../dist/modules/prisma.service'),{AgentExecutionService}=require('../dist/modules/ai/agent.runtime'),{createCrmFixture,cleanupFixture}=require('../scripts/crm-fixture.cjs'),{fixtureHttp}=require('../scripts/workflow-fixture.cjs');
(async()=>{
 assert.match(process.env.DATABASE_URL??'',/@127\.0\.0\.1:54329\/suite_phase1_qa/);assert.equal(process.env.NATIVE_AI_MODEL_ENABLED,'false');
 const db=new PrismaService();let app,f,checks=0,runtimeCalls=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
 try{
  app=await createApp();f=await createCrmFixture(db,app);await db.tenantApp.createMany({data:['erp','mes'].map(appId=>({tenantId:f.tenant.id,appId}))});
  app.get(AgentExecutionService).complete=async()=>{runtimeCalls++;throw Error('Native model must not run');};
  const h=await fixtureHttp(app,f),prefix=`/tenants/${f.tenant.slug}/apps/`,base=prefix+'crm';
  const counts=async()=>[await db.crmCustomer.count({where:{tenantId:f.tenant.id}}),await db.aiExecution.count({where:{tenantId:f.tenant.id}}),await db.aiModelUsage.count({where:{tenantId:f.tenant.id}})];const before=await counts();
  for(const[appId,kind]of[['erp','purchase'],['erp','contract'],['mes','bom'],['crm','segment'],['crm','import_mapping']]){
   const status=(await h.request(prefix+appId+'/ai/status')).data;eq(status.ai.mode,'notice');eq(status.ai.modelInvocationEnabled,false);
   const r=await h.request(prefix+appId+'/ai/intake','POST',{kind,source:{text:'合成资料'}},'admin',503);eq(r.data.error.code,'AI_NOT_OPEN');assert.match(r.data.error.message,/暂未开放/);checks++;
  }
  // Malformed image is rejected by the global gate before OCR or source parsing.
  const image=await h.request(prefix+'mes/ai/intake','POST',{kind:'bom',source:{image:{mime:'image/png',data:'not-base64'}}},'admin',503);eq(image.data.error.code,'AI_NOT_OPEN');
  const create=async()=> (await h.request(base+'/imports','POST',{channelId:f.channel.id,kind:'customer',requestKey:randomUUID()})).data;
  const upload=async(b,headers)=> (await h.request(base+'/imports/'+b.id+'/files/customer','POST',{version:b.version,requestKey:randomUUID(),filename:'合成客户.csv',format:'csv',contentBase64:Buffer.from(headers+'\n000050,合成客户,2026-10-01T00:00:00+08:00,2026-10-10T00:00:00+08:00').toString('base64')})).data;
  let b=await create();b=await upload(b,'客户编号,客户名称,来源创建时间,来源更新时间');eq(b.mapping.fields.customer.external_customer_id,'客户编号');eq(b.mapping.fields.customer.display_name,'客户名称');
  const detail=(await h.request(base+'/imports/'+b.id)).data;eq(detail.mapping.fields,b.mapping.fields);
  const prior=b.version;b=await upload(b,'会员编号,会员昵称,来源创建时间,来源更新时间');eq(b.version>prior,true);eq(b.mapping.fields.customer.external_customer_id,'会员编号');eq(b.mapping.fields.customer.display_name,'会员昵称');
  eq(await counts(),before);eq(runtimeCalls,0);
  console.log(JSON.stringify({ok:true,assertions:checks,httpChecks:h.checks(),nativeModelCalls:runtimeCalls,noticeMode:true,automaticMappingPersisted:true,staleHeadersReplaced:true,businessAndUsageCountsUnchanged:true}));
 }finally{if(app)await app.close();if(f)await cleanupFixture(db,f);await db.$disconnect();}
})().catch(e=>{console.error(e);process.exitCode=1;});
