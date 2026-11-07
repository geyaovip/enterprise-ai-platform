import { compareVisionRows,sourceQuantityConflict } from './bom-vision-compare';
import { BadRequestException,ConflictException,Injectable,NotFoundException,ServiceUnavailableException } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../platform/auth.service';
import { readBody } from '../platform/security';
import type { RequestContext } from '../platform/context';
import { MesService } from './mes.service';
import { MesBomIntakeService,validateBomInput,parseDocuments,type BomParse,type BomTable } from './bom-intake.service';
import { BomVisionProvider,BomVisionError,BOM_VISION_KIND,GLM,KIMI,PROMPT_SHA,bomVisionConfigured,type VisionCall,type VisionAnswer } from './bom-vision.provider';
import { bomHash,readBomFile,writeBomFile,purgeBomFiles } from './bom-vision-storage';
import { primaryVisionModel,kimiVisionEnabled,automaticKimiRecheck,recheckReasons,sameVisionFacts,type PagePreparation } from './bom-vision-policy';
import { withoutRetiredBomChecks } from './bom-source-compat';
import { bomReviewSchema,restoreBomReview } from './bom-review';
const VERSION='bom-vision-1',WEEK=7*86400000;
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
type File={id:string;filename:string;sha256:string;bytes:number;productCode?:string;revision?:string};
type Page={fileId:string;page:number;structured:boolean};
type Input={version:string;promptSha:string;productId?:string;files:File[];pages?:Page[];purged?:boolean};
type State={stage?:string;cursor?:number;totalPages?:number;recheck?:number;pages?:any[]};
type PageResult={version:string;complete?:boolean;tables:BomTable[];primary?:VisionCall;secondary?:VisionCall;reasons:string[];hasDifference:boolean;reviewRequested?:boolean};
export const bomVisionMessages:Record<string,string>={BOM_VISION_RECHECK_DISABLED:'第二视觉模型未启用，请对照原件人工核对',BOM_VISION_NOT_CONFIGURED:'视觉识别暂不可用，可继续使用本地整理',BOM_VISION_USAGE_UNKNOWN:'本次识别用量尚未确认，已停止后续调用，请勿重复提交',BOM_VISION_RESPONSE_INCOMPLETE:'模型输出未完整结束，已停止后续调用，请核对用量与原资料',BOM_VISION_INTERRUPTED:'识别已中断，已停止后续调用，请核对原资料',BOM_VISION_REQUEST_ALREADY_ATTEMPTED:'已存在模型请求记录，未重复识别，请核对原任务',BOM_VISION_RESULT_MISSING:'模型已调用但结果未完整保存，未重复扣费识别，请人工核对',BOM_VISION_SCHEMA_INVALID:'模型未返回可核对的明细，请人工整理',DOCUMENT_ROW_LIMIT:'来源超过300行，请按装配分批整理',DOCUMENT_PAGE_LIMIT:'资料合计最多24页，请分批整理',BOM_VISION_EXPIRED:'原件已超过7天保留期，请重新上传'};
export function runVisionInput(input:unknown,signal?:AbortSignal):Promise<any>{
 return new Promise((resolve,reject)=>{
  const child=spawn(process.env.KNOWLEDGE_PYTHON_PATH??'python3',[join(__dirname,'bom-vision-input.py')],{detached:process.platform!=='win32',stdio:['pipe','pipe','pipe'],env:{...process.env,OMP_THREAD_LIMIT:'1'}});
  let stdout=Buffer.alloc(0),stderr='',settled=false;
  const kill=()=>{try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{}};
  const finish=(error?:Error,value?:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
  const abort=()=>{kill();finish(new BomVisionError('BOM_VISION_STOPPED'));};
  const timer=setTimeout(()=>{kill();finish(new BomVisionError('BOM_PAGE_PREPARATION_TIMEOUT'));},60000);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  child.stdout.on('data',(b:Buffer)=>{stdout=Buffer.concat([stdout,b]);if(stdout.length>16*1024*1024){kill();finish(new BomVisionError('DOCUMENT_TOO_LARGE'));}});
  child.stderr.on('data',(b:Buffer)=>{if(stderr.length<500)stderr+=b.toString();});child.stdin.on('error',()=>{});
  child.on('error',()=>finish(new BomVisionError('BOM_PAGE_PREPARATION_FAILED')));
  child.on('close',code=>{if(code){finish(new BomVisionError(['DOCUMENT_PAGE_LIMIT','IMAGE_TOO_LARGE','DOCUMENT_TOO_LARGE','DOCUMENT_TIMEOUT'].includes(stderr.trim())?stderr.trim():'BOM_PAGE_PREPARATION_FAILED'));return;}try{finish(undefined,JSON.parse(stdout.toString()));}catch{finish(new BomVisionError('BOM_PAGE_PREPARATION_FAILED'));}});
  child.stdin.end(JSON.stringify(input));
 });
}
@Injectable()
export class BomVisionService{
 constructor(private readonly db:PrismaService,private readonly auth:AuthService,private readonly mes:MesService,private readonly intake:MesBomIntakeService,private readonly provider:BomVisionProvider){}
 private async guard(ctx:RequestContext,ai=true){for(const p of ['mes.bom.write','mes.material.read',...(ai?['mes.ai.use']:[])])await this.mes.guard(ctx,p);}
 private async owned(ctx:RequestContext,id:string){
  await this.guard(ctx);if(!z.uuid().safeParse(id).success)throw new NotFoundException('识别任务不存在');
  const job=await this.db.aiTask.findFirst({where:{id,kind:BOM_VISION_KIND,appId:'mes',tenantId:ctx.tenantId,membershipId:ctx.membershipId,userId:ctx.userId}});
  if(!job)throw new NotFoundException('识别任务不存在');return job;
 }
 async submit(ctx:RequestContext,raw:unknown){
  await this.guard(ctx);if(!bomVisionConfigured())throw new ServiceUnavailableException(bomVisionMessages.BOM_VISION_NOT_CONFIGURED);
  const input=validateBomInput(raw);
  if(input.productId&&!await this.db.mesMaterial.findFirst({where:{id:input.productId,tenantId:ctx.tenantId,active:true,kind:{in:['finished','semi']}}}))throw new BadRequestException('当前父产品无效');
  const docs=[...(input.source.text.trim()?[{filename:'粘贴资料.tsv',data:Buffer.from(input.source.text).toString('base64')}]:[]),...input.source.documents];
  const fingerprint=bomHash(JSON.stringify({version:VERSION,prompt:PROMPT_SHA,productId:input.productId,files:docs.map(d=>({hash:bomHash(Buffer.from(d.data,'base64')),productCode:(d as any).productCode,revision:(d as any).revision})).sort((a,b)=>a.hash.localeCompare(b.hash))}));
  const requestKey='bom-vision:'+fingerprint;
  // Hold only this tenant/member/fingerprint during source persistence and enqueue.
  return this.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ctx.tenantId+ctx.membershipId+':bom-vision'},0))`;
   const old=await tx.aiTask.findUnique({where:{tenantId_membershipId_requestKey:{tenantId:ctx.tenantId,membershipId:ctx.membershipId,requestKey}}});
   if(old&&old.status!=='expired')return {id:old.id,status:old.status,reused:true};
   if(old){
    const unsettled=await tx.aiModelUsage.count({where:{requestId:'bom:'+old.id,usageStatus:{notIn:['reported','not_requested']}}});
    if(unsettled)throw new ConflictException(bomVisionMessages.BOM_VISION_USAGE_UNKNOWN);
    await tx.aiTask.update({where:{id:old.id},data:{requestKey:null}});
   }
   const active=await tx.aiTask.count({where:{tenantId:ctx.tenantId,membershipId:ctx.membershipId,kind:BOM_VISION_KIND,status:{in:['queued','running']}}});
   if(active)throw new ConflictException('已有BOM识别任务，请先查看或停止原任务');
   const id=randomUUID(),files:File[]=[];
   try{
    for(const d of docs){const bytes=Buffer.from(d.data,'base64'),file:File={id:randomUUID(),filename:d.filename,sha256:bomHash(bytes),bytes:bytes.length,...('productCode'in d&&d.productCode?{productCode:d.productCode}:{}),...('revision'in d&&d.revision?{revision:d.revision}:{})};await writeBomFile(ctx.tenantId,id,'source-'+file.id+'.bin',bytes);files.push(file);}
    await this.guard(ctx);
    await tx.aiTask.create({data:{id,tenantId:ctx.tenantId,userId:ctx.userId,membershipId:ctx.membershipId,appId:'mes',kind:BOM_VISION_KIND,requestKey,input:json({version:VERSION,promptSha:PROMPT_SHA,productId:input.productId,files}),result:json({stage:'planning',cursor:0}),status:'queued'}});
    return {id,status:'queued',reused:false};
   }catch(e){await purgeBomFiles(ctx.tenantId,id);throw e;}
  },{timeout:30000});
 }
 async list(ctx:RequestContext){await this.guard(ctx);return this.db.aiTask.findMany({where:{tenantId:ctx.tenantId,membershipId:ctx.membershipId,userId:ctx.userId,appId:'mes',kind:BOM_VISION_KIND,status:{in:['queued','running']}},select:{id:true,status:true,createdAt:true},orderBy:{createdAt:'desc'},take:5});}
 async history(ctx:RequestContext,raw:unknown){
  await this.guard(ctx);const q=readBody(z.object({page:z.coerce.number().int().min(1).max(10000).default(1),page_size:z.coerce.number().int().min(1).max(50).default(20),status:z.enum(['all','active','completed','failed','cancelled','expired']).default('all')}),raw);
  const where={tenantId:ctx.tenantId,membershipId:ctx.membershipId,userId:ctx.userId,appId:'mes',kind:BOM_VISION_KIND,...(q.status==='all'?{}:{status:q.status==='active'?{in:['queued','running']}:q.status})};
  const [rows,total]=await this.db.$transaction([this.db.aiTask.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(q.page-1)*q.page_size,take:q.page_size}),this.db.aiTask.count({where})]);
  await this.guard(ctx);return {items:rows.map(j=>({id:j.id,status:j.status,createdAt:j.createdAt,finishedAt:j.finishedAt,filenames:((j.input as any).files??[]).map((f:any)=>f.filename),totalPages:(j.input as any).pages?.length??null,reviewSavedAt:(j.result as any)?.review?.savedAt??null,expiresAt:new Date(j.createdAt.getTime()+WEEK).toISOString(),expired:j.status==='expired'||j.createdAt.getTime()+WEEK<=Date.now(),message:j.errorCode?(bomVisionMessages[j.errorCode]??'未完成，请按原件核对'):null})),total,page:q.page,page_size:q.page_size};
 }
 private resultVersion(job:any){return bomHash(JSON.stringify({id:job.id,finishedAt:job.finishedAt,input:job.input}));}
 private async reviewMaterials(ctx:RequestContext,review:any){
  const ids=[...new Set<string>(review.groups.flatMap((g:any)=>[g.productId,...g.lines.map((l:any)=>l.materialId)]).filter(Boolean))];
  return this.db.mesMaterial.findMany({where:{tenantId:ctx.tenantId,active:true,id:{in:ids}},select:{id:true,sku:true,name:true,unit:true,kind:true}});
 }
 async saveReview(ctx:RequestContext,id:string,raw:unknown){
  if(Buffer.byteLength(JSON.stringify(raw)??'')>512*1024)throw new BadRequestException('暂存内容过大，请按装配分批核对');
  const body=readBody(z.object({version:z.int().nonnegative(),resultVersion:z.string().regex(/^[a-f0-9]{64}$/),requestKey:z.uuid(),review:bomReviewSchema}).strict(),raw);
  const job=await this.owned(ctx,id),current=await this.status(ctx,id);
  if(job.status!=='completed'||!current.result||(job.input as any).purged||job.createdAt.getTime()+WEEK<=Date.now())throw new ConflictException('任务未完成或已过期，不能暂存核对');
  const restored=restoreBomReview((job.result as any).preview,body.review,await this.reviewMaterials(ctx,body.review),true);
  const requestHash=bomHash(JSON.stringify({resultVersion:body.resultVersion,review:body.review}));
  await this.guard(ctx);
  return this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "AiTask" WHERE id=${id} FOR UPDATE`;
   const fresh=await tx.aiTask.findFirst({where:{id,tenantId:ctx.tenantId,membershipId:ctx.membershipId,userId:ctx.userId,kind:BOM_VISION_KIND,status:'completed'}}),state=fresh?.result as any;
   if(!fresh||body.resultVersion!==this.resultVersion(fresh))throw new ConflictException('识别结果已变化，请重新载入任务后核对');
   if(state?.review?.requestKey===body.requestKey){if(state.review.requestHash!==requestHash)throw new ConflictException('相同暂存请求的内容已变化');return {version:state.review.version,savedAt:state.review.savedAt};}
   if((state?.review?.version??0)!==body.version)throw new ConflictException('另一页面已暂存，请重新载入后核对；未覆盖服务端记录');
   const review={version:body.version+1,resultVersion:body.resultVersion,savedAt:new Date().toISOString(),requestKey:body.requestKey,requestHash,document:restored.document};
   await tx.aiTask.update({where:{id},data:{result:json({...state,review})}});return {version:review.version,savedAt:review.savedAt};
  });
 }
 async status(ctx:RequestContext,id:string){
  const job=await this.owned(ctx,id),input=job.input as unknown as Input,state=job.result as any;
  let preview=withoutRetiredBomChecks(state?.preview);
  if(job.status==='completed'&&!input.purged){const tables:BomTable[]=[];for(let i=0;i<(input.pages?.length??0);i++){const page=await this.saved<PageResult>(ctx.tenantId,id,i);if(!page)throw new ConflictException('原识别结果未完整保留，请按原件核对');tables.push(...page.tables);}preview=await this.intake.fromParsed(ctx,{tables:withoutRetiredBomChecks(tables),sources:input.files.map(f=>({filename:f.filename,sha256:f.sha256,bytes:f.bytes,visionJobId:id,sourceFileId:f.id,...(!tables.some(t=>t.file===f.filename)?{parseState:'review-required',warning:'未确认可用物料表，请按原件核对或手工补录'}:{})}as any)),pageCount:input.pages?.length??0},input.productId);}
  const usage=await this.db.aiModelUsage.findMany({where:{tenantId:ctx.tenantId,membershipId:ctx.membershipId,requestId:'bom:'+id,source:{startsWith:'bom-vision:'}},select:{id:true,requestedModel:true,model:true,usageStatus:true,inputTokens:true,outputTokens:true,totalTokens:true,cachedInputTokens:true,reasoningTokens:true,status:true,errorCode:true}});
  const resultVersion=job.status==='completed'?this.resultVersion(job):null;let invalidated=false;
  if(preview&&state?.review?.resultVersion===resultVersion){const restored=restoreBomReview(preview,state.review.document,await this.reviewMaterials(ctx,state.review.document));preview=withoutRetiredBomChecks(restored.result);invalidated=restored.invalidated;}
  const value={id,status:job.status,resultVersion,review:{version:state?.review?.version??0,savedAt:state?.review?.savedAt??null,restored:!!state?.review&&state.review.resultVersion===resultVersion,invalidated},productId:input.productId,stage:state?.stage==='crosschecking'?'reading':state?.stage??job.status,cursor:state?.cursor??0,totalPages:input.pages?.length??null,pages:withoutRetiredBomChecks((state?.pages??[]).map((p:any)=>({...p,canRecheck:!!p.canRecheck&&kimiVisionEnabled()&&input.version===VERSION&&input.promptSha===PROMPT_SHA}))),result:job.status==='completed'?preview:undefined,files:input.files.map(f=>({id:f.id,filename:f.filename,sha256:f.sha256,bytes:f.bytes,productCode:f.productCode,revision:f.revision})),usage,errorCode:job.errorCode,message:job.status==='expired'?bomVisionMessages.BOM_VISION_EXPIRED:job.errorCode?(bomVisionMessages[job.errorCode]??'识别未完成，已停止该批调用，请核对原资料或分批整理'):undefined,expiresAt:new Date(job.createdAt.getTime()+WEEK).toISOString()};
  await this.guard(ctx);return value;
 }
 async cancel(ctx:RequestContext,id:string){
  const job=await this.owned(ctx,id);await this.settle(job,{id,status:{in:['queued','running']}},{status:'cancelled',finishedAt:new Date()});const fresh=await this.owned(ctx,id);return {status:fresh.status};
 }
 async recheck(ctx:RequestContext,id:string,body:unknown){
  const {pageIndex}=readBody(z.object({pageIndex:z.int().min(0).max(23)}).strict(),body);const job=await this.owned(ctx,id),input=job.input as unknown as Input,state=job.result as any;
  if(!kimiVisionEnabled())throw new ConflictException('第二视觉模型未启用，请对照原件人工核对');
  if(job.status!=='completed'||input.purged||!input.pages?.[pageIndex]||input.pages[pageIndex].structured)throw new ConflictException('当前任务不能继续复核');
  if(input.version!==VERSION||input.promptSha!==PROMPT_SHA)throw new ConflictException('识别规则已更新，旧任务可继续核对；如需再次识别，请新建任务');
  const prior=await this.db.aiModelUsage.findMany({where:{requestId:'bom:'+id,source:{startsWith:`bom-vision:${pageIndex}:`}}});
  if(prior.some(r=>r.usageStatus!=='reported')||prior.some(r=>r.requestedModel===KIMI)||prior.length>=2)throw new ConflictException('该页已复核或调用状态不明，请人工核对');
  const changed=await this.db.aiTask.updateMany({where:{id,status:'completed',updatedAt:job.updatedAt},data:{status:'queued',finishedAt:null,errorCode:null,result:json({...state,review:undefined,stage:'rechecking',cursor:pageIndex,recheck:pageIndex,preview:undefined})}});
  if(!changed.count)throw new ConflictException('任务已变化');return {id,status:'queued'};
 }
 async source(ctx:RequestContext,id:string,fileId:string,page?:number){
  const job=await this.owned(ctx,id),input=job.input as unknown as Input,file=input.files.find(f=>f.id===fileId);
  if(!file)throw new NotFoundException('原件不存在');if(input.purged)throw new ConflictException(bomVisionMessages.BOM_VISION_EXPIRED);
  let value:any;
  if(page!==undefined){
   const index=input.pages?.findIndex(p=>p.fileId===fileId&&p.page===page&&!p.structured)??-1;
   if(index<0)throw new NotFoundException('原图页不存在');
   const bytes=await readBomFile(ctx.tenantId,id,`page-${index}-image.png`).catch(()=>{throw new NotFoundException('该页尚未准备完成');});
   value={filename:file.filename,sha256:file.sha256,page,mime:'image/png',data:bytes.toString('base64')};
  }else{const bytes=await readBomFile(ctx.tenantId,id,'source-'+file.id+'.bin');if(bomHash(bytes)!==file.sha256)throw new ConflictException('原件校验失败');value={filename:file.filename,sha256:file.sha256,data:bytes.toString('base64')};}
  await this.guard(ctx);return value;
 }
 private async saved<T>(tenant:string,id:string,index:number):Promise<T|null>{try{return JSON.parse((await readBomFile(tenant,id,`page-${index}-result.json`)).toString());}catch(e){if((e as any).code==='ENOENT')return null;throw e;}}
 private async save(tenant:string,id:string,index:number,value:PageResult){await writeBomFile(tenant,id,`page-${index}-result.json`,Buffer.from(JSON.stringify(value)));}
 private async context(job:any){const ctx=await this.auth.taskContext({tenantId:job.tenantId,userId:job.userId,membershipId:job.membershipId,appId:'mes',taskId:job.id});await this.guard(ctx);return ctx;}
 private async settle(job:any,where:any,data:any){
  return this.db.$transaction(async tx=>{const changed=await tx.aiTask.updateMany({where,data});if(!changed.count)return;
   const dedupeKey=`bom-vision:${job.id}:${job.attempts}:${data.status}`;
   await tx.personalNotification.upsert({where:{tenantId_recipientMembershipId_dedupeKey:{tenantId:job.tenantId,recipientMembershipId:job.membershipId,dedupeKey}},create:{tenantId:job.tenantId,recipientMembershipId:job.membershipId,appId:'mes',kind:'mes-bom',resourceId:job.id,dedupeKey,title:data.status==='completed'?'BOM整理完成，待核对':data.status==='cancelled'?'BOM整理已停止':'BOM整理未完成',body:data.status==='completed'?'识别结果已保存，请打开任务核对原件；完成不代表BOM已发布。':'请打开原任务查看状态和已记录用量，不要重复提交。'},update:{}});
  });
 }
 private tables(file:File,page:Page,index:number,id:string,p:PagePreparation,primary:VisionCall,secondary:VisionCall|undefined,reasons:string[]):PageResult{
  const a=primary.answer,b=secondary?.answer;const chosen=b??a;
  if(!chosen)throw new BomVisionError('BOM_VISION_SCHEMA_INVALID');
  const difference=Boolean(a&&b&&!sameVisionFacts(a,b));
  const comparisons=a&&b?compareVisionRows(a,b):[];
  const calls=[primary,...(secondary?[secondary]:[])];
  const vision={jobId:id,fileId:file.id,pageIndex:index,models:calls.map(c=>c.model),usageIds:calls.map(c=>c.usageId),promptSha256:PROMPT_SHA};
  const table:BomTable={warnings:reasons.filter(v=>/序号重复|多机型|多个适用机型/.test(v)).map(v=>v.includes('序号重复')?'识别结果中序号重复，可能有多个装配或机型；请按原件筛选本次适用明细，不要把整页混成同一BOM':v),file:file.filename,page:/\.pdf$/i.test(file.filename)?page.page:undefined,table:1,method:(secondary??primary).requestedModel===KIMI?'vision-kimi':'vision-glm',sourceSha256:file.sha256,productCode:file.productCode,revision:file.revision,pageSize:[p.width,p.height],vision,rows:chosen.rows.map((r,i)=>{
   const comparison=comparisons[i];
   const why=['视觉识别候选，定位行号为候选顺序，不代表原表物理行号；须核对身份、数量、单位、机型与版本',...(comparison&&(!comparison.aligned||comparison.different)?['GLM与Kimi本行存在字段差异或无法唯一对齐，请按原件核对']:[]),...chosen.uncertainties];
   const row:any={item:r.item??'',sourceRow:i+1,rawCells:[r.item,r.part,r.name,r.spec,r.mpn,r.designators,r.qty,r.sourceQty,r.unit,r.length].map(x=>x??''),confidence:0,sku:r.part??'',name:r.name??'',quantity:r.qty??'',unverifiedQuantity:r.sourceQty??r.qty??'',unit:r.unit??'',mpn:r.mpn??'',manufacturer:r.manufacturer??'',designators:r.designators??'',population:r.population??'',spec:r.spec??'',length:r.length??'',revision:r.revision??'',quantities:r.quantities,reviewReasons:why};
   if(chosen.variants.length>1&&r.qty!==null&&!Object.keys(r.quantities).length){row.quantity='';row.reviewReasons.push('多个机型的用量未能明确归属，未自动采用，请核对本行适用机型与用量');}
   if(sourceQuantityConflict(r)){row.quantity='';row.reviewReasons.push('原数量文字与结构化用量不一致，未自动采用，请对照本行原件填写');}
   if(comparison){row.visionIdentityConflict=!comparison.aligned||comparison.identityDifferent;if(comparison.quantityDifferent){row.quantity='';row.reviewReasons.push('两次视觉的数量、单位或适用数量不一致，未自动采用；请按原件填写本行用量');}if(!comparison.aligned)row.reviewReasons.push('两次结果未能按唯一序号或身份对齐，本行不能引用其他行的读值');const other=comparison.other;if(other&&comparison.different)row.reviewReasons.push('GLM同序候选：'+JSON.stringify({item:other.item,part:other.part,name:other.name,mpn:other.mpn,designators:other.designators,qty:other.qty,sourceQty:other.sourceQty,unit:other.unit,quantities:other.quantities,population:other.population,revision:other.revision}).slice(0,1000));}
   return row;
  })};
  return {version:VERSION,complete:true,tables:table.rows.length?[table]:[],primary,secondary,reasons:[...reasons,...(difference&&!chosen.rows.length?['Kimi未确认可用明细，GLM候选保留供追溯；请按原件人工核对，不自动采用']:[])],hasDifference:difference};
 }
 async tick():Promise<boolean>{
  const stale=new Date(Date.now()-600000);
  const job=await this.db.aiTask.findFirst({where:{kind:BOM_VISION_KIND,OR:[{status:'queued'},{status:'running',startedAt:{lt:stale}}]},orderBy:{createdAt:'asc'}});
  if(!job)return false;
  const attempt=job.attempts+1,claimed=await this.db.aiTask.updateMany({where:{id:job.id,status:job.status,updatedAt:job.updatedAt},data:{status:'running',attempts:attempt,startedAt:new Date()}});if(!claimed.count)return true;
  const claim={id:job.id,status:'running',attempts:attempt},controller=new AbortController();
  let polling=false;
  const heartbeat=setInterval(()=>{if(polling)return;polling=true;void(async()=>{const fresh=await this.db.aiTask.findFirst({where:claim});if(!fresh){controller.abort();return;}await this.context(fresh);await this.db.aiTask.updateMany({where:claim,data:{startedAt:new Date()}});})().catch(()=>controller.abort()).finally(()=>{polling=false;});},2000);
  try{
   const ctx=await this.context(job),input=job.input as unknown as Input,state=(job.result??{})as State;
   if(input.version!==VERSION||input.promptSha!==PROMPT_SHA)throw new BomVisionError('BOM_VISION_VERSION_CHANGED');
   if(!input.pages){
    const pages:Page[]=[];
    for(const file of input.files){const raw=await readBomFile(job.tenantId,job.id,'source-'+file.id+'.bin');if(bomHash(raw)!==file.sha256)throw new BomVisionError('BOM_SOURCE_CHANGED');const plan=await runVisionInput({mode:'plan',document:{filename:file.filename,data:raw.toString('base64')}},controller.signal);for(let i=1;i<=plan.pages;i++)pages.push({fileId:file.id,page:i,structured:plan.structured});}
    if(pages.length>24)throw new BomVisionError('DOCUMENT_PAGE_LIMIT');
    await this.db.aiTask.updateMany({where:claim,data:{status:'queued',input:json({...input,pages}),result:json({stage:'reading',cursor:0,totalPages:pages.length,pages:[]})}});return true;
   }
   const cursor=state.cursor??0,page=input.pages[cursor],file=input.files.find(f=>f.id===page?.fileId);
   if(!page||!file)throw new BomVisionError('BOM_VISION_PLAN_INVALID');
   let cached=await this.saved<PageResult>(job.tenantId,job.id,cursor);
   const manual=state.recheck===cursor;
   if(!cached||cached.complete!==true||manual&&!cached.secondary){
    // An unsettled or lost-result request can never be regenerated on recovery.
    const prior=await this.db.aiModelUsage.findMany({where:{requestId:'bom:'+job.id,source:{startsWith:`bom-vision:${cursor}:`}}});
    if(prior.some(r=>!['reported','not_requested'].includes(r.usageStatus)))throw new BomVisionError('BOM_VISION_USAGE_UNKNOWN');
    if(!cached&&prior.length)throw new BomVisionError('BOM_VISION_RESULT_MISSING');
    const bytes=await readBomFile(job.tenantId,job.id,'source-'+file.id+'.bin');if(bomHash(bytes)!==file.sha256)throw new BomVisionError('BOM_SOURCE_CHANGED');
    if(page.structured){
     if(manual)throw new BomVisionError('BOM_VISION_STRUCTURED_SOURCE');
     const parsed=await parseDocuments({documents:[{filename:file.filename,data:bytes.toString('base64'),productCode:file.productCode,revision:file.revision}]});cached={version:VERSION,complete:true,tables:parsed.tables,reasons:[],hasDifference:false};
    }else{
     const prepared:PagePreparation=await runVisionInput({mode:'prepare',page:page.page,document:{filename:file.filename,data:bytes.toString('base64')}},controller.signal);
     const image=Buffer.from(prepared.data,'base64');if(bomHash(image)!==prepared.sha256)throw new BomVisionError('BOM_SOURCE_CHANGED');
     await writeBomFile(job.tenantId,job.id,`page-${cursor}-image.png`,image);
     await this.context(job);if(controller.signal.aborted)throw new BomVisionError('BOM_VISION_STOPPED');
     if(!manual&&prepared.nativeTables.length){cached={version:VERSION,complete:true,tables:prepared.nativeTables.map(t=>({...t,sourceSha256:file.sha256,productCode:file.productCode,revision:file.revision})),reasons:[],hasDifference:false};}
     else{
      const scope={tenantId:job.tenantId,membershipId:job.membershipId,jobId:job.id,attempt,pageIndex:cursor,slot:0 as 0|1};
      let primary=cached?.primary;
      if(!primary){const model=manual?KIMI:primaryVisionModel(prepared);primary=await this.provider.run(scope,model,image,controller.signal);cached={version:VERSION,complete:false,tables:[],primary,reasons:[],hasDifference:false};await this.save(job.tenantId,job.id,cursor,cached);}
      const reasons=manual?['用户请求对本页复核']:recheckReasons(primary.answer,prepared);
      let secondary=cached?.secondary;
      if(primary.requestedModel===GLM&&reasons.length&&!secondary){
       if(manual&&kimiVisionEnabled()||automaticKimiRecheck(primary.answer,prepared)){await this.context(job);secondary=await this.provider.run({...scope,slot:1},KIMI,image,controller.signal);}
       else reasons.push(kimiVisionEnabled()?'本页保留人工核对提示，未自动追加第二次模型调用':'第二视觉模型未启用，疑点请按原件人工核对');
      }
      if(secondary&&!secondary.schemaValid||!secondary&&!primary.schemaValid)throw new BomVisionError('BOM_VISION_SCHEMA_INVALID');
      cached=this.tables(file,page,cursor,job.id,prepared,primary,secondary,reasons);
     }
    }
    cached.tables=cached.tables.map(t=>({...t,origin:{jobId:job.id,fileId:file.id,pageIndex:cursor}}));
    await this.save(job.tenantId,job.id,cursor,cached);
   }
   cached=withoutRetiredBomChecks(cached);
   if(cached.version!==VERSION)throw new BomVisionError('BOM_VISION_VERSION_CHANGED');
   await this.context(job);if(controller.signal.aborted)throw new BomVisionError('BOM_VISION_STOPPED');
   const pages=[...(state.pages??[])];pages[cursor]={pageIndex:cursor,filename:file.filename,page:page.page,method:cached.tables[0]?.method??'no-confirmed-table',models:[cached.primary?.model,cached.secondary?.model].filter(Boolean),reasons:cached.reasons,hasDifference:cached.hasDifference,canRecheck:kimiVisionEnabled()&&!page.structured&&!cached.secondary&&cached.primary?.requestedModel!==KIMI,rows:cached.tables.reduce((n,t)=>n+t.rows.length,0)};
   if(pages.reduce((n,p)=>n+(p?.rows??0),0)>300)throw new BomVisionError('DOCUMENT_ROW_LIMIT');
   if(cursor+1<input.pages.length){await this.db.aiTask.updateMany({where:claim,data:{status:'queued',result:json({stage:'reading',cursor:cursor+1,totalPages:input.pages.length,pages,...(state.recheck!==undefined?{recheck:state.recheck}:{})})}});return true;}
   const tables:BomTable[]=[];
   for(let i=0;i<input.pages.length;i++){const result=await this.saved<PageResult>(job.tenantId,job.id,i);if(!result)throw new BomVisionError('BOM_VISION_RESULT_MISSING');tables.push(...result.tables);}
   if(tables.reduce((n,t)=>n+t.rows.length,0)>300)throw new BomVisionError('DOCUMENT_ROW_LIMIT');
   const parsed:BomParse={tables:withoutRetiredBomChecks(tables),sources:input.files.map(f=>({filename:f.filename,sha256:f.sha256,bytes:f.bytes,visionJobId:job.id,sourceFileId:f.id,...(!tables.some(t=>t.file===f.filename)?{parseState:'review-required',warning:'未确认可用物料表，请对照原件核对或补录；不代表没有零件'}:{})}as any)),pageCount:input.pages.filter(p=>!p.structured).length};
   const preview=await this.intake.fromParsed(ctx,parsed,input.productId);
   await this.context(job);await this.settle({...job,attempts:attempt},claim,{status:'completed',finishedAt:new Date(),errorCode:null,result:json({stage:'completed',cursor:input.pages.length,totalPages:input.pages.length,pages,preview})});
  }catch(e){const code=e instanceof BomVisionError?e.code:'BOM_VISION_PROCESSING_FAILED';await this.settle({...job,attempts:attempt},claim,{status:'failed',errorCode:code,finishedAt:new Date()});}
  finally{clearInterval(heartbeat);}
  return true;
 }
 async cleanup(){
  const jobs=await this.db.aiTask.findMany({where:{kind:BOM_VISION_KIND,createdAt:{lt:new Date(Date.now()-WEEK)},status:{in:['completed','failed','cancelled']}},take:10});
  for(const job of jobs){await purgeBomFiles(job.tenantId,job.id);await this.db.aiTask.updateMany({where:{id:job.id,status:job.status},data:{status:'expired',input:json({...job.input as object,purged:true}),result:Prisma.DbNull}});}
 }
}
