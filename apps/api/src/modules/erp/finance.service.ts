import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../platform/auth.service';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
import { audit, conflict, decimal, failNotFound, label, money, ownerFilter, pageQuery, dateFilter } from './erp.common';

const paymentInput = z.object({ amount: money, reference: label(100) });

@Injectable()
export class FinanceService {
  constructor(private readonly db: PrismaService, private readonly auth: AuthService) {}

  async receivables(ctx: RequestContext, query: unknown) {
    this.auth.require(ctx, 'erp.finance.read');
    const q = readBody(pageQuery.extend({id:z.uuid().optional()}), query);
    const matchedParties=q.q?await this.db.erpCustomer.findMany({where:{tenantId:ctx.tenantId,name:{contains:q.q,mode:'insensitive'}},select:{id:true}}):[];
    const where = { tenantId: ctx.tenantId,...(q.id?{id:q.id}:{}), ...dateFilter(q), ...(q.status?{status:q.status}:{}), ...(q.partyId?{customerId:q.partyId}:{}), ...(q.q?{OR:[{customerId:{in:matchedParties.map(p=>p.id)}},{openingReference:{contains:q.q,mode:'insensitive' as const}},{contract:{number:{contains:q.q,mode:'insensitive' as const}}}]}:{}) };
    const [items, total] = await this.db.$transaction([
      this.db.erpReceivable.findMany({ where, include: { contract: { select: { number: true, customerId: true } }, payments: { include: { receiptClaim: { select: { receipt: { select: { reference: true } } } } }, orderBy: { createdAt: 'desc' } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.page_size, take: q.page_size }),
      this.db.erpReceivable.count({ where }),
    ]);
    const parties=await this.db.erpCustomer.findMany({where:{tenantId:ctx.tenantId,id:{in:items.map(a=>a.customerId).filter((id):id is string=>id!==null)}},select:{id:true,name:true}});
    return { items:items.map(a=>({...a,partyName:parties.find(p=>p.id===a.customerId)?.name??'往来单位'})), total, page: q.page, page_size: q.page_size };
  }

  async payables(ctx: RequestContext, query: unknown) {
    this.auth.require(ctx, 'erp.finance.read');
    const q = readBody(pageQuery.extend({id:z.uuid().optional()}), query);
    const matchedParties=q.q?await this.db.erpSupplier.findMany({where:{tenantId:ctx.tenantId,name:{contains:q.q,mode:'insensitive'}},select:{id:true}}):[];
    const where = { tenantId: ctx.tenantId,...(q.id?{id:q.id}:{}), ...dateFilter(q), ...(q.status?{status:q.status}:{}), ...(q.partyId?{supplierId:q.partyId}:{}), ...(q.q?{OR:[{supplierId:{in:matchedParties.map(p=>p.id)}},{openingReference:{contains:q.q,mode:'insensitive' as const}},{order:{number:{contains:q.q,mode:'insensitive' as const}}}]}:{}) };
    const [items, total] = await this.db.$transaction([
      this.db.erpPayable.findMany({ where, include: { order: { select: { number: true, supplierId: true } }, payments: { orderBy: { createdAt: 'desc' } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.page_size, take: q.page_size }),
      this.db.erpPayable.count({ where }),
    ]);
    const parties=await this.db.erpSupplier.findMany({where:{tenantId:ctx.tenantId,id:{in:items.map(a=>a.supplierId).filter((id):id is string=>id!==null)}},select:{id:true,name:true}});
    return { items:items.map(a=>({...a,partyName:parties.find(p=>p.id===a.supplierId)?.name??'往来单位'})), total, page: q.page, page_size: q.page_size };
  }

  async payment(ctx: RequestContext, kind: 'receivable' | 'payable', id: string, body: unknown) {
    this.auth.require(ctx, 'erp.finance.write');
    const input = readBody(paymentInput, body);
    const amount = decimal(input.amount);
    if (amount.lte(0)) conflict('收付款金额必须大于零');
    return this.db.$transaction(async tx => {
      if (kind === 'receivable') {
        const account = await tx.erpReceivable.findFirst({ where: { id, tenantId: ctx.tenantId } });
        if (!account) failNotFound('应收账款');
        const remaining = account.amount.minus(account.paidAmount);
        if (amount.gt(remaining)) conflict('收款金额超过未结余额');
        const updated = await tx.erpReceivable.updateMany({ where: { id, tenantId: ctx.tenantId, paidAmount: account.paidAmount }, data: { paidAmount: { increment: amount }, status: amount.eq(remaining) ? 'paid' : 'partial' } });
        if (!updated.count) conflict('账款余额已变化，请刷新');
        const payment = await tx.erpPayment.create({ data: { tenantId: ctx.tenantId, receivableId: id, amount, reference: input.reference, actorMembershipId: ctx.membershipId } });
        await audit(tx, ctx, 'erp.receivable.payment', 'Receivable', id, { amount: amount.toFixed(2), reference: input.reference });
        return payment;
      }
      const account = await tx.erpPayable.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!account) failNotFound('应付账款');
      const remaining = account.amount.minus(account.paidAmount);
      if (amount.gt(remaining)) conflict('付款金额超过未结余额');
      const updated = await tx.erpPayable.updateMany({ where: { id, tenantId: ctx.tenantId, paidAmount: account.paidAmount }, data: { paidAmount: { increment: amount }, status: amount.eq(remaining) ? 'paid' : 'partial' } });
      if (!updated.count) conflict('账款余额已变化，请刷新');
      const payment = await tx.erpPayment.create({ data: { tenantId: ctx.tenantId, payableId: id, amount, reference: input.reference, actorMembershipId: ctx.membershipId } });
      await audit(tx, ctx, 'erp.payable.payment', 'Payable', id, { amount: amount.toFixed(2), reference: input.reference });
      return payment;
    }, { isolationLevel: 'Serializable' });
  }

  async dashboard(ctx: RequestContext) {
    this.auth.require(ctx, 'erp.master.read');
    const tenantId = ctx.tenantId;
    const own = ownerFilter(ctx);
    const [customers, opportunities, purchases, contracts, products, receivables, payables] = await Promise.all([
      this.db.erpCustomer.count({ where: { tenantId, ...own } }),
      this.db.erpOpportunity.count({ where: { tenantId, ...own, stage: { notIn: ['won', 'lost'] } } }),
      this.db.erpPurchaseOrder.count({ where: { tenantId, status: { in: ['ordered', 'partial_received'] } } }),
      this.db.erpSalesContract.count({ where: { tenantId, ...own, status: { in: ['confirmed', 'partial_shipped'] } } }),
      this.db.erpProduct.count({ where: { tenantId, active: true } }),
      this.db.erpReceivable.findMany({ where: { tenantId, status: { not: 'paid' } }, select: { amount: true, paidAmount: true } }),
      this.db.erpPayable.findMany({ where: { tenantId, status: { not: 'paid' } }, select: { amount: true, paidAmount: true } }),
    ]);
    const sum = (rows: Array<{ amount: Prisma.Decimal; paidAmount: Prisma.Decimal }>) => rows.reduce((n, x) => n.plus(x.amount.minus(x.paidAmount)), new Prisma.Decimal(0)).toFixed(2);
    const financeVisible = ctx.permissions.includes('erp.finance.read');
    return { customers, activeOpportunities: opportunities, purchasesToReceive: ctx.permissions.includes('erp.purchase.read') ? purchases : null, contractsToShip: ctx.permissions.includes('erp.sales.read') ? contracts : null, activeProducts: products, receivableBalance: financeVisible ? sum(receivables) : null, payableBalance: financeVisible ? sum(payables) : null, amountDefinition: '已实收/实发批次金额减已登记收付款，CNY' };
  }

  async responsibilities(ctx: RequestContext) {
    this.auth.require(ctx, 'erp.master.read');
    const tenantId = ctx.tenantId;
    const own = ownerFilter(ctx);
    const groups: Array<{ kind: 'opportunity' | 'contract' | 'purchase'; label: string; ownerMembershipId: string; count: number; records: Array<{ id: string; name: string }> }> = [];
    if (ctx.permissions.includes('erp.sales.read')) {
      const opportunityWhere = { tenantId, ...own, stage: { notIn: ['won', 'lost'] } };
      const contractWhere = { tenantId, ...own, status: { in: ['confirmed', 'partial_shipped'] } };
      const [opportunities, contracts] = await Promise.all([
        this.db.erpOpportunity.groupBy({ by: ['ownerMembershipId'], where: opportunityWhere, _count: true }),
        this.db.erpSalesContract.groupBy({ by: ['ownerMembershipId'], where: contractWhere, _count: true }),
      ]);
      for (const row of opportunities) groups.push({ kind: 'opportunity', label: '进行中商机', ownerMembershipId: row.ownerMembershipId, count: row._count, records: (await this.db.erpOpportunity.findMany({ where: { ...opportunityWhere, ownerMembershipId: row.ownerMembershipId }, select: { id: true, name: true }, orderBy: { updatedAt: 'desc' }, take: 10 })) });
      for (const row of contracts) groups.push({ kind: 'contract', label: '待出库合同', ownerMembershipId: row.ownerMembershipId, count: row._count, records: (await this.db.erpSalesContract.findMany({ where: { ...contractWhere, ownerMembershipId: row.ownerMembershipId }, select: { id: true, number: true }, orderBy: { updatedAt: 'desc' }, take: 10 })).map(x => ({ id: x.id, name: x.number })) });
    }
    if (ctx.permissions.includes('erp.purchase.read')) {
      const where = { tenantId, status: { in: ['ordered', 'partial_received'] } };
      for (const row of await this.db.erpPurchaseOrder.groupBy({ by: ['createdByMembershipId'], where, _count: true })) groups.push({ kind: 'purchase', label: '待入库采购', ownerMembershipId: row.createdByMembershipId, count: row._count, records: (await this.db.erpPurchaseOrder.findMany({ where: { ...where, createdByMembershipId: row.createdByMembershipId }, select: { id: true, number: true }, orderBy: { updatedAt: 'desc' }, take: 10 })).map(x => ({ id: x.id, name: x.number })) });
    }
    const owners = await this.db.membership.findMany({ where: { tenantId, id: { in: groups.map(x => x.ownerMembershipId) } }, select: { id: true, active: true, user: { select: { name: true } } } });
    return { groups: groups.map(row => ({ ...row, ownerName: owners.find(m => m.id === row.ownerMembershipId)?.user.name ?? '历史成员', ownerActive: owners.find(m => m.id === row.ownerMembershipId)?.active ?? false })), recordLimit: 10, checkedAt: new Date().toISOString() };
  }
}
