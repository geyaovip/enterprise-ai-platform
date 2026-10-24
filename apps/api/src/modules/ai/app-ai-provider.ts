import type { RequestContext } from '../platform/context';
import type { z } from 'zod';

export const APP_AI_PROVIDER = Symbol('APP_AI_PROVIDER');

export type AiSource = { appId: string; type: string; id: string; version?: number; title?:string };
export type AiResourceFacts = { text: string; displayName?:string; source?: AiSource; facts?: Array<Record<string, string | number>> };
export type ToolDefinition = { id: string; appId: string; permission: string; confirmationRequired: boolean; kind?:'read'|'write'; prompt: string; input: z.ZodType<Record<string, unknown>> };

export interface AppAiProvider {
  readonly appId: string;
  readonly agentId?: string;
  /** Enable bounded server-side read tool rounds before preparing a write. */
  readonly nativeReadTools?: boolean;
  readonly skillIds?: readonly string[];
  selectSkills?(question:string,resourceType?:string):readonly string[];
  selectTools?(question:string,resourceType?:string):readonly string[]|undefined;
  toolParameters?(toolId:string):unknown;
  readCacheStamp?(ctx:RequestContext,toolId:string):Promise<string>;
  readonly instructions?: string;
  readonly usePermission: string;
  readonly analysisSystemPrompt: string;
  readonly tools: Record<string, ToolDefinition>;
  allowWriteIntent?(question:string):boolean;
  authorizationStamp?(ctx:RequestContext):Promise<string>;
  resourceFacts(ctx: RequestContext, type: string, id?: string): Promise<AiResourceFacts>;
  options(ctx: RequestContext,question?:string,selection?:{toolIds:readonly string[];resourceType?:string}): Promise<Record<string, unknown>>;
  canUse(ctx: RequestContext, tool: string): boolean;
  execute(ctx: RequestContext, tool: string, input: Record<string, unknown>, execution?:{previewHash?:string}): Promise<unknown>;
  preview?(ctx: RequestContext, tool: string, input: Record<string, unknown>): Promise<unknown>;
  actionPresentation?(ctx: RequestContext, tool: string, input: Record<string, unknown>, result: unknown): Promise<{ parameters: Record<string, unknown>; receipt: Record<string, unknown>; destination?: string }>;
  shortages?(ctx: RequestContext): Promise<unknown>;
  extract?(ctx: RequestContext, body: unknown): Promise<unknown>;
}
