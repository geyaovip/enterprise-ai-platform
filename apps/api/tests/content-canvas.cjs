const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createApp } = require("../dist/server");
const { PrismaService } = require("../dist/modules/prisma.service");
const { ContentService } = require("../dist/modules/content/content.service");
const {
  SeedreamProvider,
} = require("../dist/modules/content/seedream.provider");
const {
  createFixture,
  fixtureHttp,
  cleanupFixture,
} = require("../scripts/workflow-fixture.cjs");
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
  let app, f, other;
  try {
    app = await createApp();
    f = await createFixture(
      db,
      "erp-flow-test-content-canvas-" + randomUUID().slice(0, 8),
    );
    other = await createFixture(
      db,
      "erp-flow-test-content-canvas-other-" + randomUUID().slice(0, 8),
    );
    for (const fixture of [f, other]) {
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
    }
    const h = await fixtureHttp(app, f),
      s = app.get(ContentService),
      provider = app.get(SeedreamProvider);
    const base = `/tenants/${f.tenant.slug}/apps/content`;
    const req = async (
      p,
      method = "GET",
      body,
      actor = "admin",
      expected = method === "POST" ? 201 : 200,
    ) => {
      const r = await h.request(base + p, method, body, actor, expected);
      checks++;
      return r.data;
    };
    const png = spawnSync(
      "python3",
      [
        "-c",
        "from PIL import Image;import io,base64;b=io.BytesIO();Image.new('RGB',(128,160),'#bc9c72').save(b,format='PNG');print(base64.b64encode(b.getvalue()).decode())",
      ],
      { encoding: "utf8" },
    ).stdout.trim();
    let calls = 0;
    provider.configured = () => true;
    provider.generate = async () => {
      calls++;
      return {
        image: png,
        model: provider.model(),
        externalId: "stub-canvas",
        usage: { generated_images: 1 },
      };
    };
    await req("/canvases", "POST", {}, "admin", 400);
    await req(
      "/canvases",
      "POST",
      { name: "测试", url: "https://example.test" },
      "admin",
      400,
    );
    const b = await req("/canvases", "POST", { name: "咖啡上新画布" });
    eq(b.project.visibility, "private");
    eq(b.data.nodes, []);
    eq(calls, 0);
    eq((await req("/canvases?page=1&q=咖啡")).total, 1);
    eq((await req("/canvases?visibility=tenant")).total, 0);
    eq((await req("/canvases?visibility=private&days=7&sort=name")).total, 1);
    const canvasDate = await db.contentCanvas.findUniqueOrThrow({
      where: { id: b.id },
      select: { updatedAt: true },
    });
    await db.contentCanvas.update({
      where: { id: b.id },
      data: { updatedAt: new Date(Date.now() - 10 * 86_400_000) },
    });
    eq((await req("/canvases?days=7")).total, 0);
    eq((await req("/canvases?days=30")).total, 1);
    await db.contentCanvas.update({ where: { id: b.id }, data: canvasDate });
    eq((await req("/canvases", "POST", { projectId: b.projectId })).id, b.id);
    await req("/members", "PUT", {
      membershipId: f.accounts.sales.memberId,
      role: "creator",
    });
    await req("/members", "PUT", {
      membershipId: f.accounts.buyer.memberId,
      role: "viewer",
    });
    eq((await req("/canvases?page=1", "GET", undefined, "sales")).total, 0);
    await req("/canvases/" + b.id, "GET", undefined, "sales", 404);
    await req(
      "/canvases/" + b.id,
      "PUT",
      { version: 1, data: b.data },
      "buyer",
      403,
    );
    const foreignProject = await db.contentProject.create({
      data: {
        tenantId: other.tenant.id,
        name: "隔离项目",
        ownerId: other.accounts.admin.memberId,
        participants: [],
        brief: {},
      },
    });
    const foreignBoard = await db.contentCanvas.create({
      data: {
        tenantId: other.tenant.id,
        projectId: foreignProject.id,
        data: b.data,
      },
    });
    await req("/canvases/" + foreignBoard.id, "GET", undefined, "admin", 404);
    await req(
      "/canvases",
      "POST",
      { projectId: foreignProject.id },
      "admin",
      404,
    );
    const source = await req("/assets", "POST", {
      filename: "咖啡参考.png",
      data: png,
      draft: true,
    });
    const nodeId = randomUUID();
    const imported = await req(`/canvases/${b.id}/images`, "POST", {
      version: 1,
      nodeId,
      assetId: source.id,
      x: 10,
      y: 20,
    });
    eq(imported.version, 2);
    eq(imported.data.nodes.length, 1);
    const copiedId = imported.data.nodes[0].assetId;
    assert.notEqual(copiedId, source.id);
    checks++;
    eq(
      (await db.contentAsset.findUnique({ where: { id: copiedId } })).projectId,
      b.projectId,
    );
    eq(
      (await db.contentAsset.findUnique({ where: { id: source.id } }))
        .projectId,
      null,
    );
    eq(
      (
        await req(`/canvases/${b.id}/images`, "POST", {
          version: 1,
          nodeId,
          assetId: source.id,
          x: 10,
          y: 20,
        })
      ).version,
      2,
    );
    let current = await req("/canvases/" + b.id);
    eq(current.assets[copiedId].filename, "咖啡参考.png");
    const note = {
      id: randomUUID(),
      type: "note",
      text: "暖色背景，保留杯子",
      x: 400,
      y: 30,
      width: 260,
      height: 180,
    };
    let saved = await req("/canvases/" + b.id, "PUT", {
      version: 2,
      data: { ...current.data, nodes: [...current.data.nodes, note] },
    });
    eq(saved.version, 3);
    await req(
      "/canvases/" + b.id,
      "PUT",
      { version: 2, data: current.data },
      "admin",
      409,
    );
    await req(
      "/canvases/" + b.id,
      "PUT",
      {
        version: 3,
        data: { ...saved.data, nodes: [...saved.data.nodes, note] },
      },
      "admin",
      400,
    );
    await req(
      "/canvases/" + b.id,
      "PUT",
      { version: 3, data: { ...saved.data, nodes: [{ ...note, x: 99999 }] } },
      "admin",
      400,
    );
    await req(
      "/canvases/" + b.id,
      "PUT",
      {
        version: 3,
        data: {
          ...saved.data,
          nodes: [
            { ...saved.data.nodes[0], id: randomUUID(), assetId: source.id },
          ],
        },
      },
      "admin",
      400,
    );
    const request = {
      projectVersion: b.project.version,
      mode: "image",
      instruction: "背景改为浅米色，保留杯子",
      size: "square",
      referenceAssetId: copiedId,
    };
    const preview = await req(
      `/projects/${b.projectId}/preview`,
      "POST",
      request,
    );
    const submission = {
      request,
      previewHash: preview.previewHash,
      expiresAt: preview.expiresAt,
      requestKey: randomUUID(),
      canvas: {
        id: b.id,
        version: 3,
        originNodeId: nodeId,
        anchor: { x: 0, y: 0 },
      },
    };
    await req(
      `/projects/${b.projectId}/batches`,
      "POST",
      {
        ...submission,
        canvas: { ...submission.canvas, originNodeId: note.id },
      },
      "admin",
      409,
    );
    await req(
      `/projects/${b.projectId}/batches`,
      "POST",
      { ...submission, canvas: { ...submission.canvas, version: 2 } },
      "admin",
      409,
    );
    eq(calls, 0);
    const batch = await req(
      `/projects/${b.projectId}/batches`,
      "POST",
      submission,
    );
    eq(
      (await req(`/projects/${b.projectId}/batches`, "POST", submission)).id,
      batch.id,
    );
    eq((await req("/canvases/" + b.id)).pending, 1);
    // Drag and add notes while the paid job is pending. The worker must append to the latest board.
    const moved = {
      ...saved.data,
      nodes: saved.data.nodes.map((n) =>
        n.id === nodeId ? { ...n, x: 110, y: 120 } : n,
      ),
    };
    saved = await req("/canvases/" + b.id, "PUT", { version: 3, data: moved });
    await s.tick();
    eq(calls, 1);
    current = await req("/canvases/" + b.id);
    eq(current.pending, 0);
    eq(current.version, 5);
    eq(current.data.nodes.length, 3);
    eq(current.data.nodes.find((n) => n.id === note.id).text, note.text);
    const result = current.data.nodes.find(
      (n) => n.id !== nodeId && n.type === "image",
    );
    eq(result.x, 692);
    eq(result.y, 120);
    eq(current.data.nodes.find((n) => n.id === nodeId).assetId, copiedId);
    await s.tick();
    eq(calls, 1);
    eq((await req("/canvases/" + b.id)).data.nodes.length, 3);
    // Exact key recovery remains valid after board version changes and after preview expiry.
    eq(
      (
        await req(`/projects/${b.projectId}/batches`, "POST", {
          ...submission,
          expiresAt: "2020-01-01T00:00:00.000Z",
        })
      ).id,
      batch.id,
    );
    await req(
      `/projects/${b.projectId}/batches`,
      "POST",
      {
        ...submission,
        canvas: { ...submission.canvas, anchor: { x: 1, y: 0 } },
      },
      "admin",
      409,
    );
    const file = await fetch(
      href(h, app, base + `/assets/${result.assetId}/file`),
      { headers: { Cookie: h.cookies.admin } },
    );
    eq(file.status, 200);
    eq(file.headers.get("content-type"), "image/png");
    assert.ok((await file.arrayBuffer()).byteLength > 100);
    checks++;
    // A removed canvas node never deletes the generated artifact or source media.
    saved = await req("/canvases/" + b.id, "PUT", {
      version: current.version,
      data: {
        ...current.data,
        nodes: current.data.nodes.filter((n) => n.id !== result.id),
      },
    });
    eq(
      await db.contentArtifact.count({ where: { projectId: b.projectId } }),
      1,
    );
    eq(await db.contentAsset.count({ where: { id: result.assetId } }), 1);
    const full = {
      ...saved.data,
      nodes: Array.from({ length: 100 }, (_, i) => ({
        ...note,
        id: randomUUID(),
        x: i * 10,
      })),
    };
    saved = await req("/canvases/" + b.id, "PUT", {
      version: saved.version,
      data: full,
    });
    const noRef = { ...request, referenceAssetId: undefined };
    const fullPreview = await req(
      `/projects/${b.projectId}/preview`,
      "POST",
      noRef,
    );
    await req(
      `/projects/${b.projectId}/batches`,
      "POST",
      {
        request: noRef,
        previewHash: fullPreview.previewHash,
        expiresAt: fullPreview.expiresAt,
        requestKey: randomUUID(),
        canvas: { id: b.id, version: saved.version, anchor: { x: 0, y: 0 } },
      },
      "admin",
      409,
    );
    eq(calls, 1);
    await req("/projects/" + b.projectId, "DELETE");
    await req("/canvases/" + b.id, "GET", undefined, "admin", 404);
    eq((await req("/canvases?page=1")).total, 0);
    await req("/projects/" + b.projectId + "/restore", "POST");
    eq((await req("/canvases/" + b.id)).data.nodes.length, 100);
    eq((await req("/canvases?page=1")).total, 1);
    // Sharing uses the existing project permissions; viewers cannot save or bypass asset approval.
    const project = await req("/projects/" + b.projectId);
    await req("/projects/" + project.id, "PUT", {
      name: project.name,
      version: project.version,
      visibility: "tenant",
      participants: [],
      brief: project.brief,
    });
    eq((await req("/canvases?page=1", "GET", undefined, "buyer")).total, 1);
    await req(
      "/canvases/" + b.id,
      "PUT",
      { version: saved.version, data: full },
      "buyer",
      403,
    );
    await req("/members", "PUT", {
      membershipId: f.accounts.buyer.memberId,
      role: "creator",
    });
    eq(
      (await req("/canvases/" + b.id, "GET", undefined, "buyer")).projectId,
      b.projectId,
    );
    eq(calls, 1);
    console.log(
      JSON.stringify({
        suite: "content-canvas",
        checks,
        httpChecks: h.checks(),
        providerStubCalls: calls,
        paidCalls: 0,
      }),
    );
  } finally {
    for (const fixture of [f, other].filter(Boolean)) {
      await cleanupFixture(db, fixture);
      if (process.env.CONTENT_STORAGE_PATH)
        fs.rmSync(
          path.join(process.env.CONTENT_STORAGE_PATH, fixture.tenant.id),
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
function href(h, app, p) {
  return `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1` + p;
}
