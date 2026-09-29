import { ForbiddenException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../platform/auth.service';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
import { audit, conflict, decimal, failNotFound, label, money, ownerFilter, pageQuery } from './erp.common';

const customerInput = z.object({ code: label(60), name: label(), contactName: z.string().trim().max(100).optional(), phone: z.string().trim().max(50).optional(), industry: z.string().trim().max(100).optional() });
const customerPatch = customerInput.omit({ code: true }).partial().extend({ active: z.boolean().optional() });
const productInput = z.object({ sku: label(80), name: label(), category: z.string().trim().max(100).optional(), unit: z.literal('件').default('件'), salePrice: money, purchasePrice: money, reorderPoint: z.int().min(0).default(0) });
const productPatch = productInput.omit({ sku: true, unit: true }).partial().extend({ active: z.boolean().optional() });
const supplierInput = z.object({ code: label(60), name: label(), contactName: z.string().trim().max(100).optional(), phone: z.string().trim().max(50).optional() });
const supplierPatch = supplierInput.omit({ code: true }).partial().extend({ active: z.boolean().optional() });

@Injectable()
export class MasterService {
  constructor(private readonly db: PrismaService, private readonly auth: AuthService) {}
  private need(ctx: RequestContext, permission: string) { this.auth.require(ctx, permission); }
  private role(ctx: RequestContext, allowed: string[]) { if (!allowed.some(x => ctx.roles.includes(x))) throw new ForbiddenException('没有此业务权限'); }

  async customers(ctx: RequestContext, query: unknown) {
    this.role(ctx, ['admin', 'sales', 'finance']);
    const q = readBody(pageQuery, query);
    const where = { tenantId: ctx.tenantId, ...ownerFilter(ctx), ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' as const } }, { code: { contains: q.q, mode: 'insensitive' as const } }] } : {}) };
    const [items, total] = await this.db.$transaction([
      this.db.erpCustomer.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.page_size, take: q.page_size }),
      this.db.erpCustomer.count({ where }),
    ]);
    return { items, total, page: q.page, page_size: q.page_size };
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

  async createCustomer(ctx: RequestContext, body: unknown) {
    this.role(ctx, ['admin', 'sales']);
    const input = readBody(customerInput, body);
    return this.db.$transaction(async tx => {
      const item = await tx.erpCustomer.create({ data: { tenantId: ctx.tenantId, ...input, ownerMembershipId: ctx.membershipId } });
      await audit(tx, ctx, 'erp.customer.create', 'Customer', item.id);
      return item;
    });
  }

  async updateCustomer(ctx: RequestContext, id: string, body: unknown) {
    this.role(ctx, ['admin', 'sales']);
    const patch = readBody(customerPatch, body);
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
    const q = readBody(pageQuery.extend({ customerId: z.uuid().optional() }), query);
    const where = { tenantId: ctx.tenantId, ...ownerFilter(ctx), ...(q.customerId ? { customerId: q.customerId } : {}), ...(q.q ? { name: { contains: q.q, mode: 'insensitive' as const } } : {}) };
    const [items, total] = await this.db.$transaction([
      this.db.erpOpportunity.findMany({ where, include: { customer: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.page_size, take: q.page_size }),
      this.db.erpOpportunity.count({ where }),
    ]);
    return { items, total, page: q.page, page_size: q.page_size };
  }

  async createOpportunity(ctx: RequestContext, body: unknown) {
    this.role(ctx, ['admin', 'sales']);
    const input = readBody(z.object({ customerId: z.uuid(), name: label(), estimatedAmount: money }), body);
    const customer = await this.db.erpCustomer.findFirst({ where: { id: input.customerId, tenantId: ctx.tenantId, ...ownerFilter(ctx) } });
    if (!customer) failNotFound('客户');
    if (!customer.active) conflict('客户已停用');
    return this.db.$transaction(async tx => {
      const item = await tx.erpOpportunity.create({ data: { tenantId: ctx.tenantId, customerId: customer.id, name: input.name, estimatedAmount: decimal(input.estimatedAmount), ownerMembershipId: ctx.membershipId } });
      await audit(tx, ctx, 'erp.opportunity.create', 'Opportunity', item.id);
      return item;
    });
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
      const item = await tx.erpProduct.update({ where: { id }, data: { name: patch.name, category: patch.category, salePrice: patch.salePrice === undefined ? undefined : decimal(patch.salePrice), purchasePrice: patch.purchasePrice === undefined ? undefined : decimal(patch.purchasePrice), reorderPoint: patch.reorderPoint, active: patch.active } });
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
