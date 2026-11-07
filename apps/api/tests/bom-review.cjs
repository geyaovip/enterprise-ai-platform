// Real isolated API/DB, PDF renderer, source-bound historical correction and manual rows.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createApp}=require('../dist/server'),{PrismaService}=require('../dist/modules/prisma.service'),{AuthService}=require('../dist/modules/platform/auth.service'),{MesService}=require('../dist/modules/mes/mes.service'),{AgentExecutionService}=require('../dist/modules/ai/agent.runtime');
const {sameReviewedSource,compatibleHistory}=require('../dist/modules/mes/bom-history'),{lineSchema}=require('../dist/modules/mes/mes.rules');
const {createFixture,cleanupFixture,fixtureHttp}=require('../scripts/workflow-fixture.cjs');
const out=process.env.BOM_REVIEW_QA_OUTPUT_DIR,root=path.resolve(__dirname,'../../..');
assert.ok(out?.endsWith('20261028-bom-review-r1'));assert.match(process.env.DATABASE_URL??'',/@127\.0\.0\.1:54329\/suite_phase1_qa/);assert.equal(process.env.NATIVE_AI_MODEL_ENABLED,'false');
let app,f,calls=0,checks=0;const db=new PrismaService(),eq=(a,b)=>{assert.deepEqual(a,b);checks++;},ok=x=>{assert.ok(x);checks++;};
(async()=>{try{
 app=await createApp();f=await createFixture(db,'erp-flow-test-bom-review-'+crypto.randomUUID().slice(0,8));await db.tenantApp.create({data:{tenantId:f.tenant.id,appId:'mes'}});app.get(AgentExecutionService).complete=async()=>{calls++;throw Error('No model calls permitted in BOM review QA');};
 const mes=app.get(MesService),ctx=await app.get(AuthService).taskContext({tenantId:f.tenant.id,userId:f.accounts.admin.userId,membershipId:f.accounts.admin.memberId,appId:'mes',taskId:crypto.randomUUID()}),h=await fixtureHttp(app,f),prefix=`/tenants/${f.tenant.slug}/apps/mes`;
 const material=(sku,kind='raw')=>mes.saveMaterial(ctx,undefined,{requestKey:crypto.randomUUID(),sku,name:sku,unit:'件',kind});
 const fg=await material('REVIEW-FG','finished'),other=await material('REVIEW-OTHER','finished'),raw=await material('CORRECT-MATERIAL'),manualRaw=await material('MANUAL-MATERIAL');
 for(const sku of ['JACKSCREW BAR BASE','JACKSCREW PIN','M5 X 16MM - 92000A326'])await material(sku);
 const initialUsage=await db.aiModelUsage.count({where:{tenantId:f.tenant.id}}),document={filename:'mechanical.csv',data:Buffer.from('Part Number,Quantity,Unit\nOCR-SOURCE,2,piece\n').toString('base64')};
 const intake=async(doc=document,productId=fg.id)=>(await h.request(prefix+'/boms/intake','POST',{kind:'bom',productId,source:{documents:[doc]}})).data;
 let result=await intake();eq(result.groups[0].lines[0].historyCandidates,undefined);
 const line=result.groups[0].lines[0],loc=line.locator,source={...loc,originalSku:line.sku,originalQuantity:line.sourceQuantity,originalUnit:line.sourceUnit,revision:line.revision,productCode:line.productCode,hasConflict:true,factReviewed:true,reviewed:true,reviewNote:'按原件核实并纠正企业物料映射'};delete source.bbox;delete source.pageSize;
 const draft=await mes.saveBom(ctx,undefined,{requestKey:crypto.randomUUID(),draft:{productId:fg.id,lines:[{materialId:raw.id,quantity:'7',sourceEvidence:source}]}}),published=await mes.publishBom(ctx,draft.id,{requestKey:crypto.randomUUID(),version:draft.version});
 result=await intake();let row=result.groups[0].lines[0];eq(row.historyCandidates.length,1);eq(row.historyCandidates[0].material.id,raw.id);eq(row.material,null);eq(row.quantity,'2');ok(!('quantity'in row.historyCandidates[0]));ok(row.historyCandidates[0].basis[0].includes('同一原件'));
 eq((await intake({...document,filename:'renamed.csv'})).groups[0].lines[0].historyCandidates.length,1);
 eq((await intake({...document,data:Buffer.from('Part Number,Quantity,Unit\nOCR-SOURCE,2,piece\n\n').toString('base64')})).groups[0].lines[0].historyCandidates,undefined);
 eq((await intake(document,other.id)).groups[0].lines[0].historyCandidates,undefined);
 const approvedRow={sourceEvidence:source},current={...source};ok(sameReviewedSource(current,approvedRow));ok(compatibleHistory(current,approvedRow));
 for(const patch of [{sha256:'b'.repeat(64)},{row:3},{table:2},{page:1},{method:'manual-source'},{originalSku:'DIFFERENT'},{revision:'B'},{originalUnit:'kg'},{productCode:'OTHER'}])ok(!sameReviewedSource({...current,...patch},approvedRow));
 ok(!sameReviewedSource(current,{sourceEvidence:{...source,factReviewed:false}}));ok(!compatibleHistory({...current,population:'DNI'},approvedRow));
 const historyEvidence={...source,historyMatch:row.historyCandidates[0].bom};
 const save=(e,status=201)=>h.request(prefix+'/boms','POST',{requestKey:crypto.randomUUID(),draft:{productId:fg.id,lines:[{materialId:manualRaw.id,quantity:'1',sourceEvidence:e}]}},'admin',status);
 const manual={filename:'mechanical.csv',sha256:loc.sha256,page:null,sheet:null,table:1,row:3,method:'manual-source',originalSku:'MANUAL-MATERIAL',originalQuantity:'1',reviewed:true,factReviewed:true,hasConflict:false,reviewNote:'原件第三行，由核对人员补录'};
 for(const patch of [{reviewNote:undefined},{sha256:null},{factReviewed:false},{row:0}]){await save({...manual,...patch},400);checks++;}
 const snapshot={productId:fg.id,materialId:manualRaw.id,quantity:'1',unit:'件'};
 await save({...manual,factReview:{...snapshot,materialId:raw.id}},400);checks++;
 await save({...manual,factReview:{...snapshot,quantity:'2'}},400);checks++;
 await save({...manual,factReview:{...snapshot,productId:other.id}},400);checks++;
 await save({...manual,factReview:{...snapshot,unit:'kg'}},409);checks++;
 const snapSaved=(await save({...manual,factReview:snapshot})).data;eq(snapSaved.lines[0].sourceEvidence.factReview,snapshot);
 const saved=(await save(manual)).data;eq(saved.lines[0].sourceEvidence.method,'manual-source');eq(saved.lines[0].sourceEvidence.reviewNote,manual.reviewNote);
 ok(!lineSchema.safeParse({materialId:raw.id,quantity:'1',sourceEvidence:{...source,bbox:[10,0,5,5],pageSize:[100,100]}}).success);
 // Preview is a render of the provided source, without OCR or supplier calls.
 const pdf=fs.readFileSync(path.join(root,'var/operations/20261028-bom-scan-r3/sources/cabin.pdf')),pdfDocument={filename:'cabin.pdf',data:pdf.toString('base64')};
 const preview=async(body,role='admin',status=201)=>h.request(prefix+'/boms/intake/page','POST',body,role,status);
 await preview({document:pdfDocument,page:1},'buyer',403);checks++;
 for(const body of [{document:pdfDocument,page:25},{document:{filename:'fake.pdf',data:Buffer.from('not PDF').toString('base64')},page:1}]){await preview(body,'admin',400);checks++;}
 const rendered=(await preview({document:pdfDocument,page:1})).data;eq(rendered.sha256,crypto.createHash('sha256').update(pdf).digest('hex'));eq(rendered.page,1);eq(rendered.mime,'image/png');ok(rendered.width>0&&rendered.height>0&&Math.max(rendered.width,rendered.height)===3000);eq(Buffer.from(rendered.data,'base64').subarray(0,8).toString('hex'),'89504e470d0a1a0a');fs.writeFileSync(path.join(out,'preview-page.png'),Buffer.from(rendered.data,'base64'));
 const races=await Promise.all([preview({document:pdfDocument,page:1},'admin',null),preview({document:pdfDocument,page:1},'admin',null)]);eq(races.map(x=>x.status).sort(),[201,409]);
 const original=mes.guard;try{let reads=0;mes.guard=async function(c,p,...args){if(p==='mes.bom.write'&&++reads>1){const {ForbiddenException}=require('@nestjs/common');throw new ForbiddenException();}return original.call(this,c,p,...args);};await preview({document:pdfDocument,page:1},'admin',403);checks++;}finally{mes.guard=original;}
 await db.mesBom.update({where:{id:published.id},data:{version:{increment:1}}});await h.request(prefix+'/boms','POST',{requestKey:crypto.randomUUID(),draft:{productId:fg.id,lines:[{materialId:raw.id,quantity:'2',sourceEvidence:historyEvidence}]}},'admin',409);checks++;
 eq(await db.aiModelUsage.count({where:{tenantId:f.tenant.id}}),initialUsage);eq(calls,0);
 const evidence={checks,httpRequests:h.checks(),modelCalls:calls,scope:'manual source rows, exact reviewed source reuse, source/version changes, authenticated PDF preview, post-render authorization and duplicate work guard'};fs.writeFileSync(path.join(out,'api-review-results.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
 if(process.env.BOM_REVIEW_BROWSER==='true'){
  fs.writeFileSync(path.join(out,'browser-fixture.private.json'),JSON.stringify({slug:f.tenant.slug,apiPort:app.getHttpServer().address().port,cookie:h.cookies.admin,fg,raw,manualRaw}),{mode:0o600});console.log('BOM_REVIEW_BROWSER_READY');await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
 }
}finally{if(app)await app.close();if(f)await cleanupFixture(db,f);await db.$disconnect();if(out)fs.rmSync(path.join(out,'browser-fixture.private.json'),{force:true});}})().catch(e=>{console.error(e);process.exitCode=1});
