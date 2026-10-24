export const MES_ROLES = [
  "planner",
  "supervisor",
  "operator",
  "viewer",
] as const;
const production = ["mes.production.read", "mes.report.read"];
const catalog = ["mes.material.read", "mes.bom.read"];
export const MES_ROLE_PERMISSIONS: Record<string, string[]> = {
  planner: [
    ...production,
    ...catalog,
    "mes.material.write",
    "mes.bom.write",
    "mes.bom.publish",
    "mes.plan.write",
    "mes.plan.publish",
    "mes.order.write",
    "mes.ai.use",
  ],
  supervisor: [
    ...production,
    ...catalog,
    "mes.report.review",
    "mes.order.write",
    "mes.ai.use",
  ],
  operator: [...production, "mes.report.write", "mes.ai.use"],
  viewer: [...production, ...catalog, "mes.ai.use"],
};
export const MES_PERMISSIONS = [
  ...new Set([
    ...Object.values(MES_ROLE_PERMISSIONS).flat(),
    "mes.settings.manage",
    "mes.audit.read",
  ]),
];
export const MES_MANIFEST = {
  appId: "mes",
  displayName: "制造执行 MES",
  routePrefix: "/mes",
  permissions: MES_PERMISSIONS,
  aiCapabilities: [
    "conversation",
    "bom_review",
    "production_analysis",
    "controlled_drafts",
  ],
  defaultAgentId: "mes.assistant",
};
export async function mesPermissions(
  db: any,
  tenantId: string,
  role: string,
  membershipId: string,
) {
  const grant =
    role === "admin"
      ? null
      : await db.mesMemberGrant.findUnique({
          where: { tenantId_membershipId: { tenantId, membershipId } },
        });
  const permissions =
    role === "admin"
      ? MES_PERMISSIONS
      : (MES_ROLE_PERMISSIONS[grant?.role] ?? []);
  return process.env.MES_AI_RELEASE_ENABLED !== "true"
    ? permissions.filter((p) => p !== "mes.ai.use")
    : permissions;
}
