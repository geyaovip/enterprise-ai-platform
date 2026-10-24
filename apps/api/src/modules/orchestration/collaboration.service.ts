import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
import { CommandBus } from './command-bus';
import { fingerprint } from './command-registry';
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export const eventInput=z.object({targetApp:z.string().max(32),command:z.string().max(100),requestKey:z.string().min(8).max(100),input:z.record(z.string(),z.unknown()),confirmed:z.boolean().default(false)});
@Injectable()
export class ApplicationCollaborationService{
 constructor(private readonly db:PrismaService,private readonly bus:CommandBus){}
 /** Caller supplies its business transaction, so source write and outgoing event commit together. */
 async enqueue(tx:Prisma.TransactionClient,ctx:RequestContext,body:unknown){
  const input=readBody(eventInput,body);
  if(!ctx.permissions.includes(`${ctx.app.appId}.collaboration.emit`))throw new ConflictException('无权发起应用协作');
  const target=await this.bus.context(ctx,input.targetApp,'event'),prepared=this.bus.registry.prepare(target,input.command,input.input);
  if(prepared.cmd.confirmation&&!input.confirmed)throw new ConflictException('目标操作需要确认');
  const hash=fingerprint(input);await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ctx.tenantId+':event:'+ctx.app.appId+':'+input.requestKey},0))`;
  const old=await tx.applicationOutbox.findUnique({where:{tenantId_sourceApp_requestKey:{tenantId:ctx.tenantId,sourceApp:ctx.app.appId,requestKey:input.requestKey}}});if(old){if(old.fingerprint!==hash||old.membershipId!==ctx.membershipId)throw new ConflictException('事件标识对应的参数或发起人不一致');return old;}
  return tx.applicationOutbox.create({data:{tenantId:ctx.tenantId,userId:ctx.userId,membershipId:ctx.membershipId,sourceApp:ctx.app.appId,targetApp:input.targetApp,command:input.command,requestKey:input.requestKey,fingerprint:hash,input:json(prepared.input),confirmed:input.confirmed}});
 }
 async emit(ctx:RequestContext,body:unknown){return this.db.$transaction(tx=>this.enqueue(tx,ctx,body));}
 async list(ctx:RequestContext){return this.db.applicationOutbox.findMany({where:{tenantId:ctx.tenantId,sourceApp:ctx.app.appId,membershipId:ctx.membershipId},orderBy:{createdAt:'desc'},take:100});}
 async retry(ctx:RequestContext,id:string){const event=await this.db.applicationOutbox.findFirst({where:{id,tenantId:ctx.tenantId,sourceApp:ctx.app.appId,membershipId:ctx.membershipId,status:'failed'}});if(!event)throw new NotFoundException('事件不存在或不能重试');await this.bus.context(ctx,event.targetApp,id);return this.db.applicationOutbox.updateMany({where:{id,status:'failed'},data:{status:'queued',attempts:0,wakeAt:new Date(),errorCode:null,leaseToken:null,leasedUntil:null}});}
 async link(ctx:RequestContext,body:unknown){
  const input=readBody(z.object({sourceType:z.string().min(1).max(40),sourceId:z.uuid(),targetApp:z.string().max(32),targetType:z.string().min(1).max(40),targetId:z.uuid()}),body);
  await this.bus.registry.resource(ctx,input.sourceType,input.sourceId);const target=await this.bus.context(ctx,input.targetApp,'link');await this.bus.registry.resource(target,input.targetType,input.targetId);
  const where={tenantId:ctx.tenantId,sourceApp:ctx.app.appId,...input};return this.db.applicationObjectLink.upsert({where:{tenantId_sourceApp_sourceType_sourceId_targetApp_targetType_targetId:where},create:{...where,createdBy:ctx.membershipId},update:{}});
 }
 async links(ctx:RequestContext,type:string,id:string){await this.bus.registry.resource(ctx,type,id);const links=await this.db.applicationObjectLink.findMany({where:{tenantId:ctx.tenantId,sourceApp:ctx.app.appId,sourceType:type,sourceId:id}});const visible=[];for(const link of links){try{const target=await this.bus.context(ctx,link.targetApp,'link');await this.bus.registry.resource(target,link.targetType,link.targetId);visible.push(link);}catch{}}return visible;}
 private lastTenant='';
 async tick(){
  const ready=await this.db.$queryRaw<Array<{id:string}>>`SELECT id FROM (SELECT DISTINCT ON ("tenantId") id,"wakeAt" FROM "ApplicationOutbox" WHERE "wakeAt"<=NOW() AND (status IN ('queued','retry') OR (status='running' AND "leasedUntil"<NOW())) ORDER BY "tenantId","wakeAt",id) q ORDER BY "wakeAt" LIMIT 200`;const events=await this.db.applicationOutbox.findMany({where:{id:{in:ready.map(r=>r.id)}},orderBy:{wakeAt:'asc'}});const e=events.find(e=>e.tenantId!==this.lastTenant)??events[0];if(!e)return false;this.lastTenant=e.tenantId;
  const token=randomUUID(),claimed=await this.db.applicationOutbox.updateMany({where:{id:e.id,status:e.status,attempts:e.attempts,leaseToken:e.leaseToken},data:{status:'running',leaseToken:token,leasedUntil:new Date(Date.now()+90000),attempts:{increment:1}}});if(!claimed.count)return true;
  try{
   const actor=await this.bus.context({tenantId:e.tenantId,userId:e.userId,membershipId:e.membershipId}as RequestContext,e.sourceApp,e.id);if(!actor.permissions.includes(`${e.sourceApp}.collaboration.emit`))throw new ConflictException('发起人的协作权限已撤销');
   const result=await this.bus.execute(actor,e.targetApp,e.command,e.input,`event:${e.id}`,e.confirmed);
   await this.db.applicationOutbox.updateMany({where:{id:e.id,status:'running',leaseToken:token},data:{status:result.state==='completed'?'delivered':'retry',result:result.result,errorCode:null,wakeAt:new Date(Date.now()+30000),leaseToken:null,leasedUntil:null}});
  }catch(error){await this.db.applicationOutbox.updateMany({where:{id:e.id,status:'running',leaseToken:token},data:{status:e.attempts+1>=5?'failed':'retry',errorCode:error instanceof Error?error.name:'UNKNOWN',wakeAt:new Date(Date.now()+Math.min(600000,1000*2**Math.min(e.attempts,8))),leaseToken:null,leasedUntil:null}});}
  return true;
 }
}
