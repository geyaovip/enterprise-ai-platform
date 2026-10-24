import { Injectable, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';
import type { Request } from 'express';
import { PrismaService } from '../prisma.service';
import { QuotaService } from '../orchestration/quota.service';
import { AuthService } from './auth.service';
import { hashPassword, newSessionToken, readBody, tokenHash } from './security';
import type { RequestContext } from './context';
import { audit, conflict, failNotFound, label } from '../erp/erp.common';
import { identityInput, identityWhere } from './account-input';
const roles=z.enum(['admin','sales','purchasing','warehouse','finance']);
@Injectable()
export class InvitationService {
 constructor(private readonly db:PrismaService,private readonly auth:AuthService,private readonly quota:QuotaService){}
 private publicItem(item:{id:string;email:string;name:string;role:string;kind:string;expiresAt:Date;usedAt:Date|null;revokedAt:Date|null}) {return item;}
 async list(ctx:RequestContext){this.auth.require(ctx,'platform.manage');return this.db.memberInvitation.findMany({where:{tenantId:ctx.tenantId},select:{id:true,email:true,name:true,role:true,kind:true,expiresAt:true,usedAt:true,revokedAt:true},orderBy:{createdAt:'desc'},take:100});}
 async create(ctx:RequestContext,body:unknown){
  this.auth.require(ctx,'platform.manage');const input=readBody(z.object({kind:z.enum(['invite','recovery']).default('invite'),email:identityInput,name:label(100),role:roles.default('sales'),reason:label(500).optional()}),body);const token=newSessionToken();
  const item=await this.db.$transaction(async tx=>{
   const user=await tx.user.findUnique({where:identityWhere(input.email),include:{memberships:{where:{active:true}}}});
   if(input.kind==='recovery'){
    if(!input.reason)conflict('账号恢复须填写核验原因');
    if(!user?.active||user.platformRole||user.memberships.length!==1||user.memberships[0].tenantId!==ctx.tenantId||user.id===ctx.userId)conflict('仅可恢复本企业独立成员账号；跨企业、平台账号及本人须自行验证恢复');
   }else if(user&&await tx.membership.findUnique({where:{tenantId_userId:{tenantId:ctx.tenantId,userId:user.id}}}))conflict('该账号已是本企业成员，请在成员列表管理');
   await tx.memberInvitation.updateMany({where:{tenantId:ctx.tenantId,email:input.email,kind:input.kind,usedAt:null,revokedAt:null},data:{revokedAt:new Date()}});
   const saved=await tx.memberInvitation.create({data:{tenantId:ctx.tenantId,email:input.email,name:input.name,role:input.kind==='recovery'?user!.memberships[0].role:input.role,kind:input.kind,tokenHash:tokenHash(token),createdByMembershipId:ctx.membershipId,expiresAt:new Date(Date.now()+(input.kind==='recovery'?30*60000:72*3600000))}});
   await audit(tx,ctx,'platform.member.'+input.kind,'MemberInvitation',saved.id,{email:input.email,role:saved.role,reason:input.reason});return saved;
  },{isolationLevel:'Serializable'});
  const origin=process.env.PUBLIC_WEB_ORIGIN??process.env.WEB_ORIGIN??'http://127.0.0.1:4601';
  return {...this.publicItem({id:item.id,email:item.email,name:item.name,role:item.role,kind:item.kind,expiresAt:item.expiresAt,usedAt:null,revokedAt:null}),url:origin+'/join#token='+encodeURIComponent(token)};
 }
 async revoke(ctx:RequestContext,id:string){this.auth.require(ctx,'platform.manage');return this.db.$transaction(async tx=>{const item=await tx.memberInvitation.findFirst({where:{id,tenantId:ctx.tenantId}});if(!item)failNotFound('邀请');await tx.memberInvitation.update({where:{id},data:{revokedAt:new Date()}});await audit(tx,ctx,'platform.invitation.revoke','MemberInvitation',id);return{ok:true};});}
 async inspect(body:unknown){const {token}=readBody(z.object({token:z.string().min(32).max(200)}),body);const item=await this.db.memberInvitation.findUnique({where:{tokenHash:tokenHash(token)}});if(!item||item.usedAt||item.revokedAt||item.expiresAt<=new Date())throw new UnauthorizedException('链接无效、已使用或已过期');const [tenant,issuer,user]=await Promise.all([this.db.tenant.findUnique({where:{id:item.tenantId}}),this.db.membership.findFirst({where:{id:item.createdByMembershipId,tenantId:item.tenantId,active:true,role:'admin',user:{active:true}}}),this.db.user.findUnique({where:identityWhere(item.email)})]);if(!tenant?.active||!issuer)throw new UnauthorizedException('企业或邀请人已停用');return{email:item.email,name:item.name,role:item.role,kind:item.kind,tenantName:tenant.name,tenantKey:tenant.slug,existingAccount:Boolean(user),expiresAt:item.expiresAt};}
 async accept(req:Request,body:unknown){
  const input=readBody(z.object({token:z.string().min(32).max(200),name:label(100).optional(),password:z.string().min(12).max(200).optional()}),body);const info=await this.inspect(input);const existing=await this.db.user.findUnique({where:identityWhere(info.email)});let authenticatedId:string|undefined;
  if(existing&&info.kind==='invite'){const user=await this.auth.user(req);if(user.id!==existing.id)throw new UnauthorizedException('请使用受邀账号的现有账号登录');authenticatedId=user.id;}
  return this.db.$transaction(async tx=>{
   const item=await tx.memberInvitation.findUniqueOrThrow({where:{tokenHash:tokenHash(input.token)}});
   if(item.usedAt||item.revokedAt||item.expiresAt<=new Date())conflict('链接已使用或过期');
   if(!await tx.membership.findFirst({where:{id:item.createdByMembershipId,tenantId:item.tenantId,active:true,role:'admin',user:{active:true},tenant:{active:true}}}))conflict('企业或邀请人已停用');
   let user=await tx.user.findUnique({where:identityWhere(item.email)});
   if(item.kind==='recovery'){
    if(!user?.active||user.platformRole||!input.password)conflict('账号恢复条件已变化');const members=await tx.membership.findMany({where:{userId:user.id,active:true}});if(members.length!==1||members[0].tenantId!==item.tenantId)conflict('账号已关联其他企业，须自行验证恢复');await tx.user.update({where:{id:user.id},data:{passwordHash:hashPassword(input.password)}});await tx.session.deleteMany({where:{userId:user.id}});
   }else{
    if(user){if(!user.active||user.id!==authenticatedId)conflict('请用现有账号登录后加入');}else{if(!input.password)conflict('请设置至少 12 位密码');user=await tx.user.create({data:{...identityWhere(item.email),name:input.name??item.name,passwordHash:hashPassword(input.password)}});}
    if(await tx.membership.findUnique({where:{tenantId_userId:{tenantId:item.tenantId,userId:user.id}}}))conflict('该账号已加入企业');await this.quota.checkSeat(item.tenantId,tx);const member=await tx.membership.create({data:{tenantId:item.tenantId,userId:user.id,role:item.role}});const root=await tx.orgUnit.findFirst({where:{tenantId:item.tenantId,parentId:null}});if(root)await tx.membershipOrg.create({data:{tenantId:item.tenantId,membershipId:member.id,orgUnitId:root.id,primary:true}});
   }
   await tx.memberInvitation.update({where:{id:item.id},data:{usedAt:new Date()}});await tx.auditEvent.create({data:{tenantId:item.tenantId,userId:user!.id,membershipId:item.createdByMembershipId,requestId:req.headers['x-request-id']?.toString()??newSessionToken(),appId:'platform',action:'platform.invitation.accept',resourceType:'MemberInvitation',resourceId:item.id,detail:{kind:item.kind}}});return{ok:true,tenantKey:info.tenantKey,loginRequired:true};
  },{isolationLevel:'Serializable'});
 }
}
