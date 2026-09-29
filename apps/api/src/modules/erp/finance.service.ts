import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../platform/auth.service';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
import { audit, conflict, decimal, failNotFound, label, money, ownerFilter, pageQuery } from './erp.common';

const paymentInput = z.object({ amount: money, reference: label(100) });

@Injectable()
export class FinanceService {
  constructor(private readonly db: PrismaService, private readonly auth: AuthService) {}

  async receivables(ctx: RequestContext, query: unknown) {
    this.auth.require(ctx, 'erp.finance.read');
    const q = readBody(pageQuery, query);
    const where = { tenantId: ctx.tenantId };
    const [items, total] = await this.db.$transaction([
      this.db.erpReceivable.findMany({ where, include: { contract: { select: { number: true, customerId: true } }, payments: { orderBy: { createdAt: 'desc' } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.page_size, take: q.page_size }),
      this.db.erpReceivable.count({ where }),
    ]);
    return { items, total, page: q.page, page_size: q.page_size };
  }

  async payables(ctx: RequestContext, query: unknown) {
    this.auth.require(ctx, 'erp.finance.read');
    const q = readBody(pageQuery, query);
    const where = { tenantId: ctx.tenantId };
    const [items, total] = await this.db.$transaction([
      this.db.erpPayable.findMany({ where, include: { order: { select: { number: true, supplierId: true } }, payments: { orderBy: { createdAt: 'desc' } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.page_size, take: q.page_size }),
      this.db.erpPayable.count({ where }),
    ]);
    return { items, total, page: q.page, page_size: q.page_size };
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
}
