import { Injectable } from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import { assertFlowActor, activeFlow } from './workflow.rules';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../platform/auth.service';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
import { audit, conflict, decimal, failNotFound, label, money, notify, pageQuery, storedMoney } from './erp.common';

const registrationInput = z.object({ customerId: z.uuid(), reference: label(100), amount: money, receivedAt: z.iso.datetime({ offset: true }), note: z.string().trim().max(2000).optional() });
const claimInput = z.object({ version: z.int().positive(), allocations: z.array(z.object({ receivableId: z.uuid(), amount: money })).min(1).max(100) }).refine(x => new Set(x.allocations.map(item => item.receivableId)).size === x.allocations.length, '同一应收不能重复分摊');
const reviewInput = z.object({ version: z.int().positive(), reason: label(500).optional() });
const cancelInput = z.object({ version: z.int().positive(), reason: label(500) });

@Injectable()
export class ReceiptService {
  constructor(private readonly db: PrismaService, private readonly auth: AuthService, private readonly workflows: WorkflowService) {}

  async list(ctx: RequestContext, query: unknown) {
    if (!ctx.permissions.includes('erp.sales.read') && !ctx.permissions.includes('erp.finance.read')) this.auth.require(ctx, 'erp.sales.read');
    const q = readBody(pageQuery.extend({ id: z.uuid().optional() }), query);
    const where = { tenantId: ctx.tenantId, ...(q.id ? { id: q.id } : {}), ...(ctx.roles.includes('sales') ? { customer: { ownerMembershipId: ctx.membershipId } } : {}) };
    const [items, total] = await this.db.$transaction([
      this.db.erpIncomingReceipt.findMany({ where, include: { customer: { select: { name: true } }, claims: { orderBy: { createdAt: 'desc' } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.page_size, take: q.page_size }),
      this.db.erpIncomingReceipt.count({ where }),
    ]);
    return { items, total, page: q.page, page_size: q.page_size };
  }

  async claimable(ctx: RequestContext, id: string) {
    this.auth.require(ctx, 'erp.sales.write');
    const receipt = await this.db.erpIncomingReceipt.findFirst({ where: { id, tenantId: ctx.tenantId, customer: { ownerMembershipId: ctx.membershipId }, status: { in: ['open', 'partial'] } }, select: { id: true, amount: true, allocatedAmount: true, version: true, customerId: true, reference: true } });
    if (!receipt) failNotFound('可认领的到账流水');
    const accounts = await this.db.erpReceivable.findMany({ where: { tenantId: ctx.tenantId, OR:[{contract:{customerId:receipt.customerId,ownerMembershipId:ctx.membershipId}},{contractId:null,customerId:receipt.customerId}],status:{in:['open','partial']} }, select: { id: true, amount: true, paidAmount: true, contract: { select: { number: true } } }, orderBy: { createdAt: 'desc' } });
    return { receipt, accounts: accounts.map(account => ({ id: account.id, contractNumber: account.contract?.number ?? "期初应收", remaining: account.amount.minus(account.paidAmount).toFixed(2) })) };
  }

  async register(ctx: RequestContext, body: unknown) {
    this.auth.require(ctx, 'erp.finance.write');
    const input = readBody(registrationInput, body);
    const amount = decimal(input.amount);
    if (amount.lte(0)) conflict('到账金额必须大于零');
    const receivedAt = new Date(input.receivedAt);
    if (receivedAt.getTime() > Date.now() + 5 * 60_000) conflict('到账时间不能晚于当前时间');
    return this.db.$transaction(async tx => {
      const customer = await tx.erpCustomer.findFirst({ where: { id: input.customerId, tenantId: ctx.tenantId } });
      if (!customer) failNotFound('客户');
      const item = await tx.erpIncomingReceipt.create({ data: { tenantId: ctx.tenantId, customerId: customer.id, reference: input.reference, amount, receivedAt, note: input.note, registeredByMembershipId: ctx.membershipId } });
      await audit(tx, ctx, 'erp.receipt.register', 'IncomingReceipt', item.id, { reference: input.reference, amount: amount.toFixed(2), manualEntry: true });
      return item;
    });
  }

  async claim(ctx: RequestContext, id: string, body: unknown) {
    this.auth.require(ctx, 'erp.sales.write');
    const input = readBody(claimInput, body);
    const allocations = input.allocations.map(item => ({ receivableId: item.receivableId, amount: decimal(item.amount) }));
    if (allocations.some(item => item.amount.lte(0))) conflict('分摊金额必须大于零');
    const amount = storedMoney(allocations.reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0)));
    return this.db.$transaction(async tx => {
      const receipt = await tx.erpIncomingReceipt.findFirst({ where: { id, tenantId: ctx.tenantId, version: input.version, status: { in: ['open', 'partial'] }, customer: { ownerMembershipId: ctx.membershipId } } });
      if (!receipt) conflict('到账流水已变化或不属于当前销售负责客户');
      if (await tx.erpReceiptClaim.count({ where: { tenantId: ctx.tenantId, receiptId: id, status: 'pending' } })) conflict('这笔流水已有待审核认领');
      if (amount.gt(receipt.amount.minus(receipt.allocatedAmount))) conflict('认领金额超过到账未分摊余额');
      const accounts = await tx.erpReceivable.findMany({ where: { tenantId: ctx.tenantId, id: { in: allocations.map(item => item.receivableId) }, OR:[{contract:{customerId:receipt.customerId,ownerMembershipId:ctx.membershipId}},{contractId:null,customerId:receipt.customerId}] }, include: { contract: { select: { number: true } } } });
      if (accounts.length !== allocations.length) failNotFound('同客户应收账款');
      for (const allocation of allocations) {
        const account = accounts.find(item => item.id === allocation.receivableId)!;
        if (allocation.amount.gt(account.amount.minus(account.paidAmount))) conflict('分摊金额超过应收未结余额');
      }
      const locked = await tx.erpIncomingReceipt.updateMany({ where: { id, tenantId: ctx.tenantId, version: input.version, status: { in: ['open', 'partial'] } }, data: { version: { increment: 1 } } });
      if (!locked.count) conflict('到账流水已变化，请刷新');
      const claim = await tx.erpReceiptClaim.create({ data: { tenantId: ctx.tenantId, receiptId: id, baseVersion: input.version + 1, amount, allocations: allocations.map(item => ({ receivableId: item.receivableId, contractNumber: accounts.find(account => account.id === item.receivableId)!.contract?.number ?? "期初应收", amount: item.amount.toFixed(2) })), requestedByMembershipId: ctx.membershipId } });
      await this.workflows.begin(tx,ctx,'receipt',claim.id,receipt.reference,amount,id);
      await audit(tx, ctx, 'erp.receipt.claim', 'ReceiptClaim', claim.id, { receiptId: id, amount: amount.toFixed(2) });
      return claim;
    }, { isolationLevel: 'Serializable' });
  }

  async review(ctx: RequestContext, id: string, claimId: string, decision: 'approve' | 'reject' | 'withdraw', body: unknown) {
    if (decision === 'withdraw') this.auth.require(ctx, 'erp.sales.write'); else this.auth.require(ctx, 'erp.finance.write');
    const input = readBody(reviewInput, body);
    if (decision === 'reject' && !input.reason) conflict('退回认领必须填写原因');
    return this.db.$transaction(async tx => {
      const claim = await tx.erpReceiptClaim.findFirst({ where: { id: claimId, tenantId: ctx.tenantId, receiptId: id, status: 'pending', baseVersion: input.version } });
      if (!claim) conflict('认领申请已处理或版本已变化');
      if (decision === 'withdraw' && claim.requestedByMembershipId !== ctx.membershipId) conflict('只有申请人可撤回认领');
      if (decision !== 'withdraw' && claim.requestedByMembershipId === ctx.membershipId) conflict('申请人不能审核自己的认领');
      const receipt = await tx.erpIncomingReceipt.findFirst({ where: { id, tenantId: ctx.tenantId, version: input.version, status: { in: ['open', 'partial'] } } });
      if (!receipt) conflict('到账流水已变化，请刷新');
      if (decision === 'approve') {
        const requester = await tx.membership.findFirst({ where: { id: claim.requestedByMembershipId, tenantId: ctx.tenantId, active: true, role: 'sales', user: { active: true } } });
        const customer = await tx.erpCustomer.findFirst({ where: { id: receipt.customerId, tenantId: ctx.tenantId, ownerMembershipId: claim.requestedByMembershipId } });
        if (!requester || !customer) conflict('申请人已失去客户负责权限，请退回后由当前负责人重新认领');
        const parsed = readBody(z.array(z.object({ receivableId: z.uuid(), amount: money })).min(1).max(100), claim.allocations);
        if (parsed.length !== new Set(parsed.map(item => item.receivableId)).size) conflict('认领分摊存在重复应收');
        const sum = parsed.reduce((total, item) => total.plus(decimal(item.amount)), new Prisma.Decimal(0));
        if (!sum.eq(claim.amount) || sum.gt(receipt.amount.minus(receipt.allocatedAmount))) conflict('认领金额与到账余额不一致');
        for (const allocation of parsed) {
          const account = await tx.erpReceivable.findFirst({ where: { id: allocation.receivableId, tenantId: ctx.tenantId, OR:[{contract:{customerId:receipt.customerId,ownerMembershipId:claim.requestedByMembershipId}},{contractId:null,customerId:receipt.customerId}] } });
          if (!account) failNotFound('同客户应收账款');
          const moneyValue = decimal(allocation.amount);
          const remaining = account.amount.minus(account.paidAmount);
          if (moneyValue.lte(0) || moneyValue.gt(remaining)) conflict('分摊金额超过当前应收余额');
          const updated = await tx.erpReceivable.updateMany({ where: { id: account.id, tenantId: ctx.tenantId, paidAmount: account.paidAmount }, data: { paidAmount: { increment: moneyValue }, status: moneyValue.eq(remaining) ? 'paid' : 'partial' } });
          if (!updated.count) conflict('应收余额已变化，请刷新');
          await tx.erpPayment.create({ data: { tenantId: ctx.tenantId, receivableId: account.id, amount: moneyValue, reference: `BR-${claim.id}`, actorMembershipId: ctx.membershipId, receiptClaimId: claim.id } });
        }
      }
      const updatedReceipt = await tx.erpIncomingReceipt.updateMany({ where: { id, tenantId: ctx.tenantId, version: input.version, status: { in: ['open', 'partial'] } }, data: { version: { increment: 1 }, ...(decision === 'approve' ? { allocatedAmount: { increment: claim.amount }, status: claim.amount.eq(receipt.amount.minus(receipt.allocatedAmount)) ? 'closed' : 'partial' } : {}) } });
      if (!updatedReceipt.count) conflict('到账流水已变化，请刷新');
      const updatedClaim = await tx.erpReceiptClaim.updateMany({ where: { id: claim.id, tenantId: ctx.tenantId, status: 'pending' }, data: { status: decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'withdrawn', reviewedByMembershipId: ctx.membershipId, reviewReason: input.reason, reviewedAt: new Date() } });
      if (!updatedClaim.count) conflict('认领申请已处理');
      await audit(tx, ctx, `erp.receipt.claim.${decision}`, 'ReceiptClaim', claim.id, { receiptId: id, amount: claim.amount.toFixed(2), reason: input.reason ?? null });
      if(decision==='approve')await this.workflows.handling(tx,ctx,'receipt',claim.id,true);else await this.workflows.reject(tx,ctx,'receipt',claim.id,input.reason??'申请人撤回',decision==='withdraw');
      if (decision !== 'withdraw') await notify(tx, ctx.tenantId, claim.requestedByMembershipId, `receipt-claim:${claim.id}:${decision}`, decision === 'approve' ? '收款认领已通过' : '收款认领已退回', `流水 ${receipt.reference} · ${claim.amount.toFixed(2)} 元${input.reason ? ` · ${input.reason}` : ''}`);
      return tx.erpIncomingReceipt.findUniqueOrThrow({ where: { id }, include: { claims: { orderBy: { createdAt: 'desc' } } } });
    }, { isolationLevel: 'Serializable' });
  }

  async cancel(ctx: RequestContext, id: string, body: unknown) {
    this.auth.require(ctx, 'erp.finance.write');
    const input = readBody(cancelInput, body);
    return this.db.$transaction(async tx => {
      const receipt = await tx.erpIncomingReceipt.findFirst({ where: { id, tenantId: ctx.tenantId, version: input.version, status: 'open', allocatedAmount: 0 } });
      if (!receipt || await tx.erpReceiptClaim.count({ where: { tenantId: ctx.tenantId, receiptId: id, status: 'pending' } })) conflict('只有未分摊且无待审认领的到账流水可取消');
      const updated = await tx.erpIncomingReceipt.updateMany({ where: { id, tenantId: ctx.tenantId, version: input.version, status: 'open', allocatedAmount: 0 }, data: { status: 'cancelled', version: { increment: 1 }, cancelReason: input.reason } });
      if (!updated.count) conflict('到账流水已变化，请刷新');
      await audit(tx, ctx, 'erp.receipt.cancel', 'IncomingReceipt', id, { reason: input.reason });
      return tx.erpIncomingReceipt.findUniqueOrThrow({ where: { id } });
    }, { isolationLevel: 'Serializable' });
  }
}
