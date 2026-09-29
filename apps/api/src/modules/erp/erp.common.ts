import { ConflictException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import type { RequestContext } from '../platform/context';

export const label = (max = 160) => z.string().trim().min(1).max(max);
export const money = z.string().regex(/^(0|[1-9]\d{0,14})(\.\d{1,2})?$/, '金额必须是非负两位小数');
export const positiveQty = z.int().positive().max(1_000_000_000);
const maxStoredMoney = new Prisma.Decimal('9999999999999999.99');
export function storedMoney(value: Prisma.Decimal) {
  if (value.gt(maxStoredMoney)) conflict('金额超过系统可处理范围');
  return value;
}
export const pageQuery = z.object({ page: z.coerce.number().int().min(1).default(1), page_size: z.coerce.number().int().min(1).max(100).default(20), q: z.string().trim().max(100).optional() });
export type Transaction = Prisma.TransactionClient;

export function decimal(input: string) { return new Prisma.Decimal(input); }
export function failNotFound(name: string): never { throw new NotFoundException(`${name}不存在或无权访问`); }
export function conflict(message: string): never { throw new ConflictException(message); }
export function audit(tx: Transaction, ctx: RequestContext, action: string, resourceType: string, resourceId: string, detail?: Prisma.InputJsonValue) {
  return tx.auditEvent.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, membershipId: ctx.membershipId, appId: 'erp', requestId: ctx.requestId, action, resourceType, resourceId, ...(detail === undefined ? {} : { detail }) } });
}
export function ownerFilter(ctx: RequestContext) { return ctx.roles.includes('sales') ? { ownerMembershipId: ctx.membershipId } : {}; }
