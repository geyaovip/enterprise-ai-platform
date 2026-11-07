const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const{createApp}=require('../dist/server'),{PrismaService}=require('../dist/modules/prisma.service'),{AuthService}=require('../dist/modules/platform/auth.service'),{MesService}=require('../dist/modules/mes/mes.service'),{createFixture,cleanupFixture,fixtureHttp}=require('../scripts/workflow-fixture.cjs');
(async()=>{
 if(!process.env.DATABASE_URL.includes('@127.0.0.1:54329/suite_phase1_qa'))throw Error('Isolated QA required');
 const db=new PrismaService(),app=await createApp();let f;
 const root=path.resolve(__dirname,'../../../output/bom-intake-20261027');
 try{
  f=await createFixture(db,'erp-flow-test-bom-ui-'+randomUUID().slice(0,8));await db.tenantApp.createMany({data:['mes','crm'].map(appId=>({tenantId:f.tenant.id,appId}))});
  const auth=app.get(AuthService),mes=app.get(MesService),ctx=await auth.taskContext({tenantId:f.tenant.id,userId:f.accounts.admin.userId,membershipId:f.accounts.admin.memberId,appId:'mes',taskId:randomUUID()});
  const materials=[];
  for(const[sku,name,kind]of[['FG-01','装配产品','finished'],['SUB-01','子装配','semi'],['RAW-01','钢板','raw'],['000050','螺钉','raw'],['RAW-02','垫片','raw'],['PCB-MCU','MCU隔离测试占位物料','raw'],['JACKSCREW BAR BASE','支架','raw'],['JACKSCREW PIN','销轴','raw'],['M5 X 16MM - 92000A326','螺钉M5','raw']])materials.push(await mes.saveMaterial(ctx,undefined,{requestKey:randomUUID(),sku,name,kind,unit:'件'}));
  const h=await fixtureHttp(app,f);
  fs.writeFileSync(path.join(root,'.browser-fixture.json'),JSON.stringify({tenantId:f.tenant.id,slug:f.tenant.slug,apiPort:app.getHttpServer().address().port,adminCookie:h.cookies.admin,materials}),{mode:0o600});
  console.log(JSON.stringify({ready:true,port:app.getHttpServer().address().port,fixturePath:path.join(root,'.browser-fixture.json')}));
  await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
 }finally{await app.close();if(f)await cleanupFixture(db,f);await db.$disconnect();fs.rmSync(path.join(root,'.browser-fixture.json'),{force:true});console.log('BOM browser fixture removed.');}
})().catch(e=>{console.error(e);process.exitCode=1});
