import * as lark from '@larksuiteoapi/node-sdk';
import { PrismaService } from '../prisma.service';
import { AuthService } from './auth.service';
import { AiService } from '../ai/ai.service';
import { ChannelService } from './channel.service';
import { decryptChannelSecret } from './channel-secret';

export class ChannelRuntime {
  private readonly connected = new Map<string, lark.LarkChannel>();
  private readonly retryAfter = new Map<string, number>();
  constructor(private readonly db: PrismaService, private readonly auth: AuthService, private readonly ai: AiService) {}

  async sync() {
    const connections = await this.db.channelConnection.findMany({ where: { provider: 'feishu' } });
    for (const connection of connections) {
      if (this.connected.has(connection.id) || (this.retryAfter.get(connection.id) ?? 0) > Date.now()) continue;
      const channel = lark.createLarkChannel({ appId: connection.appId, appSecret: decryptChannelSecret(connection.secretCiphertext), transport: 'websocket', handshakeTimeoutMs: 15_000, policy: { dmMode: 'open', requireMention: true }, source: 'zhixingfangzhou' });
      channel.on('message', async message => {
        if (message.chatType !== 'p2p' || !message.content.trim() || message.rawContentType !== 'text') return;
        await this.db.channelInbound.createMany({ data: [{ connectionId: connection.id, messageId: message.messageId, senderId: message.senderId, chatId: message.chatId, chatType: message.chatType, content: message.content.slice(0, 4000) }], skipDuplicates: true });
      });
      channel.on('reconnecting', () => { void this.db.channelConnection.update({ where: { id: connection.id }, data: { status: 'reconnecting' } }).catch(() => undefined); });
      channel.on('reconnected', () => { void this.db.channelConnection.update({ where: { id: connection.id }, data: { status: 'connected', connectedAt: new Date(), lastError: null } }).catch(() => undefined); });
      try {
        await channel.connect();
        this.connected.set(connection.id, channel);
        await this.db.channelConnection.update({ where: { id: connection.id }, data: { status: 'connected', connectedAt: new Date(), lastError: null } });
      } catch (error) {
        await channel.disconnect().catch(() => undefined);
        this.retryAfter.set(connection.id, Date.now() + 30_000);
        await this.db.channelConnection.update({ where: { id: connection.id }, data: { status: 'error', lastError: error instanceof Error ? error.name.slice(0, 80) : 'CONNECT_FAILED' } });
      }
    }
  }

  private async replyFor(inbound: { id: string; connectionId: string; senderId: string; chatId: string; content: string }) {
    const content = inbound.content.trim();
    const pair = /^绑定\s+([0-9a-f]{16})$/i.exec(content);
    if (pair) {
      const code = ChannelService.hashPairCode(pair[1]);
      return this.db.$transaction(async tx => {
        const record = await tx.channelPairCode.findUnique({ where: { codeHash: code } });
        if (!record || record.connectionId !== inbound.connectionId || record.usedAt || record.expiresAt <= new Date()) return '绑定码无效或已过期，请在平台重新获取。';
        const member = await tx.membership.findFirst({ where: { id: record.membershipId, tenantId: record.tenantId, active: true, user: { active: true } } });
        if (!member) return '当前平台成员身份不可用。';
        const occupied = await tx.channelIdentity.findUnique({ where: { connectionId_externalUserId: { connectionId: inbound.connectionId, externalUserId: inbound.senderId } } });
        if (occupied && occupied.membershipId !== member.id) return '这个飞书账号已绑定其他平台成员，请先从原账号解绑。';
        const used = await tx.channelPairCode.updateMany({ where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
        if (!used.count) return '绑定码已被使用。';
        await tx.channelIdentity.upsert({ where: { connectionId_membershipId: { connectionId: inbound.connectionId, membershipId: member.id } }, create: { tenantId: record.tenantId, connectionId: inbound.connectionId, membershipId: member.id, externalUserId: inbound.senderId }, update: { externalUserId: inbound.senderId } });
        await tx.auditEvent.create({ data: { tenantId: record.tenantId, userId: member.userId, membershipId: member.id, appId: 'platform', requestId: `channel:${inbound.id}`, action: 'platform.channel.identity.link', resourceType: 'ChannelConnection', resourceId: inbound.connectionId } });
        return '绑定成功。现在可以在这里询问 ERP 业务；发送“执行：具体操作”可授权本条消息发起业务动作。高影响操作仍需回平台核对确认。';
      });
    }
    const identity = await this.db.channelIdentity.findUnique({ where: { connectionId_externalUserId: { connectionId: inbound.connectionId, externalUserId: inbound.senderId } } });
    if (!identity) return '当前飞书账号尚未绑定。请先在知行方舟平台获取绑定码，再私聊发送“绑定 绑定码”。';
    const member = await this.db.membership.findFirst({ where: { id: identity.membershipId, tenantId: identity.tenantId, active: true, user: { active: true } } });
    if (!member) return '平台账号或成员身份已停用，请联系管理员。';
    const ctx = await this.auth.taskContext({ tenantId: identity.tenantId, userId: member.userId, membershipId: member.id, appId: 'erp', taskId: inbound.id });
    let session = await this.db.channelChatSession.findUnique({ where: { connectionId_externalChatId_membershipId: { connectionId: inbound.connectionId, externalChatId: inbound.chatId, membershipId: member.id } } });
    if (!session) {
      const conversation = await this.ai.create(ctx, { title: '飞书业务对话' });
      session = await this.db.channelChatSession.create({ data: { tenantId: identity.tenantId, connectionId: inbound.connectionId, membershipId: member.id, externalChatId: inbound.chatId, conversationId: conversation.id } });
    }
    const conversation = await this.ai.get(ctx, session.conversationId);
    const result = await this.ai.send(ctx, conversation.id, { content, version: conversation.version, allowAction: /^执行[：:\s]/.test(content) }, inbound.id);
    const action = result.message.actionId ? await this.ai.action(ctx, result.message.actionId) : null;
    const receipt = action?.status === 'completed' && result.actionResult ? `\n业务回执：${JSON.stringify(result.actionResult).slice(0, 800)}` : '';
    let link = '';
    if (action?.status === 'pending') {
      if (process.env.WEB_ORIGIN) {
        const page = new URL(`/t/${encodeURIComponent(ctx.tenantKey)}/ai`, process.env.WEB_ORIGIN);
        page.searchParams.set('conversation', conversation.id);
        page.searchParams.set('action', action.id);
        link = `\n请在平台核对后确认：${page.toString()}`;
      } else link = '\n请登录知行方舟平台，在 AI 助手中核对后确认。';
    }
    return `${result.message.content}${receipt}${link}`.slice(0, 3000);
  }

  async processInbound() {
    const now = new Date();
    const stale = new Date(Date.now() - 120_000);
    const inbound = await this.db.channelInbound.findFirst({ where: { OR: [{ status: { in: ['queued', 'retry'] }, nextAttemptAt: { lte: now } }, { status: 'processing', updatedAt: { lt: stale } }] }, orderBy: { createdAt: 'asc' } });
    if (!inbound) return false;
    const channel = this.connected.get(inbound.connectionId);
    if (!channel) return false;
    const claimed = await this.db.channelInbound.updateMany({ where: { id: inbound.id, status: inbound.status, updatedAt: inbound.updatedAt }, data: { status: 'processing', attempts: { increment: 1 } } });
    if (!claimed.count) return true;
    if (inbound.attempts >= 3 && !inbound.replyText) {
      await this.db.channelInbound.update({ where: { id: inbound.id }, data: { status: 'failed' } });
      return true;
    }
    try {
      const replyText = inbound.replyText ?? await this.replyFor(inbound);
      if (!inbound.replyText) await this.db.channelInbound.update({ where: { id: inbound.id }, data: { replyText } });
      await channel.send(inbound.chatId, { text: replyText }, { replyTo: inbound.messageId });
      await this.db.channelInbound.update({ where: { id: inbound.id }, data: { status: 'completed' } });
    } catch (error) {
      const next = inbound.attempts + 1;
      await this.db.channelInbound.update({ where: { id: inbound.id }, data: { status: next >= 3 ? 'failed' : 'retry', nextAttemptAt: new Date(Date.now() + Math.min(60_000, 5_000 * 2 ** next)) } });
      process.stderr.write(`[channel] inbound failed: ${error instanceof Error ? error.name : 'UnknownError'}\n`);
    }
    return true;
  }

  async processDelivery() {
    const item = await this.db.channelDelivery.findFirst({ where: { OR: [{ status: { in: ['queued', 'retry', 'awaiting_identity'] }, nextAttemptAt: { lte: new Date() } }, { status: 'sending', updatedAt: { lt: new Date(Date.now() - 120_000) } }] }, orderBy: { createdAt: 'asc' } });
    if (!item) return false;
    const channel = this.connected.get(item.connectionId);
    if (!channel) return false;
    const member = await this.db.membership.findFirst({ where: { id: item.membershipId, tenantId: item.tenantId, active: true, user: { active: true }, tenant: { active: true } } });
    if (!member) {
      await this.db.channelDelivery.update({ where: { id: item.id }, data: { status: 'cancelled', errorCode: 'RECIPIENT_REVOKED' } });
      return true;
    }
    const identity = await this.db.channelIdentity.findUnique({ where: { connectionId_membershipId: { connectionId: item.connectionId, membershipId: item.membershipId } } });
    if (!identity) {
      await this.db.channelDelivery.update({ where: { id: item.id }, data: { status: 'awaiting_identity', nextAttemptAt: new Date(Date.now() + 60_000) } });
      return true;
    }
    const claimed = await this.db.channelDelivery.updateMany({ where: { id: item.id, status: item.status, updatedAt: item.updatedAt }, data: { status: 'sending', attempts: { increment: 1 } } });
    if (!claimed.count) return true;
    try {
      const sent = await channel.send(identity.externalUserId, { text: `${item.title}\n${item.body}` });
      await this.db.channelDelivery.update({ where: { id: item.id }, data: { status: 'sent', providerMessageId: sent.messageId, sentAt: new Date(), errorCode: null } });
    } catch (error) {
      const next = item.attempts + 1;
      await this.db.channelDelivery.update({ where: { id: item.id }, data: { status: next >= 3 ? 'failed' : 'retry', errorCode: error instanceof Error ? error.name.slice(0, 80) : 'SEND_FAILED', nextAttemptAt: new Date(Date.now() + 5_000 * 2 ** next) } });
    }
    return true;
  }

  async close() {
    await Promise.all([...this.connected.values()].map(channel => channel.disconnect().catch(() => undefined)));
    this.connected.clear();
  }
}
