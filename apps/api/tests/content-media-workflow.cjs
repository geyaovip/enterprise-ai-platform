const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createServer } = require("node:http");
const { readFileSync, mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  createFixture,
  fixtureHttp,
  cleanupFixture,
} = require("../scripts/workflow-fixture.cjs");
const { createApp } = require("../dist/server");
const { PrismaService } = require("../dist/modules/prisma.service");
const { ContentService } = require("../dist/modules/content/content.service");

if (
  process.env.NODE_ENV !== "test" ||
  !/@127\.0\.0\.1:54329\/suite_phase1_qa$/.test(process.env.DATABASE_URL || "")
) {
  throw Error("Isolated QA database required");
}
const mp4 = process.env.CONTENT_TEST_MP4
  ? readFileSync(process.env.CONTENT_TEST_MP4)
  : null;
if (!mp4 || mp4.toString("ascii", 4, 8) !== "ftyp")
  throw Error("Set CONTENT_TEST_MP4 to a local video fixture");
const storage = mkdtempSync(join(tmpdir(), "content-media-workflow-"));
process.env.CONTENT_STORAGE_PATH = storage;
process.env.CONTENT_ARK_API_KEY = "isolated-test-placeholder";
process.env.CONTENT_SEEDREAM_MODEL = "doubao-seedream-4-5-251128";
process.env.CONTENT_SEEDANCE_MODEL = "doubao-seedance-1-0-pro-fast-251015";
const png = spawnSync(
  "python3",
  [
    "-c",
    "from PIL import Image;import io,base64;b=io.BytesIO();Image.new('RGB',(128,160),'#bc9c72').save(b,format='PNG');print(base64.b64encode(b.getvalue()).decode())",
  ],
  { encoding: "utf8" },
).stdout.trim();
assert(png);
const editedPng = spawnSync(
  "python3",
  [
    "-c",
    "from PIL import Image;import io,base64;b=io.BytesIO();Image.new('RGB',(128,160),'#205030').save(b,format='PNG');print(base64.b64encode(b.getvalue()).decode())",
  ],
  { encoding: "utf8" },
).stdout.trim();
assert(editedPng);
const images = [],
  videos = [];
let polls = 0,
  downloads = 0,
  unknown = false;
let origin;
const mock = createServer(async (request, response) => {
  const reply = (value) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(value));
  };
  if (request.method === "POST") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    if (request.url.endsWith("/images/generations")) {
      images.push(payload);
      return reply({
        data: [
          {
            b64_json: payload.prompt.includes("仅修改这个归一化选区")
              ? editedPng
              : png,
          },
        ],
        usage: { generated_images: 1 },
      });
    }
    if (request.url.endsWith("/contents/generations/tasks")) {
      videos.push(payload);
      if (unknown) return request.socket.destroy();
      return reply({ id: "stub-task-1" });
    }
  }
  if (request.url.endsWith("/tasks/stub-task-1")) {
    polls++;
    return reply(
      polls === 1
        ? { status: "running" }
        : {
            status: "succeeded",
            ratio: "16:9",
            resolution: "720p",
            duration: 5,
            content: { video_url: origin + "/result.mp4" },
            usage: { total_tokens: 15 },
          },
    );
  }
  if (request.url === "/result.mp4") {
    downloads++;
    response.setHeader("Content-Type", "video/mp4");
    return response.end(mp4);
  }
  response.writeHead(404).end();
});

(async () => {
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  origin = "http://127.0.0.1:" + mock.address().port;
  process.env.CONTENT_ARK_BASE_URL = origin + "/api/v3";
  const db = new PrismaService();
  let app, fixture;
  try {
    app = await createApp();
    fixture = await createFixture(
      db,
      "erp-flow-test-content-media-" + randomUUID().slice(0, 8),
    );
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
    const h = await fixtureHttp(app, fixture);
    const prefix = "/tenants/" + fixture.tenant.slug + "/apps/content";
    const get = async (p) => (await h.request(prefix + p)).data;
    const post = async (p, body, status = 201) =>
      (await h.request(prefix + p, "POST", body, "admin", status)).data;
    const content = app.get(ContentService);
    const board = await post("/canvases", { name: "产品改图与视频" });
    const canvas = "/canvases/" + board.id;
    const project = "/projects/" + board.projectId;
    const meta = await get("/metadata");
    assert.equal(meta.model.videoConfigured, true);
    assert(meta.model.imageOptions.resolutions.includes("4K"));

    const refs = [];
    const nodes = [];
    for (let index = 0; index < 2; index++) {
      const asset = await post("/assets", {
        filename: "参考" + index + ".png",
        data: png,
        projectId: board.projectId,
      });
      refs.push(asset.id);
      const nodeId = randomUUID();
      nodes.push(nodeId);
      await post(canvas + "/images", {
        assetId: asset.id,
        nodeId,
        version: index + 1,
        x: index * 400,
        y: 0,
      });
    }
    const picture = {
      projectVersion: 1,
      mode: "image",
      instruction: "保留产品外观，改为米色背景",
      ratio: "16:9",
      resolution: "4K",
      candidates: 2,
      referenceAssetIds: refs,
    };
    const view = await get(canvas);
    const recipe = {
      mode: "image",
      picture: {
        prompt: picture.instruction,
        nodes,
        ratio: picture.ratio,
        resolution: picture.resolution,
        candidates: picture.candidates,
      },
      video: {
        prompt: "",
        options: { ratio: "16:9", resolution: "720p", duration: 5 },
      },
    };
    await h.request(prefix + canvas, "PUT", {
      version: view.version,
      data: { ...view.data, recipe },
    });
    assert.deepEqual((await get(canvas)).data.recipe, recipe);
    const copy = await post("/canvases", {
      name: "复用设置",
      sourceCanvasId: board.id,
    });
    assert.deepEqual(copy.data.nodes, []);
    assert.deepEqual(copy.data.recipe.picture, {
      ...recipe.picture,
      nodes: [],
    });
    await post(
      project + "/preview",
      { ...picture, referenceAssetIds: [refs[0], randomUUID()] },
      404,
    );
    await post(project + "/preview", { ...picture, candidates: 4 }, 400);

    const submit = async (request, originNodeId) => {
      const plan = await post(project + "/preview", request);
      const { version } = await get(canvas);
      const envelope = {
        request,
        requestKey: randomUUID(),
        previewHash: plan.previewHash,
        expiresAt: plan.expiresAt,
        canvas: { id: board.id, version, originNodeId, anchor: { x: 0, y: 0 } },
      };
      const batch = await post(project + "/batches", envelope);
      assert.equal((await post(project + "/batches", envelope)).id, batch.id);
      return batch;
    };
    const batch = await submit(picture, nodes[0]);
    await content.tick();
    await content.tick();
    assert.equal(images.length, 2);
    assert.equal(images[0].image.length, 2);
    assert.equal(images[0].size, images[1].size);
    const [width, height] = images[0].size.split("x").map(Number);
    assert.equal(width / height, 16 / 9);
    assert(width * height > 15000000);
    const generated = await get(canvas);
    assert.equal(generated.data.nodes.length, 4);
    assert.equal(
      Object.values(generated.receipts).filter(
        (receipt) => receipt.request.resolution === "4K",
      ).length,
      2,
    );
    assert.equal(
      (await get(project + "/batches"))
        .find((row) => row.id === batch.id)
        .items.every((item) => item.status === "succeeded"),
      true,
    );

    const region = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
    await post(project + "/preview", { ...picture, region }, 400);
    const edited = await submit(
      {
        ...picture,
        candidates: 1,
        region,
        referenceAssetIds: [refs[0]],
      },
      nodes[0],
    );
    await content.tick();
    const editItem = (await get(project + "/batches")).find(
      (row) => row.id === edited.id,
    ).items[0];
    assert.equal(editItem.status, "succeeded");
    const editFile = readFileSync(
      join(storage, fixture.tenant.id, editItem.attempt.resultAssetId + ".bin"),
    );
    const verifyPixels = spawnSync(
      "python3",
      [
        "-c",
        "from PIL import Image,ImageChops;import io,sys;im=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert('RGB');expected=Image.new('RGB',(128,160),'#bc9c72');expected.paste('#205030',(32,40,96,120));assert ImageChops.difference(im,expected).getbbox() is None",
      ],
      { input: editFile },
    );
    assert.equal(verifyPixels.status, 0, verifyPixels.stderr.toString());
    assert.deepEqual(
      Object.values((await get(canvas)).receipts).find(
        (entry) => entry.request.region,
      ).request.region,
      region,
    );

    const video = {
      projectVersion: 1,
      mode: "video",
      instruction: "固定镜头，杯口有轻微蒸汽",
      referenceAssetId: refs[0],
      video: { ratio: "adaptive", resolution: "720p", duration: 5 },
    };
    await post(
      project + "/preview",
      { ...video, referenceAssetId: undefined },
      400,
    );
    const clipBatch = await submit(video, nodes[0]);
    const clipItem = await db.contentGenerationItem.findFirstOrThrow({
      where: { batchId: clipBatch.id },
    });
    await content.tick();
    assert.equal(
      (
        await db.contentGenerationItem.findUnique({
          where: { id: clipItem.id },
        })
      ).status,
      "rendering",
    );
    assert.equal(videos[0].content[1].role, "first_frame");
    for (let i = 0; i < 2; i++) {
      await db.contentGenerationItem.update({
        where: { id: clipItem.id },
        data: { heartbeatAt: new Date(0) },
      });
      await content.tick();
    }
    assert.equal(videos.length, 1);
    assert.equal(polls, 2);
    assert.equal(downloads, 1);
    const completed = (await get(project + "/batches")).find(
      (row) => row.id === clipBatch.id,
    ).items[0];
    assert.equal(completed.status, "succeeded");
    assert.equal(completed.usage.metric, "content.video");
    assert.equal((await get(canvas)).data.nodes.at(-1).type, "video");

    const api =
      "http://127.0.0.1:" +
      app.getHttpServer().address().port +
      "/api/v1" +
      prefix;
    const url = api + "/assets/" + completed.attempt.resultAssetId + "/file";
    const response = await fetch(url, {
      headers: { cookie: h.cookies.admin, range: "bytes=0-23" },
    });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-type"), "video/mp4");
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      mp4.subarray(0, 24),
    );
    const unauthed = await fetch(url);
    assert([401, 403].includes(unauthed.status));

    const edits = [
      [{ operation: "crop", region }, [64, 80]],
      [{ operation: "rotate" }, [160, 128]],
      [{ operation: "mirror" }, [128, 160]],
    ];
    for (const [operation, size] of edits) {
      const transformed = await post(
        project + "/assets/" + editItem.attempt.resultAssetId + "/transform",
        operation,
      );
      assert.notEqual(transformed.id, editItem.attempt.resultAssetId);
      assert.deepEqual([transformed.width, transformed.height], size);
    }
    await post(
      project + "/assets/" + completed.attempt.resultAssetId + "/transform",
      { operation: "rotate" },
      400,
    );
    assert.deepEqual(
      readFileSync(
        join(
          storage,
          fixture.tenant.id,
          editItem.attempt.resultAssetId + ".bin",
        ),
      ),
      editFile,
    );
    assert.equal(images.length, 3);
    assert.equal(videos.length, 1);

    const assets = "/assets?projectId=" + board.projectId;
    const assetDate = await db.contentAsset.findUniqueOrThrow({
      where: { id: refs[0] },
      select: { createdAt: true },
    });
    await db.contentAsset.update({
      where: { id: refs[0] },
      data: { createdAt: new Date(Date.now() - 10 * 86_400_000) },
    });
    const recentRefs = await get(
      assets + "&media=image&days=7&q=" + encodeURIComponent("参考"),
    );
    assert.deepEqual(
      recentRefs.items.map((asset) => asset.id),
      [refs[1]],
    );
    await db.contentAsset.update({ where: { id: refs[0] }, data: assetDate });
    const searched = await get(
      assets + "&media=image&sort=name&q=" + encodeURIComponent("参考"),
    );
    assert.deepEqual(
      searched.items.map((asset) => asset.id),
      refs,
    );
    assert.equal(
      (await get(assets + "&media=video")).items[0].id,
      completed.attempt.resultAssetId,
    );
    const archiveUrl =
      api +
      "/assets/archive?ids=" +
      refs[0] +
      "," +
      completed.attempt.resultAssetId;
    const archive = await fetch(archiveUrl, {
      headers: { cookie: h.cookies.admin },
    });
    assert.equal(archive.status, 200);
    assert.match(archive.headers.get("content-disposition"), /attachment/);
    const zip = Buffer.from(await archive.arrayBuffer());
    const verifyZip = spawnSync(
      "python3",
      [
        "-c",
        "import io,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); a,b=z.namelist(); assert a.startswith('01-') and b.startswith('02-'); assert z.read(a).startswith(b'\\x89PNG'); assert z.read(b)[4:8]==b'ftyp'; assert z.testzip() is None",
      ],
      { input: zip },
    );
    assert.equal(verifyZip.status, 0, verifyZip.stderr.toString());
    assert([401, 403].includes((await fetch(archiveUrl)).status));
    await h.request(
      prefix + "/assets/archive?ids=" + refs[0] + "," + randomUUID(),
      "GET",
      undefined,
      "admin",
      404,
    );

    unknown = true;
    const unknownBatch = await submit({
      ...video,
      referenceAssetId: undefined,
      video: { ...video.video, ratio: "16:9" },
    });
    await content.tick();
    await content.tick();
    assert.equal(videos.length, 2);
    assert.equal(
      (await get(project + "/batches")).find(
        (row) => row.id === unknownBatch.id,
      ).items[0].status,
      "needs_reconciliation",
    );
    await post(project + "/preview", video, 409);
    console.log("Media workflow passed", {
      http: h.checks(),
      simulatedImages: images.length,
      simulatedVideos: videos.length,
      paidCalls: 0,
    });
  } finally {
    if (fixture) await cleanupFixture(db, fixture);
    if (app) await app.close();
    await db.$disconnect();
    await new Promise((resolve) => mock.close(resolve));
    rmSync(storage, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
