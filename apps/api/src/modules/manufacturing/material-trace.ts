import { Prisma } from '../../generated/prisma/client';
import { conflict, type Transaction } from '../erp/erp.common';
import type { ManufacturingErp } from '../erp/manufacturing.contract';
import type { Tracking } from '../erp/warehouse-allocation';
import type { RequestContext } from '../platform/context';

type Bucket = { code: string | null; kind: string | null; quantity: Prisma.Decimal };
const bucketKey = (code: string | null, kind: string | null) => JSON.stringify([code, kind]);

export async function unusedMaterial(tx: Transaction, erp: ManufacturingErp, ctx: RequestContext, orderId: string, productId: string) {
  const [moves, used, requirement] = await Promise.all([
    erp.productionMovements(tx, ctx, orderId, productId),
    tx.manufacturingMaterialUse.findMany({ where: { orderId, productId } }),
    tx.manufacturingRequirement.findUnique({ where: { orderId_productId: { orderId, productId } }, select: { consumed: true } }),
  ]);
  const buckets = new Map<string, Bucket>();
  const add = (code: string | null, kind: string | null, delta: number | Prisma.Decimal) => {
    const key = bucketKey(code, kind);
    const previous = buckets.get(key);
    buckets.set(key, { code, kind, quantity: (previous?.quantity ?? new Prisma.Decimal(0)).plus(delta) });
  };
  for (const m of moves) {
    if (m.sourceType === 'material_issue' || m.sourceType === 'material_return') {
      add(m.trackingCode, m.trackingKind, m.sourceType === 'material_issue' ? m.quantity : -m.quantity);
    }
  }
  for (const u of used) add(u.code, u.kind, u.quantity.negated());
  const recorded = used.reduce((total, row) => total.plus(row.quantity), new Prisma.Decimal(0));
  const legacy = requirement?.consumed.minus(recorded);
  if (legacy?.gt(0)) add(null, null, legacy.negated());
  return buckets;
}

export async function allocateMaterial(tx: Transaction, erp: ManufacturingErp, ctx: RequestContext, orderId: string, productId: string, quantity: Prisma.Decimal) {
  let remaining = quantity;
  const result: Array<Bucket & { productId: string }> = [];
  for (const bucket of (await unusedMaterial(tx, erp, ctx, orderId, productId)).values()) {
    if (bucket.quantity.lte(0)) continue;
    const portion = Prisma.Decimal.min(bucket.quantity, remaining);
    result.push({ ...bucket, productId, quantity: portion });
    remaining = remaining.minus(portion);
    if (remaining.isZero()) break;
  }
  if (!remaining.isZero()) conflict('当前领料批次无法覆盖本次耗用，请核对领退料记录');
  return result;
}

export async function requireReturnable(tx: Transaction, erp: ManufacturingErp, ctx: RequestContext, orderId: string, productId: string, quantity: number, tracking?: Tracking) {
  const buckets = await unusedMaterial(tx, erp, ctx, orderId, productId);
  const bucket = buckets.get(bucketKey(tracking?.code ?? null, tracking?.kind ?? null));
  if (!bucket || bucket.quantity.lt(quantity)) conflict('该批次／序列号的未耗用领料量不足');
}

export async function requireShippable(tx: Transaction, erp: ManufacturingErp, ctx: RequestContext, orderId: string, productId: string, quantity: number, tracking?: Tracking) {
  const moves = await erp.productionMovements(tx, ctx, orderId, productId);
  const balance = moves.filter(m => m.trackingCode === (tracking?.code ?? null) && m.trackingKind === (tracking?.kind ?? null))
    .reduce((n, m) => n + (m.sourceType === 'production_receipt' ? m.quantity : m.sourceType === 'manufacturing_shipment' ? -m.quantity : 0), 0);
  if (quantity > balance) conflict('该批次／序列号不是本订单的可发成品，或已发完');
}
