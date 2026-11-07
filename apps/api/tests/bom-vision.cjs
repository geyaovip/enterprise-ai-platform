// Isolated HTTP, real persistence/preparation and deterministic provider protocol faults.
// Mock output tests workflow boundaries, never document recognition accuracy.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createApp}=require('../dist/server'),{PrismaService}=require('../dist/modules/prisma.service'),{AuthService}=require('../dist/modules/platform/auth.service'),{MesService}=require('../dist/modules/mes/mes.service');
const {BomVisionService}=require('../dist/modules/mes/bom-vision.service'),{BomVisionProvider,GLM,KIMI}=require('../dist/modules/mes/bom-vision.provider');
const {purgeBomFiles}=require('../dist/modules/mes/bom-vision-storage'),{primaryVisionModel}=require('../dist/modules/mes/bom-vision-policy');
const {createFixture,cleanupFixture,fixtureHttp}=require('../scripts/workflow-fixture.cjs');
assert.match(process.env.DATABASE_URL??'',/@127\.0\.0\.1:54329\/suite_phase1_qa/);assert.equal(process.env.NODE_ENV,'test');
const root=process.env.BOM_VISION_FIXTURE_ROOT??path.resolve(__dirname,'../../..'),out=process.env.BOM_VISION_QA_DIR;assert.ok(out?.endsWith('20261029-bom-vision-release-r1'));
let app,f,checks=0,calls=[],mode='normal',pendingRelease,modelsCalled=0;const timers=new Set(),db=new PrismaService(),eq=(a,b)=>{assert.deepEqual(a,b);checks++;},ok=x=>{assert.ok(x);checks++;};
const row=(qty='2')=>({item:'1',part:'VISION-RAW',name:'模型组件',qty,unit:'PCS',quantities:{},mpn:null,designators:null,manufacturer:null,population:null,sourceQty:qty,spec:'测试规格',length:null,revision:null,bbox:null});
const response=(model)=>mode==='negative'&&model===KIMI?{bomPresent:false,variants:[],uncertainties:[],rows:[]}:({bomPresent:true,variants:[],uncertainties:['uncertain','negative'].includes(mode)&&model===GLM?['数量字符不明确']:[],rows:[row(mode==='uncertain'&&model===KIMI?'3':'2')]});
const server=http.createServer(async(req,res)=>{let input='';for await(const chunk of req)input+=chunk;const b=JSON.parse(input);calls.push({model:b.model,temperature:b.temperature,thinking:b.thinking,reasoning_effort:b.reasoning_effort,max_tokens:b.max_tokens,imageCount:b.messages[0].content.filter(x=>x.type==='image_url').length});
 res.writeHead(200,{'content-type':'text/event-stream'});const emit=v=>res.write('data: '+JSON.stringify(v)+'\n\n');
 emit({id:'mock-'+crypto.randomUUID(),model:b.model,choices:[{delta:{role:'assistant',reasoning_content:'PRIVATE_REASONING_MUST_NOT_PERSIST'}}]});
 const finish=()=>{if(res.destroyed)return;emit({model:b.model,choices:[{delta:{content:mode==='invalid'&&b.model===GLM?'{invalid':JSON.stringify(response(b.model))},finish_reason:mode==='truncated'?'length':'stop'}]});if(mode!=='unknown')emit({id:'mock-'+crypto.randomUUID(),model:b.model,choices:[],usage:{prompt_tokens:mode==='anomaly'?70000:100,completion_tokens:50,total_tokens:mode==='anomaly'?70050:150,prompt_tokens_details:{cached_tokens:20},completion_tokens_details:{reasoning_tokens:5}}});res.end('data: [DONE]\n\n');};
 if(mode==='delay'){pendingRelease=finish;}else finish();
});
(async()=>{try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));process.env.BOM_VISION_BASE_URL='http://127.0.0.1:'+server.address().port;process.env.BOM_VISION_API_KEY='mock-only-no-real-provider';process.env.BOM_VISION_ENABLED='true';
 app=await createApp();f=await createFixture(db,'erp-flow-test-bom-vision-'+crypto.randomUUID().slice(0,8));await db.tenantApp.create({data:{tenantId:f.tenant.id,appId:'mes'}});await db.tenantCapability.create({data:{tenantId:f.tenant.id,capability:'ai',delivered:true,enabled:true}});
 const h=await fixtureHttp(app,f),mes=app.get(MesService),service=app.get(BomVisionService),provider=app.get(BomVisionProvider),ctx=await app.get(AuthService).taskContext({tenantId:f.tenant.id,userId:f.accounts.admin.userId,membershipId:f.accounts.admin.memberId,appId:'mes',taskId:crypto.randomUUID()}),prefix=`/tenants/${f.tenant.slug}/apps/mes/boms/intake`;
 const fg=await mes.saveMaterial(ctx,undefined,{requestKey:crypto.randomUUID(),sku:'VISION-FG',name:'视觉核对成品',unit:'件',kind:'finished'}),raw=await mes.saveMaterial(ctx,undefined,{requestKey:crypto.randomUUID(),sku:'VISION-RAW',name:'模型组件',unit:'件',kind:'raw'});
 const image=fs.readFileSync(path.join(root,'var/operations/20261029-bom-diversity-r1/inputs/cn-mech-variants.png')).toString('base64');
 let serial=0;const body=(revision='QA-'+(++serial),filename='control.png')=>({kind:'bom',productId:fg.id,source:{documents:[{filename,data:image,revision}]}});
 const submit=async(b=body(),role='admin',expected=201)=>(await h.request(prefix+'/jobs','POST',b,role,expected)).data;
 const status=async(id,role='admin',expected=200)=>(await h.request(prefix+'/jobs/'+id,'GET',undefined,role,expected)).data;
 const finish=async(id)=>{for(let i=0;i<28;i++){const s=await status(id);if(!['queued','running'].includes(s.status))return s;ok(await service.tick());}throw Error('Finite task did not settle');};
 const checkSlot=(m)=>{eq(m.imageCount,1);eq(m.reasoning_effort,'low');eq(m.max_tokens,16384);if(m.model===GLM){eq(m.temperature,0);eq(m.thinking,{type:'enabled'});}else{eq(m.model,KIMI);eq(m.temperature,1);eq(m.thinking,undefined);}};
 // Default preserves hybrid routing; explicit cost controls remain optional.
 eq(primaryVisionModel({risk:{dense:true,distorted:true,lowContrast:true}}),KIMI);process.env.BOM_VISION_GLM_FIRST='false';
 let b=body(),job=await submit(b),same=await submit(b);eq(job.id,same.id);let s=await finish(job.id);eq(s.status,'completed');eq(s.files[0].revision,b.source.documents[0].revision);eq(calls.length,1);eq(calls[0].model,GLM);checkSlot(calls[0]);
 for(let i=0;i<3;i++)await status(job.id);eq(calls.length,1);same=await submit({...b,source:{documents:[{...b.source.documents[0],filename:'renamed.png'}]}});eq(same.id,job.id);eq(calls.length,1);
 const line=s.result.groups[0].lines[0];ok(line.conflict);eq(line.quantity,'2');ok(line.vision.usageIds.length===1);eq(line.sourceItem,'1');
 const source={filename:line.locator.filename,sha256:line.locator.sha256,page:line.locator.page,sheet:line.locator.sheet,table:line.locator.table,row:line.locator.row,method:line.locator.method,originalSku:line.sku,originalQuantity:line.sourceQuantity,originalUnit:line.sourceUnit,vision:line.vision,sourceItem:line.sourceItem,reviewed:true,factReviewed:true,hasConflict:true,factReview:{productId:fg.id,materialId:raw.id,quantity:'2',unit:'件'}};
 const save=async(patch,expected=400)=>(await h.request(`/tenants/${f.tenant.slug}/apps/mes/boms`,'POST',{requestKey:crypto.randomUUID(),draft:{productId:fg.id,lines:[{materialId:raw.id,quantity:'2',sourceEvidence:{...source,...patch}}]}},'admin',expected)).data;
 await save({factReviewed:false});checks++;await save({vision:undefined});checks++;await save({sha256:'b'.repeat(64)},409);checks++;await save({vision:{...source.vision,usageIds:[crypto.randomUUID()]}},409);checks++;const saved=await save({},201);eq(saved.lines[0].sourceEvidence.vision,line.vision);

 // Retired fields from an already-open client are accepted and discarded; real provenance is still enforced above.
 const oldCheck={status:'conflict',ocrQuantity:'7',reason:'quantity-difference'};
 const legacySave=await save({ocrCheck:oldCheck},201);eq(legacySave.lines[0].sourceEvidence.ocrCheck,undefined);
 eq(line.ocrCheck,undefined);eq(s.pages[0].ocrComparison,undefined);
 // Simulate an existing completed task without rewriting its source evidence or issuing requests.
 const task=await db.aiTask.findUniqueOrThrow({where:{id:job.id}}),legacyState=structuredClone(task.result);
 legacyState.pages[0].ocrComparison={status:'conflict',conflictRows:1};legacyState.stage='crosschecking';
 const disk=path.join(process.env.KNOWLEDGE_STORAGE_DIR,'bom-vision',f.tenant.id,job.id,'page-0-result.json');
 const legacyPage=JSON.parse(fs.readFileSync(disk));legacyPage.tables[0].rows[0].ocrCheck=oldCheck;
 legacyPage.tables[0].rows[0].reviewReasons.push('独立OCR发现疑点：数量不同');
 fs.writeFileSync(disk,JSON.stringify(legacyPage));const diskBefore=fs.readFileSync(disk,'utf8');
 await db.aiTask.update({where:{id:job.id},data:{result:legacyState}});const beforeLegacy=calls.length;
 for(let i=0;i<3;i++){const restored=await status(job.id);eq(restored.stage,'reading');eq(restored.pages[0].ocrComparison,undefined);eq(restored.result.groups[0].lines[0].ocrCheck,undefined);ok(!JSON.stringify(restored).includes('独立OCR发现疑点'));eq(restored.result.groups[0].lines[0].vision,line.vision);}
 eq(calls.length,beforeLegacy);eq(fs.readFileSync(disk,'utf8'),diskBefore);eq((await db.aiTask.findUniqueOrThrow({where:{id:job.id}})).result,legacyState);
 const file=s.files[0],original=(await h.request(prefix+`/jobs/${job.id}/sources/${file.id}`)).data;eq(crypto.createHash('sha256').update(Buffer.from(original.data,'base64')).digest('hex'),file.sha256);const page=(await h.request(prefix+`/jobs/${job.id}/sources/${file.id}/pages/1`)).data;eq(page.sha256,file.sha256);
 await db.mesMemberGrant.create({data:{tenantId:f.tenant.id,membershipId:f.accounts.reviewer.memberId,role:'planner'}});await status(job.id,'reviewer',404);checks++;await h.request(prefix+`/jobs/${job.id}/sources/${file.id}`,'GET',undefined,'reviewer',404);checks++;await h.request(prefix+'/jobs/'+crypto.randomUUID(),'GET',undefined,'admin',404);checks++;
 const before=calls.length;await h.request(prefix+`/jobs/${job.id}/recheck`,'POST',{pageIndex:0});s=await finish(job.id);eq(s.status,'completed');eq(calls.length,before+1);eq(calls.at(-1).model,KIMI);checkSlot(calls.at(-1));await h.request(prefix+`/jobs/${job.id}/recheck`,'POST',{pageIndex:0},'admin',409);checks++;
 mode='uncertain';job=await submit();const at=calls.length;s=await finish(job.id);eq(s.status,'completed');eq(calls.length,at+2);ok(s.pages[0].hasDifference);eq(s.result.groups[0].lines[0].quantity,null);ok(s.result.groups[0].lines[0].reviewReasons.some(x=>x.includes('未自动采用')));ok(s.result.groups[0].lines[0].reviewReasons.some(x=>x.includes('GLM与Kimi')));
 mode='negative';job=await submit();const negativeAt=calls.length;s=await finish(job.id);eq(s.status,'completed');eq(calls.length,negativeAt+2);eq(s.result.totalRows,0);ok(s.pages[0].hasDifference);ok(s.result.sources[0].parseState.endsWith('review-required'));
 mode='invalid';job=await submit();const invalidAt=calls.length;s=await finish(job.id);eq(s.status,'completed');eq(calls.length,invalidAt+2);eq(s.usage.filter(u=>u.usageStatus==='reported').length,2);

 // Cost controls apply to new calls, keep manual hints, and never restart a model loop.
 const oldFirst=process.env.BOM_VISION_GLM_FIRST,oldKimi=process.env.BOM_VISION_KIMI_ENABLED,oldOcr=process.env.BOM_VISION_OCR_ENABLED;
 try{
  process.env.BOM_VISION_GLM_FIRST='true';mode='uncertain';job=await submit();let at=calls.length;s=await finish(job.id);eq(s.status,'completed');eq(calls.length,at+1);eq(s.pages[0].models,[GLM]);ok(s.pages[0].reasons.length>0);
  process.env.BOM_VISION_KIMI_ENABLED='false';mode='normal';job=await submit();at=calls.length;s=await finish(job.id);eq(s.status,'completed');eq(calls.length,at+1);eq(s.pages[0].canRecheck,false);await h.request(prefix+`/jobs/${job.id}/recheck`,'POST',{pageIndex:0},'admin',409);checks++;eq(calls.length,at+1);
  mode='invalid';job=await submit();at=calls.length;s=await finish(job.id);eq(s.status,'failed');eq(calls.length,at+1);eq(calls.at(-1).model,GLM);
 }finally{for(const[k,v]of [['BOM_VISION_GLM_FIRST',oldFirst],['BOM_VISION_KIMI_ENABLED',oldKimi],['BOM_VISION_OCR_ENABLED',oldOcr]])if(v===undefined)delete process.env[k];else process.env[k]=v;}
 // Actual low-contrast page preparation must dispatch Kimi directly, not GLM plus Kimi.
 mode='normal';const riskBody=body('HYBRID-LOW-CONTRAST');riskBody.source.documents[0].data=fs.readFileSync(process.env.BOM_RISK_SOURCE).toString('base64');job=await submit(riskBody);const riskAt=calls.length;s=await finish(job.id);eq(s.status,'completed');eq(calls.length,riskAt+1);eq(calls.at(-1).model,KIMI);checkSlot(calls.at(-1));eq(s.pages[0].canRecheck,false);
 // No model request for native structured files.
 mode='normal';const csv={kind:'bom',productId:fg.id,source:{text:'物料编码,数量,单位\nVISION-RAW,2,件'}};job=await submit(csv);const nativeAt=calls.length;s=await finish(job.id);eq(s.status,'completed');eq(calls.length,nativeAt);eq(s.usage.length,0);

 // Automatic BOM cross-check never executes, even with an obsolete enable flag and unavailable Tesseract.
 const tess=process.env.KNOWLEDGE_TESSERACT_PATH,oldEnabled=process.env.BOM_VISION_OCR_ENABLED;
 process.env.KNOWLEDGE_TESSERACT_PATH='/nonexistent/ocr-test-only';process.env.BOM_VISION_OCR_ENABLED='true';
 try{job=await submit(body('NO-AUTOMATIC-OCR'));const n=calls.length;s=await finish(job.id);eq(s.status,'completed');eq(calls.length,n+1);eq(s.pages[0].ocrComparison,undefined);eq(s.result.groups[0].lines[0].ocrCheck,undefined);ok(!fs.readdirSync(path.join(process.env.KNOWLEDGE_STORAGE_DIR,'bom-vision',f.tenant.id,job.id)).some(x=>x.endsWith('-ocr.json')));}
 finally{for(const[k,v]of [['KNOWLEDGE_TESSERACT_PATH',tess],['BOM_VISION_OCR_ENABLED',oldEnabled]])if(v===undefined)delete process.env[k];else process.env[k]=v;}

 // GLM and Kimi both retain the validated complete source and base prompt, without experimental detail images.
 mode='normal';const detailBody=body('DETAIL-SOURCE');detailBody.source.documents[0].data=fs.readFileSync(path.join(root,'var/operations/20261029-bom-vision-r1/inputs/clear-full.png')).toString('base64');job=await submit(detailBody);const detailAt=calls.length;s=await finish(job.id);eq(s.status,'completed');eq(calls.length,detailAt+1);eq(calls.at(-1).model,GLM);eq(calls.at(-1).imageCount,1);
 await h.request(prefix+`/jobs/${job.id}/recheck`,'POST',{pageIndex:0});s=await finish(job.id);eq(s.status,'completed');eq(calls.length,detailAt+2);eq(calls.at(-1).model,KIMI);eq(calls.at(-1).imageCount,1);eq(s.pages[0].canRecheck,false);
 const detailCache=JSON.parse(fs.readFileSync(path.join(process.env.KNOWLEDGE_STORAGE_DIR,'bom-vision',f.tenant.id,job.id,'page-0-result.json')));eq(detailCache.secondary.detailImageSha256,undefined);await h.request(prefix+`/jobs/${job.id}/recheck`,'POST',{pageIndex:0},'admin',409);checks++;eq(calls.length,detailAt+2);
 for(const bad of ['unknown','truncated','anomaly']){
  mode=bad;b=body();job=await submit(b);const n=calls.length;s=await finish(job.id);eq(s.status,'failed');eq(calls.length,n+1);eq(s.usage[0].usageStatus,bad==='unknown'?'unknown':'reported');same=await submit(b);eq(same.id,job.id);await service.tick();eq(calls.length,n+1);
  await h.request(prefix+`/jobs/${job.id}/recheck`,'POST',{pageIndex:0},'admin',409);checks++;
  // Simulate process loss: pending/unknown ledger still prevents any replay.
  if(bad==='unknown'){await db.aiTask.update({where:{id:job.id},data:{status:'running',startedAt:new Date(Date.now()-700000)}});await service.tick();eq(calls.length,n+1);eq((await status(job.id)).status,'failed');}
 }
 // Two different simultaneous submissions cannot both pass the active-job limit.
 mode='normal';const rs=await Promise.all([h.request(prefix+'/jobs','POST',body(),'admin',null),h.request(prefix+'/jobs','POST',body(),'admin',null)]);eq(rs.map(r=>r.status).sort(),[201,409]);job=rs.find(r=>r.status===201).data;const cancelAt=calls.length;await h.request(prefix+`/jobs/${job.id}/cancel`,'POST');await service.tick();eq(calls.length,cancelAt);
 // Cancel an in-flight stream. Unknown receipt is retained and no Kimi follows.
 mode='delay';job=await submit();await service.tick();const run=service.tick();const delayAt=calls.length;for(let i=0;i<1200&&calls.length===delayAt;i++)await new Promise(r=>setTimeout(r,50));ok(calls.length===delayAt+1);await h.request(prefix+`/jobs/${job.id}/cancel`,'POST');await run;pendingRelease?.();s=await status(job.id);eq(s.status,'cancelled');eq(s.usage[0].usageStatus,'unknown');eq(calls.length,delayAt+1);
 // Permission revoked while a provider request is running: abort before delivery.
 mode='delay';job=await submit();await service.tick();const revokeAt=calls.length,revoking=service.tick();for(let i=0;i<1200&&calls.length===revokeAt;i++)await new Promise(r=>setTimeout(r,50));await db.tenantCapability.update({where:{tenantId_capability:{tenantId:f.tenant.id,capability:'ai'}},data:{enabled:false}});await revoking;pendingRelease?.();await status(job.id,'admin',403);checks++;await db.tenantCapability.update({where:{tenantId_capability:{tenantId:f.tenant.id,capability:'ai'}},data:{enabled:true}});s=await status(job.id);eq(s.status,'failed');eq(calls.length,revokeAt+1);
 // A reported primary checkpoint survives a crash before the secondary was reserved.
 mode='uncertain';job=await submit();await service.tick();const originalRun=provider.run.bind(provider);let injected=false;provider.run=async(...args)=>{if(args[0].slot===1&&!injected){injected=true;throw Error('Simulated worker loss before secondary reservation');}return originalRun(...args);};const crashAt=calls.length;await service.tick();provider.run=originalRun;eq((await status(job.id)).status,'failed');await db.aiTask.update({where:{id:job.id},data:{status:'running',startedAt:new Date(Date.now()-700000)}});s=await finish(job.id);eq(s.status,'completed');eq(calls.length,crashAt+2);eq(calls.slice(crashAt).map(c=>c.model),[GLM,KIMI]);
 // Expiry deletes original objects, retains usage, and never frees unknown requests into zero.
 const count=await db.aiModelUsage.count({where:{tenantId:f.tenant.id}});await db.aiTask.update({where:{id:job.id},data:{createdAt:new Date(Date.now()-8*86400000)}});await service.cleanup();s=await status(job.id);eq(s.status,'expired');eq(await db.aiModelUsage.count({where:{tenantId:f.tenant.id}}),count);
 eq(await db.aiChatTurn.count({where:{userId:f.accounts.admin.userId}}),0);
 const stored=JSON.stringify(await db.aiTask.findMany({where:{tenantId:f.tenant.id}}));ok(!stored.includes('PRIVATE_REASONING_MUST_NOT_PERSIST'));ok(!stored.includes(process.env.BOM_VISION_API_KEY));
 const report={assertions:checks,httpChecks:h.checks(),mockProviderRequests:calls.length,realProviderRequests:0,chatTurnsConsumed:0,passed:true,coverage:['source preparation/persistence and owner ACL','GLM/Kimi request parameters','cached and renamed input dedupe','uncertain/schema invalid primary bounded recheck','known/unknown/truncated/anomalous usage stop','worker restart no replay','two-stage reported cache recovery','cancel and permission revocation','concurrent admission','reviewed provenance-bound draft save','native zero-token route','source expiry retains ledger','no raw reasoning or keys persisted']};fs.writeFileSync(path.join(out,'vision-api-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{
 if(app)await app.close();for(const timer of timers)clearTimeout(timer);pendingRelease?.();await new Promise(r=>server.close(r));if(f){for(const j of await db.aiTask.findMany({where:{tenantId:f.tenant.id,kind:'mes-bom-vision-v1'}}))await purgeBomFiles(f.tenant.id,j.id);await cleanupFixture(db,f);}await db.$disconnect();
}})().catch(e=>{console.error(e);process.exitCode=1});
