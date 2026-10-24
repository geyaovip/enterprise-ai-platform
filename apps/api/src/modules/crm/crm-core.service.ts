import {Injectable} from '@nestjs/common';
import {PrismaService} from '../prisma.service';
import type {RequestContext} from '../platform/context';
import {crmPermissions,ROLE_PERMISSIONS,ALL_SCOPE,prerequisite,type ScopeBinding} from './crm-permissions';
import {hash,json,key,parse,problem} from './crm.common';
import {z} from 'zod';
export type Db=any;
export type CrmAccess={member:any;permissions:string[];scopes:Record<string,ScopeBinding[]>;fingerprint:string;manager:boolean};
@Injectable()
export class CrmCore {
 constructor(readonly db:PrismaService){}
 // Test clocks are injectable in isolated apps, never accepted over HTTP or production env.
 now=()=>new Date();
 async guard(ctx:RequestContext,permission:string,tx:Db=this.db):Promise<CrmAccess>{
  if(ctx.app.appId!=='crm')problem('FORBIDDEN','应用上下文不匹配',403);
  const member=await tx.membership.findFirst({where:{id:ctx.membershipId,tenantId:ctx.tenantId,userId:ctx.userId,active:true,user:{active:true},tenant:{active:true}}});
  const app=await tx.tenantApp.findUnique({where:{tenantId_appId:{tenantId:ctx.tenantId,appId:'crm'}}});
  if(!member||!app?.granted||!app.enabled)problem('FORBIDDEN','成员或CRM应用已停用',403);
  const permissions=await crmPermissions(tx,ctx.tenantId,member.role,member.id);
  if(permission==='crm.ai.use'){const cap=await tx.tenantCapability.findUnique({where:{tenantId_capability:{tenantId:ctx.tenantId,capability:'ai'}}});if(!cap?.delivered||!cap.enabled)problem('FORBIDDEN','AI能力未启用',403);}
  if(!permissions.includes(permission))problem('FORBIDDEN','没有此CRM操作权限',403);
  const [roles,extras]=await Promise.all([tx.crmMemberGrant.findMany({where:{tenantId:ctx.tenantId,membershipId:member.id,active:true}}),tx.crmMemberPermissionGrant.findMany({where:{tenantId:ctx.tenantId,membershipId:member.id,active:true}})]);
  const scopes:Record<string,ScopeBinding[]>={};
  if(member.role==='admin')for(const p of permissions)scopes[p]=[ALL_SCOPE];
  else{
   for(const r of roles)for(const p of ROLE_PERMISSIONS[r.role]??[])scopes[p]=[...scopes[p]??[],...r.scopeBindings as ScopeBinding[]];
   for(const e of extras)if(permissions.includes(e.permission))scopes[e.permission]=[...scopes[e.permission]??[],...e.scopeBindings as ScopeBinding[]];
  }
  return {member,permissions,scopes,manager:member.role==='admin'||roles.some((r:any)=>r.role==='manager'),fingerprint:hash({member:member.id,role:member.role,roles:roles.map((r:any)=>[r.role,r.version,r.scopeBindings]).sort(),extras:extras.map((r:any)=>[r.permission,r.version,r.scopeBindings]).sort()})};
 }
 async bindings(ctx:RequestContext,permission:string,tx:Db=this.db){
  const access=await this.guard(ctx,permission,tx);const orgs=await tx.orgUnit.findMany({where:{tenantId:ctx.tenantId,active:true}});
  const expanded=(access.scopes[permission]??[]).map(b=>{if(b.orgUnitIds==='all'||!b.includeDescendants)return b;const ids=new Set(b.orgUnitIds);let previous=-1;while(previous!==ids.size){previous=ids.size;for(const o of orgs)if(o.parentId&&ids.has(o.parentId))ids.add(o.id);}return {...b,orgUnitIds:[...ids]};});
  return {access,bindings:expanded};
 }
 async pairAllowed(ctx:RequestContext,permission:string,orgUnitId:string,channelId:string,tx:Db=this.db){
  const {bindings}=await this.bindings(ctx,permission,tx);const own=bindings.some(b=>(b.orgUnitIds==='all'||b.orgUnitIds.includes(orgUnitId))&&(b.channelIds==='all'||b.channelIds.includes(channelId)));if(!own)return false;
  for(const pre of prerequisite[permission]??[])if(!await this.pairAllowed(ctx,pre,orgUnitId,channelId,tx))return false;
  return true;
 }
 async requirePair(ctx:RequestContext,permission:string,org:string,channel:string,tx:Db=this.db){if(!await this.pairAllowed(ctx,permission,org,channel,tx))problem('FORBIDDEN','当前组织与渠道组合不在授权范围内',403);}
 async customerWhere(ctx:RequestContext,permission='crm.customer.read',tx:Db=this.db){
  const {bindings}=await this.bindings(ctx,permission,tx);
  const OR=bindings.map(b=>({...(b.orgUnitIds==='all'?{}:{orgUnitId:{in:b.orgUnitIds}}),identities:{some:{tenantId:ctx.tenantId,...(b.channelIds==='all'?{}:{channelId:{in:b.channelIds}})}}}));
  const where:any={tenantId:ctx.tenantId,OR:OR.length?OR:[{id:'__none__'}]};
  const pres=prerequisite[permission]??[];if(pres.length)where.AND=await Promise.all(pres.map(p=>this.customerWhere(ctx,p,tx)));
  return where;
 }
 async customer(ctx:RequestContext,id:string,permission='crm.customer.read',tx:Db=this.db){
  const c=await tx.crmCustomer.findFirst({where:{...await this.customerWhere(ctx,permission,tx),id},include:{identities:true,tags:{include:{tag:true}},contacts:{select:{type:true,maskedValue:true}}}});
  if(!c)problem('NOT_FOUND','客户不存在或不可见',404);return c;
 }
 async visibleChannels(ctx:RequestContext,permission='crm.customer.read',tx:Db=this.db){const {bindings}=await this.bindings(ctx,permission,tx);const all=bindings.some(b=>b.channelIds==='all');const ids=bindings.flatMap(b=>b.channelIds==='all'?[]:b.channelIds);return tx.crmSalesChannel.findMany({where:{tenantId:ctx.tenantId,...(all?{}:{id:{in:ids}})},orderBy:{createdAt:'asc'}});}
 async audit(tx:Db,ctx:RequestContext,action:string,type:string,id:string,detail:any={}){await tx.auditEvent.create({data:{tenantId:ctx.tenantId,userId:ctx.userId,membershipId:ctx.membershipId,appId:'crm',requestId:ctx.requestId,action:'crm.'+action,resourceType:type,resourceId:id,detail:json(detail)}});}
 async lock(tx:Db,scope:string){await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scope},0))`;}
 async settings(ctx:RequestContext,tx:Db=this.db){return tx.crmSettings.upsert({where:{tenantId:ctx.tenantId},create:{tenantId:ctx.tenantId},update:{}});}
 async bump(tx:Db,ctx:RequestContext,channelIds:string[],kind:'source'|'customer'='source'){
  await this.settings(ctx,tx);await tx.crmSettings.update({where:{tenantId:ctx.tenantId},data:{dataRevision:{increment:1}}});
  for(const id of [...new Set(channelIds)].sort()){
   await this.lock(tx,ctx.tenantId+':crm:channel:'+id);
   await tx.crmScopeRevision.upsert({where:{channelId:id},create:{tenantId:ctx.tenantId,channelId:id,...(kind==='source'?{sourceRevision:1}:{customerRuleRevision:1})},update:{...(kind==='source'?{sourceRevision:{increment:1}}:{customerRuleRevision:{increment:1}}),metricStatus:'queued'}});
  }
 }
 async lockActor(tx:Db,ctx:RequestContext){await this.lock(tx,ctx.tenantId+':crm:member:'+ctx.membershipId);await tx.$queryRaw`SELECT id FROM "Membership" WHERE id=${ctx.membershipId} AND "tenantId"=${ctx.tenantId} FOR SHARE`;await tx.$queryRaw`SELECT id FROM "TenantApp" WHERE "tenantId"=${ctx.tenantId} AND "appId"='crm' FOR SHARE`;}
 async write<T>(ctx:RequestContext,permission:string,command:string,input:any,fn:(tx:Db)=>Promise<T>,external?:Db):Promise<T>{
  const execute=async(tx:Db)=>{
   await this.lockActor(tx,ctx);await this.guard(ctx,permission,tx);
   const requestKey=parse(key,input.requestKey),fingerprint=hash(input);
   await this.lock(tx,ctx.tenantId+':crm:'+ctx.membershipId+':'+command+':'+requestKey);
   const where={tenantId_membershipId_command_requestKey:{tenantId:ctx.tenantId,membershipId:ctx.membershipId,command,requestKey}};
   const old=await tx.crmCommandReceipt.findUnique({where});if(old){if(old.fingerprint!==fingerprint)problem('IDEMPOTENCY_CONFLICT','相同请求标识对应不同参数，请查询原回执。');return {...old.result as any,repeated:true} as T;}
   const result=await fn(tx);await tx.crmCommandReceipt.create({data:{tenantId:ctx.tenantId,membershipId:ctx.membershipId,command,requestKey,fingerprint,result:json(result)}});return result;
  };
  return external?execute(external):this.db.$transaction(execute,{timeout:30000});
 }
 async members(ctx:RequestContext){await this.guard(ctx,'crm.customer.read');const members=await this.db.membership.findMany({where:{tenantId:ctx.tenantId,active:true,user:{active:true}},select:{id:true,role:true,user:{select:{name:true}}}});return members;}
}
