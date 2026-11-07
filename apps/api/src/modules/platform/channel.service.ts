import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import * as lark from "@larksuiteoapi/node-sdk";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../prisma.service";
import { AuthService } from "./auth.service";
import type { RequestContext } from "./context";
import { decryptChannelSecret, encryptChannelSecret } from "./channel-secret";
import {
  beginRegistration,
  pollRegistration,
  channelProvider,
  channelProviders,
  channelNames,
  officialUrl,
  type ChannelProvider,
  type RegisteredChannel,
  type RegistrationState,
} from "./channel-registration";

const codeHash = (code: string) =>
  createHash("sha256").update(code.trim().toUpperCase()).digest("hex");

@Injectable()
export class ChannelService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
  ) {}

  async list(ctx: RequestContext) {
    const connections = await this.db.channelConnection.findMany({
      where: { tenantId: ctx.tenantId },
      select: {
        id: true,
        provider: true,
        status: true,
        lastError: true,
        connectedAt: true,
      },
    });
    const identities = await this.db.channelIdentity.findMany({
      where: { tenantId: ctx.tenantId, membershipId: ctx.membershipId },
      select: { connectionId: true, appId: true },
    });
    return channelProviders.map((provider) => ({
      provider,
      name: channelNames[provider],
      availability: "supported",
      connection: connections.find((c) => c.provider === provider) ?? null,
      linked: identities.some(
        (i) =>
          i.connectionId ===
          connections.find((c) => c.provider === provider)?.id,
      ),
    }));
  }

  async startFeishu(ctx: RequestContext) {
    return this.start(ctx, "feishu");
  }
  async start(ctx: RequestContext, rawProvider: string) {
    this.auth.require(ctx, "platform.manage");
    const provider = channelProvider(rawProvider);
    encryptChannelSecret("preflight");
    const setup = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ctx.tenantId + ":channel:" + provider}))`;
      const existing = await tx.channelConnection.findUnique({
        where: { tenantId_provider: { tenantId: ctx.tenantId, provider } },
      });
      if (existing && !["disconnected", "expired"].includes(existing.status))
        throw new ConflictException("通道已配置，请先断开后重新接入");
      await tx.channelConnectAttempt.updateMany({
        where: {
          tenantId: ctx.tenantId,
          provider,
          status: "starting",
          createdAt: { lt: new Date(Date.now() - 120000) },
        },
        data: {
          status: "failed",
          errorCode: "CHANNEL_SETUP_INTERRUPTED",
          stateCiphertext: null,
          qrUrl: null,
        },
      });
      const active = await tx.channelConnectAttempt.findFirst({
        where: {
          tenantId: ctx.tenantId,
          provider,
          OR: [
            { status: "starting" },
            {
              status: { in: ["waiting_scan", "scanned", "need_verifycode"] },
              expiresAt: { gt: new Date() },
            },
          ],
        },
      });
      if (active) return { attempt: active, created: false };
      return {
        attempt: await tx.channelConnectAttempt.create({
          data: {
            tenantId: ctx.tenantId,
            membershipId: ctx.membershipId,
            provider,
          },
        }),
        created: true,
      };
    });
    const { attempt, created } = setup;
    if (attempt.membershipId !== ctx.membershipId)
      throw new ConflictException("另一位管理员正在接入，请完成或取消该接入");
    if (created) {
      if (provider === "feishu")
        void this.registerFeishu(attempt.id, ctx).catch(() => {});
      else void this.registerQr(attempt.id, provider).catch(() => {});
    }
    return { id: attempt.id, status: attempt.status };
  }

  private async registerQr(
    id: string,
    provider: Exclude<ChannelProvider, "feishu">,
  ) {
    try {
      const result = await beginRegistration(provider);
      await this.db.channelConnectAttempt.updateMany({
        where: { id, status: "starting" },
        data: {
          status: "waiting_scan",
          qrUrl: result.qrUrl,
          expiresAt: new Date(Date.now() + result.expiresIn * 1000),
          stateCiphertext: encryptChannelSecret(JSON.stringify(result.state)),
        },
      });
    } catch {
      await this.failAttempt(id, "CHANNEL_QR_FAILED");
    }
  }
  private async failAttempt(id: string, errorCode: string) {
    await this.db.channelConnectAttempt.updateMany({
      where: {
        id,
        status: {
          in: ["starting", "waiting_scan", "scanned", "need_verifycode"],
        },
      },
      data: { status: "failed", errorCode, stateCiphertext: null, qrUrl: null },
    });
  }
  private async completeAttempt(id: string, credentials: RegisteredChannel) {
    await this.db.$transaction(async (tx) => {
      const before = await tx.channelConnectAttempt.findUniqueOrThrow({
        where: { id },
      });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${before.tenantId + ":channel:" + before.provider}))`;
      const attempt = await tx.channelConnectAttempt.findUniqueOrThrow({
        where: { id },
      });
      if (
        !["starting", "waiting_scan", "scanned", "need_verifycode"].includes(
          attempt.status,
        ) ||
        (attempt.expiresAt && attempt.expiresAt <= new Date())
      )
        return;
      const member = await tx.membership.findFirst({
        where: {
          id: attempt.membershipId,
          tenantId: attempt.tenantId,
          role: "admin",
          active: true,
          user: { active: true },
          tenant: { active: true },
        },
      });
      if (!member) throw new Error("CHANNEL_ADMIN_REVOKED");
      const old = await tx.channelConnection.findUnique({
        where: {
          tenantId_provider: {
            tenantId: attempt.tenantId,
            provider: attempt.provider,
          },
        },
      });
      if (old && !["disconnected", "expired"].includes(old.status))
        throw new Error("CHANNEL_ALREADY_CONNECTED");
      if (old && old.appId !== credentials.appId) {
        await tx.channelIdentity.deleteMany({
          where: { connectionId: old.id },
        });
        await tx.channelPairCode.deleteMany({
          where: { connectionId: old.id },
        });
      }
      const connection = await tx.channelConnection.upsert({
        where: {
          tenantId_provider: {
            tenantId: attempt.tenantId,
            provider: attempt.provider,
          },
        },
        create: {
          tenantId: attempt.tenantId,
          provider: attempt.provider,
          appId: credentials.appId,
          secretCiphertext: encryptChannelSecret(credentials.secret),
        },
        update: {
          appId: credentials.appId,
          secretCiphertext: encryptChannelSecret(credentials.secret),
          status: "configured",
          cursor: null,
          lastError: null,
        },
      });
      if (credentials.scannerId) {
        const oldIdentity = await tx.channelIdentity.findUnique({
          where: {
            connectionId_externalUserId: {
              connectionId: connection.id,
              externalUserId: credentials.scannerId,
            },
          },
        });
        if (oldIdentity && oldIdentity.membershipId !== member.id)
          throw new ConflictException("扫码账号已绑定其他成员，请先解绑");
        await tx.channelIdentity.upsert({
          where: {
            connectionId_membershipId: {
              connectionId: connection.id,
              membershipId: member.id,
            },
          },
          create: {
            tenantId: attempt.tenantId,
            connectionId: connection.id,
            membershipId: member.id,
            externalUserId: credentials.scannerId,
          },
          update: { externalUserId: credentials.scannerId },
        });
      }
      await tx.channelConnectAttempt.update({
        where: { id },
        data: { status: "configured", stateCiphertext: null, qrUrl: null },
      });
      await tx.auditEvent.create({
        data: {
          tenantId: attempt.tenantId,
          userId: member.userId,
          membershipId: member.id,
          appId: "platform",
          requestId: id,
          action: "platform.channel." + attempt.provider + ".register",
          resourceType: "ChannelConnection",
          resourceId: connection.id,
        },
      });
    });
  }
  private async registerFeishu(attemptId: string, ctx: RequestContext) {
    try {
      const result = await lark.registerApp({
        source: "zhixingfangzhou",
        createOnly: true,
        appPreset: {
          name: "知行方舟业务助手",
          desc: "在飞书中接收业务通知并处理获授权的工作",
        },
        addons: {
          preset: false,
          scopes: {
            tenant: ["im:message:send_as_bot", "im:message.p2p_msg:readonly"],
          },
          events: { items: { tenant: ["im.message.receive_v1"] } },
        },
        onQRCodeReady: (info) => {
          void this.db.channelConnectAttempt
            .updateMany({
              where: { id: attemptId, status: "starting" },
              data: {
                status: "waiting_scan",
                qrUrl: officialUrl(info.url, "feishu"),
                expiresAt: new Date(Date.now() + info.expireIn * 1000),
              },
            })
            .catch(() => undefined);
        },
      });
      if (!result.client_id || !result.client_secret)
        throw new Error("MISSING_CREDENTIALS");
      await this.completeAttempt(attemptId, {
        appId: result.client_id,
        secret: result.client_secret,
      });
    } catch {
      await this.failAttempt(attemptId, "CHANNEL_QR_FAILED");
    }
  }

  async attempt(ctx: RequestContext, id: string, rawProvider = "feishu") {
    this.auth.require(ctx, "platform.manage");
    const provider = channelProvider(rawProvider);
    await this.pollAttempt(id, provider, ctx.tenantId);
    const row = await this.db.channelConnectAttempt.findFirst({
      where: { id, tenantId: ctx.tenantId, provider },
      select: {
        id: true,
        status: true,
        qrUrl: true,
        expiresAt: true,
        errorCode: true,
      },
    });
    if (!row) throw new NotFoundException("接入流程不存在");
    return row;
  }
  async pollAttempt(
    id: string,
    provider: ChannelProvider,
    tenantId?: string,
    verifyCode?: string,
  ) {
    const row = await this.db.channelConnectAttempt.findFirst({
      where: { id, provider, ...(tenantId ? { tenantId } : {}) },
    });
    if (
      !row ||
      !["starting", "waiting_scan", "scanned", "need_verifycode"].includes(
        row.status,
      )
    )
      return;
    if (
      (row.expiresAt && row.expiresAt <= new Date()) ||
      (row.status === "starting" &&
        row.createdAt.getTime() < Date.now() - 120000)
    ) {
      await this.db.channelConnectAttempt.updateMany({
        where: { id, status: row.status },
        data: { status: "expired", qrUrl: null, stateCiphertext: null },
      });
      return;
    }
    if (row.status === "need_verifycode" && !verifyCode) return;
    if (
      provider === "feishu" ||
      !row.stateCiphertext ||
      (!verifyCode && row.pollAfter && row.pollAfter > new Date())
    )
      return;
    const claim = await this.db.channelConnectAttempt.updateMany({
      where: { id, status: row.status, pollAfter: row.pollAfter },
      data: { pollAfter: new Date(Date.now() + 45000) },
    });
    if (!claim.count) return;
    try {
      const state = JSON.parse(
        decryptChannelSecret(row.stateCiphertext),
      ) as RegistrationState;
      const result = await pollRegistration(provider, state, verifyCode);
      if (result.credentials) {
        await this.completeAttempt(id, result.credentials);
        return;
      }
      const ended = ["expired", "failed"].includes(result.status);
      await this.db.channelConnectAttempt.updateMany({
        where: { id, status: row.status },
        data: {
          status: result.status,
          pollAfter: new Date(Date.now() + (state.interval ?? 3) * 1000),
          ...(result.state
            ? {
                stateCiphertext: encryptChannelSecret(
                  JSON.stringify(result.state),
                ),
              }
            : {}),
          ...(ended ? { qrUrl: null, stateCiphertext: null } : {}),
        },
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.startsWith("CHANNEL_ADMIN_") ||
          error.message === "CHANNEL_ALREADY_CONNECTED" ||
          error.message === "CHANNEL_CREDENTIALS_MISSING" ||
          error instanceof ConflictException ||
          ("code" in error && error.code === "P2002"))
      ) {
        await this.failAttempt(id, "CHANNEL_SETUP_REJECTED");
        return;
      }
      await this.db.channelConnectAttempt.updateMany({
        where: { id, status: row.status },
        data: {
          pollAfter: new Date(Date.now() + 5000),
          errorCode: "CHANNEL_POLL_RETRY",
        },
      });
    }
  }
  async verifyAttempt(
    ctx: RequestContext,
    rawProvider: string,
    id: string,
    body: { code?: string },
  ) {
    this.auth.require(ctx, "platform.manage");
    if (!/^[0-9a-zA-Z]{4,12}$/.test(body.code ?? ""))
      throw new BadRequestException("请输入微信显示的验证码");
    const provider = channelProvider(rawProvider);
    const row = await this.db.channelConnectAttempt.findFirst({
      where: {
        id,
        provider,
        tenantId: ctx.tenantId,
        status: "need_verifycode",
      },
    });
    if (!row || provider !== "weixin")
      throw new ConflictException("当前接入无需验证码");
    await this.pollAttempt(id, provider, ctx.tenantId, body.code);
    return this.attempt(ctx, id, provider);
  }
  async cancelAttempt(ctx: RequestContext, rawProvider: string, id: string) {
    this.auth.require(ctx, "platform.manage");
    const provider = channelProvider(rawProvider);
    await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ctx.tenantId + ":channel:" + provider}))`;
      await tx.channelConnectAttempt.updateMany({
        where: {
          id,
          tenantId: ctx.tenantId,
          provider,
          status: {
            in: ["starting", "waiting_scan", "scanned", "need_verifycode"],
          },
        },
        data: { status: "cancelled", qrUrl: null, stateCiphertext: null },
      });
    });
    return { cancelled: true };
  }
  async pollSetups() {
    const now = new Date();
    const pending = await this.db.channelConnectAttempt.findMany({
      where: {
        status: {
          in: ["starting", "waiting_scan", "scanned", "need_verifycode"],
        },
        AND: [
          { OR: [{ pollAfter: null }, { pollAfter: { lte: now } }] },
          {
            OR: [
              { expiresAt: { lte: now } },
              {
                status: "starting",
                createdAt: { lt: new Date(Date.now() - 120000) },
              },
              {
                provider: { not: "feishu" },
                status: { in: ["waiting_scan", "scanned"] },
              },
            ],
          },
        ],
      },
      orderBy: [
        { pollAfter: { sort: "asc", nulls: "first" } },
        { createdAt: "asc" },
      ],
      take: 4,
    });
    await Promise.allSettled(
      pending.map((row) =>
        this.pollAttempt(row.id, channelProvider(row.provider)),
      ),
    );
  }

  async testDelivery(ctx: RequestContext, rawProvider = "feishu") {
    const provider = channelProvider(rawProvider);
    this.auth.require(ctx, "platform.manage");
    const connection = await this.db.channelConnection.findUnique({
      where: { tenantId_provider: { tenantId: ctx.tenantId, provider } },
    });
    if (!connection || connection.status !== "connected")
      throw new ConflictException("通道尚未连通");
    const identity = await this.db.channelIdentity.findUnique({
      where: {
        connectionId_membershipId: {
          connectionId: connection.id,
          membershipId: ctx.membershipId,
        },
      },
    });
    if (!identity) throw new ConflictException("请先绑定自己的通道账号");
    return this.db.channelDelivery.create({
      data: {
        tenantId: ctx.tenantId,
        connectionId: connection.id,
        membershipId: ctx.membershipId,
        eventKey: `test:${randomUUID()}`,
        title: "知行方舟通道测试",
        body: "这是一条由平台发送的测试消息。",
      },
      select: { id: true, status: true },
    });
  }

  async delivery(ctx: RequestContext, id: string) {
    const item = await this.db.channelDelivery.findFirst({
      where: { id, tenantId: ctx.tenantId, membershipId: ctx.membershipId },
      select: {
        id: true,
        status: true,
        attempts: true,
        errorCode: true,
        providerMessageId: true,
        sentAt: true,
      },
    });
    if (!item) throw new NotFoundException("消息投递记录不存在");
    return item;
  }

  async pairCode(ctx: RequestContext, rawProvider = "feishu") {
    const provider = channelProvider(rawProvider);
    const connection = await this.db.channelConnection.findUnique({
      where: { tenantId_provider: { tenantId: ctx.tenantId, provider } },
    });
    if (!connection || connection.status !== "connected")
      throw new ConflictException("通道尚未连通");
    const code = randomBytes(8).toString("hex").toUpperCase();
    await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${connection.id + ":pair:" + ctx.membershipId}))`;
      await tx.channelPairCode.updateMany({
        where: {
          connectionId: connection.id,
          membershipId: ctx.membershipId,
          usedAt: null,
        },
        data: { usedAt: new Date() },
      });
      await tx.channelPairCode.create({
        data: {
          tenantId: ctx.tenantId,
          connectionId: connection.id,
          membershipId: ctx.membershipId,
          codeHash: codeHash(code),
          expiresAt: new Date(Date.now() + 10 * 60_000),
        },
      });
    });
    return {
      code,
      expiresInSeconds: 600,
      instruction: `在${channelNames[provider]}中私聊知行方舟业务助手，发送：绑定 ${code}`,
    };
  }

  async myIdentity(ctx: RequestContext, rawProvider = "feishu") {
    const provider = channelProvider(rawProvider);
    const connection = await this.db.channelConnection.findUnique({
      where: { tenantId_provider: { tenantId: ctx.tenantId, provider } },
    });
    if (!connection)
      return { connected: false, apps: await this.availableApps(ctx) };
    const identity = await this.db.channelIdentity.findUnique({
      where: {
        connectionId_membershipId: {
          connectionId: connection.id,
          membershipId: ctx.membershipId,
        },
      },
    });
    return {
      connected: Boolean(identity),
      linkedAt: identity?.createdAt ?? null,
      appId: identity?.appId,
      apps: await this.availableApps(ctx),
    };
  }

  async unlink(ctx: RequestContext, rawProvider = "feishu") {
    const provider = channelProvider(rawProvider);
    const connection = await this.db.channelConnection.findUnique({
      where: { tenantId_provider: { tenantId: ctx.tenantId, provider } },
    });
    if (!connection) throw new NotFoundException("通道不存在");
    await this.db.$transaction(async (tx) => {
      await tx.channelIdentity.deleteMany({
        where: { connectionId: connection.id, membershipId: ctx.membershipId },
      });
      await tx.channelPairCode.deleteMany({
        where: { connectionId: connection.id, membershipId: ctx.membershipId },
      });
      await tx.channelDelivery.updateMany({
        where: {
          connectionId: connection.id,
          membershipId: ctx.membershipId,
          status: { in: ["queued", "retry", "awaiting_identity"] },
        },
        data: { status: "cancelled", errorCode: "RECIPIENT_UNLINKED" },
      });
      await tx.auditEvent.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          membershipId: ctx.membershipId,
          appId: "platform",
          requestId: ctx.requestId,
          action: "platform.channel.identity.unlink",
          resourceType: "ChannelConnection",
          resourceId: connection.id,
        },
      });
    });
    return { connected: false };
  }

  async availableApps(ctx: RequestContext) {
    const result: Array<{ id: string; name: string }> = [];
    for (const [id, name] of [
      ["erp", "ERP 管家"],
      ["crm", "CRM 运营官"],
      ["mes", "MES 生产官"],
      ["content", "品牌内容创作官"],
    ]) {
      try {
        const context = await this.auth.taskContext({
          tenantId: ctx.tenantId,
          membershipId: ctx.membershipId,
          userId: ctx.userId,
          appId: id,
          taskId: ctx.requestId,
        });
        if (context.permissions.includes(id + ".ai.use"))
          result.push({ id, name });
      } catch {
        /* only offer authorized applications */
      }
    }
    return result;
  }
  async setApp(ctx: RequestContext, rawProvider: string, appId: string) {
    const provider = channelProvider(rawProvider);
    if (!(await this.availableApps(ctx)).some((app) => app.id === appId))
      throw new BadRequestException("当前成员没有使用此助手的权限");
    const connection = await this.db.channelConnection.findUnique({
      where: { tenantId_provider: { tenantId: ctx.tenantId, provider } },
    });
    if (!connection) throw new NotFoundException("通道不存在");
    const changed = await this.db.channelIdentity.updateMany({
      where: {
        tenantId: ctx.tenantId,
        connectionId: connection.id,
        membershipId: ctx.membershipId,
      },
      data: { appId },
    });
    if (!changed.count) throw new ConflictException("请先绑定通道账号");
    return this.myIdentity(ctx, provider);
  }
  async disconnect(ctx: RequestContext, rawProvider: string) {
    this.auth.require(ctx, "platform.manage");
    const provider = channelProvider(rawProvider);
    await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ctx.tenantId + ":channel:" + provider}))`;
      const connection = await tx.channelConnection.findUnique({
        where: { tenantId_provider: { tenantId: ctx.tenantId, provider } },
      });
      if (!connection) throw new NotFoundException("通道不存在");
      await tx.channelConnection.update({
        where: { id: connection.id },
        data: {
          status: "disconnected",
          secretCiphertext: "",
          cursor: null,
          lastError: null,
        },
      });
      await tx.channelConnectAttempt.updateMany({
        where: {
          tenantId: ctx.tenantId,
          provider,
          status: {
            in: ["starting", "waiting_scan", "scanned", "need_verifycode"],
          },
        },
        data: { status: "cancelled", qrUrl: null, stateCiphertext: null },
      });
      await tx.channelPairCode.deleteMany({
        where: { connectionId: connection.id },
      });
      await tx.channelIdentity.deleteMany({
        where: { connectionId: connection.id },
      });
      await tx.channelDelivery.updateMany({
        where: {
          connectionId: connection.id,
          status: { in: ["queued", "retry", "awaiting_identity"] },
        },
        data: { status: "cancelled", errorCode: "CHANNEL_DISCONNECTED" },
      });
      await tx.auditEvent.create({
        data: {
          tenantId: ctx.tenantId,
          membershipId: ctx.membershipId,
          userId: ctx.userId,
          appId: "platform",
          requestId: ctx.requestId,
          action: "platform.channel." + provider + ".disconnect",
          resourceType: "ChannelConnection",
          resourceId: connection.id,
        },
      });
    });
    return { disconnected: true };
  }

  async queuePurchase(
    tx: Prisma.TransactionClient,
    ctx: RequestContext,
    orderId: string,
    number: string,
    version: number,
    kind: "submitted" | "approved" | "rejected",
    targetMembershipIds: string[],
  ) {
    const connections = await tx.channelConnection.findMany({
      where: { tenantId: ctx.tenantId, status: { not: "disconnected" } },
    });
    if (!connections.length) return;
    const title =
      kind === "submitted"
        ? "采购单待审核"
        : kind === "approved"
          ? "采购单审核通过"
          : "采购单已退回";
    const body = `${title}：${number}。请在知行方舟平台查看单据与审批状态。`;
    for (const connection of connections)
      for (const membershipId of new Set(targetMembershipIds)) {
        await tx.channelDelivery.create({
          data: {
            tenantId: ctx.tenantId,
            connectionId: connection.id,
            membershipId,
            eventKey: `purchase:${orderId}:${version}:${kind}`,
            title,
            body,
          },
        });
      }
  }

  static hashPairCode(code: string) {
    return codeHash(code);
  }
}
