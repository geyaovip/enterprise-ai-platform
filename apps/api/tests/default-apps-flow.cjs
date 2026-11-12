const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {rmSync}=require('node:fs');
const {createApp}=require('../dist/server'),{PrismaService}=require('../dist/modules/prisma.service'),{newSessionToken,tokenHash,hashPassword}=require('../dist/modules/platform/security'),{ensureDefaultApps}=require('../dist/modules/platform/default-apps');
(async()=>{
 const u=new URL(process.env.DATABASE_URL??'postgresql://invalid');
 const local=u.hostname==='127.0.0.1'&&u.port==='54329'&&u.pathname==='/suite_phase1_qa';
 const docker=process.env.WB_ISOLATED_QA==='20261024'&&u.hostname==='postgres'&&u.port==='5432'&&u.pathname==='/suite_workbuddy_qa_20261024';
 if(!local&&!docker)throw Error('Dedicated isolation DB required');
 process.env.NODE_ENV='test';delete process.env.RUNTIME_MANAGER_SOCKET;
 const db=new PrismaService(),ids=[],tenantIds=[];let app,n=0,http=0;const eq=(a,b)=>{assert.deepEqual(a,b);n++;};
 try{
  const owner=await db.user.create({data:{email:'default-apps-'+randomUUID()+'@example.test',name:'自动开通隔离验证',passwordHash:hashPassword(randomUUID())}});ids.push(owner.id);
  const token=newSessionToken();await db.session.create({data:{userId:owner.id,tokenHash:tokenHash(token),expiresAt:new Date(Date.now()+3600000)}});
  app=await createApp();await app.listen(0,'127.0.0.1');const base='http://127.0.0.1:'+app.getHttpServer().address().port+'/api/v1';
  async function req(path,body,auth=true,status=body?201:200,method=body?'POST':'GET'){
   const r=await fetch(base+path,{method,headers:{Origin:process.env.PUBLIC_WEB_ORIGIN||'http://127.0.0.1:4601','Content-Type':'application/json',...(auth?{Cookie:'suite_session='+(typeof auth==='string'?auth:token)}:{})},body:body?JSON.stringify(body):undefined});
   const data=await r.json();assert.equal(r.status,status,`${method} ${path}`);n++;http++;return data;
  }
  const expectedApps=['content','crm','erp','geo','manufacturing','mes'];
  const results=await Promise.all([req('/onboarding/enterprise',{name:'新企业自动开通隔离验证'}),req('/onboarding/enterprise',{name:'重复提交不新增'})]);
  const tenant=results[0].tenant;tenantIds.push(tenant.id);eq(tenant.id,results[1].tenant.id);eq(results.filter(r=>!r.existing).length,1);
  const prefix='/tenants/'+tenant.slug;
  const apps=await db.tenantApp.findMany({where:{tenantId:tenant.id},orderBy:{appId:'asc'},select:{appId:true,enabled:true,granted:true}});
  eq(apps,expectedApps.map(appId=>({appId,enabled:true,granted:true})));
  const catalog=await req(prefix+'/applications');eq(catalog.map(a=>a.appId).sort(),expectedApps);
  eq((await req(prefix+'/apps/crm/metadata')).permissions.includes('crm.customer.read'),true);
  eq((await req(prefix+'/apps/content/metadata')).permissions.includes('content.read'),true);
  eq((await req(prefix+'/apps/geo/metadata')).permissions.includes('geo.read'),true);
  await req(prefix+'/apps/manufacturing/orders');
  eq((await req(prefix+'/capabilities')).some(c=>c.capability==='knowledge'&&c.delivered&&c.enabled),true);
  await req(prefix+'/knowledge/spaces');
  const viewer=await db.user.create({data:{email:'default-apps-viewer-'+randomUUID()+'@example.test',name:'普通成员权限隔离',passwordHash:hashPassword(randomUUID())}});ids.push(viewer.id);
  await db.membership.create({data:{tenantId:tenant.id,userId:viewer.id,role:'sales'}});const vt=newSessionToken();await db.session.create({data:{userId:viewer.id,tokenHash:tokenHash(vt),expiresAt:new Date(Date.now()+3600000)}});
  await req('/tenants/'+tenant.slug+'/apps/crm/metadata',undefined,vt,403);
  await req('/tenants/'+tenant.slug+'/apps/mes/metadata',undefined,vt,403);
  await req(prefix+'/apps/content/metadata',undefined,vt,403);
  await req(prefix+'/apps/geo/metadata',undefined,vt,403);
  await req('/tenants/'+tenant.slug+'/members',undefined,vt,403);
  await req('/tenants/not-my-tenant/applications',undefined,vt,403);
  // The operator creation path uses the same explicit product defaults.
  await db.user.update({where:{id:owner.id},data:{platformRole:'operator'}});
  const opEmail='default-apps-operator-'+randomUUID()+'@example.test';
  const op=await req('/operator/tenants',{slug:'wb-default-'+randomUUID().slice(0,12),name:'运营创建新企业隔离验证',email:opEmail,adminName:'运营创建管理员',password:'Synthetic-QA-'+randomUUID()});tenantIds.push(op.id);
  const opUser=await db.user.findUniqueOrThrow({where:{email:opEmail}});ids.push(opUser.id);
  eq((await db.tenantApp.findMany({where:{tenantId:op.id,enabled:true,granted:true},orderBy:{appId:'asc'},select:{appId:true}})).map(a=>a.appId),expectedApps);
  eq(await db.tenantCapability.count({where:{tenantId:op.id,capability:'knowledge',delivered:true,enabled:true}}),1);
  // Administrator changes survive repeated onboarding and backfill.
  await req(prefix+'/apps/content',{enabled:false},true,200,'PATCH');
  await req(prefix+'/apps/manufacturing',{enabled:false},true,200,'PATCH');
  await req(prefix+'/capabilities/knowledge',{enabled:false},true,200,'PATCH');
  const geoDelivery='/operator/operations/tenants/'+tenant.id+'/apps/geo';
  await req(geoDelivery,{granted:false},true,200,'PUT');
  await db.tenantApp.update({where:{tenantId_appId:{tenantId:tenant.id,appId:'crm'}},data:{enabled:false}});
  await db.tenantApp.update({where:{tenantId_appId:{tenantId:tenant.id,appId:'mes'}},data:{granted:false,enabled:false}});
  const replay=await req('/onboarding/enterprise',{name:'重复提交'});eq(replay.existing,true);
  eq(await db.tenantApp.findUnique({where:{tenantId_appId:{tenantId:tenant.id,appId:'crm'}},select:{enabled:true,granted:true}}),{enabled:false,granted:true});
  eq(await db.tenantApp.findUnique({where:{tenantId_appId:{tenantId:tenant.id,appId:'mes'}},select:{enabled:true,granted:true}}),{enabled:false,granted:false});
  await req(prefix+'/apps/content/metadata',undefined,true,403);
  await req(prefix+'/apps/manufacturing/orders',undefined,true,403);
  await req(prefix+'/apps/geo/metadata',undefined,true,403);
  await req(prefix+'/knowledge/spaces',undefined,true,403);
  await db.tenantApp.delete({where:{tenantId_appId:{tenantId:tenant.id,appId:'mes'}}});
  await req('/onboarding/enterprise',{name:'补齐缺项'});eq(await db.tenantApp.count({where:{tenantId:tenant.id,enabled:true,granted:true,appId:'mes'}}),1);
  eq((await db.$transaction(tx=>ensureDefaultApps(tx,tenant.id))).count,0);
  // A tenant created before GEO was default can still have no GEO delivery row.
  await db.tenantApp.delete({where:{tenantId_appId:{tenantId:tenant.id,appId:'geo'}}});
  await req('/onboarding/enterprise',{name:'已有企业缺少 GEO 交付'});
  eq(await db.tenantApp.count({where:{tenantId:tenant.id,appId:'geo'}}),0);
  // The operator backfill CLI is preview-only until explicitly applied.
  await db.tenantApp.delete({where:{tenantId_appId:{tenantId:tenant.id,appId:'mes'}}});
  const runFill=(apply)=>{
   const receipt='/tmp/wb-default-'+randomUUID()+'.json';
   const args=['scripts/backfill-default-apps.cjs','--tenant='+tenant.slug,'--receipt='+receipt,...(apply?['--apply']:[])];
   try{
    const r=spawnSync(process.execPath,args,{env:process.env,encoding:'utf8'});eq(r.status,0);return JSON.parse(r.stdout);
   }finally{rmSync(receipt,{force:true});}
  };
  eq(runFill(false).missingApps,1);eq(await db.tenantApp.count({where:{tenantId:tenant.id,appId:'mes'}}),0);
  eq(runFill(true).missingApps,1);eq(await db.tenantApp.count({where:{tenantId:tenant.id,appId:'mes',enabled:true,granted:true}}),1);
  eq(runFill(true).missingApps,0);
  eq(await db.tenantApp.count({where:{tenantId:tenant.id,appId:'geo'}}),0);
  eq((await db.tenantApp.findUnique({where:{tenantId_appId:{tenantId:tenant.id,appId:'crm'}}})).enabled,false);
  await req(prefix+'/apps/content',{enabled:true},true,200,'PATCH');
  await req(prefix+'/apps/manufacturing',{enabled:true},true,200,'PATCH');
  await req(prefix+'/capabilities/knowledge',{enabled:true},true,200,'PATCH');
  await req(geoDelivery,{granted:true},true,200,'PUT');
  await req(prefix+'/apps/geo',{enabled:true},true,200,'PATCH');
  eq((await req(prefix+'/applications')).map(a=>a.appId).sort(),['content','erp','geo','manufacturing','mes']);
  await req(prefix+'/knowledge/spaces');
  await req('/onboarding/enterprise',{name:'匿名不能开通'},false,401);
  await db.tenant.update({where:{id:tenant.id},data:{active:false}});await req('/onboarding/enterprise',{name:'停用不能恢复'},true,403);
  eq(await db.tenant.count({where:{selfServiceOwnerId:owner.id}}),1);
  eq(await db.crmMemberGrant.count({where:{tenantId:tenant.id}}),0);eq(await db.mesMemberGrant.count({where:{tenantId:tenant.id}}),0);
  console.log(JSON.stringify({assertions:n,httpChecks:http,apps:expectedApps,knowledge:true,concurrentOnboarding:true,operatorCreation:true,backfillDryRunAndApply:true,existingAppDeliveryPreserved:true,managementDisableAndRestore:true,noRoleEscalation:true,crossTenantDenied:true,modelCalls:0}));
 }finally{
  if(app)await app.close();
  for(const tenantId of tenantIds){for(const table of ['crmSettings','operatorAudit','auditEvent','membershipOrg','orgUnit','tenantCapability','tenantApp','membership'])await db[table].deleteMany({where:{tenantId}});await db.tenant.delete({where:{id:tenantId}});}
  if(ids.length){await db.session.deleteMany({where:{userId:{in:ids}}});await db.user.deleteMany({where:{id:{in:ids}}});}await db.$disconnect();
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
