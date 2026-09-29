import type { RequestContext } from '../platform/context';

export const APP_AI_PROVIDER = Symbol('APP_AI_PROVIDER');

export type AiSource = { appId: string; type: string; id: string; version?: number };
export type AiResourceFacts = { text: string; source?: AiSource; facts?: Array<Record<string, string | number>> };

export interface AppAiProvider {
  readonly appId: string;
  readonly usePermission: string;
  readonly analysisSystemPrompt: string;
  readonly tools: Record<string, { confirmationRequired: boolean }>;
  resourceFacts(ctx: RequestContext, type: string, id?: string): Promise<AiResourceFacts>;
  options(ctx: RequestContext): Promise<Record<string, unknown>>;
  canUse(ctx: RequestContext, tool: string): boolean;
  execute(ctx: RequestContext, tool: string, input: Record<string, unknown>): Promise<unknown>;
  shortages(ctx: RequestContext): Promise<unknown>;
  extract(ctx: RequestContext, body: unknown): Promise<unknown>;
}
