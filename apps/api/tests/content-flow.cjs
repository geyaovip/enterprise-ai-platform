const assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto"),
  fs = require("node:fs"),
  { spawnSync } = require("node:child_process");
const { createApp } = require("../dist/server"),
  { PrismaService } = require("../dist/modules/prisma.service"),
  { AuthService } = require("../dist/modules/platform/auth.service");
const { ContentService } = require("../dist/modules/content/content.service"),
  {
    SeedreamProvider,
    MediaError,
  } = require("../dist/modules/content/seedream.provider");
const {
  createFixture,
  fixtureHttp,
  cleanupFixture,
} = require("../scripts/workflow-fixture.cjs");
const {
  mediaOperation,
  getFile,
} = require("../dist/modules/content/content-storage");
const k = () => randomUUID();
let checks = 0,
  calls = 0;
const eq = (a, b) => {
    assert.deepEqual(a, b);
    checks++;
  },
  ok = (x) => {
    assert.ok(x);
    checks++;
  };
if (
  !/@127\.0\.0\.1:54329\/suite_phase1_qa$/.test(process.env.DATABASE_URL || "")
)
  throw Error("Isolated QA database required");
(async () => {
  const db = new PrismaService();
  let app, f, foreign;
  try {
    const image = spawnSync(
      "python3",
      [
        "-c",
        "from PIL import Image; import io,base64; x=Image.new('RGBA',(120,160),'#20ae80'); b=io.BytesIO(); x.save(b,format='PNG'); print(base64.b64encode(b.getvalue()).decode())",
      ],
      { encoding: "utf8" },
    ).stdout.trim();
    app = await createApp();
    const service = app.get(ContentService),
      provider = app.get(SeedreamProvider);
    provider.configured = () => true;
    let nextError = null;
    provider.generate = async () => {
      calls++;
      if (nextError) {
        const e = nextError;
        nextError = null;
        throw e;
      }
      return {
        image,
        externalId: "stub-" + calls,
        usage: { generated_images: 1 },
        model: provider.model(),
      };
    };
    f = await createFixture(db, "erp-flow-test-content-" + k().slice(0, 8));
    await db.tenantApp.deleteMany({ where: { tenantId: f.tenant.id } });
    await db.tenantApp.create({
      data: { tenantId: f.tenant.id, appId: "content" },
    });
    await db.tenantCapability.create({
      data: {
        tenantId: f.tenant.id,
        capability: "ai",
        delivered: true,
        enabled: true,
      },
    });
    foreign = await db.tenant.create({
      data: {
        slug: "erp-flow-test-content-foreign-" + k().slice(0, 8),
        name: "foreign content QA",
      },
    });
    const h = await fixtureHttp(app, f),
      base = `/tenants/${f.tenant.slug}/apps/content`,
      req = async (
        path,
        method = "GET",
        body,
        actor = "admin",
        expected = method === "POST" ? 201 : 200,
      ) => (await h.request(base + path, method, body, actor, expected)).data;
    const context = async (actor = "admin") =>
      app.get(AuthService).taskContext({
        tenantId: f.tenant.id,
        userId: f.accounts[actor].userId,
        membershipId: f.accounts[actor].memberId,
        appId: "content",
        taskId: k(),
      });
    const catalog = await h.request(`/tenants/${f.tenant.slug}/applications`);
    ok(
      catalog.data.some(
        (x) =>
          x.appId === "content" && x.permissions.includes("content.create"),
      ),
    );
    eq((await req("/metadata")).model.configured, true);
    await req("/projects", "GET", undefined, "sales", 403);
    checks++;
    for (const [actor, role] of [
      ["sales", "creator"],
      ["reviewer", "reviewer"],
      ["buyer", "viewer"],
    ])
      await req("/members", "PUT", {
        membershipId: f.accounts[actor].memberId,
        role,
      });
    const shared = await req("/assets", "POST", {
      filename: "product.png",
      data: image,
      shared: true,
    });
    ok(shared.width === 120 && shared.height === 160);
    await req(
      "/assets",
      "POST",
      {
        filename: "bad.svg",
        data: Buffer.from("<svg/>").toString("base64"),
        shared: true,
      },
      "admin",
      400,
    );
    checks++;
    const brand = await req("/documents/brand", "POST", {
      name: "QA品牌",
      data: {
        logoId: shared.id,
        color: "#6954d9",
        tone: "自然简洁",
        forbiddenWords: ["绝对治愈"],
      },
    });
    await req("/document/" + brand.id + "/publish", "POST", { version: 1 });
    const product = await req("/documents/product", "POST", {
      name: "测试产品",
      data: {
        imageId: shared.id,
        sellingPoints: "轻便耐用",
        parameters: "型号 QA100",
        price: "299元",
        validUntil: "11月15日",
        disclaimer: "以实际商品为准",
      },
    });
    const brief = {
      brandId: brand.id,
      brandVersion: 1,
      productIds: [product.id],
      productVersions: { [product.id]: 1 },
      prompt: "自然柔和的新品背景",
      sizes: ["square", "portrait", "story"],
    };
    const p = await req("/projects", "POST", {
      name: "新品推广",
      participants: [
        f.accounts.sales.memberId,
        f.accounts.reviewer.memberId,
        f.accounts.buyer.memberId,
      ],
      brief,
    });
    // Published brand revisions remain usable by projects after a new publication.
    await req("/documents/brand/" + brand.id, "PUT", {
      version: 1,
      name: "QA品牌新版",
      data: {
        logoId: shared.id,
        color: "#52624d",
        tone: "更柔和",
        forbiddenWords: ["绝对治愈"],
      },
    });
    await req("/document/" + brand.id + "/publish", "POST", { version: 2 });
    eq((await req("/document/" + brand.id + "?version=1")).version, 1);
    ok((await req("/document/" + brand.id + "?version=1")).publishedAt);
    const art = await req("/projects/" + p.id + "/artifacts", "POST", {
      name: "手工版式",
      productId: product.id,
      size: "square",
    });
    eq(art.data.layers.find((l) => l.role === "price").text, "299元");
    eq((await req("/document/" + brand.id + "?version=1")).name, "QA品牌");
    const lockedEdit = structuredClone(art.data);
    lockedEdit.layers.find((l) => l.role === "product").x = 0.5;
    await req(
      "/artifacts/" + art.id,
      "PUT",
      { version: 1, data: lockedEdit },
      "sales",
      403,
    );
    checks++;
    const dup = structuredClone(art.data);
    dup.layers[1].id = dup.layers[0].id;
    await req(
      "/artifacts/" + art.id,
      "PUT",
      { version: 1, data: dup },
      "admin",
      400,
    );
    checks++;
    const template = await req("/documents/template", "POST", {
      name: "企业版式",
      data: {
        layout: art.data.layers.map(
          ({ role, x, y, w, h, fontSize, color, locked }) => ({
            role,
            x,
            y,
            w,
            h,
            fontSize,
            color,
            locked,
          }),
        ),
      },
    });
    const templateProject = await req("/projects", "POST", {
      name: "企业模板复用",
      brief: { ...brief, templateId: template.id, templateVersion: 1 },
    });
    const templated = await req(
      "/projects/" + templateProject.id + "/artifacts",
      "POST",
      { name: "模板产物", productId: product.id, size: "square" },
    );
    eq(templated.data.source.templateId, template.id);
    eq(templated.data.source.templateVersion, 1);
    await req("/artifacts/" + art.id + "/review", "POST", {
      version: 1,
      action: "submit",
    });
    await req(
      "/artifacts/" + art.id + "/review",
      "POST",
      { version: 1, action: "approve" },
      "admin",
      403,
    );
    checks++;
    eq((await req("/reviews", "GET", undefined, "reviewer")).total, 1);
    await req(
      "/artifacts/" + art.id + "/review",
      "POST",
      { version: 1, action: "approve" },
      "reviewer",
    );
    let data = structuredClone(art.data);
    data.layers.find((l) => l.role === "price").text = "279元";
    await req("/artifacts/" + art.id, "PUT", { version: 1, data });
    await req(
      "/artifacts/" + art.id,
      "PUT",
      { version: 1, data },
      "admin",
      409,
    );
    checks++;
    let arts = await req("/projects/" + p.id + "/artifacts");
    eq(
      arts[0].versions.map((v) => v.status),
      ["draft", "approved"],
    );
    await req(
      "/projects/" + p.id + "/exports",
      "POST",
      { requestKey: k(), items: [{ artifactId: art.id, version: 2 }] },
      "admin",
      403,
    );
    checks++;
    const exp = await req("/projects/" + p.id + "/exports", "POST", {
      requestKey: k(),
      items: [{ artifactId: art.id, version: 1 }],
      format: "png",
    });
    eq(exp.status, "queued");
    await service.delivery.tick();
    eq(
      (await db.contentExport.findUnique({ where: { id: exp.id } })).status,
      "ready",
    );
    const zip = await service.download(await context(), exp.id);
    ok(zip.length > 100);
    const checkZip = spawnSync(
      "python3",
      [
        "-c",
        "import sys,io,zipfile,json;z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));m=json.loads(z.read('manifest.json'));assert m['items'][0]['status']=='approved';assert any(n.endswith('.png') for n in z.namelist());assert '299元' in z.read([n for n in z.namelist() if n.endswith('.txt')][0]).decode();print('ok')",
      ],
      { input: zip },
    );
    eq(checkZip.status, 0);
    const request = { projectVersion: 1, mode: "background" },
      plan = await req("/projects/" + p.id + "/preview", "POST", request),
      submission = {
        request,
        previewHash: plan.previewHash,
        expiresAt: plan.expiresAt,
        requestKey: k(),
      };
    ok(!/#[0-9a-f]{6}/i.test(plan.inputs[0].prompt));
    eq(plan.requests, 1);
    eq(plan.deliverables, 3);
    eq(calls, 0);
    const batch = await req(
      "/projects/" + p.id + "/batches",
      "POST",
      submission,
    );
    eq(
      (await req("/projects/" + p.id + "/batches", "POST", submission)).id,
      batch.id,
    );
    await req(
      "/projects/" + p.id + "/batches",
      "POST",
      { ...submission, request: { ...request, mode: "local_edit" } },
      "admin",
      409,
    );
    checks++;
    await Promise.all([service.tick(), service.tick()]);
    eq(calls, 1);
    let jobs = await req("/projects/" + p.id + "/batches"),
      item = jobs[0].items[0];
    eq(item.status, "succeeded");
    eq(item.usage.status, "usage_reported_cost_pending");
    eq(item.usage.cost, null);
    await req("/usage/" + item.usage.id, "PUT", {
      expectedUpdatedAt: item.usage.updatedAt,
      cost: "0.25",
      billReference: "synthetic-local-invoice",
      note: "仅为测试账单登记路径",
    });
    eq(
      (
        await db.usageRecord.findUnique({ where: { id: item.usage.id } })
      ).cost.toString(),
      "0.25",
    );
    await req(
      "/usage/" + item.usage.id,
      "PUT",
      {
        expectedUpdatedAt: item.usage.updatedAt,
        cost: "0.30",
        billReference: "synthetic-local-invoice",
        note: "旧版本应拒绝覆盖",
      },
      "admin",
      409,
    );
    checks++;

    arts = await req("/projects/" + p.id + "/artifacts");
    eq(arts.length, 4);
    const generated = arts.find((a) => a.id === item.artifactId);
    ok(generated.versions[0].data.backgroundId);
    const bg = generated.versions[0].data.backgroundId;
    // Viewer cannot retrieve private unapproved image or draft revisions.
    await req("/assets/" + bg + "/file", "GET", undefined, "buyer", 404);
    checks++;
    eq(
      (await req("/projects/" + p.id + "/artifacts", "GET", undefined, "buyer"))
        .length,
      1,
    );
    // Local patch changes only the selected background; no extra generation per output size.
    const editRequest = {
      projectVersion: 1,
      mode: "local_edit",
      artifactId: generated.id,
      artifactVersion: 1,
      instruction: "浅色织物",
      region: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
    };
    const lp = await req("/projects/" + p.id + "/preview", "POST", editRequest);
    await req("/projects/" + p.id + "/batches", "POST", {
      request: editRequest,
      previewHash: lp.previewHash,
      expiresAt: lp.expiresAt,
      requestKey: k(),
    });
    await service.tick();
    eq(calls, 2);
    const updated = (await req("/projects/" + p.id + "/artifacts")).find(
      (a) => a.id === generated.id,
    );
    eq(updated.version, 2);
    eq(updated.versions[0].status, "draft");
    const normalized = await mediaOperation({ op: "normalize", data: image });
    const patch = await mediaOperation({
      op: "composite",
      original: normalized.data,
      generated: normalized.data,
      region: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
    });
    eq(patch.width, 120);
    eq(patch.height, 160);
    const submit = async (actor = "admin") => {
      const pr = await req(
        "/projects/" + p.id + "/preview",
        "POST",
        request,
        actor,
      );
      const b = await req(
        "/projects/" + p.id + "/batches",
        "POST",
        {
          request,
          previewHash: pr.previewHash,
          expiresAt: pr.expiresAt,
          requestKey: k(),
        },
        actor,
      );
      return (await req("/projects/" + p.id + "/batches")).find(
        (x) => x.id === b.id,
      ).items[0];
    };
    const cancelled = await submit();
    await req("/items/" + cancelled.id + "/cancel", "POST", {});
    await service.tick();
    eq(calls, 2);
    eq(
      (
        await db.contentGenerationItem.findUnique({
          where: { id: cancelled.id },
        })
      ).status,
      "cancelled",
    );
    // Unknown response stops. Neither recovery nor retry creates a new paid request.
    const unknown = await submit();
    nextError = new MediaError("CONTENT_SUBMISSION_UNKNOWN");
    await service.tick();
    eq(calls, 3);
    eq(
      (await db.contentGenerationItem.findUnique({ where: { id: unknown.id } }))
        .status,
      "needs_reconciliation",
    );
    await req(
      "/items/" + unknown.id + "/retry",
      "POST",
      { requestKey: k() },
      "admin",
      409,
    );
    await req("/items/" + unknown.id + "/recover", "POST", {}, "admin", 409);
    await service.tick();
    eq(calls, 3);
    await req("/projects/" + p.id + "/preview", "POST", request, "admin", 409);
    checks++;
    await req("/items/" + unknown.id + "/reconcile", "POST", {
      outcome: "not_charged",
      cost: "0",
      billReference: "synthetic-qa-no-charge",
      note: "本地替身验证明确没有发出供应商请求",
    });
    // Explicit provider rejection can retry only that item; no successful batch replay.
    const failed = await submit();
    nextError = new MediaError("CONTENT_PROVIDER_HTTP_400", true);
    await service.tick();
    eq(
      (await db.contentGenerationItem.findUnique({ where: { id: failed.id } }))
        .status,
      "failed",
    );
    const retryKey = k(),
      rb = await req("/items/" + failed.id + "/retry", "POST", {
        requestKey: retryKey,
      });
    eq(
      (
        await req("/items/" + failed.id + "/retry", "POST", {
          requestKey: retryKey,
        })
      ).id,
      rb.id,
    );
    await service.tick();
    eq(calls, 5);
    // Reauthentication on worker prevents a revoked creator from causing a paid call.
    const revoked = await submit("sales");
    await req("/members", "PUT", {
      membershipId: f.accounts.sales.memberId,
      role: "viewer",
    });
    await service.tick();
    eq(calls, 5);
    eq(
      (await db.contentGenerationItem.findUnique({ where: { id: revoked.id } }))
        .status,
      "failed",
    );
    // Stale submitting work with an existing attempt and no result is never resubmitted.
    const stale = await submit();
    await db.contentProviderAttempt.create({
      data: {
        tenantId: f.tenant.id,
        itemId: stale.id,
        model: "stub",
        status: "submitting",
      },
    });
    await db.contentGenerationItem.update({
      where: { id: stale.id },
      data: { status: "submitting", lease: k(), heartbeatAt: new Date(0) },
    });
    await service.tick();
    eq(calls, 5);
    eq(
      (await db.contentGenerationItem.findUnique({ where: { id: stale.id } }))
        .status,
      "needs_reconciliation",
    );
    // Private project/source and cross-tenant IDs cannot be read.
    const foreignP = await db.contentProject.create({
      data: {
        tenantId: foreign.id,
        name: "foreign",
        ownerId: f.accounts.admin.memberId,
        participants: [],
        brief: {},
      },
    });
    await req("/projects/" + foreignP.id, "GET", undefined, "admin", 404);
    checks++;
    const privateP = await req("/projects", "POST", { name: "private", brief });
    await req("/projects/" + privateP.id, "GET", undefined, "buyer", 404);
    checks++;
    const pa = await req("/assets", "POST", {
      projectId: privateP.id,
      filename: "private.png",
      data: image,
    });
    await req("/assets/" + pa.id + "/file", "GET", undefined, "buyer", 404);
    checks++;
    await req(
      "/assets",
      "POST",
      { projectId: foreignP.id, filename: "foreign.png", data: image },
      "admin",
      404,
    );
    checks++;
    await req("/projects/" + p.id, "DELETE");
    await req("/projects/" + p.id, "GET", undefined, "reviewer", 404);
    checks++;
    await req("/projects/" + p.id + "/restore", "POST", {});
    eq((await req("/projects/" + p.id)).id, p.id);
    // Disabled app invalidates both API and downloads immediately.
    const oldContext = await context();
    await db.tenantApp.update({
      where: { tenantId_appId: { tenantId: f.tenant.id, appId: "content" } },
      data: { enabled: false },
    });
    await req("/projects", "GET", undefined, "admin", 403);
    checks++;
    await assert.rejects(() => service.download(oldContext, exp.id));
    checks++;
    console.log(
      JSON.stringify({
        ok: true,
        checks: checks + h.checks(),
        stubImageCalls: calls,
        realPaidCalls: 0,
        flow: "brand/product→project→layers→generate/multisize→edit→review→export",
        isolation: true,
        recovery: true,
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
        await db[table].deleteMany({
          where: {
            tenantId: { in: [f.tenant.id, ...(foreign ? [foreign.id] : [])] },
          },
        });
      await db.usageRecord.deleteMany({
        where: { tenantId: f.tenant.id, appId: "content" },
      });
      await cleanupFixture(db, f);
    }
    if (foreign) await db.tenant.delete({ where: { id: foreign.id } });
    if (app) await app.close();
    await db.$disconnect();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
