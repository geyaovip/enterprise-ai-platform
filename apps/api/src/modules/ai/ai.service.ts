import { ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../platform/auth.service';
import type { RequestContext } from '../platform/context';
import { readBody } from '../platform/security';
import { APP_AI_PROVIDER, type AppAiProvider } from './app-ai-provider';
import { ModelGateway } from './model.gateway';

const resourceInput = z.object({ type: z.enum(['purchase', 'contract', 'customer', 'inventory']), id: z.uuid().optional() });
const createInput = z.object({ title: z.string().trim().min(1).max(120), resource: resourceInput.optional() });
const messageInput = z.object({ content: z.string().trim().min(1).max(4000), version: z.int().positive(), allowAction: z.boolean().default(false) });
const modelPlan = z.object({ answer: z.string().default(''), action: z.object({ tool: z.string(), input: z.record(z.string(), z.unknown()) }).optional() });
const reviewInput = z.object({ type: z.enum(['purchase', 'contract']), id: z.uuid() });
const reviewNarrative = z.object({ summary: z.string().trim().min(1).max(3000), actions: z.array(z.string().trim().min(1).max(500)).max(12), missing_data: z.array(z.string().trim().min(1).max(500)).max(12) });
type Message = { role: 'user' | 'assistant'; content: string; actionId?: string; sources?: Array<{ appId: string; type: string; id: string; version?: number }> };

@Injectable()
export class AiService {
  constructor(private readonly db: PrismaService, private readonly auth: AuthService, private readonly gateway: ModelGateway, @Inject(APP_AI_PROVIDER) private readonly provider: AppAiProvider) {}

  private require(ctx: RequestContext) {
    if (ctx.app.appId !== this.provider.appId) throw new ConflictException('当前应用不支持此 AI 能力');
    this.auth.require(ctx, this.provider.usePermission);
  }
  private messages(raw: Prisma.JsonValue): Message[] { return Array.isArray(raw) ? raw as Message[] : []; }

  async list(ctx: RequestContext) {
    this.require(ctx);
    return this.db.aiConversation.findMany({ where: { tenantId: ctx.tenantId, userId: ctx.userId, appId: ctx.app.appId }, select: { id: true, title: true, resourceType: true, resourceId: true, updatedAt: true }, orderBy: { updatedAt: 'desc' }, take: 50 });
  }

  async create(ctx: RequestContext, body: unknown) {
    this.require(ctx);
    const input = readBody(createInput, body);
    if (input.resource) await this.provider.resourceFacts(ctx, input.resource.type, input.resource.id);
    return this.db.aiConversation.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, appId: ctx.app.appId, resourceType: input.resource?.type, resourceId: input.resource?.id, title: input.title } });
  }

  async get(ctx: RequestContext, id: string) {
    this.require(ctx);
    const conversation = await this.db.aiConversation.findFirst({ where: { id, tenantId: ctx.tenantId, userId: ctx.userId, appId: ctx.app.appId } });
    if (!conversation) throw new NotFoundException('会话不存在');
    return conversation;
  }

  async remove(ctx: RequestContext, id: string) {
    this.require(ctx);
    await this.get(ctx, id);
    return this.db.$transaction(async tx => {
      const pending = await tx.aiAction.count({ where: { tenantId: ctx.tenantId, userId: ctx.userId, appId: ctx.app.appId, conversationId: id, status: { in: ['pending', 'running'] } } });
      if (pending) throw new ConflictException('会话仍有待处理业务操作，请先处理');
      await tx.aiConversation.delete({ where: { id } });
      await tx.auditEvent.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, membershipId: ctx.membershipId, appId: ctx.app.appId, requestId: ctx.requestId, action: 'erp.ai.conversation.delete', resourceType: 'AiConversation', resourceId: id } });
      return { ok: true };
    });
  }

  private parsePlan(text: string) {
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { return modelPlan.parse(JSON.parse(cleaned)); } catch { return { answer: text, action: undefined }; }
  }

  async send(ctx: RequestContext, id: string, body: unknown) {
    this.require(ctx);
    const input = readBody(messageInput, body);
    const conversation = await this.get(ctx, id);
    if (conversation.version !== input.version) throw new ConflictException('会话已更新，请刷新');
    const prior = this.messages(conversation.messages);
    if (prior.at(-1)?.role === 'user') throw new ConflictException('上一条消息仍在处理');
    if (prior.length >= 100) throw new ConflictException('会话已达消息上限，请新建会话');
    const userMessage: Message = { role: 'user', content: input.content };
    const reserved = await this.db.aiConversation.updateMany({ where: { id, tenantId: ctx.tenantId, userId: ctx.userId, version: input.version }, data: { messages: [...prior, userMessage] as Prisma.InputJsonValue, version: { increment: 1 } } });
    if (!reserved.count) throw new ConflictException('会话已更新，请刷新');
    let assistant: Message;
    let actionResult: unknown;
    let runningActionId: string | undefined;
    try {
      const resource = conversation.resourceType ? await this.provider.resourceFacts(ctx, conversation.resourceType, conversation.resourceId ?? undefined) : { text: '', source: undefined };
      const options = await this.provider.options(ctx);
      const available = (Object.keys(this.provider.tools)).filter(tool => this.provider.canUse(ctx, tool));
      const system = `你是 ${this.provider.appId} 业务助手。只使用给定事实，不编造库存、金额或成功回执。若用户要求业务操作，输出严格 JSON：{"answer":"简短说明","action":{"tool":"工具ID","input":{}}}；普通回答输出 {"answer":"..."}。只选有权限且用户明确要求的动作。高影响动作只提出预览，等待用户确认。可用工具：${available.join(', ')}。当前已授权对象：${resource.text}。可用主数据：${JSON.stringify(options)}。`;
      const history = prior.slice(-10).map(m => ({ role: m.role, content: m.content }));
      const raw = await this.gateway.complete(ctx, [{ role: 'system', content: system }, ...history, { role: 'user', content: input.content }]);
      const plan = this.parsePlan(raw);
      assistant = { role: 'assistant', content: plan.answer || '已收到请求。', ...(resource.source ? { sources: [resource.source] } : {}) };
      if (plan.action) {
        if (!input.allowAction) {
          assistant.content += ' 本条消息未授权发起业务操作；请勾选允许执行并重新明确提出操作。';
          const updated = await this.db.aiConversation.update({ where: { id }, data: { messages: [...prior, userMessage, assistant] as Prisma.InputJsonValue, version: { increment: 1 } } });
          return { message: assistant, actionResult, version: updated.version };
        }
        const tool = plan.action.tool;
        if (!this.provider.canUse(ctx, tool)) throw new ConflictException('模型请求了未授权工具');
        const action = await this.db.aiAction.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, membershipId: ctx.membershipId, appId: ctx.app.appId, conversationId: id, toolId: tool, input: plan.action.input as Prisma.InputJsonValue, status: this.provider.tools[tool].confirmationRequired ? 'pending' : 'running', confirmationRequired: this.provider.tools[tool].confirmationRequired, idempotencyKey: `${id}:${input.version}:${tool}` } });
        assistant.actionId = action.id;
        if (action.confirmationRequired) assistant.content += ' 请核对待执行对象和字段后确认。';
        else {
          runningActionId = action.id;
          actionResult = await this.provider.execute(ctx, tool, plan.action.input);
          await this.db.aiAction.update({ where: { id: action.id }, data: { status: 'completed', result: actionResult as Prisma.InputJsonValue } });
          runningActionId = undefined;
          assistant.content += ' 操作已提交，结果以业务回执为准。';
        }
      }
    } catch (error) {
      if (runningActionId) await this.db.aiAction.updateMany({ where: { id: runningActionId, status: 'running' }, data: { status: 'failed', errorCode: error instanceof Error ? error.name : 'UNKNOWN' } });
      assistant = { role: 'assistant', content: error instanceof Error ? `本次请求未完成：${error.message}` : '本次请求未完成' };
    }
    const updated = await this.db.aiConversation.update({ where: { id }, data: { messages: [...prior, userMessage, assistant] as Prisma.InputJsonValue, version: { increment: 1 } } });
    return { message: assistant, actionResult, version: updated.version };
  }

  async action(ctx: RequestContext, id: string) {
    this.require(ctx);
    const action = await this.db.aiAction.findFirst({ where: { id, tenantId: ctx.tenantId, userId: ctx.userId, membershipId: ctx.membershipId, appId: ctx.app.appId } });
    if (!action) throw new NotFoundException('操作不存在');
    return action;
  }

  async confirm(ctx: RequestContext, id: string) {
    const action = await this.action(ctx, id);
    if (!action.confirmationRequired || action.status !== 'pending') throw new ConflictException('操作不在待确认状态');
    const tool = action.toolId;
    if (!this.provider.canUse(ctx, tool)) throw new ConflictException('当前无权执行此操作');
    const claimed = await this.db.aiAction.updateMany({ where: { id, status: 'pending' }, data: { status: 'running' } });
    if (!claimed.count) throw new ConflictException('操作已被处理');
    try {
      const result = await this.provider.execute(ctx, tool, action.input as Record<string, unknown>);
      await this.db.aiAction.update({ where: { id }, data: { status: 'completed', result: result as Prisma.InputJsonValue } });
      return { status: 'completed', result };
    } catch (error) {
      await this.db.aiAction.update({ where: { id }, data: { status: 'failed', errorCode: error instanceof Error ? error.name : 'UNKNOWN' } });
      throw error;
    }
  }

  async shortages(ctx: RequestContext) {
    this.require(ctx);
    return this.provider.shortages(ctx);
  }

  async enqueue(ctx: RequestContext, body: unknown) {
    this.require(ctx);
    const input = readBody(z.object({ kind: z.enum(['analyze', 'extract']), input: z.unknown() }), body);
    if (input.kind === 'analyze') {
      const query = readBody(z.object({ type: z.enum(['purchase', 'contract', 'inventory', 'customer']), id: z.uuid().optional(), question: z.string().trim().min(1).max(2000) }), input.input);
      const facts = await this.provider.resourceFacts(ctx, query.type, query.id);
      if (!facts.text) throw new NotFoundException('分析对象不存在');
    } else {
      const query = readBody(z.object({ kind: z.enum(['purchase', 'contract']), text: z.string().trim().min(10).max(12000) }), input.input);
      this.auth.require(ctx, query.kind === 'purchase' ? 'erp.purchase.write' : 'erp.sales.write');
    }
    return this.db.aiTask.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, membershipId: ctx.membershipId, appId: ctx.app.appId, kind: input.kind, input: input.input as Prisma.InputJsonValue }, select: { id: true, kind: true, status: true, createdAt: true } });
  }

  async task(ctx: RequestContext, id: string) {
    this.require(ctx);
    const task = await this.db.aiTask.findFirst({ where: { id, tenantId: ctx.tenantId, userId: ctx.userId, membershipId: ctx.membershipId, appId: ctx.app.appId } });
    if (!task) throw new NotFoundException('任务不存在');
    if (task.kind === 'analyze') {
      const input = readBody(z.object({ type: z.enum(['purchase', 'contract', 'inventory', 'customer']), id: z.uuid().optional() }), task.input);
      await this.provider.resourceFacts(ctx, input.type, input.id);
    } else if (task.kind === 'extract') {
      const input = readBody(z.object({ kind: z.enum(['purchase', 'contract']) }), task.input);
      this.auth.require(ctx, input.kind === 'purchase' ? 'erp.purchase.write' : 'erp.sales.write');
    }
    return { id: task.id, kind: task.kind, status: task.status, result: task.result, errorCode: task.errorCode, attempts: task.attempts, createdAt: task.createdAt, updatedAt: task.updatedAt };
  }

  async analyze(ctx: RequestContext, body: unknown) {
    this.require(ctx);
    const input = readBody(z.object({ type: z.enum(['purchase', 'contract', 'inventory', 'customer']), id: z.uuid().optional(), question: z.string().trim().min(1).max(2000) }), body);
    const facts = await this.provider.resourceFacts(ctx, input.type, input.id);
    if (!facts.text) throw new NotFoundException('分析对象不存在');
    const answer = await this.gateway.complete(ctx, [
      { role: 'system', content: this.provider.analysisSystemPrompt },
      { role: 'user', content: `业务事实：${facts.text}\n问题：${input.question}` },
    ]);
    return { answer, sources: facts.source ? [facts.source] : [], status: 'suggestion' };
  }

  private reviewHash(text: string) { return createHash('sha256').update(text).digest('hex'); }

  async latestReview(ctx: RequestContext, type: string, id: string) {
    this.require(ctx);
    const input = readBody(reviewInput, { type, id });
    const source = await this.provider.resourceFacts(ctx, input.type, input.id);
    if (!source.text) throw new NotFoundException('分析对象不存在');
    const sourceHash = this.reviewHash(source.text);
    const rows = await this.db.auditEvent.findMany({ where: { tenantId: ctx.tenantId, userId: ctx.userId, appId: ctx.app.appId, action: 'erp.ai.risk_review', resourceType: input.type, resourceId: input.id }, orderBy: { createdAt: 'desc' }, take: 10 });
    const matching = rows.find(row => (row.detail as { sourceHash?: string } | null)?.sourceHash === sourceHash);
    const detail = matching?.detail as { review?: unknown } | undefined;
    return { review: detail?.review ?? null, reviewedAt: matching?.createdAt ?? null, source: source.source ?? null };
  }

  async review(ctx: RequestContext, body: unknown) {
    this.require(ctx);
    const input = readBody(reviewInput, body);
    const source = await this.provider.resourceFacts(ctx, input.type, input.id);
    if (!source.text || !source.facts) throw new NotFoundException('分析对象不存在');
    const sourceHash = this.reviewHash(source.text);
    const raw = await this.gateway.complete(ctx, [
      { role: 'system', content: '你是 ERP 履约分析助手。只依据给定业务事实输出严格 JSON：{"summary":"简短风险概述","actions":["需人工核实的建议"],"missing_data":["无法从事实确认的信息"]}。不得编造交期、库存、金额，不能声称已执行出入库或记账。' },
      { role: 'user', content: `分析当前${input.type === 'purchase' ? '采购单' : '销售合同'}履约风险。业务事实：${source.text}` },
    ]);
    let narrative: z.infer<typeof reviewNarrative>;
    try { narrative = reviewNarrative.parse(JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))); }
    catch { throw new ServiceUnavailableException('AI 分析结果格式无效，请重试'); }
    const fresh = await this.provider.resourceFacts(ctx, input.type, input.id);
    if (this.reviewHash(fresh.text) !== sourceHash) throw new ConflictException('单据或库存已更新，请重新分析');
    const review = { ...narrative, facts: source.facts };
    const row = await this.db.auditEvent.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, membershipId: ctx.membershipId, appId: ctx.app.appId, requestId: ctx.requestId, action: 'erp.ai.risk_review', resourceType: input.type, resourceId: input.id, detail: { sourceHash, review } as Prisma.InputJsonValue } });
    return { review, reviewedAt: row.createdAt, source: source.source ?? null };
  }

  async extract(ctx: RequestContext, body: unknown) {
    this.require(ctx);
    return this.provider.extract(ctx, body);
  }
}
