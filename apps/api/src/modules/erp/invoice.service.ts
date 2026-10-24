import { Injectable } from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import { assertFlowActor, activeFlow } from './workflow.rules';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../platform/auth.service';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
import { audit, conflict, decimal, label, money, notify, ownerFilter, pageQuery } from './erp.common';

const requestInput = z.object({ contractId: z.uuid(), contractVersion: z.int().positive(), amount: money, note: z.string().trim().max(2000).optional() });
const reasonInput = z.object({ reason: label(500) });
const registerInput = z.object({ invoiceNumber: label(100), note: z.string().trim().max(2000).optional() });
const voidInput = z.object({ reason: label(500), voidReference: label(100) });

@Injectable()
export class InvoiceService {
  constructor(private readonly db: PrismaService, private readonly auth: AuthService, private readonly workflows: WorkflowService) {}

  async list(ctx: RequestContext, query: unknown) {
    if (!ctx.permissions.includes('erp.sales.read') && !ctx.permissions.includes('erp.finance.read')) this.auth.require(ctx, 'erp.sales.read');
    const q = readBody(pageQuery.extend({ id: z.uuid().optional() }), query);
    const where = { tenantId: ctx.tenantId, ...(q.id ? { id: q.id } : {}), ...(ctx.roles.includes('sales') ? { contract: { ownerMembershipId: ctx.membershipId } } : {}) };
    const [items, total] = await this.db.$transaction([
      this.db.erpInvoiceRequest.findMany({ where, include: { contract: { select: { number: true, customer: { select: { name: true } } } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.page_size, take: q.page_size }),
      this.db.erpInvoiceRequest.count({ where }),
    ]);
    return { items, total, page: q.page, page_size: q.page_size };
  }

  async request(ctx: RequestContext, body: unknown) {
    this.auth.require(ctx, 'erp.sales.write');
    const input = readBody(requestInput, body);
    const amount = decimal(input.amount);
    if (amount.lte(0)) conflict('申请金额必须大于零');
    return this.db.$transaction(async tx => {
      const contract = await tx.erpSalesContract.findFirst({ where: { id: input.contractId, tenantId: ctx.tenantId, version: input.contractVersion, ...ownerFilter(ctx), status: { in: ['confirmed', 'partial_shipped', 'shipped'] } } });
      if (!contract) conflict('合同状态或版本已变化，请刷新后再申请');
      const reserved = await tx.erpInvoiceRequest.findMany({ where: { tenantId: ctx.tenantId, contractId: contract.id, status: { in: ['requested', 'registered'] } }, select: { amount: true } });
      const remaining = reserved.reduce((sum, row) => sum.minus(row.amount), contract.total);
      if (amount.gt(remaining)) conflict('申请金额超过合同未申请开票金额');
      const locked = await tx.erpSalesContract.updateMany({ where: { id: contract.id, tenantId: ctx.tenantId, version: contract.version, status: { in: ['confirmed', 'partial_shipped', 'shipped'] } }, data: { version: { increment: 1 } } });
      if (!locked.count) conflict('合同已变化，请刷新后再申请');
      const item = await tx.erpInvoiceRequest.create({ data: { tenantId: ctx.tenantId, contractId: contract.id, amount, note: input.note, requestedByMembershipId: ctx.membershipId } });
      await this.workflows.begin(tx,ctx,'invoice',item.id,contract.number,amount,contract.id);
      await audit(tx, ctx, 'erp.invoice.request', 'InvoiceRequest', item.id, { contractId: contract.id, amount: amount.toFixed(2) });
      return item;
    }, { isolationLevel: 'Serializable' });
  }

  async register(ctx: RequestContext, id: string, body: unknown) {
    this.auth.require(ctx, 'erp.finance.write');
    const input = readBody(registerInput, body);
    return this.db.$transaction(async tx => {
      const item = await tx.erpInvoiceRequest.findFirst({ where: { id, tenantId: ctx.tenantId, status: 'requested' } });
      if (!item) conflict('开票申请已处理或不存在');
      if (item.requestedByMembershipId === ctx.membershipId) conflict('申请人不能登记自己的开票申请');
      const changed = await tx.erpInvoiceRequest.updateMany({ where: { id, tenantId: ctx.tenantId, status: 'requested' }, data: { status: 'registered', invoiceNumber: input.invoiceNumber, note: input.note ?? item.note, reviewedByMembershipId: ctx.membershipId, registeredAt: new Date() } });
      if (!changed.count) conflict('开票申请已变化，请刷新');
      await this.workflows.handling(tx,ctx,'invoice',id,true);
      await audit(tx, ctx, 'erp.invoice.register', 'InvoiceRequest', id, { invoiceNumber: input.invoiceNumber, amount: item.amount.toFixed(2), internalOnly: true });
      await notify(tx, ctx.tenantId, item.requestedByMembershipId, `invoice:${id}:register`, '内部开票申请已登记', `金额 ${item.amount.toFixed(2)} 元，内部编号 ${input.invoiceNumber}。`);
      return tx.erpInvoiceRequest.findUniqueOrThrow({ where: { id } });
    }, { isolationLevel: 'Serializable' });
  }

  async reject(ctx: RequestContext, id: string, body: unknown) {
    this.auth.require(ctx, 'erp.finance.write');
    const { reason } = readBody(reasonInput, body);
    return this.db.$transaction(async tx => {
      const item = await tx.erpInvoiceRequest.findFirst({ where: { id, tenantId: ctx.tenantId, status: 'requested' } });
      if (!item) conflict('开票申请已处理或不存在');
      if (item.requestedByMembershipId === ctx.membershipId) conflict('申请人不能审核自己的开票申请');
      const changed = await tx.erpInvoiceRequest.updateMany({ where: { id, tenantId: ctx.tenantId, status: 'requested' }, data: { status: 'rejected', reviewedByMembershipId: ctx.membershipId, reviewReason: reason } });
      if (!changed.count) conflict('开票申请已变化，请刷新');
      await this.workflows.reject(tx,ctx,'invoice',id,reason);
      await audit(tx, ctx, 'erp.invoice.reject', 'InvoiceRequest', id, { reason });
      await notify(tx, ctx.tenantId, item.requestedByMembershipId, `invoice:${id}:reject`, '开票申请已退回', reason);
      return tx.erpInvoiceRequest.findUniqueOrThrow({ where: { id } });
    }, { isolationLevel: 'Serializable' });
  }

  async withdraw(ctx: RequestContext, id: string) {
    this.auth.require(ctx, 'erp.sales.write');
    return this.db.$transaction(async tx => {
      const item = await tx.erpInvoiceRequest.findFirst({ where: { id, tenantId: ctx.tenantId, requestedByMembershipId: ctx.membershipId, status: 'requested' } });
      if (!item) conflict('仅申请人可撤回未登记的申请');
      const changed = await tx.erpInvoiceRequest.updateMany({ where: { id, tenantId: ctx.tenantId, status: 'requested' }, data: { status: 'withdrawn' } });
      if (!changed.count) conflict('开票申请已变化，请刷新');
      await this.workflows.reject(tx,ctx,'invoice',id,'申请人撤回',true);
      await audit(tx, ctx, 'erp.invoice.withdraw', 'InvoiceRequest', id);
      return tx.erpInvoiceRequest.findUniqueOrThrow({ where: { id } });
    }, { isolationLevel: 'Serializable' });
  }

  async voidRegistration(ctx: RequestContext, id: string, body: unknown) {
    this.auth.require(ctx, 'erp.finance.write');
    const { reason, voidReference } = readBody(voidInput, body);
    return this.db.$transaction(async tx => {
      const item = await tx.erpInvoiceRequest.findFirst({ where: { id, tenantId: ctx.tenantId, status: 'registered' } });
      if (!item) conflict('只有已登记申请可记录作废');
      const changed = await tx.erpInvoiceRequest.updateMany({ where: { id, tenantId: ctx.tenantId, status: 'registered' }, data: { status: 'voided', reviewReason: reason, voidReference, reviewedByMembershipId: ctx.membershipId } });
      if (!changed.count) conflict('开票登记已变化，请刷新');
      await audit(tx, ctx, 'erp.invoice.void', 'InvoiceRequest', id, { invoiceNumber: item.invoiceNumber, voidReference, reason, internalOnly: true });
      await notify(tx, ctx.tenantId, item.requestedByMembershipId, `invoice:${id}:void`, '内部开票登记已作废', `金额 ${item.amount.toFixed(2)} 元，作废凭证 ${voidReference}；原因：${reason}`);
      return tx.erpInvoiceRequest.findUniqueOrThrow({ where: { id } });
    }, { isolationLevel: 'Serializable' });
  }
}
