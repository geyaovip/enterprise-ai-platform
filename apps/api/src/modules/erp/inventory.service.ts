import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../platform/auth.service';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
import { audit, conflict, failNotFound, label, pageQuery, dateFilter } from './erp.common';
import { stockMove, warehouse, warehouseBalance } from './stock-ledger';
import { qty } from './trade.common';

const stocktakeInput = z.object({ warehouseId: z.uuid().optional(), documentNumber: label(80), note: z.string().max(2000).optional(), lines: z.array(z.object({ productId: z.uuid(), countedQty: z.number().min(0).refine(x => Math.abs(x * 1000000 - Math.round(x * 1000000)) < 0.000001, "数量最多六位小数").max(1_000_000_000), version: z.int().positive() })).min(1).max(100) }).refine(x => new Set(x.lines.map(l => l.productId)).size === x.lines.length, '同一商品不能重复');

@Injectable()
export class InventoryService {
  constructor(private readonly db: PrismaService, private readonly auth: AuthService) {}

  async alerts(ctx: RequestContext, query: unknown) {
    this.auth.require(ctx, 'erp.inventory.read');
    const q = readBody(pageQuery.extend({ status: z.enum(['active', 'all']).default('active') }), query);
    const balances = await this.db.erpInventoryBalance.findMany({
      where: { tenantId: ctx.tenantId, product: { active: true, reorderPoint: { gt: 0 } } },
      include: { product: { select: { id: true, sku: true, name: true, unit:true, reorderPoint: true } } },
      orderBy: { product: { sku: 'asc' } },
    });
    const visible = q.status === 'active' ? balances.filter(x => x.quantity <= x.product.reorderPoint) : balances;
    const page = visible.slice((q.page - 1) * q.page_size, q.page * q.page_size);
    const productIds = page.map(x => x.productId);
    const [openLines, receipts] = await Promise.all([
      this.db.erpPurchaseLine.findMany({
        where: { productId: { in: productIds }, order: { tenantId: ctx.tenantId, status: { in: ['ordered', 'partial_received'] } } },
        select: { productId: true, quantity: true, receivedQty: true, order: { select: { id: true, number: true } } },
      }),
      this.db.erpStockMovement.findMany({
        where: { tenantId: ctx.tenantId, productId: { in: productIds }, sourceType: 'purchase' },
        select: { productId: true, quantity: true, createdAt: true, document: { select: { number: true } }, sourceId: true },
        orderBy: { createdAt: 'desc' },
        distinct: ['productId'],
      }),
    ]);
    const orderIds = [...new Set(receipts.map(x => x.sourceId))];
    const receiptOrders = await this.db.erpPurchaseOrder.findMany({ where: { tenantId: ctx.tenantId, id: { in: orderIds } }, select: { id: true, number: true } });
    const items = page.map(balance => {
      const pending = openLines.filter(x => x.productId === balance.productId).map(x => ({ id: x.order.id, number: x.order.number, remainingQty: x.quantity - x.receivedQty }));
      const incomingQty = pending.reduce((sum, x) => sum + x.remainingQty, 0);
      const shortfallQty = Math.max(0, balance.product.reorderPoint + 1 - balance.quantity);
      const latest = receipts.find(x => x.productId === balance.productId);
      const receiptOrder = latest && receiptOrders.find(x => x.id === latest.sourceId);
      return {
        productId: balance.productId, sku: balance.product.sku, name: balance.product.name, unit:balance.product.unit,
        quantity: balance.quantity, reorderPoint: balance.product.reorderPoint, balanceVersion: balance.version,
        status: shortfallQty === 0 ? 'normal' : incomingQty >= shortfallQty ? 'awaiting_receipt' : 'needs_purchase',
        shortfallQty, incomingQty, suggestedOrderQty: Math.max(0, shortfallQty - incomingQty), pendingOrders: pending,
        latestReceipt: latest && receiptOrder ? { documentNumber: latest.document.number, purchaseId: receiptOrder.id, purchaseNumber: receiptOrder.number, quantity: latest.quantity, createdAt: latest.createdAt } : null,
      };
    });
    return { items, total: visible.length, page: q.page, page_size: q.page_size };
  }

  async balances(ctx: RequestContext, query: unknown) {
    this.auth.require(ctx, 'erp.inventory.read');
    const q = readBody(pageQuery.extend({warehouseId:z.uuid().optional()}), query);
    const where = { tenantId: ctx.tenantId, ...(q.q ? { product: { OR: [{ sku: { contains: q.q, mode: 'insensitive' as const } }, { name: { contains: q.q, mode: 'insensitive' as const } }] } } : {}) };
    const [items, total] = await this.db.$transaction([
      this.db.erpInventoryBalance.findMany({ where, include: { product: { select: { id: true, sku: true, name: true, unit:true, reorderPoint: true, active: true } } }, orderBy: { product: { sku: 'asc' } }, skip: (q.page - 1) * q.page_size, take: q.page_size }),
      this.db.erpInventoryBalance.count({ where }),
    ]);
    if(q.warehouseId&&!await this.db.erpWarehouse.findFirst({where:{tenantId:ctx.tenantId,id:q.warehouseId,active:true}}))failNotFound('有效仓库');
    const localStocks=q.warehouseId?await this.db.erpWarehouseStock.findMany({where:{tenantId:ctx.tenantId,warehouseId:q.warehouseId,productId:{in:items.map(i=>i.productId)}}}):[];
    const allStocks=q.warehouseId?await this.db.erpWarehouseStock.findMany({where:{tenantId:ctx.tenantId,productId:{in:items.map(i=>i.productId)}}}):[];
    const defaultWarehouse=q.warehouseId?await this.db.erpWarehouse.findFirst({where:{tenantId:ctx.tenantId,code:'DEFAULT'}}):null;
    const reservations=await this.db.erpSalesLine.findMany({where:{productId:{in:items.map(x=>x.productId)},contract:{tenantId:ctx.tenantId,status:{in:['confirmed','partial_shipped']}}},select:{productId:true,quantity:true,shippedQty:true}});
    return { items: items.map(x => ({ ...x, warehouseQuantity:q.warehouseId?(localStocks.find(l=>l.productId===x.productId)?.quantity??(defaultWarehouse?.id===q.warehouseId&&!allStocks.some(l=>l.productId===x.productId)?x.quantity:0)):null, reservedQty:qty(reservations.filter(l=>l.productId===x.productId).reduce((n,l)=>n+l.quantity-l.shippedQty,0)),availableQty:qty(x.quantity-reservations.filter(l=>l.productId===x.productId).reduce((n,l)=>n+l.quantity-l.shippedQty,0)), lowStock: x.product.active && x.product.reorderPoint > 0 && x.quantity <= x.product.reorderPoint })), total, page: q.page, page_size: q.page_size };
  }

  async movements(ctx: RequestContext, query: unknown) {
    this.auth.require(ctx, 'erp.inventory.read');
    const q = readBody(pageQuery, query);
    const where = { tenantId: ctx.tenantId,...dateFilter(q),...(q.q?{document:{number:{contains:q.q,mode:'insensitive' as const}}}:{}) };
    const [items, total] = await this.db.$transaction([
      this.db.erpStockMovement.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.page_size, take: q.page_size }),
      this.db.erpStockMovement.count({ where }),
    ]);
    const products = await this.db.erpProduct.findMany({ where: { tenantId: ctx.tenantId, id: { in: items.map(x => x.productId) } }, select: { id: true, sku: true, name: true, unit:true } });
    return { items: items.map(x => ({ ...x, product: products.find(p => p.id === x.productId) })), total, page: q.page, page_size: q.page_size };
  }

  async documents(ctx: RequestContext, query: unknown) {
    this.auth.require(ctx, 'erp.inventory.read');
    const q = readBody(pageQuery, query);
    const where = { tenantId: ctx.tenantId,...dateFilter(q),...(q.q?{number:{contains:q.q,mode:'insensitive' as const}}:{}),...(q.status?{kind:q.status}:{}) };
    const [items, total] = await this.db.$transaction([
      this.db.erpStockDocument.findMany({ where, include: { movements: true }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.page_size, take: q.page_size }),
      this.db.erpStockDocument.count({ where }),
    ]);
    const ids = [...new Set(items.flatMap(x => x.movements.map(m => m.productId)))];
    const products = await this.db.erpProduct.findMany({ where: { tenantId: ctx.tenantId, id: { in: ids } }, select: { id: true, sku: true, name: true, unit:true } });
    return { items: items.map(x => ({ ...x, movements: x.movements.map(m => ({ ...m, product: products.find(p => p.id === m.productId) })) })), total, page: q.page, page_size: q.page_size };
  }

  async stocktake(ctx: RequestContext, body: unknown) {
    this.auth.require(ctx, 'erp.inventory.write');
    const input = readBody(stocktakeInput, body);
    const balances = await this.db.erpInventoryBalance.findMany({ where: { tenantId: ctx.tenantId, productId: { in: input.lines.map(l => l.productId) } } });
    if (balances.length !== input.lines.length) failNotFound('盘点商品');
    return this.db.$transaction(async tx => {
      const currentBalances=await tx.erpInventoryBalance.findMany({where:{tenantId:ctx.tenantId,productId:{in:input.lines.map(l=>l.productId)}}});
      const doc = await tx.erpStockDocument.create({ data: { tenantId: ctx.tenantId, number: input.documentNumber, kind: 'stocktake', sourceId: 'inventory', note: input.note, actorMembershipId: ctx.membershipId } });
      const changes: Array<{ productId: string; before: number; after: number }> = [];
      for (const line of input.lines) {
        const old = currentBalances.find(b => b.productId === line.productId);
        if(!old)failNotFound('盘点商品');
        if (old.version !== line.version) conflict('库存已变化，请刷新后重新盘点');
        const wh = await warehouse(tx, ctx, input.warehouseId);
        const local = await warehouseBalance(tx, ctx, line.productId, wh.id);
        const delta = qty(line.countedQty - local.quantity);
        changes.push({ productId: line.productId, before: local.quantity, after: line.countedQty });
        if (delta) await stockMove(tx, ctx, { productId: line.productId, warehouseId: wh.id, direction: delta > 0 ? 'in' : 'out', quantity: Math.abs(delta), sourceType: 'stocktake', sourceId: doc.id, documentId: doc.id });

      }
      await audit(tx, ctx, 'erp.inventory.stocktake', 'StockDocument', doc.id, { changes });
      return tx.erpStockDocument.findUniqueOrThrow({ where: { id: doc.id }, include: { movements: true } });
    }, { isolationLevel: 'Serializable' });
  }
}
