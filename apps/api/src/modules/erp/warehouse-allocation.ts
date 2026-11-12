import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { conflict, label, type Transaction } from './erp.common';
import { qty } from './trade.common';

export const trackingInput = z.object({ code: label(100), kind: z.enum(['lot', 'serial']) }).strict();
export type Tracking = z.infer<typeof trackingInput>;
export type StockKey = { tenantId: string; warehouseId: string; productId: string };

export async function lockStock(tx: Transaction, tenantId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId + ':erp-stock'}, 0))`;
}

/** Runs under the stock transaction lock, with the ledger still responsible for physical quantities. */
export async function applyAllocation(tx: Transaction, key: StockKey, physical: number, move: {
  direction: 'in' | 'out'; quantity: number; tracking?: Tracking; orderId?: string;
}) {
  const { tracking, orderId, direction, quantity } = move;
  if (direction === 'out') {
    const holds = await tx.erpStockHold.findMany({ where: key });
    const held = holds.reduce((sum, row) => qty(sum + Number(row.quantity)), 0);
    const own = holds.find(row => row.orderId === orderId);
    const consumed = Math.min(quantity, Number(own?.quantity ?? 0));
    if (qty(physical - quantity) < qty(held - consumed)) conflict('可用库存不足，部分库存已为其他制造订单锁定');
    if (!tracking) {
      const tracked = await tx.erpTrackedStock.aggregate({ where: key, _sum: { quantity: true } });
      if (qty(physical - Number(tracked._sum.quantity ?? 0)) < quantity)
        conflict('无批次库存不足，请扫描或选择库存批次／序列号');
    }
    if (own && consumed > 0) {
      const where = { tenantId_warehouseId_productId_orderId: { ...key, orderId: own.orderId } };
      const remaining = own.quantity.minus(consumed);
      if (remaining.isZero()) await tx.erpStockHold.delete({ where });
      else await tx.erpStockHold.update({ where, data: { quantity: remaining } });
    }
  }
  if (!tracking) return;
  if (tracking.kind === 'serial' && quantity !== 1) conflict('序列号每次只能办理 1 件');
  const { code, kind } = tracking;
  const existing = await tx.erpTrackedStock.findMany({ where: { tenantId: key.tenantId, productId: key.productId, code } });
  if (existing.some(row => row.kind !== kind)) conflict('该追溯码已用于另一种追溯类型');
  if (direction === 'in' && kind === 'serial' && existing.some(row => row.quantity.gt(0)))
    conflict('该序列号已在库');
  const current = existing.find(row => row.warehouseId === key.warehouseId);
  const next = (current?.quantity ?? new Prisma.Decimal(0)).plus(direction === 'in' ? quantity : -quantity);
  if (next.lt(0)) conflict('该批次或序列号在所选仓库的库存不足');
  await tx.erpTrackedStock.upsert({
    where: { tenantId_warehouseId_productId_code: { ...key, code } },
    create: { ...key, code, kind, quantity: next },
    update: { quantity: next },
  });
}
