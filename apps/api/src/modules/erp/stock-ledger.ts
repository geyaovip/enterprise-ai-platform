import { Prisma } from '../../generated/prisma/client';
import type { RequestContext } from '../platform/context';
import { conflict, failNotFound, storedMoney, type Transaction } from './erp.common';
import { qty } from './trade.common';

export async function warehouse(tx: Transaction, ctx: RequestContext, id?: string) {
 if (id) { const item = await tx.erpWarehouse.findFirst({ where: { id, tenantId: ctx.tenantId, active: true } }); if (!item) failNotFound('有效仓库'); return item; }
 return tx.erpWarehouse.upsert({ where: { tenantId_code: { tenantId: ctx.tenantId, code: 'DEFAULT' } }, create: { tenantId: ctx.tenantId, code: 'DEFAULT', name: '默认仓库' }, update: {} });
}
export async function warehouseBalance(tx: Transaction, ctx: RequestContext, productId: string, warehouseId: string) {
 if (!await tx.erpWarehouseStock.count({ where: { tenantId: ctx.tenantId, productId } })) {
  const global = await tx.erpInventoryBalance.findFirst({ where: { tenantId: ctx.tenantId, productId } });
  const defaultWarehouse = await warehouse(tx, ctx);
  await tx.erpWarehouseStock.upsert({ where: { warehouseId_productId: { warehouseId: defaultWarehouse.id, productId } }, create: { tenantId: ctx.tenantId, warehouseId: defaultWarehouse.id, productId, quantity: global?.quantity ?? 0 }, update: {} });
 }
 return tx.erpWarehouseStock.upsert({ where: { warehouseId_productId: { warehouseId, productId } }, create: { tenantId: ctx.tenantId, warehouseId, productId }, update: {} });
}
export async function stockMove(tx: Transaction, ctx: RequestContext, input: { productId: string; warehouseId?: string; direction: 'in' | 'out'; quantity: number; unitCost?: Prisma.Decimal; costAmount?: Prisma.Decimal; tradeAmount?: Prisma.Decimal; grossAmount?: Prisma.Decimal; costEstimated?: boolean; sourceType: string; sourceId: string; documentId: string }) {
 const wh = await warehouse(tx, ctx, input.warehouseId);
 const balance = await tx.erpInventoryBalance.findFirst({ where: { tenantId: ctx.tenantId, productId: input.productId } });
 if (!balance) failNotFound('商品库存');
 const local = await warehouseBalance(tx, ctx, input.productId, wh.id);
 const amount = qty(input.quantity);
 if (amount <= 0) conflict('库存变动数量必须为正');
 const sign = input.direction === 'in' ? 1 : -1;
 const next = qty(balance.quantity + sign * amount), localNext = qty(local.quantity + sign * amount);
 if (next < 0 || localNext < 0) conflict('所选仓库库存不足，本次操作未提交');
 if (next > 1e9 || localNext > 1e9) conflict('库存数量超过系统范围');
 const average = balance.quantity > 0 ? balance.inventoryValue.div(balance.quantity) : new Prisma.Decimal(0);
 const unitCost = input.direction === 'out' ? average : input.unitCost ?? average;
 const costAmount = input.costAmount ?? (input.direction === 'out' && next === 0 ? balance.inventoryValue : unitCost.mul(amount).toDecimalPlaces(2));
 const nextValue = input.direction === 'in' ? storedMoney(balance.inventoryValue.plus(costAmount)) : balance.inventoryValue.minus(costAmount);
 if (nextValue.lt(0)) conflict('库存成本不一致，请先核对库存');
 const changed = await tx.erpInventoryBalance.updateMany({ where: { id: balance.id, version: balance.version }, data: { quantity: next, inventoryValue: nextValue, costEstimated: next === 0 ? false : balance.costEstimated || Boolean(input.costEstimated)||(input.direction==='in'&&input.sourceType==='stocktake'&&balance.quantity===0&&input.unitCost===undefined), version: { increment: 1 } } });
 if (!changed.count) conflict('库存已变化，请刷新重试');
 const wc = await tx.erpWarehouseStock.updateMany({ where: { id: local.id, version: local.version }, data: { quantity: localNext, version: { increment: 1 } } });
 if (!wc.count) conflict('仓库库存已变化，请刷新重试');
 return tx.erpStockMovement.create({ data: { tenantId: ctx.tenantId, productId: input.productId, warehouseId: wh.id, direction: input.direction, quantity: amount, unitCost: unitCost.toDecimalPlaces(6), costAmount, tradeAmount: input.tradeAmount, grossAmount:input.grossAmount, costEstimated: balance.costEstimated || Boolean(input.costEstimated)||(input.direction==='in'&&input.sourceType==='stocktake'&&balance.quantity===0&&input.unitCost===undefined), sourceType: input.sourceType, sourceId: input.sourceId, documentId: input.documentId, actorMembershipId: ctx.membershipId } });
}
