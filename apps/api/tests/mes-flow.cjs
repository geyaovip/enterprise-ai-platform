const assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto");
const { createApp } = require("../dist/server"),
  { PrismaService } = require("../dist/modules/prisma.service"),
  { AuthService } = require("../dist/modules/platform/auth.service"),
  { MesService } = require("../dist/modules/mes/mes.service"),
  {
    createFixture,
    fixtureHttp,
    cleanupFixture,
  } = require("../scripts/workflow-fixture.cjs");
(async () => {
  assert.match(
    process.env.DATABASE_URL ?? "",
    /@127\.0\.0\.1:54329\/suite_phase1_qa/,
  );
  const db = new PrismaService();
  let f,
    foreign,
    app,
    checks = 0;
  const eq = (a, b) => {
      assert.deepEqual(a, b);
      checks++;
    },
    ok = (x) => {
      assert.ok(x);
      checks++;
    };
  try {
    f = await createFixture(
      db,
      "erp-flow-test-mes-" + randomUUID().slice(0, 8),
    );
    foreign = await createFixture(
      db,
      "erp-flow-test-mes-foreign-" + randomUUID().slice(0, 8),
    );
    for (const t of [f, foreign])
      await db.tenantApp.create({
        data: { tenantId: t.tenant.id, appId: "mes" },
      });
    for (const [key, role] of [
      ["buyer", "operator"],
      ["warehouse", "operator"],
      ["sales", "planner"],
      ["reviewer", "supervisor"],
      ["finance", "viewer"],
    ])
      await db.mesMemberGrant.create({
        data: {
          tenantId: f.tenant.id,
          membershipId: f.accounts[key].memberId,
          role,
        },
      });
    app = await createApp();
    const h = await fixtureHttp(app, f),
      prefix = "/tenants/" + f.tenant.slug + "/apps/mes";
    const get = async (p, key = "admin", status = 200) =>
      (await h.request(prefix + p, "GET", undefined, key, status)).data;
    const post = async (p, b, key = "admin", status = 201) =>
      (await h.request(prefix + p, "POST", b, key, status)).data;
    const write = (p, b, key = "admin", status = 201) =>
      post(p, { requestKey: randomUUID(), ...b }, key, status);
    eq((await get("/metadata", "buyer")).ownOnly, true);
    eq((await get("/metadata", "sales")).role, "planner");
    await get("/materials", "buyer", 403);
    await get("/metadata", "reviewer2", 403);
    const cat = await h.request("/tenants/" + f.tenant.slug + "/applications");
    ok(cat.data.some((a) => a.appId === "mes"));
    await db.tenantApp.update({
      where: { tenantId_appId: { tenantId: f.tenant.id, appId: "erp" } },
      data: { enabled: false },
    });
    eq((await get("/dashboard")).scope, "tenant");
    const material = async (sku, kind = "raw", unit = "件") =>
      write("/materials", { sku, name: sku, kind, unit });
    const p = await material("FINISHED", "finished"),
      semi = await material("SUB", "semi"),
      raw = await material("RAW", "raw", "千克"),
      pack = await material("PACK", "packaging");
    await write(
      "/materials",
      { sku: "BAD", name: "BAD", kind: "semi", unit: "kg" },
      "admin",
      409,
    );
    await material("FINISHED")
      .then(() => assert.fail("duplicate accepted"))
      .catch((e) => {
        ok(e.message.includes("409"));
      });
    const makeBom = (product, lines, key = "admin") =>
      write(
        "/boms",
        {
          draft: {
            productId: product.id,
            lines: lines.map(([m, q, w = "0"]) => ({
              materialId: m.id,
              quantity: q,
              wastePercent: w,
            })),
          },
        },
        key,
      );
    const sub = await makeBom(semi, [[raw, "0.333", "10"]]);
    await write("/boms/" + sub.id + "/publish", { version: sub.version });
    const b = await makeBom(p, [
      [semi, "2"],
      [raw, "0.001"],
      [pack, "1"],
    ]);
    await write(
      "/boms/" + b.id + "/publish",
      { version: b.version - 1 },
      "admin",
      400,
    );
    const fakeLine = await write(
      "/boms/" + b.id + "/reviews",
      {
        version: b.version,
        findings: [
          { lineId: randomUUID(), severity: "critical", message: "假行" },
        ],
      },
      "admin",
      409,
    );
    ok(fakeLine.error);
    const review = await write("/boms/" + b.id + "/reviews", {
      version: b.version,
      findings: [
        {
          lineId: b.lines[0].id,
          severity: "warning",
          message: "核实半成品单件用量",
        },
      ],
    });
    await write(
      "/boms/" + b.id + "/publish",
      { version: b.version },
      "admin",
      409,
    );
    await write(
      "/boms/" + b.id + "/review-resolution",
      {
        version: b.version,
        reviewId: review.id,
        reviewVersion: review.version,
        decisions: [],
      },
      "admin",
      409,
    );
    await write("/boms/" + b.id + "/review-resolution", {
      version: b.version,
      reviewId: review.id,
      reviewVersion: review.version,
      decisions: [
        {
          findingId: review.findings[0].id,
          decision: "verified_retain",
          reason: "已核对工程图纸，单件确需两个",
        },
      ],
    });
    const published = await write("/boms/" + b.id + "/publish", {
      version: b.version,
    });
    eq(published.status, "published");
    const draft = {
      code: "PLAN-1",
      productId: p.id,
      bomId: b.id,
      targetQty: 3,
      dueAt: new Date(Date.now() + 86400000).toISOString(),
    };
    const preview = await post("/plans/preview", draft);
    eq(
      preview.requirements.find((l) => l.materialId === raw.id).quantity,
      "2.201",
    );
    eq(preview.bomVersions.length, 2);
    const req = randomUUID(),
      plan = await post("/plans", { requestKey: req, draft });
    eq((await post("/plans", { requestKey: req, draft })).id, plan.id);
    await post(
      "/plans",
      { requestKey: req, draft: { ...draft, code: "OTHER" } },
      "admin",
      409,
    );
    eq(plan.requirements, preview.requirements);
    const b2 = await makeBom(p, [[raw, "9"]]);
    await write("/boms/" + b2.id + "/publish", { version: b2.version });
    eq((await get("/boms/" + b.id)).status, "archived");
    eq((await get("/plans/" + plan.id)).requirements, plan.requirements);
    await h.request(
      prefix + "/materials/" + raw.id,
      "PATCH",
      {
        requestKey: randomUUID(),
        version: raw.version,
        sku: raw.sku,
        name: "renamed",
        kind: raw.kind,
        unit: raw.unit,
        active: false,
      },
      "admin",
      409,
    );
    await h.request(
      prefix + "/materials/" + raw.id,
      "PATCH",
      {
        requestKey: randomUUID(),
        version: raw.version,
        sku: raw.sku,
        name: "renamed",
        kind: raw.kind,
        unit: "克",
        active: true,
      },
      "admin",
      409,
    );
    const cycle = await makeBom(semi, [[p, "1"]]);
    await write("/boms/" + cycle.id + "/publish", { version: cycle.version });
    const rootCycle = await makeBom(p, [[semi, "1"]]);
    await write(
      "/boms/" + rootCycle.id + "/publish",
      { version: rootCycle.version },
      "admin",
      409,
    );
    await write("/plans/" + plan.id + "/actions", {
      version: plan.version,
      action: "release",
    });
    let current = await get("/plans/" + plan.id);
    const allocation = (code, qty, assignee = f.accounts.buyer.memberId) =>
      write("/plans/" + plan.id + "/orders", {
        version: current.version,
        code,
        operation: "装配",
        targetQty: qty,
        assigneeId: assignee,
      });
    const order = await allocation("ORDER-1", 2);
    current = await get("/plans/" + plan.id);
    await allocation("OVER", 2)
      .then(() => assert.fail())
      .catch((e) => ok(e.message.includes("409")));
    const other = await allocation("ORDER-2", 1, f.accounts.warehouse.memberId);
    await get("/orders/" + other.id, "buyer", 404);
    const ownPlan = await get("/plans/" + plan.id, "buyer");
    eq(ownPlan.orders.length, 1);
    ok(!("requirements" in ownPlan));
    ok(!("targetQty" in ownPlan));
    eq((await get("/orders", "buyer")).total, 1);
    eq((await get("/dashboard", "buyer")).target, 2);
    await write(
      "/orders/" + order.id + "/reports",
      { version: order.version, goodQty: 1, defectQty: 0 },
      "buyer",
      409,
    );
    await write(
      "/orders/" + order.id + "/actions",
      { version: order.version, action: "start" },
      "warehouse",
      404,
    );
    await write(
      "/orders/" + order.id + "/actions",
      { version: order.version, action: "start" },
      "buyer",
    );
    let o = await get("/orders/" + order.id, "buyer");
    const report = await write(
      "/orders/" + order.id + "/reports",
      { version: o.version, goodQty: 1, defectQty: 1 },
      "buyer",
    );
    eq((await get("/dashboard")).good, 0);
    o = await get("/orders/" + order.id, "buyer");
    await write(
      "/orders/" + order.id + "/reports",
      { version: o.version, goodQty: 1, defectQty: 0 },
      "buyer",
      409,
    );
    await write(
      "/reports/" + report.id + "/review",
      { version: report.version, decision: "approve" },
      "buyer",
      403,
    );
    await write(
      "/reports/" + report.id + "/review",
      { version: report.version, decision: "reject" },
      "reviewer",
      409,
    );
    await write(
      "/reports/" + report.id + "/review",
      { version: report.version, decision: "reject", reason: "重新核实产量" },
      "reviewer",
    );
    o = await get("/orders/" + order.id, "buyer");
    const r2 = await write(
      "/orders/" + order.id + "/reports",
      { version: o.version, goodQty: 2, defectQty: 0 },
      "buyer",
    );
    const results = await Promise.all([
      write(
        "/reports/" + r2.id + "/review",
        { version: r2.version, decision: "approve" },
        "reviewer",
        null,
      ),
      write(
        "/reports/" + r2.id + "/review",
        { version: r2.version, decision: "approve" },
        "reviewer",
        null,
      ),
    ]);
    ok(results[0].status === "approved" || results[1].status === "approved");
    eq((await get("/orders/" + order.id)).goodQty, 2);
    eq((await get("/orders/" + order.id)).reports.length, 2);
    // No actor, including an admin, may approve their own report.
    const selfPlan = await write("/plans", {
      draft: { ...draft, code: "SELF", bomId: b2.id, targetQty: 1 },
    });
    await write("/plans/" + selfPlan.id + "/actions", {
      version: selfPlan.version,
      action: "release",
    });
    const sp = await get("/plans/" + selfPlan.id),
      so = await write("/plans/" + sp.id + "/orders", {
        version: sp.version,
        code: "SELF-ORDER",
        operation: "自测",
        targetQty: 1,
        assigneeId: f.accounts.admin.memberId,
      });
    await write("/orders/" + so.id + "/actions", {
      version: so.version,
      action: "start",
    });
    const started = await get("/orders/" + so.id),
      sr = await write("/orders/" + so.id + "/reports", {
        version: started.version,
        goodQty: 1,
        defectQty: 0,
      });
    await write(
      "/reports/" + sr.id + "/review",
      { version: sr.version, decision: "approve" },
      "admin",
      403,
    );
    await write(
      "/reports/" + sr.id + "/review",
      { version: sr.version, decision: "approve" },
      "reviewer",
    );
    eq((await get("/plans/" + sp.id)).status, "completed");
    // Complete the remaining allocation with a defect: ended production does not imply 100% good.
    await write(
      "/orders/" + other.id + "/actions",
      { version: other.version, action: "start" },
      "warehouse",
    );
    const wo = await get("/orders/" + other.id, "warehouse");
    const defective = await write(
      "/orders/" + other.id + "/reports",
      { version: wo.version, goodQty: 0, defectQty: 1 },
      "warehouse",
    );
    await write(
      "/reports/" + defective.id + "/review",
      { version: defective.version, decision: "approve" },
      "reviewer",
    );
    eq((await get("/plans/" + plan.id)).status, "completed");
    const summary = await get("/dashboard", "buyer");
    eq(summary.progress, 100);
    eq((await get("/dashboard", "warehouse")).progress, 0);
    eq((await get("/dashboard", "warehouse")).defect, 1);
    // Aggregate before rounding, across two branches that each need 0.0004 of the same leaf.
    const s1 = await material("ROUND-S1", "semi"),
      s2 = await material("ROUND-S2", "semi"),
      rp = await material("ROUND-P", "finished");
    for (const sm of [s1, s2]) {
      const sb = await makeBom(sm, [[raw, "0.004"]]);
      await write("/boms/" + sb.id + "/publish", { version: sb.version });
    }
    const rb = await makeBom(rp, [
      [s1, "0.1"],
      [s2, "0.1"],
    ]);
    await write("/boms/" + rb.id + "/publish", { version: rb.version });
    const rounded = await post("/plans/preview", {
      ...draft,
      code: "ROUND",
      productId: rp.id,
      bomId: rb.id,
      targetQty: 1,
    });
    eq(rounded.requirements[0].quantity, "0.001");
    // Concurrent allocations use the same plan version: exactly one can reserve its quantity.
    const cp = await write("/plans", {
      draft: { ...draft, code: "RACE", bomId: b2.id, targetQty: 1 },
    });
    await write("/plans/" + cp.id + "/actions", {
      version: cp.version,
      action: "release",
    });
    const cplan = await get("/plans/" + cp.id),
      race = await Promise.all(
        ["A", "B"].map((code) =>
          write(
            "/plans/" + cp.id + "/orders",
            {
              version: cplan.version,
              code: "RACE-" + code,
              operation: "装配",
              targetQty: 1,
              assigneeId: f.accounts.buyer.memberId,
            },
            "admin",
            null,
          ),
        ),
      );
    eq(race.filter((x) => x.id).length, 1);
    eq((await get("/plans/" + cp.id)).orders.length, 1);
    // Deep BOMs are rejected before publishing the eleventh layer.
    let child = raw;
    for (let depth = 1; depth <= 11; depth++) {
      const mp = await material("DEPTH-" + depth, "semi"),
        mb = await makeBom(mp, [[child, "1"]]);
      await write(
        "/boms/" + mb.id + "/publish",
        { version: mb.version },
        "admin",
        depth === 11 ? 409 : 201,
      );
      child = mp;
    }
    checks++;
    // Cross-tenant IDs cannot be read or selected, and app revocation takes effect immediately.
    const foreignMaterial = await db.mesMaterial.create({
      data: {
        tenantId: foreign.tenant.id,
        sku: "FOREIGN",
        name: "私有物料",
        kind: "raw",
        unit: "件",
      },
    });
    await write(
      "/boms",
      {
        draft: {
          productId: p.id,
          lines: [{ materialId: foreignMaterial.id, quantity: "1" }],
        },
      },
      "admin",
      409,
    );
    await get("/boms/" + randomUUID(), "admin", 404);
    await db.tenantApp.update({
      where: { tenantId_appId: { tenantId: f.tenant.id, appId: "mes" } },
      data: { enabled: false },
    });
    await get("/dashboard", "admin", 403);
    await db.tenantApp.update({
      where: { tenantId_appId: { tenantId: f.tenant.id, appId: "mes" } },
      data: { enabled: true },
    });
    ok((await get("/audit")).length > 10);
    await get("/audit", "buyer", 403);
    const grants = await get("/settings/access");
    const grant = grants.find((m) => m.id === f.accounts.buyer.memberId);
    await h.request(prefix + "/settings/access", "PUT", {
      requestKey: randomUUID(),
      membershipId: grant.id,
      version: grant.grant.version,
      role: null,
    });
    await get("/metadata", "buyer", 403);
    const auth = app.get(AuthService),
      mes = app.get(MesService),
      ctx = await auth.taskContext({
        tenantId: f.tenant.id,
        userId: f.accounts.admin.userId,
        membershipId: f.accounts.admin.memberId,
        appId: "mes",
        taskId: randomUUID(),
      });
    await assert.rejects(() =>
      mes.guard({ ...ctx, app: { appId: "erp" } }, "mes.production.read"),
    );
    checks++;
    const { CommandBus } = require("../dist/modules/orchestration/command-bus");
    const bus = app.get(CommandBus),
      commandKey = randomUUID(),
      commandDraft = { ...draft, code: "PUBLIC-COMMAND", bomId: b2.id };
    await assert.rejects(() =>
      bus.execute(
        ctx,
        "mes",
        "mes.plan.create_draft",
        commandDraft,
        commandKey,
        false,
      ),
    );
    checks++;
    const command = await bus.execute(
      ctx,
      "mes",
      "mes.plan.create_draft",
      commandDraft,
      commandKey,
      true,
    );
    eq(command.state, "completed");
    eq(
      (
        await bus.execute(
          ctx,
          "mes",
          "mes.plan.create_draft",
          commandDraft,
          commandKey,
          true,
        )
      ).result.id,
      command.result.id,
    );
    eq(
      await db.mesPlan.count({
        where: { tenantId: f.tenant.id, code: "PUBLIC-COMMAND" },
      }),
      1,
    );
    eq(await db.erpProduct.count({ where: { tenantId: f.tenant.id } }), 0);
    console.log(
      JSON.stringify({
        ok: true,
        assertions: checks,
        httpChecks: h.checks(),
        paidModelCalls: 0,
      }),
    );
  } finally {
    if (app) await app.close();
    if (f) await cleanupFixture(db, f);
    if (foreign) await cleanupFixture(db, foreign);
    await db.$disconnect();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
