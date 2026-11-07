import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import { nativeModelsEnabled } from '../ai/native-ai-policy';
import { usageColumns, type RuntimeReceipt } from '../ai/runtime-usage';
import { bomHash } from './bom-vision-storage';
import { BOM_VISION_PROMPT } from './bom-vision-prompt';

export const BOM_VISION_KIND='mes-bom-vision-v1';
export const GLM='glm-5-3-flash-260828',KIMI='kimi-k3-1-pro-261024';
export type VisionModel=typeof GLM|typeof KIMI;
export class BomVisionError extends Error{constructor(readonly code:string){super(code);this.name=code;}}
const scalar=z.string().max(2000).nullable();
export const visionAnswerSchema=z.object({bomPresent:z.boolean(),variants:z.array(z.string().max(500)).max(64),uncertainties:z.array(z.string().max(2000)).max(100),rows:z.array(z.object({item:scalar,part:scalar,name:scalar,qty:scalar,unit:scalar,quantities:z.record(z.string().max(500),z.string().max(100)).refine(v=>Object.keys(v).length<=64),mpn:scalar,designators:scalar,manufacturer:scalar,population:scalar,sourceQty:scalar,spec:scalar,length:scalar,revision:scalar,bbox:z.null()}).strict()).max(300)}).strict().refine(v=>v.bomPresent||!v.rows.length);
export type VisionAnswer=z.infer<typeof visionAnswerSchema>;
export const PROMPT_SHA=bomHash(BOM_VISION_PROMPT);
export const visionTimeout=(model:VisionModel)=>model===KIMI?360_000:300_000;
const valid=(v:unknown):v is number=>Number.isSafeInteger(v)&&typeof v==='number'&&v>=0;
/** One request, IPv4, bounded TLS establishment; never redispatch a paid body. */
function requestVision(url:string,body:string,signal:AbortSignal,usageId:string):Promise<Response>{
 return new Promise((resolve,reject)=>{
  const transport=url.startsWith('https:')?httpsRequest:httpRequest;
  const req=transport(url,{method:'POST',family:4,signal,headers:{authorization:'Bearer '+process.env.BOM_VISION_API_KEY,'content-type':'application/json','content-length':Buffer.byteLength(body),'x-client-request-id':usageId}},res=>{
   resolve(new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>,{status:res.statusCode??502}));
  });
  let timer:NodeJS.Timeout|undefined;
  req.on('socket',socket=>{if(socket.connecting){timer=setTimeout(()=>req.destroy(new Error('BOM_VISION_CONNECT_TIMEOUT')),30000);socket.once(url.startsWith('https:')?'secureConnect':'connect',()=>clearTimeout(timer));}});
  req.once('error',reject);req.once('close',()=>clearTimeout(timer));req.end(body);
 });
}
function endpoint(){
 const u=new URL(process.env.BOM_VISION_BASE_URL??'https://ark.cn-beijing.volces.com/api/v3');
 const test=process.env.NODE_ENV==='test'&&u.hostname==='127.0.0.1'&&u.protocol==='http:';
 if(!test&&(u.protocol!=='https:'||u.hostname!=='ark.cn-beijing.volces.com'||u.pathname.replace(/\/$/,'')!=='/api/v3'))throw new BomVisionError('BOM_VISION_CONFIGURATION_INVALID');
 if(u.username||u.password||u.search||u.hash)throw new BomVisionError('BOM_VISION_CONFIGURATION_INVALID');
 return u.toString().replace(/\/$/,'')+'/chat/completions';
}
export function bomVisionConfigured(){try{return nativeModelsEnabled()&&process.env.BOM_VISION_ENABLED==='true'&&(process.env.BOM_VISION_API_KEY?.length??0)>=8&&Boolean(endpoint());}catch{return false;}}
export function visionPayload(model:VisionModel,image:Buffer){
 return {model,max_tokens:16384,temperature:model===KIMI?1:0,reasoning_effort:'low',...(model===GLM?{thinking:{type:'enabled'}}:{}),stream:true,stream_options:{include_usage:true},messages:[{role:'user',content:[{type:'text',text:BOM_VISION_PROMPT},{type:'image_url',image_url:{url:'data:image/png;base64,'+image.toString('base64'),detail:'high'}}]}]};
}
export function parseVisionAnswer(text:string){
 const raw=text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
 try{return visionAnswerSchema.parse(JSON.parse(raw));}catch{return null;}
}
export type VisionCall={answer:VisionAnswer|null;schemaValid:boolean;model:string;requestedModel:VisionModel;usageId:string;promptSha256:string;imageSha256:string};
@Injectable()
export class BomVisionProvider{
 constructor(private readonly db:PrismaService){}
 async run(scope:{tenantId:string;membershipId:string;jobId:string;attempt:number;pageIndex:number;slot:0|1},model:VisionModel,image:Buffer,signal:AbortSignal):Promise<VisionCall>{
  if(!bomVisionConfigured())throw new BomVisionError('BOM_VISION_NOT_CONFIGURED');
  if(model===KIMI&&process.env.BOM_VISION_KIMI_ENABLED==='false')throw new BomVisionError('BOM_VISION_RECHECK_DISABLED');
  if(![GLM,KIMI].includes(model)||image.length>8*1024*1024)throw new BomVisionError('BOM_VISION_INPUT_INVALID');
  const body=JSON.stringify(visionPayload(model,image)),usageId=randomUUID(),requestId='bom:'+scope.jobId,source=`bom-vision:${scope.pageIndex}:${scope.slot}`;
  await this.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${requestId},0))`;
   const job=await tx.aiTask.findFirst({where:{id:scope.jobId,tenantId:scope.tenantId,membershipId:scope.membershipId,kind:BOM_VISION_KIND,status:'running',attempts:scope.attempt}});
   if(!job)throw new BomVisionError('BOM_VISION_STOPPED');
   const prior=await tx.aiModelUsage.findMany({where:{requestId,source:{startsWith:'bom-vision:'}}});
   if(prior.some(r=>r.source===source))throw new BomVisionError('BOM_VISION_REQUEST_ALREADY_ATTEMPTED');
   if(prior.some(r=>!['reported','not_requested'].includes(r.usageStatus)))throw new BomVisionError('BOM_VISION_USAGE_UNKNOWN');
   if(prior.filter(r=>r.source.startsWith(`bom-vision:${scope.pageIndex}:`)).length>=2)throw new BomVisionError('BOM_VISION_PAGE_CALL_LIMIT');
   await tx.aiModelUsage.create({data:{id:usageId,tenantId:scope.tenantId,membershipId:scope.membershipId,appId:'mes',requestId,source,purpose:scope.slot?'bom_recheck':'bom_extract',environment:process.env.NODE_ENV??'unknown',requestedModel:model,reservedTokens:65536}});
  });
  let requested=false,receipt:RuntimeReceipt|undefined,reported=false;
  const timeout=new AbortController(),timer=setTimeout(()=>timeout.abort(),visionTimeout(model)),combined=AbortSignal.any([signal,timeout.signal]);
  try{
   if(combined.aborted)throw new BomVisionError('BOM_VISION_STOPPED');
   requested=true;
   const response=await requestVision(endpoint(),body,combined,usageId);
   if(!response.ok||!response.body)throw new BomVisionError('BOM_VISION_UPSTREAM_'+response.status);
   const reader=response.body.getReader(),decoder=new TextDecoder(),parts:string[]=[];let pending='',bytes=0,finish='',done=false,reportedModel='';
   try{
    while(true){
     const item=await reader.read();if(item.done)break;
     bytes+=item.value.length;if(bytes>8*1024*1024)throw new BomVisionError('BOM_VISION_RESPONSE_LIMIT');
     pending+=decoder.decode(item.value,{stream:true});const lines=pending.split('\n');pending=lines.pop()??'';
     for(const line of lines){
      if(!line.startsWith('data:'))continue;const value=line.slice(5).trim();if(value==='[DONE]'){done=true;continue;}if(!value)continue;
      let event:any;try{event=JSON.parse(value);}catch{throw new BomVisionError('BOM_VISION_STREAM_INVALID');}
      if(event.model)reportedModel=String(event.model);
      const u=event.usage;
      if(u){
       if(!valid(u.prompt_tokens)||!valid(u.completion_tokens)||!valid(u.total_tokens)||u.prompt_tokens<=0||u.total_tokens<u.prompt_tokens+u.completion_tokens)throw new BomVisionError('BOM_VISION_USAGE_UNKNOWN');
       receipt={requestedModel:model,model:reportedModel||model,externalId:typeof event.id==='string'?event.id:undefined,usage:{inputTokens:u.prompt_tokens,outputTokens:u.completion_tokens,totalTokens:u.total_tokens,cachedInputTokens:u.prompt_tokens_details?.cached_tokens,reasoningTokens:u.completion_tokens_details?.reasoning_tokens}};
       reported=true;await this.db.aiModelUsage.update({where:{id:usageId},data:{...usageColumns(receipt)}});
       if(u.total_tokens>65536||u.completion_tokens>16384||u.prompt_tokens_details?.cached_tokens!==undefined&&(!valid(u.prompt_tokens_details.cached_tokens)||u.prompt_tokens_details.cached_tokens>u.prompt_tokens)||u.completion_tokens_details?.reasoning_tokens!==undefined&&(!valid(u.completion_tokens_details.reasoning_tokens)||u.completion_tokens_details.reasoning_tokens>u.completion_tokens))throw new BomVisionError('BOM_VISION_TOKEN_ANOMALY');
      }
      for(const c of event.choices??[]){if(typeof c.delta?.content==='string')parts.push(c.delta.content);if(c.delta?.tool_calls)throw new BomVisionError('BOM_VISION_TOOL_OUTPUT_INVALID');if(c.finish_reason)finish=c.finish_reason;}
     }
    }
   }finally{await reader.cancel().catch(()=>{});}
   if(!reported)throw new BomVisionError('BOM_VISION_USAGE_UNKNOWN');
   if(!done||finish!=='stop')throw new BomVisionError('BOM_VISION_RESPONSE_INCOMPLETE');
   if(reportedModel&&reportedModel!==model)throw new BomVisionError('BOM_VISION_MODEL_CHANGED');
   const answer=parseVisionAnswer(parts.join(''));
   await this.db.aiModelUsage.update({where:{id:usageId},data:{...usageColumns(receipt),status:answer?'completed':'failed',errorCode:answer?null:'BOM_VISION_SCHEMA_INVALID',finishedAt:new Date()}});
   return {answer,schemaValid:Boolean(answer),model:reportedModel||model,requestedModel:model,usageId,promptSha256:PROMPT_SHA,imageSha256:bomHash(image)};
  }catch(e){
   const code=e instanceof BomVisionError?e.code:combined.aborted?'BOM_VISION_INTERRUPTED':'BOM_VISION_CONNECTION_FAILED';
   await this.db.aiModelUsage.update({where:{id:usageId},data:{status:'failed',...usageColumns(receipt),usageStatus:reported?'reported':requested?'unknown':'not_requested',errorCode:code,finishedAt:new Date()}});
   throw new BomVisionError(code);
  }finally{clearTimeout(timer);}
 }
}
