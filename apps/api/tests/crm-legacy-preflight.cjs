const assert = require("node:assert/strict"),
  { inspect, tables } = require("../scripts/crm-legacy-preflight.cjs");
const snapshot = {
    format: "sales360-crm-export-v1",
    tenantId: "old-tenant",
    exportedAt: "2026-10-26T00:00:00Z",
    tables: Object.fromEntries(tables.map((t) => [t, []])),
  },
  mapping = {
    sourceTenantId: "old-tenant",
    targetTenantId: "new-tenant",
    channelId: "explicit-channel",
    memberships: { old: "new-membership" },
    orgUnits: { oldOrg: "newOrg" },
  };
snapshot.tables.Customer = [
  {
    id: "C1",
    tenantId: "old-tenant",
    name: "测试客户",
    orgUnitId: "oldOrg",
    ownerId: "old",
  },
];
snapshot.tables.Opportunity = [
  {
    id: "O1",
    tenantId: "old-tenant",
    customerId: "C1",
    ownerId: "old",
    currency: "CNY",
    status: "won",
  },
];
assert.equal(inspect(snapshot, mapping).readyForRehearsal, true);
assert.equal(inspect(snapshot, mapping).retirementAllowed, false);
const broken = structuredClone(snapshot);
broken.tables.Contact = [
  { id: "wrong", tenantId: "another", customerId: "missing" },
];
broken.tables.ServiceTask = [
  { id: "T1", planId: "missing", assigneeId: "unmapped" },
];
let report = inspect(broken, mapping);
assert.equal(report.readyForRehearsal, false);
for (const code of ["ORPHAN_REFERENCE", "CROSS_TENANT_ROW", "UNMAPPED_MEMBER"])
  assert(report.errors.some((e) => e.code === code));
const duplicate = structuredClone(snapshot);
duplicate.tables.Customer.push({ ...duplicate.tables.Customer[0], id: "C2" });
assert.equal(
  inspect(duplicate, mapping).warnings[0].code,
  "CUSTOMER_NAME_CANDIDATES",
);
assert.throws(() => inspect(snapshot, { ...mapping, sourceTenantId: "wrong" }));
const missing = structuredClone(snapshot);
delete missing.tables.FollowUp;
assert(
  inspect(missing, mapping).errors.some((e) => e.code === "MISSING_TABLE"),
);
console.log(
  JSON.stringify({
    ok: true,
    assertions: 9,
    readOnly: true,
    detects: [
      "missing-tables",
      "orphan-reference",
      "cross-tenant",
      "missing-membership-map",
      "duplicate-candidates",
    ],
    noDatabaseAccess: true,
  }),
);
