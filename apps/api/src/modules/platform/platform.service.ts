import { identityWhere } from './account-input';
import { ManagedRuntimeService } from '../ai/managed-runtime.service';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthService } from './auth.service';
import type { RequestContext } from './context';
import { hashPassword } from './security';
import { QuotaService } from '../orchestration/quota.service';
import { ApplicationRegistry } from './application-registry';

@Injectable()
export class PlatformService {
  constructor(private readonly db: PrismaService, private readonly auth: AuthService, private readonly registry: ApplicationRegistry, private readonly quota:QuotaService, private readonly managed:ManagedRuntimeService) {}

  private admin(ctx: RequestContext) { this.auth.require(ctx, 'platform.manage'); }
  private audit(ctx: RequestContext, action: string, resourceType: string, resourceId: string) {
    return { tenantId: ctx.tenantId, userId: ctx.userId, membershipId: ctx.membershipId, appId: 'platform', requestId: ctx.requestId, action, resourceType, resourceId };
  }

  async tenants(userId: string) {
    return this.db.membership.findMany({ where: { userId, active: true, tenant: { active: true } }, select: { id: true, role: true, tenant: { select: { id: true, slug: true, name: true } } } });
  }

  async capabilities(ctx: RequestContext) { return this.db.tenantCapability.findMany({ where: { tenantId: ctx.tenantId } }); }

  // Member-facing configuration status. Never expose another member's binding or credentials.
  async serviceStatus(ctx: RequestContext) {
    const [capabilities, bindings, installed] = await Promise.all([
      this.db.tenantCapability.findMany({ where: { tenantId: ctx.tenantId } }),
      this.db.infrastructureBinding.findMany({ where: { tenantId: ctx.tenantId, enabled: true, OR: [{ kind: 'runtime', scopeKey: ctx.membershipId }, { kind: 'knowledge', scopeKey: 'tenant' }] }, select: { kind: true } }),
      this.db.tenantApp.findMany({ where: { tenantId: ctx.tenantId, granted:true, enabled:true }, select: { appId:true } }),
    ]);
    const enabled = (capability: string) => capabilities.some(c => c.capability === capability && c.delivered && c.enabled);
    const runtime = await this.managed.status(ctx).catch(()=>({managed:true, available:false, state:'unavailable'}));
    return {
      ai: { ...(runtime.managed?{runtimeState:runtime.state,managed:true}:{}),enabled: enabled('ai') && this.registry.list().some(a=>a.aiCapabilities.length>0&&installed.some(i=>i.appId===a.appId)), configured: bindings.some(b => b.kind === 'runtime') || runtime.available },
      knowledge: { enabled: enabled('knowledge'), configured: bindings.some(b => b.kind === 'knowledge') },
    };
  }

  async setCapability(ctx: RequestContext, capability: string, enabled: boolean) {
    this.admin(ctx);
    return this.db.$transaction(async tx => {
      const old = await tx.tenantCapability.findUnique({ where: { tenantId_capability: { tenantId: ctx.tenantId, capability } } });
      if (!old?.delivered) throw new BadRequestException('平台尚未交付此能力');
      const saved = await tx.tenantCapability.update({ where: { id: old.id }, data: { enabled, version: { increment: 1 } } });
      await tx.auditEvent.create({ data: this.audit(ctx, 'platform.capability.enable', 'TenantCapability', saved.id) });
      return saved;
    });
  }

  async apps(ctx: RequestContext) {
    return this.db.tenantApp.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, appId: true, enabled: true, granted: true } });
  }

  async setApp(ctx: RequestContext, appId: string, enabled: boolean) {
    this.admin(ctx);
    this.registry.get(appId);
    if(enabled)await this.quota.checkApp(ctx.tenantId,appId);
    const delivered = await this.db.tenantApp.findUnique({ where: { tenantId_appId: { tenantId: ctx.tenantId, appId } } });
    if (!delivered?.granted) throw new BadRequestException('平台尚未交付此应用');
    return this.db.$transaction(async tx => {
      const app = await tx.tenantApp.upsert({ where: { tenantId_appId: { tenantId: ctx.tenantId, appId } }, create: { tenantId: ctx.tenantId, appId, enabled }, update: { enabled } });
      await tx.auditEvent.create({ data: this.audit(ctx, 'platform.app.set', 'TenantApp', app.id) });
      return { id: app.id, appId, enabled };
    });
  }

  async members(ctx: RequestContext) {
    this.admin(ctx);
    return this.db.membership.findMany({ where: { tenantId: ctx.tenantId }, include: { user: { select: { id: true, email: true, account: true, name: true, active: true } }, orgs: { include: { orgUnit: { select: { id: true, name: true } } } } }, orderBy: { createdAt: 'asc' } });
  }

  async createMember(ctx: RequestContext, data: { email: string; name: string; password: string; role: string; orgUnitId?: string }) {
    this.admin(ctx);
    const email = data.email.trim().toLowerCase();
    const existing = await this.db.user.findUnique({ where: identityWhere(email) });
    if (existing) throw new ConflictException('账号已存在，请使用成员邀请链接加入企业');
    const org = data.orgUnitId ? await this.db.orgUnit.findFirst({ where: { id: data.orgUnitId, tenantId: ctx.tenantId, active: true } }) : await this.db.orgUnit.findFirst({ where: { tenantId: ctx.tenantId, parentId: null } });
    if (!org) throw new BadRequestException('组织单元不可用');
    return this.db.$transaction(async tx => {
      const user = await tx.user.create({ data: { ...identityWhere(email), name: data.name.trim(), passwordHash: hashPassword(data.password) } });
      await this.quota.checkSeat(ctx.tenantId,tx);
      const member = await tx.membership.create({ data: { tenantId: ctx.tenantId, userId: user.id, role: data.role } });
      await tx.membershipOrg.create({ data: { tenantId: ctx.tenantId, membershipId: member.id, orgUnitId: org.id, primary: true } });
      await tx.auditEvent.create({ data: this.audit(ctx, 'platform.member.create', 'Membership', member.id) });
      return { id: member.id, userId: user.id, email, name: user.name, role: member.role, active: member.active, orgUnitId: org.id };
    });
  }

  async updateMember(ctx: RequestContext, id: string, patch: { role?: string; active?: boolean; orgUnitId?: string }) {
    this.admin(ctx);
    return this.db.$transaction(async tx => {
      const old = await tx.membership.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!old) throw new NotFoundException('成员不存在');
      if (patch.active === true && !old.active) await this.quota.checkSeat(ctx.tenantId,tx);
      if (old.role === 'admin' && (patch.role && patch.role !== 'admin' || patch.active === false)) {
        const count = await tx.membership.count({ where: { tenantId: ctx.tenantId, role: 'admin', active: true } });
        if (count <= 1) throw new ConflictException('必须保留一位有效管理员');
      }
      let orgId: string | undefined;
      if (patch.orgUnitId) {
        const org = await tx.orgUnit.findFirst({ where: { id: patch.orgUnitId, tenantId: ctx.tenantId, active: true } });
        if (!org) throw new BadRequestException('组织单元不可用');
        orgId = org.id;
      }
      const member = await tx.membership.update({ where: { id }, data: { role: patch.role, active: patch.active } });
      if (orgId) {
        await tx.membershipOrg.deleteMany({ where: { tenantId: ctx.tenantId, membershipId: id } });
        await tx.membershipOrg.create({ data: { tenantId: ctx.tenantId, membershipId: id, orgUnitId: orgId, primary: true } });
      }
      await tx.auditEvent.create({ data: this.audit(ctx, 'platform.member.update', 'Membership', id) });
      return { id: member.id, role: member.role, active: member.active, orgUnitId: orgId };
    }, { isolationLevel: 'Serializable' });
  }

  async orgUnits(ctx: RequestContext) {
    this.admin(ctx);
    return this.db.orgUnit.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: 'asc' } });
  }

  async createOrgUnit(ctx: RequestContext, name: string, parentId: string) {
    this.admin(ctx);
    const parent = await this.db.orgUnit.findFirst({ where: { id: parentId, tenantId: ctx.tenantId, active: true } });
    if (!parent) throw new BadRequestException('上级组织不可用');
    return this.db.$transaction(async tx => {
      const org = await tx.orgUnit.create({ data: { tenantId: ctx.tenantId, parentId, name: name.trim() } });
      await tx.auditEvent.create({ data: this.audit(ctx, 'platform.org.create', 'OrgUnit', org.id) });
      return org;
    });
  }

  async updateOrgUnit(ctx: RequestContext, id: string, patch: { name?: string; parentId?: string; active?: boolean; version: number }) {
    this.admin(ctx);
    return this.db.$transaction(async tx => {
      const old = await tx.orgUnit.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!old) throw new NotFoundException('组织不存在');
      if (old.version !== patch.version) throw new ConflictException('组织已被修改，请刷新');
      if (old.parentId === null && (patch.parentId || patch.active === false)) throw new BadRequestException('根组织不可移动或停用');
      if (patch.active === false) {
        const [children, members] = await Promise.all([
          tx.orgUnit.count({ where: { tenantId: ctx.tenantId, parentId: id, active: true } }),
          tx.membershipOrg.count({ where: { tenantId: ctx.tenantId, orgUnitId: id } }),
        ]);
        if (children || members) throw new ConflictException('组织仍有下级或成员');
      }
      if (patch.parentId) {
        let cursor: string | null = patch.parentId;
        while (cursor) {
          if (cursor === id) throw new BadRequestException('组织不能形成环');
          const parent: { parentId: string | null; active: boolean } | null = await tx.orgUnit.findFirst({ where: { id: cursor, tenantId: ctx.tenantId }, select: { parentId: true, active: true } });
          if (!parent?.active) throw new BadRequestException('上级组织不可用');
          cursor = parent.parentId;
        }
      }
      const org = await tx.orgUnit.update({ where: { id }, data: { name: patch.name?.trim(), parentId: patch.parentId, active: patch.active, version: { increment: 1 } } });
      await tx.auditEvent.create({ data: this.audit(ctx, 'platform.org.update', 'OrgUnit', id) });
      return org;
    }, { isolationLevel: 'Serializable' });
  }

  async auditLogs(ctx: RequestContext, page: number) {
    this.auth.require(ctx, 'platform.audit.read');
    const where = { tenantId: ctx.tenantId };
    const [items, total] = await Promise.all([
      this.db.auditEvent.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * 50, take: 50 }),
      this.db.auditEvent.count({ where }),
    ]);
    return { items, page, page_size: 50, total };
  }
}
