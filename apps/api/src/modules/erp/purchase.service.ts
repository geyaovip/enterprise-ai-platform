import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../platform/auth.service';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
import { audit, conflict, failNotFound, label, pageQuery, positiveQty, storedMoney } from './erp.common';

const orderInput = z.object({ number: label(80), supplierId: z.uuid(), note: z.string().max(2000).optional(), lines: z.array(z.object({ productId: z.uuid(), quantity: positiveQty })).min(1).max(100) }).refine(x => new Set(x.lines.map(l => l.productId)).size === x.lines.length, '同一商品不能重复');
const batchInput = z.object({ version: z.int().positive(), documentNumber: label(80).optional(), note: z.string().max(2000).optional(), lines: z.array(z.object({ lineId: z.uuid(), quantity: positiveQty })).min(1).max(100).optional() }).refine(x => !x.lines || new Set(x.lines.map(l => l.lineId)).size === x.lines.length, '同一明细不能重复');

@Injectable()
export class PurchaseService {
  constructor(private readonly db: PrismaService, private readonly auth: AuthService) {}

  async list(ctx: RequestContext, query: unknown) {
    this.auth.require(ctx, 'erp.purchase.read');
    const q = readBody(pageQuery, query);
    const where = { tenantId: ctx.tenantId };
    const [items, total] = await this.db.$transaction([
      this.db.erpPurchaseOrder.findMany({ where, include: { supplier: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.page_size, take: q.page_size }),
      this.db.erpPurchaseOrder.count({ where }),
    ]);
    return { items, total, page: q.page, page_size: q.page_size };
  }

  async get(ctx: RequestContext, id: string) {
    this.auth.require(ctx, 'erp.purchase.read');
    const item = await this.db.erpPurchaseOrder.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { lines: true, supplier: { select: { id: true, name: true, code: true } }, payable: true } });
    if (!item) failNotFound('采购单');
    return item;
  }

  async create(ctx: RequestContext, body: unknown) {
    this.auth.require(ctx, 'erp.purchase.write');
    const input = readBody(orderInput, body);
    const supplier = await this.db.erpSupplier.findFirst({ where: { id: input.supplierId, tenantId: ctx.tenantId, active: true } });
    if (!supplier) failNotFound('有效供应商');
    const products = await this.db.erpProduct.findMany({ where: { tenantId: ctx.tenantId, id: { in: input.lines.map(l => l.productId) }, active: true } });
    if (products.length !== input.lines.length) failNotFound('有效商品');
    const lines = input.lines.map(x => {
      const product = products.find(p => p.id === x.productId)!;
      return { productId: product.id, sku: product.sku, name: product.name, quantity: x.quantity, unitPrice: product.purchasePrice, lineTotal: storedMoney(product.purchasePrice.mul(x.quantity)) };
    });
    const total = storedMoney(lines.reduce((sum, x) => sum.plus(x.lineTotal), new Prisma.Decimal(0)));
    return this.db.$transaction(async tx => {
      const item = await tx.erpPurchaseOrder.create({ data: { tenantId: ctx.tenantId, number: input.number, supplierId: supplier.id, total, note: input.note, createdByMembershipId: ctx.membershipId, lines: { create: lines } }, include: { lines: true } });
      await audit(tx, ctx, 'erp.purchase.create', 'PurchaseOrder', item.id, { total: total.toFixed(2) });
      return item;
    });
  }

  async confirm(ctx: RequestContext, id: string, body: unknown) {
    this.auth.require(ctx, 'erp.purchase.write');
    const { version } = readBody(z.object({ version: z.int().positive() }), body);
    return this.db.$transaction(async tx => {
      const changed = await tx.erpPurchaseOrder.updateMany({ where: { id, tenantId: ctx.tenantId, status: 'draft', version }, data: { status: 'ordered', version: { increment: 1 } } });
      if (!changed.count) conflict('采购单状态或版本已变化');
      await audit(tx, ctx, 'erp.purchase.confirm', 'PurchaseOrder', id);
      return tx.erpPurchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    });
  }

  async receive(ctx: RequestContext, id: string, body: unknown) {
    this.auth.require(ctx, 'erp.purchase.receive');
    const input = readBody(batchInput, body);
    const order = await this.db.erpPurchaseOrder.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { lines: true } });
    if (!order) failNotFound('采购单');
    if (!['ordered', 'partial_received'].includes(order.status)) conflict('采购单尚未确认或已全部入库');
    const selected = input.lines ?? order.lines.filter(l => l.receivedQty < l.quantity).map(l => ({ lineId: l.id, quantity: l.quantity - l.receivedQty }));
    if (!selected.length) conflict('采购单已全部入库');
    for (const line of selected) {
      const old = order.lines.find(l => l.id === line.lineId);
      if (!old || line.quantity > old.quantity - old.receivedQty) conflict('入库数量超过剩余数量');
    }
    const complete = order.lines.every(l => l.receivedQty + (selected.find(x => x.lineId === l.id)?.quantity ?? 0) === l.quantity);
    const amount = storedMoney(selected.reduce((sum, x) => sum.plus(order.lines.find(l => l.id === x.lineId)!.unitPrice.mul(x.quantity)), new Prisma.Decimal(0)));
    return this.db.$transaction(async tx => {
      const changed = await tx.erpPurchaseOrder.updateMany({ where: { id, tenantId: ctx.tenantId, version: input.version, status: { in: ['ordered', 'partial_received'] } }, data: { status: complete ? 'received' : 'partial_received', version: { increment: 1 } } });
      if (!changed.count) conflict('采购单已变化，请刷新');
      const doc = await tx.erpStockDocument.create({ data: { tenantId: ctx.tenantId, number: input.documentNumber ?? `GRN-${order.number}-${input.version}`, kind: 'receipt', sourceId: id, note: input.note, actorMembershipId: ctx.membershipId } });
      for (const line of selected) {
        const old = order.lines.find(l => l.id === line.lineId)!;
        const updated = await tx.erpPurchaseLine.updateMany({ where: { id: old.id, receivedQty: old.receivedQty }, data: { receivedQty: { increment: line.quantity } } });
        if (!updated.count) conflict('采购明细已变化，请刷新');
        const balance = await tx.erpInventoryBalance.updateMany({ where: { tenantId: ctx.tenantId, productId: old.productId, quantity: { lte: 2_147_483_647 - line.quantity } }, data: { quantity: { increment: line.quantity }, version: { increment: 1 } } });
        if (!balance.count) conflict('库存数量超过系统可处理范围，或商品库存记录不存在');
        await tx.erpStockMovement.create({ data: { tenantId: ctx.tenantId, productId: old.productId, direction: 'in', quantity: line.quantity, sourceType: 'purchase', sourceId: id, documentId: doc.id, actorMembershipId: ctx.membershipId } });
      }
      const account = await tx.erpPayable.findUnique({ where: { orderId: id } });
      if (account) await tx.erpPayable.update({ where: { id: account.id }, data: { amount: storedMoney(account.amount.plus(amount)), status: account.paidAmount.gt(0) ? 'partial' : 'open' } });
      else await tx.erpPayable.create({ data: { tenantId: ctx.tenantId, orderId: id, amount } });
      await audit(tx, ctx, 'erp.purchase.receive', 'PurchaseOrder', id, { documentId: doc.id, amount: amount.toFixed(2), complete });
      return tx.erpPurchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true, payable: true } });
    }, { isolationLevel: 'Serializable' });
  }
}
