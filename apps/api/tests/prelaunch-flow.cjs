const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createApp}=require('../dist/server'),{PrismaService}=require('../dist/modules/prisma.service'),{CrmEngagementService}=require('../dist/modules/crm/engagement.service');
const {createCrmFixture,cleanupFixture}=require('../scripts/crm-fixture.cjs');
(async()=>{
 if(!/^postgresql:\/\/[^@]+@127\.0\.0\.1:54329\/suite_phase1_qa(?:\?|$)/.test(process.env.DATABASE_URL??''))throw Error('Isolated QA database required');
 const db=new PrismaService();let app,f;
 try{
  app=await createApp();f=await createCrmFixture(db,app);const service=app.get(CrmEngagementService),ctx=f.contexts.admin;
  const open=await service.createRisk(ctx,{requestKey:randomUUID(),customerId:f.customers[0].id,channelId:f.channel.id,title:'仍待处理的风险',severity:'high',detail:'仅隔离验证：旧的未关闭风险必须仍然可见'});
  for(let n=0;n<21;n++){
   const risk=await service.createRisk(ctx,{requestKey:randomUUID(),customerId:f.customers[0].id,channelId:f.channel.id,title:'较新的已关闭风险'+n,severity:'low',detail:'隔离回归用风险记录'});
   await service.closeRisk(ctx,risk.id,{requestKey:randomUUID(),version:risk.version,resolution:'隔离验证已处理完毕'});
  }
  const board=await service.workbench(ctx);assert.ok(board.risks.some(r=>r.id===open.id),'Old open risk must not disappear behind 21 newer closed risks');assert.equal(board.risks.length,1);assert.equal(board.risks[0].status,'open');
  console.log(JSON.stringify({passed:true,assertions:3,scenario:'open-risk filtering precedes pagination'}));
 }finally{if(app)await app.close();if(f)await cleanupFixture(db,f);await db.$disconnect();}
})().catch(e=>{console.error(e);process.exitCode=1});
