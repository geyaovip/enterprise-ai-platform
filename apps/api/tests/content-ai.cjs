const assert = require("node:assert/strict"),
  http = require("node:http"),
  { randomUUID } = require("node:crypto");
const { createApp } = require("../dist/server"),
  { PrismaService } = require("../dist/modules/prisma.service"),
  { AuthService } = require("../dist/modules/platform/auth.service"),
  { AiService } = require("../dist/modules/ai/ai.service"),
  { ContentService } = require("../dist/modules/content/content.service"),
  {
    ContentAiProvider,
  } = require("../dist/modules/content/content-ai.provider"),
  { SeedreamProvider } = require("../dist/modules/content/seedream.provider"),
  {
    infrastructureSecret,
  } = require("../dist/modules/platform/infrastructure-contract"),
  {
    createFixture,
    cleanupFixture,
  } = require("../scripts/workflow-fixture.cjs");
if (
  !/@127\.0\.0\.1:54329\/suite_phase1_qa$/.test(process.env.DATABASE_URL || "")
)
  throw Error("QA database required");
process.env.NATIVE_AI_MODEL_ENABLED = "true";
process.env.AI_ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");
(async () => {
  const db = new PrismaService();
  let app,
    f,
    server,
    handler,
    requests = 0,
    paidImageCalls = 0,
    checks = 0;
  const eq = (a, b) => {
      assert.deepEqual(a, b);
      checks++;
    },
    ok = (x) => {
      assert.ok(x);
      checks++;
    };
  try {
    server = http.createServer(async (req, res) => {
      let raw = "";
      for await (const b of req) raw += b;
      requests++;
      const input = JSON.parse(raw),
        output = handler
          ? handler(input)
          : [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: "标题建议：轻装出发，自然随行。",
                  },
                ],
              },
            ];
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: randomUUID(),
          model: "local-content-runtime",
          status: "completed",
          usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
          output,
        }),
      );
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    app = await createApp();
    await app.init();
    f = await createFixture(
      db,
      "erp-flow-test-content-ai-" + randomUUID().slice(0, 7),
    );
    await db.tenantApp.create({
      data: { tenantId: f.tenant.id, appId: "content" },
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
      content = app.get(ContentService),
      provider = app.get(ContentAiProvider),
      media = app.get(SeedreamProvider);
    media.configured = () => true;
    media.generate = async () => {
      paidImageCalls++;
      throw Error("No image generation before Worker");
    };
    const ctx = await auth.taskContext({
      tenantId: f.tenant.id,
      userId: f.accounts.admin.userId,
      membershipId: f.accounts.admin.memberId,
      appId: "content",
      taskId: randomUUID(),
    });
    await db.infrastructureBinding.create({
      data: {
        tenantId: f.tenant.id,
        kind: "runtime",
        scopeKey: ctx.membershipId,
        provider: "openclaw",
        baseUrl: "http://127.0.0.1:" + server.address().port,
        secretCiphertext: infrastructureSecret("content-local-only"),
        options: {
          agentId: "content-assistant",
          fastAgentId: "content-assistant",
          readAgentId: "content-assistant",
          ephemeralTurns: true,
        },
      },
    });
    const brand = await content.saveDocument(ctx, "brand", {
      name: "AI品牌",
      data: { tone: "自然简洁" },
    });
    await content.publish(ctx, brand.id, { version: 1 });
    const product = await content.saveDocument(ctx, "product", {
      name: "AI产品",
      data: { sellingPoints: "轻盈耐用", price: "299元" },
    });
    const project = await content.saveProject(ctx, {
      name: "AI图文项目",
      brief: {
        brandId: brand.id,
        brandVersion: 1,
        productIds: [product.id],
        productVersions: { [product.id]: 1 },
        prompt: "自然简洁的产品背景",
        sizes: ["square"],
      },
    });
    const analysis = await ai.analyze(ctx, {
      type: "project",
      id: project.id,
      question: "给我一个标题建议",
    });
    ok(analysis.answer.includes("轻装出发"));
    for (const source of analysis.sources)
      await provider.resourceFacts(ctx, source.type, source.id);
    eq(paidImageCalls, 0);
    const plan = await content.plan(ctx, project.id, {
        projectVersion: 1,
        mode: "background",
      }),
      input = {
        projectId: project.id,
        request: { projectVersion: 1, mode: "background" },
        previewHash: plan.previewHash,
        expiresAt: plan.expiresAt,
        requestKey: randomUUID(),
      };
    const p1 = await provider.preview(ctx, "content.submit_generation", input),
      p2 = await provider.preview(ctx, "content.submit_generation", input);
    eq(p1, p2);
    handler = () => [
      {
        type: "function_call",
        name: "content__submit_generation",
        call_id: randomUUID(),
        arguments: JSON.stringify(input),
      },
    ];
    const c = await ai.create(ctx, {
      title: "生成待确认清单",
      resource: { type: "project", id: project.id },
    });
    const result = await ai.send(ctx, c.id, {
      version: c.version,
      content: "按刚才核对的清单生成图片，先给我确认",
      allowAction: true,
      requireConfirmation: true,
      useMemory: false,
      thinkingMode: "fast",
    });
    eq(result.failed, false);
    ok(result.message.actionId);
    eq(await db.contentBatch.count({ where: { tenantId: f.tenant.id } }), 0);
    const action = await ai.action(ctx, result.message.actionId);
    eq(action.status, "pending");
    const done = await ai.confirm(ctx, action.id, {
      previewHash: action.previewHash,
    });
    eq(done.status, "completed");
    eq(await db.contentBatch.count({ where: { tenantId: f.tenant.id } }), 1);
    await ai.confirm(ctx, action.id, {});
    eq(await db.contentBatch.count({ where: { tenantId: f.tenant.id } }), 1);
    eq(paidImageCalls, 0);
    ok(
      (
        await ai.presentAction(ctx, action.id)
      ).presentation.destination.startsWith("/content/projects/"),
    );
    const artwork = await content.createArtwork(ctx, project.id, {
      name: "AI文案验收",
      productId: product.id,
      size: "square",
    });
    const copyContext = await provider.execute(ctx, "content.inspect_artwork", {
      artifactId: artwork.id,
    });
    const artifactFacts = await provider.resourceFacts(
      ctx,
      "artifact",
      artwork.id,
    );
    eq(artifactFacts.source.id, artwork.id);
    eq(artifactFacts.displayName, "AI文案验收");
    const copyInput = {
      artifactId: artwork.id,
      baseVersion: 1,
      projectVersion: 1,
      snapshotHash: copyContext.snapshotHash,
      requestKey: randomUUID(),
      candidates: [
        { label: "自然标题", changes: { title: "轻盈随行，自然出发" } },
      ],
    };
    handler = () => [
      {
        type: "function_call",
        name: "content__stage_copy",
        call_id: randomUUID(),
        arguments: JSON.stringify(copyInput),
      },
    ];
    const copyChat = await ai.create(ctx, {
      title: "结构化文案建议",
      resource: { type: "artifact", id: artwork.id },
    });
    const copyResult = await ai.send(ctx, copyChat.id, {
      version: copyChat.version,
      content: "帮我保存这个作品的标题候选，先让我确认",
      allowAction: true,
      requireConfirmation: true,
      useMemory: false,
      thinkingMode: "fast",
    });
    eq(copyResult.failed, false);
    ok(copyResult.message.actionId);
    eq(
      await db.contentCopySuggestion.count({
        where: { tenantId: f.tenant.id },
      }),
      0,
    );
    const copyAction = await ai.action(ctx, copyResult.message.actionId);
    const copyDone = await ai.confirm(ctx, copyAction.id, {
      previewHash: copyAction.previewHash,
    });
    eq(copyDone.status, "completed");
    const suggestions = await content.editing.suggestions(ctx, artwork.id);
    eq(suggestions.length, 1);
    const requestsBeforeAdoption = requests;
    const adopted = await content.editing.adoptCopy(ctx, artwork.id, {
      suggestionId: suggestions[0].id,
      candidate: 0,
      revision: 0,
      requestKey: randomUUID(),
    });
    eq(adopted.data.copy.title, "轻盈随行，自然出发");
    eq(requests, requestsBeforeAdoption);
    eq(paidImageCalls, 0);
    ok(
      (
        await ai.presentAction(ctx, copyAction.id)
      ).presentation.destination.includes(artwork.id),
    );
    const oldScope = analysis.sources.find((s) => s.type.startsWith("scope_"));
    await content.trashProject(ctx, project.id);
    await assert.rejects(() =>
      provider.resourceFacts(ctx, oldScope.type, oldScope.id),
    );
    checks++;
    await assert.rejects(() => ai.get(ctx, c.id));
    checks++;
    await assert.rejects(() => ai.get(ctx, copyChat.id));
    checks++;
    console.log(
      JSON.stringify({
        ok: true,
        checks,
        localRuntimeHttpRequests: requests,
        paidModelCalls: 0,
        confirmedBatchDeduped: true,
        scopeRevocation: true,
      }),
    );
  } finally {
    if (f) {
      for (const table of [
        "contentExport",
        "contentProviderAttempt",
        "contentGenerationItem",
        "contentBatch",
        "contentArtifactVersion",
        "contentArtifact",
        "contentAsset",
        "contentProject",
        "contentDocumentVersion",
        "contentDocument",
        "contentGrant",
        "contentSettings",
      ])
        await db[table].deleteMany({ where: { tenantId: f.tenant.id } });
      await db.usageRecord.deleteMany({ where: { tenantId: f.tenant.id } });
      await db.aiModelUsage.deleteMany({ where: { tenantId: f.tenant.id } });
      await cleanupFixture(db, f);
    }
    if (app) await app.close();
    if (server) await new Promise((r) => server.close(r));
    await db.$disconnect();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
