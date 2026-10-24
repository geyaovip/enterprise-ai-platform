const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {writeFileSync,unlinkSync}=require('node:fs');
const {spawn}=require('node:child_process');
const {createApp}=require('../dist/server');
const {PrismaService}=require('../dist/modules/prisma.service');
const {createFixture,fixtureHttp,cleanupFixture}=require('../scripts/workflow-fixture.cjs');
const {TaskService}=require('../dist/modules/orchestration/task.service');
const {AuthService}=require('../dist/modules/platform/auth.service');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 if(!/^postgresql:\/\/[^@]+@127\.0\.0\.1:54329\/suite_phase1_qa(?:\?|$)/.test(process.env.DATABASE_URL??''))throw Error('Isolated worker QA required');
 const db=new PrismaService();let app,f,child;const hook='/tmp/worker-lanes-'+randomUUID()+'.cjs';
 try{
  f=await createFixture(db,'erp-flow-test-'+randomUUID().slice(0,8));app=await createApp();const h=await fixtureHttp(app,f);
  const supplier=await h.post('/suppliers',{code:'LANE-SUP',name:'调度隔离测试供应商'},'buyer');
  const product=await h.post('/products',{sku:'LANE-PRODUCT',name:'调度隔离测试商品',unit:'件',purchasePrice:'10.00',salePrice:'20.00',reorderPoint:1},'buyer');
  const a=f.accounts.buyer,ctx=await app.get(AuthService).taskContext({tenantId:f.tenant.id,userId:a.userId,membershipId:a.memberId,appId:'erp',taskId:'worker-qa'}),tasks=app.get(TaskService);
  const number='LANE-'+randomUUID().slice(0,8),task=await tasks.create(ctx,{requestKey:randomUUID(),title:'慢知识任务期间创建采购草稿',steps:[{appId:'erp',command:'erp.purchase.create_draft',title:'创建草稿',input:{number,supplierId:supplier.id,lines:[{productId:product.id,quantity:2}]}}]});
  await tasks.action(ctx,task.id,{action:'confirm',version:task.version});
  // This hook exists only in the isolated test process. It exercises the actual worker loop.
  writeFileSync(hook,`const {KnowledgeProcessor}=require('/app/apps/api/dist/modules/knowledge/knowledge.processor');const original=KnowledgeProcessor.prototype.tick;let once=true;KnowledgeProcessor.prototype.tick=async function(){if(once){once=false;process.stdout.write('QA_KNOWLEDGE_PAUSED\\n');await new Promise(r=>setTimeout(r,20000));}return original.call(this);};`,{mode:0o600});
  let startedResolve;const started=new Promise(r=>startedResolve=r);let diagnostic='';
  child=spawn(process.execPath,['--require',hook,'apps/api/dist/worker.js'],{cwd:'/app',env:{...process.env,NODE_ENV:'test',WORKER_HEALTH_PORT:'4626'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>{if(b.toString().includes('QA_KNOWLEDGE_PAUSED'))startedResolve();});child.stderr.on('data',b=>diagnostic+=b.toString());
  await Promise.race([started,pause(10000).then(()=>{throw Error('Worker did not start: '+diagnostic);})]);const before=Date.now();
  let completed;for(let i=0;i<35;i++){completed=await db.businessTask.findUnique({where:{id:task.id}});if(completed.status==='completed')break;await pause(200);}
  assert.equal(completed.status,'completed',diagnostic);assert.ok(Date.now()-before<10000);
  const health=await fetch('http://127.0.0.1:4626/health').then(r=>r.json());assert.equal(health.ok,true);assert.equal(health.lanes.find(l=>l.name==='knowledge').running,true);
  assert.equal(await db.erpPurchaseOrder.count({where:{tenantId:f.tenant.id,number}}),1);
  console.log(JSON.stringify({ok:true,scope:'real-worker-independent-lanes',knowledgeDelayMs:20000,businessCompletedDuringDelay:true,workerLanes:health.lanes.length}));
 }finally{
  if(child){child.kill('SIGTERM');await new Promise(r=>{if(child.exitCode!==null)r();else child.once('exit',r);});}
  try{unlinkSync(hook);}catch{}
  if(app)await app.close();if(f){for(const table of ['businessTaskStep','businessTask','applicationCommandReceipt','erpOperatingEvent','usageRecord'])await db[table].deleteMany({where:{tenantId:f.tenant.id}});await cleanupFixture(db,f);}await db.$disconnect();
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
