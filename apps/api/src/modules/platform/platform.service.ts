import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthService } from './auth.service';
import type { RequestContext } from './context';
import { hashPassword } from './security';
import { appManifest } from './app-registry';

@Injectable()
export class PlatformService {
  constructor(private readonly db: PrismaService, private readonly auth: AuthService) {}

  private admin(ctx: RequestContext) { this.auth.require(ctx, 'platform.manage'); }
  private audit(ctx: RequestContext, action: string, resourceType: string, resourceId: string) {
    return { tenantId: ctx.tenantId, userId: ctx.userId, membershipId: ctx.membershipId, appId: 'platform', requestId: ctx.requestId, action, resourceType, resourceId };
  }

  async tenants(userId: string) {
    return this.db.membership.findMany({ where: { userId, active: true, tenant: { active: true } }, select: { id: true, role: true, tenant: { select: { id: true, slug: true, name: true } } } });
  }

  async apps(ctx: RequestContext) {
    return this.db.tenantApp.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, appId: true, enabled: true } });
  }

  async setApp(ctx: RequestContext, appId: string, enabled: boolean) {
    this.admin(ctx);
    if (!appManifest(appId)) throw new BadRequestException('未注册的应用');
    return this.db.$transaction(async tx => {
      const app = await tx.tenantApp.upsert({ where: { tenantId_appId: { tenantId: ctx.tenantId, appId } }, create: { tenantId: ctx.tenantId, appId, enabled }, update: { enabled } });
      await tx.auditEvent.create({ data: this.audit(ctx, 'platform.app.set', 'TenantApp', app.id) });
      return { id: app.id, appId, enabled };
    });
  }

  async members(ctx: RequestContext) {
    this.admin(ctx);
    return this.db.membership.findMany({ where: { tenantId: ctx.tenantId }, include: { user: { select: { id: true, email: true, name: true, active: true } }, orgs: { include: { orgUnit: { select: { id: true, name: true } } } } }, orderBy: { createdAt: 'asc' } });
  }

  async createMember(ctx: RequestContext, data: { email: string; name: string; password: string; role: string; orgUnitId?: string }) {
    this.admin(ctx);
    const email = data.email.trim().toLowerCase();
    const existing = await this.db.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('账号已存在；跨企业邀请流程尚未启用');
    const org = data.orgUnitId ? await this.db.orgUnit.findFirst({ where: { id: data.orgUnitId, tenantId: ctx.tenantId, active: true } }) : await this.db.orgUnit.findFirst({ where: { tenantId: ctx.tenantId, parentId: null } });
    if (!org) throw new BadRequestException('组织单元不可用');
    return this.db.$transaction(async tx => {
      const user = await tx.user.create({ data: { email, name: data.name.trim(), passwordHash: hashPassword(data.password) } });
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
