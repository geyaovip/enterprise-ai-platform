import { ConflictException, ForbiddenException, HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { isManagementAi } from './management-ai';
import { identityWhere } from './account-input';
import { PrismaService } from '../prisma.service';
import { QuotaService } from '../orchestration/quota.service';
import { ApplicationRegistry } from './application-registry';
import { checkPassword, hashPassword, newSessionToken, sessionToken, tokenHash } from './security';
import { type AppContext, type RequestContext } from './context';

@Injectable()
export class AuthService {
  private readonly loginFailures = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly db: PrismaService, private readonly apps: ApplicationRegistry, private readonly quota:QuotaService) {}

  async login(email: string, password: string, sourceIp: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const failureKey = `${sourceIp}:${normalizedEmail}`;
    const now = Date.now();
    const previous = this.loginFailures.get(failureKey);
    if (previous && previous.resetAt > now && previous.count >= 10) throw new HttpException('登录尝试过多，请稍后再试', 429);
    const user = await this.db.user.findUnique({ where: identityWhere(normalizedEmail) });
    if (!user?.active || !checkPassword(password, user.passwordHash)) {
      const active = previous && previous.resetAt > now ? previous : { count: 0, resetAt: now + 15 * 60_000 };
      this.loginFailures.delete(failureKey);
      this.loginFailures.set(failureKey, { count: active.count + 1, resetAt: active.resetAt });
      if (this.loginFailures.size > 10_000) this.loginFailures.delete(this.loginFailures.keys().next().value!);
      throw new UnauthorizedException('账号或密码错误');
    }
    this.loginFailures.delete(failureKey);
    const token = newSessionToken();
    await this.db.session.create({ data: { userId: user.id, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 7 * 24 * 3600_000) } });
    return { token, user: { id: user.id, name: user.name, email: user.email } };
  }

  private readonly registrations = new Map<string, { count: number; resetAt: number }>();
  async register(account: string, password: string, sourceIp: string) {
    const now = Date.now();
    const old = this.registrations.get(sourceIp);
    const rate = old && old.resetAt > now ? old : { count: 0, resetAt: now + 3600_000 };
    if (rate.count >= 10) throw new HttpException('注册尝试过多，请稍后再试', 429);
    this.registrations.delete(sourceIp); this.registrations.set(sourceIp, { ...rate, count: rate.count + 1 });
    if (this.registrations.size > 10_000) this.registrations.delete(this.registrations.keys().next().value!);
    try {
      const user = await this.db.user.create({ data: { account, name: account, passwordHash: hashPassword(password) }, select: { id: true, account: true, name: true } });
      return { user };
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('该账号已被注册，请更换账号或直接登录');
      throw error;
    }
  }

  async createEnterprise(req: Request, name: string) {
    const actor = await this.user(req);
    return this.db.$transaction(async tx => {
      // Serialize repeated submissions; a user may create one self-service enterprise.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.id}))`;
      if (!await tx.user.findFirst({where:{id:actor.id,active:true}})) throw new UnauthorizedException('账号已停用');
      const existing = await tx.tenant.findUnique({ where: { selfServiceOwnerId: actor.id } });
      if (existing) {
        if (!existing.active || !await tx.membership.findFirst({where:{tenantId:existing.id,userId:actor.id,active:true,role:'admin'}})) throw new ForbiddenException('已创建的企业或管理员身份已停用，请联系平台运营人员');
        return { tenant: { id: existing.id, slug: existing.slug, name: existing.name }, existing: true };
      }
      const tenant = await tx.tenant.create({ data: { name, slug: 'org-' + randomUUID().replaceAll('-', '').slice(0, 16), selfServiceOwnerId: actor.id } });
      const member = await tx.membership.create({ data: { tenantId: tenant.id, userId: actor.id, role: 'admin' } });
      const root = await tx.orgUnit.create({ data: { tenantId: tenant.id, name: '企业总部' } });
      await tx.membershipOrg.create({ data: { tenantId: tenant.id, membershipId: member.id, orgUnitId: root.id, primary: true } });
      await tx.tenantApp.create({ data: { tenantId: tenant.id, appId: 'erp', enabled: true, granted: true } });
      await tx.tenantCapability.createMany({ data: ['ai', 'knowledge'].map(capability => ({ tenantId: tenant.id, capability, delivered: true, enabled: true })) });
      await tx.auditEvent.create({ data: { tenantId: tenant.id, userId: actor.id, membershipId: member.id, appId: 'platform', requestId: String(req.headers['x-request-id'] ?? randomUUID()), action: 'platform.tenant.self_create', resourceType: 'Tenant', resourceId: tenant.id } });
      return { tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name }, existing: false };
    });
  }

  async user(req: Request) {
    const session = await this.db.session.findUnique({ where: { tokenHash: tokenHash(sessionToken(req)) }, include: { user: true } });
    if (!session || session.expiresAt <= new Date() || !session.user.active) throw new UnauthorizedException('登录已失效');
    return session.user;
  }

  async logout(req: Request) {
    await this.db.session.deleteMany({ where: { tokenHash: tokenHash(sessionToken(req)) } });
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
