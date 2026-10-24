import { Injectable } from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import { assertFlowActor, activeFlow } from './workflow.rules';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../platform/auth.service';
import { ChannelService } from '../platform/channel.service';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
import { audit, conflict, failNotFound, label, notify, notifyApprovers, pageQuery, positiveQty, storedMoney, money, dateFilter } from './erp.common';
import { pricedLine, tradeLineInput, tradeTermsInput, terms, checkApprover, qty, batchMoney, unitMoney } from './trade.common';
import { stockMove } from './stock-ledger';

const orderInput = z.object({ number: label(80), supplierId: z.uuid(), note: z.string().max(2000).optional(), ...tradeTermsInput, lines: z.array(tradeLineInput).min(1).max(100), sourceInventory: z.object({ productId: z.uuid(), balanceVersion: z.int().positive(), reorderPoint: positiveQty, incomingQty: z.number().min(0), suggestedOrderQty: positiveQty }).optional() }).refine(x => new Set(x.lines.map(l => l.productId)).size === x.lines.length, '同一商品不能重复');
const batchInput = z.object({ warehouseId: z.uuid().optional(), version: z.int().positive(), documentNumber: label(80).optional(), note: z.string().max(2000).optional(), lines: z.array(z.object({ lineId: z.uuid(), quantity: positiveQty })).min(1).max(100).optional() }).refine(x => !x.lines || new Set(x.lines.map(l => l.lineId)).size === x.lines.length, '同一明细不能重复');
const changeInput = z.object({ version: z.int().positive(), reason: label(500), note: z.string().max(2000).optional(), lines: z.array(z.object({ lineId: z.uuid(), quantity: positiveQty })).min(1).max(100) }).refine(x => new Set(x.lines.map(line => line.lineId)).size === x.lines.length, '同一明细不能重复');
const changeReview = z.object({ version: z.int().positive(), reason: label(500).optional() });
const proposedChange = z.object({ note: z.string().nullable(), lines: z.array(z.object({ lineId: z.uuid(), quantity: positiveQty })) });

@Injectable()
export class PurchaseService {
  constructor(private readonly db: PrismaService, private readonly auth: AuthService, private readonly channels: ChannelService, private readonly workflows: WorkflowService) {}

  async list(ctx: RequestContext, query: unknown) {
    this.auth.require(ctx, 'erp.purchase.read');
    const q = readBody(pageQuery, query);
    const where = { tenantId: ctx.tenantId, ...dateFilter(q), ...(q.status ? { status: q.status } : {}), ...(q.partyId ? { supplierId: q.partyId } : {}), ...(q.ownerId ? { createdByMembershipId: q.ownerId } : {}), ...(q.q ? { OR: [{ number: { contains: q.q, mode: "insensitive" as const } }, { supplier: { name: { contains: q.q, mode: "insensitive" as const } } }] } : {}) };
    const [items, total] = await this.db.$transaction([
      this.db.erpPurchaseOrder.findMany({ where, include: { supplier: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.page_size, take: q.page_size }),
      this.db.erpPurchaseOrder.count({ where }),
    ]);
    return { items, total, page: q.page, page_size: q.page_size };
  }

  async get(ctx: RequestContext, id: string) {
    this.auth.require(ctx, 'erp.purchase.read');
    const item = await this.db.erpPurchaseOrder.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { lines: true, changes: { orderBy: { createdAt: 'desc' } }, supplier: { select: { id: true, name: true, code: true } }, payable: true } });
    if (!item) failNotFound('采购单');
    return item;
  }

  async create(ctx: RequestContext, body: unknown) {
    return this.db.$transaction(tx=>this.createInTransaction(tx,ctx,body),{isolationLevel:'Serializable'});
  }

  async createInTransaction(tx: Prisma.TransactionClient, ctx: RequestContext, body: unknown) {
    this.auth.require(ctx, 'erp.purchase.write');
    const input = readBody(orderInput, body);
    const supplier = await tx.erpSupplier.findFirst({ where: { id: input.supplierId, tenantId: ctx.tenantId, active: true } });
    if (!supplier) failNotFound('有效供应商');
    const products = await tx.erpProduct.findMany({ where: { tenantId: ctx.tenantId, id: { in: input.lines.map(l => l.productId) }, active: true } });
    if (products.length !== input.lines.length) failNotFound('有效商品');
    const lines = input.lines.map(x => {
      const product = products.find(p => p.id === x.productId)!;
      return pricedLine(product, x, product.purchasePrice);
    });
    const total = storedMoney(lines.reduce((sum, x) => sum.plus(x.lineTotal), new Prisma.Decimal(0)));
      if (input.sourceInventory) {
        const source = input.sourceInventory;
        if (!input.lines.some(line => line.productId === source.productId)) conflict('预警商品不在采购明细中');
        const balance = await tx.erpInventoryBalance.findFirst({ where: { tenantId: ctx.tenantId, productId: source.productId }, include: { product: { select: { reorderPoint: true, active: true } } } });
        if (!balance || !balance.product.active || balance.version !== source.balanceVersion || balance.product.reorderPoint !== source.reorderPoint || balance.quantity > source.reorderPoint) conflict('库存预警已变化，请返回库存页刷新后重试');
        const pending = await tx.erpPurchaseLine.findMany({ where: { productId: source.productId, order: { tenantId: ctx.tenantId, status: { in: ['ordered', 'partial_received'] } } }, select: { quantity: true, receivedQty: true } });
        const incomingQty = pending.reduce((sum, line) => sum + line.quantity - line.receivedQty, 0);
        const suggestedOrderQty = Math.max(0, source.reorderPoint + 1 - balance.quantity - incomingQty);
        if (incomingQty !== source.incomingQty || suggestedOrderQty !== source.suggestedOrderQty || suggestedOrderQty === 0) conflict('采购在途量已变化，请返回库存页刷新后重试');
      }
      const item = await tx.erpPurchaseOrder.create({ data: { tenantId: ctx.tenantId, number: input.number, supplierId: supplier.id, total, ...terms(input, supplier.paymentDays), note: input.note, createdByMembershipId: ctx.membershipId, lines: { create: lines } }, include: { lines: true } });
      await audit(tx, ctx, 'erp.purchase.create', 'PurchaseOrder', item.id, { total: total.toFixed(2), ...(input.sourceInventory ? { sourceInventory: input.sourceInventory } : {}) });
      return item;
  }

  async updateDraft(ctx: RequestContext, id: string, body: unknown) {
    this.auth.require(ctx, 'erp.purchase.write');
    const { version } = readBody(z.object({ version: z.int().positive() }), body);
    const input = readBody(orderInput, body);
    return this.db.$transaction(async tx => {
      const supplier = await tx.erpSupplier.findFirst({ where: { id: input.supplierId, tenantId: ctx.tenantId, active: true } });
      if (!supplier) failNotFound('有效供应商');
      const products = await tx.erpProduct.findMany({ where: { tenantId: ctx.tenantId, id: { in: input.lines.map(line => line.productId) }, active: true } });
      if (products.length !== input.lines.length) failNotFound('有效商品');
      const lines = input.lines.map(line => {
        const product = products.find(item => item.id === line.productId)!;
        return pricedLine(product, line, product.purchasePrice);
      });
      const total = storedMoney(lines.reduce((sum, line) => sum.plus(line.lineTotal), new Prisma.Decimal(0)));
      const changed = await tx.erpPurchaseOrder.updateMany({ where: { id, tenantId: ctx.tenantId, createdByMembershipId: ctx.membershipId, status: 'draft', version }, data: { number: input.number, supplierId: input.supplierId, note: input.note, ...terms(input, supplier.paymentDays), total, version: { increment: 1 } } });
      if (!changed.count) conflict('仅发起人可修改当前草稿，或单据已变化');
      await tx.erpPurchaseLine.deleteMany({ where: { orderId: id } });
      await tx.erpPurchaseLine.createMany({ data: lines.map(line => ({ ...line, orderId: id })) });
      await audit(tx, ctx, 'erp.purchase.draft_update', 'PurchaseOrder', id, { version: version + 1, total: total.toFixed(2) });
      return tx.erpPurchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true, supplier: { select: { id: true, code: true, name: true } } } });
    }, { isolationLevel: 'Serializable' });
  }

  async requestChange(ctx: RequestContext, id: string, body: unknown) {
    this.auth.require(ctx, 'erp.purchase.write');
    const input = readBody(changeInput, body);
    return this.db.$transaction(async tx => {
      const order = await tx.erpPurchaseOrder.findFirst({ where: { id, tenantId: ctx.tenantId, createdByMembershipId: ctx.membershipId, version: input.version, status: { in: ['ordered', 'partial_received'] } }, include: { lines: true } });
      if (!order) conflict('仅发起人可申请当前采购单变更，或单据已变化');
      const previous = await tx.erpPurchaseChange.findMany({ where: { tenantId: ctx.tenantId, orderId: id, status: { in: ['pending', 'approved'] } }, select: { status: true } });
      if (previous.length) conflict('当前采购单已有待审核或已批准的变更');
      if (input.lines.length !== order.lines.length || input.lines.some(line => !order.lines.some(old => old.id === line.lineId))) conflict('本次变更须列出全部现有明细');
      if (input.lines.every(line => line.quantity === order.lines.find(old => old.id === line.lineId)!.quantity) && (input.note ?? order.note) === order.note) conflict('变更内容与当前采购单相同');
      const proposedLines = input.lines.map(line => {
        const old = order.lines.find(item => item.id === line.lineId)!;
        if (line.quantity < old.receivedQty) conflict(`${old.sku} 的新数量不能低于已收数量`);
        return { lineId: old.id, sku: old.sku, quantity: line.quantity, receivedQty: old.receivedQty, unitPrice: old.unitPrice.toString(), amount: storedMoney(old.unitPrice.mul(line.quantity)).toFixed(2) };
      });
      const total = storedMoney(proposedLines.reduce((sum, line) => sum.plus(line.amount), new Prisma.Decimal(0)));
      const changed = await tx.erpPurchaseOrder.updateMany({ where: { id, tenantId: ctx.tenantId, createdByMembershipId: ctx.membershipId, version: input.version, status: { in: ['ordered', 'partial_received'] } }, data: { version: { increment: 1 } } });
      if (!changed.count) conflict('采购单已变化，请刷新');
      const change = await tx.erpPurchaseChange.create({ data: {
        tenantId: ctx.tenantId, orderId: id, baseVersion: input.version + 1, reason: input.reason,
        before: { version: order.version, status: order.status, total: order.total.toFixed(2), note: order.note, lines: order.lines.map(line => ({ lineId: line.id, sku: line.sku, quantity: line.quantity, receivedQty: line.receivedQty, unitPrice: line.unitPrice.toString() })) },
        proposed: { total: total.toFixed(2), note: input.note ?? order.note, lines: proposedLines },
        requestedByMembershipId: ctx.membershipId,
      } });
      await audit(tx, ctx, 'erp.purchase.change.request', 'PurchaseOrder', id, { changeId: change.id, baseVersion: change.baseVersion });
      await this.workflows.begin(tx,ctx,'purchase_change',change.id,order.number,total,id);
      return change;
    }, { isolationLevel: 'Serializable' });
  }

  async reviewChange(ctx: RequestContext, id: string, changeId: string, decision: 'approve' | 'reject', body: unknown) {
    this.auth.require(ctx, 'erp.purchase.approve');
    const input = readBody(changeReview, body);
    if (decision === 'reject' && !input.reason) conflict('退回变更必须填写原因');
    return this.db.$transaction(async tx => {

      const change = await tx.erpPurchaseChange.findFirst({ where: { id: changeId, tenantId: ctx.tenantId, orderId: id, status: 'pending' } });
      if (!change || change.baseVersion !== input.version) conflict('采购变更已处理或版本已变化');
      if (change.requestedByMembershipId === ctx.membershipId) conflict('变更申请人不能审核自己的变更');
      const order = await tx.erpPurchaseOrder.findFirst({ where: { id, tenantId: ctx.tenantId, version: input.version, status: { in: ['ordered', 'partial_received'] } }, include: { lines: true } });
      if (!order) conflict('采购单已变化，请刷新');
      if(!await activeFlow(tx,ctx.tenantId,'purchase_change',changeId))await checkApprover(tx,ctx,'purchase',new Prisma.Decimal((change.proposed as {total:string}).total));
      if(decision==='approve'&&!await this.workflows.approve(tx,ctx,'purchase_change',changeId)){const bumped=await tx.erpPurchaseOrder.updateMany({where:{id,tenantId:ctx.tenantId,version:input.version},data:{version:{increment:1}}});if(!bumped.count)conflict('采购单已变化');await tx.erpPurchaseChange.update({where:{id:changeId},data:{baseVersion:input.version+1}});return tx.erpPurchaseOrder.findUniqueOrThrow({where:{id},include:{lines:true,changes:true}});}
      if(decision==='reject')await this.workflows.reject(tx,ctx,'purchase_change',changeId,input.reason!);
      let total = order.total;
      let status = order.status;
      let note = order.note;
      if (decision === 'approve') {
        if (await tx.erpPurchaseChange.count({ where: { tenantId: ctx.tenantId, orderId: id, status: 'approved' } })) conflict('采购单已批准过一次变更');
        const proposal = readBody(proposedChange, change.proposed);
        if (proposal.lines.length !== order.lines.length || proposal.lines.some(line => !order.lines.some(old => old.id === line.lineId))) conflict('采购明细已变化，请重新申请');
        total = storedMoney(proposal.lines.reduce((sum, line) => {
          const old = order.lines.find(item => item.id === line.lineId)!;
          if (line.quantity < old.receivedQty) conflict(`${old.sku} 的新数量不能低于已收数量`);
          return sum.plus(old.unitPrice.mul(line.quantity));
        }, new Prisma.Decimal(0)));
        status = proposal.lines.every(line => line.quantity === order.lines.find(old => old.id === line.lineId)!.receivedQty) ? 'received' : order.status;
        note = proposal.note;
        for (const line of proposal.lines) {
          const old = order.lines.find(item => item.id === line.lineId)!;
          const updated = await tx.erpPurchaseLine.updateMany({ where: { id: old.id, orderId: id, quantity: old.quantity, receivedQty: old.receivedQty }, data: { quantity: line.quantity, lineTotal: storedMoney(old.unitPrice.mul(line.quantity)) } });
          if (!updated.count) conflict('采购明细已变化，请刷新');
        }
      }
      const changed = await tx.erpPurchaseOrder.updateMany({ where: { id, tenantId: ctx.tenantId, version: input.version, status: { in: ['ordered', 'partial_received'] } }, data: { version: { increment: 1 }, total, status, note } });
      if (!changed.count) conflict('采购单已变化，请刷新');
      const reviewed = await tx.erpPurchaseChange.updateMany({ where: { id: changeId, tenantId: ctx.tenantId, status: 'pending' }, data: { status: decision === 'approve' ? 'approved' : 'rejected', reviewReason: input.reason, reviewedByMembershipId: ctx.membershipId, reviewedAt: new Date() } });
      if (!reviewed.count) conflict('采购变更已处理');
      await audit(tx, ctx, `erp.purchase.change.${decision}`, 'PurchaseOrder', id, { changeId, total: total.toFixed(2) });
      await notify(tx, ctx.tenantId, change.requestedByMembershipId, `purchase-change:${changeId}:${decision}`, `采购变更${decision === 'approve' ? '已批准' : '已退回'}：${order.number}`, input.reason ?? '请到采购单详情核对最新版本。');
      return tx.erpPurchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true, changes: { orderBy: { createdAt: 'desc' } }, payable: true } });
    }, { isolationLevel: 'Serializable' });
  }

  async confirm(ctx: RequestContext, id: string, body: unknown) {
    this.auth.require(ctx, 'erp.purchase.approve');
    const { version } = readBody(z.object({ version: z.int().positive() }), body);
    return this.db.$transaction(async tx => {

      const current = await tx.erpPurchaseOrder.findFirst({ where: { id, tenantId: ctx.tenantId, version }, select: { status: true, createdByMembershipId: true, total:true,deliveryAt:true } });
      if (!current || !['pending_approval', 'draft'].includes(current.status)) conflict('采购单状态或版本已变化');
      if(current.status==='draft'&&(await tx.erpBusinessSettings.findUnique({where:{tenantId:ctx.tenantId}}))?.workflowConfig&&((await tx.erpBusinessSettings.findUnique({where:{tenantId:ctx.tenantId}}))!.workflowConfig as Record<string,unknown>)['purchase'])conflict('已配置业务流程，请先提交审核');
      if(!await activeFlow(tx,ctx.tenantId,'purchase',id))await checkApprover(tx,ctx,'purchase',current.total);
      if (current.status === 'draft' && current.createdByMembershipId !== ctx.membershipId) conflict('采购单需由发起人提交审核');
      if (current.status === 'pending_approval' && current.createdByMembershipId === ctx.membershipId) conflict('采购单不能由发起人自行审核');
      if(current.status==='pending_approval'&&!await this.workflows.approve(tx,ctx,'purchase',id,current.deliveryAt)){const changed=await tx.erpPurchaseOrder.updateMany({where:{id,tenantId:ctx.tenantId,version,status:'pending_approval'},data:{version:{increment:1}}});if(!changed.count)conflict('采购单已变化');return tx.erpPurchaseOrder.findUniqueOrThrow({where:{id},include:{lines:true}});}
      const changed = await tx.erpPurchaseOrder.updateMany({ where: { id, tenantId: ctx.tenantId, status: current.status, version }, data: { status: 'ordered', version: { increment: 1 } } });
      if (!changed.count) conflict('采购单状态或版本已变化');
      await audit(tx, ctx, 'erp.purchase.confirm', 'PurchaseOrder', id, { administratorDirectConfirm: current.status === 'draft' });
      const order = await tx.erpPurchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });
      if(current.status==='draft')await this.workflows.begin(tx,ctx,'purchase',id,order.number,order.total,undefined,order.deliveryAt,true);
      await notify(tx, ctx.tenantId, current.createdByMembershipId, `purchase:${id}:${order.version}:approved`, `采购单已确认：${order.number}`, '请到采购单详情核对最新状态。');
      await this.channels.queuePurchase(tx, ctx, id, order.number, order.version, 'approved', [current.createdByMembershipId]);
      return order;
    });
  }

  async submit(ctx: RequestContext, id: string, body: unknown) {
    return this.db.$transaction(tx=>this.submitInTransaction(tx,ctx,id,body),{isolationLevel:'Serializable'});
  }

  async submitInTransaction(tx: Prisma.TransactionClient, ctx: RequestContext, id: string, body: unknown) {
    this.auth.require(ctx, 'erp.purchase.write');
    const { version } = readBody(z.object({ version: z.int().positive() }), body);
      const changed = await tx.erpPurchaseOrder.updateMany({ where: { id, tenantId: ctx.tenantId, createdByMembershipId: ctx.membershipId, status: 'draft', version }, data: { status: 'pending_approval', version: { increment: 1 } } });
      if (!changed.count) conflict('仅发起人可提交当前草稿审核，或单据已变化');
      await audit(tx, ctx, 'erp.purchase.submit', 'PurchaseOrder', id);
      const order = await tx.erpPurchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });
      await this.workflows.begin(tx,ctx,'purchase',id,order.number,order.total,undefined,order.deliveryAt);
      return order;
  }

  async reject(ctx: RequestContext, id: string, body: unknown) {
    this.auth.require(ctx, 'erp.purchase.approve');
    const { version, reason } = readBody(z.object({ version: z.int().positive(), reason: label(500) }), body);
    return this.db.$transaction(async tx => {

      const current = await tx.erpPurchaseOrder.findFirst({ where: { id, tenantId: ctx.tenantId, status: 'pending_approval', version }, select: { createdByMembershipId: true, total:true } });
      if (!current) conflict('采购审核状态或版本已变化');
      if(!await activeFlow(tx,ctx.tenantId,'purchase',id))await checkApprover(tx,ctx,'purchase',current.total);
      if (current.createdByMembershipId === ctx.membershipId) conflict('采购单不能由发起人自行审核');
      const changed = await tx.erpPurchaseOrder.updateMany({ where: { id, tenantId: ctx.tenantId, status: 'pending_approval', version }, data: { status: 'draft', version: { increment: 1 } } });
      if (!changed.count) conflict('采购审核状态或版本已变化');
      await this.workflows.reject(tx,ctx,'purchase',id,reason);
      await audit(tx, ctx, 'erp.purchase.reject', 'PurchaseOrder', id, { reason });
      const order = await tx.erpPurchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });
      await notify(tx, ctx.tenantId, current.createdByMembershipId, `purchase:${id}:${order.version}:rejected`, `采购单已退回：${order.number}`, reason);
      await this.channels.queuePurchase(tx, ctx, id, order.number, order.version, 'rejected', [current.createdByMembershipId]);
      return order;
    });
  }

  async receive(ctx: RequestContext, id: string, body: unknown) {
    this.auth.require(ctx, 'erp.purchase.receive');
    const input = readBody(batchInput, body);
    const order = await this.db.erpPurchaseOrder.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { lines: true } });
    if (!order) failNotFound('采购单');
    if (!['ordered', 'partial_received'].includes(order.status)) conflict('采购单尚未确认或已全部入库');
    const selected = input.lines ?? order.lines.filter(l => l.receivedQty < l.quantity).map(l => ({ lineId: l.id, quantity: qty(l.quantity - l.receivedQty) }));
    if (!selected.length) conflict('采购单已全部入库');
    for (const line of selected) {
      const old = order.lines.find(l => l.id === line.lineId);
      if (!old || line.quantity > qty(old.quantity - old.receivedQty)) conflict('入库数量超过剩余数量');
    }
    const complete = order.lines.every(l => qty(l.receivedQty + (selected.find(x => x.lineId === l.id)?.quantity ?? 0)) === l.quantity);
    const amount = storedMoney(selected.reduce((sum, x) => sum.plus(batchMoney(order.lines.find(l => l.id === x.lineId)!, order.lines.find(l => l.id === x.lineId)!.receivedQty, x.quantity)), new Prisma.Decimal(0)));
    return this.db.$transaction(async tx => {
      if (await tx.erpPurchaseChange.count({ where: { tenantId: ctx.tenantId, orderId: id, status: 'pending' } })) conflict('采购单有待审核变更，暂不可入库');
      const changed = await tx.erpPurchaseOrder.updateMany({ where: { id, tenantId: ctx.tenantId, version: input.version, status: { in: ['ordered', 'partial_received'] } }, data: { status: complete ? 'received' : 'partial_received', version: { increment: 1 } } });
      if (!changed.count) conflict('采购单已变化，请刷新');
      const doc = await tx.erpStockDocument.create({ data: { tenantId: ctx.tenantId, number: input.documentNumber ?? `GRN-${order.number}-${input.version}`, kind: 'receipt', sourceId: id, note: input.note, actorMembershipId: ctx.membershipId } });
      for (const line of selected) {
        const old = order.lines.find(l => l.id === line.lineId)!;
        const updated = await tx.erpPurchaseLine.updateMany({ where: { id: old.id, receivedQty: old.receivedQty }, data: { receivedQty: qty(old.receivedQty + line.quantity) } });
        if (!updated.count) conflict('采购明细已变化，请刷新');
        await stockMove(tx, ctx, { productId: old.productId, warehouseId: input.warehouseId, direction: 'in', quantity: line.quantity, unitCost: old.unitPrice.div(new Prisma.Decimal(1).plus(old.taxRate.div(100))), tradeAmount: batchMoney(old, old.receivedQty, line.quantity, true), grossAmount:batchMoney(old, old.receivedQty, line.quantity), sourceType: 'purchase', sourceId: id, documentId: doc.id });
      }
      const account = await tx.erpPayable.findUnique({ where: { orderId: id } });
      if (account) await tx.erpPayable.update({ where: { id: account.id }, data: { amount: storedMoney(account.amount.plus(amount)), status: account.paidAmount.gt(0) ? 'partial' : 'open' } });
      else await tx.erpPayable.create({ data: { tenantId: ctx.tenantId, orderId: id, supplierId: order.supplierId, dueAt: order.dueAt, amount } });
      const booked = await tx.erpPayable.findUniqueOrThrow({ where: { orderId: id } });
      await tx.erpAccountEntry.create({ data: { tenantId: ctx.tenantId, kind: 'payable', accountId: booked.id, partyId: order.supplierId, amount, reference: doc.number, sourceType: 'receipt', sourceId: doc.id } });
      await this.workflows.handling(tx,ctx,'purchase',id,complete);
      await audit(tx, ctx, 'erp.purchase.receive', 'PurchaseOrder', id, { documentId: doc.id, amount: amount.toFixed(2), complete });
      return tx.erpPurchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true, payable: true } });
    }, { isolationLevel: 'Serializable' });
  }
}
