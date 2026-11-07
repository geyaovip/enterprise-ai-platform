#!/usr/bin/env node
// Offline, read-only migration preflight. Never connects to either application's database.
const fs = require("node:fs"),
  crypto = require("node:crypto");
const tables = [
  "Lead",
  "Customer",
  "Contact",
  "Opportunity",
  "OpportunityParticipant",
  "FollowUp",
  "Task",
  "ServicePlan",
  "ServiceTask",
  "ServiceRisk",
  "LeadAssignment",
  "ConversionRequest",
  "SalesPool",
  "SalesPoolMember",
  "AuditLog",
];
function inspect(snapshot, mapping) {
  if (
    snapshot.format !== "sales360-crm-export-v1" ||
    !snapshot.tenantId ||
    !snapshot.tables
  )
    throw Error("Expected sales360-crm-export-v1 with tenantId and tables");
  if (
    mapping.sourceTenantId !== snapshot.tenantId ||
    !mapping.targetTenantId ||
    !mapping.channelId
  )
    throw Error(
      "Explicit source/target tenant and CRM channel mappings required",
    );
  const errors = [],
    warnings = [],
    counts = {},
    states = {},
    members = new Set(),
    orgs = new Set(),
    sets = {};
  const issue = (code, table, id, field) =>
    errors.push({ code, table, id, field });
  for (const name of tables) {
    const rows = snapshot.tables[name];
    if (!Array.isArray(rows)) {
      issue("MISSING_TABLE", name, null, null);
      sets[name] = new Set();
      continue;
    }
    sets[name] = new Set();
    counts[name] = rows.length;
    states[name] = {};
    for (const r of rows) {
      if (!r.id || sets[name].has(r.id))
        issue("DUPLICATE_OR_MISSING_ID", name, r.id ?? null, "id");
      sets[name].add(r.id);
      if (r.tenantId && r.tenantId !== snapshot.tenantId)
        issue("CROSS_TENANT_ROW", name, r.id, "tenantId");
      if (r.status) states[name][r.status] = (states[name][r.status] ?? 0) + 1;
      for (const key of [
        "ownerId",
        "serviceOwnerId",
        "authorId",
        "assigneeId",
        "reviewedBy",
        "actorId",
        "fromUserId",
        "toUserId",
        "userId",
      ])
        if (r[key]) members.add(r[key]);
      if (r.orgUnitId) orgs.add(r.orgUnitId);
    }
  }
  const relation = (table, field, target, optional = false) => {
    for (const r of snapshot.tables[table] ?? []) {
      if (!r[field] && optional) continue;
      if (!sets[target]?.has(r[field]))
        issue("ORPHAN_REFERENCE", table, r.id, field);
    }
  };
  for (const [table, field, target, optional] of [
    ["Contact", "customerId", "Customer"],
    ["Opportunity", "customerId", "Customer"],
    ["OpportunityParticipant", "opportunityId", "Opportunity"],
    ["ServicePlan", "customerId", "Customer"],
    ["ServiceTask", "planId", "ServicePlan"],
    ["ServiceRisk", "customerId", "Customer"],
    ["LeadAssignment", "leadId", "Lead"],
    ["ConversionRequest", "leadId", "Lead"],
    ["SalesPoolMember", "poolId", "SalesPool"],
    ["Customer", "sourceLeadId", "Lead", true],
    ["Lead", "convertedCustomerId", "Customer", true],
  ])
    relation(table, field, target, optional);
  for (const table of ["FollowUp", "Task"])
    for (const r of snapshot.tables[table] ?? []) {
      const target = {
        lead: "Lead",
        customer: "Customer",
        opportunity: "Opportunity",
      }[r.targetType];
      if (!target || !sets[target]?.has(r.targetId))
        issue("ORPHAN_TARGET", table, r.id, "targetId");
    }
  for (const id of members)
    if (!mapping.memberships?.[id])
      issue("UNMAPPED_MEMBER", "Membership", id, "memberships");
  for (const id of orgs)
    if (!mapping.orgUnits?.[id])
      issue("UNMAPPED_ORGANIZATION", "OrgUnit", id, "orgUnits");
  const registrations = new Map(),
    names = new Map();
  for (const r of snapshot.tables.Customer ?? []) {
    if (r.registrationId) {
      const old = registrations.get(r.registrationId);
      if (old)
        issue(
          "DUPLICATE_CUSTOMER_IDENTITY",
          "Customer",
          r.id,
          "registrationId",
        );
      registrations.set(r.registrationId, r.id);
    }
    const n = String(r.normalizedName ?? r.name ?? "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/\s+/g, "");
    if (n) {
      const ids = names.get(n) ?? [];
      ids.push(r.id);
      names.set(n, ids);
    }
  }
  for (const ids of names.values())
    if (ids.length > 1)
      warnings.push({ code: "CUSTOMER_NAME_CANDIDATES", ids });
  for (const r of snapshot.tables.Opportunity ?? [])
    if (!["CNY", "USD", "EUR", "HKD"].includes(r.currency))
      issue("UNSUPPORTED_CURRENCY", "Opportunity", r.id, "currency");
  const due = (snapshot.tables.Task ?? []).filter(
    (r) => r.status === "open",
  ).length;
  return {
    readyForRehearsal: errors.length === 0,
    sourceTenantId: snapshot.tenantId,
    targetTenantId: mapping.targetTenantId,
    exportedAt: snapshot.exportedAt,
    counts,
    states,
    openLegacyTasks: due,
    memberMappings: members.size,
    organizationMappings: orgs.size,
    errors,
    warnings,
    retirementAllowed: false,
    nextStep: errors.length
      ? "Resolve mappings and references before isolated import rehearsal"
      : "Run isolated import and verify every count, state, amount, reference, and historical ID before user acceptance. This report does not import or retire data.",
  };
}
module.exports = { inspect, tables };
if (require.main === module) {
  try {
    const [snapshotPath, mappingPath, reportPath] = process.argv.slice(2);
    if (!snapshotPath || !mappingPath || !reportPath)
      throw Error(
        "Usage: node scripts/crm-legacy-preflight.cjs SNAPSHOT_JSON MAPPING_JSON REPORT_JSON",
      );
    const raw = fs.readFileSync(snapshotPath),
      snapshot = JSON.parse(raw),
      mapping = JSON.parse(fs.readFileSync(mappingPath));
    const report = {
      ...inspect(snapshot, mapping),
      snapshotSha256: crypto.createHash("sha256").update(raw).digest("hex"),
    };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    console.log(
      JSON.stringify({
        readyForRehearsal: report.readyForRehearsal,
        counts: report.counts,
        errors: report.errors.length,
        warnings: report.warnings.length,
        retirementAllowed: false,
      }),
    );
    if (!report.readyForRehearsal) process.exitCode = 2;
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
