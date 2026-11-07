const assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto"),
  fs = require("node:fs");
if (
  !/^postgresql:\/\/[^@]+@127\.0\.0\.1:54329\/suite_phase1_qa$/.test(
    process.env.DATABASE_URL ?? "",
  )
)
  throw Error("Dedicated local QA database required");
const { createApp } = require("../dist/server"),
  { PrismaService } = require("../dist/modules/prisma.service"),
  { GeoService } = require("../dist/modules/geo/geo.service"),
  { GeoWorker } = require("../dist/modules/geo/geo.worker"),
  { GeoProvider } = require("../dist/modules/geo/geo.provider"),
  { GeoAiProvider } = require("../dist/modules/geo/geo-ai.provider"),
  { AuthService } = require("../dist/modules/platform/auth.service"),
  { ModelGatewayError } = require("../dist/modules/geo/reused/contracts");
const {
    GEO_PARSER_VERSION,
    parseGeoAnswer,
    reportFor,
    citationUrl,
  } = require("../dist/modules/geo/geo.metrics"),
  { nextMonitoringAt } = require("../dist/modules/geo/reused/schedule"),
  { VolcengineArkAdapter } = require("../dist/modules/geo/reused/ark-adapter");
const {
  createFixture,
  fixtureHttp,
} = require("../scripts/workflow-fixture.cjs");
let checks = 0,
  calls = 0;
const eq = (a, b) => {
    assert.deepEqual(a, b);
    checks++;
  },
  ok = (v) => {
    assert.ok(v);
    checks++;
  };
(async () => {
  let app, db;
  try {
    app = await createApp();
    db = app.get(PrismaService);
    const g = app.get(GeoService),
      worker = app.get(GeoWorker),
      provider = app.get(GeoProvider);
    let nextError = null,
      responseText = "1. 推荐测试品牌，服务可靠。\n2. 竞品甲：提供服务。";
    provider.invoke = async (m, q, s, secret, id) => {
      calls++;
      ok(secret.length > 20);
      ok(!q.text.includes("API Key"));
      if (nextError) {
        const e = nextError;
        nextError = null;
        throw e;
      }
      return {
        text: responseText,
        inputTokens: 120,
        outputTokens: 80,
        searchCalls: q.nativeWebSearch ? 1 : 0,
        finishReason: "stop",
        providerRequestId: "qa-" + id,
        citations: [
          { title: "官网", url: "https://example.test/article?utm_source=qa" },
          { title: "同文", url: "https://example.test/article" },
          { title: "bad", url: "javascript:alert(1)" },
        ],
      };
    };
    const f = await createFixture(
      db,
      "erp-flow-test-geo-" + randomUUID().slice(0, 8),
    );
    await db.tenantApp.deleteMany({ where: { tenantId: f.tenant.id } });
    await db.tenantApp.create({
      data: { tenantId: f.tenant.id, appId: "geo" },
    });
    await db.tenantCapability.create({
      data: {
        tenantId: f.tenant.id,
        capability: "ai",
        delivered: true,
        enabled: true,
      },
    });
    const other = await db.tenant.create({
      data: {
        slug: "erp-flow-test-geo-other-" + randomUUID().slice(0, 8),
        name: "GEO isolation QA",
      },
    });
    await db.membership.create({
      data: {
        tenantId: other.id,
        userId: f.accounts.admin.userId,
        role: "admin",
      },
    });
    await db.tenantApp.create({ data: { tenantId: other.id, appId: "geo" } });
    const h = await fixtureHttp(app, f),
      base = `/tenants/${f.tenant.slug}/apps/geo`;
    const req = async (
      path,
      method = "GET",
      body,
      actor = "admin",
      status = method === "POST" ? 201 : 200,
    ) => (await h.request(base + path, method, body, actor, status)).data;
    const ctx = async (actor = "admin") =>
      app.get(AuthService).taskContext({
        tenantId: f.tenant.id,
        userId: f.accounts[actor].userId,
        membershipId: f.accounts[actor].memberId,
        appId: "geo",
        taskId: "geo-qa",
      });
    eq(
      (await h.request(`/tenants/${f.tenant.slug}/applications`)).data.find(
        (x) => x.appId === "geo",
      ).permissions.length,
      7,
    );
    eq(
      await db.tenantApp.count({
        where: { tenantId: f.tenant.id, appId: "erp" },
      }),
      0,
    );
    eq(calls, 0);
    await req("/metadata", "GET", undefined, "buyer", 403);
    await req("/members", "PUT", {
      membershipId: f.accounts.buyer.memberId,
      role: "viewer",
      version: 0,
    });
    eq(
      (await req("/metadata", "GET", undefined, "buyer")).permissions.includes(
        "geo.analysis.run",
      ),
      false,
    );
    const project = await req("/projects", "POST", {
      name: "GEO 新数据测试",
      brandName: "测试品牌",
      aliases: ["测试牌"],
      competitors: ["竞品甲"],
    });
    ok(project.id);
    eq((await req("/projects")).total, 1);
    await req(
      "/projects",
      "POST",
      { name: "x", brandName: "x", timezone: "invalid" },
      "admin",
      400,
    );
    await req(
      "/projects/" + project.id,
      "PUT",
      { name: project.name, brandName: project.brandName, version: 999 },
      "admin",
      409,
    );
    const foreign = await db.geoProject.create({
      data: {
        tenantId: other.id,
        name: "foreign",
        brandName: "foreign",
        aliases: [],
        competitors: [],
        createdByMembershipId: f.accounts.admin.memberId,
      },
    });
    await req("/projects/" + foreign.id, "GET", undefined, "admin", 404);
    await req(
      `/projects/${foreign.id}/questions`,
      "POST",
      { text: "foreign?" },
      "admin",
      404,
    );
    const question = await req(`/projects/${project.id}/questions`, "POST", {
        text: "有哪些值得推荐的服务品牌？",
        category: "选型",
      }),
      webQuestion = await req(`/projects/${project.id}/questions`, "POST", {
        text: "最近推荐哪些品牌？",
        nativeWebSearch: true,
        category: "资讯",
      });
    const modelBody = {
      name: "测试豆包",
      family: "doubao",
      code: "qa-doubao",
      apiMode: "responses",
      apiKey: "qa-only-credential-12345",
      nativeWebSearch: false,
      inputPriceMicrosPerMillion: 1000000,
      outputPriceMicrosPerMillion: 2000000,
    };
    const model = await req("/models", "POST", modelBody);
    await req(
      "/models",
      "POST",
      { ...modelBody, apiKey: undefined },
      "admin",
      400,
    );
    await req(
      "/models",
      "POST",
      { ...modelBody, apiMode: "chat_completions", nativeWebSearch: true },
      "admin",
      400,
    );
    const models = await req("/models");
    eq(models.length, 1);
    ok(!JSON.stringify(models).includes("secretCiphertext"));
    ok(!JSON.stringify(models).includes("credential-12345"));
    eq(calls, 0);
    const body = {
      questionIds: [question.id, webQuestion.id],
      modelIds: [model.id],
      maxCostMicros: 1000000,
    };
    const estimate = await req(
      `/projects/${project.id}/estimate`,
      "POST",
      body,
    );
    eq(estimate.eligibleRuns, 1);
    eq(estimate.skippedRuns, 1);
    ok(estimate.estimatedCostMicros > 0);
    eq(calls, 0);
    await req(
      `/projects/${project.id}/estimate`,
      "POST",
      { ...body, maxCostMicros: 1 },
      "admin",
      400,
    );
    await req(
      `/projects/${project.id}/estimate`,
      "POST",
      { ...body, questionIds: [webQuestion.id] },
      "admin",
      400,
    );
    await req(
      `/projects/${project.id}/analyses`,
      "POST",
      { ...body, estimateHash: "a".repeat(64), requestKey: randomUUID() },
      "admin",
      409,
    );
    const input = {
      ...body,
      estimateHash: estimate.estimateHash,
      requestKey: randomUUID(),
    };
    const job = await req(`/projects/${project.id}/analyses`, "POST", input);
    eq(job.status, "queued");
    const same = await req(`/projects/${project.id}/analyses`, "POST", input);
    eq(same.id, job.id);
    await req(
      `/projects/${project.id}/analyses`,
      "POST",
      { ...input, maxCostMicros: 999999 },
      "admin",
      409,
    );
    eq(calls, 0);
    await Promise.all([worker.tick(), worker.tick()]);
    eq(calls, 1);
    const finished = await req("/analyses/" + job.id);
    eq(finished.status, "partially_completed");
    eq(finished.report.validSamples, 1);
    eq(finished.report.mentionRate, 100);
    eq(finished.report.averageRank, 1);
    eq(finished.report.citations.length, 1);
    eq(finished.report.domains[0].count, 1);
    eq(finished.actualCostMicros, 280);
    eq(
      await db.aiChatTurn.count({ where: { userId: f.accounts.admin.userId } }),
      0,
    );
    eq(
      await db.aiModelUsage.count({
        where: { batchId: job.id, appId: "geo", usageStatus: "recorded" },
      }),
      1,
    );
    await req(
      "/analyses/" + job.id + "/cancel",
      "POST",
      { version: finished.version },
      "admin",
      409,
    );
    await req("/analyses/" + job.id, "GET", undefined, "buyer");
    await h.request(
      `/tenants/${other.slug}/apps/geo/analyses/${job.id}`,
      "GET",
      undefined,
      "admin",
      404,
    );
    const insights = await req(`/projects/${project.id}/insights?days=7`);
    eq(insights.groups.length, 1);
    eq(insights.groups[0].points[0].mentionRate, 100);
    const one = {
      questionIds: [question.id],
      modelIds: [model.id],
      maxCostMicros: 1000000,
    };
    const submit = async (extra = {}) => {
      const b = { ...one, ...extra },
        e = await req(`/projects/${project.id}/estimate`, "POST", b);
      return req(`/projects/${project.id}/analyses`, "POST", {
        ...b,
        estimateHash: e.estimateHash,
        requestKey: randomUUID(),
      });
    };
    const baseline = await submit();
    await worker.tick();
    const b = await req("/analyses/" + baseline.id);
    eq(b.status, "completed");
    eq(b.report.validSamples, 1);
    const task = await req(`/projects/${project.id}/optimizations`, "POST", {
      title: "完善事实说明",
      description: "核对官网来源并记录优化依据",
      baselineId: b.id,
      sourceRunId: b.runs[0].id,
      assigneeMembershipId: f.accounts.admin.memberId,
    });
    eq(task.sourceRunId, b.runs[0].id);
    eq(
      (await req("/optimizations/mine")).map((item) => item.id),
      [task.id],
    );
    eq(await req("/optimizations/mine", "GET", undefined, "buyer"), []);
    const taskInput = {
      title: "检查任务证据",
      description: "核实回答依据",
      baselineId: b.id,
    };
    await req(
      `/projects/${project.id}/optimizations`,
      "POST",
      { ...taskInput, sourceRunId: finished.runs[0].id },
      "admin",
      400,
    );
    await req(
      `/projects/${project.id}/optimizations`,
      "POST",
      { ...taskInput, assigneeMembershipId: f.accounts.buyer.memberId },
      "admin",
      400,
    );
    await req(
      `/projects/${project.id}/optimizations`,
      "POST",
      { title: "foreign", description: "foreign", baselineId: foreign.id },
      "admin",
      400,
    );
    await req(`/projects/${project.id}/questions/${question.id}`, "PUT", {
      text: "修改后的不同问题？",
      category: "新问题",
      version: question.version,
    });
    const test = await submit({ baselineId: b.id, optimizationId: task.id });
    eq(test.snapshot.questions[0].text, b.snapshot.questions[0].text);
    await worker.tick();
    const tested = await req("/analyses/" + test.id);
    eq(tested.comparison.comparable, false);
    eq(tested.comparison.delta, null);
    ok(tested.comparison.reason.includes("样本覆盖不足"));
    const changed = await submit();
    await worker.tick();
    eq((await req(`/projects/${project.id}/insights?days=7`)).groups.length, 3);
    const unknown = await submit();
    nextError = new ModelGatewayError("timeout", "PROVIDER_TIMEOUT", true);
    await worker.tick();
    const u = await req("/analyses/" + unknown.id);
    eq(u.status, "needs_review");
    eq(u.actualCostMicros, null);
    const before = calls;
    await worker.tick();
    eq(calls, before);
    eq(
      await db.aiModelUsage.count({
        where: { batchId: u.id, usageStatus: "unknown" },
      }),
      1,
    );
    await req(
      "/analyses/" + u.id + "/reconcile",
      "POST",
      {
        runId: u.runs[0].id,
        version: u.version,
        actualCostMicros: 15,
        evidence: "测试账单确认未取得回答",
      },
      "buyer",
      403,
    );
    await req("/analyses/" + u.id + "/reconcile", "POST", {
      runId: u.runs[0].id,
      version: u.version,
      actualCostMicros: 15,
      evidence: "测试账单核对供应商实际计费",
    });
    eq((await req("/analyses/" + u.id)).actualCostMicros, 15);
    const retry = await submit();
    nextError = new ModelGatewayError(
      "rate_limit",
      "PROVIDER_RATE_LIMITED",
      true,
    );
    await worker.tick();
    eq((await req("/analyses/" + retry.id)).runs[0].attempts, 1);
    eq((await req("/analyses/" + retry.id)).runs[0].status, "queued");
    const after429 = calls;
    await worker.tick();
    eq(calls, after429);
    await db.geoRun.updateMany({
      where: { analysisId: retry.id },
      data: { retryAt: new Date(0) },
    });
    await worker.tick();
    eq((await req("/analyses/" + retry.id)).status, "completed");
    const stale = await submit();
    await db.geoAnalysis.update({
      where: { id: stale.id },
      data: { status: "running", leaseUntil: new Date(0) },
    });
    await db.geoRun.updateMany({
      where: { analysisId: stale.id, status: "queued" },
      data: { status: "running", attempts: 1 },
    });
    const beforeStale = calls;
    await worker.tick();
    eq(calls, beforeStale);
    eq((await req("/analyses/" + stale.id)).status, "needs_review");
    const cancel = await submit();
    await req("/analyses/" + cancel.id + "/cancel", "POST", {
      version: cancel.version,
    });
    await worker.tick();
    eq((await req("/analyses/" + cancel.id)).status, "cancelled");
    const adminMetadata = await ctx();
    const ai = app.get(GeoAiProvider);
    eq(ai.canUse(adminMetadata, "geo.inspect_analysis"), true);
    eq(
      (await ai.execute(adminMetadata, "geo.inspect_analysis", { id: b.id }))
        .id,
      b.id,
    );
    await assert.rejects(() =>
      ai.execute(adminMetadata, "geo.inspect_analysis", {
        id: u.id,
        unexpected: true,
      }),
    );
    checks++;
    const viewer = await ctx("buyer");
    await assert.rejects(() => g.submit(viewer, project.id, input));
    checks++;
    const daily = await req("/settings");
    await req("/settings", "PUT", {
      dailyBudgetMicros: 1,
      version: daily.version,
    });
    await assert.rejects(() => submit());
    checks++;
    const limited = await req("/settings");
    await req("/settings", "PUT", {
      dailyBudgetMicros: 20000000,
      version: limited.version,
    });
    const scheduleBody = {
      ...one,
      name: "每日品牌监测",
      frequency: "daily",
      hour: 9,
      minute: 0,
      weekday: 1,
      active: true,
      requestKey: randomUUID(),
    };
    const schedule = await req(
      `/projects/${project.id}/schedules`,
      "POST",
      scheduleBody,
    );
    eq(
      (await req(`/projects/${project.id}/schedules`, "POST", scheduleBody)).id,
      schedule.id,
    );
    await req(
      `/projects/${project.id}/schedules`,
      "POST",
      { ...scheduleBody, name: "other" },
      "admin",
      409,
    );
    await db.geoSchedule.update({
      where: { id: schedule.id },
      data: { nextRunAt: new Date(Date.now() - 100000) },
    });
    await Promise.all([worker.schedules(), worker.schedules()]);
    eq(
      await db.geoScheduleExecution.count({
        where: { scheduleId: schedule.id },
      }),
      1,
    );
    const execution = await db.geoScheduleExecution.findFirst({
      where: { scheduleId: schedule.id },
    });
    eq(execution.status, "submitted");
    ok(execution.analysisId);
    await worker.tick();
    const currentSchedule = await db.geoSchedule.findUnique({
      where: { id: schedule.id },
    });
    await req("/schedules/" + schedule.id + "/state", "PUT", {
      active: false,
      version: currentSchedule.version,
    });
    await worker.schedules();
    eq(
      await db.geoScheduleExecution.count({
        where: { scheduleId: schedule.id },
      }),
      1,
    );
    const revocable = await submit();
    await db.tenantApp.update({
      where: { tenantId_appId: { tenantId: f.tenant.id, appId: "geo" } },
      data: { enabled: false },
    });
    const beforeRevoke = calls;
    await worker.tick();
    eq(calls, beforeRevoke);
    eq(
      (await db.geoAnalysis.findUnique({ where: { id: revocable.id } })).status,
      "cancelled",
    );
    await req("/metadata", "GET", undefined, "admin", 403);
    await db.tenantApp.update({
      where: { tenantId_appId: { tenantId: f.tenant.id, appId: "geo" } },
      data: { enabled: true },
    });
    // Member grant revocation also removes notices, even while the application stays enabled.
    const notes = await h.request(`/tenants/${f.tenant.slug}/notifications`);
    ok(notes.data.items.some((n) => n.appId === "geo"));
    await req("/members", "PUT", {
      membershipId: f.accounts.buyer.memberId,
      role: "none",
      version: 1,
    });
    await req("/metadata", "GET", undefined, "buyer", 403);
    const p0 = {
      brandName: "测试品牌",
      aliases: [],
      competitors: [],
      country: "CN",
      language: "zh-CN",
      questions: [],
      models: [],
      parserVersion: GEO_PARSER_VERSION,
      scoreVersion: "x",
    };
    eq(parseGeoAnswer("测试品牌提供服务。", p0).mentions[0].rank, undefined);
    eq(
      parseGeoAnswer("1. 不推荐测试品牌。", p0).mentions[0].recommended,
      false,
    );
    eq(parseGeoAnswer("抱歉，无法提供回答", p0).validSample, false);
    eq(parseGeoAnswer("1. 推荐测试品牌", p0, true).validSample, false);
    for (const example of [
      "1. 推荐临溪净水；测试品牌仅作对照。\n2. 另一品牌可比较。",
      "1. 测试品牌提供售后。\n2. 另一个品牌有不同政策。",
      "1. 测试品牌经常被推荐，但这次并不适合。\n2. 建议比较其他产品。",
    ]) {
      const target = parseGeoAnswer(example, p0).mentions.find(
        (item) => item.kind === "target",
      );
      eq(target?.recommended, false);
      eq(target?.rank, undefined);
    }
    const ranked = parseGeoAnswer(
      "推荐排名：\n1. 临溪净水：适合低预算。\n2. 推荐测试品牌：适合三口之家。",
      p0,
    );
    eq(ranked.mentions[0].rank, 2);
    ok(ranked.evidence.recommendation.includes("推荐测试品牌"));
    eq(parseGeoAnswer("推荐测试品牌。", p0).mentions[0].rank, undefined);
    const legacy = parseGeoAnswer(
      "1. 测试品牌提供售后。\n2. 另一个品牌有不同政策。",
      {
        ...p0,
        parserVersion: require("../dist/modules/geo/reused/parser")
          .PARSER_VERSION,
      },
    );
    eq(legacy.mentions[0].rank, 1);
    eq(reportFor(p0, []).mentionRate, null);
    eq(citationUrl("javascript:alert(1)"), null);
    eq(
      citationUrl("https://example.test/a?utm_source=x#part"),
      "https://example.test/a",
    );
    eq(
      nextMonitoringAt(
        {
          frequency: "daily",
          hour: 9,
          minute: 0,
          weekday: 1,
          timezone: "Asia/Shanghai",
        },
        new Date("2026-11-07T00:00:00Z"),
      ).toISOString(),
      "2026-11-07T01:00:00.000Z",
    );
    const request = {
      apiMode: "responses",
      modelCode: "qa",
      prompt: "qa",
      requestId: "qa",
      timeoutMs: 1000,
      maxOutputTokens: 20,
    };
    let adapterBody;
    const adapter = new VolcengineArkAdapter(async (url, opts) => {
      adapterBody = JSON.parse(opts.body);
      eq(opts.redirect, "error");
      return new Response(
        JSON.stringify({
          output: [{ content: [{ text: "ok" }] }],
          usage: { input_tokens: 2, output_tokens: 1 },
        }),
        { status: 200 },
      );
    });
    eq((await adapter.invoke(request, "qa")).text, "ok");
    eq(adapterBody.input, "qa");
    await assert.rejects(
      () =>
        new VolcengineArkAdapter(
          async () =>
            new Response(
              JSON.stringify({
                choices: [{ message: { content: "ok" } }],
                usage: { input_tokens: 2 },
              }),
              { status: 200 },
            ),
        ).invoke(request, "qa"),
      /PROVIDER_USAGE_UNKNOWN/,
    );
    checks++;
    // Multi-model execution preserves skips and actual search-call accounting.
    const second = await req("/models", "POST", {
      ...modelBody,
      name: "测试联网模型",
      code: "qa-web",
      nativeWebSearch: true,
      searchPriceMicros: 500,
    });
    const multi = await submit({
      questionIds: [question.id, webQuestion.id],
      modelIds: [model.id, second.id],
    });
    for (let i = 0; i < 8; i++) {
      const row = await req("/analyses/" + multi.id);
      if (!["queued", "running"].includes(row.status)) break;
      await worker.tick();
    }
    const m = await req("/analyses/" + multi.id);
    eq(m.report.validSamples, 3);
    eq(m.report.modelBreakdown.length, 2);
    eq(m.actualCostMicros, 1340);
    // Updating a task cannot silently swap its original baseline.
    await req(
      `/projects/${project.id}/optimizations/${task.id}`,
      "PUT",
      {
        title: task.title,
        description: task.description,
        baselineId: changed.id,
        status: "open",
        version: task.version,
      },
      "admin",
      409,
    );
    const latestModels = await req("/models"),
      oldModel = latestModels.find((x) => x.id === model.id);
    await req("/models/" + model.id, "PUT", {
      ...modelBody,
      apiKey: undefined,
      code: "qa-new-revision",
      version: oldModel.version,
    });
    const frozen = await submit({ baselineId: b.id });
    eq(frozen.snapshot.models[0].versionId, b.snapshot.models[0].versionId);
    await worker.tick();
    eq((await req("/analyses/" + frozen.id)).comparison.comparable, false);
    // Two simultaneous submissions share an atomic daily budget reservation.
    const spending = await db.geoAnalysis.findMany({
        where: { tenantId: f.tenant.id },
      }),
      spent = spending.reduce(
        (n, j) => n + (j.actualCostMicros ?? j.estimatedCostMicros),
        0,
      );
    const ee = await req(`/projects/${project.id}/estimate`, "POST", one),
      settingsNow = await req("/settings");
    await req("/settings", "PUT", {
      dailyBudgetMicros: spent + ee.estimatedCostMicros,
      version: settingsNow.version,
    });
    const context = await ctx(),
      race = await Promise.allSettled(
        [1, 2].map(() =>
          g.submit(context, project.id, {
            ...one,
            requestKey: randomUUID(),
            estimateHash: ee.estimateHash,
          }),
        ),
      );
    eq(race.filter((x) => x.status === "fulfilled").length, 1);
    eq(race.filter((x) => x.status === "rejected").length, 1);
    await worker.tick();
    const budgetNow = await req("/settings");
    await req("/settings", "PUT", {
      dailyBudgetMicros: 20000000,
      version: budgetNow.version,
    });
    const batch = Array.from({ length: 5 }, (_, index) => ({
      text: `家用场景 ${index + 1} 推荐哪些品牌？`,
      category: "品类推荐",
    }));
    eq(
      await req(`/projects/${project.id}/questions/batch`, "POST", [
        ...batch,
        batch[0],
      ]),
      { added: 5, duplicates: 1 },
    );
    eq(await req(`/projects/${project.id}/questions/batch`, "POST", batch), {
      added: 0,
      duplicates: 5,
    });
    const allQuestions = await req(`/projects/${project.id}/questions`);
    const prepared = {
      questionIds: allQuestions
        .filter((item) => item.category === "品类推荐")
        .map((item) => item.id),
      modelIds: [
        model.id,
        ...(await Promise.all(
          [1, 2, 3].map(
            async (n) =>
              (
                await req("/models", "POST", {
                  ...modelBody,
                  name: `回归模型${n}`,
                  code: `qa-compare-${n}`,
                })
              ).id,
          ),
        )),
      ],
    };
    const plan = await req(
      `/projects/${project.id}/schedules/preview`,
      "POST",
      {
        ...one,
        name: "周监测预览",
        frequency: "weekly",
        hour: 9,
        minute: 0,
        weekday: 1,
        active: false,
      },
    );
    eq(plan.eligibleRuns, 1);
    ok(new Date(plan.nextRunAt).getTime() > Date.now());
    const fullBase = await submit(prepared);
    for (let i = 0; i < 20; i++) await worker.tick();
    const full = await req("/analyses/" + fullBase.id);
    eq(full.report.validSamples, 20);
    eq(full.report.score.diagnosticOnly, false);
    responseText = "1. 推荐竞品甲，适合这个预算。\n2. 另一个品牌也可以比较。";
    const fullRetest = await submit({ ...prepared, baselineId: full.id });
    for (let i = 0; i < 20; i++) await worker.tick();
    const compared = await req("/analyses/" + fullRetest.id);
    eq(compared.comparison.comparable, true);
    ok(compared.comparison.delta < 0);
    eq(compared.report.opportunities.length, 5);
    eq(compared.report.opportunities[0].count, 4);
    const readout = await ai.execute(adminMetadata, "geo.inspect_analysis", {
      id: compared.id,
    });
    eq(readout.opportunityEvidence.length, 5);
    eq(readout.opportunityEvidence[0].runId, compared.report.opportunities[0].runId);
    eq(readout.opportunityEvidence[0].excerpt, "1. 推荐竞品甲，适合这个预算。");
    eq(readout.retestConditions.questionCount, 5);
    eq(readout.retestConditions.models.length, 4);
    const { AiService } = require("../dist/modules/ai/ai.service");
    const { AgentExecutionService } = require("../dist/modules/ai/agent.runtime");
    const aiService = app.get(AiService);
    const runtime = app.get(AgentExecutionService);
    const originalExecute = runtime.execute;
    const originalAiEnabled = process.env.NATIVE_AI_MODEL_ENABLED;
    let runtimeCalls = 0;
    try {
      process.env.NATIVE_AI_MODEL_ENABLED = "true";
      runtime.execute = async (_context, messages, tools) => {
        runtimeCalls++;
        ok(tools.every((tool) => ["geo.list_projects", "geo.inspect_analysis"].includes(tool.id)));
        if (runtimeCalls === 1) {
          ok(messages[0].content.includes("GEO 品牌分析官"));
          return {
            text: "",
            toolRequests: [{
              toolId: "geo.inspect_analysis",
              callId: "geo-test-read-report",
              input: { id: compared.id },
            }],
          };
        }
        ok(JSON.stringify(messages).includes("推荐竞品甲，适合这个预算"));
        return { text: "样本中出现了竞品甲，请核对报告中的原回答。", toolRequests: [] };
      };
      const chat = await aiService.create(adminMetadata, {
        title: "解读报告",
        resource: { type: "analysis", id: compared.id },
      });
      const reply = await aiService.send(adminMetadata, chat.id, {
        content: "核对报告里的竞品缺席证据",
        version: chat.version,
        thinkingMode: "deep",
        useMemory: false,
      });
      eq(reply.failed, false);
      eq(runtimeCalls, 2);
      ok(reply.message.sources.some((source) => source.appId === "geo" && source.id === compared.id));
      eq((await aiService.get(adminMetadata, chat.id)).messages.at(-1).content, reply.message.content);
    } finally {
      runtime.execute = originalExecute;
      if (originalAiEnabled === undefined) delete process.env.NATIVE_AI_MODEL_ENABLED;
      else process.env.NATIVE_AI_MODEL_ENABLED = originalAiEnabled;
    }
    // Revoking a member hides their already-existing GEO notification.
    await req("/members", "PUT", {
      membershipId: f.accounts.buyer.memberId,
      role: "viewer",
      version: 2,
    });
    const notice = await db.personalNotification.create({
      data: {
        tenantId: f.tenant.id,
        recipientMembershipId: f.accounts.buyer.memberId,
        appId: "geo",
        kind: "geo-analysis",
        resourceId: b.id,
        dedupeKey: "geo-qa-revoke",
        title: "GEO QA",
        body: "controlled",
      },
    });
    const feed = async () =>
      (
        await h.request(
          `/tenants/${f.tenant.slug}/notifications`,
          "GET",
          undefined,
          "buyer",
        )
      ).data;
    ok((await feed()).items.some((n) => n.appId === "geo"));
    await req("/members", "PUT", {
      membershipId: f.accounts.buyer.memberId,
      role: "none",
      version: 3,
    });
    eq(
      (await feed()).items.some((n) => n.appId === "geo"),
      false,
    );
    await h.request(
      `/tenants/${f.tenant.slug}/notifications/platform.${notice.id}/read`,
      "POST",
      {},
      "buyer",
      404,
    );
    const report = {
      date: "2026-11-07",
      checks,
      httpChecks: h.checks(),
      calls,
      realModelCalls: 0,
      tenant: f.tenant.slug,
      projectId: project.id,
      baselineId: b.id,
      source: "isolated local database and controlled provider",
      passed: true,
    };
    fs.writeFileSync(
      process.env.GEO_QA_RESULTS ??
        "../../artifacts/geo-native-2026-11-07/api-results.json",
      JSON.stringify(report, null, 2),
    );
    fs.writeFileSync(
      process.env.GEO_QA_FIXTURE ?? "../../var/geo-native-browser-fixture.json",
      JSON.stringify(
        {
          fixture: f,
          cookies: h.cookies,
          projectId: project.id,
          baselineId: b.id,
          appBase: base,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        checks,
        controlledCalls: calls,
        realModelCalls: 0,
        passed: true,
      }),
    );
  } finally {
    if (app) await app.close();
    else if (db) await db.$disconnect();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
