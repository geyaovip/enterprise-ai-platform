const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
if (
  process.env.NODE_ENV !== "test" ||
  !/@127\.0\.0\.1:54329\/suite_phase1_qa$/.test(process.env.DATABASE_URL || "")
)
  throw Error("Dedicated isolated QA database required");
process.env.CHANNEL_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString("base64");
process.env.MES_AI_RELEASE_ENABLED = "true";
process.env.WEB_ORIGIN = "http://127.0.0.1:4601";
const { createApp } = require("../dist/server");
const { PrismaService } = require("../dist/modules/prisma.service");
const { AuthService } = require("../dist/modules/platform/auth.service");
const { ChannelService } = require("../dist/modules/platform/channel.service");
const { ChannelRuntime } = require("../dist/modules/platform/channel.runtime");
const {
  decryptChannelSecret,
  encryptChannelSecret,
} = require("../dist/modules/platform/channel-secret");
const {
  officialUrl,
} = require("../dist/modules/platform/channel-registration");
const {
  createFixture,
  cleanupFixture,
} = require("../scripts/workflow-fixture.cjs");
const lark = require("@larksuiteoapi/node-sdk");
const originalFetch = global.fetch;
const originalRegister = lark.registerApp;
const events = [];
let scan = false;
let verify = false;
let serial = randomUUID().slice(0, 8) + "-0";
let app;
const fixtures = [];
function json(body) {
  return new Response(JSON.stringify(body), { status: 200 });
}
global.fetch = async (raw, options = {}) => {
  const url = new URL(raw);
  events.push({
    path: url.pathname,
    method: options.method,
    body: options.body,
  });
  if (url.hostname === "ilinkai.weixin.qq.com") {
    if (url.pathname.endsWith("get_bot_qrcode"))
      return json({
        qrcode: "wx-code-" + serial,
        qrcode_img_content: "https://liteapp.weixin.qq.com/q/qa",
      });
    if (url.pathname.endsWith("get_qrcode_status")) {
      if (verify && !url.searchParams.has("verify_code"))
        return json({ status: "need_verifycode" });
      return json(
        scan
          ? {
              status: "confirmed",
              bot_token: "qa-bot-secret",
              ilink_bot_id: "wx-bot-" + serial,
              ilink_user_id: "wx-owner-" + serial,
              baseurl: "https://ilinkai.weixin.qq.com",
            }
          : { status: "wait" },
      );
    }
  }
  if (url.hostname === "work.weixin.qq.com") {
    if (url.pathname.endsWith("/generate"))
      return json({
        data: {
          scode: "wecom-code-" + serial,
          auth_url: "https://work.weixin.qq.com/ai/qc/gen?scode=qa",
        },
      });
    if (url.pathname.endsWith("/query_result"))
      return json({
        data: scan
          ? {
              status: "success",
              bot_info: {
                botid: "wecom-bot-" + serial,
                secret: "qa-wecom-secret",
              },
            }
          : { status: "wait" },
      });
  }
  if (url.hostname === "oapi.dingtalk.com") {
    if (url.pathname.endsWith("/init"))
      return json({ errcode: 0, nonce: "qa-nonce" });
    if (url.pathname.endsWith("/begin"))
      return json({
        errcode: 0,
        device_code: "ding-code-" + serial,
        verification_uri_complete: "https://login.dingtalk.com/qr/qa",
        expires_in: 300,
        interval: 3,
      });
    if (url.pathname.endsWith("/poll"))
      return json({
        errcode: 0,
        status: scan ? "SUCCESS" : "WAITING",
        client_id: scan ? "ding-bot-" + serial : undefined,
        client_secret: scan ? "qa-ding-secret" : undefined,
      });
  }
  throw Error(
    "Unexpected network request blocked: " + url.origin + url.pathname,
  );
};
lark.registerApp = async (options) => {
  await options.onQRCodeReady({
    url: "https://accounts.feishu.cn/qr/qa",
    expireIn: 300,
  });
  return { client_id: "lark-bot-" + serial, client_secret: "qa-feishu-secret" };
};
(async () => {
  let checks = 0;
  const eq = (a, b) => {
    assert.deepEqual(a, b);
    checks++;
  };
  const ok = (value) => {
    assert.ok(value);
    checks++;
  };
  const rejects = async (fn, pattern) => {
    await assert.rejects(fn, pattern);
    checks++;
  };
  try {
    app = await createApp();
    const db = app.get(PrismaService),
      auth = app.get(AuthService),
      service = app.get(ChannelService);
    const fixture = await createFixture(
      db,
      "erp-flow-test-official-" + randomUUID().slice(0, 8),
    );
    const other = await createFixture(
      db,
      "erp-flow-test-official-other-" + randomUUID().slice(0, 8),
    );
    for (const id of ["crm", "mes", "content"])
      await db.tenantApp.create({
        data: {
          tenantId: fixture.tenant.id,
          appId: id,
          granted: true,
          enabled: true,
        },
      });
    for (const capability of ["ai", "knowledge"])
      await db.tenantCapability.create({
        data: {
          tenantId: fixture.tenant.id,
          capability,
          delivered: true,
          enabled: true,
        },
      });
    fixtures.push(fixture, other);
    const context = async (f) =>
      auth.taskContext({
        tenantId: f.tenant.id,
        userId: f.accounts.admin.userId,
        membershipId: f.accounts.admin.memberId,
        appId: "erp",
        taskId: randomUUID(),
      });
    const admin = await context(fixture),
      otherAdmin = await context(other);
    const member = await auth.taskContext({
      tenantId: fixture.tenant.id,
      userId: fixture.accounts.sales.userId,
      membershipId: fixture.accounts.sales.memberId,
      appId: "erp",
      taskId: randomUUID(),
    });
    eq(
      (await service.list(admin)).map((c) => c.provider),
      ["feishu", "weixin", "wecom", "dingtalk"],
    );
    for (const provider of ["feishu", "weixin", "wecom", "dingtalk"])
      await rejects(() => service.start(member, provider), /权限|Forbidden/);
    await rejects(() => service.start(admin, "unknown"), /不支持/);
    for (const raw of [
      "http://work.weixin.qq.com/x",
      "https://work.weixin.qq.com.evil.example/x",
      "https://127.0.0.1/x",
      "https://user:pass@work.weixin.qq.com/x",
    ]) {
      assert.throws(() => officialUrl(raw, "wecom"));
      checks++;
    }
    const channels = {};
    for (const provider of ["feishu", "weixin", "wecom", "dingtalk"]) {
      serial = randomUUID().slice(0, 8);
      scan = false;
      const before = events.length;
      const setup = await service.start(admin, provider);
      for (let i = 0; i < 20; i++) {
        const state = await db.channelConnectAttempt.findUnique({
          where: { id: setup.id },
        });
        if (
          provider === "feishu"
            ? state.status === "configured" || state.status === "failed"
            : state.status !== "starting"
        )
          break;
        await new Promise((r) => setTimeout(r, 10));
      }
      await rejects(
        () => service.attempt(otherAdmin, setup.id, provider),
        /不存在/,
      );
      const shown = await service.attempt(admin, setup.id, provider);
      ok(!JSON.stringify(shown).includes("qa-bot-secret"));
      if (provider !== "feishu") {
        const repeated = await Promise.all([
          service.start(admin, provider),
          service.start(admin, provider),
        ]);
        eq(
          repeated.map((x) => x.id),
          [setup.id, setup.id],
        );
        const expectedPosts = provider === "dingtalk" ? 2 : 1;
        eq(
          events
            .slice(before)
            .filter(
              (e) =>
                e.path.endsWith("get_bot_qrcode") ||
                e.path.endsWith("/generate") ||
                e.path.endsWith("/init") ||
                e.path.endsWith("/begin"),
            ).length,
          expectedPosts,
        );
        scan = true;
        await db.channelConnectAttempt.update({
          where: { id: setup.id },
          data: { pollAfter: null },
        });
        await service.attempt(admin, setup.id, provider);
      }
      const connection = await db.channelConnection.findUnique({
        where: { tenantId_provider: { tenantId: admin.tenantId, provider } },
      });
      assert.ok(
        connection,
        provider +
          " connection missing: " +
          JSON.stringify(await service.attempt(admin, setup.id, provider)),
      );
      checks++;
      ok(!connection.secretCiphertext.includes("qa-"));
      ok(decryptChannelSecret(connection.secretCiphertext).includes("secret"));
      const persisted = await db.channelConnectAttempt.findUnique({
        where: { id: setup.id },
      });
      eq(
        [persisted.status, persisted.qrUrl, persisted.stateCiphertext],
        ["configured", null, null],
      );
      await db.channelConnection.update({
        where: { id: connection.id },
        data: { status: "connected" },
      });
      channels[provider] = connection;
      if (provider === "weixin")
        eq((await service.myIdentity(admin, provider)).connected, true);
      await rejects(() => service.start(admin, provider), /已配置/);
    }
    eq(
      (await service.availableApps(admin)).map((a) => a.id),
      ["erp", "crm", "mes", "content"],
    );
    const sent = [],
      calls = [];
    const fakeAi = {
      create: async (ctx) => {
        calls.push(["create", ctx.app.appId]);
        return { id: randomUUID() };
      },
      get: async () => ({ version: 1 }),
      send: async (ctx, id, body, key) => {
        calls.push(["send", ctx.app.appId, body.allowAction, key]);
        return { message: { content: "已处理" } };
      },
    };
    const runtime = new ChannelRuntime(db, auth, fakeAi);
    for (const connection of Object.values(channels))
      runtime.connected.set(connection.id, {
        send: async (target, payload, options) => {
          sent.push({ target, payload, options });
          return { messageId: "reply-" + sent.length };
        },
        disconnect: async () => {},
      });
    const incoming = async (connection, sender, content, extra = {}) => {
      const message = await db.channelInbound.create({
        data: {
          connectionId: connection.id,
          messageId: randomUUID(),
          senderId: sender,
          chatId: sender,
          chatType: "p2p",
          content,
          ...extra,
        },
      });
      // Process only this suite's newest queued message, keeping old QA jobs untouched.
      const original = db.channelInbound.findFirst.bind(db.channelInbound);
      db.channelInbound.findFirst = (args) =>
        original({ ...args, where: { ...args.where, id: message.id } });
      try {
        eq(await runtime.processInbound(), true);
      } finally {
        db.channelInbound.findFirst = original;
      }
      return db.channelInbound.findUnique({ where: { id: message.id } });
    };
    for (const provider of ["feishu", "wecom", "dingtalk"]) {
      const pair = await service.pairCode(admin, provider);
      eq(
        (
          await incoming(
            channels[provider],
            provider + "-owner",
            "绑定 " + pair.code,
          )
        ).status,
        "completed",
      );
      eq((await service.myIdentity(admin, provider)).connected, true);
      eq(
        (
          await incoming(
            channels[provider],
            provider + "-intruder",
            "绑定 " + pair.code,
          )
        ).status,
        "completed",
      );
      eq(
        await db.channelIdentity.count({
          where: {
            connectionId: channels[provider].id,
            externalUserId: provider + "-intruder",
          },
        }),
        0,
      );
    }
    const d = channels.dingtalk;
    for (const appId of ["erp", "crm", "mes", "content"]) {
      await service.setApp(admin, "dingtalk", appId);
      eq(
        (await incoming(d, "dingtalk-owner", "查询当前业务")).status,
        "completed",
      );
      eq(calls.at(-1)[1], appId);
    }
    eq(
      await db.channelChatSession.count({
        where: { connectionId: d.id, membershipId: admin.membershipId },
      }),
      4,
    );
    await incoming(d, "dingtalk-owner", "切换 CRM");
    eq((await service.myIdentity(admin, "dingtalk")).appId, "crm");
    await incoming(d, "dingtalk-owner", "执行：创建任务");
    eq(calls.at(-1)[2], true);
    const beforeUnbound = calls.length;
    await incoming(d, "unknown", "查询客户");
    eq(calls.length, beforeUnbound);
    const job = await service.testDelivery(admin, "dingtalk");
    const pick = db.channelDelivery.findFirst.bind(db.channelDelivery);
    db.channelDelivery.findFirst = (args) =>
      pick({ ...args, where: { ...args.where, id: job.id } });
    try {
      eq(await runtime.processDelivery(), true);
    } finally {
      db.channelDelivery.findFirst = pick;
    }
    eq((await service.delivery(admin, job.id)).status, "sent");
    await rejects(() => service.delivery(otherAdmin, job.id), /不存在/);
    await service.unlink(admin, "dingtalk");
    eq((await service.myIdentity(admin, "dingtalk")).connected, false);
    await incoming(d, "dingtalk-owner", "查客户");
    eq(calls.length, beforeUnbound);
    const sentBeforeRevocation = sent.length;
    const aiBeforeRevocation = calls.length;
    const revokedReply = await incoming(d, "dingtalk-owner", "查客户", {
      replyText: "private cached answer",
      replyMembershipId: admin.membershipId,
      replyAppId: "crm",
    });
    eq(revokedReply.status, "failed");
    eq(sent.length, sentBeforeRevocation);
    eq(calls.length, aiBeforeRevocation);
    const wecomNotice = await service.testDelivery(admin, "wecom");
    await db.channelInbound.create({
      data: {
        connectionId: channels.wecom.id,
        messageId: randomUUID(),
        senderId: "wecom-owner",
        chatId: "wecom-owner",
        chatType: "p2p",
        content: "old inbound",
        status: "completed",
        contextCiphertext: encryptChannelSecret(
          JSON.stringify({ headers: { req_id: "old-stream" } }),
        ),
      },
    });
    db.channelDelivery.findFirst = (args) =>
      pick({ ...args, where: { ...args.where, id: wecomNotice.id } });
    try {
      eq(await runtime.processDelivery(), true);
    } finally {
      db.channelDelivery.findFirst = pick;
    }
    eq((await service.delivery(admin, wecomNotice.id)).status, "sent");
    eq(sent.at(-1).options.context.headers, undefined);
    await service.disconnect(admin, "wecom");
    eq(
      (
        await db.channelConnection.findUnique({
          where: { id: channels.wecom.id },
        })
      ).secretCiphertext,
      "",
    );
    eq((await service.myIdentity(admin, "wecom")).connected, false);
    await rejects(() => service.disconnect(member, "wecom"), /权限|Forbidden/);
    serial = randomUUID().slice(0, 8);
    scan = false;
    const cancelled = await service.start(admin, "wecom");
    await new Promise((r) => setTimeout(r, 30));
    await service.cancelAttempt(admin, "wecom", cancelled.id);
    scan = true;
    await service.pollAttempt(cancelled.id, "wecom", admin.tenantId);
    eq(
      (
        await db.channelConnectAttempt.findUnique({
          where: { id: cancelled.id },
        })
      ).status,
      "cancelled",
    );
    eq(
      (
        await db.channelConnection.findUnique({
          where: { id: channels.wecom.id },
        })
      ).status,
      "disconnected",
    );
    serial = randomUUID().slice(0, 8);
    scan = false;
    const expires = await service.start(admin, "wecom");
    await new Promise((r) => setTimeout(r, 30));
    await db.channelConnectAttempt.update({
      where: { id: expires.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    eq((await service.attempt(admin, expires.id, "wecom")).status, "expired");
    await service.disconnect(admin, "weixin");
    serial = randomUUID().slice(0, 8);
    verify = true;
    scan = true;
    const challenge = await service.start(admin, "weixin");
    await new Promise((r) => setTimeout(r, 30));
    eq(
      (await service.attempt(admin, challenge.id, "weixin")).status,
      "need_verifycode",
    );
    eq(
      (
        await service.verifyAttempt(admin, "weixin", challenge.id, {
          code: "123456",
        })
      ).status,
      "configured",
    );
    ok(!JSON.stringify(await service.list(admin)).includes("secret"));
    // Exercise the actual HTTP controller and authenticated request boundary.
    await app.listen(0, "127.0.0.1");
    const {
      newSessionToken,
      tokenHash,
    } = require("../dist/modules/platform/security");
    const cookies = {};
    for (const [name, account] of Object.entries({
      admin: fixture.accounts.admin,
      member: fixture.accounts.sales,
      outsider: other.accounts.admin,
    })) {
      const token = newSessionToken();
      await db.session.create({
        data: {
          userId: account.userId,
          tokenHash: tokenHash(token),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      cookies[name] = "suite_session=" + token;
    }
    const httpBase = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1/tenants/${fixture.tenant.slug}/channels`;
    const http = async (
      suffix,
      method = "GET",
      body,
      who = "admin",
      expected = method === "POST" ? 201 : 200,
    ) => {
      const response = await originalFetch(httpBase + suffix, {
        method,
        headers: {
          Origin: process.env.WEB_ORIGIN,
          "Content-Type": "application/json",
          ...(cookies[who] ? { Cookie: cookies[who] } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      eq(response.status, expected);
      return response.json();
    };
    eq((await http("")).length, 4);
    await http("", "GET", undefined, "anonymous", 401);
    await http("", "GET", undefined, "outsider", 403);
    for (const provider of ["feishu", "weixin", "wecom", "dingtalk"]) {
      ok(typeof (await http(`/${provider}/me`)).connected === "boolean");
      await http(`/${provider}/connect`, "POST", {}, "member", 403);
      await http(
        `/${provider}/assistant`,
        "POST",
        { appId: "unauthorized" },
        "admin",
        400,
      );
    }
    await http("/unsupported/me", "GET", undefined, "admin", 400);
    await http(`/deliveries/${job.id}`, "GET", undefined, "member", 404);
    await http(
      `/wecom/attempts/${cancelled.id}/verify`,
      "POST",
      { code: "123456", secret: "not-allowed" },
      "admin",
      400,
    );
    console.log(
      JSON.stringify({
        checks,
        providers: 4,
        assistantRoutes: 4,
        realProviderCalls: 0,
        paidModelCalls: 0,
        credentialsEncrypted: true,
        qrCancellation: true,
        tenantIsolation: true,
      }),
    );
  } finally {
    global.fetch = originalFetch;
    lark.registerApp = originalRegister;
    if (app) {
      const db = app.get(PrismaService);
      for (const fixture of fixtures) await cleanupFixture(db, fixture);
    }
    await app?.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
