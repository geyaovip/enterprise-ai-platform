const assert = require("node:assert/strict");
const { randomUUID, randomBytes } = require("node:crypto");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
if (
  process.env.NODE_ENV !== "test" ||
  !/@127\.0\.0\.1:54329\/suite_phase1_qa$/.test(process.env.DATABASE_URL || "")
)
  throw Error("Isolated QA only");
process.env.NATIVE_AI_MODEL_ENABLED = "true";
const storage = mkdtempSync(join(tmpdir(), "module-completeness-"));
process.env.KNOWLEDGE_STORAGE_DIR = storage;
process.env.AI_ENCRYPTION_KEY = randomBytes(32).toString("base64");
const { createApp } = require("../dist/server");
const { PrismaService } = require("../dist/modules/prisma.service");
const {
  createFixture,
  fixtureHttp,
  cleanupFixture,
} = require("../scripts/workflow-fixture.cjs");
let app, db;
const fixtures = [];
let checks = 0;
const eq = (a, b) => {
  assert.deepEqual(a, b);
  checks++;
};
(async () => {
  try {
    app = await createApp();
    db = app.get(PrismaService);
    const f = await createFixture(
        db,
        "erp-flow-test-complete-" + randomUUID().slice(0, 8),
      ),
      other = await createFixture(
        db,
        "erp-flow-test-complete-" + randomUUID().slice(0, 8),
      );
    fixtures.push(f, other);
    await db.tenantApp.createMany({
      data: ["crm", "mes"].map((appId) => ({
        tenantId: f.tenant.id,
        appId,
        granted: true,
        enabled: true,
      })),
    });
    await db.tenantCapability.create({
      data: {
        tenantId: f.tenant.id,
        capability: "knowledge",
        delivered: true,
        enabled: true,
      },
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
      base = "/tenants/" + f.tenant.slug;
    const req = async (
      p,
      method = "GET",
      body,
      who = "admin",
      expected = method === "POST" ? 201 : 200,
    ) => (await h.request(base + p, method, body, who, expected)).data;
    const past = new Date(Date.now() - 60000),
      a = f.accounts.admin;
    const personal = async (data = {}) =>
      db.personalNotification.create({
        data: {
          tenantId: f.tenant.id,
          recipientMembershipId: a.memberId,
          appId: "crm",
          kind: "crm-task",
          resourceId: randomUUID(),
          dedupeKey: randomUUID(),
          title: "客户跟进通知",
          body: "隔离测试",
          createdAt: past,
          ...data,
        },
      });
    await personal();
    await personal({ readAt: new Date() });
    const excludedBom = await personal({ appId: "mes", kind: "mes-bom" });
    const otherMember = await personal({
      recipientMembershipId: f.accounts.sales.memberId,
    });
    const otherTenant = await personal({
      tenantId: other.tenant.id,
      recipientMembershipId: other.accounts.admin.memberId,
    });
    await db.erpNotification.createMany({
      data: Array.from({ length: 108 }, (_, i) => ({
        tenantId: f.tenant.id,
        recipientMembershipId: a.memberId,
        title: "采购提醒" + i,
        body: "隔离测试",
        dedupeKey: randomUUID(),
        readAt: i < 105 ? new Date() : null,
        createdAt: new Date(past.getTime() - i * 1000),
      })),
    });
    let feed = await req("/notifications?status=unread&page_size=2");
    eq(feed.total, 4);
    eq(feed.unread, 4);
    eq(feed.items.length, 2);
    eq(
      feed.items.every((n) => n.readAt === null),
      true,
    );
    eq(
      (await req("/notifications?status=unread&page=2&page_size=2")).items
        .length,
      2,
    );
    await req("/notifications?status=invalid", "GET", undefined, "admin", 400);
    await req(
      "/notifications/read-all",
      "POST",
      { through: feed.readThrough, extra: true },
      "admin",
      400,
    );
    const late = await personal({
      createdAt: new Date(Date.parse(feed.readThrough) + 5000),
    });
    eq(
      (
        await req("/notifications/read-all", "POST", {
          through: feed.readThrough,
        })
      ).read,
      4,
    );
    eq(
      (
        await req("/notifications/read-all", "POST", {
          through: feed.readThrough,
        })
      ).read,
      0,
    );
    eq(
      (await db.personalNotification.findUnique({ where: { id: late.id } }))
        .readAt,
      null,
    );
    for (const id of [excludedBom.id, otherMember.id, otherTenant.id])
      eq(
        (await db.personalNotification.findUnique({ where: { id } })).readAt,
        null,
      );
    feed = await req("/notifications?status=unread");
    eq(feed.total, 1);
    eq(feed.items[0].id, "platform." + late.id);
    eq((await req("/notifications")).total, 111);
    // Removing ERP must not prevent CRM or management notifications from being read.
    await db.tenantApp.update({
      where: { tenantId_appId: { tenantId: f.tenant.id, appId: "erp" } },
      data: { enabled: false },
    });
    eq((await req("/notifications")).total, 3);
    await db.tenantApp.update({
      where: { tenantId_appId: { tenantId: f.tenant.id, appId: "erp" } },
      data: { enabled: true },
    });
    // Existing sessions belonging to another tenant cannot read or mutate this tenant.
    const {
      newSessionToken,
      tokenHash,
    } = require("../dist/modules/platform/security");
    const token = newSessionToken();
    await db.session.create({
      data: {
        userId: other.accounts.admin.userId,
        tokenHash: tokenHash(token),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    h.cookies.outsider = "suite_session=" + token;
    await req(
      "/notifications/read-all",
      "POST",
      { through: new Date().toISOString() },
      "outsider",
      403,
    );
    const space = await req("/knowledge/spaces", "POST", {
      name: "企业流程",
      visibility: "tenant",
    });
    const upload = async (title, filename) =>
      req(`/knowledge/spaces/${space.id}/documents`, "POST", {
        title,
        filename,
        contentBase64: Buffer.from("# " + title).toString("base64"),
      });
    const doc = await upload("Brand GUIDE", "brand.md");
    await upload("采购规范", "purchase.md");
    eq(
      (await req(`/knowledge/spaces/${space.id}/documents?q=guide&pageSize=1`))
        .total,
      1,
    );
    eq(
      (await req(`/knowledge/spaces/${space.id}/documents?q=guide&pageSize=1`))
        .items[0].id,
      doc.id,
    );
    await req(
      `/knowledge/documents/${doc.id}`,
      "PATCH",
      { status: "archived", version: 1 },
      "admin",
      200,
    );
    eq(
      (await req(`/knowledge/spaces/${space.id}/documents?status=active`))
        .total,
      1,
    );
    eq(
      (await req(`/knowledge/spaces/${space.id}/documents?status=archived`))
        .items[0].id,
      doc.id,
    );
    eq(
      (await req(`/knowledge/spaces/${space.id}/documents?status=all`)).total,
      2,
    );
    await req(
      `/knowledge/spaces/${space.id}/documents?status=deleted`,
      "GET",
      undefined,
      "admin",
      400,
    );
    await req(
      `/knowledge/spaces/${space.id}/documents?q=${"a".repeat(121)}`,
      "GET",
      undefined,
      "admin",
      400,
    );
    const secretSpace = await req("/knowledge/spaces", "POST", {
      name: "管理资料",
      visibility: "restricted",
    });
    await req(
      `/knowledge/spaces/${secretSpace.id}/documents?q=资料`,
      "GET",
      undefined,
      "sales",
      404,
    );
    await req(
      `/knowledge/spaces/${space.id}/documents`,
      "GET",
      undefined,
      "outsider",
      403,
    );
    const tasks = [];
    for (let i = 0; i < 23; i++)
      tasks.push(
        await db.businessTask.create({
          data: {
            tenantId: f.tenant.id,
            userId: a.userId,
            membershipId: a.memberId,
            appId: "erp",
            requestKey: randomUUID(),
            fingerprint: randomUUID(),
            title: i < 2 ? "待恢复的采购计划 " + i : "已完成流程 " + i,
            input: {},
            status: i < 2 ? "failed" : "completed",
            createdAt: new Date(Date.now() - i * 1000),
            steps: {
              create: {
                tenantId: f.tenant.id,
                ordinal: 0,
                appId: "erp",
                command: "erp.purchase.wait_for_receipt",
                title: "等待入库",
                input: { id: randomUUID() },
                status: i < 2 ? "failed" : "completed",
              },
            },
          },
        }),
      );
    let list = await req("/tasks?status=failed&q=采购&page=1&page_size=1");
    eq(list.total, 2);
    eq(list.items.length, 1);
    eq(list.items[0].id, tasks[0].id);
    eq(
      (await req("/tasks?status=failed&q=采购&page=2&page_size=1")).items[0].id,
      tasks[1].id,
    );
    eq(
      (await req("/tasks?status=completed&q=采购&page=1&page_size=1")).total,
      0,
    );
    eq(
      (
        await req(
          "/tasks?status=failed&page=1&page_size=5",
          "GET",
          undefined,
          "sales",
        )
      ).total,
      0,
    );
    await req("/tasks?status=invalid", "GET", undefined, "admin", 400);
    await req("/tasks?q=" + "a".repeat(121), "GET", undefined, "admin", 400);
    await req("/tasks/" + tasks[0].id, "GET", undefined, "sales", 404);
    await req(
      "/tasks/" + tasks[0].id + "/actions",
      "POST",
      { action: "retry", version: 0 },
      "admin",
      400,
    );
    await req("/tasks/" + tasks[0].id + "/actions", "POST", {
      action: "retry",
      version: 1,
    });
    eq((await req("/tasks/" + tasks[0].id)).status, "queued");
    await req(
      "/tasks/" + tasks[0].id + "/actions",
      "POST",
      { action: "cancel", version: 1 },
      "admin",
      409,
    );
    await req("/tasks/" + tasks[0].id + "/actions", "POST", {
      action: "cancel",
      version: 2,
    });
    eq((await req("/tasks/" + tasks[0].id)).status, "cancelled");
    await db.tenantApp.update({
      where: { tenantId_appId: { tenantId: f.tenant.id, appId: "erp" } },
      data: { enabled: false },
    });
    eq((await req("/tasks?q=采购&page=1&page_size=10")).total, 0);
    eq(
      (await req("/tasks?page=1&page_size=30")).items.every(
        (t) => t.restricted === true,
      ),
      true,
    );
    await req(`/tasks/${tasks[1].id}/actions`, "POST", {
      action: "cancel",
      version: 1,
    });
    eq(
      (await db.businessTask.findUnique({ where: { id: tasks[1].id } })).status,
      "cancelled",
    );
    await db.tenantApp.update({
      where: { tenantId_appId: { tenantId: f.tenant.id, appId: "erp" } },
      data: { enabled: true },
    });
    const createAiJob = (status) =>
      db.aiTask.create({
        data: {
          tenantId: f.tenant.id,
          userId: a.userId,
          membershipId: a.memberId,
          appId: "erp",
          kind: "extract",
          input: { kind: "purchase" },
          status,
        },
      });
    const runningJob = await createAiJob("queued");
    await req(`/ai/tasks/${runningJob.id}/cancel`, "POST", {});
    eq(
      (await db.aiTask.findUnique({ where: { id: runningJob.id } })).status,
      "cancelled",
    );
    await req(`/ai/tasks/${runningJob.id}/cancel`, "POST", {}, "admin", 409);
    for (const state of ["completed", "failed"]) {
      const job = await createAiJob(state);
      await req(`/ai/tasks/${job.id}/cancel`, "POST", {}, "admin", 409);
      eq((await db.aiTask.findUnique({ where: { id: job.id } })).status, state);
    }
    const managementNotice = await personal({
      appId: "tenant_admin",
      kind: "conversation",
    });
    await db.tenantApp.updateMany({
      where: { tenantId: f.tenant.id },
      data: { enabled: false },
    });
    eq(
      (await req("/notifications?status=unread")).items.map((n) => n.id),
      ["platform." + managementNotice.id],
    );
    eq(
      (
        await req("/notifications/read-all", "POST", {
          through: new Date().toISOString(),
        })
      ).read,
      1,
    );
    await db.tenantApp.updateMany({
      where: { tenantId: f.tenant.id },
      data: { enabled: true },
    });
    console.log(
      JSON.stringify({
        checks,
        httpChecks: h.checks(),
        modules: ["notifications", "knowledge", "tasks", "ai-cancellation"],
        paidModelCalls: 0,
        tenantIsolation: true,
        lateNotificationsPreserved: true,
      }),
    );
  } finally {
    if (db) {
      for (const f of fixtures) {
        await db.knowledgeCitation.deleteMany({
          where: { tenantId: f.tenant.id },
        });
        const docs = await db.knowledgeDocument.findMany({
          where: { tenantId: f.tenant.id },
          select: { id: true },
        });
        const ids = docs.map((d) => d.id);
        await db.knowledgeIndex.deleteMany({
          where: { tenantId: f.tenant.id },
        });
        await db.knowledgeDocumentVersion.deleteMany({
          where: { documentId: { in: ids } },
        });
        await db.knowledgeDocument.deleteMany({
          where: { tenantId: f.tenant.id },
        });
        await db.knowledgeGrant.deleteMany({
          where: { tenantId: f.tenant.id },
        });
        await db.knowledgeSpace.deleteMany({
          where: { tenantId: f.tenant.id },
        });
        await cleanupFixture(db, f);
      }
    }
    await app?.close();
    rmSync(storage, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
