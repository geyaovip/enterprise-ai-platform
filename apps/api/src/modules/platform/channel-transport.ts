import * as lark from "@larksuiteoapi/node-sdk";
import {
  WSClient,
  type WsFrame,
  type TextMessage,
} from "@wecom/aibot-node-sdk";
import { DWClient, TOPIC_ROBOT } from "dingtalk-stream";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  channelJson,
  officialUrl,
  weixinHeaders,
  weixinBase,
  type ChannelProvider,
} from "./channel-registration";

export type ChannelMessage = {
  messageId: string;
  senderId: string;
  chatId: string;
  content: string;
  context?: Record<string, unknown>;
};
export type SendOptions = {
  replyTo?: string;
  context?: Record<string, any>;
  requestKey?: string;
};
export interface ChatTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(
    target: string,
    payload: { text: string },
    options?: SendOptions,
  ): Promise<{ messageId?: string }>;
}
type Options = {
  provider: ChannelProvider;
  appId: string;
  secret: string;
  cursor?: string | null;
  receive: (message: ChannelMessage) => Promise<void>;
  persistCursor: (cursor: string) => Promise<void>;
  state: (status: string) => Promise<void>;
};
export function createChatTransport(o: Options): ChatTransport {
  const update = (status: string) => {
    void o.state(status).catch(() => {});
  };
  if (o.provider === "feishu") {
    const client = lark.createLarkChannel({
      appId: o.appId,
      appSecret: o.secret,
      transport: "websocket",
      handshakeTimeoutMs: 15000,
      policy: { dmMode: "open", requireMention: true },
      source: "zhixingfangzhou",
    });
    client.on("message", async (message) => {
      if (
        message.chatType !== "p2p" ||
        !message.content.trim() ||
        message.rawContentType !== "text"
      )
        return;
      try {
        await o.receive({
          messageId: message.messageId,
          senderId: message.senderId,
          chatId: message.chatId,
          content: message.content,
        });
      } catch {
        update("error");
      }
    });
    client.on("reconnecting", () => update("reconnecting"));
    client.on("reconnected", () => update("connected"));
    return {
      connect: () => client.connect(),
      disconnect: () => client.disconnect(),
      send: async (target, payload, options) =>
        client.send(target, payload, { replyTo: options?.replyTo }),
    };
  }
  if (o.provider === "wecom") {
    const client = new WSClient({
      botId: o.appId,
      secret: o.secret,
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
    client.on("message.text", async (frame: WsFrame<TextMessage>) => {
      const b = frame.body;
      if (
        !b ||
        b.chattype !== "single" ||
        !b.text?.content ||
        !b.from?.userid ||
        !b.msgid
      )
        return;
      try {
        await o.receive({
          messageId: b.msgid,
          senderId: b.from.userid,
          chatId: b.from.userid,
          content: b.text.content,
          context: { headers: frame.headers },
        });
      } catch {
        update("error");
      }
    });
    client.on("authenticated", () => update("connected"));
    client.on("reconnecting", () => update("reconnecting"));
    client.on("disconnected", () => update("reconnecting"));
    client.on("error", () => update("error"));
    return {
      connect: () =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            cleanup();
            reject(new Error("CHANNEL_CONNECT_TIMEOUT"));
          }, 15000);
          const done = () => {
            cleanup();
            resolve();
          };
          const failed = () => {
            cleanup();
            reject(new Error("CHANNEL_AUTH_FAILED"));
          };
          const cleanup = () => {
            clearTimeout(timer);
            client.off("authenticated", done);
            client.off("error", failed);
          };
          client.once("authenticated", done);
          client.once("error", failed);
          client.connect();
        }),
      disconnect: async () => {
        client.disconnect();
      },
      send: async (target, payload, options) => {
        const result = options?.context?.headers
          ? await client.replyStream(
              { headers: options.context.headers },
              options.requestKey ?? randomUUID(),
              payload.text,
              true,
            )
          : await client.sendMessage(target, {
              msgtype: "markdown",
              markdown: { content: payload.text },
            });
        if (result.errcode) throw new Error("CHANNEL_SEND_REJECTED");
        return {
          messageId:
            String(
              (result.body as any)?.msgid ?? result.headers?.req_id ?? "",
            ) || undefined,
        };
      },
    };
  }
  if (o.provider === "dingtalk") {
    const client = new DWClient({
      clientId: o.appId,
      clientSecret: o.secret,
      debug: false,
      keepAlive: true,
    });
    client.registerCallbackListener(TOPIC_ROBOT, async (frame) => {
      try {
        const data = JSON.parse(frame.data);
        if (
          data.conversationType === "1" &&
          data.msgtype === "text" &&
          data.senderStaffId &&
          data.text?.content
        ) {
          await o.receive({
            messageId: data.msgId || frame.headers.messageId,
            senderId: data.senderStaffId,
            chatId: data.senderStaffId,
            content: data.text.content,
            context: {
              sessionWebhook: data.sessionWebhook,
              expiresAt: data.sessionWebhookExpiredTime,
            },
          });
        }
        client.socketCallBackResponse(frame.headers.messageId, {
          success: true,
        });
      } catch {
        update("error");
      }
    });
    let monitor: ReturnType<typeof setInterval> | undefined;
    client.on("error", () => update("error"));
    return {
      connect: async () => {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            client.connect(),
            new Promise<never>((_, reject) => {
              timeout = setTimeout(
                () => reject(new Error("CHANNEL_CONNECT_TIMEOUT")),
                20000,
              );
            }),
          ]);
          if (!client.connected) throw new Error("CHANNEL_CONNECT_FAILED");
          monitor = setInterval(
            () => update(client.connected ? "connected" : "reconnecting"),
            5000,
          );
        } finally {
          clearTimeout(timeout);
        }
      },
      disconnect: async () => {
        clearInterval(monitor);
        client.disconnect();
      },
      send: async (target, payload, options) => {
        const hook = options?.context?.sessionWebhook;
        if (hook && Number(options.context?.expiresAt) > Date.now()) {
          const result = await channelJson(officialUrl(hook, "dingtalk"), {
            msgtype: "text",
            text: { content: payload.text },
          });
          return {
            messageId: result.messageId ? String(result.messageId) : undefined,
          };
        }
        const auth = await channelJson(
          "https://api.dingtalk.com/v1.0/oauth2/accessToken",
          { appKey: o.appId, appSecret: o.secret },
        );
        if (!auth.accessToken) throw new Error("CHANNEL_AUTH_FAILED");
        const sent = await channelJson(
          "https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend",
          {
            robotCode: o.appId,
            userIds: [target],
            msgKey: "sampleText",
            msgParam: JSON.stringify({ content: payload.text }),
          },
          { "x-acs-dingtalk-access-token": auth.accessToken },
        );
        if (
          sent.invalidStaffIdList?.length ||
          sent.flowControlledStaffIdList?.length
        )
          throw new Error("CHANNEL_RECIPIENT_REJECTED");
        return { messageId: sent.processQueryKey };
      },
    };
  }
  const credentials = JSON.parse(o.secret) as {
    token: string;
    baseUrl: string;
  };
  const base = officialUrl(credentials.baseUrl, "weixin");
  let cursor = o.cursor ?? "";
  const controller = new AbortController();
  let polling: Promise<void> | undefined;
  const request = (
    path: string,
    body: Record<string, unknown>,
    timeout = 15000,
  ) =>
    channelJson(
      new URL(path, base).toString(),
      { ...body, base_info: weixinBase },
      { ...weixinHeaders(), Authorization: "Bearer " + credentials.token },
      timeout,
      controller.signal,
    );
  const monitor = async () => {
    while (!controller.signal.aborted) {
      try {
        const data = await request(
          "/ilink/bot/getupdates",
          { get_updates_buf: cursor },
          40000,
        );
        for (const message of data.msgs ?? []) {
          if (
            message.message_type !== 1 ||
            !message.message_id ||
            !message.from_user_id
          )
            continue;
          const content = (message.item_list ?? [])
            .filter((item: any) => item.type === 1)
            .map((item: any) => item.text_item?.text ?? "")
            .join("\n");
          if (content.trim())
            await o.receive({
              messageId: message.message_id,
              senderId: message.from_user_id,
              chatId: message.from_user_id,
              content,
              context: { contextToken: message.context_token },
            });
        }
        if (data.get_updates_buf) {
          await o.persistCursor(data.get_updates_buf);
          cursor = data.get_updates_buf;
        }
        await o.state("connected");
        if (!data.msgs?.length)
          await delay(300, undefined, { signal: controller.signal });
      } catch (error) {
        if (controller.signal.aborted) break;
        if (
          error instanceof Error &&
          error.message === "CHANNEL_SESSION_EXPIRED"
        ) {
          await o.state("expired");
          break;
        }
        await o.state("reconnecting").catch(() => {});
        await delay(5000, undefined, { signal: controller.signal }).catch(
          () => {},
        );
      }
    }
  };
  return {
    connect: async () => {
      polling = monitor().catch(() => update("error"));
    },
    disconnect: async () => {
      controller.abort();
      await polling;
    },
    send: async (target, payload, options) => {
      if (!options?.context?.contextToken)
        throw new Error("CHANNEL_CONTEXT_REQUIRED");
      const id = options.requestKey ?? randomUUID();
      await request("/ilink/bot/sendmessage", {
        msg: {
          from_user_id: "",
          to_user_id: target,
          client_id: id,
          message_type: 2,
          message_state: 2,
          context_token: options.context.contextToken,
          item_list: [{ type: 1, text_item: { text: payload.text } }],
        },
      });
      return { messageId: id };
    },
  };
}
