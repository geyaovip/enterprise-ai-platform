const assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto");
const { createApp } = require("../dist/server"),
  { PrismaService } = require("../dist/modules/prisma.service");
const { CrmCore } = require("../dist/modules/crm/crm-core.service");
const {
  createFixture,
  fixtureHttp,
  cleanupFixture,
} = require("../scripts/workflow-fixture.cjs");
const k = () => randomUUID(),
  all = { orgUnitIds: "all", channelIds: "all" },
  now = new Date("2026-10-26T03:00:00Z");
(async () => {
  if (
    !/^postgresql:\/\/[^@]+@127\.0\.0\.1:54329\/suite_phase1_qa(?:\?|$)/.test(
      process.env.DATABASE_URL ?? "",
    )
  )
    throw Error("Dedicated unified CRM QA database required");
  const db = new PrismaService();
  let f, other, app;
  try {
    f = await createFixture(db, "erp-flow-test-unified-" + k().slice(0, 8));
    other = await createFixture(
      db,
      "erp-flow-test-unified-other-" + k().slice(0, 8),
    );
    for (const tenantId of [f.tenant.id, other.tenant.id]) {
      await db.tenantApp.deleteMany({ where: { tenantId } });
      await db.tenantApp.create({ data: { tenantId, appId: "crm" } });
    }
    const org = await db.orgUnit.create({
        data: { tenantId: f.tenant.id, name: "销售组织" },
      }),
      org2 = await db.orgUnit.create({
        data: { tenantId: f.tenant.id, name: "隔离组织" },
      });
    app = await createApp();
    const svc = app.get(
      require("../dist/modules/crm/engagement.service").CrmEngagementService,
    );
    for (const name of [
      "createCustomer",
      "leadAction",
      "saveOpportunity",
      "createPlan",
      "workbench",
    ]) {
      const original = svc[name].bind(svc);
      svc[name] = async (...args) => {
        try {
          return await original(...args);
        } catch (e) {
          if (!e.getStatus) console.error(name, e);
          throw e;
        }
      };
    }
    app.get(CrmCore).now = () => now;
    const h = await fixtureHttp(app, f),
      base = `/tenants/${f.tenant.slug}/apps/crm`;
    const get = async (p, who = "admin", expected = 200) =>
        (await h.request(base + p, "GET", undefined, who, expected)).data,
      post = async (p, b, who = "admin", expected = 201) =>
        (await h.request(base + p, "POST", b, who, expected)).data,
      patch = async (p, b, who = "admin", expected = 200) =>
        (await h.request(base + p, "PATCH", b, who, expected)).data;
    const channel = await post("/settings/channels", {
        code: "UNIFIED",
        name: "销售来源",
        defaultOrgUnitId: org.id,
        requestKey: k(),
      }),
      channel2 = await post("/settings/channels", {
        code: "OTHER",
        name: "其他来源",
        defaultOrgUnitId: org2.id,
        requestKey: k(),
      });
    const scope = { orgUnitIds: [org.id], channelIds: [channel.id] },
      grant = async (
        who,
        role,
        bindings = [scope],
        version = 0,
        extraPermissions = [],
      ) =>
        h.request(base + "/settings/access", "PUT", {
          membershipId: f.accounts[who].memberId,
          roles: [{ role, scopeBindings: bindings }],
          extraPermissions,
          version,
          reason: "统一CRM合成验收",
          requestKey: k(),
        });
    await grant("sales", "sales");
    await grant("buyer", "sales");
    await grant("reviewer", "csm");
    await grant("finance", "manager", [
      scope,
      { orgUnitIds: [org2.id], channelIds: [channel2.id] },
    ]);
    await grant("warehouse", "viewer");
    const createCustomer = async (name, owner = f.accounts.sales.memberId) =>
      post("/customers", {
        displayName: name,
        kind: "organization",
        orgUnitId: org.id,
        channelId: channel.id,
        ownerMembershipId: owner,
        registrationId: "QA-" + k(),
        industry: "测试行业",
        requestKey: k(),
      });
    let customer = await createCustomer("统一客户甲");
    const cId = customer.id;
    await post("/customers/" + cId + "/assignment", {
      version: customer.version,
      ownerMembershipId: f.accounts.sales.memberId,
      serviceOwnerMembershipId: f.accounts.reviewer.memberId,
      reason: "分配销售与客服",
      requestKey: k(),
    });
    await get("/customers/" + cId, "sales");
    await get("/customers/" + cId, "reviewer");
    await get("/customers/" + cId, "buyer", 404);
    assert.equal((await get("/customers", "buyer")).total, 0);
    assert.equal((await get("/customers", "sales")).total, 1);
    await post(
      "/customers",
      {
        displayName: "越权组合",
        orgUnitId: org.id,
        channelId: channel2.id,
        requestKey: k(),
      },
      "finance",
      403,
    );
    const foreign = await db.crmCustomer.create({
      data: {
        tenantId: other.tenant.id,
        orgUnitId: org.id,
        displayName: "另租户假数据",
        sourceHash: "qa",
      },
    });
    await get("/customers/" + foreign.id, "admin", 404);
    const leadBody = {
      name: "测试线索",
      companyName: "转化企业",
      contact: "13800000001",
      source: "展会",
      requirement: "需要一套协同管理系统",
      orgUnitId: org.id,
      channelId: channel.id,
      requestKey: k(),
    };
    let lead = await post("/leads", leadBody);
    const leadId = lead.id;
    assert.equal((await post("/leads", leadBody)).id, lead.id);
    await post("/leads", { ...leadBody, requestKey: k() }, "admin", 409);
    assert.equal(
      (
        await post("/leads/duplicate-candidates", {
          name: leadBody.name,
          contact: leadBody.contact,
        })
      ).items[0].id,
      lead.id,
    );
    assert(
      !JSON.stringify(await get("/leads/" + lead.id)).includes(
        leadBody.contact,
      ),
    );
    await get("/leads/" + lead.id + "/contact", "sales", 404);
    const pool = await post("/sales-pools", {
      name: "轮转池",
      orgUnitId: org.id,
      channelId: channel.id,
      memberIds: [f.accounts.sales.memberId, f.accounts.buyer.memberId],
      requestKey: k(),
    });
    const action = async (a, extra = {}, who = "admin", expected = 201) => {
      const result = await post(
        "/leads/" + lead.id + "/actions",
        { action: a, version: lead.version, requestKey: k(), ...extra },
        who,
        expected,
      );
      if (expected === 201) lead = result;
      return result;
    };
    await action("assign", { poolId: pool.id });
    assert.equal(
      (await get("/leads/" + lead.id)).ownerMembershipId,
      f.accounts.sales.memberId,
    );
    await get("/leads/" + lead.id, "buyer", 404);
    await action("qualify", {}, "sales", 409);
    await action("accept", {}, "sales");
    await action("qualify", {}, "sales");
    await action("request_conversion", {}, "sales");
    await action("approve", {}, "sales", 403);
    await action("approve");
    const convert = {
      action: "convert",
      version: lead.version,
      createOpportunity: true,
      requestKey: k(),
    };
    lead = await post("/leads/" + lead.id + "/actions", convert, "sales");
    const converted = await post(
      "/leads/" + leadId + "/actions",
      convert,
      "sales",
    );
    assert.equal(converted.customerId, lead.customerId);
    assert.equal(converted.opportunityId, lead.opportunityId);
    assert.equal(
      await db.crmCustomer.count({
        where: { tenantId: f.tenant.id, displayName: "转化企业" },
      }),
      1,
    );
    await get("/leads/" + leadId + "/contact", "sales", 403);
    await grant("sales", "sales", [scope], 1, [
      { permission: "crm.customer.contact.read", scopeBindings: [scope] },
    ]);
    assert.equal(
      (await get("/leads/" + leadId + "/contact", "sales")).value,
      leadBody.contact,
    );
    const contact = await post(
      "/customers/" + cId + "/business-contacts",
      {
        name: "王经理",
        title: "采购负责人",
        value: "13800000002",
        purpose: "业务联系",
        requestKey: k(),
      },
      "sales",
    );
    assert(
      !JSON.stringify(
        await get("/customers/" + cId + "/business-contacts"),
      ).includes("13800000002"),
    );
    assert.equal(
      (await get("/customers/" + cId + "/business-contacts/reveal", "sales"))
        .items[0].value,
      "13800000002",
    );
    await get(
      "/customers/" + cId + "/business-contacts/reveal",
      "reviewer",
      403,
    );
    let follow = await post(
      "/follow-ups",
      {
        targetType: "customer",
        targetId: cId,
        channelId: channel.id,
        content: "已核对近期需求",
        type: "call",
        occurredAt: "2026-10-25T03:00:00Z",
        nextAt: "2026-10-26T02:00:00Z",
        requestKey: k(),
      },
      "sales",
    );
    let work = await get("/workbench", "sales");
    assert.equal(work.overdueFollowUps, 1);
    await post(
      "/follow-ups/" + follow.id + "/complete",
      { version: follow.version, requestKey: k() },
      "buyer",
      404,
    );
    await post(
      "/follow-ups/" + follow.id + "/complete",
      { version: follow.version, requestKey: k() },
      "sales",
    );
    assert.equal((await get("/workbench", "sales")).followUps.length, 0);
    await post(
      "/follow-ups",
      {
        targetType: "customer",
        targetId: cId,
        channelId: channel.id,
        content: "联系13800000001",
        occurredAt: "2026-10-25T03:00:00Z",
        requestKey: k(),
      },
      "sales",
      400,
    );
    await post(
      "/follow-ups",
      {
        targetType: "customer",
        targetId: cId,
        channelId: channel.id,
        content: "不允许未来发生",
        occurredAt: "2030-01-01T00:00:00Z",
        requestKey: k(),
      },
      "sales",
      400,
    );
    const oppBody = {
      customerId: cId,
      channelId: channel.id,
      name: "统一商机",
      ownerMembershipId: f.accounts.sales.memberId,
      participantMembershipIds: [],
      estimatedAmount: "12345.67",
      currency: "CNY",
      probability: 30,
      nextAction: "准备方案",
      nextActionAt: "2026-10-25T03:00:00Z",
      requestKey: k(),
    };
    let opp = await post("/opportunities", oppBody, "sales");
    await get("/opportunities/" + opp.id, "buyer", 404);
    assert.equal((await get("/opportunities", "buyer")).total, 0);
    await post(
      "/opportunities/" + opp.id + "/stage",
      {
        version: opp.version,
        stage: "won",
        actualAmount: "100.00",
        actualCloseAt: "2026-10-25T03:00:00Z",
        requestKey: k(),
      },
      "sales",
      409,
    );
    opp = await post(
      "/opportunities/" + opp.id + "/stage",
      { version: opp.version, stage: "solution", requestKey: k() },
      "sales",
    );
    opp = await post(
      "/opportunities/" + opp.id + "/stage",
      { version: opp.version, stage: "negotiation", requestKey: k() },
      "sales",
    );
    await post(
      "/opportunities/" + opp.id + "/stage",
      { version: opp.version, stage: "won", requestKey: k() },
      "sales",
      400,
    );
    opp = await post(
      "/opportunities/" + opp.id + "/stage",
      {
        version: opp.version,
        stage: "won",
        actualAmount: "12000.01",
        actualCloseAt: "2026-10-25T03:00:00Z",
        requestKey: k(),
      },
      "sales",
    );
    await patch(
      "/opportunities/" + opp.id,
      { ...oppBody, version: opp.version },
      "sales",
      409,
    );
    const plan = await post(
      "/service-plans",
      {
        customerId: cId,
        channelId: channel.id,
        title: "重点客户服务",
        ownerMembershipId: f.accounts.reviewer.memberId,
        startsAt: "2026-10-01T00:00:00Z",
        endsAt: "2026-11-30T00:00:00Z",
        requestKey: k(),
      },
      "reviewer",
    );
    let task = await post(
      "/service-plans/" + plan.id + "/tasks",
      {
        title: "完成需求回访",
        assigneeMembershipId: f.accounts.reviewer.memberId,
        dueAt: "2026-11-01T00:00:00Z",
        requestKey: k(),
      },
      "reviewer",
    );
    await post(
      "/service-plans/" + plan.id + "/actions",
      {
        version: plan.version,
        action: "complete",
        reason: "提前结束",
        requestKey: k(),
      },
      "reviewer",
      409,
    );
    task = await post(
      "/service-tasks/" + task.id + "/actions",
      {
        version: task.version,
        action: "submit",
        note: "已完成客户需求回访",
        requestKey: k(),
      },
      "reviewer",
    );
    await post(
      "/service-tasks/" + task.id + "/actions",
      {
        version: task.version,
        action: "approve",
        note: "自己审核不允许",
        requestKey: k(),
      },
      "reviewer",
      403,
    );
    task = await post(
      "/service-tasks/" + task.id + "/actions",
      {
        version: task.version,
        action: "reject",
        note: "请补充后续安排",
        requestKey: k(),
      },
      "finance",
    );
    task = await post(
      "/service-tasks/" + task.id + "/actions",
      {
        version: task.version,
        action: "submit",
        note: "补充下周回访安排",
        requestKey: k(),
      },
      "reviewer",
    );
    await post(
      "/service-tasks/" + task.id + "/actions",
      {
        version: task.version,
        action: "approve",
        note: "服务结果核对完成",
        requestKey: k(),
      },
      "finance",
    );
    await post(
      "/service-plans/" + plan.id + "/actions",
      {
        version: plan.version,
        action: "complete",
        reason: "全部任务通过审核",
        requestKey: k(),
      },
      "reviewer",
    );
    const risk = await post(
      "/service-risks",
      {
        customerId: cId,
        channelId: channel.id,
        title: "交接风险",
        severity: "high",
        detail: "需要及时安排服务交接",
        requestKey: k(),
      },
      "reviewer",
    );
    await post(
      "/service-risks/" + risk.id + "/close",
      {
        version: risk.version,
        resolution: "已安排服务负责人完成交接",
        requestKey: k(),
      },
      "reviewer",
    );
    assert.equal(
      (await get("/service-risks", "reviewer")).items[0].status,
      "closed",
    );
    // Editing, corrections, and renewal handoff preserve their original records.
    const profile = await get("/customers/" + cId);
    await patch(
      "/customers/" + cId + "/profile",
      {
        version: profile.version,
        kind: "organization",
        industry: "软件服务",
        region: "上海",
        registrationId: profile.registrationId,
        requestKey: k(),
      },
      "sales",
    );
    assert.equal((await get("/customers/" + cId)).industry, "软件服务");
    await post(
      "/customers/" + cId + "/business-contacts",
      {
        id: contact.id,
        version: contact.version,
        name: "王经理",
        title: "业务负责人",
        value: "13800000003",
        purpose: "业务联系",
        requestKey: k(),
      },
      "sales",
    );
    assert.equal(
      (await get("/customers/" + cId + "/business-contacts/reveal", "sales"))
        .items[0].value,
      "13800000003",
    );
    const editable = await post("/leads", {
      name: "需要更正的线索",
      source: "手工录入",
      requirement: "核对业务需求",
      orgUnitId: org.id,
      channelId: channel.id,
      requestKey: k(),
    });
    await patch("/leads/" + editable.id, {
      version: editable.version,
      name: "已更正线索",
      source: "展会",
      requirement: "补充业务需求说明",
      requestKey: k(),
    });
    assert.equal((await get("/leads/" + editable.id)).name, "已更正线索");
    await post("/leads/" + editable.id + "/actions", {
      action: "assign",
      version: 2,
      poolId: pool.id,
      requestKey: k(),
    });
    assert.equal(
      (await get("/leads/" + editable.id)).ownerMembershipId,
      f.accounts.buyer.memberId,
    );
    const correction = await post(
      "/follow-ups",
      {
        targetType: "customer",
        targetId: cId,
        channelId: channel.id,
        type: "note",
        content: "补充下次回访安排",
        occurredAt: "2026-10-25T04:00:00Z",
        nextAt: "2026-10-28T03:00:00Z",
        correctsId: follow.id,
        requestKey: k(),
      },
      "sales",
    );
    assert.equal(
      (
        await get(
          "/follow-ups?targetType=customer&targetId=" +
            cId +
            "&channelId=" +
            channel.id,
          "sales",
        )
      ).total,
      2,
    );
    const renewal = await post(
      "/service-renewals",
      {
        customerId: cId,
        channelId: channel.id,
        name: "年度服务续约",
        kind: "renewal",
        ownerMembershipId: f.accounts.sales.memberId,
        participantMembershipIds: [],
        estimatedAmount: "1000.00",
        currency: "CNY",
        requestKey: k(),
      },
      "reviewer",
    );
    assert.equal(
      (await get("/opportunities/" + renewal.id, "sales")).kind,
      "renewal",
    );
    await post(
      "/service-renewals",
      {
        customerId: cId,
        channelId: channel.id,
        name: "非法负责人",
        ownerMembershipId: other.accounts.sales.memberId,
        estimatedAmount: "10.00",
        currency: "CNY",
        requestKey: k(),
      },
      "reviewer",
      400,
    );
    const cancelled = await post(
      "/service-plans",
      {
        customerId: cId,
        channelId: channel.id,
        title: "取消服务计划",
        ownerMembershipId: f.accounts.reviewer.memberId,
        startsAt: "2026-10-01T00:00:00Z",
        endsAt: "2026-11-30T00:00:00Z",
        requestKey: k(),
      },
      "reviewer",
    );
    const cancelledTask = await post(
      "/service-plans/" + cancelled.id + "/tasks",
      {
        title: "待取消服务任务",
        assigneeMembershipId: f.accounts.reviewer.memberId,
        dueAt: "2026-11-01T00:00:00Z",
        requestKey: k(),
      },
      "reviewer",
    );
    await post(
      "/service-plans/" + cancelled.id + "/actions",
      {
        version: cancelled.version,
        action: "cancel",
        reason: "客户调整服务安排",
        requestKey: k(),
      },
      "reviewer",
    );
    await post(
      "/service-tasks/" + cancelledTask.id + "/actions",
      {
        version: cancelledTask.version,
        action: "submit",
        note: "已取消任务不能提交",
        requestKey: k(),
      },
      "reviewer",
      409,
    );
    // Mixed roles retain ownership rules inside each paired scope.
    await h.request(base + "/settings/access", "PUT", {
      membershipId: f.accounts.reviewer2.memberId,
      roles: [
        { role: "manager", scopeBindings: [scope] },
        {
          role: "sales",
          scopeBindings: [{ orgUnitIds: [org2.id], channelIds: [channel2.id] }],
        },
      ],
      extraPermissions: [],
      version: 0,
      reason: "配对岗位范围验证",
      requestKey: k(),
    });
    const customerB = await post("/customers", {
      displayName: "其他团队客户",
      kind: "organization",
      orgUnitId: org2.id,
      channelId: channel2.id,
      ownerMembershipId: f.accounts.admin.memberId,
      requestKey: k(),
    });
    await get("/customers/" + customerB.id, "reviewer2", 404);
    const ownB = await post(
      "/customers",
      {
        displayName: "本人维护客户",
        orgUnitId: org2.id,
        channelId: channel2.id,
        requestKey: k(),
      },
      "reviewer2",
    );
    await get("/customers/" + ownB.id, "reviewer2");
    const mixedCustomers = (await get("/customers", "reviewer2")).items;
    assert(!mixedCustomers.some((c) => c.id === customerB.id));
    assert(mixedCustomers.some((c) => c.id === ownB.id));
    const leadB = await post("/leads", {
      name: "其他团队线索",
      source: "测试来源",
      requirement: "测试范围约束",
      orgUnitId: org2.id,
      channelId: channel2.id,
      requestKey: k(),
    });
    await get("/leads/" + leadB.id, "reviewer2", 404);
    const ownLeadB = await post(
      "/leads",
      {
        name: "本人负责线索",
        source: "测试来源",
        requirement: "测试个人归属",
        orgUnitId: org2.id,
        channelId: channel2.id,
        requestKey: k(),
      },
      "reviewer2",
    );
    assert.equal(ownLeadB.status, "assigned");
    const ownOppB = await post(
      "/opportunities",
      {
        customerId: ownB.id,
        channelId: channel2.id,
        name: "本人商机",
        ownerMembershipId: f.accounts.reviewer2.memberId,
        estimatedAmount: "10.00",
        currency: "CNY",
        requestKey: k(),
      },
      "reviewer2",
    );
    await patch(
      "/opportunities/" + ownOppB.id,
      {
        version: ownOppB.version,
        customerId: ownB.id,
        channelId: channel2.id,
        name: "不能越权转派",
        ownerMembershipId: f.accounts.admin.memberId,
        estimatedAmount: "10.00",
        currency: "CNY",
        requestKey: k(),
      },
      "reviewer2",
      403,
    );
    const delegated = await post("/opportunities", {
      customerId: cId,
      channelId: channel.id,
      name: "协作销售商机",
      ownerMembershipId: f.accounts.buyer.memberId,
      estimatedAmount: "10.00",
      currency: "CNY",
      requestKey: k(),
    });
    await get("/opportunities/" + delegated.id, "buyer");
    // Distinct people cannot silently overwrite the same version.
    const fresh = await get("/customers/" + cId);
    const assignment = {
      version: fresh.version,
      ownerMembershipId: f.accounts.sales.memberId,
      serviceOwnerMembershipId: f.accounts.reviewer.memberId,
      reason: "并发交接验证",
      requestKey: k(),
    };
    const race = await Promise.all([
      h.request(
        base + "/customers/" + cId + "/assignment",
        "POST",
        assignment,
        "admin",
        null,
      ),
      h.request(
        base + "/customers/" + cId + "/assignment",
        "POST",
        { ...assignment, requestKey: k() },
        "finance",
        null,
      ),
    ]);
    assert.deepEqual(race.map((r) => r.status).sort(), [201, 409]);
    await post(
      "/leads",
      {
        name: "只读不得写",
        source: "测试",
        requirement: "只读权限验证",
        orgUnitId: org.id,
        channelId: channel.id,
        requestKey: k(),
      },
      "warehouse",
      403,
    );
    await get("/customers/" + cId, "warehouse");
    await get("/customers/" + cId + "/contacts", "warehouse", 403);
    await grant("sales", "viewer", [scope], 2);
    await get("/leads/" + leadId, "sales", 403);
    assert(
      !(await get("/metadata", "sales")).permissions.includes(
        "crm.sales.write",
      ),
    );
    const serialized = JSON.stringify(
      await db.auditEvent.findMany({
        where: { tenantId: f.tenant.id, appId: "crm" },
      }),
    );
    assert(!serialized.includes("13800000001"));
    assert(!serialized.includes("13800000002"));
    assert.equal(
      await db.erpCustomer.count({ where: { tenantId: f.tenant.id } }),
      0,
    );
    assert.equal(
      await db.erpOpportunity.count({ where: { tenantId: f.tenant.id } }),
      0,
    );
    console.log(
      JSON.stringify({
        ok: true,
        httpChecks: h.checks(),
        crmOnly: true,
        leadConversion: "atomic+idempotent",
        encryption: true,
        scope: "tenant+organization/channel+owner",
        services: "submit→reject→resubmit→approve",
        concurrency: true,
        noErpWrites: true,
      }),
    );
  } finally {
    if (app) await app.close();
    if (f) await cleanupFixture(db, f);
    if (other) await cleanupFixture(db, other);
    await db.$disconnect();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
