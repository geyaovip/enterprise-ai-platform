import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../platform/auth.service';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
import { audit, conflict, failNotFound, label, money, pageQuery, sameJson, type Transaction } from './erp.common';
import { accountStatus } from './trade.common';
import { stockMove } from './stock-ledger';
import { parseCsv } from './master-csv';

const accountKind = z.enum(['receivable','payable']);
const openingLine=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('inventory'),productId:z.uuid(),warehouseId:z.uuid().optional(),quantity:z.number().min(0).max(1e9).refine(x=>Math.abs(x*1e6-Math.round(x*1e6))<1e-6,'数量最多六位小数'),unitCost:money}),
 z.object({kind:accountKind,partyId:z.uuid(),amount:money,dueAt:z.iso.datetime().optional()})
]);
const openingInput=z.object({requestKey:z.uuid(),reference:label(80),openingAt:z.iso.datetime(),lines:z.array(openingLine).min(1).max(1000)}).refine(x=>new Set(x.lines.map(l=>l.kind+':'+('productId' in l?l.productId:l.partyId))).size===x.lines.length,'同类期初对象不能重复');
const advanceInput=z.object({requestKey:z.uuid(),reference:label(80),kind:accountKind,partyId:z.uuid(),amount:money});

@Injectable()
export class AccountingService{
 constructor(private readonly db:PrismaService,private readonly auth:AuthService){}
 private async validateOpening(tx:Transaction,ctx:RequestContext,input:z.infer<typeof openingInput>){
  const errors:Array<{row:number;message:string}>=[];
  for(const [i,l] of input.lines.entries()){
   if(l.kind==='inventory'){
    const balance=await tx.erpInventoryBalance.findFirst({where:{tenantId:ctx.tenantId,productId:l.productId,product:{active:true}}});
    if(!balance)errors.push({row:i+1,message:'商品不存在或已停用'});
    else if(balance.openingAt!==null||balance.quantity!==0||await tx.erpStockMovement.count({where:{tenantId:ctx.tenantId,productId:l.productId}}))errors.push({row:i+1,message:'商品已发生库存业务，不可重复初始化'});
    if(l.warehouseId&&!await tx.erpWarehouse.findFirst({where:{tenantId:ctx.tenantId,id:l.warehouseId,active:true}}))errors.push({row:i+1,message:'仓库不存在或已停用'});
   }else{
    const party=l.kind==='receivable'?await tx.erpCustomer.findFirst({where:{id:l.partyId,tenantId:ctx.tenantId,active:true}}):await tx.erpSupplier.findFirst({where:{id:l.partyId,tenantId:ctx.tenantId,active:true}});
    if(!party)errors.push({row:i+1,message:'往来对象不存在或已停用'});
    if(new Prisma.Decimal(l.amount).lte(0))errors.push({row:i+1,message:'期初账款必须大于零'});
    const existing=l.kind==='receivable'?await tx.erpReceivable.count({where:{tenantId:ctx.tenantId,customerId:l.partyId,openingReference:{not:null}}}):await tx.erpPayable.count({where:{tenantId:ctx.tenantId,supplierId:l.partyId,openingReference:{not:null}}});
    if(existing)errors.push({row:i+1,message:'该往来对象已导入期初账款'});
   }
  }
  if(new Date(input.openingAt)>new Date())errors.push({row:0,message:'期初日期不能晚于当前时间'});return errors;
 }
 async csvOpening(ctx:RequestContext,body:unknown){
  this.auth.require(ctx,'platform.manage');const input=readBody(z.object({csv:z.string(),requestKey:z.uuid(),reference:label(80),openingAt:z.iso.datetime()}),body);const rows=parseCsv(input.csv);const headers=['类型','编号','仓库编号','数量','单位成本','金额','到期日'];if(JSON.stringify(rows[0])!==JSON.stringify(headers))conflict('表头须为：'+headers.join(','));const lines=[];const errors:Array<{row:number;message:string}>=[];
  for(const [i,row]of rows.slice(1).entries()){
   if(row.length!==headers.length){errors.push({row:i+2,message:'列数与表头不一致'});continue;}
   const[type,code,whCode,quantity,unitCost,amount,due]=row.map(v=>v.trim());
   if(type==='库存'){
    const product=await this.db.erpProduct.findFirst({where:{tenantId:ctx.tenantId,sku:code,active:true}});const wh=whCode?await this.db.erpWarehouse.findUnique({where:{tenantId_code:{tenantId:ctx.tenantId,code:whCode}}}):null;if(!product||whCode&&(!wh||!wh.active)){errors.push({row:i+2,message:'商品或仓库编号无效'});continue;}if(!quantity||!Number.isFinite(Number(quantity))||Number(quantity)<0||Number(quantity)>1e9||Math.abs(Number(quantity)*1e6-Math.round(Number(quantity)*1e6))>=1e-6||!money.safeParse(unitCost).success){errors.push({row:i+2,message:'库存数量或单位成本格式无效'});continue;}lines.push({kind:'inventory',productId:product.id,warehouseId:wh?.id,quantity:Number(quantity),unitCost});
   }else if(type==='应收'||type==='应付'){
    const party=type==='应收'?await this.db.erpCustomer.findFirst({where:{tenantId:ctx.tenantId,code,active:true}}):await this.db.erpSupplier.findFirst({where:{tenantId:ctx.tenantId,code,active:true}});if(!party){errors.push({row:i+2,message:'客户或供应商编号无效'});continue;}if(!money.safeParse(amount).success){errors.push({row:i+2,message:'账款金额格式无效'});continue;}const dueDate=due?new Date(due):null;if(dueDate&&Number.isNaN(dueDate.getTime())){errors.push({row:i+2,message:'到期日格式无效'});continue;}lines.push({kind:type==='应收'?'receivable':'payable',partyId:party.id,amount,dueAt:dueDate?.toISOString()});
   }else errors.push({row:i+2,message:'类型仅支持库存、应收、应付'});
  }
  if(errors.length)return{valid:false,total:rows.length-1,errors,input:null};const normalized=readBody(openingInput,{...input,lines});const preview=await this.previewOpening(ctx,normalized);return{...preview,input:normalized,errors:preview.errors.map(e=>({...e,row:e.row+1}))};
 }
 async previewOpening(ctx:RequestContext,body:unknown){this.auth.require(ctx,'platform.manage');const input=readBody(openingInput,body);const errors=await this.validateOpening(this.db,ctx,input);return{valid:errors.length===0,total:input.lines.length,errors,inventoryValue:input.lines.filter(l=>l.kind==='inventory').reduce((s,l)=>s.plus(new Prisma.Decimal(l.unitCost).mul(l.quantity)),new Prisma.Decimal(0)).toFixed(2)};}
 async opening(ctx:RequestContext,body:unknown){
  this.auth.require(ctx,'platform.manage');const input=readBody(openingInput,body);
  return this.db.$transaction(async tx=>{
   const prior=await tx.erpOpeningBatch.findUnique({where:{tenantId_requestKey:{tenantId:ctx.tenantId,requestKey:input.requestKey}}});if(prior){if(prior.reference!==input.reference||prior.openingAt.toISOString()!==input.openingAt||!sameJson(prior.lines,input.lines))conflict('期初重试内容不一致');return prior;}
   const errors=await this.validateOpening(tx,ctx,input);if(errors.length)conflict(errors.map(e=>`第 ${e.row} 行：${e.message}`).join('；'));
   const batch=await tx.erpOpeningBatch.create({data:{tenantId:ctx.tenantId,requestKey:input.requestKey,reference:input.reference,openingAt:new Date(input.openingAt),lines:input.lines}});
   const doc=await tx.erpStockDocument.create({data:{tenantId:ctx.tenantId,number:'OPEN-'+input.reference,kind:'opening',sourceId:batch.id,actorMembershipId:ctx.membershipId}});
   for(const l of input.lines){
    if(l.kind==='inventory'){if(l.quantity>0)await stockMove(tx,ctx,{productId:l.productId,warehouseId:l.warehouseId,direction:'in',quantity:l.quantity,unitCost:new Prisma.Decimal(l.unitCost),sourceType:'opening',sourceId:batch.id,documentId:doc.id});await tx.erpInventoryBalance.updateMany({where:{tenantId:ctx.tenantId,productId:l.productId},data:{openingAt:new Date(input.openingAt)}});}
    else{
     const amount=new Prisma.Decimal(l.amount);const common={tenantId:ctx.tenantId,openingReference:input.reference,amount,dueAt:l.dueAt?new Date(l.dueAt):null,createdAt:new Date(input.openingAt)};
     const account=l.kind==='receivable'?await tx.erpReceivable.create({data:{...common,customerId:l.partyId}}):await tx.erpPayable.create({data:{...common,supplierId:l.partyId}});
     await tx.erpAccountEntry.create({data:{tenantId:ctx.tenantId,kind:l.kind,accountId:account.id,partyId:l.partyId,amount,reference:input.reference,sourceType:'opening',sourceId:batch.id,occurredAt:new Date(input.openingAt)}});
    }
   }
   await audit(tx,ctx,'erp.opening.import','OpeningBatch',batch.id,{reference:input.reference,rows:input.lines.length});return batch;
  },{isolationLevel:'Serializable',timeout:30000});
 }
 async advances(ctx:RequestContext,query:unknown){this.auth.require(ctx,'erp.finance.read');const q=readBody(pageQuery,query);const where={tenantId:ctx.tenantId,...(q.partyId?{partyId:q.partyId}: {})};const[items,total]=await this.db.$transaction([this.db.erpAdvance.findMany({where,orderBy:{createdAt:'desc'},skip:(q.page-1)*q.page_size,take:q.page_size}),this.db.erpAdvance.count({where})]);const [customers,suppliers]=await Promise.all([this.db.erpCustomer.findMany({where:{tenantId:ctx.tenantId,id:{in:items.filter(i=>i.kind==='receivable').map(i=>i.partyId)}},select:{id:true,name:true}}),this.db.erpSupplier.findMany({where:{tenantId:ctx.tenantId,id:{in:items.filter(i=>i.kind==='payable').map(i=>i.partyId)}},select:{id:true,name:true}})]);return{items:items.map(i=>({...i,partyName:(i.kind==='receivable'?customers:suppliers).find(p=>p.id===i.partyId)?.name})),total,page:q.page,page_size:q.page_size};}
 async advance(ctx:RequestContext,body:unknown){
  this.auth.require(ctx,'erp.finance.write');const input=readBody(advanceInput,body);const amount=new Prisma.Decimal(input.amount);if(amount.lte(0))conflict('预收预付金额必须大于零');
  return this.db.$transaction(async tx=>{const prior=await tx.erpAdvance.findUnique({where:{tenantId_requestKey:{tenantId:ctx.tenantId,requestKey:input.requestKey}}});if(prior){if(prior.kind!==input.kind||prior.partyId!==input.partyId||prior.reference!==input.reference||!prior.amount.eq(amount))conflict('预收预付重试内容不一致');return prior;}
   const party=input.kind==='receivable'?await tx.erpCustomer.findFirst({where:{id:input.partyId,tenantId:ctx.tenantId,active:true}}):await tx.erpSupplier.findFirst({where:{id:input.partyId,tenantId:ctx.tenantId,active:true}});if(!party)failNotFound('往来对象');
   const item=await tx.erpAdvance.create({data:{tenantId:ctx.tenantId,...input,amount,balance:amount}});await audit(tx,ctx,'erp.advance.create','Advance',item.id,{amount:amount.toFixed(2)});return item;
  },{isolationLevel:'Serializable'});
 }
 async applyAdvance(ctx:RequestContext,id:string,body:unknown){
  this.auth.require(ctx,'erp.finance.write');const input=readBody(z.object({requestKey:z.uuid(),accountId:z.uuid(),amount:money,version:z.int().positive()}),body);const amount=new Prisma.Decimal(input.amount);if(amount.lte(0))conflict('抵扣金额必须大于零');
  return this.db.$transaction(async tx=>{
   const reference='ADV-'+input.requestKey;const prior=await tx.erpPayment.findFirst({where:{tenantId:ctx.tenantId,reference}});if(prior){if(prior.advanceId!==id||!prior.amount.eq(amount)||![prior.receivableId,prior.payableId].includes(input.accountId))conflict('抵扣重试内容不一致');return prior;}
   const advance=await tx.erpAdvance.findFirst({where:{id,tenantId:ctx.tenantId,version:input.version}});if(!advance||amount.gt(advance.balance))conflict('预收预付可用余额不足或已变化');
   const ar=advance.kind==='receivable';const account=ar?await tx.erpReceivable.findFirst({where:{id:input.accountId,tenantId:ctx.tenantId,customerId:advance.partyId}}):await tx.erpPayable.findFirst({where:{id:input.accountId,tenantId:ctx.tenantId,supplierId:advance.partyId}});if(!account)failNotFound('同一往来对象的账款');if(amount.gt(account.amount.minus(account.paidAmount)))conflict('抵扣金额超过未结余额');const paid=account.paidAmount.plus(amount);
   if(ar)await tx.erpReceivable.update({where:{id:account.id},data:{paidAmount:paid,status:accountStatus(account.amount,paid)}});else await tx.erpPayable.update({where:{id:account.id},data:{paidAmount:paid,status:accountStatus(account.amount,paid)}});
   await tx.erpAdvance.update({where:{id},data:{balance:advance.balance.minus(amount),version:{increment:1}}});
   const payment=await tx.erpPayment.create({data:{tenantId:ctx.tenantId,...(ar?{receivableId:account.id}:{payableId:account.id}),amount,reference,kind:'advance',advanceId:id,actorMembershipId:ctx.membershipId}});await audit(tx,ctx,'erp.advance.apply','Advance',id,{accountId:account.id,amount:amount.toFixed(2)});return payment;
  },{isolationLevel:'Serializable'});
 }
 async advanceHistory(ctx:RequestContext,id:string){this.auth.require(ctx,'erp.finance.read');if(!await this.db.erpAdvance.findFirst({where:{id,tenantId:ctx.tenantId}}))failNotFound('预收预付');return this.db.erpPayment.findMany({where:{tenantId:ctx.tenantId,advanceId:id},orderBy:{createdAt:'asc'}});}
 async refundAdvance(ctx:RequestContext,id:string,body:unknown){
  this.auth.require(ctx,'erp.finance.write');const input=readBody(z.object({requestKey:z.uuid(),version:z.int().positive(),amount:money,reason:label(500)}),body);const amount=new Prisma.Decimal(input.amount);if(amount.lte(0))conflict('退款金额须大于零');
  return this.db.$transaction(async tx=>{const reference='ARF-'+input.requestKey;const prior=await tx.erpPayment.findFirst({where:{tenantId:ctx.tenantId,advanceId:id,reference}});if(prior){if(!prior.amount.eq(amount.negated())||prior.note!==input.reason)conflict('退款重试内容不一致');return prior;}const advance=await tx.erpAdvance.findFirst({where:{id,tenantId:ctx.tenantId,version:input.version}});if(!advance||amount.gt(advance.balance))conflict('预收预付余额不足或已变化');await tx.erpAdvance.update({where:{id},data:{balance:advance.balance.minus(amount),version:{increment:1}}});const payment=await tx.erpPayment.create({data:{tenantId:ctx.tenantId,advanceId:id,amount:amount.negated(),reference,kind:'advance_refund',note:input.reason,actorMembershipId:ctx.membershipId}});await audit(tx,ctx,'erp.advance.refund','Advance',id,{amount:amount.toFixed(2),reason:input.reason});return payment;},{isolationLevel:'Serializable'});
 }
 async reverse(ctx:RequestContext,id:string,body:unknown){
  this.auth.require(ctx,'erp.finance.write');const{reason}=readBody(z.object({reason:label(500)}),body);
  return this.db.$transaction(async tx=>{
   const original=await tx.erpPayment.findFirst({where:{id,tenantId:ctx.tenantId}});if(!original)failNotFound('收付款流水');if(original.reversalOfId)conflict('冲正流水不能再次冲正');
   if(original.reversedAt){const prior=await tx.erpPayment.findUnique({where:{reversalOfId:id}});if(prior?.note!==reason)conflict('重复冲正理由不一致');return{items:prior?[prior]:[]};}
   if(original.kind==='advance_refund'){const advance=await tx.erpAdvance.findFirst({where:{id:original.advanceId!,tenantId:ctx.tenantId}});if(!advance)failNotFound('预收预付');const next=advance.balance.minus(original.amount);if(next.gt(advance.amount))conflict('退款冲正后的余额超过原始金额');await tx.erpAdvance.update({where:{id:advance.id},data:{balance:next,version:{increment:1}}});await tx.erpPayment.update({where:{id},data:{reversedAt:new Date()}});const item=await tx.erpPayment.create({data:{tenantId:ctx.tenantId,advanceId:advance.id,amount:original.amount.negated(),reference:'REV-'+id,kind:'reversal',reversalOfId:id,note:reason,actorMembershipId:ctx.membershipId}});await audit(tx,ctx,'erp.payment.reverse','Payment',id,{reason,count:1});return{items:[item]};}
   const originals=original.receiptClaimId?await tx.erpPayment.findMany({where:{tenantId:ctx.tenantId,receiptClaimId:original.receiptClaimId,reversedAt:null,reversalOfId:null}}):[original];const items=[];
   for(const item of originals){
    const ar=Boolean(item.receivableId),account=ar?await tx.erpReceivable.findFirst({where:{id:item.receivableId!,tenantId:ctx.tenantId}}):await tx.erpPayable.findFirst({where:{id:item.payableId!,tenantId:ctx.tenantId}});if(!account)failNotFound('原账款');const paid=account.paidAmount.minus(item.amount);if(paid.lt(0))conflict('账款结算已变化，不能冲正');
    if(ar)await tx.erpReceivable.update({where:{id:account.id},data:{paidAmount:paid,status:accountStatus(account.amount,paid)}});else await tx.erpPayable.update({where:{id:account.id},data:{paidAmount:paid,status:accountStatus(account.amount,paid)}});
    if(item.advanceId)await tx.erpAdvance.update({where:{id:item.advanceId},data:{balance:{increment:item.amount},version:{increment:1}}});
    await tx.erpPayment.update({where:{id:item.id},data:{reversedAt:new Date()}});items.push(await tx.erpPayment.create({data:{tenantId:ctx.tenantId,receivableId:item.receivableId,payableId:item.payableId,amount:item.amount.negated(),reference:'REV-'+item.id,kind:'reversal',advanceId:item.advanceId,reversalOfId:item.id,note:reason,actorMembershipId:ctx.membershipId}}));
   }
   if(original.receiptClaimId){const claim=await tx.erpReceiptClaim.findUniqueOrThrow({where:{id:original.receiptClaimId}});const receipt=await tx.erpIncomingReceipt.findUniqueOrThrow({where:{id:claim.receiptId}});const next=receipt.allocatedAmount.minus(claim.amount);if(next.lt(0))conflict('到账认领余额不一致');await tx.erpIncomingReceipt.update({where:{id:receipt.id},data:{allocatedAmount:next,status:next.eq(0)?'open':'partial',version:{increment:1}}});await tx.erpReceiptClaim.update({where:{id:claim.id},data:{status:'reversed',reviewReason:reason}});}
   await audit(tx,ctx,'erp.payment.reverse','Payment',id,{reason,count:items.length});return{items};
  },{isolationLevel:'Serializable'});
 }
 async refund(ctx:RequestContext,kind:'receivable'|'payable',id:string,body:unknown){
  this.auth.require(ctx,'erp.finance.write');const input=readBody(z.object({requestKey:z.uuid(),amount:money,reason:label(500)}),body);const amount=new Prisma.Decimal(input.amount);if(amount.lte(0))conflict('退款金额必须大于零');
  return this.db.$transaction(async tx=>{const reference='RF-'+input.requestKey;const prior=await tx.erpPayment.findFirst({where:{tenantId:ctx.tenantId,reference}});if(prior){if(!prior.amount.eq(amount.negated())||prior.note!==input.reason||![prior.receivableId,prior.payableId].includes(id))conflict('退款重试内容不一致');return prior;}
   const ar=kind==='receivable';const account=ar?await tx.erpReceivable.findFirst({where:{id,tenantId:ctx.tenantId}}):await tx.erpPayable.findFirst({where:{id,tenantId:ctx.tenantId}});if(!account)failNotFound('账款');if(amount.gt(account.paidAmount.minus(account.amount)))conflict('退款超过退货后可退余额');const paid=account.paidAmount.minus(amount);
   if(ar)await tx.erpReceivable.update({where:{id},data:{paidAmount:paid,status:accountStatus(account.amount,paid)}});else await tx.erpPayable.update({where:{id},data:{paidAmount:paid,status:accountStatus(account.amount,paid)}});
   const payment=await tx.erpPayment.create({data:{tenantId:ctx.tenantId,...(ar?{receivableId:id}:{payableId:id}),amount:amount.negated(),reference,kind:'refund',note:input.reason,actorMembershipId:ctx.membershipId}});await audit(tx,ctx,'erp.payment.refund','Payment',payment.id,{reason:input.reason,amount:amount.toFixed(2)});return payment;
  },{isolationLevel:'Serializable'});
 }
 async statement(ctx:RequestContext,query:unknown){
  this.auth.require(ctx,'erp.finance.read');const q=readBody(z.object({kind:accountKind,partyId:z.uuid(),from:z.iso.datetime(),to:z.iso.datetime()}),query);if(q.from>q.to)conflict('开始日期不能晚于结束日期');
  const party=q.kind==='receivable'?await this.db.erpCustomer.findFirst({where:{id:q.partyId,tenantId:ctx.tenantId}}):await this.db.erpSupplier.findFirst({where:{id:q.partyId,tenantId:ctx.tenantId}});if(!party)failNotFound('往来对象');
  const entries=await this.db.erpAccountEntry.findMany({where:{tenantId:ctx.tenantId,kind:q.kind,partyId:q.partyId,occurredAt:{lte:new Date(q.to)}}});const ids=entries.map(e=>e.accountId);
  const payments=await this.db.erpPayment.findMany({where:{tenantId:ctx.tenantId,...(q.kind==='receivable'?{receivableId:{in:ids}}:{payableId:{in:ids}}),createdAt:{lte:new Date(q.to)}}});
  const all=[...entries.map(e=>({id:e.id,date:e.occurredAt,reference:e.reference,kind:e.sourceType,charge:e.amount,settlement:new Prisma.Decimal(0),estimated:e.estimated})),...payments.map(p=>({id:p.id,date:p.createdAt,reference:p.reference,kind:p.kind,charge:new Prisma.Decimal(0),settlement:p.amount,estimated:false}))].sort((a,b)=>a.date.getTime()-b.date.getTime()||a.id.localeCompare(b.id));
  const before=all.filter(e=>e.date<new Date(q.from));const period=all.filter(e=>e.date>=new Date(q.from));const opening=before.reduce((n,e)=>n.plus(e.charge).minus(e.settlement),new Prisma.Decimal(0));let balance=opening;
  const rows=period.map(e=>{balance=balance.plus(e.charge).minus(e.settlement);return{...e,charge:e.charge.toFixed(2),settlement:e.settlement.toFixed(2),balance:balance.toFixed(2)}});
  await audit(this.db,ctx,'erp.statement.read','Party',party.id,{kind:q.kind,from:q.from,to:q.to});return{party,kind:q.kind,from:q.from,to:q.to,opening:opening.toFixed(2),charges:period.reduce((n,e)=>n.plus(e.charge),new Prisma.Decimal(0)).toFixed(2),settlements:period.reduce((n,e)=>n.plus(e.settlement),new Prisma.Decimal(0)).toFixed(2),closing:balance.toFixed(2),rows,historicalEstimated:all.some(e=>e.estimated)};
 }
 async aging(ctx:RequestContext){
  this.auth.require(ctx,'erp.finance.read');const result=[];
  for(const kind of ['receivable','payable'] as const){const accounts=kind==='receivable'?await this.db.erpReceivable.findMany({where:{tenantId:ctx.tenantId}}):await this.db.erpPayable.findMany({where:{tenantId:ctx.tenantId}});const buckets={notDue:new Prisma.Decimal(0),days1to30:new Prisma.Decimal(0),days31to60:new Prisma.Decimal(0),days61to90:new Prisma.Decimal(0),over90:new Prisma.Decimal(0),noDueDate:new Prisma.Decimal(0),credit:new Prisma.Decimal(0)};for(const a of accounts){const remaining=a.amount.minus(a.paidAmount);const days=a.dueAt?Math.max(0,Math.ceil((Date.now()-a.dueAt.getTime())/86400000)):null;const b=remaining.lt(0)?'credit':days===null?'noDueDate':days===0?'notDue':days<=30?'days1to30':days<=60?'days31to60':days<=90?'days61to90':'over90';buckets[b]=buckets[b].plus(remaining);}result.push({kind,buckets:Object.fromEntries(Object.entries(buckets).map(([k,v])=>[k,v.toFixed(2)]))});}return result;
 }
}
