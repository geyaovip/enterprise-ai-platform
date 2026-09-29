import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../platform/auth.service';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
import { audit, conflict, failNotFound, label, pageQuery } from './erp.common';

const stocktakeInput = z.object({ documentNumber: label(80), note: z.string().max(2000).optional(), lines: z.array(z.object({ productId: z.uuid(), countedQty: z.int().min(0).max(1_000_000_000), version: z.int().positive() })).min(1).max(100) }).refine(x => new Set(x.lines.map(l => l.productId)).size === x.lines.length, '同一商品不能重复');

@Injectable()
export class InventoryService {
  constructor(private readonly db: PrismaService, private readonly auth: AuthService) {}

  async balances(ctx: RequestContext, query: unknown) {
    this.auth.require(ctx, 'erp.inventory.read');
    const q = readBody(pageQuery, query);
    const where = { tenantId: ctx.tenantId, ...(q.q ? { product: { OR: [{ sku: { contains: q.q, mode: 'insensitive' as const } }, { name: { contains: q.q, mode: 'insensitive' as const } }] } } : {}) };
    const [items, total] = await this.db.$transaction([
      this.db.erpInventoryBalance.findMany({ where, include: { product: { select: { id: true, sku: true, name: true, reorderPoint: true, active: true } } }, orderBy: { product: { sku: 'asc' } }, skip: (q.page - 1) * q.page_size, take: q.page_size }),
      this.db.erpInventoryBalance.count({ where }),
    ]);
    return { items: items.map(x => ({ ...x, lowStock: x.quantity <= x.product.reorderPoint })), total, page: q.page, page_size: q.page_size };
  }

  async movements(ctx: RequestContext, query: unknown) {
    this.auth.require(ctx, 'erp.inventory.read');
    const q = readBody(pageQuery, query);
    const where = { tenantId: ctx.tenantId };
    const [items, total] = await this.db.$transaction([
      this.db.erpStockMovement.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.page_size, take: q.page_size }),
      this.db.erpStockMovement.count({ where }),
    ]);
    const products = await this.db.erpProduct.findMany({ where: { tenantId: ctx.tenantId, id: { in: items.map(x => x.productId) } }, select: { id: true, sku: true, name: true } });
    return { items: items.map(x => ({ ...x, product: products.find(p => p.id === x.productId) })), total, page: q.page, page_size: q.page_size };
  }

  async documents(ctx: RequestContext, query: unknown) {
    this.auth.require(ctx, 'erp.inventory.read');
    const q = readBody(pageQuery, query);
    const where = { tenantId: ctx.tenantId };
    const [items, total] = await this.db.$transaction([
      this.db.erpStockDocument.findMany({ where, include: { movements: true }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.page_size, take: q.page_size }),
      this.db.erpStockDocument.count({ where }),
    ]);
    const ids = [...new Set(items.flatMap(x => x.movements.map(m => m.productId)))];
    const products = await this.db.erpProduct.findMany({ where: { tenantId: ctx.tenantId, id: { in: ids } }, select: { id: true, sku: true, name: true } });
    return { items: items.map(x => ({ ...x, movements: x.movements.map(m => ({ ...m, product: products.find(p => p.id === m.productId) })) })), total, page: q.page, page_size: q.page_size };
  }

  async stocktake(ctx: RequestContext, body: unknown) {
    this.auth.require(ctx, 'erp.inventory.write');
    const input = readBody(stocktakeInput, body);
    const balances = await this.db.erpInventoryBalance.findMany({ where: { tenantId: ctx.tenantId, productId: { in: input.lines.map(l => l.productId) } } });
    if (balances.length !== input.lines.length) failNotFound('盘点商品');
    return this.db.$transaction(async tx => {
      const doc = await tx.erpStockDocument.create({ data: { tenantId: ctx.tenantId, number: input.documentNumber, kind: 'stocktake', sourceId: 'inventory', note: input.note, actorMembershipId: ctx.membershipId } });
      const changes: Array<{ productId: string; before: number; after: number }> = [];
      for (const line of input.lines) {
        const old = balances.find(b => b.productId === line.productId)!;
        if (old.version !== line.version) conflict('库存已变化，请刷新后重新盘点');
        const changed = await tx.erpInventoryBalance.updateMany({ where: { tenantId: ctx.tenantId, productId: line.productId, version: line.version }, data: { quantity: line.countedQty, version: { increment: 1 } } });
        if (!changed.count) conflict('库存已变化，请刷新后重新盘点');
        const delta = line.countedQty - old.quantity;
        changes.push({ productId: line.productId, before: old.quantity, after: line.countedQty });
        if (delta) await tx.erpStockMovement.create({ data: { tenantId: ctx.tenantId, productId: line.productId, direction: delta > 0 ? 'in' : 'out', quantity: Math.abs(delta), sourceType: 'stocktake', sourceId: doc.id, documentId: doc.id, actorMembershipId: ctx.membershipId } });
      }
      await audit(tx, ctx, 'erp.inventory.stocktake', 'StockDocument', doc.id, { changes });
      return tx.erpStockDocument.findUniqueOrThrow({ where: { id: doc.id }, include: { movements: true } });
    }, { isolationLevel: 'Serializable' });
  }
}
