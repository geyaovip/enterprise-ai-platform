import { Injectable } from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import { assertFlowActor, activeFlow } from './workflow.rules';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../platform/auth.service';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
import { audit, conflict, failNotFound, label, notify, notifyApprovers, ownerFilter, salesReadFilter, pageQuery, positiveQty, storedMoney, money, dateFilter } from './erp.common';
import { pricedLine, tradeLineInput, tradeTermsInput, terms, checkApprover, qty, batchMoney } from './trade.common';
import { stockMove } from './stock-ledger';

const contractInput = z.object({ number: label(80), customerId: z.uuid(), opportunityId: z.uuid().optional(), note: z.string().max(2000).optional(), ...tradeTermsInput, lines: z.array(tradeLineInput).min(1).max(100) }).refine(x => new Set(x.lines.map(l => l.productId)).size === x.lines.length, '同一商品不能重复');
const shipmentInput = z.object({ warehouseId: z.uuid().optional(), version: z.int().positive(), documentNumber: label(80).optional(), note: z.string().max(2000).optional(), lines: z.array(z.object({ lineId: z.uuid(), quantity: positiveQty })).min(1).max(100).optional() }).refine(x => !x.lines || new Set(x.lines.map(l => l.lineId)).size === x.lines.length, '同一明细不能重复');

@Injectable()
export class SalesService {
  constructor(private readonly db: PrismaService, private readonly auth: AuthService, private readonly workflows: WorkflowService) {}

  async list(ctx: RequestContext, query: unknown) {
    this.auth.require(ctx, 'erp.sales.read');
    const q = readBody(pageQuery, query);
    const where = { tenantId: ctx.tenantId, ...salesReadFilter(ctx), ...dateFilter(q), ...(q.status ? { status: q.status } : {}), ...(q.partyId ? { customerId: q.partyId } : {}), ...(q.ownerId && !ctx.roles.includes("sales") ? { ownerMembershipId: q.ownerId } : {}), ...(q.q ? { OR: [{ number: { contains: q.q, mode: 'insensitive' as const } }, { customer: { name: { contains: q.q, mode: 'insensitive' as const } } }] } : {}) };
    const [items, total] = await this.db.$transaction([
      this.db.erpSalesContract.findMany({ where, include: { customer: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.page_size, take: q.page_size }),
      this.db.erpSalesContract.count({ where }),
    ]);
    return { items, total, page: q.page, page_size: q.page_size };
  }

  async get(ctx: RequestContext, id: string) {
    this.auth.require(ctx, 'erp.sales.read');
    const item = await this.db.erpSalesContract.findFirst({ where: { id, tenantId: ctx.tenantId, ...salesReadFilter(ctx) }, include: { lines: true, customer: { select: { id: true, code: true, name: true } }, opportunity: { select: { id: true, customerId: true, name: true } }, receivable: true, invoiceRequests: { where: { tenantId: ctx.tenantId }, select: { id: true, amount: true, status: true, invoiceNumber: true, registeredAt: true, createdAt: true }, orderBy: { createdAt: 'desc' } } } });
    if (!item) failNotFound('销售合同');
    const invoiceAmount = (status: string) => item.invoiceRequests.filter(row => row.status === status).reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0)).toFixed(2);
    return { ...item, invoiceSummary: { requested: invoiceAmount('requested'), registered: invoiceAmount('registered'), voided: invoiceAmount('voided') } };
  }

  async create(ctx: RequestContext, body: unknown) {
    this.auth.require(ctx, 'erp.sales.write');
    const input = readBody(contractInput, body);
    const customer = await this.db.erpCustomer.findFirst({ where: { id: input.customerId, tenantId: ctx.tenantId, active: true, ...ownerFilter(ctx) } });
    if (!customer) failNotFound('有效客户');
    if (input.opportunityId) {
      const opportunity = await this.db.erpOpportunity.findFirst({ where: { id: input.opportunityId, tenantId: ctx.tenantId, customerId: customer.id, ...ownerFilter(ctx) } });
      if (!opportunity) failNotFound('客户商机');
    }
    const products = await this.db.erpProduct.findMany({ where: { tenantId: ctx.tenantId, id: { in: input.lines.map(l => l.productId) }, active: true } });
    if (products.length !== input.lines.length) failNotFound('有效商品');
    const customerPrices = await this.db.erpCustomerPrice.findMany({where:{tenantId:ctx.tenantId,customerId:customer.id}});
    const lines = input.lines.map(x => {
      const product = products.find(p => p.id === x.productId)!;
      return pricedLine(product, x, customerPrices.find(p=>p.productId===product.id)?.unitPrice??product.salePrice);
    });
    const total = storedMoney(lines.reduce((sum, x) => sum.plus(x.lineTotal), new Prisma.Decimal(0)));
    return this.db.$transaction(async tx => {
      const currentCustomer = await tx.erpCustomer.findFirst({ where: { id: customer.id, tenantId: ctx.tenantId, active: true, ...ownerFilter(ctx) } });
      if (!currentCustomer) conflict('客户负责人或状态已变化，请刷新');
      const item = await tx.erpSalesContract.create({ data: { tenantId: ctx.tenantId, number: input.number, customerId: customer.id, opportunityId: input.opportunityId, ownerMembershipId: ctx.membershipId, total, ...terms(input, customer.paymentDays), note: input.note, lines: { create: lines } }, include: { lines: true } });
      await audit(tx, ctx, 'erp.contract.create', 'SalesContract', item.id, { total: total.toFixed(2) });
      return item;
    }, { isolationLevel: 'Serializable' });
  }

  async updateDraft(ctx: RequestContext, id: string, body: unknown) {
    this.auth.require(ctx, 'erp.sales.write');
    const { version } = readBody(z.object({ version: z.int().positive() }), body);
    const input = readBody(contractInput, body);
    return this.db.$transaction(async tx => {
      const customer = await tx.erpCustomer.findFirst({ where: { id: input.customerId, tenantId: ctx.tenantId, active: true, ...ownerFilter(ctx) } });
      if (!customer) failNotFound('有效客户');
      if (input.opportunityId) {
        const opportunity = await tx.erpOpportunity.findFirst({ where: { id: input.opportunityId, tenantId: ctx.tenantId, customerId: customer.id, ...ownerFilter(ctx) } });
        if (!opportunity) failNotFound('客户商机');
      }
      const products = await tx.erpProduct.findMany({ where: { tenantId: ctx.tenantId, id: { in: input.lines.map(line => line.productId) }, active: true } });
      if (products.length !== input.lines.length) failNotFound('有效商品');
      const customerPrices = await tx.erpCustomerPrice.findMany({where:{tenantId:ctx.tenantId,customerId:customer.id}});
      const lines = input.lines.map(line => {
        const product = products.find(item => item.id === line.productId)!;
        return pricedLine(product, line, customerPrices.find(p=>p.productId===product.id)?.unitPrice??product.salePrice);
      });
      const total = storedMoney(lines.reduce((sum, line) => sum.plus(line.lineTotal), new Prisma.Decimal(0)));
      if(await tx.erpSalesLine.count({where:{contractId:id,shippedQty:{gt:0}}}))conflict('已履约销售单不能改写草稿明细');
      const changed = await tx.erpSalesContract.updateMany({ where: { id, tenantId: ctx.tenantId, ownerMembershipId: ctx.membershipId, status: 'draft', version }, data: { number: input.number, customerId: input.customerId, opportunityId: input.opportunityId ?? null, note: input.note, ...terms(input, customer.paymentDays), total, version: { increment: 1 } } });
      if (!changed.count) conflict('仅发起人可修改当前草稿，或合同已变化');
      await tx.erpSalesLine.deleteMany({ where: { contractId: id } });
      await tx.erpSalesLine.createMany({ data: lines.map(line => ({ ...line, contractId: id })) });
      await audit(tx, ctx, 'erp.contract.draft_update', 'SalesContract', id, { version: version + 1, total: total.toFixed(2) });
      return tx.erpSalesContract.findUniqueOrThrow({ where: { id }, include: { lines: true, customer: { select: { id: true, code: true, name: true } } } });
    }, { isolationLevel: 'Serializable' });
  }

  async confirm(ctx: RequestContext, id: string, body: unknown) {
    this.auth.require(ctx, 'erp.sales.approve');
    const { version } = readBody(z.object({ version: z.int().positive() }), body);
    return this.db.$transaction(async tx => {

      const current = await tx.erpSalesContract.findFirst({ where: { id, tenantId: ctx.tenantId, version }, include: { lines: true, customer: true } });
      if (!current || !['pending_approval', 'draft'].includes(current.status)) conflict('合同状态或版本已变化');
      if(current.status==='draft'&&(await tx.erpBusinessSettings.findUnique({where:{tenantId:ctx.tenantId}}))?.workflowConfig&&((await tx.erpBusinessSettings.findUnique({where:{tenantId:ctx.tenantId}}))!.workflowConfig as Record<string,unknown>)['sales'])conflict('已配置业务流程，请先提交审核');
      if(!await activeFlow(tx,ctx.tenantId,'sales',id))await checkApprover(tx,ctx,'sales',current.total);
      if (current.status === 'draft' && current.ownerMembershipId !== ctx.membershipId) conflict('合同需由发起人提交审核');
      if (current.status === 'pending_approval' && current.ownerMembershipId === ctx.membershipId) conflict('合同不能由发起人自行审核');
      if(current.status==='pending_approval'&&!await this.workflows.approve(tx,ctx,'sales',id,current.deliveryAt)){const changed=await tx.erpSalesContract.updateMany({where:{id,tenantId:ctx.tenantId,version,status:'pending_approval'},data:{version:{increment:1}}});if(!changed.count)conflict('合同已变化');return tx.erpSalesContract.findUniqueOrThrow({where:{id},include:{lines:true}});}
      if (current.customer.creditLimit !== null) {
        const accounts = await tx.erpReceivable.findMany({where:{tenantId:ctx.tenantId,OR:[{customerId:current.customerId},{contract:{customerId:current.customerId}}]}});
        const other = await tx.erpSalesContract.findMany({where:{tenantId:ctx.tenantId,customerId:current.customerId,id:{not:id},status:{in:['confirmed','partial_shipped']}},include:{lines:true}});
        const outstanding = accounts.reduce((n,a)=>n.plus(Prisma.Decimal.max(0,a.amount.minus(a.paidAmount))),new Prisma.Decimal(0));
        const unshipped = [...other.flatMap(o=>o.lines),...current.lines].reduce((n,l)=>n.plus(l.unitPrice.mul(qty(l.quantity-l.shippedQty))),new Prisma.Decimal(0));
        if (outstanding.plus(unshipped).gt(current.customer.creditLimit)) conflict('确认后将超过客户信用额度，请先核对回款或调整额度');
      }
      const nextStatus = current.lines.every(l=>l.shippedQty===l.quantity) ? 'shipped' : current.lines.some(l=>l.shippedQty>0) ? 'partial_shipped' : 'confirmed';
      const changed = await tx.erpSalesContract.updateMany({ where: { id, tenantId: ctx.tenantId, status: current.status, version }, data: { status: nextStatus, version: { increment: 1 } } });
      if (!changed.count) conflict('合同状态或版本已变化');
      await audit(tx, ctx, 'erp.contract.confirm', 'SalesContract', id, { administratorDirectConfirm: current.status === 'draft' });
      const result = await tx.erpSalesContract.findUniqueOrThrow({ where: { id } });
      if(current.status==='draft')await this.workflows.begin(tx,ctx,'sales',id,result.number,result.total,undefined,result.deliveryAt,true);
      await notify(tx, ctx.tenantId, current.ownerMembershipId, `contract:${id}:${result.version}:approved`, `销售合同已确认：${result.number}`, '请到合同详情核对最新状态。');
      return tx.erpSalesContract.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    });
  }

  async submit(ctx: RequestContext, id: string, body: unknown) {
    this.auth.require(ctx, 'erp.sales.write');
    const { version } = readBody(z.object({ version: z.int().positive() }), body);
    return this.db.$transaction(async tx => {
      const changed = await tx.erpSalesContract.updateMany({ where: { id, tenantId: ctx.tenantId, ownerMembershipId: ctx.membershipId, status: 'draft', version }, data: { status: 'pending_approval', version: { increment: 1 } } });
      if (!changed.count) conflict('仅发起人可提交当前合同草稿审核，或单据已变化');
      await audit(tx, ctx, 'erp.contract.submit', 'SalesContract', id);
      const result = await tx.erpSalesContract.findUniqueOrThrow({ where: { id } });
      await this.workflows.begin(tx,ctx,'sales',id,result.number,result.total,undefined,result.deliveryAt);
      return tx.erpSalesContract.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    });
  }

  async reject(ctx: RequestContext, id: string, body: unknown) {
    this.auth.require(ctx, 'erp.sales.approve');
    const { version, reason } = readBody(z.object({ version: z.int().positive(), reason: label(500) }), body);
    return this.db.$transaction(async tx => {

      const current = await tx.erpSalesContract.findFirst({ where: { id, tenantId: ctx.tenantId, status: 'pending_approval', version }, select: { ownerMembershipId: true, total:true } });
      if (!current) conflict('合同审核状态或版本已变化');
      if(!await activeFlow(tx,ctx.tenantId,'sales',id))await checkApprover(tx,ctx,'sales',current.total);
      if (current.ownerMembershipId === ctx.membershipId) conflict('合同不能由发起人自行审核');
      const amendment=await tx.auditEvent.findFirst({where:{tenantId:ctx.tenantId,resourceId:id,action:'erp.contract.change'},orderBy:{createdAt:'desc'}});
      const detail=amendment?.detail as {amendedVersion?:number;beforeStatus?:string;beforeTotal?:string;before?:Array<{lineId:string;quantity:number}>}|undefined;
      let restoredStatus='draft';
      const confirmedAfter=amendment?await tx.auditEvent.findFirst({where:{tenantId:ctx.tenantId,resourceId:id,action:'erp.contract.confirm',createdAt:{gt:amendment.createdAt}}}):null;
      if(detail?.amendedVersion&&detail.amendedVersion<=version&&!confirmedAfter){if(!detail.before||!detail.beforeTotal||!['confirmed','partial_shipped'].includes(detail.beforeStatus??''))conflict('变更原始快照不可用');for(const row of detail.before){const line=await tx.erpSalesLine.findFirst({where:{id:row.lineId,contractId:id}});if(!line||row.quantity<line.shippedQty)conflict('原履约数量已变化');await tx.erpSalesLine.update({where:{id:line.id},data:{quantity:row.quantity,lineTotal:line.unitPrice.mul(row.quantity).toDecimalPlaces(2)}});}restoredStatus=detail.beforeStatus!;await tx.erpSalesContract.update({where:{id},data:{total:detail.beforeTotal}});}
      else if(await tx.erpSalesLine.count({where:{contractId:id,shippedQty:{gt:0}}}))conflict('已履约单据缺少变更快照，不能退回普通草稿');
      const changed = await tx.erpSalesContract.updateMany({ where: { id, tenantId: ctx.tenantId, status: 'pending_approval', version }, data: { status: restoredStatus, version: { increment: 1 } } });
      if (!changed.count) conflict('合同审核状态或版本已变化');
      await this.workflows.reject(tx,ctx,'sales',id,reason);
      await audit(tx, ctx, 'erp.contract.reject', 'SalesContract', id, { reason });
      const result = await tx.erpSalesContract.findUniqueOrThrow({ where: { id } });
      if(restoredStatus!=='draft')await this.workflows.begin(tx,{...ctx,membershipId:current.ownerMembershipId},'sales',id,result.number,result.total,undefined,result.deliveryAt,true);
      await notify(tx, ctx.tenantId, current.ownerMembershipId, `contract:${id}:${result.version}:rejected`, `销售合同已退回：${result.number}`, reason);
      return tx.erpSalesContract.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    });
  }

  async ship(ctx: RequestContext, id: string, body: unknown) {
    this.auth.require(ctx, 'erp.sales.ship');
    const input = readBody(shipmentInput, body);
    const contract = await this.db.erpSalesContract.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { lines: true } });
    if (!contract) failNotFound('销售合同');
    if (!['confirmed', 'partial_shipped'].includes(contract.status)) conflict('合同尚未确认或已全部出库');
    const selected = input.lines ?? contract.lines.filter(l => l.shippedQty < l.quantity).map(l => ({ lineId: l.id, quantity: qty(l.quantity - l.shippedQty) }));
    if (!selected.length) conflict('合同已全部出库');
    for (const line of selected) {
      const old = contract.lines.find(l => l.id === line.lineId);
      if (!old || line.quantity > qty(old.quantity - old.shippedQty)) conflict('出库数量超过剩余数量');
    }
    const complete = contract.lines.every(l => qty(l.shippedQty + (selected.find(x => x.lineId === l.id)?.quantity ?? 0)) === l.quantity);
    const amount = storedMoney(selected.reduce((sum, x) => sum.plus(batchMoney(contract.lines.find(l => l.id === x.lineId)!, contract.lines.find(l => l.id === x.lineId)!.shippedQty, x.quantity)), new Prisma.Decimal(0)));
    return this.db.$transaction(async tx => {
      const changed = await tx.erpSalesContract.updateMany({ where: { id, tenantId: ctx.tenantId, version: input.version, status: { in: ['confirmed', 'partial_shipped'] } }, data: { status: complete ? 'shipped' : 'partial_shipped', version: { increment: 1 } } });
      if (!changed.count) conflict('合同已变化，请刷新');
      const doc = await tx.erpStockDocument.create({ data: { tenantId: ctx.tenantId, number: input.documentNumber ?? `DN-${contract.number}-${input.version}`, kind: 'shipment', sourceId: id, note: input.note, actorMembershipId: ctx.membershipId } });
      for (const line of selected) {
        const old = contract.lines.find(l => l.id === line.lineId)!;
        const updated = await tx.erpSalesLine.updateMany({ where: { id: old.id, shippedQty: old.shippedQty }, data: { shippedQty: qty(old.shippedQty + line.quantity) } });
        if (!updated.count) conflict('合同明细已变化，请刷新');
        await stockMove(tx, ctx, { productId: old.productId, warehouseId: input.warehouseId, direction: 'out', quantity: line.quantity, tradeAmount: batchMoney(old, old.shippedQty, line.quantity, true), grossAmount:batchMoney(old, old.shippedQty, line.quantity), sourceType: 'contract', sourceId: id, documentId: doc.id });
      }
      const account = await tx.erpReceivable.findUnique({ where: { contractId: id } });
      if (account) await tx.erpReceivable.update({ where: { id: account.id }, data: { amount: storedMoney(account.amount.plus(amount)), status: account.paidAmount.gt(0) ? 'partial' : 'open' } });
      else await tx.erpReceivable.create({ data: { tenantId: ctx.tenantId, contractId: id, customerId: contract.customerId, dueAt: contract.dueAt, amount } });
      const booked = await tx.erpReceivable.findUniqueOrThrow({ where: { contractId: id } });
      await tx.erpAccountEntry.create({ data: { tenantId: ctx.tenantId, kind: 'receivable', accountId: booked.id, partyId: contract.customerId, amount, reference: doc.number, sourceType: 'shipment', sourceId: doc.id } });
      await this.workflows.handling(tx,ctx,'sales',id,complete);
      await audit(tx, ctx, 'erp.contract.ship', 'SalesContract', id, { documentId: doc.id, amount: amount.toFixed(2), complete });
      return tx.erpSalesContract.findUniqueOrThrow({ where: { id }, include: { lines: true, receivable: true } });
    }, { isolationLevel: 'Serializable' });
  }
}
