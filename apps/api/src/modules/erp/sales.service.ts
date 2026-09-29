import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../platform/auth.service';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
import { audit, conflict, failNotFound, label, ownerFilter, pageQuery, positiveQty, storedMoney } from './erp.common';

const contractInput = z.object({ number: label(80), customerId: z.uuid(), opportunityId: z.uuid().optional(), note: z.string().max(2000).optional(), lines: z.array(z.object({ productId: z.uuid(), quantity: positiveQty })).min(1).max(100) }).refine(x => new Set(x.lines.map(l => l.productId)).size === x.lines.length, '同一商品不能重复');
const shipmentInput = z.object({ version: z.int().positive(), documentNumber: label(80).optional(), note: z.string().max(2000).optional(), lines: z.array(z.object({ lineId: z.uuid(), quantity: positiveQty })).min(1).max(100).optional() }).refine(x => !x.lines || new Set(x.lines.map(l => l.lineId)).size === x.lines.length, '同一明细不能重复');

@Injectable()
export class SalesService {
  constructor(private readonly db: PrismaService, private readonly auth: AuthService) {}

  async list(ctx: RequestContext, query: unknown) {
    this.auth.require(ctx, 'erp.sales.read');
    const q = readBody(pageQuery, query);
    const where = { tenantId: ctx.tenantId, ...ownerFilter(ctx) };
    const [items, total] = await this.db.$transaction([
      this.db.erpSalesContract.findMany({ where, include: { customer: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.page_size, take: q.page_size }),
      this.db.erpSalesContract.count({ where }),
    ]);
    return { items, total, page: q.page, page_size: q.page_size };
  }

  async get(ctx: RequestContext, id: string) {
    this.auth.require(ctx, 'erp.sales.read');
    const item = await this.db.erpSalesContract.findFirst({ where: { id, tenantId: ctx.tenantId, ...ownerFilter(ctx) }, include: { lines: true, customer: { select: { id: true, code: true, name: true } }, receivable: true } });
    if (!item) failNotFound('销售合同');
    return item;
  }

  async create(ctx: RequestContext, body: unknown) {
    this.auth.require(ctx, 'erp.sales.write');
    const input = readBody(contractInput, body);
    const customer = await this.db.erpCustomer.findFirst({ where: { id: input.customerId, tenantId: ctx.tenantId, active: true, ...ownerFilter(ctx) } });
    if (!customer) failNotFound('有效客户');
    if (input.opportunityId) {
      const opportunity = await this.db.erpOpportunity.findFirst({ where: { id: input.opportunityId, tenantId: ctx.tenantId, customerId: customer.id, ...ownerFilter(ctx) } });
      if (!opportunity) failNotFound('客户商机');
    }
    const products = await this.db.erpProduct.findMany({ where: { tenantId: ctx.tenantId, id: { in: input.lines.map(l => l.productId) }, active: true } });
    if (products.length !== input.lines.length) failNotFound('有效商品');
    const lines = input.lines.map(x => {
      const product = products.find(p => p.id === x.productId)!;
      return { productId: product.id, sku: product.sku, name: product.name, quantity: x.quantity, unitPrice: product.salePrice, lineTotal: storedMoney(product.salePrice.mul(x.quantity)) };
    });
    const total = storedMoney(lines.reduce((sum, x) => sum.plus(x.lineTotal), new Prisma.Decimal(0)));
    return this.db.$transaction(async tx => {
      const item = await tx.erpSalesContract.create({ data: { tenantId: ctx.tenantId, number: input.number, customerId: customer.id, opportunityId: input.opportunityId, ownerMembershipId: ctx.membershipId, total, note: input.note, lines: { create: lines } }, include: { lines: true } });
      await audit(tx, ctx, 'erp.contract.create', 'SalesContract', item.id, { total: total.toFixed(2) });
      return item;
    });
  }

  async confirm(ctx: RequestContext, id: string, body: unknown) {
    this.auth.require(ctx, 'erp.sales.write');
    const { version } = readBody(z.object({ version: z.int().positive() }), body);
    return this.db.$transaction(async tx => {
      const changed = await tx.erpSalesContract.updateMany({ where: { id, tenantId: ctx.tenantId, ...ownerFilter(ctx), status: 'draft', version }, data: { status: 'confirmed', version: { increment: 1 } } });
      if (!changed.count) conflict('合同状态或版本已变化');
      await audit(tx, ctx, 'erp.contract.confirm', 'SalesContract', id);
      return tx.erpSalesContract.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    });
  }

  async ship(ctx: RequestContext, id: string, body: unknown) {
    this.auth.require(ctx, 'erp.sales.ship');
    const input = readBody(shipmentInput, body);
    const contract = await this.db.erpSalesContract.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { lines: true } });
    if (!contract) failNotFound('销售合同');
    if (!['confirmed', 'partial_shipped'].includes(contract.status)) conflict('合同尚未确认或已全部出库');
    const selected = input.lines ?? contract.lines.filter(l => l.shippedQty < l.quantity).map(l => ({ lineId: l.id, quantity: l.quantity - l.shippedQty }));
    if (!selected.length) conflict('合同已全部出库');
    for (const line of selected) {
      const old = contract.lines.find(l => l.id === line.lineId);
      if (!old || line.quantity > old.quantity - old.shippedQty) conflict('出库数量超过剩余数量');
    }
    const complete = contract.lines.every(l => l.shippedQty + (selected.find(x => x.lineId === l.id)?.quantity ?? 0) === l.quantity);
    const amount = storedMoney(selected.reduce((sum, x) => sum.plus(contract.lines.find(l => l.id === x.lineId)!.unitPrice.mul(x.quantity)), new Prisma.Decimal(0)));
    return this.db.$transaction(async tx => {
      const changed = await tx.erpSalesContract.updateMany({ where: { id, tenantId: ctx.tenantId, version: input.version, status: { in: ['confirmed', 'partial_shipped'] } }, data: { status: complete ? 'shipped' : 'partial_shipped', version: { increment: 1 } } });
      if (!changed.count) conflict('合同已变化，请刷新');
      const doc = await tx.erpStockDocument.create({ data: { tenantId: ctx.tenantId, number: input.documentNumber ?? `DN-${contract.number}-${input.version}`, kind: 'shipment', sourceId: id, note: input.note, actorMembershipId: ctx.membershipId } });
      for (const line of selected) {
        const old = contract.lines.find(l => l.id === line.lineId)!;
        const balance = await tx.erpInventoryBalance.updateMany({ where: { tenantId: ctx.tenantId, productId: old.productId, quantity: { gte: line.quantity } }, data: { quantity: { decrement: line.quantity }, version: { increment: 1 } } });
        if (!balance.count) conflict(`${old.name}库存不足，本批未出库`);
        const updated = await tx.erpSalesLine.updateMany({ where: { id: old.id, shippedQty: old.shippedQty }, data: { shippedQty: { increment: line.quantity } } });
        if (!updated.count) conflict('合同明细已变化，请刷新');
        await tx.erpStockMovement.create({ data: { tenantId: ctx.tenantId, productId: old.productId, direction: 'out', quantity: line.quantity, sourceType: 'contract', sourceId: id, documentId: doc.id, actorMembershipId: ctx.membershipId } });
      }
      const account = await tx.erpReceivable.findUnique({ where: { contractId: id } });
      if (account) await tx.erpReceivable.update({ where: { id: account.id }, data: { amount: storedMoney(account.amount.plus(amount)), status: account.paidAmount.gt(0) ? 'partial' : 'open' } });
      else await tx.erpReceivable.create({ data: { tenantId: ctx.tenantId, contractId: id, amount } });
      await audit(tx, ctx, 'erp.contract.ship', 'SalesContract', id, { documentId: doc.id, amount: amount.toFixed(2), complete });
      return tx.erpSalesContract.findUniqueOrThrow({ where: { id }, include: { lines: true, receivable: true } });
    }, { isolationLevel: 'Serializable' });
  }
}
