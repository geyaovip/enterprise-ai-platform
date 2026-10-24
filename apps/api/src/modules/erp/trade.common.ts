import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { assignedReviewAllowed, type ApprovalConfig, conflict, label, money, positiveQty, storedMoney, type Transaction } from './erp.common';
import type { RequestContext } from '../platform/context';

export const tradeLineInput = z.object({ productId: z.uuid(), quantity: positiveQty, unitPrice: money.optional(), discountPercent: z.number().min(0).max(100).default(0), taxRate: z.number().min(0).max(100).default(0), taxIncluded: z.boolean().default(true), unit: label(20).optional(), unitFactor: z.number().positive().max(1000000).default(1) });
export const tradeTermsInput = { dueAt: z.iso.datetime().optional(), deliveryAt: z.iso.datetime().optional(), deliveryAddress: z.string().trim().max(500).optional(), paymentTerms: z.string().trim().max(500).optional() };
export function qty(value: number) { return Math.round(value * 1000000) / 1000000; }
export function terms(input: { dueAt?: string; deliveryAt?: string; deliveryAddress?: string; paymentTerms?: string }, paymentDays = 0) {
 return { dueAt: input.dueAt ? new Date(input.dueAt) : paymentDays ? new Date(Date.now() + paymentDays * 86400000) : null, deliveryAt: input.deliveryAt ? new Date(input.deliveryAt) : null, deliveryAddress: input.deliveryAddress ?? null, paymentTerms: input.paymentTerms ?? null };
}
export function pricedLine(product: { id: string; sku: string; name: string; unit: string }, input: z.infer<typeof tradeLineInput>, defaultPrice: Prisma.Decimal) {
 const basePrice = new Prisma.Decimal(input.unitPrice ?? defaultPrice);
 const quantity = qty(input.quantity * input.unitFactor);
 if (quantity <= 0 || quantity > 1e9 || Math.abs(input.quantity * input.unitFactor - quantity) > 1e-8) conflict('单位换算后的数量须在范围内且不超过六位小数');
 if (input.unit && input.unit !== product.unit && input.unitFactor === 1) conflict('使用不同单位时需填写明确的换算因子');
 const discounted = basePrice.mul(new Prisma.Decimal(100).minus(input.discountPercent)).div(100);
 const gross = input.taxIncluded ? discounted : discounted.mul(new Prisma.Decimal(1).plus(new Prisma.Decimal(input.taxRate).div(100)));
 const unitPrice = gross.div(input.unitFactor).toDecimalPlaces(6);
 if(unitPrice.gt('999999999999999999.999999'))conflict('换算后的基础单价超过范围');
 return { productId: product.id, sku: product.sku, name: product.name, quantity, basePrice, discountPercent: new Prisma.Decimal(input.discountPercent), taxRate: new Prisma.Decimal(input.taxRate), taxIncluded: input.taxIncluded, unit: input.unit ?? product.unit, baseUnit: product.unit, unitFactor: input.unitFactor, unitPrice, lineTotal: storedMoney(unitPrice.mul(quantity).toDecimalPlaces(2)) };
}
export function accountStatus(amount: Prisma.Decimal, paid: Prisma.Decimal) { return paid.gt(amount) ? 'credit' : paid.eq(amount) ? 'paid' : paid.gt(0) ? 'partial' : 'open'; }

export async function checkApprover(tx: Transaction, ctx: RequestContext, kind: 'purchase' | 'sales',amount?:Prisma.Decimal) {
 const settings = await tx.erpBusinessSettings.findUnique({ where: { tenantId: ctx.tenantId } });
 const config=(settings?.approvalConfig??{})as ApprovalConfig;
 if(!assignedReviewAllowed(config,ctx,kind,amount))conflict('当前账号不是此金额范围的企业审核人');
}

export function batchMoney(line: {unitPrice:Prisma.Decimal;taxRate:Prisma.Decimal}, before:number, added:number, net=false) {
 const price=net?line.unitPrice.div(new Prisma.Decimal(1).plus(line.taxRate.div(100))):line.unitPrice;
 return price.mul(qty(before+added)).toDecimalPlaces(2).minus(price.mul(before).toDecimalPlaces(2));
}
export const unitMoney=z.string().regex(/^(0|[1-9]\d{0,17})(\.\d{1,6})?$/,'单价最多六位小数');
