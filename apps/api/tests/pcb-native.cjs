// Native PCB layout inventory, real files, independent field oracle and authenticated draft boundary.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),{spawnSync}=require('node:child_process');
const {parseNativeDocument}=require('../dist/modules/knowledge/native-parser');
const {decodeFile}=require('../dist/modules/knowledge/knowledge-storage');
const {MesBomIntakeService,reconcileBomTables}=require('../dist/modules/mes/bom-intake.service');
const {createApp}=require('../dist/server'),{PrismaService}=require('../dist/modules/prisma.service'),{AuthService}=require('../dist/modules/platform/auth.service'),{MesService}=require('../dist/modules/mes/mes.service'),{AgentExecutionService}=require('../dist/modules/ai/agent.runtime');
const {createFixture,cleanupFixture,fixtureHttp}=require('../scripts/workflow-fixture.cjs');
const root=path.resolve(__dirname,'../../..'),out=process.env.NATIVE_QA_OUTPUT_DIR;
assert.ok(out&&out.endsWith('20261028-pcb-validation'));
const old=path.join(root,'var/operations/20261027-wenwen-review/sources');
let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;},ok=v=>{assert.ok(v);checks++;};
const source=(filename,bytes)=>({filename,data:bytes.toString('base64')});
const service=new MesBomIntakeService({guard:async()=>{},db:{mesMaterial:{findMany:async()=>[]}}}),ctx={tenantId:'isolated-native-pcb',membershipId:'local',app:{appId:'mes'}};
const files=[['rice-agc-board.PcbDoc',old,76],['rice-rf-proto.PcbDoc',path.join(out,'sources'),53],['rice-wab1x1.PcbDoc',path.join(out,'sources'),41]];
(async()=>{
 const savedFetch=global.fetch;let networkCalls=0;global.fetch=async()=>{networkCalls++;throw Error('Native facts must not invoke a model');};
 let agc,inventory;const report={files:[],fieldComparisons:0};
 try{
  for(const [name,dir,count]of files){
   const bytes=fs.readFileSync(path.join(dir,name));
   const native=spawnSync(process.env.KNOWLEDGE_PYTHON_PATH||'python3',[path.join(root,'apps/api/dist/modules/knowledge/pcb_native.py')],{input:bytes,maxBuffer:4*1024*1024,timeout:15000});
   eq(native.status,0);const data=JSON.parse(native.stdout),gold=JSON.parse(fs.readFileSync(path.join(out,name.replace('.PcbDoc','-independent-components.json'))));
   eq(data.components.length,count);eq(gold.length,count);
   for(let i=0;i<count;i++)for(const field of ['designator','sourceDesignator','footprint','sourceUniqueId','modelHint','x','y','layer']){eq(data.components[i][field],gold[i][field]);report.fieldComparisons++;}
   const chunks=await parseNativeDocument(name,bytes),componentChunks=chunks.filter(c=>c.locator.block==='pcb-component');
   eq(new Set(componentChunks.map(c=>c.locator.componentIndex)).size,count);ok(chunks.every(c=>c.locator.verification==='layout-inventory-only'));
   for(const c of data.components){const found=componentChunks.filter(x=>x.locator.componentIndex===c.index);ok(found.length>0);ok(found.some(x=>x.text.includes('板上实际位号：'+c.designator)));ok(found.every(x=>x.locator.sourceUniqueId===c.sourceUniqueId));}
   const bom=await service.intake(ctx,{kind:'bom',source:{documents:[source(name,bytes)]}}),lines=bom.groups.flatMap(g=>g.lines);
   eq(lines.length,count);ok(lines.every(l=>l.quantityBasis==='pcb-object-count'&&l.conflict&&l.material===null));ok(lines.every(l=>l.locator.verification==='layout-inventory-only'));ok(bom.groups.every(g=>g.uncertainties.some(x=>x.includes('布局对象'))));
   if(name==='rice-agc-board.PcbDoc'){agc=bom;inventory=data;eq(lines.filter(l=>l.quantity===null).length,9);ok(lines.every(l=>l.mpn===''&&l.population==='UNKNOWN'));eq(lines.find(l=>l.sourceDesignators==='U3').sourceDesignator,'U1');const range=lines.find(l=>l.sourceDesignators==='R[3-6]');eq(range.designators,[]);eq(range.quantity,'1');}
   fs.writeFileSync(path.join(out,name+'.native-knowledge.json'),JSON.stringify(chunks,null,2));fs.writeFileSync(path.join(out,name+'.native-bom.json'),JSON.stringify(bom,null,2));
   report.files.push({name,components:count,chunks:chunks.length,bomRows:lines.length});
  }
  // Native labels are not CSV ranges, and library display names do not auto-match materials.
  const synthetic=reconcileBomTables({tables:[{file:'native.PcbDoc',table:1,method:'altium-pcb6',verification:'layout-inventory-only',rows:[{name:'same library name',designators:'R1-R4',quantity:'1',quantityBasis:'pcb-object-count',sourceRow:1,rawCells:[],confidence:100}]}],sources:[],pageCount:0},[{id:'x',sku:'X',name:'same library name',unit:'件',kind:'raw'}]);
  eq(synthetic.groups[0].lines[0].designators,[]);eq(synthetic.groups[0].lines[0].material,null);
  for(const name of ['wrong-count.PcbDoc','unknown-text-layout.PcbDoc','broken-wide.PcbDoc','unknown-version.PcbDoc']){
   const bytes=fs.readFileSync(path.join(out,'fixtures',name));await assert.rejects(()=>parseNativeDocument(name,bytes));checks++;await assert.rejects(()=>service.intake(ctx,{kind:'bom',source:{documents:[source(name,bytes)]}}));checks++;
  }
  const dni=await service.intake(ctx,{kind:'bom',source:{documents:[source('explicit-dni.PcbDoc',fs.readFileSync(path.join(out,'fixtures/explicit-dni.PcbDoc')))]}});eq(dni.groups[0].lines[0].population,'DNI');ok(dni.groups[0].lines[0].excluded&&dni.groups[0].lines[0].doNotPopulate);eq(dni.groups[0].lines[0].quantity,null);
  const mpn=await service.intake(ctx,{kind:'bom',source:{documents:[source('explicit-mpn.PcbDoc',fs.readFileSync(path.join(out,'fixtures/explicit-mpn.PcbDoc')))]}});eq(mpn.groups[0].lines[0].mpn,'PART-12345');eq(mpn.groups[0].lines[0].material,null);
  const duplicate=await service.intake(ctx,{kind:'bom',source:{documents:[source('duplicate-ref.PcbDoc',fs.readFileSync(path.join(out,'fixtures/duplicate-ref.PcbDoc')))]}});
  const u1=duplicate.groups[0].lines.filter(x=>x.sourceDesignators==='U1');eq(u1.length,2);ok(u1.every(x=>x.conflict&&x.reviewReasons.some(x=>x.includes('重复'))));
  for(const disguised of ['rice-agc-top.SchDoc','bbb-bom.xls']){const bytes=fs.readFileSync(path.join(old,disguised));await assert.rejects(()=>parseNativeDocument('fake.PcbDoc',bytes));checks++;await assert.rejects(()=>service.intake(ctx,{kind:'bom',source:{documents:[source('fake.PcbDoc',bytes)]}}));checks++;}
  assert.throws(()=>decodeFile('fake.PcbDoc',Buffer.from('not CFB').toString('base64')));checks++;
  const brd=fs.readFileSync(path.join(out,'sources/beaglebone-revd.brd'));ok(brd.length>8*1024*1024);
  // Whole-file size and unsupported-format checks are distinct from CAD decoding.
  await assert.rejects(()=>service.intake(ctx,{kind:'bom',source:{documents:[source('oversize.PcbDoc',brd)]}}));checks++;
  await assert.rejects(()=>service.intake(ctx,{kind:'bom',source:{documents:[source('unsupported.brd',brd.subarray(0,100))]}}),e=>e.message.includes('其他原生'));checks++;
  await assert.rejects(()=>parseNativeDocument('unsupported.brd',brd),e=>e.code==='DOCUMENT_FORMAT_UNSUPPORTED');checks++;
  eq(networkCalls,0);
 }finally{global.fetch=savedFetch;}
 assert.match(process.env.DATABASE_URL||'',/@127\.0\.0\.1:54329\/suite_phase1_qa/);
 const db=new PrismaService();let app,f,modelCalls=0,foreign;
 try{
  app=await createApp();f=await createFixture(db,'erp-flow-test-pcb-'+randomUUID().slice(0,8));await db.tenantApp.create({data:{tenantId:f.tenant.id,appId:'mes'}});
  app.get(AgentExecutionService).complete=async()=>{modelCalls++;throw Error('No model invocation for native PCB');};
  const h=await fixtureHttp(app,f),prefix=`/tenants/${f.tenant.slug}/apps/mes`,mes=app.get(MesService),context=await app.get(AuthService).taskContext({tenantId:f.tenant.id,userId:f.accounts.admin.userId,membershipId:f.accounts.admin.memberId,appId:'mes',taskId:randomUUID()});
  const material=async(sku,kind)=>mes.saveMaterial(context,undefined,{requestKey:randomUUID(),sku,name:sku,kind,unit:'件'});
  const fg=await material('PCB-ASSY','finished'),raw=await material('MCU-VERIFIED','raw');
  const before=[await db.mesBom.count({where:{tenantId:f.tenant.id}}),await db.aiModelUsage.count({where:{tenantId:f.tenant.id}})];
  const options=(await h.request(prefix+'/boms/intake/options')).data;ok(options.formats.includes('pcbdoc'));
  const docs=[source('rice-agc-board.PcbDoc',fs.readFileSync(path.join(old,'rice-agc-board.PcbDoc')))];
  const result=(await h.request(prefix+'/boms/intake','POST',{kind:'bom',productId:fg.id,source:{documents:docs}},'admin',201)).data;eq(result.totalRows,76);
  eq([await db.mesBom.count({where:{tenantId:f.tenant.id}}),await db.aiModelUsage.count({where:{tenantId:f.tenant.id}})],before);
  const l=result.groups[0].lines.find(x=>x.sourceDesignators==='U3'),loc=l.locator;
  const evidence={filename:loc.filename,sha256:loc.sha256,page:loc.page,sheet:loc.sheet,table:loc.table,row:loc.row,method:loc.method,originalSku:l.sku,originalQuantity:l.sourceQuantity,mpn:l.mpn,manufacturer:l.manufacturer,designators:l.designators,population:l.population,revision:l.revision,productCode:l.productCode,sourceObjectId:l.sourceObjectId,sourceDesignator:l.sourceDesignator,sourceDesignators:l.sourceDesignators,sourceUniqueId:l.sourceUniqueId,sourceHierarchy:l.sourceHierarchy,footprint:l.footprint,quantityBasis:l.quantityBasis,hasConflict:false,factReviewed:false,reviewed:true};
  const save=(ev,materialId=raw.id,status=400)=>h.request(prefix+'/boms','POST',{requestKey:randomUUID(),draft:{productId:fg.id,lines:[{materialId,quantity:'1',sourceEvidence:ev}]}},'admin',status);
  await save(evidence);checks++;await save({...evidence,factReviewed:true,population:'DNI'});checks++;
  foreign=await db.tenant.create({data:{slug:'erp-flow-test-pcb-foreign-'+randomUUID().slice(0,8),name:'PCB QA隔离'}});const other=await db.mesMaterial.create({data:{tenantId:foreign.id,sku:'FOREIGN',name:'foreign',kind:'raw',unit:'件'}});
  await save({...evidence,factReviewed:true},other.id,409);checks++;
  await h.request(prefix+'/boms/intake','POST',{kind:'bom',source:{documents:docs}},'sales',403);checks++;
  const saved=(await h.request(prefix+'/boms','POST',{requestKey:randomUUID(),draft:{productId:fg.id,lines:[{materialId:raw.id,quantity:'1',sourceEvidence:{...evidence,hasConflict:true,factReviewed:true}}]}},'admin',201)).data;
  eq(saved.status,'draft');eq(saved.lines[0].sourceEvidence.sourceDesignator,'U1');eq(saved.lines[0].sourceEvidence.designators,['U3']);eq(saved.lines[0].sourceEvidence.sourceUniqueId,l.sourceUniqueId);eq(saved.lines[0].sourceEvidence.quantityBasis,'pcb-object-count');eq(saved.lines[0].sourceEvidence.footprint,l.footprint);
  // Persistence is verified directly, not only by a response echo.
  const stored=(await db.mesBom.findUniqueOrThrow({where:{id:saved.id}})).lines[0];eq(stored.sourceEvidence.sourceUniqueId,l.sourceUniqueId);eq(stored.sourceEvidence.factReviewed,true);eq(stored.sourceEvidence.sourceDesignators,'U3');
  eq(await db.mesBom.count({where:{tenantId:f.tenant.id}}),before[0]+1);eq(await db.aiModelUsage.count({where:{tenantId:f.tenant.id}}),before[1]);eq(modelCalls,0);
  Object.assign(report,{assertions:checks,httpChecks:h.checks(),networkCalls,modelCalls,verification:'layout-inventory-only',drcRun:false});
  fs.writeFileSync(path.join(out,'pcb-native-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{if(app)await app.close();if(foreign){await db.mesMaterial.deleteMany({where:{tenantId:foreign.id}});await db.tenant.delete({where:{id:foreign.id}});}if(f)await cleanupFixture(db,f);await db.$disconnect();}
})().catch(e=>{console.error(e);process.exitCode=1;});
