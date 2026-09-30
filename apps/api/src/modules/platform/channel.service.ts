import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import * as lark from '@larksuiteoapi/node-sdk';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthService } from './auth.service';
import type { RequestContext } from './context';
import { encryptChannelSecret } from './channel-secret';

const provider = 'feishu';
const codeHash = (code: string) => createHash('sha256').update(code.trim().toUpperCase()).digest('hex');

@Injectable()
export class ChannelService {
  constructor(private readonly db: PrismaService, private readonly auth: AuthService) {}

  async list(ctx: RequestContext) {
    const connection = await this.db.channelConnection.findUnique({ where: { tenantId_provider: { tenantId: ctx.tenantId, provider } }, select: { id: true, appId: true, status: true, lastError: true, connectedAt: true, updatedAt: true } });
    const visible = ctx.permissions.includes('platform.manage') ? connection : connection ? { status: connection.status, connectedAt: connection.connectedAt, updatedAt: connection.updatedAt } : null;
    return [
      { provider, availability: 'supported', connection: visible },
      { provider: 'wecom', availability: 'deferred', reason: '企业微信授权及双向消息仍需官方企业应用资格与实测' },
      { provider: 'dingtalk', availability: 'deferred', reason: '钉钉企业授权及双向消息仍需官方应用资格与实测' },
    ];
  }

  async startFeishu(ctx: RequestContext) {
    this.auth.require(ctx, 'platform.manage');
    encryptChannelSecret('preflight');
    const existing = await this.db.channelConnection.findUnique({ where: { tenantId_provider: { tenantId: ctx.tenantId, provider } } });
    if (existing) throw new ConflictException('飞书已配置，请先验证当前连接；更换企业应用需要单独迁移身份映射');
    const active = await this.db.channelConnectAttempt.findFirst({ where: { tenantId: ctx.tenantId, provider, OR: [{ status: 'starting', createdAt: { gt: new Date(Date.now() - 120_000) } }, { status: 'waiting_scan', expiresAt: { gt: new Date() } }] } });
    if (active) throw new ConflictException('已有扫码接入正在进行，请稍后刷新');
    const attempt = await this.db.channelConnectAttempt.create({ data: { tenantId: ctx.tenantId, membershipId: ctx.membershipId, provider } });
    void this.registerFeishu(attempt.id, ctx).catch(() => undefined);
    return { id: attempt.id, status: attempt.status };
  }

  private async registerFeishu(attemptId: string, ctx: RequestContext) {
    try {
      const result = await lark.registerApp({
        source: 'zhixingfangzhou',
        createOnly: true,
        appPreset: { name: '知行方舟业务助手', desc: '在飞书中接收业务通知并处理获授权的工作' },
        addons: { preset: false, scopes: { tenant: ['im:message:send_as_bot'] }, events: { items: { tenant: ['im.message.receive_v1'] } } },
        onQRCodeReady: info => {
          void this.db.channelConnectAttempt.updateMany({ where: { id: attemptId, status: 'starting' }, data: { status: 'waiting_scan', qrUrl: info.url, expiresAt: new Date(Date.now() + info.expireIn * 1000) } }).catch(() => undefined);
        },
      });
      if (!result.client_id || !result.client_secret) throw new Error('MISSING_CREDENTIALS');
      await this.db.$transaction(async tx => {
        const member = await tx.membership.findFirst({ where: { id: ctx.membershipId, tenantId: ctx.tenantId, role: 'admin', active: true, user: { active: true }, tenant: { active: true } } });
        if (!member) throw new Error('ADMIN_REVOKED');
        const connection = await tx.channelConnection.create({ data: { tenantId: ctx.tenantId, provider, appId: result.client_id, secretCiphertext: encryptChannelSecret(result.client_secret), status: 'configured' } });
        await tx.channelConnectAttempt.update({ where: { id: attemptId }, data: { status: 'configured', qrUrl: null } });
        await tx.auditEvent.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, membershipId: ctx.membershipId, appId: 'platform', requestId: ctx.requestId, action: 'platform.channel.feishu.register', resourceType: 'ChannelConnection', resourceId: connection.id } });
      });
    } catch (error) {
      const reason = error instanceof Error && 'code' in error ? String(error.code) : error instanceof Error ? error.name : 'UNKNOWN';
      await this.db.channelConnectAttempt.updateMany({ where: { id: attemptId }, data: { status: 'failed', errorCode: reason.slice(0, 80), qrUrl: null } });
    }
  }

  async attempt(ctx: RequestContext, id: string) {
    this.auth.require(ctx, 'platform.manage');
    let attempt = await this.db.channelConnectAttempt.findFirst({ where: { id, tenantId: ctx.tenantId, provider }, select: { id: true, status: true, qrUrl: true, expiresAt: true, errorCode: true, createdAt: true } });
    if (!attempt) throw new NotFoundException('接入流程不存在');
    if (attempt.status === 'waiting_scan' && attempt.expiresAt && attempt.expiresAt <= new Date()) {
      attempt = await this.db.channelConnectAttempt.update({ where: { id }, data: { status: 'expired', qrUrl: null }, select: { id: true, status: true, qrUrl: true, expiresAt: true, errorCode: true, createdAt: true } });
    }
    return attempt;
  }

  async testDelivery(ctx: RequestContext) {
    this.auth.require(ctx, 'platform.manage');
    const connection = await this.db.channelConnection.findUnique({ where: { tenantId_provider: { tenantId: ctx.tenantId, provider } } });
    if (!connection || connection.status !== 'connected') throw new ConflictException('飞书长连接尚未建立');
    const identity = await this.db.channelIdentity.findUnique({ where: { connectionId_membershipId: { connectionId: connection.id, membershipId: ctx.membershipId } } });
    if (!identity) throw new ConflictException('请先绑定自己的飞书账号');
    return this.db.channelDelivery.create({ data: { tenantId: ctx.tenantId, connectionId: connection.id, membershipId: ctx.membershipId, eventKey: `test:${randomUUID()}`, title: '知行方舟通道测试', body: '这是一条由平台发送的测试消息。' }, select: { id: true, status: true } });
  }

  async delivery(ctx: RequestContext, id: string) {
    const item = await this.db.channelDelivery.findFirst({ where: { id, tenantId: ctx.tenantId, membershipId: ctx.membershipId }, select: { id: true, status: true, attempts: true, errorCode: true, providerMessageId: true, sentAt: true } });
    if (!item) throw new NotFoundException('消息投递记录不存在');
    return item;
  }

  async pairCode(ctx: RequestContext) {
    const connection = await this.db.channelConnection.findUnique({ where: { tenantId_provider: { tenantId: ctx.tenantId, provider } } });
    if (!connection || connection.status !== 'connected') throw new ConflictException('飞书机器人尚未连通');
    const code = randomBytes(8).toString('hex').toUpperCase();
    await this.db.channelPairCode.create({ data: { tenantId: ctx.tenantId, connectionId: connection.id, membershipId: ctx.membershipId, codeHash: codeHash(code), expiresAt: new Date(Date.now() + 10 * 60_000) } });
    return { code, expiresInSeconds: 600, instruction: `在飞书中私聊知行方舟业务助手，发送：绑定 ${code}` };
  }

  async myIdentity(ctx: RequestContext) {
    const connection = await this.db.channelConnection.findUnique({ where: { tenantId_provider: { tenantId: ctx.tenantId, provider } } });
    if (!connection) return { connected: false };
    const identity = await this.db.channelIdentity.findUnique({ where: { connectionId_membershipId: { connectionId: connection.id, membershipId: ctx.membershipId } } });
    return { connected: Boolean(identity), linkedAt: identity?.createdAt ?? null };
  }

  async unlink(ctx: RequestContext) {
    const connection = await this.db.channelConnection.findUnique({ where: { tenantId_provider: { tenantId: ctx.tenantId, provider } } });
    if (!connection) throw new NotFoundException('飞书通道不存在');
    await this.db.$transaction(async tx => {
      await tx.channelIdentity.deleteMany({ where: { connectionId: connection.id, membershipId: ctx.membershipId } });
      await tx.auditEvent.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, membershipId: ctx.membershipId, appId: 'platform', requestId: ctx.requestId, action: 'platform.channel.identity.unlink', resourceType: 'ChannelConnection', resourceId: connection.id } });
    });
    return { connected: false };
  }

  async queuePurchase(tx: Prisma.TransactionClient, ctx: RequestContext, orderId: string, number: string, version: number, kind: 'submitted' | 'approved' | 'rejected', targetMembershipIds: string[]) {
    const connection = await tx.channelConnection.findUnique({ where: { tenantId_provider: { tenantId: ctx.tenantId, provider } } });
    if (!connection) return;
    const title = kind === 'submitted' ? '采购单待审核' : kind === 'approved' ? '采购单审核通过' : '采购单已退回';
    const body = `${title}：${number}。请在知行方舟平台查看单据与审批状态。`;
    for (const membershipId of new Set(targetMembershipIds)) {
      await tx.channelDelivery.create({ data: { tenantId: ctx.tenantId, connectionId: connection.id, membershipId, eventKey: `purchase:${orderId}:${version}:${kind}`, title, body } });
    }
  }

  static hashPairCode(code: string) { return codeHash(code); }
}
