const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {createApp}=require('../dist/server'),{PrismaService}=require('../dist/modules/prisma.service'),{AuthService}=require('../dist/modules/platform/auth.service'),{MesService}=require('../dist/modules/mes/mes.service'),{AgentExecutionService}=require('../dist/modules/ai/agent.runtime');
const {createFixture,cleanupFixture,fixtureHttp}=require('../scripts/workflow-fixture.cjs');
const {compatibleHistory}=require('../dist/modules/mes/bom-history');
const {ForbiddenException}=require('@nestjs/common');
const out=process.env.BOM_HISTORY_QA_OUTPUT_DIR;assert.ok(/20261028-bom-(local-r2|scan-r3)$/.test(out??''));
assert.match(process.env.DATABASE_URL||'',/@127\.0\.0\.1:54329\/suite_phase1_qa/);
const db=new PrismaService();let app,f,foreign,checks=0,modelCalls=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;},ok=x=>{assert.ok(x);checks++;};
(async()=>{
 try{
  app=await createApp();f=await createFixture(db,'erp-flow-test-history-'+randomUUID().slice(0,8));await db.tenantApp.create({data:{tenantId:f.tenant.id,appId:'mes'}});
  app.get(AgentExecutionService).complete=async()=>{modelCalls++;throw Error('History must not call model');};
  const h=await fixtureHttp(app,f),mes=app.get(MesService),ctx=await app.get(AuthService).taskContext({tenantId:f.tenant.id,userId:f.accounts.admin.userId,membershipId:f.accounts.admin.memberId,appId:'mes',taskId:randomUUID()}),prefix=`/tenants/${f.tenant.slug}/apps/mes`;
  const material=async(sku,kind='raw',unit='件')=>mes.saveMaterial(ctx,undefined,{requestKey:randomUUID(),sku,name:sku,kind,unit});
  const fg=await material('HISTORY-FG','finished'),otherFg=await material('OTHER-FG','finished'),raw=await material('HIST-RAW'),kg=await material('KG-RAW','raw','kg');
  await mes.saveMaterial(ctx,undefined,{requestKey:randomUUID(),sku:'VALUE-ONLY',name:'10k',kind:'raw',unit:'件'});
  const evidence={filename:'approved.csv',sha256:'a'.repeat(64),page:null,sheet:null,table:1,row:2,method:'text-cells',originalSku:raw.sku,originalQuantity:'7',originalUnit:'件',mpn:'ABC123FN',manufacturer:'Maker',footprint:'0603',revision:'A',population:'YES',reviewed:true,factReviewed:true};
  const publish=async(productId,lines)=>{let b=await mes.saveBom(ctx,undefined,{requestKey:randomUUID(),draft:{productId,lines}});return mes.publishBom(ctx,b.id,{requestKey:randomUUID(),version:b.version});};
  const approved=await publish(fg.id,[{materialId:raw.id,quantity:'7',sourceEvidence:evidence}]),other=await publish(otherFg.id,[{materialId:raw.id,quantity:'7',sourceEvidence:evidence}]);
  foreign=await db.tenant.create({data:{slug:'erp-flow-test-history-foreign-'+randomUUID().slice(0,8),name:'isolated history QA'}});
  const foreignFg=await db.mesMaterial.create({data:{tenantId:foreign.id,sku:fg.sku,name:'foreign fg',kind:'finished',unit:'件'}}),foreignRaw=await db.mesMaterial.create({data:{tenantId:foreign.id,sku:raw.sku,name:'foreign raw',kind:'raw',unit:'件'}}),foreignMember=await db.membership.create({data:{tenantId:foreign.id,userId:f.accounts.admin.userId,role:'admin'}});
  const foreignBom=await db.mesBom.create({data:{tenantId:foreign.id,productId:foreignFg.id,productSku:fg.sku,productName:'foreign',revision:1,status:'published',createdBy:foreignMember.id,lines:[{materialId:foreignRaw.id,quantity:'900',sourceEvidence:evidence}]}});
  const text=(extra={})=>{const v={mpn:'ABC123FN',manufacturer:'Maker',qty:'2',footprint:'0603',revision:'A',...extra};return `MPN,Manufacturer,Qty,Footprint,Revision,Unit\n${v.mpn},${v.manufacturer},${v.qty},${v.footprint},${v.revision},pcs`;};
  const intake=async(value=text(),productId=fg.id)=>(await h.request(prefix+'/boms/intake','POST',{kind:'bom',...(productId?{productId}:{}),source:{text:value}},'admin',201)).data;
  const line=r=>r.groups[0].lines[0];const candidates=r=>line(r).historyCandidates??[];
  const countBefore=await db.mesBom.count({where:{tenantId:f.tenant.id}});
  let r=await intake(),l=line(r);eq(candidates(r).length,1);eq(candidates(r)[0].material.id,raw.id);eq(candidates(r)[0].bom,{bomId:approved.id,revision:approved.revision,version:approved.version});eq(l.material,null);eq(l.quantity,'2');eq(l.population,'');eq(await db.mesBom.count({where:{tenantId:f.tenant.id}}),countBefore);
  r=await intake(text({qty:''}));eq(line(r).quantity,null);eq(candidates(r).length,1);ok(!('quantity'in candidates(r)[0]));
  for(const extra of [{mpn:'ABC123'},{mpn:'ABC123FN0'},{manufacturer:'OtherMaker'},{manufacturer:''},{mpn:'~'},{mpn:'N/A'},{footprint:'0805'},{revision:'B'}])eq(candidates(await intake(text(extra))).length,0);
  eq(candidates(await intake(text(),null)).length,0);
  const input={filename:'scope.csv',productCode:'DIFFERENT',data:Buffer.from(text()).toString('base64')};r=(await h.request(prefix+'/boms/intake','POST',{kind:'bom',productId:fg.id,source:{documents:[input]}},'admin',201)).data;eq(candidates(r).length,0);
  await db.mesMaterial.update({where:{id:raw.id},data:{active:false}});eq(candidates(await intake()).length,0);await db.mesMaterial.update({where:{id:raw.id},data:{active:true}});
  const original=mes.guard;
  try{
   mes.guard=async function(c,p,...args){if(p==='mes.bom.read')throw new ForbiddenException();return original.call(this,c,p,...args)};eq(candidates(await intake()).length,0);
   let reads=0;mes.guard=async function(c,p,...args){if(p==='mes.bom.read'&&++reads>1)throw new ForbiddenException();return original.call(this,c,p,...args)};eq(candidates(await intake()).length,0);
  }finally{mes.guard=original;}
  // A historical row without a review, a DNI or a different package is ineligible.
  const current={mpn:'ABC123FN',manufacturer:'Maker',footprint:'0603',revision:'A'};
  ok(compatibleHistory(current,{sourceEvidence:evidence}));
  for(const extra of [{reviewed:false},{population:'DNI'},{hasConflict:true,factReviewed:false},{quantityBasis:'pcb-object-count',factReviewed:false},{mpn:'ABC123FN9'},{manufacturer:'Other'},{footprint:'0805'},{revision:'B'}])ok(!compatibleHistory(current,{sourceEvidence:{...evidence,...extra}}));
  ok(!compatibleHistory({...current,mpn:'~'},{sourceEvidence:{...evidence,mpn:'~'}}));ok(!compatibleHistory({...current,manufacturer:'~'},{sourceEvidence:{...evidence,manufacturer:'~'}}));
  // Common EDA fields must not invert DNP=false or treat distributor codes as MPNs.
  r=await intake('Reference,Qty,Value,DNP,Exclude from BOM,Footprint\nR1,1,10k,false,false,0603\nR2,1,10k,true,false,0603\nR3,1,10k,false,true,0603\nR4,1,10k,maybe,false,0603');
  const flags=r.groups[0].lines;eq(flags.length,4);eq(flags[0].doNotPopulate,false);eq(flags[0].quantity,'1');eq(flags[0].material,null);eq(flags[0].identityHintOnly,true);ok(flags[1].doNotPopulate&&flags[1].excluded);eq(flags[1].quantity,null);ok(flags[2].doNotPopulate&&flags[2].excluded);eq(flags[2].population,'EXCLUDED FROM BOM');eq(flags[3].quantity,null);eq(flags[3].conflict,true);
  r=await intake('Description,Qty,Order code,Supplier,Manufacturer\nConnector,2,SELLER-99,Shop,Maker');eq(line(r).mpn,'');
  r=await intake();l=line(r);const loc=l.locator,chosen=candidates(r)[0].bom;
  const source={filename:loc.filename,sha256:loc.sha256,page:loc.page,sheet:loc.sheet,table:loc.table,row:loc.row,method:loc.method,originalSku:l.sku,originalQuantity:l.sourceQuantity,originalUnit:l.sourceUnit,mpn:l.mpn,manufacturer:l.manufacturer,footprint:l.footprint,revision:l.revision,population:l.population,historyMatch:chosen,factReviewed:true,reviewed:true};
  const save=(sourceEvidence,status=201,materialId=raw.id,quantity='2')=>h.request(prefix+'/boms','POST',{requestKey:randomUUID(),draft:{productId:fg.id,lines:[{materialId,quantity,sourceEvidence}]}},'admin',status);
  await save({...source,factReviewed:false,hasConflict:false},400);checks++;
  await save({...source,historyMatch:{...chosen,bomId:foreignBom.id}},409);checks++;
  await save({...source,historyMatch:{...chosen,bomId:other.id}},409);checks++;
  await save({...source,historyMatch:{...chosen,version:chosen.version+1}},409);checks++;
  const saved=(await save(source)).data;eq(saved.lines[0].quantity,'2');eq(saved.lines[0].sourceEvidence.historyMatch.bomId,approved.id);eq(saved.lines[0].sourceEvidence.population,'');
  const stored=(await db.mesBom.findUniqueOrThrow({where:{id:saved.id}})).lines[0];eq(stored.sourceEvidence.historyMatch,chosen);
  await save({...source,historyMatch:undefined,originalUnit:'pcs',factReviewed:false},409,kg.id);checks++;
  const converted=(await save({...source,historyMatch:undefined,originalUnit:'pcs'},201,kg.id,'0.002')).data;eq(converted.lines[0].quantity,'0.002');eq(converted.lines[0].sourceEvidence.originalUnit,'pcs');
  // A new revision copied from a published history-derived BOM must reference
  // that reviewed published snapshot, rather than its now-archived ancestor.
  const derived=await mes.saveBom(ctx,undefined,{requestKey:randomUUID(),draft:{productId:otherFg.id,lines:[{materialId:raw.id,quantity:'2',sourceEvidence:{...source,historyMatch:{bomId:other.id,revision:other.revision,version:other.version}}}]}});
  const reviewed=await mes.publishBom(ctx,derived.id,{requestKey:randomUUID(),version:derived.version});
  const copy=await mes.saveBom(ctx,undefined,{requestKey:randomUUID(),draft:{productId:otherFg.id,lines:[{materialId:raw.id,quantity:'2',sourceEvidence:{...reviewed.lines[0].sourceEvidence,historyMatch:{bomId:reviewed.id,revision:reviewed.revision,version:reviewed.version}}}]}});eq(copy.status,'draft');eq(copy.lines[0].sourceEvidence.historyMatch.bomId,reviewed.id);
  const alternatives=[];for(let i=0;i<4;i++)alternatives.push(await material('ALT-'+i));
  const replacement=await publish(fg.id,alternatives.map(m=>({materialId:m.id,quantity:'7',sourceEvidence:evidence})));
  await save(source,409);checks++;
  await h.request(prefix+`/boms/${saved.id}/publish`,'POST',{requestKey:randomUUID(),version:saved.version},'admin',409);checks++;
  eq((await db.mesBom.findUniqueOrThrow({where:{id:replacement.id}})).status,'published');
  r=await intake();eq(candidates(r).length,3);eq(line(r).historyCandidatesTruncated,true);eq(line(r).material,null);
  eq(modelCalls,0);eq(await db.aiModelUsage.count({where:{tenantId:f.tenant.id}}),0);
  const report={assertions:checks,httpChecks:h.checks(),modelCalls,history:'published/current-tenant/product only; explicit reviewed identity; candidates not auto adoption',coverage:['MPN/manufacturer/package/revision boundaries','no historical quantity or fitted transfer','no read permission and revocation','cross-tenant/product and stale versions','save and publish revalidation','DNP inversion/exclusion and unknown flag','explicit unit conversion review']};fs.writeFileSync(path.join(out,'history-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{if(app)await app.close();if(foreign){await db.mesBom.deleteMany({where:{tenantId:foreign.id}});await db.mesMaterial.deleteMany({where:{tenantId:foreign.id}});await db.membership.deleteMany({where:{tenantId:foreign.id}});await db.tenant.delete({where:{id:foreign.id}});}if(f)await cleanupFixture(db,f);await db.$disconnect();}
})().catch(e=>{console.error(e);process.exitCode=1});
