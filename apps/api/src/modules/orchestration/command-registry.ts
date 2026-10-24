import { ConflictException, ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
export const APPLICATION_COMMANDS = Symbol('APPLICATION_COMMANDS');
export type CommandResult = { state: 'completed' | 'waiting'; result: Prisma.InputJsonValue };
export type PublicCommand = {
  appId: string; id: string; permission: string; title: string; confirmation: boolean;
  input: z.ZodType;
  preview?(ctx:RequestContext,input:any):Promise<unknown>;
  /** Writes and receipt must share this transaction. Handler owns its domain invariants. */
  execute(tx: Prisma.TransactionClient, ctx: RequestContext, input: any): Promise<CommandResult>;
};
export type ResourceReader = (ctx: RequestContext, type: string, id: string) => Promise<unknown>;
export function fingerprint(value: unknown): string {
  const normalize=(v:any):any=>Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,normalize(v[k])])):v;
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}
export class CommandRegistry {
  private commands = new Map<string, PublicCommand>();
  private readers = new Map<string, ResourceReader>();
  register(command: PublicCommand) {
    if (this.commands.has(command.id) || !command.id.startsWith(command.appId+'.') || !command.permission.startsWith(command.appId+'.')) throw Error('Invalid command registration');
    this.commands.set(command.id,command);
  }
  registerReader(appId: string, reader: ResourceReader) { if(this.readers.has(appId))throw Error('Duplicate reader'); this.readers.set(appId,reader); }
  get(appId: string, command: string) {const found=this.commands.get(command);if(!found||found.appId!==appId)throw new ConflictException('应用未提供此公开操作');return found;}
  prepare(ctx: RequestContext, id: string, input: unknown) {const cmd=this.get(ctx.app.appId,id);if(!ctx.permissions.includes(cmd.permission))throw new ForbiddenException('无权执行此应用操作');return{cmd,input:readBody(cmd.input,input)};}
  catalog(ctx: RequestContext) {return [...this.commands.values()].filter(c=>c.appId===ctx.app.appId&&ctx.permissions.includes(c.permission)).map(({appId,id,permission,title,confirmation})=>({appId,id,permission,title,confirmation}));}
  async resource(ctx: RequestContext,type:string,id:string){const reader=this.readers.get(ctx.app.appId);if(!reader)throw new ConflictException('应用未提供对象查询');return reader(ctx,type,id);}
}
