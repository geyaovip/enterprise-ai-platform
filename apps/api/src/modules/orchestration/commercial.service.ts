import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../platform/auth.service';
import { ApplicationRegistry } from '../platform/application-registry';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
import { QuotaService } from './quota.service';
const amount=z.string().regex(/^(0|[1-9]\d{0,12})(\.\d{1,6})?$/);
const scopes=z.array(z.enum(['health','audit','tasks'])).min(1).max(3).refine(s=>new Set(s).size===s.length);
@Injectable()
export class CommercialService{
 constructor(private readonly db:PrismaService,private readonly auth:AuthService,private readonly apps:ApplicationRegistry,private readonly quotas:QuotaService){}
 private async tenant(id:string){const t=await this.db.tenant.findUnique({where:{id}});if(!t?.active)throw new NotFoundException('企业不可用');return t;}
 async plans(){const plans=await this.db.servicePlan.findMany({orderBy:{code:'asc'}});return plans.map(p=>({...p,knowledgeBytes:p.knowledgeBytes.toString()}));}
 async savePlan(operator:string,body:unknown){
  const input=readBody(z.object({code:z.string().regex(/^[a-z][a-z0-9_-]{1,39}$/),name:z.string().trim().min(1).max(80),appIds:z.array(z.string()).min(1).max(20),seatLimit:z.int().min(1).max(100000),aiRunLimit:z.int().min(0).max(10000000),taskLimit:z.int().min(0).max(10000000),knowledgeBytes:z.string().regex(/^\d{1,15}$/),monthlyPrice:amount,inputTokenPrice:amount.nullable().optional(),outputTokenPrice:amount.nullable().optional(),active:z.boolean().default(true),version:z.int().nonnegative()}),body);for(const app of input.appIds)this.apps.get(app);
  return this.db.$transaction(async tx=>{
   const old=await tx.servicePlan.findUnique({where:{code:input.code}});if((old?.version??0)!==input.version)throw new ConflictException('套餐版本已变化');const{version,...data}=input;
   const plan=old?await tx.servicePlan.update({where:{code:old.code,version:old.version},data:{...data,knowledgeBytes:BigInt(data.knowledgeBytes),version:{increment:1}}}):await tx.servicePlan.create({data:{...data,knowledgeBytes:BigInt(data.knowledgeBytes)}});
   await tx.operatorAudit.create({data:{userId:operator,action:'platform.plan.save',resourceId:plan.code,detail:{version:plan.version}}});return{...plan,knowledgeBytes:plan.knowledgeBytes.toString()};
  });
 }
 async subscribe(operator:string,tenantId:string,body:unknown){
  await this.tenant(tenantId);const input=readBody(z.object({planCode:z.string(),expiresAt:z.iso.datetime(),status:z.enum(['active','suspended']),version:z.int().nonnegative()}),body);
  if(new Date(input.expiresAt)<=new Date())throw new ConflictException('订阅到期时间必须在未来');
  return this.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId+':quota'},0))`;
   const plan=await tx.servicePlan.findUnique({where:{code:input.planCode}});if(!plan?.active)throw new ConflictException('套餐未启用');const old=await tx.tenantSubscription.findUnique({where:{tenantId}});if((old?.version??0)!==input.version)throw new ConflictException('订阅已变化');
   const entitlement={appIds:plan.appIds,seatLimit:plan.seatLimit,aiRunLimit:plan.aiRunLimit,taskLimit:plan.taskLimit,knowledgeBytes:plan.knowledgeBytes.toString(),monthlyPrice:plan.monthlyPrice.toFixed(2),inputTokenPrice:plan.inputTokenPrice?.toString()??null,outputTokenPrice:plan.outputTokenPrice?.toString()??null};
   const enabled=await tx.tenantApp.findMany({where:{tenantId,granted:true,enabled:true}});if(enabled.some(a=>!(plan.appIds as string[]).includes(a.appId)))throw new ConflictException('套餐未覆盖已启用的应用，请先调整应用授权');
   if(await tx.membership.count({where:{tenantId,active:true}})>plan.seatLimit)throw new ConflictException('当前有效成员超过套餐席位');
   const data={planCode:plan.code,planVersion:plan.version,entitlement,status:input.status,expiresAt:new Date(input.expiresAt)};const saved=await tx.tenantSubscription.upsert({where:{tenantId},create:{tenantId,...data},update:{...data,version:{increment:1}}});
   await tx.operatorAudit.create({data:{userId:operator,tenantId,action:'platform.subscription.save',resourceId:tenantId,detail:{planCode:plan.code,version:saved.version}}});return saved;
  });
 }
 async bill(operator:string,tenantId:string,body:unknown){
  await this.tenant(tenantId);const input=readBody(z.object({number:z.string().trim().min(1).max(80),amount:z.string().regex(/^(0|[1-9]\d{0,12})(\.\d{1,2})?$/),note:z.string().trim().min(1).max(1000)}),body);
  return this.db.$transaction(async tx=>{const saved=await tx.manualBill.create({data:{tenantId,...input}});await tx.operatorAudit.create({data:{userId:operator,tenantId,action:'platform.bill.issue',resourceId:saved.id}});return saved;});
 }
 async billState(operator:string,tenantId:string,id:string,body:unknown){
  await this.tenant(tenantId);const input=readBody(z.object({version:z.int().positive(),status:z.enum(['paid','void']),paymentReference:z.string().trim().min(1).max(200).optional()}),body);if(input.status==='paid'&&!input.paymentReference)throw new ConflictException('请填写实际收款凭证编号');
  return this.db.$transaction(async tx=>{const saved=await tx.manualBill.updateMany({where:{id,tenantId,status:'issued',version:input.version},data:{status:input.status,paymentReference:input.paymentReference,paidAt:input.status==='paid'?new Date():null,version:{increment:1}}});if(!saved.count)throw new ConflictException('账单已变化');await tx.operatorAudit.create({data:{userId:operator,tenantId,action:'platform.bill.'+input.status,resourceId:id,detail:{paymentReference:input.paymentReference??null}}});return{ok:true};});
 }
 async requestSupport(operator:string,tenantId:string,body:unknown){await this.tenant(tenantId);const input=readBody(z.object({reason:z.string().trim().min(8).max(1000),scopes}),body);return this.db.$transaction(async tx=>{const grant=await tx.supportGrant.create({data:{tenantId,operatorUserId:operator,...input}});await tx.operatorAudit.create({data:{userId:operator,tenantId,action:'platform.support.request',resourceId:grant.id}});const admins=await tx.membership.findMany({where:{tenantId,active:true,role:'admin',user:{active:true}}});await tx.erpNotification.createMany({data:admins.map(m=>({tenantId,recipientMembershipId:m.id,dedupeKey:`support:${grant.id}:requested`,title:'平台运维申请临时支持授权',body:input.reason})),skipDuplicates:true});return grant;});}
 async supportList(ctx:RequestContext){this.auth.require(ctx,'platform.manage');const grants=await this.db.supportGrant.findMany({where:{tenantId:ctx.tenantId},orderBy:{createdAt:'desc'},take:100});return grants.map(g=>({...g,status:g.status==='approved'&&g.expiresAt!<=new Date()?'expired':g.status}));}
 async decide(ctx:RequestContext,id:string,body:unknown){
  this.auth.require(ctx,'platform.manage');const input=readBody(z.object({action:z.enum(['approve','reject','revoke']),version:z.int().positive(),hours:z.int().min(1).max(8).default(1)}),body);
  return this.db.$transaction(async tx=>{const result=await tx.supportGrant.updateMany({where:{id,tenantId:ctx.tenantId,version:input.version,status:input.action==='revoke'?'approved':'requested'},data:{status:input.action==='approve'?'approved':input.action==='reject'?'rejected':'revoked',approvedBy:ctx.membershipId,expiresAt:input.action==='approve'?new Date(Date.now()+input.hours*3600000):new Date(),version:{increment:1}}});if(!result.count)throw new ConflictException('授权申请已变化');await tx.auditEvent.create({data:{tenantId:ctx.tenantId,userId:ctx.userId,membershipId:ctx.membershipId,appId:'platform',requestId:ctx.requestId,action:'platform.support.'+input.action,resourceType:'SupportGrant',resourceId:id}});return{ok:true};});
 }
 async operatorSupport(operator:string,tenantId:string){await this.tenant(tenantId);const grants=await this.db.supportGrant.findMany({where:{tenantId,operatorUserId:operator},orderBy:{createdAt:'desc'},take:100});return grants.map(g=>({...g,status:g.status==='approved'&&g.expiresAt!<=new Date()?'expired':g.status}));}
 async inspect(operator:string,tenantId:string,grantId:string,scope:string){
  readBody(z.enum(['health','audit','tasks']),scope);await this.tenant(tenantId);const g=await this.db.supportGrant.findFirst({where:{id:grantId,tenantId,operatorUserId:operator,status:'approved',expiresAt:{gt:new Date()}}});if(!g||!(g.scopes as string[]).includes(scope))throw new ForbiddenException('没有有效的企业支持授权');
  const admin=await this.db.membership.findFirst({where:{id:g.approvedBy!,tenantId,active:true,role:'admin',user:{active:true}}});if(!admin)throw new ForbiddenException('授权管理员已不可用');
  // No business object contents, task inputs/results, or credentials are exposed.
  const data=scope==='health'?{apps:await this.db.tenantApp.findMany({where:{tenantId},select:{appId:true,enabled:true,granted:true}}),failedExecutions:await this.db.aiExecution.count({where:{tenantId,status:'failed'}}),failedTasks:await this.db.businessTask.count({where:{tenantId,status:'failed'}})}:scope==='tasks'?await this.db.businessTask.groupBy({by:['appId','status'],where:{tenantId},_count:true}):await this.db.auditEvent.findMany({where:{tenantId},select:{id:true,appId:true,action:true,createdAt:true},orderBy:{createdAt:'desc'},take:100});
  const current=await this.db.supportGrant.findFirst({where:{id:g.id,tenantId,status:'approved',version:g.version,expiresAt:{gt:new Date()}}});if(!current)throw new ForbiddenException('支持授权已失效');await this.db.operatorAudit.create({data:{userId:operator,tenantId,action:'platform.support.read',resourceId:g.id,detail:{scope}}});return data;
 }
}
