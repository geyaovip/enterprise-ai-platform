import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { AuthService } from './auth.service';
import { isManagementAi } from './management-ai';
import { PrismaService } from '../prisma.service';
import { readBody } from './security';
import type { RequestContext } from './context';

export const NOTIFICATION_CONTRIBUTORS = Symbol('NOTIFICATION_CONTRIBUTORS');
export type NotificationContributor = { appId: string; feed(ctx: RequestContext, page: number): Promise<{ items: any[]; total: number; unread: number }>; read(ctx: RequestContext, id: string): Promise<unknown> };

@Injectable()
export class PersonalNotificationsService {
  constructor(private readonly db: PrismaService, private readonly auth:AuthService, @Inject(NOTIFICATION_CONTRIBUTORS) private readonly contributors: NotificationContributor[]) {}
  private async managementScopes(ctx:RequestContext) {
    const scopes:string[]=[];
    for (const appId of ['tenant_admin','platform_admin']) {
      try { const fresh=await this.auth.taskContext({...ctx,appId,taskId:'notification-access'}); this.auth.require(fresh,'platform.ai.use'); scopes.push(appId); } catch { /* Revoked scopes never appear in the feed. */ }
    }
    return scopes;
  }
  async feed(ctx: RequestContext, body: unknown) {
    const q = readBody(z.object({ page: z.coerce.number().int().min(1).max(100).default(1), page_size: z.coerce.number().int().min(1).max(100).default(20) }), body);
    const limit = q.page * q.page_size;
    const where = { tenantId: ctx.tenantId, recipientMembershipId: ctx.membershipId };
    const installed = await this.db.tenantApp.findMany({ where: { tenantId: ctx.tenantId, enabled: true, granted: true } });
    const ownWhere = { ...where, appId: { in: [...installed.map(a => a.appId), ...await this.managementScopes(ctx)] } };
    const [items, total, unread] = await this.db.$transaction([
      this.db.personalNotification.findMany({ where: ownWhere, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: limit }),
      this.db.personalNotification.count({ where: ownWhere }), this.db.personalNotification.count({ where: { ...ownWhere, readAt: null } }),
    ]);
    const all: any[] = items.map(n => ({ ...n, id: 'platform.' + n.id }));
    let count = total, unseen = unread;
    for (const source of this.contributors.filter(c => installed.some(a => a.appId === c.appId))) {
      let first: Awaited<ReturnType<NotificationContributor['feed']>> | null = null;
      for (let page = 1; page <= Math.ceil(limit / 100); page++) {
        const result = await source.feed(ctx, page);
        first ??= result;
        all.push(...result.items.map(n => ({ ...n, id: source.appId + '.' + n.id })));
        if (page * 100 >= result.total) break;
      }
      count += first?.total ?? 0; unseen += first?.unread ?? 0;
    }
    all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || a.id.localeCompare(b.id));
    return { items: all.slice((q.page - 1) * q.page_size, limit), total: count, unread: unseen, ...q };
  }
  async read(ctx: RequestContext, id: string) {
    const [source, record] = id.split('.');
    if (source === 'platform') {
      const n = await this.db.personalNotification.findFirst({ where: { id: record, tenantId: ctx.tenantId, recipientMembershipId: ctx.membershipId } });
      const app = n && await this.db.tenantApp.findUnique({ where: { tenantId_appId: { tenantId: ctx.tenantId, appId: n.appId } } });
      if (!n || (isManagementAi(n.appId) ? !(await this.managementScopes(ctx)).includes(n.appId) : !app?.enabled || !app.granted)) throw new NotFoundException('通知不存在');
      await this.db.personalNotification.updateMany({ where: { id: record, readAt: null }, data: { readAt: new Date() } });
      return { read: true };
    }
    const contributor = this.contributors.find(c => c.appId === source);
    if (!contributor) throw new NotFoundException('通知不存在');
    return contributor.read(ctx, record);
  }
}
