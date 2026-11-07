const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { createApp } = require("../dist/server");
const { PrismaService } = require("../dist/modules/prisma.service");
const { AuthService } = require("../dist/modules/platform/auth.service");
const { ContentService } = require("../dist/modules/content/content.service");
const {
  ContentAiProvider,
} = require("../dist/modules/content/content-ai.provider");
const {
  SeedreamProvider,
} = require("../dist/modules/content/seedream.provider");
const { hash } = require("../dist/modules/content/content.rules");
const { putFile } = require("../dist/modules/content/content-storage");
const {
  createFixture,
  fixtureHttp,
  cleanupFixture,
} = require("../scripts/workflow-fixture.cjs");
if (
  !/@127\.0\.0\.1:54329\/suite_phase1_qa$/.test(process.env.DATABASE_URL || "")
)
  throw Error("Isolated QA required");
let checks = 0,
  imageCalls = 0;
const eq = (actual, expected) => {
  assert.deepEqual(actual, expected);
  checks++;
};
const ok = (value) => {
  assert.ok(value);
  checks++;
};
const key = () => randomUUID();
(async () => {
  const db = new PrismaService();
  let app, f;
  try {
    app = await createApp();
    f = await createFixture(
      db,
      "erp-flow-test-content-daily-" + key().slice(0, 7),
    );
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
    const h = await fixtureHttp(app, f),
      service = app.get(ContentService),
      ai = app.get(ContentAiProvider),
      provider = app.get(SeedreamProvider);
    const base = "/tenants/" + f.tenant.slug + "/apps/content";
    const req = async (
      path,
      method = "GET",
      body,
      actor = "admin",
      expected = method === "POST" ? 201 : 200,
    ) => (await h.request(base + path, method, body, actor, expected)).data;
    const ctx = async (actor = "admin") =>
      app.get(AuthService).taskContext({
        tenantId: f.tenant.id,
        userId: f.accounts[actor].userId,
        membershipId: f.accounts[actor].memberId,
        appId: "content",
        taskId: key(),
      });
    const image = spawnSync(
      "python3",
      [
        "-c",
        "from PIL import Image;import io,base64;b=io.BytesIO();Image.new('RGBA',(120,160),'#20ae80').save(b,format='PNG');print(base64.b64encode(b.getvalue()).decode())",
      ],
      { encoding: "utf8" },
    ).stdout.trim();
    provider.configured = () => true;
    provider.generate = async () => {
      imageCalls++;
      return {
        image,
        externalId: "fake-daily-" + imageCalls,
        usage: { generated_images: 1 },
        model: provider.model(),
      };
    };
    for (const [actor, role] of [
      ["sales", "creator"],
      ["reviewer", "reviewer"],
      ["buyer", "viewer"],
    ])
      await req("/members", "PUT", {
        membershipId: f.accounts[actor].memberId,
        role,
      });
    const asset = await req("/assets", "POST", {
      filename: "sample.png",
      data: image,
      shared: true,
    });
    const brand = await req("/documents/brand", "POST", {
      name: "日常验收品牌",
      data: { forbiddenWords: ["绝对治愈"], color: "#52624d" },
    });
    await req("/document/" + brand.id + "/publish", "POST", { version: 1 });
    const product = await req("/documents/product", "POST", {
      name: "日常产品",
      data: {
        imageId: asset.id,
        sellingPoints: "轻便随行",
        parameters: "型号 QA100",
        price: "299元",
        validUntil: "11月15日",
        disclaimer: "以实际商品为准",
      },
    });
    const p = await req("/projects", "POST", {
      name: "日常创作",
      visibility: "tenant",
      brief: {
        brandId: brand.id,
        brandVersion: 1,
        productIds: [product.id],
        productVersions: { [product.id]: 1 },
        prompt: "浅色背景",
        sizes: ["square", "portrait", "story"],
        title: "自然随行",
        cta: "了解更多",
      },
    });
    const art = await req("/projects/" + p.id + "/artifacts", "POST", {
      name: "首张图",
      size: "square",
      productId: product.id,
    });
    const endpoint = "/artifacts/" + art.id;
    eq((await req(endpoint + "/draft", "GET", undefined, "sales")).draft, null);
    await req(endpoint + "/draft", "GET", undefined, "buyer", 403);
    checks++;
    const edited = structuredClone(art.data);
    edited.layers.find((l) => l.role === "title").text = "带着自然出发";
    edited.layers.find((l) => l.role === "price").text = "279元";
    edited.copy.title = "不应进入交付的旧标题";
    edited.copy.body = "故意与画面不一致";
    let input = {
      baseVersion: 1,
      projectVersion: 1,
      revision: 0,
      requestKey: key(),
      data: edited,
    };
    let draft = await req(endpoint + "/draft", "PUT", input, "sales");
    eq(draft.revision, 1);
    eq(draft.data.copy.title, "带着自然出发");
    ok(draft.data.copy.body.includes("279元"));
    ok(!draft.data.copy.body.includes("故意"));
    eq((await req(endpoint + "/draft", "PUT", input, "sales")).id, draft.id);
    await req(
      endpoint + "/draft",
      "PUT",
      { ...input, data: art.data },
      "sales",
      409,
    );
    checks++;
    eq((await req(endpoint + "/draft")).draft, null);
    eq(
      (await db.contentArtifact.findUnique({ where: { id: art.id } })).version,
      1,
    );
    const locked = structuredClone(draft.data);
    locked.layers.find((l) => l.role === "product").x = 0.5;
    await req(
      endpoint + "/draft",
      "PUT",
      { ...input, requestKey: key(), revision: 1, data: locked },
      "sales",
      403,
    );
    checks++;
    const forbidden = structuredClone(draft.data);
    forbidden.layers[0].text = "绝对治愈";
    await req(
      endpoint + "/draft",
      "PUT",
      { ...input, requestKey: key(), revision: 1, data: forbidden },
      "sales",
      400,
    );
    checks++;
    const forged = structuredClone(draft.data);
    forged.source.productId = key();
    await req(
      endpoint + "/draft",
      "PUT",
      { ...input, requestKey: key(), revision: 1, data: forged },
      "sales",
      400,
    );
    checks++;
    const sales = await ctx("sales");
    const raced = await Promise.allSettled(
      [0, 1].map((i) => {
        const data = structuredClone(draft.data);
        data.layers[0].text = "并发编辑" + i;
        return service.editing.saveDraft(sales, art.id, {
          ...input,
          revision: 1,
          requestKey: key(),
          data,
        });
      }),
    );
    eq(raced.filter((x) => x.status === "fulfilled").length, 1);
    eq(
      raced.filter(
        (x) => x.status === "rejected" && x.reason.getStatus() === 409,
      ).length,
      1,
    );
    draft = (await req(endpoint + "/draft", "GET", undefined, "sales")).draft;
    const ccopy = await service.editing.copyContext(sales, art.id);
    const suggestion = {
      artifactId: art.id,
      baseVersion: 1,
      projectVersion: 1,
      snapshotHash: ccopy.snapshotHash,
      requestKey: key(),
      candidates: [
        { label: "简洁标题", changes: { title: "轻装出发，自然随行" } },
        { label: "行动语", changes: { cta: "发现自然" } },
      ],
    };
    const preview = await ai.preview(sales, "content.stage_copy", suggestion);
    eq(preview.candidates.length, 2);
    eq(
      await db.contentCopySuggestion.count({
        where: { tenantId: f.tenant.id },
      }),
      0,
    );
    const savedSuggestion = await ai.execute(
      sales,
      "content.stage_copy",
      suggestion,
    );
    eq(
      (await service.editing.stageCopy(sales, suggestion)).id,
      savedSuggestion.id,
    );
    eq(
      (await req(endpoint + "/copy-suggestions", "GET", undefined, "sales"))
        .length,
      1,
    );
    eq((await req(endpoint + "/copy-suggestions")).length, 0);
    const changed = {
      ...suggestion,
      requestKey: key(),
      candidates: [{ label: "捏造价格", changes: { title: "只要999999元" } }],
    };
    await assert.rejects(
      () => service.editing.stageCopy(sales, changed),
      (e) => e.getStatus() === 400,
    );
    checks++;
    await assert.rejects(
      () =>
        service.editing.stageCopy(sales, {
          ...suggestion,
          requestKey: key(),
          candidates: [{ label: "丢规格", changes: { body: "轻便好看" } }],
        }),
      (e) => e.getStatus() === 400,
    );
    checks++;
    draft = await req(
      endpoint + "/adopt-copy",
      "POST",
      {
        suggestionId: savedSuggestion.id,
        candidate: 0,
        revision: draft.revision,
        requestKey: key(),
      },
      "sales",
    );
    eq(draft.data.copy.title, "轻装出发，自然随行");
    eq(draft.data.layers.find((l) => l.role === "price").text, "279元");
    eq(imageCalls, 0);
    await req(
      endpoint + "/adopt-copy",
      "POST",
      {
        suggestionId: savedSuggestion.id,
        candidate: 1,
        revision: draft.revision,
        requestKey: key(),
      },
      "sales",
      409,
    );
    checks++;
    const v2 = await req(endpoint, "PUT", { version: 1, data: art.data });
    eq(v2.version, 2);
    const conflict = await req(endpoint + "/draft", "GET", undefined, "sales");
    eq(conflict.conflict, true);
    eq(conflict.draft.id, draft.id);
    await req(
      endpoint + "/draft",
      "PUT",
      {
        baseVersion: 1,
        projectVersion: 1,
        revision: draft.revision,
        requestKey: key(),
        data: draft.data,
      },
      "sales",
      409,
    );
    checks++;
    draft = await req(
      endpoint + "/draft/rebase",
      "POST",
      {
        revision: draft.revision,
        targetVersion: 2,
        projectVersion: 1,
        targetHash: hash(v2.data),
        requestKey: key(),
        changes: [
          { layerId: "title", changes: { text: draft.data.copy.title } },
        ],
      },
      "sales",
    );
    eq(draft.baseVersion, 2);
    eq(draft.data.layers.find((l) => l.role === "price").text, "299元");
    eq(draft.data.copy.title, "轻装出发，自然随行");
    await req(
      endpoint,
      "PUT",
      {
        version: 2,
        projectVersion: 1,
        draftRevision: draft.revision - 1,
        data: draft.data,
      },
      "sales",
      409,
    );
    checks++;
    const v3 = await req(
      endpoint,
      "PUT",
      {
        version: 2,
        projectVersion: 1,
        draftRevision: draft.revision,
        data: draft.data,
      },
      "sales",
    );
    eq(v3.version, 3);
    eq(v3.status, "draft");
    eq((await req(endpoint + "/draft", "GET", undefined, "sales")).draft, null);
    const layout = await req(endpoint + "/layout", "POST", { data: v3.data });
    eq(layout.issues, []);
    ok(
      layout.layers.every((l) => l.image.startsWith("data:image/png;base64,")),
    );
    const long = structuredClone(v3.data);
    long.layers[0].text = "长标题".repeat(200);
    const overflow = await req(endpoint + "/layout", "POST", { data: long });
    ok(overflow.issues.some((x) => x.code === "text_overflow"));
    const longVersion = await req(endpoint, "PUT", { version: 3, data: long });
    const badExport = await req("/projects/" + p.id + "/exports", "POST", {
      requestKey: key(),
      items: [{ artifactId: art.id, version: 4 }],
      draft: true,
    });
    eq(badExport.status, "queued");
    await service.delivery.tick();
    eq(
      (await db.contentExport.findUnique({ where: { id: badExport.id } }))
        .errorCode,
      "layout_overflow",
    );
    const exportedInput = {
      requestKey: key(),
      items: [{ artifactId: art.id, version: 3 }],
      draft: true,
      format: "png",
    };
    const pairedExports = await Promise.all(
      [0, 1].map(() =>
        req("/projects/" + p.id + "/exports", "POST", exportedInput),
      ),
    );
    const job = pairedExports[0];
    eq(pairedExports[1].id, job.id);
    eq(job.status, "queued");
    eq(
      (await req("/projects/" + p.id + "/exports", "POST", exportedInput)).id,
      job.id,
    );
    await req(
      "/projects/" + p.id + "/exports",
      "POST",
      { ...exportedInput, format: "jpeg" },
      "admin",
      409,
    );
    checks++;
    await Promise.all([service.delivery.tick(), service.delivery.tick()]);
    eq(
      (await db.contentExport.findUnique({ where: { id: job.id } })).status,
      "ready",
    );
    ok((await service.download(await ctx(), job.id)).length > 100);
    eq(
      await db.personalNotification.count({
        where: { tenantId: f.tenant.id, dedupeKey: "content-export:" + job.id },
      }),
      1,
    );
    await db.contentExport.update({
      where: { id: job.id },
      data: { status: "expired", expiresAt: new Date(0) },
    });
    eq((await req("/exports/" + job.id + "/retry", "POST")).status, "queued");
    await db.contentExport.update({
      where: { id: job.id },
      data: { status: "preparing", lease: key(), heartbeatAt: new Date(0) },
    });
    await service.delivery.tick();
    eq(
      (await db.contentExport.findUnique({ where: { id: job.id } })).status,
      "ready",
    );
    eq(imageCalls, 0);
    // Viewer cannot inspect unpublished revisions through direct lookup or a paged version selector.
    await req(endpoint + "/versions/3", "GET", undefined, "buyer", 404);
    checks++;
    eq(
      (await req(endpoint + "/versions?page=1", "GET", undefined, "buyer"))
        .total,
      0,
    );
    // Persistent tables can exceed the former hard caps without paid generation.
    const extraArts = Array.from({ length: 205 }, (_, i) => ({
      id: key(),
      tenantId: f.tenant.id,
      projectId: p.id,
      name: "容量样本" + i,
      version: 1,
    }));
    await db.contentArtifact.createMany({ data: extraArts });
    await db.contentArtifactVersion.createMany({
      data: extraArts.map((a) => ({
        tenantId: f.tenant.id,
        artifactId: a.id,
        version: 1,
        data: art.data,
        createdBy: f.accounts.admin.memberId,
      })),
    });
    const page11 = await req("/projects/" + p.id + "/artifacts?page=11");
    eq(page11.total, 206);
    eq(page11.items.length, 6);
    const extraVersions = Array.from({ length: 25 }, (_, i) => ({
      tenantId: f.tenant.id,
      artifactId: art.id,
      version: i + 5,
      data: art.data,
      createdBy: f.accounts.admin.memberId,
    }));
    await db.contentArtifactVersion.createMany({ data: extraVersions });
    await db.contentArtifact.update({
      where: { id: art.id },
      data: { version: 29 },
    });
    const versionPage = await req(endpoint + "/versions?page=2");
    eq(versionPage.total, 29);
    eq(versionPage.items.length, 9);
    eq(versionPage.items[8].version, 1);
    const extraBatches = Array.from({ length: 105 }, () => ({
      id: key(),
      tenantId: f.tenant.id,
      projectId: p.id,
      membershipId: f.accounts.admin.memberId,
      userId: f.accounts.admin.userId,
      requestKey: key(),
      fingerprint: "fake",
      snapshot: {},
    }));
    await db.contentBatch.createMany({ data: extraBatches });
    eq((await req("/projects/" + p.id + "/batches?page=6")).items.length, 5);
    await db.contentExport.createMany({
      data: Array.from({ length: 105 }, () => ({
        tenantId: f.tenant.id,
        projectId: p.id,
        membershipId: f.accounts.admin.memberId,
        requestKey: key(),
        fingerprint: "fake",
        status: "failed",
        manifest: {},
        expiresAt: new Date(0),
      })),
    });
    eq((await req("/projects/" + p.id + "/exports?page=6")).total, 107);
    await db.usageRecord.createMany({
      data: Array.from({ length: 105 }, () => ({
        tenantId: f.tenant.id,
        appId: "content",
        membershipId: f.accounts.admin.memberId,
        metric: "content.image",
        requestKey: key(),
        quantity: 0,
        status: "released",
      })),
    });
    eq((await req("/usage?page=6")).total, 105);
    eq((await req("/usage?page=6")).items.length, 5);
    const projects = Array.from({ length: 1005 }, (_, i) => ({
      id: key(),
      tenantId: f.tenant.id,
      name: "审核范围" + i,
      ownerId: f.accounts.admin.memberId,
      visibility: "tenant",
      participants: [],
      brief: p.brief,
    }));
    await db.contentProject.createMany({ data: projects });
    await db.contentProject.createMany({
      data: Array.from({ length: 105 }, (_, i) => ({
        id: key(),
        tenantId: f.tenant.id,
        name: "已删除项目" + i,
        ownerId: f.accounts.admin.memberId,
        participants: [],
        brief: p.brief,
        deletedAt: new Date(),
      })),
    });
    const trashPage = await req("/trash?page=6");
    eq(trashPage.total, 105);
    eq(trashPage.items.length, 5);
    const last = await db.contentArtifact.create({
      data: {
        tenantId: f.tenant.id,
        projectId: projects[1004].id,
        name: "旧上限以外的待审作品",
      },
    });
    await db.contentArtifactVersion.create({
      data: {
        tenantId: f.tenant.id,
        artifactId: last.id,
        version: 1,
        data: art.data,
        status: "submitted",
        createdBy: f.accounts.admin.memberId,
        submittedBy: f.accounts.admin.memberId,
      },
    });
    eq((await req("/reviews", "GET", undefined, "reviewer")).total, 1);
    const plan = await service.plan(await ctx(), p.id, { projectVersion: 1 });
    ok(plan.bindingVersion.length === 64);
    const batch = await service.submit(await ctx(), p.id, {
      request: plan.request,
      previewHash: plan.previewHash,
      expiresAt: plan.expiresAt,
      requestKey: key(),
    });
    process.env.CONTENT_MEDIA_CONFIG_VERSION = "test-changed";
    await service.tick();
    const item = await db.contentGenerationItem.findFirst({
      where: { batchId: batch.id },
    });
    eq(item.status, "failed");
    eq(item.errorCode, "CONTENT_MODEL_BINDING_CHANGED");
    eq(imageCalls, 0);
    delete process.env.CONTENT_MEDIA_CONFIG_VERSION;
    const recoverPlan = await service.plan(await ctx(), p.id, {
      projectVersion: 1,
    });
    const recoverBatch = await service.submit(await ctx(), p.id, {
      request: recoverPlan.request,
      previewHash: recoverPlan.previewHash,
      expiresAt: recoverPlan.expiresAt,
      requestKey: key(),
    });
    const recoverItem = await db.contentGenerationItem.findFirst({
      where: { batchId: recoverBatch.id },
    });
    const attempt = await db.contentProviderAttempt.create({
      data: {
        tenantId: f.tenant.id,
        itemId: recoverItem.id,
        model: recoverPlan.model,
        status: "received",
        usage: { generated_images: 1 },
      },
    });
    await putFile(f.tenant.id, attempt.id, Buffer.from(image, "base64"));
    await db.contentGenerationItem.update({
      where: { id: recoverItem.id },
      data: { status: "needs_reconciliation", heartbeatAt: new Date(0) },
    });
    process.env.CONTENT_MEDIA_CONFIG_VERSION = "changed-after-response";
    await service.recoverItem(await ctx(), recoverItem.id);
    await service.tick();
    eq(
      (
        await db.contentGenerationItem.findUnique({
          where: { id: recoverItem.id },
        })
      ).status,
      "succeeded",
    );
    const recoveredUsage = await db.usageRecord.findFirst({
      where: {
        tenantId: f.tenant.id,
        requestKey: recoverItem.id,
        metric: "content.image",
      },
    });
    eq(recoveredUsage.status, "usage_reported_cost_pending");
    eq(String(recoveredUsage.quantity), "1");
    eq(imageCalls, 0);
    delete process.env.CONTENT_MEDIA_CONFIG_VERSION;
    // Downloads also revalidate asset access, not only the project and approval.
    const owner = await ctx("sales");
    const sharedExport = await service.createExport(owner, p.id, {
      requestKey: key(),
      items: [{ artifactId: art.id, version: 3 }],
      draft: true,
    });
    await service.delivery.tick();
    await db.contentAsset.update({
      where: { id: asset.id },
      data: { shared: false },
    });
    await assert.rejects(
      () => service.download(owner, sharedExport.id),
      (e) => e.getStatus() === 404 || e.getStatus() === 403,
    );
    checks++;
    await db.contentGrant.deleteMany({
      where: { tenantId: f.tenant.id, membershipId: f.accounts.sales.memberId },
    });
    await req(endpoint + "/draft", "GET", undefined, "sales", 403);
    checks++;
    console.log(
      JSON.stringify({
        ok: true,
        checks,
        simulatedImageCalls: imageCalls,
        paidCalls: 0,
        capacities: {
          artworks: 206,
          versions: 29,
          projects: 1006,
          batches: 106,
          exports: 108,
          usage: 106,
        },
      }),
    );
  } finally {
    delete process.env.CONTENT_MEDIA_CONFIG_VERSION;
    if (f) {
      await cleanupFixture(db, f);
      require("node:fs").rmSync(
        require("node:path").join(
          process.env.CONTENT_STORAGE_PATH,
          f.tenant.id,
        ),
        { recursive: true, force: true },
      );
    }
    if (app) await app.close();
    await db.$disconnect();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
