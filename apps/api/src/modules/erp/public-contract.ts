import { ConflictException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import type { PrismaService } from '../prisma.service';
import type { PurchaseService } from './purchase.service';
import type { InventoryService } from './inventory.service';
import type { MasterService } from './master.service';
import type { SalesService } from './sales.service';
import { CommandRegistry } from '../orchestration/command-registry';
import { positiveQty, money } from './erp.common';
import { replenishmentFacts } from './replenishment.service';
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
export function registerErpContract(registry:CommandRegistry,db:PrismaService,purchase:PurchaseService,inventory:InventoryService,master:MasterService,sales:SalesService){
 const base={appId:'erp'};
 registry.register({...base,id:'erp.purchase.create_draft',permission:'erp.purchase.write',title:'创建采购草稿',confirmation:true,preview:(ctx,input)=>master.purchaseDraftPreview(ctx,input.supplierId,input.lines),input:z.object({number:z.string().min(1).max(80),supplierId:z.uuid(),lines:z.array(z.object({productId:z.uuid(),quantity:positiveQty,unitPrice:money.optional()})).min(1).max(100)}),execute:async(tx,ctx,input)=>({state:'completed',result:json(await purchase.createInTransaction(tx,ctx,input))})});
 registry.register({...base,id:'erp.purchase.create_from_plan',permission:'erp.purchase.write',title:'创建补货采购草稿',confirmation:true,preview:(ctx,input)=>master.purchaseDraftPreview(ctx,input.supplierId,input.lines),input:z.object({number:z.string().min(1).max(80),supplierId:z.uuid(),lines:z.array(z.object({productId:z.uuid(),quantity:positiveQty,snapshotHash:z.string().length(64)})).min(1).max(100)}),execute:async(tx,ctx,input)=>{
  if(!ctx.permissions.includes('erp.inventory.read'))throw new ConflictException('无权使用库存补货计划');
  const current=await replenishmentFacts(tx,ctx.tenantId,input.lines.map((l:any)=>l.productId));
  if(input.lines.some((l:any)=>!current.some(r=>r.productId===l.productId&&r.snapshotHash===l.snapshotHash&&r.suggestedQty>0)))throw new ConflictException('补货依据已变化，请取消当前计划并重新生成');
  return{state:'completed',result:json(await purchase.createInTransaction(tx,ctx,input))};
 }});
 registry.register({...base,id:'erp.purchase.submit',permission:'erp.purchase.write',title:'提交采购审批',confirmation:true,input:z.object({id:z.uuid(),version:z.int().positive()}),execute:async(tx,ctx,input)=>({state:'completed',result:json(await purchase.submitInTransaction(tx,ctx,input.id,{version:input.version}))})});
 registry.register({...base,id:'erp.purchase.wait_for_receipt',permission:'erp.purchase.read',title:'等待审批与入库',confirmation:false,input:z.object({id:z.uuid()}),execute:async(tx,ctx,input)=>{
  const order=await tx.erpPurchaseOrder.findFirst({where:{id:input.id,tenantId:ctx.tenantId},include:{lines:true}});if(!order)throw new NotFoundException('采购单不存在');
  if(['rejected','cancelled','closed'].includes(order.status))throw new ConflictException('采购单已拒绝、取消或关闭，需人工处理');
  return{state:order.status==='received'?'completed':'waiting',result:{id:order.id,number:order.number,status:order.status,version:order.version}};
 }});
 registry.register({...base,id:'erp.inventory.verify_receipt',permission:'erp.inventory.read',title:'核对实际入库',confirmation:false,input:z.object({id:z.uuid()}),execute:async(tx,ctx,input)=>{
  const order=await tx.erpPurchaseOrder.findFirst({where:{id:input.id,tenantId:ctx.tenantId,status:'received'},include:{lines:true}});if(!order||order.lines.some(l=>l.receivedQty!==l.quantity))throw new ConflictException('采购尚未全部入库');
  return{state:'completed',result:json({purchaseId:order.id,receiptVerified:true,inventory:await replenishmentFacts(tx,ctx.tenantId,order.lines.map(l=>l.productId)),verifiedAt:new Date().toISOString()})};
 }});
 registry.registerReader('erp',async(ctx,type,id)=>{
  if(type==='purchase')return purchase.get(ctx,id);
  if(type==='contract')return sales.get(ctx,id);
  if(type==='product'){if(!ctx.permissions.includes('erp.master.read'))throw new ConflictException('无权读取商品');const product=await db.erpProduct.findFirst({where:{id,tenantId:ctx.tenantId}});if(!product)throw new NotFoundException('商品不存在');return product;}
  throw new ConflictException('ERP 不支持此对象类型');
 });
}
