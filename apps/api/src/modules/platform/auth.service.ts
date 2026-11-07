import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { isManagementAi } from './management-ai';
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS, setSessionCookie } from './auth-session';
import { PrismaService } from '../prisma.service';
import { QuotaService } from '../orchestration/quota.service';
import { ApplicationRegistry } from './application-registry';
import { checkPassword, hashPassword, sessionToken, tokenHash } from './security';
import { type AppContext, type RequestContext } from './context';
import { DEFAULT_APP_IDS, ensureDefaultApps } from './default-apps';

@Injectable()
export class AuthService {
  constructor(private readonly db: PrismaService, private readonly apps: ApplicationRegistry, private readonly quota:QuotaService) {}

  async createEnterprise(req: Request, name: string) {
    const actor = await this.user(req);
    return this.db.$transaction(async tx => {
      // Serialize repeated submissions; a user may create one self-service enterprise.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.id}))`;
      if (!await tx.user.findFirst({where:{id:actor.id,active:true}})) throw new UnauthorizedException('账号已停用');
      const existing = await tx.tenant.findUnique({ where: { selfServiceOwnerId: actor.id } });
      if (existing) {
        if (!existing.active || !await tx.membership.findFirst({where:{tenantId:existing.id,userId:actor.id,active:true,role:'admin'}})) throw new ForbiddenException('已创建的企业或管理员身份已停用，请联系平台运营人员');
        const filled = await ensureDefaultApps(tx, existing.id);
        if (filled.count) await tx.auditEvent.create({ data: { tenantId: existing.id, userId: actor.id, membershipId: (await tx.membership.findUniqueOrThrow({where:{tenantId_userId:{tenantId:existing.id,userId:actor.id}}})).id, appId: 'platform', requestId: String(req.headers['x-request-id'] ?? randomUUID()), action: 'platform.apps.default_fill', resourceType: 'Tenant', resourceId: existing.id, detail: { appIds: [...DEFAULT_APP_IDS], inserted: filled.count } } });
        return { tenant: { id: existing.id, slug: existing.slug, name: existing.name }, existing: true };
      }
      const tenant = await tx.tenant.create({ data: { name, slug: 'org-' + randomUUID().replaceAll('-', '').slice(0, 16), selfServiceOwnerId: actor.id } });
      const member = await tx.membership.create({ data: { tenantId: tenant.id, userId: actor.id, role: 'admin' } });
      const root = await tx.orgUnit.create({ data: { tenantId: tenant.id, name: '企业总部' } });
      await tx.membershipOrg.create({ data: { tenantId: tenant.id, membershipId: member.id, orgUnitId: root.id, primary: true } });
      await ensureDefaultApps(tx, tenant.id);
      await tx.tenantCapability.createMany({ data: ['ai', 'knowledge'].map(capability => ({ tenantId: tenant.id, capability, delivered: true, enabled: true })) });
      await tx.auditEvent.create({ data: { tenantId: tenant.id, userId: actor.id, membershipId: member.id, appId: 'platform', requestId: String(req.headers['x-request-id'] ?? randomUUID()), action: 'platform.tenant.self_create', resourceType: 'Tenant', resourceId: tenant.id } });
      return { tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name }, existing: false };
    });
  }

  async user(req: Request) {
    const token = sessionToken(req);
    const session = await this.db.session.findUnique({ where: { tokenHash: tokenHash(token) }, include: { user: true } });
    const now = Date.now();
    if (!session || session.expiresAt.getTime() <= now || !session.user.active || session.createdAt.getTime() + SESSION_ABSOLUTE_MS <= now) throw new UnauthorizedException('登录已失效');
    const expiresAt = new Date(Math.min(now + SESSION_IDLE_MS, session.createdAt.getTime() + SESSION_ABSOLUTE_MS));
    if (expiresAt.getTime() - session.expiresAt.getTime() > 30 * 24 * 3600_000 && (!req.res || !req.res.headersSent)) {
      // A conditional update cannot resurrect a session deleted by logout/revocation.
      const renewed = await this.db.session.updateMany({ where: { id: session.id, expiresAt: session.expiresAt }, data: { expiresAt } });
      if (renewed.count && req.res) setSessionCookie(req.res, token, expiresAt);
    }
    return session.user;
  }

  async logout(req: Request) {
    await this.db.session.deleteMany({ where: { tokenHash: tokenHash(sessionToken(req)) } });
  }

  async logoutAll(req: Request) {
    const actor = await this.user(req);
    await this.db.session.deleteMany({ where: { userId: actor.id } });
  }

  async changePassword(req: Request, currentPassword: string, nextPassword: string) {
    const user = await this.user(req);
    if (!checkPassword(currentPassword, user.passwordHash)) throw new UnauthorizedException('当前密码错误');
    if (currentPassword === nextPassword) throw new ForbiddenException('新密码不能与当前密码相同');
    const hash = hashPassword(nextPassword);
    await this.db.$transaction(async tx => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash: hash } });
      await tx.session.deleteMany({ where: { userId: user.id } });
      const memberships = await tx.membership.findMany({ where: { userId: user.id, active: true }, select: { tenantId: true, id: true } });
      for (const membership of memberships) {
        await tx.auditEvent.create({ data: { tenantId: membership.tenantId, userId: user.id, membershipId: membership.id, appId: 'platform', requestId: String(req.headers['x-request-id'] ?? randomUUID()), action: 'platform.user.password_change', resourceType: 'User', resourceId: user.id } });
      }
    });
    return { ok: true, sessionsRevoked: true };
  }

  async context(req: Request, tenantKey: string, appId: AppContext['appId']): Promise<RequestContext> {
    if (appId !== 'platform') this.apps.get(appId);
    const user = await this.user(req);
    const tenant = await this.db.tenant.findUnique({ where: { slug: tenantKey } });
    if (!tenant?.active) throw new ForbiddenException('企业不可用');
    const membership = await this.db.membership.findUnique({ where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } } });
    if (!membership?.active) throw new ForbiddenException('当前企业成员身份不可用');
    let app: AppContext = { appId };
    if (appId !== 'platform') {
      await this.quota.checkApp(tenant.id,appId);
      const tenantApp = await this.db.tenantApp.findUnique({ where: { tenantId_appId: { tenantId: tenant.id, appId } } });
      if (!tenantApp?.enabled || !tenantApp.granted) throw new ForbiddenException('应用未启用');
      app = { appId, tenantAppId: tenantApp.id };
    }
    return { requestId: String(req.headers['x-request-id'] ?? randomUUID()), tenantId: tenant.id, tenantKey, userId: user.id, membershipId: membership.id, app, roles: [membership.role], permissions: await this.permissions(tenant.id, membership.role, membership.id) };
  }

  async managementContext(req: Request, tenantKey: string) {
    const ctx = await this.context(req, tenantKey, 'platform');
    if (!ctx.roles.includes('admin')) throw new ForbiddenException('仅企业管理员可使用管理助手');
    return { ...ctx, app: { appId: 'tenant_admin' } };
  }

  private async operatorServiceTenant(userId: string) {
    const key = process.env.PLATFORM_AI_TENANT_KEY;
    const tenant = key ? await this.db.tenant.findUnique({where:{slug:key}}) : await this.db.tenant.findUnique({where:{selfServiceOwnerId:userId}});
    if (!tenant?.active) throw new ConflictException('请先在工作台创建运营服务企业并配置 AI 服务，或联系部署管理员指定服务企业。');
    return tenant;
  }

  async operatorAiContext(req: Request) {
    const user = await this.user(req);
    if (user.platformRole !== 'operator') throw new ForbiddenException('需要平台运营权限');
    const tenant = await this.operatorServiceTenant(user.id);
    const ctx = await this.managementContext(req, tenant.slug);
    return { ...ctx, app: { appId: 'platform_admin' } };
  }

  async taskContext(input: { tenantId: string; userId: string; membershipId: string; appId: string; taskId: string }): Promise<RequestContext> {
    if (isManagementAi(input.appId)) {
      const [tenant,user,member] = await Promise.all([
        this.db.tenant.findUnique({where:{id:input.tenantId}}), this.db.user.findUnique({where:{id:input.userId}}),
        this.db.membership.findFirst({where:{id:input.membershipId,tenantId:input.tenantId,userId:input.userId,active:true,role:'admin'}}),
      ]);
      if (!tenant?.active || !user?.active || !member) throw new ForbiddenException('管理身份已失效');
      if (input.appId === 'platform_admin' && (user.platformRole !== 'operator' || (await this.operatorServiceTenant(user.id)).id !== tenant.id)) throw new ForbiddenException('平台运营权限已失效');
      return {requestId:'task:'+input.taskId,tenantId:tenant.id,tenantKey:tenant.slug,userId:user.id,membershipId:member.id,app:{appId:input.appId},roles:[member.role],permissions:await this.permissions(tenant.id,member.role,member.id)};
    }
    this.apps.get(input.appId);
    const [tenant, user, membership, tenantApp] = await Promise.all([
      this.db.tenant.findUnique({ where: { id: input.tenantId } }),
      this.db.user.findUnique({ where: { id: input.userId } }),
      this.db.membership.findFirst({ where: { id: input.membershipId, tenantId: input.tenantId, userId: input.userId } }),
      this.db.tenantApp.findUnique({ where: { tenantId_appId: { tenantId: input.tenantId, appId: input.appId } } }),
    ]);
    if (!tenant?.active || !user?.active || !membership?.active || !tenantApp?.enabled || !tenantApp.granted) throw new ForbiddenException('任务发起人或应用已失效');
    await this.quota.checkApp(tenant.id,input.appId);
    return { requestId: `task:${input.taskId}`, tenantId: tenant.id, tenantKey: tenant.slug, userId: user.id, membershipId: membership.id, app: { appId: input.appId, tenantAppId: tenantApp.id }, roles: [membership.role], permissions: await this.permissions(tenant.id, membership.role, membership.id) };
  }

  private async permissions(tenantId: string, role: string, membershipId: string) {
    const caps = await this.db.tenantCapability.findMany({ where: { tenantId, delivered: true, enabled: true } });
    const base = role === 'admin' ? ['platform.manage','platform.ai.use','platform.audit.read','knowledge.use','knowledge.manage'] : ['knowledge.use'];
    const grants = [] as string[];
    // The platform consumes application permission contracts, never business tables.
    for (const application of this.apps.list()) {
      const enabled = await this.db.tenantApp.findUnique({where:{tenantId_appId:{tenantId,appId:application.appId}}});
      if (enabled?.enabled && enabled.granted) grants.push(...await this.apps.permissions(application.appId, tenantId, role, membershipId));
    }
    return [...new Set([...base,...grants])].filter(p => p.endsWith('.ai.use') ? caps.some(x=>x.capability==='ai') : p.startsWith('knowledge.') ? caps.some(x=>x.capability==='knowledge') : true);
  }

  require(ctx: RequestContext, permission: string) {
    if (!ctx.permissions.includes(permission)) throw new ForbiddenException('没有此操作权限');
  }
}
