const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {createApp}=require('../dist/server'),{PrismaService}=require('../dist/modules/prisma.service'),{AuthService}=require('../dist/modules/platform/auth.service'),{MesService}=require('../dist/modules/mes/mes.service'),{createFixture,cleanupFixture,fixtureHttp}=require('../scripts/workflow-fixture.cjs');
(async()=>{
 assertEnvironment();const out=process.env.BOM_HISTORY_QA_OUTPUT_DIR,db=new PrismaService(),app=await createApp();let f;
 try{
  f=await createFixture(db,'erp-flow-test-history-ui-'+randomUUID().slice(0,8));await db.tenantApp.create({data:{tenantId:f.tenant.id,appId:'mes'}});
  const mes=app.get(MesService),ctx=await app.get(AuthService).taskContext({tenantId:f.tenant.id,userId:f.accounts.admin.userId,membershipId:f.accounts.admin.memberId,appId:'mes',taskId:randomUUID()});
  const materials=[];for(const[sku,kind,unit]of[['HISTORY-FG','finished','件'],['OTHER-FG','finished','件'],['HIST-RAW','raw','件'],['KG-RAW','raw','kg']])materials.push(await mes.saveMaterial(ctx,undefined,{requestKey:randomUUID(),sku,name:sku,kind,unit}));
  const evidence={filename:'approved.csv',sha256:'a'.repeat(64),page:null,sheet:null,table:1,row:2,method:'text-cells',originalSku:'HIST-RAW',originalQuantity:'7',originalUnit:'件',mpn:'ABC123FN',manufacturer:'Maker',footprint:'0603',revision:'A',population:'YES',reviewed:true,factReviewed:true};
  const draft=await mes.saveBom(ctx,undefined,{requestKey:randomUUID(),draft:{productId:materials[0].id,lines:[{materialId:materials[2].id,quantity:'7',sourceEvidence:evidence}]}}),approved=await mes.publishBom(ctx,draft.id,{requestKey:randomUUID(),version:draft.version}),h=await fixtureHttp(app,f);
  fs.writeFileSync(path.join(out,'browser-fixture.private.json'),JSON.stringify({slug:f.tenant.slug,apiPort:app.getHttpServer().address().port,cookie:h.cookies.admin,materials,approved}),{mode:0o600});console.log(JSON.stringify({ready:true,slug:f.tenant.slug,port:app.getHttpServer().address().port}));
  await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve)});
 }finally{await app.close();if(f)await cleanupFixture(db,f);await db.$disconnect();fs.rmSync(path.join(out,'browser-fixture.private.json'),{force:true});console.log('History browser fixture removed')}
})().catch(e=>{console.error(e);process.exitCode=1});
function assertEnvironment(){if(!process.env.DATABASE_URL?.includes('@127.0.0.1:54329/suite_phase1_qa')||!/20261028-bom-(local-r2|scan-r3)$/.test(process.env.BOM_HISTORY_QA_OUTPUT_DIR??''))throw Error('Isolated local history QA required');}
