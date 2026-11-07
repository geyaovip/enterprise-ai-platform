import { currentActors, type FlowStep } from "../erp/workflow.rules";
import { createChatTransport, type ChatTransport } from "./channel-transport";
import { channelProvider, type ChannelProvider } from "./channel-registration";
import { PrismaService } from "../prisma.service";
import { AuthService } from "./auth.service";
import { AiService } from "../ai/ai.service";
import { ChannelService } from "./channel.service";
import { decryptChannelSecret, encryptChannelSecret } from "./channel-secret";

export class ChannelRuntime {
  private readonly connected = new Map<string, ChatTransport>();
  private readonly bindings = new Map<string, string>();
  private readonly retryAfter = new Map<string, number>();
  constructor(
    private readonly db: PrismaService,
    private readonly auth: AuthService,
    private readonly ai: AiService,
  ) {}

  async sync() {
    const connections = await this.db.channelConnection.findMany({
      where: { provider: { in: ["feishu", "weixin", "wecom", "dingtalk"] } },
    });
    for (const [id, client] of this.connected) {
      const row = connections.find((c) => c.id === id);
      if (
        !row ||
        ["disconnected", "expired"].includes(row.status) ||
        this.bindings.get(id) !== row.secretCiphertext
      ) {
        this.connected.delete(id);
        this.bindings.delete(id);
        await client.disconnect().catch(() => {});
      }
    }
    let started = 0;
    for (const connection of connections) {
      if (
        ["disconnected", "expired"].includes(connection.status) ||
        !connection.secretCiphertext ||
        this.connected.has(connection.id) ||
        (this.retryAfter.get(connection.id) ?? 0) > Date.now()
      )
        continue;
      if (started++ >= 2) break;
      let client: ChatTransport | undefined;
      try {
        const activeWhere = {
          id: connection.id,
          secretCiphertext: connection.secretCiphertext,
          status: { notIn: ["disconnected", "expired"] },
        };
        client = createChatTransport({
          provider: channelProvider(connection.provider),
          appId: connection.appId,
          secret: decryptChannelSecret(connection.secretCiphertext),
          cursor: connection.cursor,
          state: async (status) => {
            await this.db.channelConnection.updateMany({
              where: activeWhere,
              data: {
                status,
                ...(status === "connected"
                  ? { connectedAt: new Date(), lastError: null }
                  : {}),
              },
            });
          },
          persistCursor: async (cursor) => {
            await this.db.channelConnection.updateMany({
              where: activeWhere,
              data: { cursor },
            });
          },
          receive: async (message) => {
            await this.db.$transaction(async (tx) => {
              const active = await tx.channelConnection.findFirst({
                where: activeWhere,
              });
              if (!active) return;
              await tx.channelInbound.createMany({
                data: [
                  {
                    connectionId: connection.id,
                    messageId: message.messageId,
                    senderId: message.senderId,
                    chatId: message.chatId,
                    chatType: "p2p",
                    content: message.content.slice(0, 4000),
                    ...(message.context
                      ? {
                          contextCiphertext: encryptChannelSecret(
                            JSON.stringify(message.context),
                          ),
                        }
                      : {}),
                  },
                ],
                skipDuplicates: true,
              });
            });
          },
        });
        await client.connect();
        const active = await this.db.channelConnection.updateMany({
          where: activeWhere,
          data: {
            status: "connected",
            connectedAt: new Date(),
            lastError: null,
          },
        });
        if (!active.count) {
          await client.disconnect();
          continue;
        }
        this.connected.set(connection.id, client);
        this.bindings.set(connection.id, connection.secretCiphertext);
      } catch {
        await client?.disconnect().catch(() => {});
        this.retryAfter.set(connection.id, Date.now() + 30000);
        await this.db.channelConnection.updateMany({
          where: {
            id: connection.id,
            secretCiphertext: connection.secretCiphertext,
            status: { notIn: ["disconnected", "expired"] },
          },
          data: { status: "error", lastError: "CHANNEL_CONNECT_FAILED" },
        });
      }
    }
  }

  private async replyFor(inbound: {
    id: string;
    connectionId: string;
    senderId: string;
    chatId: string;
    content: string;
  }) {
    const content = inbound.content.trim();
    const pair = /^绑定\s+([0-9a-f]{16})$/i.exec(content);
    if (pair) {
      const code = ChannelService.hashPairCode(pair[1]);
      return this.db.$transaction(async (tx) => {
        const record = await tx.channelPairCode.findUnique({
          where: { codeHash: code },
        });
        if (
          !record ||
          record.connectionId !== inbound.connectionId ||
          record.usedAt ||
          record.expiresAt <= new Date()
        )
          return "绑定码无效或已过期，请在平台重新获取。";
        const member = await tx.membership.findFirst({
          where: {
            id: record.membershipId,
            tenantId: record.tenantId,
            active: true,
            user: { active: true },
          },
        });
        if (!member) return "当前平台成员身份不可用。";
        const bound = await tx.channelIdentity.findUnique({
          where: {
            connectionId_membershipId: {
              connectionId: inbound.connectionId,
              membershipId: member.id,
            },
          },
        });
        if (bound && bound.externalUserId !== inbound.senderId)
          return "此平台成员已有绑定，请先在平台解除原绑定。";
        const occupied = await tx.channelIdentity.findUnique({
          where: {
            connectionId_externalUserId: {
              connectionId: inbound.connectionId,
              externalUserId: inbound.senderId,
            },
          },
        });
        if (occupied && occupied.membershipId !== member.id)
          return "这个通道账号已绑定其他平台成员，请先从原账号解绑。";
        const used = await tx.channelPairCode.updateMany({
          where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } },
          data: { usedAt: new Date() },
        });
        if (!used.count) return "绑定码已被使用。";
        await tx.channelIdentity.upsert({
          where: {
            connectionId_membershipId: {
              connectionId: inbound.connectionId,
              membershipId: member.id,
            },
          },
          create: {
            tenantId: record.tenantId,
            connectionId: inbound.connectionId,
            membershipId: member.id,
            externalUserId: inbound.senderId,
          },
          update: { externalUserId: inbound.senderId },
        });
        await tx.auditEvent.create({
          data: {
            tenantId: record.tenantId,
            userId: member.userId,
            membershipId: member.id,
            appId: "platform",
            requestId: `channel:${inbound.id}`,
            action: "platform.channel.identity.link",
            resourceType: "ChannelConnection",
            resourceId: inbound.connectionId,
          },
        });
        return "绑定成功。发送“助手”查看可用助手，发送“切换 CRM”等指令选择助手。发送“执行：具体操作”可发起业务动作，高影响操作需回平台核对确认。";
      });
    }
    const identity = await this.db.channelIdentity.findUnique({
      where: {
        connectionId_externalUserId: {
          connectionId: inbound.connectionId,
          externalUserId: inbound.senderId,
        },
      },
    });
    if (!identity)
      return "请先在知行方舟的“消息与通知”获取绑定码，再发送“绑定 绑定码”。";
    const member = await this.db.membership.findFirst({
      where: {
        id: identity.membershipId,
        tenantId: identity.tenantId,
        active: true,
        user: { active: true },
      },
    });
    if (!member) return "平台账号或成员身份已停用，请联系管理员。";
    await this.db.channelInbound.update({
      where: { id: inbound.id },
      data: { replyMembershipId: member.id },
    });
    const names: Record<string, string> = {
      erp: "ERP 管家",
      crm: "CRM 运营官",
      mes: "MES 生产官",
      content: "品牌内容创作官",
    };
    const available = new Map<
      string,
      Awaited<ReturnType<AuthService["taskContext"]>>
    >();
    for (const appId of Object.keys(names)) {
      try {
        const context = await this.auth.taskContext({
          tenantId: identity.tenantId,
          userId: member.userId,
          membershipId: member.id,
          appId,
          taskId: inbound.id,
        });
        if (context.permissions.includes(appId + ".ai.use"))
          available.set(appId, context);
      } catch {
        /* excluded by current grants */
      }
    }
    if (!available.size)
      return "当前账号没有可用的业务助手，请联系企业管理员。";
    const switchTo =
      /^(?:\/切换|切换|\/use)\s+(ERP|CRM|MES|content|品牌内容)$/i.exec(content);
    if (/^(?:助手|\/助手|\/help)$/.test(content))
      return (
        "可用助手：" +
        [...available.keys()].map((id) => names[id]).join("、") +
        "。发送“切换 ERP”“切换 CRM”“切换 MES”或“切换 品牌内容”。"
      );
    let appId = identity.appId;
    if (switchTo) {
      appId =
        switchTo[1] === "品牌内容" ? "content" : switchTo[1].toLowerCase();
      if (!available.has(appId)) return "当前账号没有使用这个助手的权限。";
      await this.db.channelIdentity.updateMany({
        where: { id: identity.id, externalUserId: inbound.senderId },
        data: { appId },
      });
      return "已切换到" + names[appId] + "。";
    }
    if (!available.has(appId)) appId = available.keys().next().value!;
    const ctx = available.get(appId)!;
    const sessionKey = {
      connectionId: inbound.connectionId,
      externalChatId: inbound.chatId,
      membershipId: member.id,
      appId,
    };
    let session = await this.db.channelChatSession.findUnique({
      where: { connectionId_externalChatId_membershipId_appId: sessionKey },
    });
    if (!session) {
      const conversation = await this.ai.create(ctx, {
        title: names[appId] + "通道对话",
      });
      session = await this.db.channelChatSession.upsert({
        where: { connectionId_externalChatId_membershipId_appId: sessionKey },
        create: {
          tenantId: identity.tenantId,
          ...sessionKey,
          conversationId: conversation.id,
        },
        update: {},
      });
    }
    await this.db.channelInbound.update({
      where: { id: inbound.id },
      data: { replyAppId: ctx.app.appId },
    });
    const conversation = await this.ai.get(ctx, session.conversationId);
    const dispatch = await this.db.channelInbound.updateMany({
      where: { id: inbound.id, aiStartedAt: null },
      data: { aiStartedAt: new Date() },
    });
    if (!dispatch.count)
      return "这条请求已经提交过，请在知行方舟查看会话结果，或发送新的问题。";
    let result;
    try {
      result = await this.ai.send(
        ctx,
        conversation.id,
        {
          content,
          version: conversation.version,
          allowAction: /^执行[：:\s]/.test(content),
        },
        inbound.id,
      );
    } catch {
      return "本次回复未完成，请在知行方舟查看会话状态或稍后发送新的问题。";
    }
    const action = result.message.actionId
      ? await this.ai.action(ctx, result.message.actionId)
      : null;
    const receipt =
      action?.status === "completed" && result.actionResult
        ? `\n业务回执：${JSON.stringify(result.actionResult).slice(0, 800)}`
        : "";
    let link = "";
    if (action?.status === "pending") {
      if (process.env.WEB_ORIGIN) {
        const page = new URL(
          `/t/${encodeURIComponent(ctx.tenantKey)}/${ctx.app.appId}/ai`,
          process.env.WEB_ORIGIN,
        );
        page.searchParams.set("conversation", conversation.id);
        page.searchParams.set("action", action.id);
        link = `\n请在平台核对后确认：${page.toString()}`;
      } else link = "\n请登录知行方舟平台，在 AI 助手中核对后确认。";
    }
    return `${result.message.content}${receipt}${link}`.slice(0, 3000);
  }

  async processInbound(provider?: ChannelProvider) {
    const now = new Date();
    const stale = new Date(Date.now() - 120_000);
    const activeConnections = await this.db.channelConnection.findMany({
      where: {
        id: { in: [...this.connected.keys()] },
        status: { notIn: ["disconnected", "expired"] },
        ...(provider ? { provider } : {}),
      },
      select: { id: true },
    });
    const inbound = await this.db.channelInbound.findFirst({
      where: {
        connectionId: { in: activeConnections.map((c) => c.id) },
        OR: [
          { status: { in: ["queued", "retry"] }, nextAttemptAt: { lte: now } },
          { status: "processing", updatedAt: { lt: stale } },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
    if (!inbound) return false;
    const channel = this.connected.get(inbound.connectionId);
    if (!channel) return false;
    const claimed = await this.db.channelInbound.updateMany({
      where: {
        id: inbound.id,
        status: inbound.status,
        updatedAt: inbound.updatedAt,
      },
      data: { status: "processing", attempts: { increment: 1 } },
    });
    if (!claimed.count) return true;
    if (inbound.attempts >= 3 && !inbound.replyText) {
      await this.db.channelInbound.update({
        where: { id: inbound.id },
        data: { status: "failed" },
      });
      return true;
    }
    try {
      const replyText =
        inbound.replyText && !inbound.replyMembershipId
          ? "回复状态已失效，请重新发送问题。"
          : (inbound.replyText ?? (await this.replyFor(inbound)));
      if (!inbound.replyText)
        await this.db.channelInbound.update({
          where: { id: inbound.id },
          data: { replyText },
        });
      const connection = await this.db.channelConnection.findUnique({
        where: { id: inbound.connectionId },
      });
      if (
        !connection ||
        ["disconnected", "expired"].includes(connection.status)
      )
        throw new Error("CHANNEL_DISCONNECTED");
      const saved = await this.db.channelInbound.findUniqueOrThrow({
        where: { id: inbound.id },
      });
      if (saved.replyMembershipId) {
        const identity = await this.db.channelIdentity.findFirst({
          where: {
            connectionId: inbound.connectionId,
            externalUserId: inbound.senderId,
            membershipId: saved.replyMembershipId,
          },
        });
        const member = await this.db.membership.findFirst({
          where: {
            id: saved.replyMembershipId,
            active: true,
            tenant: { active: true },
            user: { active: true },
          },
        });
        if (!identity || !member) throw new Error("CHANNEL_RECIPIENT_REVOKED");
        if (saved.replyAppId) {
          const ctx = await this.auth.taskContext({
            tenantId: member.tenantId,
            membershipId: member.id,
            userId: member.userId,
            appId: saved.replyAppId,
            taskId: inbound.id,
          });
          this.auth.require(ctx, saved.replyAppId + ".ai.use");
        }
      }
      await channel.send(
        inbound.chatId,
        { text: replyText },
        {
          replyTo: inbound.messageId,
          requestKey: inbound.id,
          context: inbound.contextCiphertext
            ? JSON.parse(decryptChannelSecret(inbound.contextCiphertext))
            : undefined,
        },
      );
      await this.db.channelInbound.update({
        where: { id: inbound.id },
        data: { status: "completed" },
      });
    } catch (error) {
      const next =
        error instanceof Error &&
        ["CHANNEL_DISCONNECTED", "CHANNEL_RECIPIENT_REVOKED"].includes(
          error.message,
        )
          ? 3
          : inbound.attempts + 1;
      await this.db.channelInbound.update({
        where: { id: inbound.id },
        data: {
          status: next >= 3 ? "failed" : "retry",
          nextAttemptAt: new Date(
            Date.now() + Math.min(60_000, 5_000 * 2 ** next),
          ),
        },
      });
      process.stderr.write(
        `[channel] inbound failed: ${error instanceof Error ? error.name : "UnknownError"}\n`,
      );
    }
    return true;
  }

  async processDelivery() {
    const item = await this.db.channelDelivery.findFirst({
      where: {
        connectionId: { in: [...this.connected.keys()] },
        OR: [
          {
            status: { in: ["queued", "retry", "awaiting_identity"] },
            nextAttemptAt: { lte: new Date() },
          },
          {
            status: "sending",
            updatedAt: { lt: new Date(Date.now() - 120_000) },
          },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
    if (!item) return false;
    if (item.eventKey.startsWith("workflow:")) {
      const [, id, cycle, cursor, , event] = item.eventKey.split(":");
      if (
        ["entered", "manual", "lead"].includes(event) ||
        event.startsWith("overdue-") ||
        event.startsWith("escalated-")
      ) {
        const flow = await this.db.erpWorkflow.findFirst({
          where: { id, tenantId: item.tenantId },
        });
        const actors = flow
          ? currentActors((flow.steps as FlowStep[])[flow.cursor])
          : [];
        const escalation = flow
          ? (flow.rules as { escalation: string[] }).escalation
          : [];
        if (
          !flow ||
          flow.status !== "active" ||
          flow.cycle !== Number(cycle) ||
          flow.cursor !== Number(cursor) ||
          !(
            event.startsWith("escalated-")
              ? escalation.length
                ? escalation
                : (
                    await this.db.membership.findMany({
                      where: {
                        tenantId: item.tenantId,
                        role: "admin",
                        active: true,
                      },
                      select: { id: true },
                    })
                  ).map((m) => m.id)
              : actors
          ).includes(item.membershipId)
        ) {
          await this.db.channelDelivery.updateMany({
            where: {
              id: item.id,
              status: item.status,
              updatedAt: item.updatedAt,
            },
            data: { status: "cancelled", errorCode: "WORKFLOW_MOVED" },
          });
          return true;
        }
      }
    }
    const channel = this.connected.get(item.connectionId);
    if (!channel) return false;
    const member = await this.db.membership.findFirst({
      where: {
        id: item.membershipId,
        tenantId: item.tenantId,
        active: true,
        user: { active: true },
        tenant: { active: true },
      },
    });
    if (!member) {
      await this.db.channelDelivery.update({
        where: { id: item.id },
        data: { status: "cancelled", errorCode: "RECIPIENT_REVOKED" },
      });
      return true;
    }
    const identity = await this.db.channelIdentity.findUnique({
      where: {
        connectionId_membershipId: {
          connectionId: item.connectionId,
          membershipId: item.membershipId,
        },
      },
    });
    if (!identity) {
      await this.db.channelDelivery.update({
        where: { id: item.id },
        data: {
          status: "awaiting_identity",
          nextAttemptAt: new Date(Date.now() + 60_000),
        },
      });
      return true;
    }
    const claimed = await this.db.channelDelivery.updateMany({
      where: { id: item.id, status: item.status, updatedAt: item.updatedAt },
      data: { status: "sending", attempts: { increment: 1 } },
    });
    if (!claimed.count) return true;
    try {
      const context = await this.db.channelInbound.findFirst({
        where: {
          connectionId: item.connectionId,
          senderId: identity.externalUserId,
          contextCiphertext: { not: null },
        },
        orderBy: { createdAt: "desc" },
      });
      const storedContext = context?.contextCiphertext
        ? JSON.parse(decryptChannelSecret(context.contextCiphertext))
        : undefined;
      // Proactive notices are separate messages, never a replacement of the last WeCom reply stream.
      const deliveryContext = storedContext
        ? {
            contextToken: storedContext.contextToken,
            sessionWebhook: storedContext.sessionWebhook,
            expiresAt: storedContext.expiresAt,
          }
        : undefined;
      const sent = await channel.send(
        identity.externalUserId,
        { text: `${item.title}\n${item.body}` },
        { requestKey: item.id, context: deliveryContext },
      );
      await this.db.channelDelivery.update({
        where: { id: item.id },
        data: {
          status: "sent",
          providerMessageId: sent.messageId,
          sentAt: new Date(),
          errorCode: null,
        },
      });
    } catch (error) {
      const next = item.attempts + 1;
      await this.db.channelDelivery.update({
        where: { id: item.id },
        data: {
          status: next >= 3 ? "failed" : "retry",
          errorCode:
            error instanceof Error ? error.name.slice(0, 80) : "SEND_FAILED",
          nextAttemptAt: new Date(Date.now() + 5_000 * 2 ** next),
        },
      });
    }
    return true;
  }

  async close() {
    await Promise.all(
      [...this.connected.values()].map((channel) =>
        channel.disconnect().catch(() => undefined),
      ),
    );
    this.connected.clear();
  }
}
