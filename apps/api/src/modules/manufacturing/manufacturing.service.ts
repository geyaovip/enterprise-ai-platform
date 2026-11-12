import type { Tracking } from '../erp/warehouse-allocation';
import { allocateMaterial, requireReturnable, requireShippable } from './material-trace';
import { findPlan, progress, runProduction } from './production';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { ManufacturingErp, remainingPurchase, safetyReplenishment } from '../erp/manufacturing.contract';
import { conflict, failNotFound, label, type Transaction } from '../erp/erp.common';
import { MesService } from '../mes/mes.service';
import { bomDraft, bomUnitKey } from '../mes/mes.rules';
import { fingerprint } from '../orchestration/command-registry';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
import { PrismaService } from '../prisma.service';
import { manufacturingPermissions } from './manufacturing.permissions';
import {
  actionInput, actionPermission, itemInput, key, linkInput, listInput, orderInput, partyInput,
  type OrderAction, warehouseQuery, warehouseAction, productionAction, productionPermission, teamInput,
} from './manufacturing.rules';

const D = Prisma.Decimal;
const orderDetail = { requirements: { orderBy: { sku: 'asc' } }, purchases: true } satisfies Prisma.ManufacturingOrderInclude;
type Order = Prisma.ManufacturingOrderGetPayload<{ include: typeof orderDetail }>;
type Requirement = Order['requirements'][number];

@Injectable()
export class ManufacturingService {
  constructor(private readonly db: PrismaService, private readonly erp: ManufacturingErp, private readonly mes: MesService) {}

  private require(ctx: RequestContext, permission: string) {
    if (ctx.app.appId !== 'manufacturing' || !ctx.permissions.includes(permission)) throw new ForbiddenException('没有此制造业务权限');
  }

  private async write<T>(
    ctx: RequestContext, permission: string, operation: string, input: { requestKey: string },
    run: (tx: Transaction, context: RequestContext) => Promise<T>,
  ): Promise<T> {
    this.require(ctx, permission);
    const result = await this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ctx.tenantId + ':manufacturing'}, 0))`;
      const members = await tx.$queryRaw<{ role: string }[]>`
        SELECT m.role FROM "Membership" m
        JOIN "User" u ON u.id = m."userId"
        JOIN "Tenant" t ON t.id = m."tenantId"
        WHERE m.id = ${ctx.membershipId} AND m."tenantId" = ${ctx.tenantId}
          AND m."userId" = ${ctx.userId} AND m.active AND u.active AND t.active
        FOR SHARE OF m, u, t`;
      const installed = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "TenantApp" WHERE "tenantId" = ${ctx.tenantId}
          AND "appId" = 'manufacturing' AND enabled AND granted FOR SHARE`;
      const member = members[0];
      if (!member || !installed.length || !(await manufacturingPermissions(tx, ctx.tenantId, member.role, ctx.membershipId)).includes(permission))
        throw new ForbiddenException('成员或应用权限已变化');

      const scope = { tenantId: ctx.tenantId, membershipId: ctx.membershipId, requestKey: input.requestKey };
      const signature = fingerprint({ operation, input });
      const previous = await tx.manufacturingReceipt.findUnique({ where: { tenantId_membershipId_requestKey: scope } });
      if (previous) {
        if (previous.fingerprint !== signature) conflict('同一次操作的内容已变化，请重新提交');
        return previous.result;
      }

      const saved = await run(tx, { ...ctx, roles: [member.role], requestId: input.requestKey });
      const json = JSON.parse(JSON.stringify(saved)) as Prisma.InputJsonValue;
      await tx.manufacturingReceipt.create({ data: { ...scope, fingerprint: signature, result: json } });
      await tx.auditEvent.create({ data: {
        tenantId: ctx.tenantId, userId: ctx.userId, membershipId: ctx.membershipId, requestId: input.requestKey,
        appId: 'manufacturing', action: 'manufacturing.' + operation.split(':')[0], resourceType: 'Manufacturing',
        resourceId: (saved as { id?: string }).id ?? input.requestKey, detail: json,
      } });
      return json;
    }, { timeout: 20_000 });
    return result as T;
  }

  async catalog(ctx: RequestContext, raw: unknown) {
    this.require(ctx, 'manufacturing.read');
    const q = readBody(listInput, raw);
    const [erp, mes, boms] = await Promise.all([
      this.erp.catalog(this.db, ctx, q.q),
      this.mes.list(ctx, 'materials', { q: q.q, active: 'true', page: q.page, page_size: 100 }),
      this.mes.list(ctx, 'boms', { q: q.q, status: 'published', page: q.page, page_size: 100 }),
    ]);
    const materials = mes.items as { id: string; name: string; sku: string; unit: string; kind: string }[];
    const links = await this.db.manufacturingItem.findMany({
      where: { tenantId: ctx.tenantId, materialId: { in: materials.map(m => m.id) } },
    });
    return { ...erp, materials, links, materialTotal: mes.total, boms: boms.items.map(({ id, productId, revision, productName, productSku }: { id: string; productId: string; revision: number; productName: string; productSku: string }) => ({ id, productId, revision, productName, productSku })) };
  }

  createParty(ctx: RequestContext, raw: unknown) {
    const input = readBody(partyInput, raw);
    return this.write(ctx, 'manufacturing.setup', 'create_party', input, async (tx, c) => {
      const item = await this.erp.createParty(tx, c, input.kind, { code: input.code, name: input.name });
      return { id: item.id, code: item.code, name: item.name };
    });
  }

  createItem(ctx: RequestContext, raw: unknown) {
    const input = readBody(itemInput, raw);
    return this.write(ctx, 'manufacturing.setup', 'create_item', input, async (tx, c) => {
      const { requestKey, kind, ...fields } = input;
      const material = await this.mes.saveMaterial(c, undefined, { requestKey, kind, ...fields }, tx);
      const product = await this.erp.createProduct(tx, c, { ...fields, salePrice: '0', purchasePrice: '0' });
      await tx.manufacturingItem.create({ data: { tenantId: c.tenantId, materialId: material.id, productId: product.id } });
      return { id: material.id, productId: product.id, sku: input.sku, name: input.name };
    });
  }

  linkItem(ctx: RequestContext, raw: unknown) {
    const input = readBody(linkInput, raw);
    return this.write(ctx, 'manufacturing.setup', 'link_item', input, async (tx, c) => {
      const [product, material] = await Promise.all([
        this.erp.product(tx, c, input.productId), this.mes.get(c, 'material', input.materialId, tx),
      ]);
      if (!material.active || bomUnitKey(material.unit) !== bomUnitKey(product.unit))
        conflict('请选择有效且基础单位一致的物料和库存商品');
      if (await tx.manufacturingItem.findFirst({ where: {
        tenantId: c.tenantId, OR: [{ materialId: material.id }, { productId: product.id }],
      } })) conflict('物料或库存商品已建立关联');
      await tx.manufacturingItem.create({ data: { tenantId: c.tenantId, materialId: material.id, productId: product.id } });
      return { id: material.id, productId: product.id };
    });
  }

  createBom(ctx: RequestContext, raw: unknown) {
    const input = readBody(key.extend({ draft: bomDraft }), raw);
    return this.write(ctx, 'manufacturing.setup', 'publish_bom', input, async (tx, c) => {
      const ids = [input.draft.productId, ...input.draft.lines.map(l => l.materialId)];
      if (await tx.manufacturingItem.count({ where: { tenantId: c.tenantId, materialId: { in: ids } } }) !== new Set(ids).size)
        conflict('请先为成品和组件建立库存物料关联');
      const draft = await this.mes.saveBom(c, undefined, input, tx);
      const result = await this.mes.publishBom(c, draft.id, { requestKey: input.requestKey, version: draft.version }, tx);
      return { id: result.id, revision: result.revision, productName: result.productName };
    });
  }

  async orders(ctx: RequestContext, raw: unknown) {
    this.require(ctx, 'manufacturing.read');
    const query = readBody(listInput, raw);
    const where = { tenantId: ctx.tenantId, ...(query.q ? { OR: ['number', 'productName', 'customerName'].map(field => ({
      [field]: { contains: query.q, mode: 'insensitive' as const },
    })) } : {}) };
    const [items, total] = await Promise.all([
      this.db.manufacturingOrder.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 25, skip: (query.page - 1) * 25 }),
      this.db.manufacturingOrder.count({ where }),
    ]);
    return { items, total, page: query.page, page_size: 25 };
  }

  private async getOrder(tx: Transaction, ctx: RequestContext, id: string) {
    const order = await tx.manufacturingOrder.findFirst({ where: { id, tenantId: ctx.tenantId }, include: orderDetail });
    if (!order) failNotFound('制造订单');
    return order;
  }

  async order(ctx: RequestContext, rawId: string) {
    this.require(ctx, 'manufacturing.read');
    const id = readBody(z.uuid(), rawId);
    return this.db.$transaction(async tx => {
      const order = await this.getOrder(tx, ctx, id);
      const purchaseIds = order.purchases.map(p => p.purchaseId);
      const [supply, documents, warehouse, plan] = await Promise.all([
        this.supply(tx, ctx, order),
        this.erp.documents(tx, ctx, order.id, purchaseIds),
        this.erp.warehouseDetails(tx, ctx, order.warehouseId),
        findPlan(tx, order.id),
      ]);
      const production = progress(plan);
      const available = order.requirements.reduce((limit, row) =>
        Math.min(limit, row.issued.mul(order.quantity).div(row.quantity).floor().toNumber()), order.quantity);
      return {
        ...order, warehouse, ...supply, documents, plan, production, actorMembershipId: ctx.membershipId,
        readyToComplete: Math.max(0, Math.min(available, plan ? production.good : order.quantity) - order.completedQty),
        canApproveDraft: ctx.roles.includes('admin') && !await this.erp.requiresPurchaseSubmission(tx, ctx),
      };
    }, { isolationLevel: 'RepeatableRead' });
  }

  createOrder(ctx: RequestContext, raw: unknown) {
    const input = readBody(orderInput, raw);
    return this.write(ctx, 'manufacturing.order', 'create_order', input, async (tx, c) => {
      const customer = await this.erp.customer(tx, c, input.customerId);
      const wh = await this.erp.warehouse(tx, c, input.warehouseId);
      if (!wh.active) conflict('所选仓库已停用');
      const material = await this.mes.get(c, 'material', input.materialId, tx);
      if (material.kind !== 'finished' || !material.active) conflict('请选择有效的成品物料');
      const snapshot = await this.mes.manufacturingSnapshot(c, material.id, input.quantity, tx);
      const links = await tx.manufacturingItem.findMany({
        where: { tenantId: c.tenantId, materialId: { in: [material.id, ...snapshot.requirements.map(r => r.materialId)] } },
      });
      const ids = new Map(links.map(l => [l.materialId, l.productId]));
      const productId = ids.get(material.id);
      if (!productId) conflict('成品还没有关联库存商品');
      const product = await this.erp.product(tx, c, productId);
      if (bomUnitKey(material.unit) !== bomUnitKey(product.unit)) conflict('成品的BOM单位和库存单位不一致');
      const requirements = await Promise.all(snapshot.requirements.map(async row => {
        const id = ids.get(row.materialId);
        if (!id) conflict(`物料 ${row.sku} 还没有关联库存商品`);
        const item = await this.erp.product(tx, c, id);
        if (bomUnitKey(row.unit) !== bomUnitKey(item.unit)) conflict(`物料 ${row.sku} 的BOM单位和库存单位不一致`);
        const quantity = new D(row.quantity);
        if (quantity.lte(0) || quantity.gt(1e9)) conflict(`物料 ${row.sku} 的需求量超过可处理范围`);
        return { productId: id, sku: item.sku, name: item.name, unit: item.unit, quantity };
      }));
      if (!requirements.length) conflict('BOM没有可领用的组件');
      const order = await tx.manufacturingOrder.create({ data: {
        tenantId: c.tenantId, number: input.number, customerId: customer.id, customerName: customer.name,
        productId, productName: product.name, sku: product.sku, warehouseId: wh.id,
        createdBy: c.membershipId, quantity: input.quantity, salesStatus: input.approvalRequired ? 'pending_approval' : 'confirmed', dueDate: input.dueDate,
        bomId: snapshot.bom.id, bomRevision: snapshot.bom.revision, bomVersions: snapshot.bomVersions,
        requirements: { create: requirements },
      } });
      return { id: order.id, number: order.number, version: order.version };
    });
  }

  private async supply(tx: Transaction, ctx: RequestContext, order: Order) {
    const [stock, purchases, holds] = await Promise.all([
      this.erp.balances(tx, ctx, order.warehouseId, [...order.requirements.map(r => r.productId), order.productId]),
      this.erp.purchases(tx, ctx, order.purchases.map(p => p.purchaseId)),
      this.erp.held(tx, ctx, order.warehouseId, [...order.requirements.map(r => r.productId), order.productId]),
    ]);
    const allocations = (productId: string) => {
      const rows = holds.filter(h => h.productId === productId);
      const own = rows.find(h => h.orderId === order.id)?.quantity ?? new D(0);
      const others = rows.filter(h => h.orderId !== order.id).reduce((sum, h) => sum.plus(h.quantity), new D(0));
      return { own, available: D.max(0, new D(stock.get(productId) ?? 0).minus(others)) };
    };
    const requirements = order.requirements.map(row => {
      let incoming = new D(0), pending = new D(0);
      for (const purchase of purchases) {
        const line = purchase.lines.find(l => l.productId === row.productId);
        if (!line) continue;
        if (['ordered', 'partial_received'].includes(purchase.status)) incoming = incoming.add(remainingPurchase(line));
        if (['draft', 'pending_approval'].includes(purchase.status)) pending = pending.add(remainingPurchase(line));
      }
      const onHand = new D(stock.get(row.productId) ?? 0);
      const left = row.quantity.minus(row.issued);
      const allocation = allocations(row.productId);
      const shortage = D.max(0, left.minus(allocation.available)).toDecimalPlaces(3, D.ROUND_UP);
      return {
        productId: row.productId, sku: row.sku, name: row.name, unit: row.unit, quantity: row.quantity,
        issued: row.issued, consumed: row.consumed, onHand, pending, incoming, shortage,
        available: allocation.available, reserved: allocation.own,
        suggested: D.max(0, shortage.minus(incoming).minus(pending)).toDecimalPlaces(3, D.ROUND_UP),
      };
    });
    return { requirements, purchases, finishedOnHand: stock.get(order.productId) ?? 0,
      finishedAvailable: allocations(order.productId).available, finishedReserved: allocations(order.productId).own };
  }

  action(ctx: RequestContext, rawId: string, raw: unknown) {
    const id = readBody(z.uuid(), rawId);
    const input = readBody(actionInput, raw);
    return this.write(ctx, actionPermission[input.action], input.action + ':' + id, input, async (tx, c) => {
      const order = await this.getOrder(tx, c, id);
      if (input.action === 'review_order') {
        this.checkVersion(order, input.version);
        if (order.salesStatus !== 'pending_approval') conflict('当前订单没有待审核接单');
        if (order.createdBy === c.membershipId) conflict('接单人不能审核自己的订单');
        if (input.decision === 'rejected' && !input.reason) conflict('请填写退回原因');
        return tx.manufacturingOrder.update({ where: { id }, data: {
          salesStatus: input.decision, salesReviewNote: input.reason, version: { increment: 1 },
        }, select: { id: true, number: true, salesStatus: true } });
      }
      if (order.salesStatus !== 'confirmed') conflict('订单未确认，暂不可办理');
      switch (input.action) {
        case 'purchase': return this.createPurchase(tx, c, order, input);
        case 'submit':
        case 'approve':
        case 'close_purchase':
        case 'receive': return this.purchaseAction(tx, c, order, input);
        case 'issue':
        case 'return': return this.moveMaterial(tx, c, order, input);
        case 'complete': return this.complete(tx, c, order, input.version, input.quantity, input.tracking);
        case 'ship': return this.ship(tx, c, order, input.version, input.quantity, input.tracking);
        case 'hold': return this.hold(tx, c, order, input);
      }
    });
  }

  private async createPurchase(tx: Transaction, ctx: RequestContext, order: Order, input: Extract<OrderAction, { action: 'purchase' }>) {
    const { requirements } = await this.supply(tx, ctx, order);
    for (const line of input.lines) {
      const item = requirements.find(r => r.productId === line.productId);
      if (!item || item.suggested.lt(line.quantity)) conflict('采购数量超过当前待补量，请刷新订单后重试');
      const product = await this.erp.product(tx, ctx, line.productId);
      if (bomUnitKey(product.unit) !== bomUnitKey(item.unit)) conflict('物料基础单位已变化，请核对订单');
    }
    const number = 'MP-' + input.requestKey;
    const purchase = await this.erp.createPurchase(tx, ctx, { number, supplierId: input.supplierId, note: `制造订单 ${order.number}`, lines: input.lines });
    await tx.manufacturingPurchase.create({ data: { orderId: order.id, purchaseId: purchase.id } });
    return { id: purchase.id, number, status: purchase.status };
  }

  private async purchaseAction(tx: Transaction, ctx: RequestContext, order: Order, input: Extract<OrderAction, { purchaseId: string }>) {
    if (!order.purchases.some(p => p.purchaseId === input.purchaseId)) failNotFound('关联采购单');
    return this.operatePurchase(tx, ctx, order.warehouseId, input);
  }

  private async operatePurchase(tx: Transaction, ctx: RequestContext, warehouseId: string, input: {
    action: 'submit' | 'approve' | 'receive' | 'close_purchase'; purchaseId: string; version: number;
    lines?: { lineId: string; quantity: number; tracking?: Tracking }[]; reason?: string;
  }) {
    const { purchaseId, version } = input;
    if (input.action === 'submit') {
      const saved = await this.erp.submitPurchase(tx, ctx, purchaseId, version);
      return { id: saved.id, number: saved.number, status: saved.status };
    }
    if (input.action === 'approve') {
      const saved = await this.erp.approvePurchase(tx, ctx, purchaseId, version);
      return { id: saved.id, number: saved.number, status: saved.status };
    }
    if (input.action === 'close_purchase') {
      if (!input.reason) conflict('请填写关闭原因');
      const result = await this.erp.closePurchase(tx, ctx, purchaseId, input.version, input.reason);
      return { id: purchaseId, ...result };
    }
    if (!input.lines) conflict('请填写本次实际收货数量');
    const saved = await this.erp.receivePurchase(tx, ctx, purchaseId, { version, warehouseId, lines: input.lines });
    return { id: saved.id, number: saved.number, status: saved.status };
  }

  private checkVersion(order: Order, version: number) {
    if (order.version !== version) conflict('订单库存作业已变化，请刷新订单');
  }

  private costPortion(row: Requirement, quantity: Prisma.Decimal) {
    const unused = row.issued.minus(row.consumed);
    return quantity.eq(unused) ? row.wipValue : row.wipValue.mul(quantity).div(unused).toDecimalPlaces(2);
  }

  private async moveMaterial(tx: Transaction, ctx: RequestContext, order: Order, input: Extract<OrderAction, { action: 'issue' | 'return' }>) {
    this.checkVersion(order, input.version);
    const row = order.requirements.find(r => r.productId === input.productId);
    if (!row) failNotFound('工单用料');
    const quantity = new D(input.quantity);
    const issue = input.action === 'issue';
    const left = issue ? row.quantity.minus(row.issued) : row.issued.minus(row.consumed);
    if (quantity.gt(left)) conflict(issue ? '领料数量超过工单剩余需求' : '退料数量超过已领未耗用数量');
    if (!issue) await requireReturnable(tx, this.erp, ctx, order.id, row.productId, input.quantity, input.tracking);
    const product = await this.erp.product(tx, ctx, row.productId);
    if (bomUnitKey(row.unit) !== bomUnitKey(product.unit)) conflict('物料基础单位已变化，请核对订单');
    const doc = await this.erp.post(tx, ctx, {
      orderId: order.id, warehouseId: order.warehouseId, kind: issue ? 'material_issue' : 'material_return',
      lines: [{ productId: row.productId, quantity: input.quantity, tracking: input.tracking, ...(issue ? {} : { costAmount: this.costPortion(row, quantity), costEstimated: true }) }],
    });
    const value = doc.movements[0].costAmount ?? new D(0);
    await tx.manufacturingRequirement.update({ where: { orderId_productId: { orderId: order.id, productId: row.productId } }, data: {
      issued: issue ? row.issued.plus(quantity) : row.issued.minus(quantity),
      wipValue: issue ? row.wipValue.plus(value) : row.wipValue.minus(value),
    } });
    await tx.manufacturingOrder.update({ where: { id: order.id }, data: { version: { increment: 1 } } });
    return { id: doc.id, number: doc.number };
  }

  private async complete(tx: Transaction, ctx: RequestContext, order: Order, version: number, quantity: number, tracking?: Tracking) {
    this.checkVersion(order, version);
    const total = order.completedQty + quantity;
    if (total > order.quantity) conflict('成品入库数量超过工单剩余量');
    const plan = await findPlan(tx, order.id);
    if (plan && total > progress(plan).good) conflict('成品入库超过已审核合格数量');
    let value = new D(0);
    const uses: Awaited<ReturnType<typeof allocateMaterial>> = [];
    for (const row of order.requirements) {
      const consumed = row.quantity.mul(total).div(order.quantity).toDecimalPlaces(3, D.ROUND_UP);
      if (consumed.gt(row.issued)) conflict(`物料 ${row.sku} 的已领料量不足以支持本次成品入库`);
      const delta = consumed.minus(row.consumed);
      if (delta.lte(0)) continue;
      uses.push(...await allocateMaterial(tx, this.erp, ctx, order.id, row.productId, delta));
      const cost = this.costPortion(row, delta);
      value = value.plus(cost);
      await tx.manufacturingRequirement.update({ where: { orderId_productId: { orderId: order.id, productId: row.productId } }, data: {
        consumed, wipValue: row.wipValue.minus(cost),
      } });
    }
    const product = await this.erp.product(tx, ctx, order.productId);
    if (bomUnitKey(product.unit) !== 'piece') conflict('成品基础单位已变化，请核对订单');
    const doc = await this.erp.post(tx, ctx, {
      orderId: order.id, warehouseId: order.warehouseId, kind: 'production_receipt',
      lines: [{ productId: order.productId, quantity, tracking, costAmount: value, costEstimated: true }],
    });
    await tx.manufacturingMaterialUse.createMany({ data: uses.map(use => ({ ...use, orderId: order.id, documentId: doc.id })) });
    await tx.manufacturingOrder.update({ where: { id: order.id }, data: { completedQty: total, version: { increment: 1 } } });
    return { id: doc.id, number: doc.number };
  }

  private async ship(tx: Transaction, ctx: RequestContext, order: Order, version: number, quantity: number, tracking?: Tracking) {
    this.checkVersion(order, version);
    const total = order.shippedQty + quantity;
    if (total > order.completedQty) conflict('发货数量超过本订单已入库且未发货的成品量');
    await requireShippable(tx, this.erp, ctx, order.id, order.productId, quantity, tracking);
    const product = await this.erp.product(tx, ctx, order.productId);
    if (bomUnitKey(product.unit) !== 'piece') conflict('成品基础单位已变化，请核对订单');
    const doc = await this.erp.post(tx, ctx, {
      orderId: order.id, warehouseId: order.warehouseId, kind: 'manufacturing_shipment',
      lines: [{ productId: order.productId, quantity, tracking }],
    });
    await tx.manufacturingOrder.update({ where: { id: order.id }, data: { shippedQty: total, version: { increment: 1 } } });
    return { id: doc.id, number: doc.number };
  }
  private async hold(tx: Transaction, ctx: RequestContext, order: Order, input: Extract<OrderAction, { action: 'hold' }>) {
    this.checkVersion(order, input.version);
    const row = order.requirements.find(r => r.productId === input.productId);
    const max = row ? row.quantity.minus(row.issued) : input.productId === order.productId ? new D(order.completedQty - order.shippedQty) : null;
    if (!max || max.lt(input.quantity)) conflict('锁定量超过本单未领或未发的数量');
    await this.erp.setHold(tx, ctx, { warehouseId: order.warehouseId, productId: input.productId, orderId: order.id, quantity: input.quantity });
    await tx.manufacturingOrder.update({ where: { id: order.id }, data: { version: { increment: 1 } } });
    return { id: order.id, reserved: input.quantity };
  }

  async stock(ctx: RequestContext, raw: unknown) {
    this.require(ctx, 'manufacturing.read');
    const input = readBody(warehouseQuery, raw);
    return this.db.$transaction(async tx => {
      const warehouses = await this.erp.warehouses(tx, ctx);
      const warehouseId = input.warehouseId ?? warehouses.find(w => w.code === 'DEFAULT')?.id ?? warehouses[0]?.id;
      const result = warehouseId ? await this.erp.warehouseStock(tx, ctx, warehouseId, { ...input, alerts: input.alerts === 'true' })
        : { items: [], total: 0, page: input.page, page_size: 25 };
      const links = warehouseId ? await tx.manufacturingWarehousePurchase.findMany({
        where: { tenantId: ctx.tenantId, warehouseId }, orderBy: { createdAt: 'desc' },
      }) : [];
      const purchases = await this.erp.purchases(tx, ctx, links.map(p => p.purchaseId));
      const items = result.items.map(row => ({
        ...row, suggested: safetyReplenishment(row.id, row.reorderPoint, row.available, purchases),
      }));
      const history = purchases.filter(p => ['received', 'cancelled', 'closed', 'rejected'].includes(p.status)).slice(-25);
      const active = purchases.filter(p => !['received', 'cancelled', 'closed', 'rejected'].includes(p.status));
      return { warehouses, warehouseId, ...result, items, purchases: [...active, ...history], actorMembershipId: ctx.membershipId,
        canApproveDraft: ctx.roles.includes('admin') && !await this.erp.requiresPurchaseSubmission(tx, ctx) };
    }, { isolationLevel: 'RepeatableRead' });
  }

  warehouseAction(ctx: RequestContext, raw: unknown) {
    const input = readBody(warehouseAction, raw);
    const permission = ['warehouse', 'threshold'].includes(input.action) ? 'manufacturing.setup'
      : ['replenish', 'submit'].includes(input.action) ? 'manufacturing.buy'
      : ['approve', 'close_purchase'].includes(input.action) ? 'manufacturing.approve' : 'manufacturing.stock';
    return this.write(ctx, permission, input.action, input, async (tx, c) => {
      if (input.action === 'replenish') {
        await this.erp.warehouse(tx, c, input.warehouseId);
        const links = await tx.manufacturingWarehousePurchase.findMany({ where: { tenantId: c.tenantId, warehouseId: input.warehouseId } });
        const purchases = await this.erp.purchases(tx, c, links.map(l => l.purchaseId));
        const needed = await this.erp.replenishmentNeed(tx, c, input.warehouseId, input.line.productId, purchases);
        if (input.line.quantity > needed) conflict('超过安全库存待补量，请核对实存、锁库和已提交采购');
        const number = 'SR-' + input.requestKey;
        const draft = await this.erp.createPurchase(tx, c, { number, supplierId: input.supplierId,
          lines: [input.line], note: '安全库存补货' });
        await tx.manufacturingWarehousePurchase.create({ data: { tenantId: c.tenantId, warehouseId: input.warehouseId, purchaseId: draft.id } });
        return { id: draft.id, number, status: draft.status };
      }
      if ('purchaseId' in input) {
        const link = await tx.manufacturingWarehousePurchase.findFirst({
          where: { tenantId: c.tenantId, warehouseId: input.warehouseId, purchaseId: input.purchaseId },
        });
        if (!link) failNotFound('仓库补货采购单');
        return this.operatePurchase(tx, c, input.warehouseId, input);
      }
      if (input.action === 'warehouse') {
        return this.erp.saveWarehouse(tx, c, { code: input.code, name: input.name });
      }
      if (input.action === 'threshold') {
        return this.erp.threshold(tx, c, input.productId, input.quantity);
      }
      if (input.action === 'transfer') {
        return this.erp.transfer(tx, c, { ...input, number: 'TR-' + input.requestKey });
      }
      return this.erp.stocktake(tx, c, { warehouseId: input.warehouseId, documentNumber: 'CT-' + input.requestKey, lines: [
        { productId: input.productId, countedQty: input.quantity, version: input.version, tracking: input.tracking },
      ] });
    });
  }

  async scan(ctx: RequestContext, raw: unknown) {
    this.require(ctx, 'manufacturing.read');
    const code = readBody(label(100), raw);
    return this.db.$transaction(async tx => {
      const result = await this.erp.scan(tx, ctx, code);
      const downstream = await tx.manufacturingMaterialUse.findMany({
        where: { code, order: { tenantId: ctx.tenantId } },
        orderBy: { id: 'asc' }, take: 100,
        select: { productId: true, quantity: true, documentId: true, order: { select: { id: true, number: true } } },
      });
      const upstream = await tx.manufacturingMaterialUse.findMany({
        where: { documentId: { in: result.movements.filter(m => m.sourceType === 'production_receipt').map(m => m.document.id) },
          order: { tenantId: ctx.tenantId } },
        orderBy: { id: 'asc' }, take: 100,
        select: { productId: true, quantity: true, documentId: true, code: true, kind: true, order: { select: { id: true, number: true } } },
      });
      const outputs = await this.erp.traceOutputs(tx, ctx, [...new Set(downstream.map(row => row.documentId))]);
      const productIds = new Set(result.products.map(p => p.id));
      const referenced = [...new Set([...upstream, ...downstream, ...outputs.flatMap(doc => doc.movements)].map(row => row.productId))];
      const extra = await this.erp.traceProducts(tx, ctx, referenced.filter(id => !productIds.has(id)));
      return { ...result, products: [...result.products, ...extra], upstream, downstream, outputs };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async team(ctx: RequestContext) {
    this.require(ctx, 'manufacturing.read');
    const [members, grants] = await Promise.all([
      this.db.membership.findMany({ where: { tenantId: ctx.tenantId, active: true, user: { active: true } },
        select: { id: true, role: true, user: { select: { name: true } } }, orderBy: { id: 'asc' } }),
      this.db.manufacturingMemberGrant.findMany({ where: { tenantId: ctx.tenantId } }),
    ]);
    return members.map(m => ({
      id: m.id, name: m.user.name, role: m.role, productionRole: grants.find(g => g.membershipId === m.id)?.role ?? null,
    }));
  }

  grantTeam(ctx: RequestContext, raw: unknown) {
    const input = readBody(teamInput, raw);
    return this.write(ctx, 'manufacturing.setup', 'team_grant', input, async (tx, c) => {
      const member = await tx.membership.findFirst({ where: { tenantId: c.tenantId, id: input.membershipId, active: true, user: { active: true } } });
      if (!member || member.role === 'admin') conflict('请选择有效的非管理员成员');
      const identity = { tenantId: c.tenantId, membershipId: member.id };
      if (input.role) await tx.manufacturingMemberGrant.upsert({ where: { tenantId_membershipId: identity },
        create: { ...identity, role: input.role }, update: { role: input.role } });
      else await tx.manufacturingMemberGrant.deleteMany({ where: identity });
      return { id: member.id, productionRole: input.role };
    });
  }

  productionAction(ctx: RequestContext, rawId: string, raw: unknown) {
    const id = readBody(z.uuid(), rawId);
    const input = readBody(productionAction, raw);
    return this.write(ctx, productionPermission[input.action], input.action + ':' + id, input, async (tx, c) => {
      const order = await this.getOrder(tx, c, id);
      if (order.salesStatus !== 'confirmed') conflict('订单未确认，暂不可排产');
      return runProduction(tx, c, order, input);
    });
  }

}
