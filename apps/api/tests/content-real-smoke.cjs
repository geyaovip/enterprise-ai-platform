// Opt-in one-image Ark integration. Never run as part of test:content.
const fs = require("node:fs"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto"),
  { spawnSync } = require("node:child_process");
const { createApp } = require("../dist/server"),
  { PrismaService } = require("../dist/modules/prisma.service"),
  { AuthService } = require("../dist/modules/platform/auth.service");
const { ContentService } = require("../dist/modules/content/content.service"),
  { SeedreamProvider } = require("../dist/modules/content/seedream.provider");
const { createFixture } = require("../scripts/workflow-fixture.cjs");
if (
  process.env.CONTENT_REAL_SMOKE !== "1" ||
  !/@127\.0\.0\.1:54329\/suite_phase1_qa$/.test(process.env.DATABASE_URL || "")
)
  throw Error("Explicit one-image isolated smoke required");
const run = process.env.CONTENT_REAL_RUN ?? "initial";
if (!["initial", "prompt-fix"].includes(run))
  throw Error("Unknown smoke purpose");
const out = "/tmp/content-workbench-dev-20261030",
  guard = out + "/real-attempt-" + run + ".guard";
if (run === "initial" && fs.existsSync(out + "/real-attempt.guard"))
  throw Error("Initial smoke already attempted");
fs.writeFileSync(guard, new Date().toISOString(), { flag: "wx", mode: 0o600 });
process.env.CONTENT_ARK_API_KEY = fs
  .readFileSync(out + "/ark-key.private", "utf8")
  .trim();
(async () => {
  let app;
  const db = new PrismaService();
  let report = {
    date: new Date().toISOString(),
    purpose:
      run === "prompt-fix"
        ? "Regression for literal hex text in generated background and optional watermark; reuse one new image for three outputs"
        : "Verify selected Seedream endpoint, Worker ingestion and delivery",
    maxPaidPosts: 1,
    realRequests: 0,
  };
  try {
    app = await createApp();
    const s = app.get(ContentService),
      p = app.get(SeedreamProvider),
      generate = p.generate.bind(p);
    p.generate = async (...args) => {
      report.realRequests++;
      assert.equal(report.realRequests, 1);
      return generate(...args);
    };
    const f = await createFixture(
      db,
      "erp-flow-test-content-real-" + randomUUID().slice(0, 6),
    );
    fs.writeFileSync(
      out + "/real-fixture-" + run + ".private.json",
      JSON.stringify(f),
      { mode: 0o600 },
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
    const a = f.accounts.admin,
      ctx = await app.get(AuthService).taskContext({
        tenantId: f.tenant.id,
        userId: a.userId,
        membershipId: a.memberId,
        appId: "content",
        taskId: randomUUID(),
      });
    const image = spawnSync(
      "python3",
      [
        "-c",
        "from PIL import Image,ImageDraw; import io,base64;im=Image.new('RGBA',(700,900),(0,0,0,0));d=ImageDraw.Draw(im);d.rounded_rectangle((200,110,500,800),48,fill='#f2e3c9');d.rounded_rectangle((230,65,470,160),22,fill='#52624d');d.rectangle((200,350,500,580),fill='#fffdf5');d.text((260,430),'NATURAL',fill='#52624d');b=io.BytesIO();im.save(b,format='PNG');print(base64.b64encode(b.getvalue()).decode())",
      ],
      { encoding: "utf8" },
    ).stdout.trim();
    const asset = await s.upload(ctx, {
      filename: "synthetic-product.png",
      data: image,
      shared: true,
    });
    const brand = await s.saveDocument(ctx, "brand", {
      name: "示例自然品牌",
      data: { color: "#52624d", tone: "自然克制，柔和暖光，真实商业摄影质感" },
    });
    await s.publish(ctx, brand.id, { version: 1 });
    const product = await s.saveDocument(ctx, "product", {
      name: "示例谷物轻饮",
      data: {
        imageId: asset.id,
        sellingPoints: "轻盈随行，自然好滋味",
        parameters: "350ml · 示例产品",
        price: "新品尝鲜 ¥29",
        validUntil: "活动截至11月15日",
        disclaimer: "合成样本，仅用于功能验收",
      },
    });
    const project = await s.saveProject(ctx, {
      name: "Seedream单图联调",
      visibility: "tenant",
      brief: {
        brandId: brand.id,
        brandVersion: 1,
        productIds: [product.id],
        productVersions: { [product.id]: 1 },
        prompt:
          "秋日暖阳，浅色原木桌面，米白墙面，右上角少量虚化的绿色植物剪影，中央与下部留白，无任何文字和标志。真实商业产品摄影的干净背景。",
        sizes: ["square", "portrait", "story"],
        title: "轻一点，自然一点",
        cta: "发现新品",
      },
    });
    report.tenantId = f.tenant.id;
    report.projectId = project.id;
    const request = { projectVersion: 1, mode: "background" },
      plan = await s.plan(ctx, project.id, request);
    assert.equal(plan.requests, 1);
    assert.equal(plan.deliverables, 3);
    const batch = await s.submit(ctx, project.id, {
      request,
      previewHash: plan.previewHash,
      expiresAt: plan.expiresAt,
      requestKey: randomUUID(),
    });
    report.batchId = batch.id;
    fs.writeFileSync(
      out + "/real-report-" + run + ".json",
      JSON.stringify(report, null, 2),
    );
    await s.tick();
    const item = await db.contentGenerationItem.findFirstOrThrow({
      where: { batchId: batch.id },
    });
    report.itemStatus = item.status;
    report.errorCode = item.errorCode;
    const attempt = await db.contentProviderAttempt.findUnique({
      where: { itemId: item.id },
    });
    report.model = attempt?.model;
    report.providerUsage = attempt?.usage;
    report.externalId = attempt?.externalId;
    report.costStatus = "pending_provider_bill";
    report.currency = "CNY";
    report.knownCost = null;
    if (item.status !== "succeeded") {
      report.ok = false;
      return;
    }
    const arts = await s.artworks(ctx, project.id);
    assert.equal(arts.length, 3);
    await s.grant(ctx, {
      membershipId: f.accounts.reviewer.memberId,
      role: "reviewer",
    });
    const reviewer = await app.get(AuthService).taskContext({
      tenantId: f.tenant.id,
      userId: f.accounts.reviewer.userId,
      membershipId: f.accounts.reviewer.memberId,
      appId: "content",
      taskId: randomUUID(),
    });
    for (const art of arts) {
      await s.review(ctx, art.id, { version: 1, action: "submit" });
      await s.review(reviewer, art.id, {
        version: 1,
        action: "approve",
        note: "合成样本工程验收，商业效果另行评审",
      });
    }
    const exportResult = await s.createExport(ctx, project.id, {
      requestKey: randomUUID(),
      items: arts.map((a) => ({ artifactId: a.id, version: 1 })),
      format: "png",
    });
    const zip = await s.download(ctx, exportResult.id);
    fs.mkdirSync("output/playwright/content-20261030", { recursive: true });
    fs.writeFileSync(
      "output/playwright/content-20261030/real-delivery-" + run + ".zip",
      zip,
    );
    const bg = await s.assetBytes(ctx, arts[0].versions[0].data.backgroundId);
    fs.writeFileSync(
      "output/playwright/content-20261030/real-background-" + run + ".png",
      bg.bytes,
    );
    const first = await s.downloadImage(ctx, exportResult.id, 0);
    fs.writeFileSync(
      "output/playwright/content-20261030/real-poster-" + run + ".png",
      first.bytes,
    );
    report.ok = true;
    report.deliverables = arts.map((a) => ({
      artifactId: a.id,
      width: a.versions[0].data.width,
      height: a.versions[0].data.height,
    }));
    report.exportBytes = zip.length;
    report.evidence =
      "output/playwright/content-20261030/real-delivery-" + run + ".zip";
  } catch (e) {
    report.ok = false;
    report.error = e?.code ?? e?.name ?? "Error";
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(
      out + "/real-report-" + run + ".json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
    if (app) await app.close();
    await db.$disconnect();
  }
})();
