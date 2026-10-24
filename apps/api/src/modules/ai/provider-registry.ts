import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { AppAiProvider } from './app-ai-provider';
import type { RequestContext } from '../platform/context';
export class AiProviderRegistry {
  private readonly providers = new Map<string, AppAiProvider>();
  register(provider: AppAiProvider) {
    if (this.providers.has(provider.appId)) throw new Error('Duplicate AI provider');
    for (const tool of Object.values(provider.tools)) if (tool.appId !== provider.appId || !tool.id.startsWith(`${provider.appId}.`) || !tool.permission.startsWith(`${provider.appId}.`)) throw new Error('Tool namespace mismatch');
    this.providers.set(provider.appId,provider);
  }
  get(ctx: RequestContext) {
    const provider = this.providers.get(ctx.app.appId);
    if (!provider) throw new ConflictException('当前应用 AI 不可用');
    if (!ctx.permissions.includes(provider.usePermission)) throw new ForbiddenException('无权使用当前应用 AI');
    return provider;
  }
  agent(ctx: RequestContext, requestedId?: string) {
    const provider = this.get(ctx);
    const id = provider.agentId ?? `${provider.appId}.assistant`;
    if (requestedId && requestedId !== id) throw new ForbiddenException('当前助手不可用');
    return { id, appId: provider.appId, usePermission: provider.usePermission, skillIds: provider.skillIds??[], instructions: provider.instructions ?? provider.analysisSystemPrompt };
  }
}
