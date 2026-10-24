import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { CSV_FIELDS, encodeCsv, parseCsv, type MasterKind } from './master-csv';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../platform/auth.service';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
import { audit, conflict, decimal, failNotFound, label, money, ownerFilter, pageQuery } from './erp.common';
import { pricedLine, tradeLineInput } from './trade.common';

const customerInput = z.object({ code: label(60), name: label(), contactName: z.string().trim().max(100).optional(), phone: z.string().trim().max(50).optional(), industry: z.string().trim().max(100).optional(), address: z.string().trim().max(500).optional(), taxNumber: z.string().trim().max(80).optional(), paymentDays: z.int().min(0).max(3650).default(0), creditLimit: money.nullable().optional(), inPool: z.boolean().optional() });
const customerPatch = customerInput.omit({ code: true, inPool: true }).partial().extend({ active: z.boolean().optional() });
const customerTransfer = z.object({ expectedOwnerMembershipId: z.uuid().nullable(), newOwnerMembershipId: z.uuid().nullable(), reason: label(500) }).refine(input => input.expectedOwnerMembershipId !== input.newOwnerMembershipId, '负责人没有变化');
const productInput = z.object({ sku: label(80), name: label(), category: z.string().trim().max(100).optional(), unit: label(20).default('件'), salePrice: money, purchasePrice: money, reorderPoint: z.number().min(0).max(1_000_000_000).refine(x=>Math.abs(x*1e6-Math.round(x*1e6))<1e-6,"阈值最多六位小数").default(0) });
const productPatch = productInput.omit({ sku: true }).partial().extend({ active: z.boolean().optional() });
const supplierInput = z.object({ address: z.string().trim().max(500).optional(), taxNumber: z.string().trim().max(80).optional(), paymentDays: z.int().min(0).max(3650).default(0), code: label(60), name: label(), contactName: z.string().trim().max(100).optional(), phone: z.string().trim().max(50).optional() });
const supplierPatch = supplierInput.omit({ code: true }).partial().extend({ active: z.boolean().optional() });

@Injectable()
export class MasterService {
  constructor(private readonly db: PrismaService, private readonly auth: AuthService) {}
  private need(ctx: RequestContext, permission: string) { this.auth.require(ctx, permission); }
  private role(ctx: RequestContext, allowed: string[]) { if (!allowed.some(x => ctx.roles.includes(x))) throw new ForbiddenException('没有此业务权限'); }

  private importRows(ctx: RequestContext, kind: MasterKind, csv: string) {
    this.role(ctx, kind === 'customers' ? ['admin', 'sales'] : ['admin', 'purchasing']);
    const [header, ...rows] = parseCsv(csv);
    const fields = CSV_FIELDS[kind];
    const keys = header.map(name => Object.keys(fields).find(key => fields[key] === name.trim()));
    if (keys.some(key => !key) || new Set(keys).size !== keys.length) throw new BadRequestException('表头不符合模板或存在重复列，请下载对应模板');
    const required = kind === 'products' ? ['sku', 'name', 'salePrice', 'purchasePrice'] : ['code', 'name'];
    if (required.some(key => !keys.includes(key))) throw new BadRequestException('CSV 缺少必填列，请下载对应模板');
    const schema = kind === 'customers' ? customerInput : kind === 'products' ? productInput : supplierInput;
    const errors: { row: number; message: string }[] = [], seen = new Set<string>();
    const inputs = rows.map((row, index) => {
      if (row.length !== header.length) { errors.push({ row: index + 2, message: '列数与表头不一致' }); return null; }
      const input: Record<string, unknown> = Object.fromEntries(keys.map((key, i) => [key!, row[i].trim()]));
      if (kind === 'products') {
        if (!input.unit) input.unit = '件';
        const point = input.reorderPoint ?? '';
        input.reorderPoint = point === '' ? 0 : /^\d+(\.\d{1,6})?$/.test(String(point)) ? Number(point) : NaN;
      }
      const parsed = schema.safeParse(input);
      if (!parsed.success) { errors.push({ row: index + 2, message: parsed.error.issues.map(issue => `${fields[String(issue.path[0])] ?? '资料'}：${issue.message}`).join('；') }); return null; }
      const code = String(input[kind === 'products' ? 'sku' : 'code']);
      if (seen.has(code)) errors.push({ row: index + 2, message: '文件内编号重复' });
      seen.add(code);
      return parsed.data;
    });
    return { inputs, errors };
  }

  async previewImport(ctx: RequestContext, kind: MasterKind, body: unknown) {
    const { csv } = readBody(z.object({ csv: z.string().max(524288) }), body);
    const parsed = this.importRows(ctx, kind, csv);
    const codes = parsed.inputs.flatMap(input => input ? [String('sku' in input ? input.sku : input.code)] : []);
    const stored = kind === 'customers' ? await this.db.erpCustomer.findMany({ where: { tenantId: ctx.tenantId, code: { in: codes } }, select: { code: true } }) : kind === 'products' ? await this.db.erpProduct.findMany({ where: { tenantId: ctx.tenantId, sku: { in: codes } }, select: { sku: true } }) : await this.db.erpSupplier.findMany({ where: { tenantId: ctx.tenantId, code: { in: codes } }, select: { code: true } });
    const exists = new Set(stored.map(item => 'sku' in item ? item.sku : item.code));
    parsed.inputs.forEach((input, index) => { if (input && exists.has(String('sku' in input ? input.sku : input.code))) parsed.errors.push({ row: index + 2, message: '当前企业已有该编号，不会覆盖原资料' }); });
    return { total: parsed.inputs.length, valid: !parsed.errors.length, errors: parsed.errors, columns: CSV_FIELDS[kind], items: parsed.inputs.slice(0, 10) };
  }

  async importMaster(ctx: RequestContext, kind: MasterKind, body: unknown) {
    const input = readBody(z.object({ requestKey: z.uuid(), csv: z.string().max(524288) }), body);
    const parsed = this.importRows(ctx, kind, input.csv);
    if (parsed.errors.length) throw new BadRequestException('资料校验失败，请先预览并修改错误');
    const hash = createHash('sha256').update(kind + '\n' + input.csv).digest('hex');
    return this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`import:${ctx.tenantId}:${ctx.membershipId}:${input.requestKey}`}, 0))`;
      const previous = await tx.auditEvent.findFirst({ where: { tenantId: ctx.tenantId, membershipId: ctx.membershipId, action: 'erp.master.import', resourceId: input.requestKey }, select: { detail: true } });
      if (previous) { const receipt = previous.detail as { hash: string; count: number; kind: string }; if (receipt.hash !== hash) conflict('导入请求已使用，请重新预览'); return { count: receipt.count, kind: receipt.kind, repeated: true }; }
      for (const value of parsed.inputs) {
        if (!value) throw new BadRequestException('资料校验失败');
        let item: { id: string };
        if (kind === 'customers') {
          const data = customerInput.parse(value); const { inPool: _unused, ...customer } = data;
          item = await tx.erpCustomer.create({ data: { ...customer, tenantId: ctx.tenantId, ownerMembershipId: ctx.membershipId } });
        } else if (kind === 'products') {
          const data = productInput.parse(value);
          item = await tx.erpProduct.create({ data: { ...data, tenantId: ctx.tenantId, salePrice: decimal(data.salePrice), purchasePrice: decimal(data.purchasePrice), balance: { create: { tenantId: ctx.tenantId } } } });
        } else item = await tx.erpSupplier.create({ data: { ...supplierInput.parse(value), tenantId: ctx.tenantId } });
        await audit(tx, ctx, `erp.${kind === 'customers' ? 'customer' : kind === 'products' ? 'product' : 'supplier'}.create`, kind === 'customers' ? 'Customer' : kind === 'products' ? 'Product' : 'Supplier', item.id, { importRequestKey: input.requestKey });
      }
      await audit(tx, ctx, 'erp.master.import', 'MasterImport', input.requestKey, { kind, count: parsed.inputs.length, hash });
      return { count: parsed.inputs.length, kind, repeated: false };
    }, { timeout: 30000 });
  }

  async exportMaster(ctx: RequestContext, kind: MasterKind, query: unknown) {
    if (kind === 'customers') this.role(ctx, ['admin', 'sales', 'finance']);
    else if (kind === 'products') this.need(ctx, 'erp.master.read');
    else this.role(ctx, ['admin', 'purchasing', 'warehouse', 'finance']);
    const q = readBody(pageQuery.pick({ q: true }), query);
    const codeKey = kind === 'products' ? 'sku' : 'code';
    const where = { tenantId: ctx.tenantId, ...(kind === 'customers' ? ownerFilter(ctx) : {}), ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' as const } }, { [codeKey]: { contains: q.q, mode: 'insensitive' as const } }] } : {}) };
    // A single statement returns a coherent snapshot, with no pagination drift during export.
    const options = { where, orderBy: { id: 'asc' as const }, take: 10001 };
    const items = kind === 'customers' ? await this.db.erpCustomer.findMany(options) : kind === 'products' ? await this.db.erpProduct.findMany(options) : await this.db.erpSupplier.findMany(options);
    if (items.length > 10000) throw new BadRequestException('每次最多导出 10000 条，请缩小搜索范围');
    const fields = CSV_FIELDS[kind];
    await this.db.$transaction(tx => audit(tx, ctx, 'erp.master.export', 'MasterExport', randomUUID(), { kind, count: items.length, query: q.q ?? '' }));
    return { filename: `${kind}-${new Date().toISOString().slice(0, 10)}.csv`, total: items.length, csv: encodeCsv([Object.values(fields), ...items.map(item => Object.keys(fields).map(key => (item as unknown as Record<string, unknown>)[key]))]) };
  }

  async customers(ctx: RequestContext, query: unknown) {
    this.role(ctx, ['admin', 'sales', 'finance']);
    const q = readBody(pageQuery.extend({id:z.uuid().optional()}), query);
    const where = { tenantId: ctx.tenantId,...(q.id?{id:q.id}:{}), ...ownerFilter(ctx), ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' as const } }, { code: { contains: q.q, mode: 'insensitive' as const } }] } : {}) };
    const [items, total] = await this.db.$transaction([
      this.db.erpCustomer.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.page_size, take: q.page_size }),
      this.db.erpCustomer.count({ where }),
    ]);
    return { items, total, page: q.page, page_size: q.page_size };
  }

  async customerPool(ctx: RequestContext, query: unknown) {
    this.role(ctx, ['admin', 'sales']);
    const q = readBody(pageQuery, query);
    const where = { tenantId: ctx.tenantId, ownerMembershipId: null, active: true, ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' as const } }, { code: { contains: q.q, mode: 'insensitive' as const } }] } : {}) };
    const [items, total] = await this.db.$transaction([
      this.db.erpCustomer.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.page_size, take: q.page_size }),
      this.db.erpCustomer.count({ where }),
    ]);
    return { items, total, page: q.page, page_size: q.page_size };
  }

  async claimCustomer(ctx: RequestContext, id: string) {
    this.role(ctx, ['admin', 'sales']);
    return this.db.$transaction(async tx => {
      const changed = await tx.erpCustomer.updateMany({ where: { id, tenantId: ctx.tenantId, active: true, ownerMembershipId: null }, data: { ownerMembershipId: ctx.membershipId } });
      if (!changed.count) conflict('客户已被领用、停用或不在当前企业公海');
      await audit(tx, ctx, 'erp.customer.claim', 'Customer', id);
      return tx.erpCustomer.findUniqueOrThrow({ where: { id } });
    });
  }

  async transferCustomer(ctx: RequestContext, id: string, body: unknown) {
    this.role(ctx, ['admin']);
    const input = readBody(customerTransfer, body);
    return this.db.$transaction(async tx => {
      const customer = await tx.erpCustomer.findFirst({ where: { id, tenantId: ctx.tenantId, active: true, ownerMembershipId: input.expectedOwnerMembershipId } });
      if (!customer) conflict('客户负责人或状态已变化，请刷新');
      if (input.newOwnerMembershipId) {
        const next = await tx.membership.findFirst({ where: { id: input.newOwnerMembershipId, tenantId: ctx.tenantId, active: true, role: 'sales', user: { active: true } } });
        if (!next) conflict('目标销售成员不可用');
      }
      const opportunities = await tx.erpOpportunity.findMany({ where: { tenantId: ctx.tenantId, customerId: id }, select: { id: true, ownerMembershipId: true } });
      const contracts = await tx.erpSalesContract.findMany({ where: { tenantId: ctx.tenantId, customerId: id }, select: { id: true, ownerMembershipId: true } });
      const receipts = await tx.erpIncomingReceipt.count({ where: { tenantId: ctx.tenantId, customerId: id } });
      const pendingContracts = await tx.erpSalesContract.count({ where: { tenantId: ctx.tenantId, customerId: id, status: 'pending_approval' } });
      const pendingInvoices = await tx.erpInvoiceRequest.count({ where: { tenantId: ctx.tenantId, contract: { customerId: id }, status: 'requested' } });
      const pendingClaims = await tx.erpReceiptClaim.count({ where: { tenantId: ctx.tenantId, receipt: { customerId: id }, status: 'pending' } });
      if (pendingContracts || pendingInvoices || pendingClaims) conflict('客户存在待审核合同、开票或收款认领，请先处理');
      if (opportunities.some(item => item.ownerMembershipId !== input.expectedOwnerMembershipId) || contracts.some(item => item.ownerMembershipId !== input.expectedOwnerMembershipId)) conflict('关联商机或合同负责人不一致，需先核对');
      if (!input.newOwnerMembershipId && (opportunities.length || contracts.length || receipts)) conflict('有商机、合同或到账记录的客户不能退回公海，请转派给销售');
      const changed = await tx.erpCustomer.updateMany({ where: { id, tenantId: ctx.tenantId, active: true, ownerMembershipId: input.expectedOwnerMembershipId }, data: { ownerMembershipId: input.newOwnerMembershipId } });
      if (!changed.count) conflict('客户负责人已变化，请刷新');
      if (input.newOwnerMembershipId) {
        if (opportunities.length) {
          const moved = await tx.erpOpportunity.updateMany({ where: { tenantId: ctx.tenantId, customerId: id, ownerMembershipId: input.expectedOwnerMembershipId! }, data: { ownerMembershipId: input.newOwnerMembershipId } });
          if (moved.count !== opportunities.length) conflict('商机负责人已变化，请刷新');
        }
        if (contracts.length) {
          const moved = await tx.erpSalesContract.updateMany({ where: { tenantId: ctx.tenantId, customerId: id, ownerMembershipId: input.expectedOwnerMembershipId! }, data: { ownerMembershipId: input.newOwnerMembershipId, version: { increment: 1 } } });
          if (moved.count !== contracts.length) conflict('合同负责人已变化，请刷新');
        }
      }
      await audit(tx, ctx, 'erp.customer.transfer', 'Customer', id, { from: input.expectedOwnerMembershipId, to: input.newOwnerMembershipId, reason: input.reason, opportunities: opportunities.length, contracts: contracts.length });
      return tx.erpCustomer.findUniqueOrThrow({ where: { id } });
    }, { isolationLevel: 'Serializable' });
  }

  async customer(ctx: RequestContext, id: string) {
    this.role(ctx, ['admin', 'sales', 'finance']);
    const item = await this.db.erpCustomer.findFirst({ where: { id, tenantId: ctx.tenantId, ...ownerFilter(ctx) } });
    if (!item) failNotFound('客户');
    const [opportunities, contracts] = await Promise.all([
      this.db.erpOpportunity.findMany({ where: { tenantId: ctx.tenantId, customerId: id, ...ownerFilter(ctx) }, orderBy: { createdAt: 'desc' } }),
      this.db.erpSalesContract.findMany({ where: { tenantId: ctx.tenantId, customerId: id, ...ownerFilter(ctx) }, orderBy: { createdAt: 'desc' } }),
    ]);
    return { ...item, opportunities, contracts };
  }

  async draftReferences(ctx: RequestContext, kind: 'purchase' | 'contract', partyCode: string, skus: string[]) {
    this.need(ctx, kind === 'purchase' ? 'erp.purchase.write' : 'erp.sales.write');
    const products = await this.db.erpProduct.findMany({ where: { tenantId: ctx.tenantId, sku: { in: skus }, active: true }, select: { id: true, sku: true, name: true } });
    const party = kind === 'purchase'
      ? await this.db.erpSupplier.findFirst({ where: { tenantId: ctx.tenantId, code: partyCode, active: true }, select: { id: true, code: true, name: true } })
      : await this.db.erpCustomer.findFirst({ where: { tenantId: ctx.tenantId, code: partyCode, active: true, ...ownerFilter(ctx) }, select: { id: true, code: true, name: true } });
    return { party, products };
  }

  async purchaseDraftPreview(ctx: RequestContext, supplierId: string, lines: Array<{ productId: string; quantity: number; unitPrice?:string }>) {
    this.need(ctx, 'erp.purchase.write');
    const supplier = await this.db.erpSupplier.findFirst({ where: { id: supplierId, tenantId: ctx.tenantId, active: true }, select: { id: true, code: true, name: true } });
    if (!supplier) failNotFound('有效供应商');
    const products = await this.db.erpProduct.findMany({ where: { tenantId: ctx.tenantId, id: { in: lines.map(line => line.productId) }, active: true }, select: { id: true, sku: true, name: true, unit: true, purchasePrice: true } });
    if (products.length !== lines.length || new Set(lines.map(line => line.productId)).size !== lines.length) failNotFound('有效商品');
    const previewLines = lines.map(line => {
      const product = products.find(item => item.id === line.productId)!;
      const priced=pricedLine(product,readBody(tradeLineInput,line),product.purchasePrice);
      return { productId: product.id, sku: product.sku, name: product.name, unit:product.unit, quantity: priced.quantity, unitPrice: priced.unitPrice.toFixed(2), amount: priced.lineTotal.toFixed(2) };
    });
    return { supplier, lines: previewLines, estimatedTotal: previewLines.reduce((sum, line) => sum.plus(line.amount), new Prisma.Decimal(0)).toFixed(2) };
  }

  async createCustomer(ctx: RequestContext, body: unknown) {
    this.role(ctx, ['admin', 'sales']);
    const input = readBody(customerInput, body);
    if (input.creditLimit!==undefined&&!ctx.roles.includes('admin')) throw new ForbiddenException('信用额度由管理员维护');
    if (input.inPool && !ctx.roles.includes('admin')) throw new ForbiddenException('只有管理员可以添加公海客户');
    return this.db.$transaction(async tx => {
      const { inPool, ...customer } = input;
      const item = await tx.erpCustomer.create({ data: { tenantId: ctx.tenantId, ...customer, ownerMembershipId: inPool ? null : ctx.membershipId } });
      await audit(tx, ctx, 'erp.customer.create', 'Customer', item.id, { inPool: Boolean(inPool) });
      return item;
    });
  }

  async updateCustomer(ctx: RequestContext, id: string, body: unknown) {
    this.role(ctx, ['admin', 'sales']);
    const patch = readBody(customerPatch, body);
    if(patch.creditLimit!==undefined&&!ctx.roles.includes('admin'))throw new ForbiddenException('信用额度由管理员维护');
    const item = await this.db.erpCustomer.findFirst({ where: { id, tenantId: ctx.tenantId, ...ownerFilter(ctx) } });
    if (!item) failNotFound('客户');
    return this.db.$transaction(async tx => {
      const updated = await tx.erpCustomer.update({ where: { id }, data: patch });
      await audit(tx, ctx, 'erp.customer.update', 'Customer', id, { active: updated.active });
      return updated;
    });
  }

  async opportunities(ctx: RequestContext, query: unknown) {
    this.role(ctx, ['admin', 'sales', 'finance']);
    const q = readBody(pageQuery.extend({ id:z.uuid().optional(),customerId: z.uuid().optional() }), query);
    const where = { tenantId: ctx.tenantId,...(q.id?{id:q.id}:{}), ...ownerFilter(ctx), ...(q.customerId ? { customerId: q.customerId } : {}), ...(q.q ? { name: { contains: q.q, mode: 'insensitive' as const } } : {}) };
    const [items, total] = await this.db.$transaction([
      this.db.erpOpportunity.findMany({ where, include: { customer: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.page_size, take: q.page_size }),
      this.db.erpOpportunity.count({ where }),
    ]);
    return { items, total, page: q.page, page_size: q.page_size };
  }

  async createOpportunity(ctx: RequestContext, body: unknown) {
    this.role(ctx, ['admin', 'sales']);
    const input = readBody(z.object({ customerId: z.uuid(), name: label(), estimatedAmount: money }), body);
    return this.db.$transaction(async tx => {
      const customer = await tx.erpCustomer.findFirst({ where: { id: input.customerId, tenantId: ctx.tenantId, ...ownerFilter(ctx) } });
      if (!customer) failNotFound('客户');
      if (!customer.active) conflict('客户已停用');
      const item = await tx.erpOpportunity.create({ data: { tenantId: ctx.tenantId, customerId: customer.id, name: input.name, estimatedAmount: decimal(input.estimatedAmount), ownerMembershipId: ctx.membershipId } });
      await audit(tx, ctx, 'erp.opportunity.create', 'Opportunity', item.id);
      return item;
    }, { isolationLevel: 'Serializable' });
  }

  async changeOpportunity(ctx: RequestContext, id: string, body: unknown) {
    this.role(ctx, ['admin', 'sales']);
    const input = readBody(z.object({ stage: z.enum(['discovery', 'proposal', 'won', 'lost']) }), body);
    const old = await this.db.erpOpportunity.findFirst({ where: { id, tenantId: ctx.tenantId, ...ownerFilter(ctx) } });
    if (!old) failNotFound('商机');
    if (old.stage === 'won' || old.stage === 'lost') conflict('商机已结束');
    return this.db.$transaction(async tx => {
      const item = await tx.erpOpportunity.update({ where: { id }, data: { stage: input.stage } });
      await audit(tx, ctx, 'erp.opportunity.stage', 'Opportunity', id, { from: old.stage, to: input.stage });
      return item;
    });
  }

  async opportunityFollowups(ctx: RequestContext, id: string, query: unknown) {
    this.role(ctx, ['admin', 'sales', 'finance']);
    const q = readBody(pageQuery, query);
    const opportunity = await this.db.erpOpportunity.findFirst({ where: { id, tenantId: ctx.tenantId, ...ownerFilter(ctx) }, select: { id: true } });
    if (!opportunity) failNotFound('商机');
    const where = { tenantId: ctx.tenantId, opportunityId: id };
    const [items, total] = await this.db.$transaction([
      this.db.erpOpportunityFollowup.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.page_size, take: q.page_size }),
      this.db.erpOpportunityFollowup.count({ where }),
    ]);
    const actors = await this.db.membership.findMany({ where: { tenantId: ctx.tenantId, id: { in: [...new Set(items.map(item => item.actorMembershipId))] } }, include: { user: { select: { name: true } } } });
    return { items: items.map(item => ({ ...item, actorName: actors.find(actor => actor.id === item.actorMembershipId)?.user.name ?? '已离职成员' })), total, page: q.page, page_size: q.page_size };
  }

  async createOpportunityFollowup(ctx: RequestContext, id: string, body: unknown) {
    this.role(ctx, ['admin', 'sales']);
    const input = readBody(z.object({ note: label(2000), nextActionAt: z.iso.datetime({ offset: true }).optional() }), body);
    return this.db.$transaction(async tx => {
      const opportunity = await tx.erpOpportunity.findFirst({ where: { id, tenantId: ctx.tenantId, ...ownerFilter(ctx) }, select: { id: true, stage: true } });
      if (!opportunity) failNotFound('商机');
      if (['won', 'lost'].includes(opportunity.stage) && input.nextActionAt) conflict('已结束商机不能再安排跟进时间');
      const item = await tx.erpOpportunityFollowup.create({ data: { tenantId: ctx.tenantId, opportunityId: id, actorMembershipId: ctx.membershipId, note: input.note, nextActionAt: input.nextActionAt ? new Date(input.nextActionAt) : null } });
      await audit(tx, ctx, 'erp.opportunity.followup', 'Opportunity', id, { followupId: item.id, nextActionAt: input.nextActionAt ?? null });
      return { ...item, actorName: (await tx.user.findUnique({ where: { id: ctx.userId }, select: { name: true } }))?.name ?? '' };
    });
  }

  async products(ctx: RequestContext, query: unknown) {
    this.need(ctx, 'erp.master.read');
    const q = readBody(pageQuery, query);
    const where = { tenantId: ctx.tenantId, ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' as const } }, { sku: { contains: q.q, mode: 'insensitive' as const } }] } : {}) };
    const [items, total] = await this.db.$transaction([
      this.db.erpProduct.findMany({ where, include: { balance: true }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.page_size, take: q.page_size }),
      this.db.erpProduct.count({ where }),
    ]);
    return { items, total, page: q.page, page_size: q.page_size };
  }

  async createProduct(ctx: RequestContext, body: unknown) {
    this.role(ctx, ['admin', 'purchasing']);
    const input = readBody(productInput, body);
    return this.db.$transaction(async tx => {
      const item = await tx.erpProduct.create({ data: { tenantId: ctx.tenantId, sku: input.sku, name: input.name, category: input.category, unit: input.unit, salePrice: decimal(input.salePrice), purchasePrice: decimal(input.purchasePrice), reorderPoint: input.reorderPoint, balance: { create: { tenantId: ctx.tenantId } } }, include: { balance: true } });
      await audit(tx, ctx, 'erp.product.create', 'Product', item.id);
      return item;
    });
  }

  async updateProduct(ctx: RequestContext, id: string, body: unknown) {
    this.role(ctx, ['admin', 'purchasing']);
    const patch = readBody(productPatch, body);
    const old = await this.db.erpProduct.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!old) failNotFound('商品');
    return this.db.$transaction(async tx => {
      if(patch.unit&&patch.unit!==old.unit&&(await tx.erpStockMovement.count({where:{tenantId:ctx.tenantId,productId:id}})||await tx.erpPurchaseLine.count({where:{productId:id}})||await tx.erpSalesLine.count({where:{productId:id}})))conflict('商品已进入业务单据，基础单位不可更改');
      const item = await tx.erpProduct.update({ where: { id }, data: { name: patch.name, category: patch.category, unit:patch.unit, salePrice: patch.salePrice === undefined ? undefined : decimal(patch.salePrice), purchasePrice: patch.purchasePrice === undefined ? undefined : decimal(patch.purchasePrice), reorderPoint: patch.reorderPoint, active: patch.active } });
      await audit(tx, ctx, 'erp.product.update', 'Product', id, { active: item.active });
      return item;
    });
  }

  async suppliers(ctx: RequestContext, query: unknown) {
    this.role(ctx, ['admin', 'purchasing', 'warehouse', 'finance']);
    const q = readBody(pageQuery, query);
    const where = { tenantId: ctx.tenantId, ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' as const } }, { code: { contains: q.q, mode: 'insensitive' as const } }] } : {}) };
    const [items, total] = await this.db.$transaction([
      this.db.erpSupplier.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.page_size, take: q.page_size }),
      this.db.erpSupplier.count({ where }),
    ]);
    return { items, total, page: q.page, page_size: q.page_size };
  }

  async createSupplier(ctx: RequestContext, body: unknown) {
    this.role(ctx, ['admin', 'purchasing']);
    const input = readBody(supplierInput, body);
    return this.db.$transaction(async tx => {
      const item = await tx.erpSupplier.create({ data: { tenantId: ctx.tenantId, ...input } });
      await audit(tx, ctx, 'erp.supplier.create', 'Supplier', item.id);
      return item;
    });
  }

  async updateSupplier(ctx: RequestContext, id: string, body: unknown) {
    this.role(ctx, ['admin', 'purchasing']);
    const patch = readBody(supplierPatch, body);
    const old = await this.db.erpSupplier.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!old) failNotFound('供应商');
    return this.db.$transaction(async tx => {
      const item = await tx.erpSupplier.update({ where: { id }, data: patch });
      await audit(tx, ctx, 'erp.supplier.update', 'Supplier', id, { active: item.active });
      return item;
    });
  }
}
