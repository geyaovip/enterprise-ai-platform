import { currentActors, type FlowStep } from './workflow.rules';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { RequestContext } from '../platform/context';
import { z } from 'zod';
import { readBody } from '../platform/security';
import { Prisma } from '../../generated/prisma/client';
import { assignedReviewAllowed,type ApprovalConfig,pageQuery } from './erp.common';

const kinds = ['purchase_approval', 'purchase_change', 'sales_approval', 'opportunity_followup', 'invoice_registration', 'receipt_claim', 'task', 'purchase_receipt', 'sales_shipment','return_approval','account_overdue'] as const;
const querySchema = pageQuery.extend({ kind: z.enum(['all', ...kinds]).default('all') });

type WorkItem = {
  id: string;
  kind: typeof kinds[number];
  resourceId: string;
  resourceName: string;
  title: string;
  detail: string;
  createdAt: Date;
  dueAt: Date | null;
  flowId?:string;
};

@Injectable()
export class WorkItemsService {
  constructor(private readonly db: PrismaService) {}

  async list(ctx: RequestContext, query: unknown = {}) {
    const q = readBody(querySchema, query);
    const items: WorkItem[] = [];
    const settings=await this.db.erpBusinessSettings.findUnique({where:{tenantId:ctx.tenantId}});const config=(settings?.approvalConfig??{})as ApprovalConfig;
    const allowed=(kind:'sales'|'purchase',amount:Prisma.Decimal)=>assignedReviewAllowed(config,ctx,kind,amount);
    if (ctx.permissions.includes('erp.master.read')) {
      const tasks = await this.db.erpTask.findMany({ where: { tenantId: ctx.tenantId, assigneeMembershipId: ctx.membershipId, status: 'open' }, select: { id: true, title: true, description: true, createdAt: true, dueAt: true } });
      items.push(...tasks.map(task => ({ id: `task:${task.id}`, kind: 'task' as const, resourceId: task.id, resourceName: task.title, title: task.title, detail: task.description || '指派给我的任务', createdAt: task.createdAt, dueAt: task.dueAt })));
    }
    if (ctx.permissions.includes('erp.purchase.receive')) {
      const orders = await this.db.erpPurchaseOrder.findMany({ where: { tenantId: ctx.tenantId, status: { in: ['ordered', 'partial_received'] }, changes: { none: { status: 'pending' } } }, select: { id: true, number: true, createdAt: true, supplier: { select: { name: true } }, lines: { select: { quantity: true, receivedQty: true,baseUnit:true } } } });
      items.push(...orders.flatMap(order => {
        const remaining = order.lines.reduce((sum, line) => sum + line.quantity - line.receivedQty, 0);
        return remaining > 0 ? [{ id: `purchase_receipt:${order.id}`, kind: 'purchase_receipt' as const, resourceId: order.id, resourceName: order.number, title: `采购入库 ${order.number}`, detail: `${order.supplier.name} · 待入库 ${remaining} 基础单位（${[...new Set(order.lines.map(l=>l.baseUnit))].join('/')}）`, createdAt: order.createdAt, dueAt: null }] : [];
      }));
    }
    if (ctx.permissions.includes('erp.sales.ship')) {
      const contracts = await this.db.erpSalesContract.findMany({ where: { tenantId: ctx.tenantId, status: { in: ['confirmed', 'partial_shipped'] } }, select: { id: true, number: true, createdAt: true, customer: { select: { name: true } }, lines: { select: { quantity: true, shippedQty: true,baseUnit:true } } } });
      items.push(...contracts.flatMap(contract => {
        const remaining = contract.lines.reduce((sum, line) => sum + line.quantity - line.shippedQty, 0);
        return remaining > 0 ? [{ id: `sales_shipment:${contract.id}`, kind: 'sales_shipment' as const, resourceId: contract.id, resourceName: contract.number, title: `销售发货 ${contract.number}`, detail: `${contract.customer.name} · 待发货 ${remaining} 基础单位（${[...new Set(contract.lines.map(l=>l.baseUnit))].join('/')}）`, createdAt: contract.createdAt, dueAt: null }] : [];
      }));
    }
    if (ctx.permissions.includes('erp.purchase.approve')) {
      const [orders, changes] = await Promise.all([
        this.db.erpPurchaseOrder.findMany({ where: { tenantId: ctx.tenantId, status: 'pending_approval', createdByMembershipId: { not: ctx.membershipId } }, select: { id: true, total:true,number: true, supplier: { select: { name: true } }, createdAt: true }, orderBy: { updatedAt: 'desc' } }),
        this.db.erpPurchaseChange.findMany({ where: { tenantId: ctx.tenantId, status: 'pending', requestedByMembershipId: { not: ctx.membershipId } }, select: { id: true, proposed:true,orderId: true, reason: true, createdAt: true, order: { select: { number: true } } }, orderBy: { createdAt: 'desc' } }),
      ]);
      items.push(...orders.filter(o=>allowed('purchase',o.total)).map(order => ({ id: `purchase_approval:${order.id}`, kind: 'purchase_approval' as const, resourceId: order.id, resourceName: order.number, title: `审核采购单 ${order.number}`, detail: order.supplier.name, createdAt: order.createdAt, dueAt: null })));
      items.push(...changes.filter(c=>allowed('purchase',new Prisma.Decimal((c.proposed as {total:string}).total))).map(change => ({ id: `purchase_change:${change.id}`, kind: 'purchase_change' as const, resourceId: change.orderId, resourceName: change.order.number, title: `审核采购变更 ${change.order.number}`, detail: change.reason, createdAt: change.createdAt, dueAt: null })));
    }
    if (ctx.permissions.includes('erp.sales.approve')) {
      const contracts = await this.db.erpSalesContract.findMany({ where: { tenantId: ctx.tenantId, status: 'pending_approval', ownerMembershipId: { not: ctx.membershipId } }, select: { id: true, total:true,number: true, customer: { select: { name: true } }, createdAt: true }, orderBy: { updatedAt: 'desc' } });
      items.push(...contracts.filter(o=>allowed('sales',o.total)).map(contract => ({ id: `sales_approval:${contract.id}`, kind: 'sales_approval' as const, resourceId: contract.id, resourceName: contract.number, title: `审核销售合同 ${contract.number}`, detail: contract.customer.name, createdAt: contract.createdAt, dueAt: null })));
    }
    if (ctx.permissions.includes('erp.finance.write')) {
      const requests = await this.db.erpInvoiceRequest.findMany({ where: { tenantId: ctx.tenantId, status: 'requested', requestedByMembershipId: { not: ctx.membershipId } }, select: { id: true, amount: true, createdAt: true, contract: { select: { number: true, customer: { select: { name: true } } } } }, orderBy: { createdAt: 'desc' } });
      items.push(...requests.map(request => ({ id: `invoice_registration:${request.id}`, kind: 'invoice_registration' as const, resourceId: request.id, resourceName: request.contract.number, title: `核对内部开票申请 ${request.contract.number}`, detail: `${request.contract.customer.name} · ${request.amount.toFixed(2)} 元`, createdAt: request.createdAt, dueAt: null })));
      const claims = await this.db.erpReceiptClaim.findMany({ where: { tenantId: ctx.tenantId, status: 'pending', requestedByMembershipId: { not: ctx.membershipId } }, select: { id: true, receiptId: true, amount: true, createdAt: true, receipt: { select: { reference: true, customer: { select: { name: true } } } } }, orderBy: { createdAt: 'desc' } });
      items.push(...claims.map(claim => ({ id: `receipt_claim:${claim.id}`, kind: 'receipt_claim' as const, resourceId: claim.receiptId, resourceName: claim.receipt.reference, title: `核对收款认领 ${claim.receipt.reference}`, detail: `${claim.receipt.customer.name} · ${claim.amount.toFixed(2)} 元`, createdAt: claim.createdAt, dueAt: null })));
    }
    if (ctx.permissions.includes('erp.sales.write')) {
      const opportunities = await this.db.erpOpportunity.findMany({ where: { tenantId: ctx.tenantId, ownerMembershipId: ctx.membershipId, stage: { notIn: ['won', 'lost'] }, customer: { active: true } }, select: { id: true, name: true, customer: { select: { name: true } }, followups: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, createdAt: true, nextActionAt: true } } }, orderBy: { updatedAt: 'desc' } });
      const now = new Date();
      items.push(...opportunities.flatMap(opportunity => {
        const followup = opportunity.followups[0];
        if (!followup?.nextActionAt || followup.nextActionAt > now) return [];
        return [{ id: `opportunity_followup:${followup.id}`, kind: 'opportunity_followup' as const, resourceId: opportunity.id, resourceName: opportunity.name, title: `跟进商机 ${opportunity.name}`, detail: opportunity.customer.name, createdAt: followup.createdAt, dueAt: followup.nextActionAt }];
      }));
    }
    const returns=await this.db.erpTradeReturn.findMany({where:{tenantId:ctx.tenantId,status:'pending',createdByMembershipId:{not:ctx.membershipId}}});
    items.push(...returns.filter(r=>ctx.permissions.includes(`erp.${r.kind}.approve`)&&allowed(r.kind as 'sales'|'purchase',r.amount)).map(r=>({id:`return:${r.id}`,kind:'return_approval' as const,resourceId:r.id,resourceName:r.number,title:`审核退货 ${r.number}`,detail:r.reason,createdAt:r.createdAt,dueAt:null})));
    if(ctx.permissions.includes('erp.finance.read'))for(const kind of ['receivable','payable']as const){const accounts=kind==='receivable'?await this.db.erpReceivable.findMany({where:{tenantId:ctx.tenantId,dueAt:{lt:new Date()},status:{in:['open','partial']}}}):await this.db.erpPayable.findMany({where:{tenantId:ctx.tenantId,dueAt:{lt:new Date()},status:{in:['open','partial']}}});for(const a of accounts)if(a.amount.gt(a.paidAmount))items.push({id:`account:${kind}:${a.id}`,kind:'account_overdue',resourceId:a.id,resourceName:a.openingReference??'账款',title:kind==='receivable'?'应收账款已逾期':'应付账款已逾期',detail:`未结 ${a.amount.minus(a.paidAmount).toFixed(2)} 元`,createdAt:a.createdAt,dueAt:a.dueAt});}
    const flows=await this.db.erpWorkflow.findMany({where:{tenantId:ctx.tenantId}});
    const covered=new Set(flows.flatMap(f=>{const pairs=f.kind==='purchase'?[['purchase_approval',f.resourceId],['purchase_receipt',f.resourceId]]:f.kind==='sales'?[['sales_approval',f.resourceId],['sales_shipment',f.resourceId]]:f.kind==='purchase_change'?[['purchase_change',f.parentResourceId]]:f.kind==='invoice'?[['invoice_registration',f.resourceId]]:f.kind==='receipt'?[['receipt_claim',f.parentResourceId]]:[['return_approval',f.resourceId]];return pairs.map(([kind,id])=>`${kind}:${id}`);}));
    for(let i=items.length-1;i>=0;i--)if(covered.has(`${items[i].kind}:${items[i].resourceId}`))items.splice(i,1);
    for(const f of flows){if(f.status!=='active')continue;const step=(f.steps as FlowStep[])[f.cursor];if(!currentActors(step).includes(ctx.membershipId))continue;const kind=f.kind==='purchase'?(step.type==='handling'?'purchase_receipt':'purchase_approval'):f.kind==='sales'?(step.type==='handling'?'sales_shipment':'sales_approval'):f.kind==='purchase_change'?'purchase_change':f.kind==='invoice'?'invoice_registration':f.kind==='receipt'?'receipt_claim':'return_approval';items.push({id:`workflow:${f.id}`,flowId:f.id,kind,resourceId:f.kind==='receipt'||f.kind==='purchase_change'?f.parentResourceId!:f.resourceId,resourceName:f.resourceNumber,title:`${step.name} ${f.resourceNumber}`,detail:f.title,createdAt:new Date(step.enteredAt!),dueAt:f.dueAt});}
    items.sort((a, b) => (a.dueAt ?? a.createdAt).getTime() - (b.dueAt ?? b.createdAt).getTime() || a.id.localeCompare(b.id));
    const counts = Object.fromEntries(kinds.map(kind => [kind, items.filter(item => item.kind === kind).length]));
    const selected = items.filter(item => (q.kind === 'all' || item.kind === q.kind) && (!q.q || `${item.title} ${item.detail}`.toLocaleLowerCase().includes(q.q.toLocaleLowerCase())));
    return { items: selected.slice((q.page - 1) * q.page_size, q.page * q.page_size), total: selected.length, page: q.page, page_size: q.page_size, counts, truncated: false };
  }
}
