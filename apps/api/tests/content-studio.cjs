const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const { createApp } = require("../dist/server");
const { PrismaService } = require("../dist/modules/prisma.service");
const { AuthService } = require("../dist/modules/platform/auth.service");
const { ContentService } = require("../dist/modules/content/content.service");
const {
  SeedreamProvider,
} = require("../dist/modules/content/seedream.provider");
const {
  createFixture,
  fixtureHttp,
  cleanupFixture,
} = require("../scripts/workflow-fixture.cjs");
const { getFile } = require("../dist/modules/content/content-storage");
if (
  !/@127\.0\.0\.1:54329\/suite_phase1_qa$/.test(process.env.DATABASE_URL || "")
)
  throw Error("Isolated QA database required");
let checks = 0;
const eq = (a, b) => {
  assert.deepEqual(a, b);
  checks++;
};
(async () => {
  const db = new PrismaService();
  let app, fixture;
  try {
    app = await createApp();
    fixture = await createFixture(
      db,
      "erp-flow-test-content-studio-" + randomUUID().slice(0, 8),
    );
    await db.tenantApp.deleteMany({ where: { tenantId: fixture.tenant.id } });
    await db.tenantApp.create({
      data: { tenantId: fixture.tenant.id, appId: "content" },
    });
    await db.tenantCapability.create({
      data: {
        tenantId: fixture.tenant.id,
        capability: "ai",
        delivered: true,
        enabled: true,
      },
    });
    const s = app.get(ContentService),
      provider = app.get(SeedreamProvider),
      h = await fixtureHttp(app, fixture);
    const base = `/tenants/${fixture.tenant.slug}/apps/content`;
    const req = async (
      path,
      method = "GET",
      body,
      actor = "admin",
      expected = method === "POST" ? 201 : 200,
    ) => (await h.request(base + path, method, body, actor, expected)).data;
    const ctx = await app
      .get(AuthService)
      .taskContext({
        tenantId: fixture.tenant.id,
        userId: fixture.accounts.admin.userId,
        membershipId: fixture.accounts.admin.memberId,
        appId: "content",
        taskId: randomUUID(),
      });
    const png = spawnSync(
      "python3",
      [
        "-c",
        "from PIL import Image;import io,base64;b=io.BytesIO();Image.new('RGB',(128,128),'#bc9c72').save(b,format='PNG');print(base64.b64encode(b.getvalue()).decode())",
      ],
      { encoding: "utf8" },
    ).stdout.trim();
    assert.ok(png);
    let calls = [];
    provider.configured = () => true;
    provider.generate = async (...args) => {
      calls.push(args);
      return {
        image: png,
        usage: { generated_images: 1 },
        externalId: "stub-studio",
        model: provider.model(),
      };
    };
    const brief = {
      workflow: "studio",
      prompt: "咖啡品牌冬季社媒图",
      productIds: [],
      productVersions: {},
      sizes: ["square"],
    };
    await req(
      "/projects",
      "POST",
      { name: "无品牌的旧版项目", brief: { ...brief, workflow: "layout" } },
      "admin",
      400,
    );
    checks++;
    const p = await req("/projects", "POST", { name: "咖啡品牌创作", brief });
    eq(p.brief.workflow, "studio");
    eq(p.brief.productIds, []);
    await req("/projects/" + p.id, "GET", undefined, "sales", 403);
    checks++;
    const privateUpload = await req("/assets", "POST", {
      filename: "私有参考.png",
      data: png,
      draft: true,
    });
    eq(privateUpload.shared, false);
    eq(privateUpload.projectId, null);
    await req(
      `/assets/${privateUpload.id}/file`,
      "GET",
      undefined,
      "sales",
      403,
    );
    checks++;
    const request = {
      projectVersion: p.version,
      mode: "image",
      instruction: "冬季咖啡静物，无文字",
      size: "square",
      referenceAssetId: privateUpload.id,
    };
    const preview = await req(`/projects/${p.id}/preview`, "POST", request);
    eq(preview.requests, 1);
    eq(preview.deliverables, 1);
    eq(preview.inputs[0].outputs[0].data.layers, []);
    eq(preview.inputs[0].prompt.includes("叠加真实产品图"), false);
    const body = {
      request,
      previewHash: preview.previewHash,
      expiresAt: preview.expiresAt,
      requestKey: randomUUID(),
    };
    const b = await req(`/projects/${p.id}/batches`, "POST", body);
    eq((await req(`/projects/${p.id}/batches`, "POST", body)).id, b.id);
    await s.tick();
    eq(calls.length, 1);
    eq(calls[0][2].startsWith("data:image/png;base64,"), true);
    eq(
      (await db.contentAsset.findUnique({ where: { id: privateUpload.id } }))
        .projectId,
      p.id,
    );
    eq(calls[0][4], "2048x2048");
    let arts = await req(`/projects/${p.id}/artifacts?page=1`);
    eq(arts.total, 1);
    const original = arts.items[0],
      data = original.versions[0].data;
    eq(data.layers, []);
    eq(data.source.workflow, "studio");
    eq(data.source.prompt, request.instruction);
    const stored = await getFile(fixture.tenant.id, data.backgroundId);
    eq(stored.subarray(1, 4).toString(), "PNG");
    const reference = {
      ...request,
      instruction: "背景改成米色，保留咖啡杯",
      referenceAssetId: data.backgroundId,
      size: "portrait",
    };
    const plan2 = await req(`/projects/${p.id}/preview`, "POST", reference);
    await req(`/projects/${p.id}/batches`, "POST", {
      request: reference,
      previewHash: plan2.previewHash,
      expiresAt: plan2.expiresAt,
      requestKey: randomUUID(),
    });
    await s.tick();
    eq(calls.length, 2);
    eq(calls[1][2], "data:image/png;base64," + stored.toString("base64"));
    eq(calls[1][4], "1728x2304");
    arts = await req(`/projects/${p.id}/artifacts?page=1`);
    eq(arts.total, 2);
    const edited = arts.items.find((x) => x.id !== original.id);
    eq(edited.versions[0].data.source.referenceAssetId, data.backgroundId);
    eq(edited.versions[0].data.layers, []);
    eq(edited.versions[0].data.height, 1440);
    eq((await req(`/projects/${p.id}/batches?page=1`)).total, 2);
    eq((await req(`/projects/${p.id}`)).id, p.id);
    const another = await req("/projects", "POST", { name: "另一创作", brief });
    await req(
      `/projects/${another.id}/preview`,
      "POST",
      { ...reference, projectVersion: another.version },
      "admin",
      400,
    );
    checks++;
    await req(
      `/projects/${p.id}/preview`,
      "POST",
      { ...request, referenceAssetId: randomUUID() },
      "admin",
      404,
    );
    checks++;
    await req(
      `/projects/${p.id}/preview`,
      "POST",
      { ...request, instruction: " " },
      "admin",
      400,
    );
    checks++;
    const brand = await req("/documents/brand", "POST", {
      name: "咖啡品牌",
      data: {
        tone: "温暖克制",
        color: "#71543b",
        forbiddenWords: ["包治百病"],
      },
    });
    await req(`/document/${brand.id}/publish`, "POST", { version: 1 });
    const branded = await req("/projects", "POST", {
      name: "有品牌的创作",
      brief: { ...brief, brandId: brand.id, brandVersion: 1 },
    });
    await req(
      `/projects/${branded.id}/preview`,
      "POST",
      { ...request, instruction: "包治百病" },
      "admin",
      400,
    );
    checks++;
    const brandPlan = await req(`/projects/${branded.id}/preview`, "POST", {
      ...request,
      referenceAssetId: undefined,
    });
    eq(brandPlan.inputs[0].prompt.includes("温暖克制"), true);
    eq(calls.length, 2);
    // A viewer cannot use the raw asset endpoint to bypass approval of generated drafts.
    await req("/members", "PUT", {
      membershipId: fixture.accounts.buyer.memberId,
      role: "viewer",
    });
    await req(
      `/assets/${data.backgroundId}/file`,
      "GET",
      undefined,
      "buyer",
      404,
    );
    checks++;
    console.log(
      JSON.stringify({
        suite: "content-studio",
        checks,
        providerStubCalls: calls.length,
        paidCalls: 0,
      }),
    );
  } finally {
    if (fixture) {
      await cleanupFixture(db, fixture);
      if (process.env.CONTENT_STORAGE_PATH)
        fs.rmSync(
          require("node:path").join(
            process.env.CONTENT_STORAGE_PATH,
            fixture.tenant.id,
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
