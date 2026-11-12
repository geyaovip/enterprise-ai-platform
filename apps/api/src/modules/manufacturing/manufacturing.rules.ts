import { trackingInput } from '../erp/warehouse-allocation';
import { z } from 'zod';
import { label, money, positiveQty } from '../erp/erp.common';

const whole = z.int().positive().max(10_000_000);
const materialQty = positiveQty.refine(x => Math.abs(x * 1000 - Math.round(x * 1000)) < 1e-6, '用料数量最多三位小数');
const purchaseLine = z.object({ productId: z.uuid(), quantity: materialQty, unitPrice: money });
const receiptLine = z.object({ lineId: z.uuid(), quantity: materialQty, tracking: trackingInput.optional() });
const distinct = <K extends string>(key: K) => (lines: Record<K, string>[]) => new Set(lines.map(x => x[key])).size === lines.length;

export const listInput = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), q: z.string().trim().max(80).default('') });
export const key = z.object({ requestKey: z.uuid() });
export const partyInput = key.extend({ kind: z.enum(['customer', 'supplier']), code: label(60), name: label() });
export const itemInput = key.extend({
  sku: label(80), name: label(), unit: label(20),
  kind: z.enum(['finished', 'semi', 'raw', 'packaging', 'auxiliary']),
});
export const linkInput = key.extend({ productId: z.uuid(), materialId: z.uuid() });
export const orderInput = key.extend({
  number: label(80), customerId: z.uuid(), materialId: z.uuid(),
  warehouseId: z.uuid().optional(), quantity: whole, dueDate: z.iso.date().optional(), approvalRequired: z.boolean().default(false),
});
export const actionInput = z.discriminatedUnion('action', [
  key.extend({ action: z.literal('purchase'), supplierId: z.uuid(), lines: z.array(purchaseLine).min(1).max(100).refine(distinct('productId'), '采购物料不能重复') }),
  key.extend({ action: z.enum(['submit', 'approve', 'receive']), purchaseId: z.uuid(), version: z.int().positive(), lines: z.array(receiptLine).min(1).max(100).refine(distinct('lineId'), '收货明细不能重复').optional() }),
  key.extend({ action: z.literal('close_purchase'), purchaseId: z.uuid(), version: z.int().positive(), reason: label(500) }),
  key.extend({ action: z.enum(['issue', 'return']), productId: z.uuid(), quantity: materialQty, version: z.int().positive(), tracking: trackingInput.optional() }),
  key.extend({ action: z.enum(['complete', 'ship']), quantity: whole, version: z.int().positive(), tracking: trackingInput.optional() }),
  key.extend({ action: z.literal('review_order'), version: z.int().positive(),
    decision: z.enum(['confirmed', 'rejected']), reason: z.string().trim().max(500).optional() }),
  key.extend({ action: z.literal('hold'), productId: z.uuid(), quantity: z.union([z.literal(0), materialQty]), version: z.int().positive() }),
]);
export type OrderAction = z.infer<typeof actionInput>;
export const actionPermission: Record<OrderAction['action'], string> = {
  purchase: 'manufacturing.buy', submit: 'manufacturing.buy', approve: 'manufacturing.approve',
  close_purchase: 'manufacturing.approve', receive: 'manufacturing.stock', issue: 'manufacturing.stock', return: 'manufacturing.stock',
  complete: 'manufacturing.complete', ship: 'manufacturing.stock', hold: 'manufacturing.stock', review_order: 'manufacturing.setup',
};

export const warehouseQuery = listInput.extend({ warehouseId: z.uuid().optional(), alerts: z.enum(['true', 'false']).default('false') });
const stockCount = z.union([z.literal(0), positiveQty]);
export const warehouseAction = z.discriminatedUnion('action', [
  key.extend({ action: z.literal('replenish'), warehouseId: z.uuid(), supplierId: z.uuid(), line: purchaseLine.extend({quantity: positiveQty}) }),
  key.extend({ action: z.enum(['submit', 'approve', 'receive', 'close_purchase']), warehouseId: z.uuid(),
    purchaseId: z.uuid(), version: z.int().positive(),
    lines: z.array(receiptLine.extend({ quantity: positiveQty })).min(1).max(100).refine(distinct('lineId'), '收货明细不能重复').optional(),
    reason: z.string().trim().max(500).optional() }),
  key.extend({ action: z.literal('warehouse'), code: label(40), name: label(100) }),
  key.extend({ action: z.literal('threshold'), productId: z.uuid(), quantity: stockCount }),
  key.extend({ action: z.literal('transfer'), fromWarehouseId: z.uuid(), toWarehouseId: z.uuid(),
    productId: z.uuid(), quantity: positiveQty, tracking: trackingInput.optional(), note: label(500) }),
  key.extend({ action: z.literal('stocktake'), warehouseId: z.uuid(), productId: z.uuid(),
    quantity: stockCount, version: z.int().positive(), tracking: trackingInput.optional() }),
]);
export const productionAction = z.discriminatedUnion('action', [
  key.extend({ action: z.literal('plan'), startDate: z.iso.date(), dueDate: z.iso.date() }),
  key.extend({ action: z.literal('release'), version: z.int().positive() }),
  key.extend({ action: z.literal('dispatch'), version: z.int().positive(), assigneeId: z.uuid(), quantity: whole, label: label(80) }),
  key.extend({ action: z.literal('cancel_job'), version: z.int().positive(), jobId: z.uuid() }),
  key.extend({ action: z.literal('report'), jobId: z.uuid(), good: z.int().min(0).max(10_000_000), defective: z.int().min(0).max(10_000_000),
    note: z.string().trim().max(500).optional() }),
  key.extend({ action: z.literal('review'), reportId: z.uuid(), decision: z.enum(['approved', 'rejected']), note: z.string().trim().max(500).optional() }),
]);
export const productionPermission: Record<z.infer<typeof productionAction>['action'], string> = {
  plan: 'manufacturing.plan', release: 'manufacturing.plan', dispatch: 'manufacturing.plan',
  cancel_job: 'manufacturing.plan', report: 'manufacturing.report', review: 'manufacturing.review',
};
export const teamInput = key.extend({ membershipId: z.uuid(), role: z.enum(['planner', 'operator', 'supervisor']).nullable() });
