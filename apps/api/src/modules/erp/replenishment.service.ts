import { ConflictException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../platform/auth.service';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
import { TaskService } from '../orchestration/task.service';
import { fingerprint } from '../orchestration/command-registry';
import { positiveQty } from './erp.common';
import { qty } from './trade.common';
export async function replenishmentFacts(tx:Prisma.TransactionClient,tenantId:string,ids?:string[]){
 const products=await tx.erpProduct.findMany({where:{tenantId,active:true,...(ids?{id:{in:ids}}:{})},include:{balance:true},orderBy:{sku:'asc'}}),productIds=products.map(p=>p.id);
 const [incoming,demand]=await Promise.all([tx.erpPurchaseLine.findMany({where:{productId:{in:productIds},order:{tenantId,status:{in:['ordered','partial_received']}}},select:{productId:true,quantity:true,receivedQty:true,order:{select:{id:true,version:true}}}}),tx.erpSalesLine.findMany({where:{productId:{in:productIds},contract:{tenantId,status:{in:['confirmed','partial_shipped']}}},select:{productId:true,quantity:true,shippedQty:true,contract:{select:{id:true,version:true}}}})]);
 return products.map(p=>{
  const incomingQty=qty(incoming.filter(l=>l.productId===p.id).reduce((n,l)=>n+l.quantity-l.receivedQty,0)),demandQty=qty(demand.filter(l=>l.productId===p.id).reduce((n,l)=>n+l.quantity-l.shippedQty,0)),onHand=p.balance?.quantity??0,target=p.reorderPoint>0?qty(p.reorderPoint+1):0,suggestedQty=qty(Math.max(0,target+demandQty-onHand-incomingQty));
  const facts={productId:p.id,sku:p.sku,name:p.name,unit:p.unit,purchasePrice:p.purchasePrice.toFixed(2),balanceVersion:p.balance?.version??0,onHand,target,demandQty,incomingQty,availableQty:qty(onHand-demandQty),suggestedQty};
  const evidence={...facts,incoming:incoming.filter(l=>l.productId===p.id),demand:demand.filter(l=>l.productId===p.id)};
  return{...facts,snapshotHash:fingerprint(evidence)};
 });
}
@Injectable()
export class ReplenishmentService{
 constructor(private readonly db:PrismaService,private readonly auth:AuthService,private readonly tasks:TaskService){}
 async facts(ctx:RequestContext){this.auth.require(ctx,'erp.inventory.read');const rows=await this.db.$transaction(tx=>replenishmentFacts(tx,ctx.tenantId),{isolationLevel:'RepeatableRead'});return{calculatedAt:new Date().toISOString(),scope:'企业汇总库存与已确认订单',formula:'补货量 = max(0, 目标库存 + 未发货需求 - 在库数量 - 未入库采购)',items:rows.filter(r=>r.suggestedQty>0)};}
 async plan(ctx:RequestContext,body:unknown){
  this.auth.require(ctx,'erp.inventory.read');this.auth.require(ctx,'erp.purchase.write');
  const input=readBody(z.object({requestKey:z.string().min(8).max(100),supplierId:z.uuid(),number:z.string().trim().min(1).max(80),lines:z.array(z.object({productId:z.uuid(),quantity:positiveQty,snapshotHash:z.string().length(64)})).min(1).max(100)}),body);
  if(new Set(input.lines.map(l=>l.productId)).size!==input.lines.length)throw new ConflictException('商品不能重复');
  const fresh=await this.db.$transaction(tx=>replenishmentFacts(tx,ctx.tenantId,input.lines.map(l=>l.productId)),{isolationLevel:'RepeatableRead'});
  if(input.lines.some(l=>fresh.find(r=>r.productId===l.productId)?.snapshotHash!==l.snapshotHash))throw new ConflictException('库存、需求或在途采购已变化，请刷新补货建议');
  return this.tasks.create(ctx,{requestKey:input.requestKey,title:`补货采购 · ${input.number}`,kind:'replenishment',steps:[
   {appId:'erp',command:'erp.purchase.create_from_plan',title:'复核并创建采购草稿',input:{number:input.number,supplierId:input.supplierId,lines:input.lines}},
   {appId:'erp',command:'erp.purchase.submit',title:'提交企业采购审批',input:{id:{fromStep:0,path:['id']},version:{fromStep:0,path:['version']}}},
   {appId:'erp',command:'erp.purchase.wait_for_receipt',title:'等待审批与采购入库',input:{id:{fromStep:0,path:['id']}}},
   {appId:'erp',command:'erp.inventory.verify_receipt',title:'复核入库与当前库存',input:{id:{fromStep:0,path:['id']}}},
  ]});
 }
 async metric(ctx:RequestContext,body:unknown){
  const input=readBody(z.object({metric:z.enum(['inventory','procurement','receivable','payable']),from:z.iso.datetime().optional(),to:z.iso.datetime().optional()}),body);
  if(input.from&&input.to&&input.from>input.to)throw new ConflictException('统计开始时间不能晚于结束时间');
  if(input.metric==='inventory'){this.auth.require(ctx,'erp.inventory.read');return{metric:input.metric,unit:'基础计量单位',calculatedAt:new Date().toISOString(),items:await this.db.$transaction(tx=>replenishmentFacts(tx,ctx.tenantId),{isolationLevel:'RepeatableRead'})};}
  const dates=input.from||input.to?{createdAt:{...(input.from?{gte:new Date(input.from)}:{}),...(input.to?{lte:new Date(input.to)}:{})}}:{};
  if(input.metric==='procurement'){this.auth.require(ctx,'erp.purchase.read');return{metric:input.metric,scope:'创建时间',items:await this.db.erpPurchaseOrder.groupBy({by:['status'],where:{tenantId:ctx.tenantId,...dates},_count:true,_sum:{total:true}}),currency:'CNY',calculatedAt:new Date().toISOString()};}
  this.auth.require(ctx,'erp.finance.read');const rows=input.metric==='receivable'?await this.db.erpReceivable.findMany({where:{tenantId:ctx.tenantId,...dates}}):await this.db.erpPayable.findMany({where:{tenantId:ctx.tenantId,...dates}});
  return{metric:input.metric,scope:'按账款创建时间，余额为金额减已结算金额',amount:rows.reduce((n,r)=>n.plus(r.amount).minus(r.paidAmount),new Prisma.Decimal(0)).toFixed(2),currency:'CNY',count:rows.length,calculatedAt:new Date().toISOString()};
 }
}
