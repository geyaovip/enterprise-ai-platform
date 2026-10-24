import { ConflictException, Injectable, NotFoundException, HttpException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
import { CommandBus } from './command-bus';
import { fingerprint } from './command-registry';
import { QuotaService } from './quota.service';
const planInput=z.object({requestKey:z.string().min(8).max(100),title:z.string().trim().min(1).max(120),kind:z.string().max(40).default('workflow'),steps:z.array(z.object({appId:z.string().max(32),command:z.string().max(100),title:z.string().trim().min(1).max(120),input:z.record(z.string(),z.unknown())})).min(1).max(20)});
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export function resolveReferences(value:any,results:any[],ordinal:number):any{
  if(Array.isArray(value))return value.map(v=>resolveReferences(v,results,ordinal));
  if(value&&typeof value==='object'){
    if(Object.hasOwn(value,'fromStep')){
      if(!Number.isInteger(value.fromStep)||value.fromStep<0||value.fromStep>=ordinal||!Array.isArray(value.path)||value.path.length>8||value.path.some((p:any)=>typeof p!=='string'||['__proto__','constructor','prototype'].includes(p)))throw new ConflictException('任务步骤引用无效');
      let result=results[value.fromStep];for(const key of value.path)result=result?.[key];if(result===undefined)throw new ConflictException('前置步骤未提供所需结果');return result;
    }
    return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolveReferences(v,results,ordinal)]));
  }
  return value;
}
@Injectable()
export class TaskService{
 constructor(private readonly db:PrismaService,private readonly bus:CommandBus,private readonly quota:QuotaService){}
 async create(ctx:RequestContext,body:unknown){
  const input=readBody(planInput,body),hash=fingerprint(input);
  for(const [i,step]of input.steps.entries()){
   const fresh=await this.bus.context(ctx,step.appId,'plan');const command=this.bus.registry.get(step.appId,step.command);
   if(!fresh.permissions.includes(command.permission))throw new ConflictException('计划包含未授权的应用操作');
   // References are validated structurally now and by the target schema after resolution.
   const refs=JSON.stringify(step.input).includes('"fromStep"');if(!refs)this.bus.registry.prepare(fresh,step.command,step.input);
   const visit=(v:any):void=>{if(!v||typeof v!=='object')return;if('fromStep'in v){if(!Number.isInteger(v.fromStep)||v.fromStep<0||v.fromStep>=i||!Array.isArray(v.path)||!v.path.every((x:any)=>typeof x==='string'&&!['__proto__','constructor','prototype'].includes(x)))throw new ConflictException('任务步骤引用无效');}else Object.values(v).forEach(visit);};visit(step.input);
  }
  return this.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ctx.tenantId+':task:'+ctx.membershipId+':'+input.requestKey},0))`;
   const old=await tx.businessTask.findUnique({where:{tenantId_membershipId_requestKey:{tenantId:ctx.tenantId,membershipId:ctx.membershipId,requestKey:input.requestKey}},include:{steps:{orderBy:{ordinal:'asc'}}}});
   if(old){if(old.fingerprint!==hash)throw new ConflictException('请求标识已被其他计划使用');return old;}
   await this.quota.reserve(ctx,'task',input.requestKey,tx);
   const requires=input.steps.some(s=>this.bus.registry.get(s.appId,s.command).confirmation);
   const task=await tx.businessTask.create({data:{tenantId:ctx.tenantId,userId:ctx.userId,membershipId:ctx.membershipId,appId:ctx.app.appId,requestKey:input.requestKey,fingerprint:hash,title:input.title,kind:input.kind,input:json(input),status:requires?'awaiting_confirmation':'queued',steps:{create:input.steps.map((s,i)=>({...s,tenantId:ctx.tenantId,ordinal:i,input:json(s.input)}))}},include:{steps:{orderBy:{ordinal:'asc'}}}});
   await tx.auditEvent.create({data:{tenantId:ctx.tenantId,userId:ctx.userId,membershipId:ctx.membershipId,appId:ctx.app.appId,requestId:ctx.requestId,action:'platform.task.create',resourceType:'BusinessTask',resourceId:task.id}});return task;
  });
 }
 async list(ctx:RequestContext){const candidates=await this.db.businessTask.findMany({where:{tenantId:ctx.tenantId,membershipId:ctx.membershipId},include:{steps:{orderBy:{ordinal:'asc'}}},orderBy:{createdAt:'desc'},take:100});const visible=[];for(const task of candidates){try{visible.push(await this.get(ctx,task.id));}catch{visible.push({...task,title:'应用授权已变化的任务',input:{},result:null,steps:task.steps.map(s=>({...s,title:'业务步骤',input:{},result:null,errorCode:null}))});}}return visible;}
 async get(ctx:RequestContext,id:string){const task=await this.db.businessTask.findFirst({where:{id,tenantId:ctx.tenantId,membershipId:ctx.membershipId},include:{steps:{orderBy:{ordinal:'asc'}}}});if(!task)throw new NotFoundException('任务不存在');for(const step of task.steps){const fresh=await this.bus.context(ctx,step.appId,id);if(!fresh.permissions.includes(this.bus.registry.get(step.appId,step.command).permission))throw new NotFoundException('任务不可访问');}const enriched=[];for(const step of task.steps){const cmd=this.bus.registry.get(step.appId,step.command);let preview=null;try{if(cmd.preview&&!JSON.stringify(step.input).includes('"fromStep"'))preview=await cmd.preview(await this.bus.context(ctx,step.appId,id),step.input);}catch{}enriched.push({...step,preview});}return{...task,steps:enriched};}
 async action(ctx:RequestContext,id:string,body:unknown){
  const input=readBody(z.object({action:z.enum(['confirm','cancel','retry']),version:z.int().positive()}),body);if(input.action!=='cancel')await this.get(ctx,id);
  return this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "BusinessTask" WHERE id=${id} FOR UPDATE`;
   const task=await tx.businessTask.findFirst({where:{id,tenantId:ctx.tenantId,membershipId:ctx.membershipId,version:input.version}});if(!task)throw new ConflictException('任务已变化，请刷新');
   const allowed=input.action==='confirm'?task.status==='awaiting_confirmation':input.action==='retry'?task.status==='failed':!['cancelled','completed'].includes(task.status);if(!allowed)throw new ConflictException('当前任务不支持此操作');
   if(input.action==='cancel')await tx.businessTaskStep.updateMany({where:{taskId:id,status:{in:['pending','waiting','running']}},data:{status:'cancelled'}});
   if(input.action==='confirm')await tx.businessTaskStep.updateMany({where:{taskId:id,tenantId:ctx.tenantId},data:{confirmedAt:new Date(),confirmedBy:ctx.membershipId}});
   if(input.action==='retry')await tx.businessTaskStep.updateMany({where:{taskId:id,status:'failed'},data:{status:'pending',errorCode:null}});
   await tx.businessTask.update({where:{id},data:{status:input.action==='cancel'?'cancelled':'queued',wakeAt:new Date(),leaseToken:null,leasedUntil:null,errorCode:null,version:{increment:1}}});
   await tx.auditEvent.create({data:{tenantId:ctx.tenantId,userId:ctx.userId,membershipId:ctx.membershipId,appId:task.appId,requestId:ctx.requestId,action:`platform.task.${input.action}`,resourceType:'BusinessTask',resourceId:id}});return{ok:true};
  });
 }
 private lastTenant='';
 async tick(){
  const ready=await this.db.$queryRaw<Array<{id:string}>>`SELECT id FROM (SELECT DISTINCT ON ("tenantId") id,"wakeAt" FROM "BusinessTask" WHERE "wakeAt"<=NOW() AND (status IN ('queued','waiting') OR (status='running' AND "leasedUntil"<NOW())) ORDER BY "tenantId","wakeAt",id) q ORDER BY "wakeAt" LIMIT 200`;
  const candidates=await this.db.businessTask.findMany({where:{id:{in:ready.map(r=>r.id)}},orderBy:{wakeAt:'asc'}});
  const task=candidates.find(t=>t.tenantId!==this.lastTenant)??candidates[0];if(!task)return false;this.lastTenant=task.tenantId;
  const token=randomUUID();const claim=await this.db.businessTask.updateMany({where:{id:task.id,version:task.version,status:task.status},data:{status:'running',leaseToken:token,leasedUntil:new Date(Date.now()+90000),attempts:{increment:1},version:{increment:1}}});if(!claim.count)return true;
  const steps=await this.db.businessTaskStep.findMany({where:{taskId:task.id},orderBy:{ordinal:'asc'}}),step=steps.find(s=>s.status!=='completed');
  if(!step){await this.finish(task.id,token,'completed',json(steps.map(s=>({title:s.title,result:s.result}))));return true;}
  try{
   const ctx=await this.bus.context({tenantId:task.tenantId,userId:task.userId,membershipId:task.membershipId}as RequestContext,step.appId,task.id);
   const input=resolveReferences(step.input,steps.map(s=>s.result),step.ordinal);
   const active=await this.db.businessTaskStep.updateMany({where:{id:step.id,task:{status:'running',leaseToken:token}},data:{status:'running',startedAt:new Date(),attempts:{increment:1}}});if(!active.count)return true;
   const result=await this.bus.execute(ctx,step.appId,step.command,input,`task:${task.id}:${step.ordinal}`,Boolean(step.confirmedAt),{taskId:task.id,token});
   await this.db.$transaction(async tx=>{
    const owned=await tx.businessTask.updateMany({where:{id:task.id,status:'running',leaseToken:token},data:{status:result.state==='waiting'?'waiting':'queued',wakeAt:new Date(Date.now()+(result.state==='waiting'?30000:0)),leaseToken:null,leasedUntil:null,version:{increment:1}}});if(!owned.count)return;
    await tx.businessTaskStep.update({where:{id:step.id},data:{status:result.state==='waiting'?'waiting':'completed',result:result.result,finishedAt:result.state==='completed'?new Date():null,errorCode:null}});
    if(result.state==='waiting')await this.notify(tx,task,'waiting:'+step.ordinal,'任务等待业务办理','请办理相关审批或入库，完成后任务会自动继续。');
   });
  }catch(e){await this.db.$transaction(async tx=>{const owned=await tx.businessTask.updateMany({where:{id:task.id,status:'running',leaseToken:token},data:{status:'failed',leaseToken:null,leasedUntil:null,errorCode:e instanceof Error?e.name:'UNKNOWN',version:{increment:1}}});if(owned.count){await tx.businessTaskStep.update({where:{id:step.id},data:{status:'failed',errorCode:e instanceof HttpException?e.message.slice(0,250):'执行暂时失败，请重试'}});await this.notify(tx,task,'failed:'+task.version,'任务需要处理','执行未完成，请打开任务查看并重试。');}});}
  return true;
 }
 private async notify(tx:Prisma.TransactionClient,task:any,key:string,title:string,body:string){await tx.personalNotification.upsert({where:{tenantId_recipientMembershipId_dedupeKey:{tenantId:task.tenantId,recipientMembershipId:task.membershipId,dedupeKey:'business-task:'+task.id+':'+key}},create:{tenantId:task.tenantId,recipientMembershipId:task.membershipId,appId:task.appId,kind:'business-task',resourceId:task.id,dedupeKey:'business-task:'+task.id+':'+key,title:title+' · '+task.title,body},update:{}});}
 private async finish(id:string,token:string,status:string,result:Prisma.InputJsonValue){await this.db.$transaction(async tx=>{const task=await tx.businessTask.findUniqueOrThrow({where:{id}});const changed=await tx.businessTask.updateMany({where:{id,status:'running',leaseToken:token},data:{status,result,leaseToken:null,leasedUntil:null,version:{increment:1}}});if(changed.count)await this.notify(tx,task,'completed','任务已完成','全部步骤已完成，点击查看业务回执。');});}
}
