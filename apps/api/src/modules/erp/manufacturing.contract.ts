import { BusinessService } from './business.service';
import { InventoryService } from './inventory.service';
import { lockStock, type Tracking } from './warehouse-allocation';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { RequestContext } from '../platform/context';
import { CorrectionService } from './correction.service';
import { MasterService } from './master.service';
import { PurchaseService } from './purchase.service';
import { audit, conflict, failNotFound, type Transaction } from './erp.common';
import { stockMove, warehouse, warehouseBalance } from './stock-ledger';
import { qty } from './trade.common';

export type ProductionMovement = 'material_issue' | 'material_return' | 'production_receipt' | 'manufacturing_shipment';

@Injectable()
export class ManufacturingErp {
  constructor(private readonly master: MasterService, private readonly purchase: PurchaseService, private readonly correction: CorrectionService,
    private readonly business: BusinessService, private readonly inventory: InventoryService) {}

  async catalog(tx: Transaction, ctx: RequestContext, q: string) {
    const base = { tenantId: ctx.tenantId, active: true };
    const match = (field: 'code' | 'sku') => q ? { OR: [
      { [field]: { contains: q, mode: 'insensitive' as const } },
      { name: { contains: q, mode: 'insensitive' as const } },
    ] } : {};
    const [customers, suppliers, warehouses, products] = await Promise.all([
      tx.erpCustomer.findMany({ where: { ...base, ...match('code') }, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' }, take: 100 }),
      tx.erpSupplier.findMany({ where: { ...base, ...match('code') }, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' }, take: 100 }),
      tx.erpWarehouse.findMany({ where: base, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' }, take: 100 }),
      tx.erpProduct.findMany({ where: { ...base, ...match('sku') }, select: { id: true, sku: true, name: true, unit: true }, orderBy: { sku: 'asc' }, take: 100 }),
    ]);
    return { customers, suppliers, warehouses, products };
  }

  createParty(tx: Transaction, ctx: RequestContext, kind: 'customer' | 'supplier', input: { code: string; name: string }) {
    return kind === 'customer' ? this.master.createCustomer(ctx, input, tx) : this.master.createSupplier(ctx, input, tx);
  }
  createProduct(tx: Transaction, ctx: RequestContext, input: { sku: string; name: string; unit: string; salePrice: string; purchasePrice: string }) {
    return this.master.createProduct(ctx, input, tx);
  }
  async product(tx: Transaction, ctx: RequestContext, id: string) {
    const product = await tx.erpProduct.findFirst({ where: { tenantId: ctx.tenantId, id, active: true } });
    if (!product) failNotFound('有效商品');
    return product;
  }
  async customer(tx: Transaction, ctx: RequestContext, id: string) {
    const customer = await tx.erpCustomer.findFirst({ where: { tenantId: ctx.tenantId, id, active: true } });
    if (!customer) failNotFound('有效客户');
    return customer;
  }
  warehouse = warehouse;

  warehouseDetails(tx: Transaction, ctx: RequestContext, id: string) {
    return tx.erpWarehouse.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { id: true, name: true } });
  }

  async requiresPurchaseSubmission(tx: Transaction, ctx: RequestContext) {
    const settings = await tx.erpBusinessSettings.findUnique({ where: { tenantId: ctx.tenantId } });
    const workflow = settings?.workflowConfig as Record<string, unknown> | null;
    const approvals = settings?.approvalConfig as { purchase?: string[]; purchaseHigh?: { members?: string[] } } | null;
    return Boolean(workflow?.purchase || approvals?.purchase?.length || approvals?.purchaseHigh?.members?.length);
  }

  async balances(tx: Transaction, ctx: RequestContext, warehouseId: string, productIds: string[]) {
    const where = { tenantId: ctx.tenantId, productId: { in: productIds } };
    const [local, global, wh] = await Promise.all([
      tx.erpWarehouseStock.findMany({ where, select: { productId: true, warehouseId: true, quantity: true } }),
      tx.erpInventoryBalance.findMany({ where, select: { productId: true, quantity: true } }),
      tx.erpWarehouse.findFirst({ where: { tenantId: ctx.tenantId, id: warehouseId }, select: { code: true } }),
    ]);
    const withStock = new Set(local.map(x => x.productId));
    const amounts = new Map(local.filter(x => x.warehouseId === warehouseId).map(x => [x.productId, x.quantity]));
    if (wh?.code === 'DEFAULT') {
      for (const entry of global) if (!withStock.has(entry.productId)) amounts.set(entry.productId, entry.quantity);
    }
    return amounts;
  }

  async held(tx: Transaction, ctx: RequestContext, warehouseId: string, productIds: string[]) {
    return tx.erpStockHold.findMany({ where: { tenantId: ctx.tenantId, warehouseId, productId: { in: productIds } } });
  }

  async setHold(tx: Transaction, ctx: RequestContext, input: { warehouseId: string; productId: string; orderId: string; quantity: number }) {
    await lockStock(tx, ctx.tenantId);
    await this.warehouse(tx, ctx, input.warehouseId);
    await this.product(tx, ctx, input.productId);
    const { orderId, quantity, ...rest } = input;
    const key = { tenantId: ctx.tenantId, ...rest };
    const balance = await warehouseBalance(tx, ctx, input.productId, input.warehouseId);
    const others = await tx.erpStockHold.aggregate({ where: { ...key, orderId: { not: orderId } }, _sum: { quantity: true } });
    if (qty(balance.quantity - Number(others._sum.quantity ?? 0)) < quantity && quantity !== 0) conflict('仓库可锁库存不足');
    const where = { tenantId_warehouseId_productId_orderId: { ...key, orderId } };
    if (quantity === 0) await tx.erpStockHold.deleteMany({ where: { ...key, orderId } });
    else await tx.erpStockHold.upsert({ where, create: { ...key, orderId, quantity }, update: { quantity } });
    // Include allocation changes in optimistic stock versions used by existing inventory writers.
    await tx.erpWarehouseStock.update({ where: { id: balance.id }, data: { version: { increment: 1 } } });
    await tx.erpInventoryBalance.update({ where: { productId: input.productId }, data: { version: { increment: 1 } } });
  }

  warehouses(tx: Transaction, ctx: RequestContext) {
    return tx.erpWarehouse.findMany({ where: { tenantId: ctx.tenantId, active: true },
      select: { id: true, name: true, code: true }, orderBy: { code: 'asc' } });
  }

  async warehouseStock(tx: Transaction, ctx: RequestContext, warehouseId: string, query: { q: string; page: number; alerts: boolean }) {
    await this.warehouse(tx, ctx, warehouseId);
    const base = { tenantId: ctx.tenantId, active: true, ...(query.q ? { OR: [
      { sku: { contains: query.q, mode: 'insensitive' as const } },
      { name: { contains: query.q, mode: 'insensitive' as const } },
    ] } : {}) };
    const where = { ...base, ...(query.alerts ? { reorderPoint: { gt: 0 } } : {}) };
    const products = await tx.erpProduct.findMany({ where, select: {
      id: true, sku: true, name: true, unit: true, reorderPoint: true, balance: { select: { version: true } },
    }, orderBy: { sku: 'asc' }, ...(query.alerts ? {} : { skip: (query.page - 1) * 25, take: 25 }) });
    const ids = products.map(p => p.id);
    const [balances, holds] = await Promise.all([
      this.balances(tx, ctx, warehouseId, ids), this.held(tx, ctx, warehouseId, ids),
    ]);
    const locked = new Map<string, number>();
    for (const h of holds) locked.set(h.productId, qty((locked.get(h.productId) ?? 0) + Number(h.quantity)));
    const rows = products.map(({ balance, ...product }) => {
      const physical = balances.get(product.id) ?? 0, reserved = locked.get(product.id) ?? 0;
      const available = qty(physical - reserved);
      return { ...product, physical, reserved, available, version: balance?.version ?? null,
        low: product.reorderPoint > 0 && available <= product.reorderPoint };
    });
    const result = query.alerts ? rows.filter(row => row.low) : rows;
    return { items: query.alerts ? result.slice((query.page - 1) * 25, query.page * 25) : result,
      total: query.alerts ? result.length : await tx.erpProduct.count({ where }), page: query.page, page_size: 25 };
  }

  async replenishmentNeed(tx: Transaction, ctx: RequestContext, warehouseId: string, productId: string, purchases: Awaited<ReturnType<ManufacturingErp['purchases']>>) {
    await lockStock(tx, ctx.tenantId);
    const product = await this.product(tx, ctx, productId);
    const [stock, holds] = await Promise.all([this.balances(tx, ctx, warehouseId, [productId]), this.held(tx, ctx, warehouseId, [productId])]);
    const available = qty((stock.get(productId) ?? 0) - holds.reduce((n, h) => n + Number(h.quantity), 0));
    return safetyReplenishment(productId, product.reorderPoint, available, purchases);
  }

  saveWarehouse(tx: Transaction, ctx: RequestContext, input: { code: string; name: string }) {
    return this.business.saveWarehouse(ctx, input, tx);
  }

  transfer(tx: Transaction, ctx: RequestContext, input: unknown) {
    return this.business.transfer({ ...ctx, permissions: ['erp.inventory.write'] }, input, tx);
  }

  stocktake(tx: Transaction, ctx: RequestContext, input: unknown) {
    return this.inventory.stocktake({ ...ctx, permissions: ['erp.inventory.write'] }, input, tx);
  }

  async threshold(tx: Transaction, ctx: RequestContext, productId: string, reorderPoint: number) {
    await this.product(tx, ctx, productId);
    const result = await tx.erpProduct.update({ where: { id: productId }, data: { reorderPoint }, select: { id: true, reorderPoint: true } });
    await audit(tx, ctx, 'erp.product.reorder_point', 'Product', productId, { reorderPoint });
    return result;
  }

  async scan(tx: Transaction, ctx: RequestContext, code: string) {
    const where = { tenantId: ctx.tenantId, trackingCode: code };
    const [stock, movements, total] = await Promise.all([
      tx.erpTrackedStock.findMany({ where: { tenantId: ctx.tenantId, code, quantity: { gt: 0 } }, take: 100 }),
      tx.erpStockMovement.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100,
        select: { id: true, warehouseId: true, productId: true, trackingCode: true, trackingKind: true, direction: true, quantity: true,
          sourceType: true, sourceId: true, createdAt: true, document: { select: { id: true, number: true } } } }),
      tx.erpStockMovement.count({ where }),
    ]);
    const ids = [...new Set([...stock, ...movements].map(row => row.productId))];
    const products = await this.traceProducts(tx, ctx, ids);
    const warehouses = await tx.erpWarehouse.findMany({ where: { tenantId: ctx.tenantId, id: { in: [...new Set(
      [...stock, ...movements].flatMap(row => row.warehouseId ? [row.warehouseId] : []),
    )] } }, select: { id: true, name: true } });
    return { code, stock, movements, total, products, warehouses };
  }

  traceProducts(tx: Transaction, ctx: RequestContext, ids: string[]) {
    return tx.erpProduct.findMany({ where: { tenantId: ctx.tenantId, id: { in: ids } },
      select: { id: true, sku: true, name: true, unit: true } });
  }

  traceOutputs(tx: Transaction, ctx: RequestContext, documentIds: string[]) {
    return tx.erpStockDocument.findMany({
      where: { tenantId: ctx.tenantId, kind: 'production_receipt', id: { in: documentIds } },
      select: { id: true, number: true, movements: {
        select: { productId: true, quantity: true, trackingCode: true, trackingKind: true },
      } },
    });
  }

  async productionMovements(tx: Transaction, ctx: RequestContext, orderId: string, productId: string) {
    return tx.erpStockMovement.findMany({ where: { tenantId: ctx.tenantId, sourceId: orderId, productId,
      sourceType: { in: ['material_issue', 'material_return', 'production_receipt', 'manufacturing_shipment'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { trackingCode: true, trackingKind: true, sourceType: true, quantity: true },
    });
  }

  async purchases(tx: Transaction, ctx: RequestContext, ids: string[]) {
    const purchases = await tx.erpPurchaseOrder.findMany({
      where: { tenantId: ctx.tenantId, id: { in: ids } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, number: true, status: true, version: true, createdByMembershipId: true,
        supplier: { select: { name: true } },
        lines: { select: { id: true, sku: true, productId: true, quantity: true, receivedQty: true } } },
    });
    return purchases;
  }
  createPurchase(tx: Transaction, ctx: RequestContext, body: unknown) {
    return this.purchase.createInTransaction(tx, this.purchaseContext(ctx, 'write'), body);
  }
  submitPurchase(tx: Transaction, ctx: RequestContext, id: string, version: number) {
    return this.purchase.submitInTransaction(tx, this.purchaseContext(ctx, 'write'), id, { version });
  }
  approvePurchase(tx: Transaction, ctx: RequestContext, id: string, version: number) {
    return this.purchase.confirmInTransaction(tx, this.purchaseContext(ctx, 'approve'), id, { version });
  }
  receivePurchase(tx: Transaction, ctx: RequestContext, id: string, input: { version: number; warehouseId: string; lines: { lineId: string; quantity: number; tracking?: Tracking }[] }) {
    return this.purchase.receiveInTransaction(tx, this.purchaseContext(ctx, 'receive'), id, input);
  }
  closePurchase(tx: Transaction, ctx: RequestContext, id: string, version: number, reason: string) {
    return this.correction.closeOrderInTransaction(tx, this.purchaseContext(ctx, 'approve'), 'purchase', id, { version, reason });
  }
  private purchaseContext(ctx: RequestContext, action: 'write' | 'approve' | 'receive') {
    return { ...ctx, permissions: [`erp.purchase.${action}`] };
  }

  async post(tx: Transaction, ctx: RequestContext, input: {
    orderId: string; warehouseId: string; kind: ProductionMovement;
    lines: { productId: string; quantity: number; costAmount?: Prisma.Decimal; costEstimated?: boolean; tracking?: Tracking }[];
  }) {
    const direction = input.kind === 'material_issue' || input.kind === 'manufacturing_shipment' ? 'out' : 'in';
    const prefix = { material_issue: 'MI', material_return: 'MR', production_receipt: 'FG', manufacturing_shipment: 'MS' }[input.kind];
    const doc = await tx.erpStockDocument.create({
      data: { tenantId: ctx.tenantId, number: `${prefix}-${ctx.requestId}`.slice(0, 80),
        kind: input.kind, sourceId: input.orderId, actorMembershipId: ctx.membershipId },
    });
    const movements = [];
    for (const line of input.lines) {
      movements.push(await stockMove(tx, ctx, {
        ...line, warehouseId: input.warehouseId, documentId: doc.id, direction, orderId: input.orderId,
        unitCost: line.costAmount?.div(line.quantity), sourceType: input.kind, sourceId: input.orderId,
      }));
    }
    return { ...doc, movements };
  }

  documents(tx: Transaction, ctx: RequestContext, orderId: string, purchaseIds: string[]) {
    return tx.erpStockDocument.findMany({
      where: { tenantId: ctx.tenantId, OR: [
        { sourceId: orderId, kind: { in: ['material_issue', 'material_return', 'production_receipt', 'manufacturing_shipment'] } },
        { sourceId: { in: purchaseIds }, kind: 'receipt' },
      ] },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, number: true, kind: true, sourceId: true, createdAt: true,
        movements: { select: { productId: true, direction: true, quantity: true, warehouseId: true, trackingCode: true, trackingKind: true } } },
    });
  }
}

export const remainingPurchase = (line: { quantity: number; receivedQty: number }) => qty(line.quantity - line.receivedQty);


export function safetyReplenishment(productId: string, reorderPoint: number, available: number,
  purchases: Awaited<ReturnType<ManufacturingErp['purchases']>>) {
  if (reorderPoint <= 0 || available > reorderPoint) return 0;
  const incoming = purchases.filter(p => ['draft', 'pending_approval', 'ordered', 'partial_received'].includes(p.status))
    .flatMap(p => p.lines).filter(l => l.productId === productId).reduce((n, l) => n + remainingPurchase(l), 0);
  return Math.max(0, qty(reorderPoint + 1 - available - incoming));
}
