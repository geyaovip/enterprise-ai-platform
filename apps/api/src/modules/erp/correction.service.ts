import { Injectable } from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import { assertFlowActor, activeFlow } from './workflow.rules';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../platform/auth.service';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
import { audit, notifyApprovers, storedMoney, conflict, failNotFound, label, money, pageQuery, positiveQty } from './erp.common';
import { accountStatus, checkApprover, qty, unitMoney } from './trade.common';
import { stockMove, warehouse } from './stock-ledger';

const returnLine = z.object({ movementId: z.uuid(), quantity: positiveQty });
const returnInput = z.object({ requestKey: z.uuid(), number: label(80), kind: z.enum(['sales', 'purchase']), sourceId: z.uuid(), warehouseId: z.uuid().optional(), reason: label(500), lines: z.array(returnLine).min(1).max(100) }).refine(x => new Set(x.lines.map(l => l.movementId)).size === x.lines.length, '原始流水不能重复');
const savedLine = returnLine.extend({ productId: z.uuid(), unitPrice: unitMoney, amount: money, netAmount:money, unitCost: z.string(), costAmount: money, costEstimated: z.boolean() });
const reviewInput = z.object({ version: z.int().positive(), decision: z.enum(['approve', 'reject']), reason: label(500) });

@Injectable()
export class CorrectionService {
 constructor(private readonly db: PrismaService, private readonly auth: AuthService, private readonly workflows: WorkflowService) {}
 async returns(ctx: RequestContext, query: unknown) {
  this.auth.require(ctx, 'erp.master.read'); const q = readBody(pageQuery, query);
  const where = { tenantId: ctx.tenantId, ...(ctx.roles.includes('sales')&&!ctx.permissions.includes('erp.sales.approve') ? {kind:'sales',createdByMembershipId:ctx.membershipId}:ctx.roles.includes('purchasing')&&!ctx.permissions.includes('erp.sales.approve')?{kind:'purchase'}:{}), ...(q.status ? { status: q.status } : {}), ...(q.q ? { number: { contains: q.q, mode: 'insensitive' as const } } : {}) };
  const [items,total] = await this.db.$transaction([this.db.erpTradeReturn.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page-1)*q.page_size, take:q.page_size }),this.db.erpTradeReturn.count({where})]); return {items,total,page:q.page,page_size:q.page_size};
 }
 async getReturn(ctx:RequestContext,id:string){
  this.auth.require(ctx,'erp.master.read');const record=await this.db.erpTradeReturn.findFirst({where:{id,tenantId:ctx.tenantId}});if(!record)failNotFound('退货单');
  if(ctx.roles.includes('sales')&&!ctx.permissions.includes('erp.sales.approve')&&(record.kind!=='sales'||record.createdByMembershipId!==ctx.membershipId))failNotFound('退货单');if(ctx.roles.includes('purchasing')&&!ctx.permissions.includes('erp.sales.approve')&&record.kind!=='purchase')failNotFound('退货单');
  const lines=readBody(z.array(savedLine),record.lines),products=await this.db.erpProduct.findMany({where:{tenantId:ctx.tenantId,id:{in:lines.map(l=>l.productId)}},select:{id:true,sku:true,name:true,unit:true}});const source=record.kind==='sales'?await this.db.erpSalesContract.findFirst({where:{tenantId:ctx.tenantId,id:record.sourceId}}):await this.db.erpPurchaseOrder.findFirst({where:{tenantId:ctx.tenantId,id:record.sourceId}});
  return{...record,sourceNumber:source?.number,lines:lines.map(l=>({...l,...products.find(p=>p.id===l.productId)}))};
 }
 async sources(ctx: RequestContext, kind: 'sales'|'purchase', id: string) {
  this.auth.require(ctx, kind === 'sales' ? 'erp.sales.read' : 'erp.purchase.read');
  const order = kind === 'sales' ? await this.db.erpSalesContract.findFirst({ where: { id, tenantId:ctx.tenantId, ...(ctx.roles.includes('sales') ? {ownerMembershipId:ctx.membershipId}: {}) } }) : await this.db.erpPurchaseOrder.findFirst({where:{id,tenantId:ctx.tenantId}}); if(!order)failNotFound('原单');
  const moves = await this.db.erpStockMovement.findMany({where:{tenantId:ctx.tenantId,sourceType:kind==='sales'?'contract':'purchase',sourceId:id},include:{document:{select:{number:true}}},orderBy:{createdAt:'desc'}});
  const prior = await this.db.erpTradeReturn.findMany({where:{tenantId:ctx.tenantId,kind,sourceId:id,status:'approved'}});
  const products=await this.db.erpProduct.findMany({where:{tenantId:ctx.tenantId,id:{in:moves.map(m=>m.productId)}},select:{id:true,sku:true,name:true,unit:true}});
  return moves.map(m=>({...m,product:products.find(p=>p.id===m.productId),returnableQty:qty(m.quantity-prior.flatMap(r=>readBody(z.array(savedLine),r.lines)).filter(l=>l.movementId===m.id).reduce((n,l)=>n+l.quantity,0))}));
 }
 async requestReturn(ctx: RequestContext, body: unknown) {
  const input=readBody(returnInput,body);this.auth.require(ctx,input.kind==='sales'?'erp.sales.write':'erp.purchase.write');
  return this.db.$transaction(async tx=>{
   const existing=await tx.erpTradeReturn.findUnique({where:{tenantId_requestKey:{tenantId:ctx.tenantId,requestKey:input.requestKey}}});
   if(existing){const prior=readBody(z.array(savedLine),existing.lines);if(existing.createdByMembershipId!==ctx.membershipId||existing.number!==input.number||existing.kind!==input.kind||existing.sourceId!==input.sourceId||existing.reason!==input.reason||(input.warehouseId&&existing.warehouseId!==input.warehouseId)||JSON.stringify(prior.map(l=>({movementId:l.movementId,quantity:l.quantity})))!==JSON.stringify(input.lines))conflict('重试内容与原退货申请不一致');return existing;}
   const sales=input.kind==='sales';
   const order=sales?await tx.erpSalesContract.findFirst({where:{id:input.sourceId,tenantId:ctx.tenantId,...(ctx.roles.includes('sales')?{ownerMembershipId:ctx.membershipId}: {})},include:{lines:true}}):await tx.erpPurchaseOrder.findFirst({where:{id:input.sourceId,tenantId:ctx.tenantId},include:{lines:true}});
   if(!order)failNotFound('原单');
   const wh=await warehouse(tx,ctx,input.warehouseId);const lines=[];
   for(const line of input.lines){
    const move=await tx.erpStockMovement.findFirst({where:{id:line.movementId,tenantId:ctx.tenantId,sourceType:sales?'contract':'purchase',sourceId:order.id}});if(!move)failNotFound('原出入库批次');
    if(!sales && move.warehouseId && move.warehouseId!==wh.id)conflict('采购退货须从原入库仓库退回');
    const original=order.lines.find(l=>l.productId===move.productId);if(!original)failNotFound('原单商品');
    if(line.quantity>move.quantity)conflict('退货数量超过原批次数量');
    const unitCost=move.unitCost??new Prisma.Decimal(0),cost=move.costAmount?move.costAmount.mul(line.quantity).div(move.quantity).toDecimalPlaces(2):new Prisma.Decimal(0);
    lines.push({...line,productId:move.productId,unitPrice:original.unitPrice.toString(),amount:(move.grossAmount??original.unitPrice.mul(move.quantity)).mul(line.quantity).div(move.quantity).toFixed(2),netAmount:(move.tradeAmount??original.unitPrice.div(new Prisma.Decimal(1).plus(original.taxRate.div(100))).mul(move.quantity)).mul(line.quantity).div(move.quantity).toFixed(2),unitCost:unitCost.toString(),costAmount:cost.toFixed(2),costEstimated:move.costAmount===null||move.costEstimated});
   }
   const amount=lines.reduce((n,l)=>n.plus(l.amount),new Prisma.Decimal(0));
   const record=await tx.erpTradeReturn.create({data:{tenantId:ctx.tenantId,number:input.number,requestKey:input.requestKey,kind:input.kind,sourceId:input.sourceId,warehouseId:wh.id,reason:input.reason,lines,amount,createdByMembershipId:ctx.membershipId}});
   await audit(tx,ctx,'erp.return.request','TradeReturn',record.id,{kind:input.kind,sourceId:input.sourceId,amount:amount.toFixed(2)});await this.workflows.begin(tx,ctx,input.kind==='sales'?'return_sales':'return_purchase',record.id,record.number,amount,record.sourceId);return record;
  },{isolationLevel:'Serializable'});
 }
 async reviewReturn(ctx:RequestContext,id:string,body:unknown){
  const input=readBody(reviewInput,body);
  return this.db.$transaction(async tx=>{
   const record=await tx.erpTradeReturn.findFirst({where:{id,tenantId:ctx.tenantId,status:'pending',version:input.version}});if(!record)conflict('退货申请状态或版本已变化');
   const sales=record.kind==='sales';this.auth.require(ctx,sales?'erp.sales.approve':'erp.purchase.approve');if(!await activeFlow(tx,ctx.tenantId,sales?'return_sales':'return_purchase',id))await checkApprover(tx,ctx,sales?'sales':'purchase',record.amount);if(record.createdByMembershipId===ctx.membershipId)conflict('退货不能由申请人自行审批');
   const flowKind=sales?'return_sales':'return_purchase';
   if(input.decision==='approve'&&!await this.workflows.approve(tx,ctx,flowKind,id)){const changed=await tx.erpTradeReturn.updateMany({where:{id,tenantId:ctx.tenantId,version:input.version},data:{version:{increment:1}}});if(!changed.count)conflict('退货已变化');return tx.erpTradeReturn.findUniqueOrThrow({where:{id}});}
   if(input.decision==='reject')await this.workflows.reject(tx,ctx,flowKind,id,input.reason!);
   if(input.decision==='approve'){
    const lines=readBody(z.array(savedLine),record.lines);const prior=await tx.erpTradeReturn.findMany({where:{tenantId:ctx.tenantId,kind:record.kind,sourceId:record.sourceId,status:'approved'}});const approved=prior.flatMap(r=>readBody(z.array(savedLine),r.lines));
    const account=sales?await tx.erpReceivable.findFirst({where:{tenantId:ctx.tenantId,contractId:record.sourceId}}):await tx.erpPayable.findFirst({where:{tenantId:ctx.tenantId,orderId:record.sourceId}});if(!account)failNotFound('原单账款');
    let approvedAmount=new Prisma.Decimal(0);
    const doc=await tx.erpStockDocument.create({data:{tenantId:ctx.tenantId,number:record.number,kind:sales?'sales_return':'purchase_return',sourceId:id,note:record.reason,actorMembershipId:ctx.membershipId}});
    for(const l of lines){const move=await tx.erpStockMovement.findFirst({where:{id:l.movementId,tenantId:ctx.tenantId}});if(!move)failNotFound('原流水');const prev=approved.filter(p=>p.movementId===l.movementId);const returned=qty(prev.reduce((n,p)=>n+p.quantity,0));if(qty(returned+l.quantity)>move.quantity)conflict('已退数量变化，不能超额退货');
     const returnedCost=prev.reduce((n,p)=>n.plus(p.costAmount),new Prisma.Decimal(0));const after=qty(returned+l.quantity);
     const allocate=(total:Prisma.Decimal,field:'amount'|'netAmount'|'costAmount')=>total.mul(after).div(move.quantity).toDecimalPlaces(2).minus(prev.reduce((n,p)=>n.plus(p[field]),new Prisma.Decimal(0)));
     const cost=move.costAmount?allocate(move.costAmount,'costAmount'):new Prisma.Decimal(l.costAmount);
     const original=sales?await tx.erpSalesLine.findFirst({where:{contractId:record.sourceId,productId:l.productId}}):await tx.erpPurchaseLine.findFirst({where:{orderId:record.sourceId,productId:l.productId}});if(!original)failNotFound('原单商品');
     l.amount=allocate(move.grossAmount??original.unitPrice.mul(move.quantity).toDecimalPlaces(2),'amount').toFixed(2);l.netAmount=allocate(move.tradeAmount??original.unitPrice.div(new Prisma.Decimal(1).plus(original.taxRate.div(100))).mul(move.quantity).toDecimalPlaces(2),'netAmount').toFixed(2);approvedAmount=approvedAmount.plus(l.amount);
     l.costAmount=cost.toFixed(2);
     await stockMove(tx,ctx,{productId:l.productId,warehouseId:record.warehouseId,direction:sales?'in':'out',quantity:l.quantity,...(sales?{unitCost:new Prisma.Decimal(l.unitCost),costAmount:cost,costEstimated:l.costEstimated}:{}),tradeAmount:new Prisma.Decimal(l.netAmount),grossAmount:new Prisma.Decimal(l.amount),sourceType:sales?'sales_return':'purchase_return',sourceId:id,documentId:doc.id});
    }
    if(approvedAmount.gt(account.amount))conflict('退货金额超过原单当前交易金额');
    const next=account.amount.minus(approvedAmount);const status=accountStatus(next,account.paidAmount);
    if(sales)await tx.erpReceivable.update({where:{id:account.id},data:{amount:next,status}});else await tx.erpPayable.update({where:{id:account.id},data:{amount:next,status}});
    const party=sales?(await tx.erpSalesContract.findUniqueOrThrow({where:{id:record.sourceId}})).customerId:(await tx.erpPurchaseOrder.findUniqueOrThrow({where:{id:record.sourceId}})).supplierId;
    await tx.erpAccountEntry.create({data:{tenantId:ctx.tenantId,kind:sales?'receivable':'payable',accountId:account.id,partyId:party,amount:approvedAmount.negated(),reference:record.number,sourceType:'return',sourceId:record.id}});
    await tx.erpTradeReturn.update({where:{id},data:{lines,amount:approvedAmount}});
   }
   const updated=await tx.erpTradeReturn.updateMany({where:{id,tenantId:ctx.tenantId,status:'pending',version:input.version},data:{status:input.decision==='approve'?'approved':'rejected',reviewReason:input.reason,reviewedByMembershipId:ctx.membershipId,reviewedAt:new Date(),version:{increment:1}}});if(!updated.count)conflict('退货申请已变化');
   await audit(tx,ctx,'erp.return.'+input.decision,'TradeReturn',id,{reason:input.reason});return tx.erpTradeReturn.findUniqueOrThrow({where:{id}});
  },{isolationLevel:'Serializable'});
 }
 async closeOrder(ctx:RequestContext,kind:'sales'|'purchase',id:string,body:unknown){
  const input=readBody(z.object({version:z.int().positive(),reason:label(500)}),body);this.auth.require(ctx,kind==='sales'?'erp.sales.approve':'erp.purchase.approve');
  return this.db.$transaction(async tx=>{
   
   if(kind==='sales'){
    const order=await tx.erpSalesContract.findFirst({where:{id,tenantId:ctx.tenantId,version:input.version},include:{lines:true}});if(!order||['shipped','closed','cancelled'].includes(order.status))conflict('当前销售单不可取消/关闭');await checkApprover(tx,ctx,'sales',order.total);const status=order.lines.some(l=>l.shippedQty>0)?'closed':'cancelled';await tx.erpSalesContract.update({where:{id},data:{status,closeReason:input.reason,version:{increment:1}}});
   }else{
    const order=await tx.erpPurchaseOrder.findFirst({where:{id,tenantId:ctx.tenantId,version:input.version},include:{lines:true}});if(!order||['received','closed','cancelled'].includes(order.status))conflict('当前采购单不可取消/关闭');await checkApprover(tx,ctx,'purchase',order.total);if(await tx.erpPurchaseChange.count({where:{tenantId:ctx.tenantId,orderId:id,status:'pending'}}))conflict('请先处理待审核变更');const status=order.lines.some(l=>l.receivedQty>0)?'closed':'cancelled';await tx.erpPurchaseOrder.update({where:{id},data:{status,closeReason:input.reason,version:{increment:1}}});
   }
   await this.workflows.reject(tx,ctx,kind,id,input.reason,true,true);
   await audit(tx,ctx,'erp.'+kind+'.close',kind==='sales'?'SalesContract':'PurchaseOrder',id,{reason:input.reason});return{ok:true};
  },{isolationLevel:'Serializable'});
 }
 async changeSales(ctx:RequestContext,id:string,body:unknown){
  this.auth.require(ctx,'erp.sales.write');const input=readBody(z.object({version:z.int().positive(),reason:label(500),lines:z.array(z.object({lineId:z.uuid(),quantity:positiveQty})).min(1).max(100)}).refine(x=>new Set(x.lines.map(l=>l.lineId)).size===x.lines.length,'明细不能重复'),body);
  return this.db.$transaction(async tx=>{
   const order=await tx.erpSalesContract.findFirst({where:{id,tenantId:ctx.tenantId,ownerMembershipId:ctx.membershipId,version:input.version,status:{in:['confirmed','partial_shipped']}},include:{lines:true}});if(!order)conflict('仅发起人可变更待履约销售单');if(input.lines.length!==order.lines.length)conflict('变更必须包含全部明细，不可删除已履约商品');let total=new Prisma.Decimal(0);
   for(const l of input.lines){const old=order.lines.find(x=>x.id===l.lineId);if(!old||l.quantity<old.shippedQty)conflict('变更数量不能低于已发数量');const lineTotal=old.unitPrice.mul(l.quantity).toDecimalPlaces(2);total=total.plus(lineTotal);await tx.erpSalesLine.update({where:{id:l.lineId},data:{quantity:l.quantity,lineTotal}});}
   total=storedMoney(total);await tx.erpSalesContract.update({where:{id},data:{total,status:'pending_approval',version:{increment:1}}});await audit(tx,ctx,'erp.contract.change','SalesContract',id,{reason:input.reason,amendedVersion:input.version+1,beforeStatus:order.status,beforeTotal:order.total.toFixed(2),before:order.lines.map(l=>({lineId:l.id,quantity:l.quantity})),after:input.lines});await this.workflows.reject(tx,ctx,'sales',id,'销售变更：'+input.reason,true);await this.workflows.begin(tx,ctx,'sales',id,order.number,total,undefined,order.deliveryAt);return tx.erpSalesContract.findUniqueOrThrow({where:{id},include:{lines:true}});
  },{isolationLevel:'Serializable'});
 }
}
