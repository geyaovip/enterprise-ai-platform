// Opt-in single reference-image edit. Existing approved test project is reused.
const fs = require("node:fs"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto"),
  { spawnSync } = require("node:child_process");
const root = process.cwd(),
  { createApp } = require("../dist/server"),
  { PrismaService } = require("../dist/modules/prisma.service"),
  { AuthService } = require("../dist/modules/platform/auth.service"),
  { ContentService } = require("../dist/modules/content/content.service"),
  { SeedreamProvider } = require("../dist/modules/content/seedream.provider");
if (
  process.env.CONTENT_REAL_EDIT !== "1" ||
  !/@127\.0\.0\.1:54329\/suite_phase1_qa$/.test(process.env.DATABASE_URL || "")
)
  throw Error("Explicit isolated real edit required");
const out = "/tmp/content-workbench-dev-20261030";
fs.writeFileSync(out + "/real-local-edit.guard", new Date().toISOString(), {
  flag: "wx",
  mode: 0o600,
});
process.env.CONTENT_ARK_API_KEY = fs
  .readFileSync(out + "/ark-key.private", "utf8")
  .trim();
(async () => {
  const db = new PrismaService();
  let app;
  const report = {
    purpose:
      "One reference-image edit, exact outside-region preservation and version/review regression",
    maxPaidPosts: 1,
    realRequests: 0,
    ok: false,
  };
  try {
    app = await createApp();
    const s = app.get(ContentService),
      provider = app.get(SeedreamProvider),
      generate = provider.generate.bind(provider);
    provider.generate = async (...args) => {
      report.realRequests++;
      assert.equal(report.realRequests, 1);
      assert.ok(args[2]?.startsWith("data:image/png;base64,"));
      return generate(...args);
    };
    const previous = JSON.parse(
      fs.readFileSync(out + "/real-report-prompt-fix.json"),
    );
    const source = await db.contentBatch.findUniqueOrThrow({
      where: { id: previous.batchId },
    });
    const ctx = await app
      .get(AuthService)
      .taskContext({
        tenantId: source.tenantId,
        userId: source.userId,
        membershipId: source.membershipId,
        appId: "content",
        taskId: randomUUID(),
      });
    const arts = await s.artworks(ctx, source.projectId),
      art = arts.find((a) => a.versions[0].data.height === 1920),
      before = art.versions[0];
    const region = { x: 0.72, y: 0.05, w: 0.25, h: 0.22 },
      request = {
        projectVersion: 1,
        mode: "local_edit",
        artifactId: art.id,
        artifactVersion: 1,
        instruction:
          "将选区内的绿色叶片替换为柔和的浅米色亚麻布纹理，不添加文字或标志。",
        region,
      };
    const preview = await s.plan(ctx, source.projectId, request);
    const batch = await s.submit(ctx, source.projectId, {
      request,
      previewHash: preview.previewHash,
      expiresAt: preview.expiresAt,
      requestKey: randomUUID(),
    });
    report.batchId = batch.id;
    report.projectId = source.projectId;
    await s.tick();
    const item = await db.contentGenerationItem.findFirstOrThrow({
      where: { batchId: batch.id },
    });
    report.status = item.status;
    report.errorCode = item.errorCode;
    const attempt = await db.contentProviderAttempt.findUnique({
      where: { itemId: item.id },
    });
    report.usage = attempt?.usage;
    report.externalId = attempt?.externalId;
    report.knownCost = null;
    report.costStatus = "pending_provider_bill";
    if (item.status !== "succeeded") return;
    const versions = (await s.artworks(ctx, source.projectId)).find(
      (a) => a.id === art.id,
    ).versions;
    const after = versions[0];
    assert.equal(after.version, 2);
    assert.equal(after.status, "draft");
    assert.equal(versions.find((v) => v.version === 1).status, "approved");
    assert.deepEqual(after.data.layers, before.data.layers);
    const original = await s.assetBytes(ctx, before.data.backgroundId),
      edited = await s.assetBytes(ctx, after.data.backgroundId);
    fs.writeFileSync(out + "/local-before.png", original.bytes);
    fs.writeFileSync(
      "output/playwright/content-20261030/real-local-background.png",
      edited.bytes,
    );
    const pixelCheck = spawnSync(
      "python3",
      [
        "-c",
        "from PIL import Image,ImageOps,ImageChops,ImageDraw; import sys; a=ImageOps.fit(Image.open(sys.argv[1]).convert('RGBA'),(1080,1920));b=Image.open(sys.argv[2]).convert('RGBA');assert b.size==a.size;r=(round(.72*1080),round(.05*1920),round(.25*1080),round(.22*1920));mask=Image.new('L',a.size,255);ImageDraw.Draw(mask).rectangle((r[0],r[1],r[0]+r[2]-1,r[1]+r[3]-1),fill=0);d=ImageChops.difference(a,b);assert d.convert('RGB').getbbox() is not None;assert ImageChops.multiply(d.convert('RGB'),mask.convert('RGB')).getbbox() is None;print('outside pixels identical; inside changed')",
        out + "/local-before.png",
        "output/playwright/content-20261030/real-local-background.png",
      ],
      { encoding: "utf8" },
    );
    assert.equal(pixelCheck.status, 0, pixelCheck.stderr);
    report.pixelCheck = pixelCheck.stdout.trim();
    report.productAndTextLayersUnchanged = true;
    const e = await s.createExport(ctx, source.projectId, {
      requestKey: randomUUID(),
      items: [{ artifactId: art.id, version: 2 }],
      format: "png",
      draft: true,
    });
    fs.writeFileSync(
      "output/playwright/content-20261030/real-local-poster.png",
      (await s.downloadImage(ctx, e.id, 0)).bytes,
    );
    report.ok = true;
    report.generatedImages = 1;
  } catch (e) {
    report.error = e?.code ?? e?.name ?? "Error";
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(
      out + "/real-local-edit-report.json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
    if (app) await app.close();
    await db.$disconnect();
  }
})();
