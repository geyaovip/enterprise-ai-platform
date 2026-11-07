// Dry run by default. Application grants only; no AI/model, roles or subscription writes.
const fs=require('node:fs');
const {PrismaService}=require('../dist/modules/prisma.service');
const {DEFAULT_APP_IDS,ensureDefaultApps}=require('../dist/modules/platform/default-apps');
(async()=>{
 const args=process.argv.slice(2),apply=args.includes('--apply'),all=args.includes('--all-active'),slug=args.find(a=>a.startsWith('--tenant='))?.slice(9),out=args.find(a=>a.startsWith('--receipt='))?.slice(10);
 if(args.some(a=>!['--apply','--all-active'].includes(a)&&!a.startsWith('--tenant=')&&!a.startsWith('--receipt=')))throw Error('Unknown argument');
 if(apply&&(!out||all===Boolean(slug)))throw Error('Apply requires --receipt=PATH and exactly one of --all-active or --tenant=SLUG');
 if(out&&fs.existsSync(out))throw Error('Receipt already exists; preserve it');
 const db=new PrismaService(),report={at:new Date().toISOString(),apply,apps:DEFAULT_APP_IDS,tenants:[]};
 if(out)fs.writeFileSync(out,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
 try{
  const tenants=await db.tenant.findMany({where:{active:true,...(slug?{slug}:{})},select:{id:true,slug:true},orderBy:{id:'asc'}});
  for(const t of tenants){
   const r=await db.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${t.id+':default-apps'},0))`;
    if(!await tx.tenant.findFirst({where:{id:t.id,active:true}}))return {tenantId:t.id,status:'inactive'};
    const old=await tx.tenantApp.findMany({where:{tenantId:t.id},select:{id:true,appId:true,enabled:true,granted:true}}),missing=DEFAULT_APP_IDS.filter(id=>!old.some(a=>a.appId===id));
    const sub=await tx.tenantSubscription.findUnique({where:{tenantId:t.id}});
    if(sub&&missing.some(id=>!(sub.entitlement?.appIds??[]).includes(id)))return {tenantId:t.id,status:'subscription_review',missing,preserved:old};
    const admin=await tx.membership.findFirst({where:{tenantId:t.id,active:true,role:'admin',user:{active:true}},orderBy:{id:'asc'},select:{id:true,userId:true}});
    if(apply&&missing.length&&!admin)return {tenantId:t.id,status:'no_active_admin',missing,preserved:old};
    if(apply&&missing.length){
     await ensureDefaultApps(tx,t.id);
     await tx.operatorAudit.create({data:{tenantId:t.id,userId:'system:default-apps-backfill',action:'platform.apps.default_fill',resourceId:t.id,detail:{source:'backfill-default-apps',insertedAppIds:missing,activeAdminMembershipId:admin.id}}});
    }
    return {tenantId:t.id,status:apply?'applied':'dry_run',missing,preserved:old};
   });
   report.tenants.push(r);
   // Keep a durable partial receipt if a later tenant fails. No credentials are recorded.
   if(out)fs.writeFileSync(out,JSON.stringify(report,null,2),{mode:0o600});
  }
  console.log(JSON.stringify({apply,tenants:report.tenants.length,missingApps:report.tenants.reduce((n,t)=>n+(t.missing?.length??0),0),review:report.tenants.filter(t=>['subscription_review','no_active_admin'].includes(t.status)).length,receipt:out??null}));
 }finally{await db.$disconnect();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
