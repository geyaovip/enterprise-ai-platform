const assert = require("node:assert/strict"),
  http = require("node:http"),
  { randomUUID } = require("node:crypto");
const { createApp } = require("../dist/server"),
  { PrismaService } = require("../dist/modules/prisma.service"),
  { AuthService } = require("../dist/modules/platform/auth.service"),
  { AiService } = require("../dist/modules/ai/ai.service"),
  { MesService } = require("../dist/modules/mes/mes.service"),
  { MesAiProvider } = require("../dist/modules/mes/mes-ai.provider"),
  {
    infrastructureSecret,
  } = require("../dist/modules/platform/infrastructure-contract"),
  {
    createFixture,
    cleanupFixture,
  } = require("../scripts/workflow-fixture.cjs");
(async () => {
  assert.match(
    process.env.DATABASE_URL ?? "",
    /@127\.0\.0\.1:54329\/suite_phase1_qa/,
  );
  const db = new PrismaService();
  let app,
    f,
    server,
    checks = 0,
    calls = 0,
    handler,
    after;
  const inputs = [];
  const ok = (x) => {
      assert.ok(x);
      checks++;
    },
    eq = (a, b) => {
      assert.deepEqual(a, b);
      checks++;
    };
  try {
    server = http.createServer(async (req, res) => {
      try {
        let raw = "";
        for await (const v of req) raw += v;
        const body = JSON.parse(raw);
        inputs.push({ body, agent: req.headers["x-openclaw-agent-id"] });
        calls++;
        const output = handler
          ? handler(body)
          : [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: "根据当前授权事实分析，请核对实际生产情况。",
                  },
                ],
              },
            ];
        if (after) {
          const fn = after;
          after = null;
          await fn();
        }
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            id: randomUUID(),
            model: "mes-local-fixture",
            status: "completed",
            usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
            output,
          }),
        );
      } catch (e) {
        res.statusCode = 500;
        res.end("{}");
      }
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    app = await createApp();
    await app.init();
    f = await createFixture(
      db,
      "erp-flow-test-mes-ai-" + randomUUID().slice(0, 8),
    );
    await db.tenantApp.create({
      data: { tenantId: f.tenant.id, appId: "mes" },
    });
    await db.tenantCapability.create({
      data: {
        tenantId: f.tenant.id,
        capability: "ai",
        enabled: true,
        delivered: true,
      },
    });
    const auth = app.get(AuthService),
      ai = app.get(AiService),
      mes = app.get(MesService),
      provider = app.get(MesAiProvider);
    const context = (key) =>
      auth.taskContext({
        tenantId: f.tenant.id,
        membershipId: f.accounts[key].memberId,
        userId: f.accounts[key].userId,
        appId: "mes",
        taskId: randomUUID(),
      });
    ok(provider.selectTools("基于已发布BOM创建生产计划草稿").includes("mes.preview_plan"));
    ok(provider.selectTools("基于已发布BOM创建生产计划草稿").includes("mes.create_plan_draft"));
    let ctx = await context("admin");
    await db.infrastructureBinding.create({
      data: {
        tenantId: f.tenant.id,
        kind: "runtime",
        scopeKey: ctx.membershipId,
        provider: "openclaw",
        baseUrl: "http://127.0.0.1:" + server.address().port,
        secretCiphertext: infrastructureSecret("mes-local-only"),
        options: {
          agentId: "erp-assistant",
          fastAgentId: "erp-assistant-fast",
          readAgentId: "erp-assistant-read",
          ephemeralTurns: true,
        },
      },
    });
    const material = async (sku, kind) =>
        mes.saveMaterial(ctx, undefined, {
          requestKey: randomUUID(),
          sku,
          name: sku,
          kind,
          unit: "件",
        }),
      p = await material("AI-PRODUCT", "finished"),
      r = await material("AI-RAW", "raw");
    const b = await mes.saveBom(ctx, undefined, {
      requestKey: randomUUID(),
      draft: {
        productId: p.id,
        lines: [{ materialId: r.id, quantity: "2", wastePercent: "0" }],
      },
    });
    await mes.publishBom(ctx, b.id, {
      requestKey: randomUUID(),
      version: b.version,
    });
    const draft = {
      code: "AI-PLAN",
      productId: p.id,
      bomId: b.id,
      targetQty: 10,
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      note: "AI草稿",
    };
    const call = (tool, input) => [
        {
          type: "function_call",
          name: tool.replace(/\./g, "__"),
          call_id: randomUUID(),
          arguments: JSON.stringify(input),
        },
      ],
      answer = (text) => [
        { type: "message", content: [{ type: "output_text", text }] },
      ];
    async function turn(q, resource) {
      inputs.length = 0;
      const c = await ai.create(ctx, {
        title: "MES AI检查",
        ...(resource ? { resource } : {}),
      });
      const result = await ai.send(ctx, c.id, {
        version: c.version,
        content: q,
        allowAction: true,
        requireConfirmation: true,
        useMemory: false,
        thinkingMode: "auto",
      });
      return { c, result };
    }
    let round = 0;
    handler = () => {
      round++;
      if (round === 1)
        return call("mes.list_records", {
          type: "boms",
          q: "AI-PRODUCT",
          page: 1,
        });
      if (round === 2) return call("mes.preview_plan", draft);
      return call("mes.create_plan_draft", draft);
    };
    const t = await turn("创建生产计划草稿");
    eq(t.result.failed, false);
    eq(inputs.length, 3);
    ok(inputs.every((i) => i.agent === "mes-assistant"));
    eq(await db.mesPlan.count({ where: { tenantId: f.tenant.id } }), 0);
    const action = await ai.action(ctx, t.result.message.actionId);
    eq(action.status, "pending");
    eq(action.preview.requirements[0].quantity, "20.000");
    const confirmed = await ai.confirm(ctx, action.id, {
      previewHash: action.previewHash,
    });
    eq(confirmed.status, "completed");
    eq(confirmed.result.status, "draft");
    eq(await db.mesWorkOrder.count({ where: { tenantId: f.tenant.id } }), 0);
    await ai.confirm(ctx, action.id, {});
    eq(await db.mesPlan.count({ where: { tenantId: f.tenant.id } }), 1);
    ok(
      (
        await ai.presentAction(ctx, action.id)
      ).presentation.destination.includes("/mes/plans/"),
    );
    // Native read loop returns authoritative sources, not an executable model-written success string.
    handler = () =>
      round++ % 2 === 0
        ? call("mes.inspect", { type: "plan", id: confirmed.result.id })
        : answer("计划已保存草稿，尚未派工。");
    round = 0;
    let read = await turn("分析生产计划");
    eq(read.result.failed, false);
    ok(read.result.message.sources.some((s) => s.type === "plan"));
    ok(read.result.message.sources.some((s) => s.type.startsWith("scope_")));
    eq(inputs.length, 2);
    // A current BOM review cannot reference fabricated lines; saving a valid review waits for confirmation.
    const b2 = await mes.saveBom(ctx, undefined, {
      requestKey: randomUUID(),
      draft: {
        productId: p.id,
        lines: [{ materialId: r.id, quantity: "3", wastePercent: "5" }],
      },
    });
    handler = () =>
      call("mes.save_bom_review", {
        bomId: b2.id,
        version: b2.version,
        findings: [
          { lineId: randomUUID(), severity: "critical", message: "无效引用" },
        ],
      });
    let bad = await turn("保存BOM审查问题", { type: "bom", id: b2.id });
    eq(bad.result.failed, true);
    eq(await db.aiAction.count({ where: { conversationId: bad.c.id } }), 0);
    handler = () =>
      call("mes.save_bom_review", {
        bomId: b2.id,
        version: b2.version,
        findings: [
          {
            lineId: b2.lines[0].id,
            severity: "warning",
            message: "请核实损耗率与工艺文件是否一致",
          },
        ],
      });
    const review = await turn("保存BOM审查问题", { type: "bom", id: b2.id });
    eq(review.result.failed, false);
    eq(await db.mesBomReview.count({ where: { bomId: b2.id } }), 0);
    const ra = await ai.action(ctx, review.result.message.actionId);
    const reviewPreview = await provider.preview(ctx, ra.toolId, ra.input);
    const ri = JSON.parse(JSON.stringify(ra.input));
    ri.findings = ri.findings.map((f) => ({message:f.message,severity:f.severity,lineId:f.lineId}));
    eq(await provider.preview(ctx, ra.toolId, ri), reviewPreview);
    const savedReview = await ai.confirm(ctx, ra.id, {previewHash:ra.previewHash});
    eq(savedReview.status, 'completed');
    await ai.confirm(ctx, ra.id, {previewHash:ra.previewHash});
    eq(await db.mesBomReview.count({where:{bomId:b2.id}}),1);
    const staleReview = await turn("保存BOM审查问题", { type: "bom", id: b2.id });
    const staleAction = await ai.action(ctx, staleReview.result.message.actionId);
    await mes.saveBom(ctx, b2.id, {
      requestKey: randomUUID(),
      version: b2.version,
      draft: {
        productId: p.id,
        lines: [{ materialId: r.id, quantity: "4", wastePercent: "0" }],
      },
    });
    await assert.rejects(() =>
      ai.confirm(ctx, staleAction.id, { previewHash: staleAction.previewHash }),
    );
    checks++;
    eq(await db.mesBomReview.count({ where: { bomId: b2.id } }), 1);
    // The preview is checked again under the business lock, not just before starting the command.
    const sm = await material("RACE-SEMI", "semi"),
      rp = await material("RACE-PRODUCT", "finished");
    const child = await mes.saveBom(ctx, undefined, {
      requestKey: randomUUID(),
      draft: {
        productId: sm.id,
        lines: [{ materialId: r.id, quantity: "1", wastePercent: "0" }],
      },
    });
    await mes.publishBom(ctx, child.id, {
      requestKey: randomUUID(),
      version: child.version,
    });
    const root = await mes.saveBom(ctx, undefined, {
      requestKey: randomUUID(),
      draft: {
        productId: rp.id,
        lines: [{ materialId: sm.id, quantity: "1", wastePercent: "0" }],
      },
    });
    await mes.publishBom(ctx, root.id, {
      requestKey: randomUUID(),
      version: root.version,
    });
    const raceDraft = {
      ...draft,
      code: "RACE-GUARD",
      productId: rp.id,
      bomId: root.id,
    };
    const pending = await db.aiAction.create({
      data: {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        membershipId: ctx.membershipId,
        appId: "mes",
        conversationId: t.c.id,
        toolId: "mes.create_plan_draft",
        input: raceDraft,
        status: "pending",
        confirmationRequired: true,
        idempotencyKey: randomUUID(),
      },
    });
    const pa = await ai.action(ctx, pending.id),
      originalExecute = provider.execute.bind(provider);
    provider.execute = async (c, id, i, execution) => {
      if (id === "mes.create_plan_draft") {
        const next = await mes.saveBom(ctx, undefined, {
          requestKey: randomUUID(),
          draft: {
            productId: sm.id,
            lines: [{ materialId: r.id, quantity: "9", wastePercent: "0" }],
          },
        });
        await mes.publishBom(ctx, next.id, {
          requestKey: randomUUID(),
          version: next.version,
        });
      }
      return originalExecute(c, id, i, execution);
    };
    await assert.rejects(
      () => ai.confirm(ctx, pa.id, { previewHash: pa.previewHash }),
      /预览已变化/,
    );
    checks++;
    provider.execute = originalExecute;
    eq(
      await db.mesPlan.count({
        where: { tenantId: ctx.tenantId, code: "RACE-GUARD" },
      }),
      0,
    );
    // Scope changes after a response invalidate delivery and history. No broad reads for an operator.
    await db.mesMemberGrant.create({
      data: {
        tenantId: f.tenant.id,
        membershipId: f.accounts.admin.memberId,
        role: "operator",
      },
    });
    handler = () => answer("授权内容");
    after = () =>
      db.membership.update({
        where: { id: ctx.membershipId },
        data: { role: "sales" },
      });
    const revoked = await turn("分析生产进度");
    eq(revoked.result.failed, true);
    ctx = await context("admin");
    const hidden = await ai.get(ctx, read.c.id);
    ok(hidden.messages.at(-1).content.includes("不可访问"));
    await assert.rejects(() =>
      provider.execute(ctx, "mes.list_records", {
        type: "materials",
        q: "",
        page: 1,
      }),
    );
    checks++;
    await assert.rejects(() =>
      provider.resourceFacts(ctx, "plan", confirmed.result.id),
    );
    checks++;
    // An endless read loop is stopped after five paid-equivalent calls, each independently metered.
    await db.membership.update({
      where: { id: ctx.membershipId },
      data: { role: "admin" },
    });
    ctx = await context("admin");
    handler = () => call("mes.production_overview", {});
    const endless = await turn("分析生产进度");
    eq(endless.result.failed, true);
    eq(inputs.length, 5);
    process.env.MES_AI_RELEASE_ENABLED = "false";
    await assert.rejects(() =>
      context("admin").then((c) => provider.resourceFacts(c, "production")),
    );
    checks++;
    process.env.MES_AI_RELEASE_ENABLED = "true";
    const usage = await db.aiModelUsage.findMany({
      where: { tenantId: f.tenant.id },
    });
    eq(usage.length, calls);
    ok(
      usage.every(
        (u) =>
          u.appId === "mes" &&
          u.totalTokens === 110 &&
          u.usageStatus === "reported",
      ),
    );
    eq(await db.erpProduct.count({ where: { tenantId: f.tenant.id } }), 0);
    console.log(
      JSON.stringify({
        ok: true,
        checks,
        httpModelFixtureRequests: calls,
        paidModelCalls: 0,
      }),
    );
  } finally {
    if (app) await app.close();
    if (server) await new Promise((r) => server.close(r));
    if (f) {
      await db.usageRecord.deleteMany({ where: { tenantId: f.tenant.id } });
      await cleanupFixture(db, f);
    }
    await db.$disconnect();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
