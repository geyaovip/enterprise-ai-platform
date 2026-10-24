import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../platform/auth.service';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
import { APP_AI_PROVIDER } from './app-ai-provider';
import { AiProviderRegistry } from './provider-registry';
import { MemoryCoreClient } from './memory-core.client';
const fields=z.object({title:z.string().trim().min(1).max(60),content:z.string().trim().min(1).max(800),kind:z.enum(['preference','convention']),visibility:z.enum(['personal','enterprise']),expiresAt:z.iso.datetime().nullable().optional()}).strict();
export type MemoryRef={id:string;version:number};
export type MemoryContext={text:string;refs:MemoryRef[];status:'used'|'empty'|'disabled'|'unavailable';notice?:string};
@Injectable()
export class AiMemoryService {
 constructor(private readonly db:PrismaService,private readonly auth:AuthService,private readonly engine:MemoryCoreClient,@Inject(APP_AI_PROVIDER) private readonly providers:AiProviderRegistry){}
 private where(ctx:RequestContext){return {tenantId:ctx.tenantId,appId:ctx.app.appId,OR:[{visibility:'enterprise',ownerUserId:null},{visibility:'personal',ownerUserId:ctx.userId}]};}
 private async check(ctx:RequestContext){this.providers.agent(ctx);const fresh=await this.auth.taskContext({...ctx,appId:ctx.app.appId,taskId:'memory'});if(JSON.stringify([...fresh.permissions].sort())!==JSON.stringify([...ctx.permissions].sort())||JSON.stringify(fresh.roles)!==JSON.stringify(ctx.roles))throw new ForbiddenException('当前权限已变化，请刷新');}
 private async audit(tx:any,ctx:RequestContext,action:string,id:string){await tx.auditEvent.create({data:{tenantId:ctx.tenantId,userId:ctx.userId,membershipId:ctx.membershipId,appId:ctx.app.appId,requestId:ctx.requestId,action:'platform.ai.memory.'+action,resourceType:'AiMemoryEntry',resourceId:id}});}
 async preferences(ctx:RequestContext){await this.check(ctx);const value=await this.db.aiMemorySetting.findUnique({where:{tenantId_userId_appId:{tenantId:ctx.tenantId,userId:ctx.userId,appId:ctx.app.appId}}});return {enabled:value?.enabled??true};}
 async setPreferences(ctx:RequestContext,body:unknown){await this.check(ctx);const input=readBody(z.object({enabled:z.boolean()}).strict(),body);await this.db.$transaction(async tx=>{await tx.aiMemorySetting.upsert({where:{tenantId_userId_appId:{tenantId:ctx.tenantId,userId:ctx.userId,appId:ctx.app.appId}},create:{tenantId:ctx.tenantId,userId:ctx.userId,appId:ctx.app.appId,...input},update:input});await this.audit(tx,ctx,input.enabled?'enable':'disable',ctx.userId);});return input;}
 async list(ctx:RequestContext){await this.check(ctx);const [items,pref,pending]=await Promise.all([this.db.aiMemoryEntry.findMany({where:this.where(ctx),orderBy:[{visibility:'asc'},{updatedAt:'desc'}],take:100}),this.preferences(ctx),this.db.aiMemoryIndexPurge.count({where:{tenantId:ctx.tenantId,appId:ctx.app.appId,OR:[{userId:null},{userId:ctx.userId}]}})]);return {...pref,items:items.map(x=>({...x,editable:x.visibility==='personal'?x.ownerUserId===ctx.userId:ctx.roles.includes('admin')})),canManageShared:ctx.roles.includes('admin'),indexCleanupPending:pending>0,engine:{name:'memory-core',configured:this.engine.configured,mode:'keyword'},limitPerScope:50};}
 private validate(body:unknown){const value=readBody(fields,body);if(/-----BEGIN .*PRIVATE KEY|\bBearer\s+\S{12,}|\bsk-[A-Za-z0-9_-]{16,}|(?:密码|password|api[_ -]?key)\s*[:：=]\s*\S{4,}/i.test(value.title+'\n'+value.content))throw new ConflictException('请勿将密码、令牌或密钥保存为记忆');if(value.expiresAt&&new Date(value.expiresAt)<=new Date())throw new ConflictException('有效期必须晚于当前时间');return {...value,expiresAt:value.expiresAt?new Date(value.expiresAt):null};}
 async create(ctx:RequestContext,body:unknown){await this.check(ctx);const input=this.validate(body);if(input.visibility==='enterprise'&&!ctx.roles.includes('admin'))throw new ForbiddenException('仅管理员可维护企业约定');const ownerUserId=input.visibility==='personal'?ctx.userId:null;
  const row=await this.db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ctx.tenantId+':'+ctx.app.appId+':'+(ownerUserId??'shared')}))`;const count=await tx.aiMemoryEntry.count({where:{tenantId:ctx.tenantId,appId:ctx.app.appId,ownerUserId}});if(count>=50)throw new ConflictException('该范围最多保存50条记忆，请先整理');const r=await tx.aiMemoryEntry.create({data:{tenantId:ctx.tenantId,appId:ctx.app.appId,ownerUserId,createdByUserId:ctx.userId,...input}});await this.audit(tx,ctx,'create',r.id);return r;});return row;
 }
 async update(ctx:RequestContext,id:string,body:unknown){await this.check(ctx);const parsed=readBody(fields.extend({version:z.int().positive()}).strict(),body);const {version,...raw}=parsed;const input=this.validate(raw);return this.mutate(ctx,id,version,input);}
 async remove(ctx:RequestContext,id:string){await this.check(ctx);return this.mutate(ctx,id);}
 private async mutate(ctx:RequestContext,id:string,version?:number,input?:ReturnType<AiMemoryService['validate']>){
  const result=await this.db.$transaction(async tx=>{const row=await tx.aiMemoryEntry.findFirst({where:{id,...this.where(ctx)}});if(!row)throw new NotFoundException('记忆不存在');if(row.visibility==='enterprise'&&!ctx.roles.includes('admin'))throw new ForbiddenException('仅管理员可维护企业约定');if(input&&input.visibility!==row.visibility)throw new ConflictException('修改时不能变更记忆范围，请另行创建');
   if(input){const changed=await tx.aiMemoryEntry.updateMany({where:{id,version},data:{...input,version:{increment:1}}});if(!changed.count)throw new ConflictException('记忆已被修改，请刷新');}else await tx.aiMemoryEntry.delete({where:{id}});
   await this.audit(tx,ctx,input?'update':'delete',id);const job=await tx.aiMemoryIndexPurge.create({data:{tenantId:ctx.tenantId,appId:ctx.app.appId,userId:row.visibility==='personal'?ctx.userId:null}});return {jobId:job.id,row:input?await tx.aiMemoryEntry.findUnique({where:{id}}):null};});
  await this.flushPurge(result.jobId);return result.row??{ok:true};
 }
 async flushPurge(id?:string){if(!this.engine.configured)return;const jobs=await this.db.aiMemoryIndexPurge.findMany({where:id?{id}:{nextAttemptAt:{lte:new Date()}},orderBy:{createdAt:'asc'},take:id?1:10});for(const job of jobs){try{await this.engine.invalidate({tenantId:job.tenantId,appId:job.appId,...(job.userId?{userId:job.userId}:{})});await this.db.aiMemoryIndexPurge.deleteMany({where:{id:job.id}});}catch{await this.db.aiMemoryIndexPurge.updateMany({where:{id:job.id},data:{attempts:{increment:1},nextAttemptAt:new Date(Date.now()+Math.min(300000,10000*2**Math.min(job.attempts,5)))}});}}}
 async visibleRefs(ctx:RequestContext,refs:MemoryRef[]){if(!refs.length)return [];const now=new Date();const rows=await this.db.aiMemoryEntry.findMany({where:{...this.where(ctx),id:{in:[...new Set(refs.map(r=>r.id))]},AND:[{OR:[{expiresAt:null},{expiresAt:{gt:now}}]}]},select:{id:true,version:true}});return rows;}
 async refsVisible(ctx:RequestContext,refs:MemoryRef[]){const rows=await this.visibleRefs(ctx,refs);return refs.every(ref=>rows.some(r=>r.id===ref.id&&r.version===ref.version));}
 async assertCurrent(ctx:RequestContext,refs:MemoryRef[]){await this.check(ctx);if(!await this.refsVisible(ctx,refs))throw new ConflictException('本次引用的记忆已变化，请重新发送');}
 async context(ctx:RequestContext,query:string,useMemory:boolean):Promise<MemoryContext>{await this.check(ctx);if(!useMemory||!(await this.preferences(ctx)).enabled)return {text:'',refs:[],status:'disabled'};
  const snapshotAt=Date.now();
  const rows=await this.db.aiMemoryEntry.findMany({where:{...this.where(ctx),AND:[{OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]}]},orderBy:{updatedAt:'desc'},take:100});if(!rows.length)return {text:'',refs:[],status:'empty'};
  let selectedIds:string[]=[],unavailable=false;
  try{if(rows.some(r=>r.kind==='convention')||rows.filter(r=>r.kind==='preference'&&r.visibility==='personal').length>4||rows.filter(r=>r.kind==='preference'&&r.visibility==='enterprise').length>2)selectedIds=await this.engine.recall({tenantId:ctx.tenantId,userId:ctx.userId,appId:ctx.app.appId},rows.map(r=>({id:r.id,text:r.title+'\n'+r.content})),query,snapshotAt);}catch{unavailable=true;}
  const preferences=rows.filter(r=>r.kind==='preference'&&r.visibility==='personal').slice(0,4);const sharedPreferences=rows.filter(r=>r.kind==='preference'&&r.visibility==='enterprise').slice(0,2);
  const selected=[...new Map([...preferences,...sharedPreferences,...rows.filter(r=>selectedIds.includes(r.id))].map(r=>[r.id,r])).values()].slice(0,8);let chars=0;const bounded=selected.filter(r=>{chars+=r.content.length+r.title.length;return chars<=3500;});
  const refs=bounded.map(r=>({id:r.id,version:r.version}));await this.assertCurrent(ctx,refs);
  return {text:bounded.length?JSON.stringify(bounded.map(r=>({id:r.id,title:r.title,content:r.content,visibility:r.visibility,kind:r.kind,updatedAt:r.updatedAt.toISOString()}))):'',refs,status:unavailable?'unavailable':bounded.length?'used':'empty',...(unavailable?{notice:'长期记忆检索暂不可用，本次仅使用已确认的常驻偏好。'}:{})};
 }
}
