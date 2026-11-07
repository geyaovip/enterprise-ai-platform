// Real local parser + isolated PostgreSQL + authenticated API. No model fixtures or paid calls.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {createApp}=require('../dist/server'),{PrismaService}=require('../dist/modules/prisma.service'),{AuthService}=require('../dist/modules/platform/auth.service'),{MesService}=require('../dist/modules/mes/mes.service'),{AgentExecutionService}=require('../dist/modules/ai/agent.runtime');
const {exactBomQuantity,reconcileBomTables}=require('../dist/modules/mes/bom-intake.service');
const {createFixture,cleanupFixture,fixtureHttp}=require('../scripts/workflow-fixture.cjs');
const root=path.resolve(__dirname,'../../..'),fixtureDir=process.env.BOM_INTAKE_FIXTURES;
const source=(filename,content)=>({filename,data:Buffer.from(content).toString('base64')});
const files=names=>names.map(name=>source(name,fs.readFileSync(path.join(fixtureDir,name))));
const table=(rows,extra={})=>({file:'test.csv',table:1,method:'text-cells',rows:rows.map((r,n)=>({sourceRow:n+2,rawCells:Object.values(r),confidence:100,...r})),...extra});
const parsed=tables=>({tables,sources:[],pageCount:0});
(async()=>{
 assert.match(process.env.DATABASE_URL??'',/@127\.0\.0\.1:54329\/suite_phase1_qa/);assert.equal(process.env.NATIVE_AI_MODEL_ENABLED,'false');
 const db=new PrismaService();let app,f,foreignTenant,checks=0,modelCalls=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};const ok=x=>{assert.ok(x);checks++;};
 try{
  app=await createApp();f=await createFixture(db,'erp-flow-test-'+randomUUID().slice(0,8));await db.tenantApp.create({data:{tenantId:f.tenant.id,appId:'mes'}});
  app.get(AgentExecutionService).complete=async()=>{modelCalls++;throw Error('No model invocation is allowed in local BOM intake');};
  const h=await fixtureHttp(app,f),prefix=`/tenants/${f.tenant.slug}/apps/mes`,mes=app.get(MesService),ctx=await app.get(AuthService).taskContext({tenantId:f.tenant.id,userId:f.accounts.admin.userId,membershipId:f.accounts.admin.memberId,appId:'mes',taskId:randomUUID()});
  const material=async(sku,kind='raw',name=sku,unit='件')=>mes.saveMaterial(ctx,undefined,{requestKey:randomUUID(),sku,name,kind,unit});
  const fg=await material('FG-01','finished'),sub=await material('SUB-01','semi'),raw=await material('RAW-01','raw','钢板'),leading=await material('000050','raw','螺钉'),raw2=await material('RAW-02','raw','垫片');
  const intake=async(source,extra={},status=201)=>(await h.request(prefix+'/boms/intake','POST',{kind:'bom',source,...extra},'admin',status)).data;
  const options=(await h.request(prefix+'/boms/intake/options')).data;eq(options.local,true);ok(options.formats.includes('pdf')&&options.formats.includes('xlsx'));
  // Local capability remains available while AI model invocation is closed.
  const baseline=[await db.mesBom.count({where:{tenantId:f.tenant.id}}),await db.aiModelUsage.count({where:{tenantId:f.tenant.id}})];
  let r=await intake({text:'父件编码\t物料编码\t物料名称\t单件用量\t单位\nFG-01\tRAW-01\t钢板\t2\t件\nSUB-01\t000050\t螺钉\t4\t件'});eq(r.groups.length,2);eq(r.groups[0].product.id,fg.id);eq(r.groups[1].product.id,sub.id);eq(r.groups[0].lines[0].material.id,raw.id);eq(r.groups[1].lines[0].sku,'000050');eq(r.groups[1].lines[0].quantity,'4');
  r=await intake({documents:[source('quoted.csv','物料编码,物料名称,单件用量,单位\n000050,"螺钉,规格A",1/2,件')]},{productId:fg.id});eq(r.groups[0].product.id,fg.id);eq(r.groups[0].lines[0].quantity,'0.5');eq(r.groups[0].lines[0].material.id,leading.id);ok(r.groups[0].lines[0].locator.sha256.length===64);
  const evidence=r.groups[0].lines[0].locator;
  const draft=await mes.saveBom(ctx,undefined,{requestKey:randomUUID(),draft:{productId:fg.id,lines:[{materialId:leading.id,quantity:'0.5',sourceEvidence:{filename:evidence.filename,sha256:evidence.sha256,page:evidence.page,sheet:evidence.sheet,table:evidence.table,row:evidence.row,method:evidence.method,originalSku:'000050',originalQuantity:'1/2',reviewed:true}}]}});eq(draft.status,'draft');eq(draft.lines[0].sourceEvidence.sha256,evidence.sha256);eq(draft.lines[0].quantity,'0.5');
  const sourceEvidence={filename:evidence.filename,sha256:evidence.sha256,page:evidence.page,sheet:evidence.sheet,table:evidence.table,row:evidence.row,method:evidence.method,originalSku:'000050',originalQuantity:'1/2',reviewed:true};
  for(const extra of [{population:'DNI'},{hasConflict:true,factReviewed:false}])await h.request(prefix+'/boms','POST',{requestKey:randomUUID(),draft:{productId:fg.id,lines:[{materialId:leading.id,quantity:'0.5',sourceEvidence:{...sourceEvidence,...extra}}]}},'admin',400);
  r=await intake({text:'父件编码,物料编码,单件用量,单位\nFG-01,RAW-01,,件\nFG-01,RAW-01,3,件'});eq(r.groups[0].lines.length,2);eq(r.groups[0].lines[0].quantity,null);ok(r.groups[0].lines.every(l=>l.duplicate));ok(r.groups[0].lines[0].reviewReasons.some(x=>x.includes('冲突')));
  r=await intake({text:'父件编码,物料编码,单件用量,单位\nFG-01,RAW-01,2,箱'});eq(r.groups[0].lines[0].quantity,null);eq(r.groups[0].lines[0].unitConflict,true);
  r=await intake({text:'父件编码,物料编码,单件用量\nFG-01,RAW-01,2件'});eq(r.groups[0].lines[0].quantity,'2');eq(r.groups[0].lines[0].unit,'件');
  r=await intake({text:'层级,物料编码,物料名称,单件用量,单位\n0,FG-01,成品,1,件\n1,SUB-01,子装配,2,件\n2,RAW-01,钢板,3,件\n1,000050,螺钉,4,件'});eq(r.groups.length,2);eq(r.groups[0].lines.map(l=>l.sku),['SUB-01','000050']);eq(r.groups[1].parentSku,'SUB-01');eq(r.groups[1].lines[0].quantity,'3');
  // Explicitly adopt each assembly through the real domain, then verify exact multi-level requirements.
  let parentBom;
  for(const g of [...r.groups].reverse()){
    const b=await mes.saveBom(ctx,undefined,{requestKey:randomUUID(),draft:{productId:g.product.id,lines:g.lines.map(l=>({materialId:l.material.id,quantity:l.quantity,wastePercent:'0'}))}});
    await mes.publishBom(ctx,b.id,{requestKey:randomUUID(),version:b.version});if(g.parentSku==='FG-01')parentBom=b;
  }
  const explosion=await mes.explode(ctx,parentBom,10);eq(explosion.requirements.find(l=>l.sku==='RAW-01').quantity,'60.000');eq(explosion.requirements.find(l=>l.sku==='000050').quantity,'40.000');
  await h.request(prefix+'/boms','POST',{requestKey:randomUUID(),draft:{productId:fg.id,lines:[{materialId:raw.id,quantity:''}]}},'admin',400);
  r=await intake({text:'父件编码,物料编码,单件用量\nFG-01,SUB-01,1\nSUB-01,FG-01,1'});ok(r.groups.every(g=>g.cycle));
  r=await intake({text:'物料编码,物料名称\nRAW-01,钢板'});eq(r.groups[0].lines[0].quantity,null);
  r=await intake({text:'物料编码,数量,单件用量\nRAW-01,2,3'});eq(r.groups[0].lines[0].quantity,null);ok(r.groups[0].lines[0].reviewReasons.some(x=>x.includes('重复含义')));
  r=await intake({text:'这是一张加工图，外径20mm，长度50mm。'});eq(r.totalRows,0);ok(r.uncertainties[0].includes('不能据外形'));
  await intake({documents:[source('same.csv','物料编码,数量\nRAW-01,2'),source('copy.csv','物料编码,数量\nRAW-01,2')]},{},400);
  await intake({documents:[source('same.csv','物料编码,数量\nRAW-01,2'),source('same.csv','物料编码,数量\nRAW-01,3')]},{},400);
  await intake({documents:[source('evil.svg','<svg/>')]},{},400);await intake({documents:[source('broken.pdf','not pdf')]},{},400);
  await intake({documents:[{filename:'bad.csv',data:'@@@@'}]},{},400);
  await intake({text:'物料编码,数量\nRAW-01,2'},{productId:randomUUID()},400);
  await h.request(prefix+'/boms/intake','POST',{kind:'bom',source:{text:'物料编码,数量\nRAW-01,2'}},'sales',403);
  foreignTenant=await db.tenant.create({data:{slug:'erp-flow-test-bom-foreign-'+randomUUID().slice(0,8),name:'BOM隔离测试'}});
  const foreign=await db.mesMaterial.create({data:{tenantId:foreignTenant.id,sku:'OTHER-ONLY',name:'test',unit:'件',kind:'raw'}});
  r=await intake({text:'物料编码,单件用量\nOTHER-ONLY,2'});eq(r.groups[0].lines[0].material,null);
  await intake({text:'物料编码,单件用量\nRAW-01,2'},{productId:foreign.id},400);
  // Unknown/foreign identities never resolve by a fabricated model ID or arbitrary name fallback.
  r=await intake({text:'物料编码,单件用量\nNOT-EXISTS,2'});eq(r.groups[0].lines[0].material,null);eq(r.groups[0].lines[0].status,'unmatched');
  eq(exactBomQuantity('1/3'),null);eq(exactBomQuantity('1,000'),null);eq(exactBomQuantity('0'),null);eq(exactBomQuantity('1e3'),null);eq(exactBomQuantity('.5'),'0.5');eq(exactBomQuantity('0.001'),'0.001');eq(exactBomQuantity('999999999'),'999999999');eq(exactBomQuantity('1000000000'),null);eq(exactBomQuantity('2.0000'),'2');
  let privateResult=reconcileBomTables(parsed([table([{sku:'RAW-01',quantity:'2'}])]),[{...raw,id:randomUUID(),name:'A'},{...raw,id:randomUUID(),name:'B'}]);eq(privateResult.groups[0].lines[0].status,'ambiguous');
  // Verify the expanded editor/domain limit with a real import and save above the former 50-line cap.
  await db.mesMaterial.createMany({data:Array.from({length:60},(_,i)=>({tenantId:f.tenant.id,sku:'BULK-'+String(i+1).padStart(3,'0'),name:'大清单组件'+i,kind:'raw',unit:'件'}))});
  r=await intake({text:'父件编码,物料编码,单件用量,单位\n'+Array.from({length:60},(_,i)=>`FG-01,BULK-${String(i+1).padStart(3,'0')},2,件`).join('\n')});eq(r.totalRows,60);ok(r.groups[0].lines.every(l=>l.material&&l.quantity==='2'));
  const largeDraft=await mes.saveBom(ctx,undefined,{requestKey:randomUUID(),draft:{productId:fg.id,lines:r.groups[0].lines.map(l=>({materialId:l.material.id,quantity:l.quantity}))}});eq(largeDraft.lines.length,60);
  // A revoked permission while parsing is running is checked again before returning data.
  const service=app.get(require('../dist/modules/mes/bom-intake.service').MesBomIntakeService),originalGuard=mes.guard;let guardCalls=0;
  mes.guard=async(...args)=>{guardCalls++;if(guardCalls>2)throw new (require('@nestjs/common').ForbiddenException)('revoked');return originalGuard.apply(mes,args);};
  await intake({text:'物料编码,数量\nRAW-01,2'},{},403);mes.guard=originalGuard;
  if(fixtureDir){
   r=await intake({documents:files(['multi-sheet.xlsx'])});eq(r.groups.length,2);eq(r.groups[1].lines[0].sku,'000050');eq(r.groups[1].lines[0].locator.sheet,'装配二');
   r=await intake({documents:files(['sparse.xlsx'])});eq(r.groups[0].lines[0].sku,'000050');eq(r.groups[0].lines[0].quantity,'2');
   r=await intake({documents:files(['formula.xlsx'])});eq(r.groups[0].lines[0].quantity,null);ok(r.groups[0].lines[0].reviewReasons.some(x=>x.includes('公式')));
   r=await intake({documents:files(['merged.xlsx'])});eq(r.groups.length,1);eq(r.groups[0].lines.length,2);eq(r.groups[0].lines[1].quantity,'3');
   for(const file of ['gbk.csv','utf16.tsv']){r=await intake({documents:files([file])});eq(r.groups[0].parentSku,'FG-01');ok(r.groups[0].lines[0].material);}
   r=await intake({documents:files(['scanned.pdf'])});eq(r.totalRows,3);r.groups[0].lines.forEach((l,i)=>{const expected=['1','1','4'][i];if(l.quantity===null){eq(l.sourceQuantity,expected);ok(l.reviewReasons.some(x=>x.includes('置信不足')));ok(l.conflict);}else eq(l.quantity,expected);});ok(r.groups[0].lines.every(l=>l.locator.page===1&&l.locator.method==='ocr-cells'));
   r=await intake({documents:files(['multipage-scan.pdf'])});eq(r.groups.length,2);eq(r.totalRows,12);eq(r.groups[1].lines[0].locator.page,2);
   r=await intake({documents:files(['chinese-table.png'])});eq(r.totalRows,3);r.groups[0].lines.forEach((l,i)=>{const expected=['2','4','1'][i];if(l.quantity===null){eq(l.sourceQuantity,expected);ok(l.reviewReasons.some(x=>x.includes('置信不足')));ok(l.conflict);}else eq(l.quantity,expected);});eq(r.groups[0].lines[1].sku,'000050');
   for(const file of ['table.jpg','table-exif.jpg']){r=await intake({documents:files([file])});eq(r.totalRows,3);r.groups[0].lines.forEach((l,i)=>{const expected=['2','4','1'][i];if(l.quantity===null){eq(l.sourceQuantity,expected);ok(l.reviewReasons.some(x=>x.includes('置信不足')));ok(l.conflict);}else eq(l.quantity,expected);});}
   fs.writeFileSync(path.join(fixtureDir,'../chinese-result.json'),JSON.stringify(r,null,2));
  }
  eq(await db.mesBom.count({where:{tenantId:f.tenant.id}}),baseline[0]+4);eq(await db.aiModelUsage.count({where:{tenantId:f.tenant.id}}),baseline[1]);eq(modelCalls,0);
  console.log(JSON.stringify({ok:true,checks,httpChecks:h.checks(),modelCalls,scope:['CSV/TSV and leading zeros','multiple XLSX sheets and sparse cells','formulas not trusted','PDF scans and multiple pages','Chinese image table','hierarchy and cycles','duplicate and conflicting quantities','units and exact decimals','unstructured/no-BOM drawings','permissions and post-parse revocation','draft save and source provenance','no automatic BOM write or publish']}));
 }finally{if(app)await app.close();if(foreignTenant){await db.mesMaterial.deleteMany({where:{tenantId:foreignTenant.id}});await db.tenant.delete({where:{id:foreignTenant.id}});}if(f)await cleanupFixture(db,f);await db.$disconnect();}
})().catch(error=>{console.error(error);process.exitCode=1;});
