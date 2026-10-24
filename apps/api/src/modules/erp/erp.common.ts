import { ConflictException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import type { RequestContext } from '../platform/context';

export const label = (max = 160) => z.string().trim().min(1).max(max);
export const money = z.string().regex(/^(0|[1-9]\d{0,14})(\.\d{1,2})?$/, '金额必须是非负两位小数');
export const positiveQty = z.number().positive().max(1_000_000_000).refine(x => Math.abs(x * 1000000 - Math.round(x * 1000000)) < 0.000001, "数量最多六位小数");
const maxStoredMoney = new Prisma.Decimal('9999999999999999.99');
export function storedMoney(value: Prisma.Decimal) {
  if (value.gt(maxStoredMoney)) conflict('金额超过系统可处理范围');
  return value.toDecimalPlaces(2);
}
export const pageQuery = z.object({ page: z.coerce.number().int().min(1).default(1), page_size: z.coerce.number().int().min(1).max(100).default(20), q: z.string().trim().max(100).optional(), status: z.string().max(40).optional(), partyId: z.uuid().optional(), ownerId: z.uuid().optional(), from: z.iso.datetime().optional(), to: z.iso.datetime().optional() });
export type Transaction = Prisma.TransactionClient;

export function decimal(input: string) { return new Prisma.Decimal(input); }
export function failNotFound(name: string): never { throw new NotFoundException(`${name}不存在或无权访问`); }
export function conflict(message: string): never { throw new ConflictException(message); }
export function audit(tx: Transaction, ctx: RequestContext, action: string, resourceType: string, resourceId: string, detail?: Prisma.InputJsonValue) {
  return tx.auditEvent.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, membershipId: ctx.membershipId, appId: 'erp', requestId: ctx.requestId, action, resourceType, resourceId, ...(detail === undefined ? {} : { detail }) } });
}
export function ownerFilter(ctx: RequestContext) { return ctx.roles.includes('sales') ? { ownerMembershipId: ctx.membershipId } : {}; }
export function salesReadFilter(ctx:RequestContext){return ctx.roles.includes('sales')&&!ctx.permissions.includes('erp.sales.approve')?{ownerMembershipId:ctx.membershipId}:{};}
export function notify(tx: Transaction, tenantId: string, recipientMembershipId: string, dedupeKey: string, title: string, body: string) {
  return tx.erpNotification.createMany({ data: [{ tenantId, recipientMembershipId, dedupeKey, title, body }], skipDuplicates: true });
}

export async function notifyApprovers(tx: Transaction, ctx: RequestContext, dedupeKey: string, title: string, body: string, amount?:Prisma.Decimal) {
  const settings=await tx.erpBusinessSettings.findUnique({where:{tenantId:ctx.tenantId}});const config=(settings?.approvalConfig??{})as Record<string,unknown>;const kind=dedupeKey.startsWith('contract:')||dedupeKey.startsWith('sales:')?'sales':'purchase';const ids=approvalIds(config as ApprovalConfig,kind,amount);const delegation=config.delegation as {from:string;to:string;until:string}|undefined;const recipients=[...(ids??[])];if(delegation&&new Date(delegation.until)>new Date()&&recipients.includes(delegation.from))recipients.push(delegation.to);
  const members = await tx.membership.findMany({ where: { tenantId: ctx.tenantId, ...(recipients.length?{id:{in:recipients,not:ctx.membershipId}}:{role:'admin',id:{not:ctx.membershipId}}), active: true, user: { active: true } }, select: { id: true } });
  await tx.erpNotification.createMany({ data: members.map(member => ({ tenantId: ctx.tenantId, recipientMembershipId: member.id, dedupeKey, title, body })), skipDuplicates: true });
  return members.map(m=>m.id);
}

export function dateFilter(q: { from?: string; to?: string }) {
 if (q.from && q.to && q.from > q.to) conflict('开始时间不能晚于结束时间');
 return q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {};
}

export function sameJson(a:unknown,b:unknown):boolean {const normalize=(v:unknown):unknown=>Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([,x])=>x!==undefined).sort(([x],[y])=>x.localeCompare(y)).map(([k,x])=>[k,normalize(x)])):v;return JSON.stringify(normalize(a))===JSON.stringify(normalize(b));}

export type ApprovalConfig={purchase?:string[];sales?:string[];purchaseHigh?:{threshold:string;members:string[]};salesHigh?:{threshold:string;members:string[]};delegation?:{from:string;to:string;until:string}};
export function approvalIds(config:ApprovalConfig,kind:'purchase'|'sales',amount?:Prisma.Decimal){const high=config[kind==='sales'?'salesHigh':'purchaseHigh'];return amount&&high&&amount.gte(high.threshold)?high.members:amount===undefined?[...new Set([...(config[kind]??[]),...(high?.members??[])])]:config[kind]??[];}
export function assignedReviewAllowed(config:ApprovalConfig,ctx:RequestContext,kind:'purchase'|'sales',amount?:Prisma.Decimal){const ids=approvalIds(config,kind,amount),d=config.delegation;return !ids.length?ctx.roles.includes('admin'):ids.includes(ctx.membershipId)||Boolean(d&&new Date(d.until)>new Date()&&d.to===ctx.membershipId&&ids.includes(d.from));}
