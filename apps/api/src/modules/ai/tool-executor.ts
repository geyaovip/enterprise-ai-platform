import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
import { PrismaService } from '../prisma.service';
import { APP_AI_PROVIDER } from './app-ai-provider';
import { AiProviderRegistry } from './provider-registry';

@Injectable()
export class ToolExecutor {
  constructor(private readonly db: PrismaService, @Inject(APP_AI_PROVIDER) private readonly providers: AiProviderRegistry) {}

  available(ctx: RequestContext) {
    return Object.values(this.providers.get(ctx).tools).filter(tool => tool.appId === ctx.app.appId && this.providers.get(ctx).canUse(ctx, tool.id));
  }

  prepare(ctx: RequestContext, toolId: string, input: unknown) {
    const definition = this.providers.get(ctx).tools[toolId];
    if (!definition || definition.appId !== ctx.app.appId || !this.providers.get(ctx).canUse(ctx, toolId)) throw new ConflictException('模型请求了未授权工具');
    return { definition, input: readBody(definition.input, input) };
  }

  async receipt(ctx: RequestContext, actionId: string) {
    const event = await this.db.auditEvent.findFirst({
      where: { tenantId: ctx.tenantId, appId: ctx.app.appId, requestId: `ai-action:${actionId}` },
      orderBy: { createdAt: 'desc' },
    });
    return event ? { id: event.resourceId, status: 'committed', auditEventId: event.id, receiptReconstructed: true } : null;
  }

  async execute(ctx: RequestContext, action: { id: string; toolId: string; input: unknown }, previewHash?:string) {
    const { input } = this.prepare(ctx, action.toolId, action.input);
    const existing = await this.receipt(ctx, action.id);
    if (existing) return existing;
    // ERP commands write their audit event in the same transaction as the business result.
    // The stable request ID lets us reconstruct a committed result if the AI action update fails.
    return this.providers.get(ctx).execute({ ...ctx, requestId: `ai-action:${action.id}` }, action.toolId, input, {previewHash});
  }
}
