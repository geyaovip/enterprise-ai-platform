import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import type { RequestContext } from '../platform/context';
import { AuthService } from '../platform/auth.service';
import { readBody } from '../platform/security';
import { audit, notify } from './erp.common';
import { replenishmentFacts } from './replenishment.service';
import { ROLE_PERMISSIONS } from './erp-permissions';
const required=(kind:string)=>kind==='low_stock'?'erp.inventory.read':kind==='purchase_delay'?'erp.purchase.read':'erp.finance.read';
@Injectable()
export class OperatingEventService{
 constructor(private readonly db:PrismaService,private readonly auth:AuthService){}
 async list(ctx:RequestContext){const rows=await this.db.erpOperatingEvent.findMany({where:{tenantId:ctx.tenantId,...(ctx.roles.includes('admin')?{}:{ownerMembershipId:ctx.membershipId})},orderBy:[{status:'asc'},{detectedAt:'desc'}],take:200});const visible=rows.filter(r=>ctx.permissions.includes(required(r.kind)));const members=await this.db.membership.findMany({where:{tenantId:ctx.tenantId,...(ctx.roles.includes('admin')?{}:{id:{in:visible.map(e=>e.ownerMembershipId)}})},select:{id:true,role:true,active:true,user:{select:{name:true,active:true}}}});return visible.map(r=>({...r,ownerName:members.find(m=>m.id===r.ownerMembershipId)?.user.name??'成员已离职',eligibleOwners:ctx.roles.includes('admin')?members.filter(m=>m.active&&m.user.active&&ROLE_PERMISSIONS[m.role]?.includes(required(r.kind))).map(m=>({id:m.id,name:m.user.name})):[]}));}
 async action(ctx:RequestContext,id:string,body:unknown){
  const input=readBody(z.object({action:z.enum(['acknowledge','transfer']),version:z.int().positive(),ownerMembershipId:z.uuid().optional()}),body);
  const event=await this.db.erpOperatingEvent.findFirst({where:{id,tenantId:ctx.tenantId}});if(!event)throw new NotFoundException('经营事件不存在');this.auth.require(ctx,required(event.kind));
  if(!ctx.roles.includes('admin')&&event.ownerMembershipId!==ctx.membershipId)throw new ConflictException('只有事件负责人可办理');
  if(input.action==='transfer'){
   this.auth.require(ctx,'platform.manage');if(!input.ownerMembershipId)throw new ConflictException('请选择负责人');const member=await this.db.membership.findFirst({where:{id:input.ownerMembershipId,tenantId:ctx.tenantId,active:true,user:{active:true}}});if(!member||!ROLE_PERMISSIONS[member.role]?.includes(required(event.kind)))throw new ConflictException('负责人不可用或没有对应业务权限');
  }
  return this.db.$transaction(async tx=>{
   const changed=await tx.erpOperatingEvent.updateMany({where:{id,tenantId:ctx.tenantId,version:input.version,status:{in:['open','acknowledged']}},data:{...(input.action==='acknowledge'?{status:'acknowledged',acknowledgedAt:new Date()}:{ownerMembershipId:input.ownerMembershipId}),version:{increment:1}}});if(!changed.count)throw new ConflictException('事件已变化，请刷新');
   if(input.action==='transfer'){await tx.erpTask.updateMany({where:{tenantId:ctx.tenantId,requestKey:`operating:${id}:${event.cycle}`,status:'open'},data:{assigneeMembershipId:input.ownerMembershipId!,version:{increment:1}}});await notify(tx,ctx.tenantId,input.ownerMembershipId!,`operating:${id}:${event.cycle}:transfer:${input.version}`,`经营事件已转交：${event.title}`,'请在经营事件中核对并处理。');}
   await audit(tx,ctx,`erp.operating_event.${input.action}`,'ErpOperatingEvent',id);return{ok:true};
  });
 }
 private cursor='';
 async tick(){const tenants=await this.db.tenant.findMany({where:{active:true,id:{gt:this.cursor},apps:{some:{appId:'erp',enabled:true,granted:true}}},orderBy:{id:'asc'},take:20});if(!tenants.length){this.cursor='';return false;}for(const tenant of tenants){await this.scan(tenant.id);this.cursor=tenant.id;}return true;}
 async scan(tenantId:string){
  return this.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId+':operating-events'},0))`;
   const app=await tx.tenantApp.findUnique({where:{tenantId_appId:{tenantId,appId:'erp'}}});if(!app?.enabled||!app.granted)return;
   const members=await tx.membership.findMany({where:{tenantId,active:true,user:{active:true}},orderBy:{createdAt:'asc'}}),now=new Date();
   const risks:Array<{kind:string;sourceId:string;title:string;facts:any;preferred?:string}>=[];
   for(const row of await replenishmentFacts(tx,tenantId))if(row.suggestedQty>0)risks.push({kind:'low_stock',sourceId:row.productId,title:`库存待补货 · ${row.sku}`,facts:row});
   const purchases=await tx.erpPurchaseOrder.findMany({where:{tenantId,status:{in:['ordered','partial_received']},deliveryAt:{lt:now}},select:{id:true,number:true,deliveryAt:true,createdByMembershipId:true,version:true}});
   for(const p of purchases)risks.push({kind:'purchase_delay',sourceId:p.id,title:`采购交付逾期 · ${p.number}`,facts:{purchaseId:p.id,number:p.number,deliveryAt:p.deliveryAt?.toISOString(),version:p.version},preferred:p.createdByMembershipId});
   const [receivable,payable]=await Promise.all([tx.erpReceivable.findMany({where:{tenantId,dueAt:{lt:now},status:{in:['open','partial']}}}),tx.erpPayable.findMany({where:{tenantId,dueAt:{lt:now},status:{in:['open','partial']}}})]);
   for(const [kind,rows]of [['receivable_overdue',receivable],['payable_overdue',payable]]as const)for(const r of rows)if(r.amount.gt(r.paidAmount))risks.push({kind,sourceId:r.id,title:`${kind==='receivable_overdue'?'应收':'应付'}账款逾期`,facts:{accountId:r.id,amount:r.amount.minus(r.paidAmount).toFixed(2),dueAt:r.dueAt?.toISOString(),currency:'CNY'}});
   const activeKeys=new Set(risks.map(r=>r.kind+':'+r.sourceId)),old=await tx.erpOperatingEvent.findMany({where:{tenantId}});
   for(const risk of risks){
    const previous=old.find(e=>e.kind===risk.kind&&e.sourceId===risk.sourceId),eligible=members.filter(m=>ROLE_PERMISSIONS[m.role]?.includes(required(risk.kind)));
    const owner=eligible.find(m=>m.id===previous?.ownerMembershipId)??eligible.find(m=>m.id===risk.preferred)??eligible.find(m=>m.role===(risk.kind==='low_stock'?'purchasing':risk.kind==='purchase_delay'?'purchasing':'finance'))??eligible.find(m=>m.role==='admin')??eligible[0];if(!owner)continue;
    const reopened=previous?.status==='closed',cycle=(previous?.cycle??1)+(reopened?1:0),fresh=!previous||reopened;
    const e=previous?await tx.erpOperatingEvent.update({where:{id:previous.id},data:{facts:risk.facts,ownerMembershipId:owner.id,...(reopened?{status:'open',cycle,detectedAt:now,acknowledgedAt:null,closedAt:null,escalatedAt:null}:{}),...(fresh||previous.ownerMembershipId!==owner.id?{version:{increment:1}}:{})}}):await tx.erpOperatingEvent.create({data:{tenantId,kind:risk.kind,sourceId:risk.sourceId,title:risk.title,facts:risk.facts,ownerMembershipId:owner.id}});
    if(fresh){await notify(tx,tenantId,owner.id,`operating:${e.id}:${cycle}:detected`,risk.title,'请在经营事件中核对业务依据并处理。');await tx.erpTask.create({data:{tenantId,requestKey:`operating:${e.id}:${cycle}`,title:risk.title,description:'请在经营事件中处理；业务风险解除后自动关闭。',createdByMembershipId:owner.id,assigneeMembershipId:owner.id,dueAt:new Date(Date.now()+86400000)}});}
    else if(previous!.ownerMembershipId!==owner.id){await tx.erpTask.updateMany({where:{tenantId,requestKey:`operating:${e.id}:${cycle}`,status:'open'},data:{assigneeMembershipId:owner.id,version:{increment:1}}});await notify(tx,tenantId,owner.id,`operating:${e.id}:${cycle}:reassigned:${e.version}`,risk.title,'原负责人已不可用，事件已转交给你。');}
    if(!e.escalatedAt&&Date.now()-e.detectedAt.getTime()>=86400000){for(const admin of members.filter(m=>m.role==='admin'))await notify(tx,tenantId,admin.id,`operating:${e.id}:${cycle}:escalated`,`经营事件逾期未解除：${risk.title}`,'请核对事件负责人和处理进度。');await tx.erpOperatingEvent.update({where:{id:e.id},data:{escalatedAt:now,version:{increment:1}}});}
   }
   for(const e of old)if(e.status!=='closed'&&!activeKeys.has(e.kind+':'+e.sourceId)){
    await tx.erpOperatingEvent.update({where:{id:e.id},data:{status:'closed',closedAt:now,version:{increment:1}}});await tx.erpTask.updateMany({where:{tenantId,requestKey:`operating:${e.id}:${e.cycle}`,status:'open'},data:{status:'completed',version:{increment:1}}});if(members.some(m=>m.id===e.ownerMembershipId))await notify(tx,tenantId,e.ownerMembershipId,`operating:${e.id}:${e.cycle}:closed`,`经营事件已解除：${e.title}`,'已根据最新业务数据复核，相关任务自动完成。');
   }
  },{isolationLevel:'RepeatableRead',timeout:30000});
 }
}
