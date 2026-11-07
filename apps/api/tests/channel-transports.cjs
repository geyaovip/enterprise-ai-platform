const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");
if (process.env.NODE_ENV !== "test")
  throw Error("Isolated transport test only");
const clients = [];
const sent = [];
class Socket extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    clients.push(this);
  }
  connect() {
    this.connected = true;
    queueMicrotask(() => this.emit("authenticated"));
    return Promise.resolve();
  }
  disconnect() {
    this.connected = false;
  }
  registerCallbackListener(topic, fn) {
    this.callback = fn;
  }
  socketCallBackResponse(id, body) {
    this.ack = id;
  }
  async send(target, body) {
    sent.push({ target, body });
    return { messageId: "lark-id" };
  }
  async replyStream(frame, id, content, done) {
    sent.push({ frame, id, content, done });
    return { headers: { req_id: "wecom-id" } };
  }
  async sendMessage(target, body) {
    sent.push({ target, body });
    return { headers: { req_id: "wecom-active" } };
  }
}
const originalLoad = Module._load;
Module._load = function (name, ...args) {
  if (name === "@wecom/aibot-node-sdk") return { WSClient: Socket };
  if (name === "dingtalk-stream")
    return { DWClient: Socket, TOPIC_ROBOT: "robot" };
  if (name === "@larksuiteoapi/node-sdk")
    return { createLarkChannel: (options) => new Socket(options) };
  return originalLoad.call(this, name, ...args);
};
const {
  createChatTransport,
} = require("../dist/modules/platform/channel-transport");
Module._load = originalLoad;
const originalFetch = global.fetch;
let checks = 0;
const eq = (a, b) => {
  assert.deepEqual(a, b);
  checks++;
};
(async () => {
  let wx;
  try {
    for (const provider of ["feishu", "wecom", "dingtalk"]) {
      const messages = [];
      const transport = createChatTransport({
        provider,
        appId: "bot",
        secret: "secret",
        receive: async (m) => {
          messages.push(m);
        },
        persistCursor: async () => {},
        state: async () => {},
      });
      await transport.connect();
      const client = clients.at(-1);
      if (provider === "feishu") {
        client.emit("message", {
          chatType: "group",
          rawContentType: "text",
          content: "skip",
        });
        client.emit("message", {
          chatType: "p2p",
          rawContentType: "text",
          content: "你好",
          messageId: "m1",
          senderId: "u1",
          chatId: "c1",
        });
        await transport.send("c1", { text: "你好" });
      } else if (provider === "wecom") {
        client.emit("message.text", {
          headers: { req_id: "req1" },
          body: {
            msgid: "m1",
            chattype: "group",
            from: { userid: "u1" },
            text: { content: "skip" },
          },
        });
        client.emit("message.text", {
          headers: { req_id: "req1" },
          body: {
            msgid: "m1",
            chattype: "single",
            from: { userid: "u1" },
            text: { content: "你好" },
          },
        });
        await transport.send(
          "u1",
          { text: "你好" },
          { context: { headers: { req_id: "req1" } }, requestKey: "fixed-id" },
        );
        eq(sent.at(-1).id, "fixed-id");
        eq(sent.at(-1).done, true);
        await transport.send("u1", { text: "通知" });
        eq(sent.at(-1).target, "u1");
      } else {
        await client.callback({
          headers: { messageId: "m1" },
          data: JSON.stringify({
            msgId: "m1",
            senderStaffId: "u1",
            conversationType: "1",
            msgtype: "text",
            text: { content: "你好" },
            sessionWebhook: "https://oapi.dingtalk.com/robot/send?session=qa",
            sessionWebhookExpiredTime: Date.now() + 60000,
          }),
        });
        eq(client.ack, "m1");
        let bodies = [];
        global.fetch = async (url, options) => {
          bodies.push([url, JSON.parse(options.body)]);
          return new Response("{}");
        };
        await transport.send(
          "u1",
          { text: "回复" },
          { context: messages[0].context },
        );
        eq(bodies[0][1].text.content, "回复");
        const old = client.ack;
        client.ack = null;
        const fail = createChatTransport({
          provider,
          appId: "bot",
          secret: "secret",
          receive: async () => {
            throw Error("DB unavailable");
          },
          persistCursor: async () => {},
          state: async () => {},
        });
        await fail.connect();
        const failClient = clients.at(-1);
        await failClient.callback({
          headers: { messageId: "must-retry" },
          data: JSON.stringify({
            msgId: "must-retry",
            senderStaffId: "u1",
            conversationType: "1",
            msgtype: "text",
            text: { content: "你好" },
          }),
        });
        eq(failClient.ack, undefined);
        await fail.disconnect();
      }
      eq(messages.length, 1);
      eq(messages[0].content, "你好");
      eq(messages[0].senderId, "u1");
      await transport.disconnect();
      eq(client.connected, false);
    }
    let polled = 0;
    let request;
    global.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      if (url.endsWith("getupdates")) {
        polled++;
        if (polled === 1)
          return new Response(
            JSON.stringify({
              ret: 0,
              msgs: [
                {
                  message_id: "wx1",
                  message_type: 1,
                  from_user_id: "wx-user",
                  context_token: "qa-context",
                  item_list: [{ type: 1, text_item: { text: "微信问题" } }],
                },
              ],
              get_updates_buf: "cursor-1",
            }),
          );
        return new Promise((resolve, reject) =>
          options.signal.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          ),
        );
      }
      request = { url, body, headers: options.headers };
      return new Response('{"ret":0}');
    };
    const received = [],
      cursors = [];
    wx = createChatTransport({
      provider: "weixin",
      appId: "wx",
      secret: JSON.stringify({
        token: "qa-token",
        baseUrl: "https://ilinkai.weixin.qq.com",
      }),
      receive: async (m) => received.push(m),
      persistCursor: async (c) => cursors.push(c),
      state: async () => {},
    });
    await wx.connect();
    for (let i = 0; i < 30 && cursors.length === 0; i++)
      await new Promise((r) => setTimeout(r, 2));
    eq(cursors, ["cursor-1"]);
    eq(received[0].content, "微信问题");
    await wx.send(
      "wx-user",
      { text: "微信答复" },
      { context: received[0].context, requestKey: "dedupe-1" },
    );
    eq(request.body.msg.context_token, "qa-context");
    eq(request.body.msg.client_id, "dedupe-1");
    eq(request.body.msg.to_user_id, "wx-user");
    await assert.rejects(
      () => wx.send("wx-user", { text: "missing context" }),
      /CONTEXT_REQUIRED/,
    );
    checks++;
    await wx.disconnect();
    console.log(
      JSON.stringify({
        checks,
        providers: 4,
        realProviderCalls: 0,
        ackAfterPersist: true,
        weixinCursor: true,
        replyContext: true,
      }),
    );
  } finally {
    global.fetch = originalFetch;
    await wx?.disconnect();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
