import { ForbiddenException, HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { checkPassword, hashPassword, newSessionToken, sessionToken, tokenHash } from './security';
import { ROLE_PERMISSIONS, type AppContext, type RequestContext } from './context';

@Injectable()
export class AuthService {
  private readonly loginFailures = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly db: PrismaService) {}

  async login(email: string, password: string, sourceIp: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const failureKey = `${sourceIp}:${normalizedEmail}`;
    const now = Date.now();
    const previous = this.loginFailures.get(failureKey);
    if (previous && previous.resetAt > now && previous.count >= 10) throw new HttpException('登录尝试过多，请稍后再试', 429);
    const user = await this.db.user.findUnique({ where: { email: normalizedEmail } });
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
    const user = await this.user(req);
    const tenant = await this.db.tenant.findUnique({ where: { slug: tenantKey } });
    if (!tenant?.active) throw new ForbiddenException('企业不可用');
    const membership = await this.db.membership.findUnique({ where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } } });
    if (!membership?.active) throw new ForbiddenException('当前企业成员身份不可用');
    let app: AppContext = { appId };
    if (appId !== 'platform') {
      const tenantApp = await this.db.tenantApp.findUnique({ where: { tenantId_appId: { tenantId: tenant.id, appId } } });
      if (!tenantApp?.enabled) throw new ForbiddenException('应用未启用');
      app = { appId, tenantAppId: tenantApp.id };
    }
    return { requestId: String(req.headers['x-request-id'] ?? randomUUID()), tenantId: tenant.id, tenantKey, userId: user.id, membershipId: membership.id, app, roles: [membership.role], permissions: ROLE_PERMISSIONS[membership.role] ?? [] };
  }

  async taskContext(input: { tenantId: string; userId: string; membershipId: string; appId: string; taskId: string }): Promise<RequestContext> {
    if (input.appId !== 'erp') throw new ForbiddenException('任务应用不可用');
    const [tenant, user, membership, tenantApp] = await Promise.all([
      this.db.tenant.findUnique({ where: { id: input.tenantId } }),
      this.db.user.findUnique({ where: { id: input.userId } }),
      this.db.membership.findFirst({ where: { id: input.membershipId, tenantId: input.tenantId, userId: input.userId } }),
      this.db.tenantApp.findUnique({ where: { tenantId_appId: { tenantId: input.tenantId, appId: input.appId } } }),
    ]);
    if (!tenant?.active || !user?.active || !membership?.active || !tenantApp?.enabled) throw new ForbiddenException('任务发起人或应用已失效');
    return { requestId: `task:${input.taskId}`, tenantId: tenant.id, tenantKey: tenant.slug, userId: user.id, membershipId: membership.id, app: { appId: 'erp', tenantAppId: tenantApp.id }, roles: [membership.role], permissions: ROLE_PERMISSIONS[membership.role] ?? [] };
  }

  require(ctx: RequestContext, permission: string) {
    if (!ctx.permissions.includes(permission)) throw new ForbiddenException('没有此操作权限');
  }
}
