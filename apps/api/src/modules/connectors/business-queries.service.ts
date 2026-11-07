import {Injectable} from '@nestjs/common';
import type {RequestContext} from '../platform/context';
import {Prisma} from '../../generated/prisma/client';
import {MasterService} from '../erp/master.service';
import {PurchaseService} from '../erp/purchase.service';
import {SalesService} from '../erp/sales.service';
import {InventoryService} from '../erp/inventory.service';
import {FinanceService} from '../erp/finance.service';
import {MesService} from '../mes/mes.service';
export const fields=(r:any,keys:string[])=>Object.fromEntries(keys.filter(k=>r?.[k]!==undefined).map(k=>[k,r[k]]));
const paged=(r:any,keys:string[])=>({...fields(r,['total','page','page_size']),items:r.items.map((x:any)=>fields(x,keys)),asOf:new Date(),hasMore:r.page*r.page_size<r.total,scope:'当前企业与当前岗位授权范围'});
const documents=['id','number','status','version','customerId','supplierId','opportunityId','ownerMembershipId','dueAt','deliveryAt','paymentTerms','total','createdAt','updatedAt'];
const material=['id','sku','name','kind','unit','active','version'];
const report=['id','orderId','reporterId','goodQty','defectQty','note','status','reviewerId','reason','reviewedAt','version','createdAt'];
const order=['id','planId','code','operation','targetQty','assigneeId','status','goodQty','defectQty','version','createdAt'];
const plan=['id','code','productId','productSku','productName','bomId','bomRevision','targetQty','dueAt','requirements','bomVersions','status','version','createdAt'];
const bom=['id','productId','productSku','productName','revision','status','lines','note','version','createdAt','publishedAt'];
@Injectable()
export class ConnectorBusinessQueries {
 constructor(readonly master:MasterService,readonly purchase:PurchaseService,readonly sales:SalesService,readonly inventory:InventoryService,readonly finance:FinanceService,readonly mes:MesService){}
 async customers(c:RequestContext,i:any){return paged(await this.master.customers(c,i),['id','code','name','active','ownerMembershipId','version','createdAt']);}
 async opportunities(c:RequestContext,i:any){return {...paged(await this.master.opportunities(c,i),['id','customerId','customer','name','stage','estimatedAmount','ownerMembershipId','createdAt','updatedAt']),currency:'CNY',notice:'预计商机金额不是实收，ERP与CRM客户身份独立。'};}
 async followUps(c:RequestContext,i:any){return paged(await this.master.opportunityFollowups(c,i.id,i),['id','opportunityId','actorName','note','nextActionAt','createdAt']);}
 async purchaseList(c:RequestContext,i:any){return {...paged(await this.purchase.list(c,i),[...documents,'supplier']),currency:'CNY'};}
 async salesList(c:RequestContext,i:any){return {...paged(await this.sales.list(c,i),[...documents,'customer']),currency:'CNY'};}
 async document(c:RequestContext,kind:'purchase'|'sales',id:string){const r:any=await(kind==='purchase'?this.purchase.get(c,id):this.sales.get(c,id));return {...fields(r,documents),...fields(r,['customer','supplier','opportunity']),lines:r.lines.map((l:any)=>fields(l,['id','productId','sku','name','quantity','unitPrice','lineTotal','unitFactor','receivedQty','shippedQty','baseUnit','unit','taxRate','taxAmount'])),currency:'CNY',asOf:new Date(),notice:'状态、数量与应收应付分开判断；确认单据不等于已入库、发货或收付款。'};}
 async balances(c:RequestContext,i:any){return {...paged(await this.inventory.balances(c,i),['id','productId','product','quantity','warehouseQuantity','reservedQty','availableQty','lowStock']),warehouseId:i.warehouseId??null,notice:'quantity/availableQty为企业汇总；warehouseQuantity仅在指定仓库时有值。'};}
 async movements(c:RequestContext,i:any){return {...paged(await this.inventory.movements(c,i),['id','productId','product','direction','quantity','sourceType','sourceId','documentId','warehouseId','unitCost','costAmount','costEstimated','tradeAmount','createdAt']),currency:'CNY'};}
 async accounts(c:RequestContext,i:any){const r:any=await(i.kind==='receivables'?this.finance.receivables(c,i):this.finance.payables(c,i));return {...paged(r,[],),items:r.items.map((x:any)=>({...fields(x,['id','customerId','supplierId','partyName','contract','order','amount','paidAmount','status','dueAt','createdAt','updatedAt']),outstandingAmount:new Prisma.Decimal(x.amount).minus(x.paidAmount).toFixed(2)})),currency:'CNY',notice:'未结额=账款金额-已结金额；不返回付款凭据、银行或联系人字段，不执行收付款。'};}
 async mesList(c:RequestContext,i:any){const r=await this.mes.list(c,i.type,i);return paged(r,i.type==='materials'?material:i.type==='boms'?bom:i.type==='reports'?report:i.type==='orders'?order:plan);}
 async mesInspect(c:RequestContext,i:any){const r:any=await this.mes.get(c,i.type,i.id),keys=i.type==='material'?material:i.type==='bom'?bom:i.type==='report'?report:i.type==='order'?order:plan,result:any={...fields(r,keys),asOf:new Date()};
  if(i.type==='order'){result.plan=fields(r.plan,['id','code','productName','productSku','dueAt','status','version']);result.reports=r.reports.slice(0,50).map((x:any)=>fields(x,report));result.relatedRecords={type:'reports',total:r.reports.length,returned:result.reports.length,truncated:r.reports.length>50,nextQuery:{tool:'mes_list_records',type:'reports',orderId:i.id,page:1,page_size:20}};}
  if(i.type==='plan'){result.orders=r.orders.slice(0,50).map((x:any)=>fields(x,order));result.relatedRecords={type:'orders',total:r.orders.length,returned:result.orders.length,truncated:r.orders.length>50,nextQuery:{tool:'mes_list_records',type:'orders',planId:i.id,page:1,page_size:20}};}
  if(i.type==='bom')result.review=r.review?fields(r.review,['id','bomId','bomVersion','findings','decisions','createdAt','version']):null;
  return result;
 }
}
