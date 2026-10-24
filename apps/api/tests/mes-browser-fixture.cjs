const fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
const { createApp } = require("../dist/server"),
  { PrismaService } = require("../dist/modules/prisma.service"),
  { AuthService } = require("../dist/modules/platform/auth.service"),
  { MesService } = require("../dist/modules/mes/mes.service"),
  {
    createFixture,
    cleanupFixture,
  } = require("../scripts/workflow-fixture.cjs");
(async () => {
  if (!process.env.DATABASE_URL.includes("@127.0.0.1:54329/suite_phase1_qa"))
    throw Error("QA only");
  const db = new PrismaService(),
    app = await createApp();
  await app.init();
  const f = await createFixture(
    db,
    "erp-flow-test-mes-ui-" + randomUUID().slice(0, 8),
  );
  await db.tenantApp.createMany({
    data: ["mes", "crm"].map((appId) => ({ tenantId: f.tenant.id, appId })),
  });
  await db.tenantCapability.create({
    data: {
      tenantId: f.tenant.id,
      capability: "ai",
      delivered: true,
      enabled: true,
    },
  });
  for (const [key, role] of [
    ["buyer", "operator"],
    ["reviewer", "supervisor"],
  ])
    await db.mesMemberGrant.create({
      data: {
        tenantId: f.tenant.id,
        membershipId: f.accounts[key].memberId,
        role,
      },
    });
  const auth = app.get(AuthService),
    mes = app.get(MesService),
    ctx = await auth.taskContext({
      tenantId: f.tenant.id,
      userId: f.accounts.admin.userId,
      membershipId: f.accounts.admin.memberId,
      appId: "mes",
      taskId: randomUUID(),
    });
  const mat = async (sku, name, kind, unit = "件") =>
    mes.saveMaterial(ctx, undefined, {
      requestKey: randomUUID(),
      sku,
      name,
      kind,
      unit,
    });
  const p = await mat("CTRL-100", "智能控制器", "finished"),
    board = await mat("PCB-001", "控制主板", "raw"),
    shell = await mat("CASE-001", "铝合金外壳", "raw"),
    screw = await mat("SCREW-01", "固定螺丝", "auxiliary");
  const draft = {
    productId: p.id,
    note: "演示工程版本",
    lines: [
      { materialId: board.id, quantity: "1", wastePercent: "2" },
      { materialId: shell.id, quantity: "1", wastePercent: "1" },
      { materialId: screw.id, quantity: "4", wastePercent: "0" },
    ],
  };
  const bom = await mes.saveBom(ctx, undefined, {
    requestKey: randomUUID(),
    draft,
  });
  await mes.publishBom(ctx, bom.id, {
    requestKey: randomUUID(),
    version: bom.version,
  });
  const pending = await mes.saveBom(ctx, undefined, {
    requestKey: randomUUID(),
    draft,
  });
  const plan = await mes.savePlan(ctx, undefined, {
    requestKey: randomUUID(),
    draft: {
      code: "MO-20261023-001",
      productId: p.id,
      bomId: bom.id,
      targetQty: 100,
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      note: "演示生产计划",
    },
  });
  await mes.planAction(ctx, plan.id, {
    requestKey: randomUUID(),
    version: plan.version,
    action: "release",
  });
  const current = await mes.get(ctx, "plan", plan.id),
    order = await mes.createOrder(ctx, plan.id, {
      requestKey: randomUUID(),
      version: current.version,
      code: "WO-20261023-001",
      operation: "组装与通电测试",
      targetQty: 100,
      assigneeId: f.accounts.buyer.memberId,
    });
  const op = await auth.taskContext({
    tenantId: f.tenant.id,
    userId: f.accounts.buyer.userId,
    membershipId: f.accounts.buyer.memberId,
    appId: "mes",
    taskId: randomUUID(),
  });
  await mes.orderAction(op, order.id, {
    requestKey: randomUUID(),
    version: order.version,
    action: "start",
  });
  const opened = await mes.get(op, "order", order.id);
  const report = await mes.report(op, order.id, {
    requestKey: randomUUID(),
    version: opened.version,
    goodQty: 62,
    defectQty: 3,
    note: "首批完成",
  });
  await mes.review(ctx, report.id, {
    requestKey: randomUUID(),
    version: report.version,
    decision: "approve",
  });
  const o = await mes.get(op, "order", order.id);
  await mes.report(op, order.id, {
    requestKey: randomUUID(),
    version: o.version,
    goodQty: 20,
    defectQty: 0,
    note: "第二批待审核",
  });
  await app.listen(4636, "127.0.0.1");
  const token = (
    await auth.login(
      f.accounts.admin.email,
      f.accounts.admin.password,
      "127.0.0.1",
    )
  ).token;
  const out = path.resolve(
    "../../var/operations/20261023-mes/browser-fixture.json",
  );
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        slug: f.tenant.slug,
        token,
        bomId: pending.id,
        publishedBomId: bom.id,
        planId: plan.id,
        orderId: order.id,
        accounts: f.accounts,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(JSON.stringify({ ready: true, port: 4636, slug: f.tenant.slug }));
  const stop = async () => {
    await app.close();
    await cleanupFixture(db, f);
    fs.rmSync(out, { force: true });
    await db.$disconnect();
    process.exit(0);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
