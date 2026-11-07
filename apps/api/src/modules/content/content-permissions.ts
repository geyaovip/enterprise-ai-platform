export const CONTENT_ROLES: Record<string, string[]> = {
  manager: [
    "content.read",
    "content.create",
    "content.review",
    "content.export",
    "content.manage",
    "content.ai.use",
  ],
  creator: [
    "content.read",
    "content.create",
    "content.export",
    "content.ai.use",
  ],
  reviewer: [
    "content.read",
    "content.review",
    "content.export",
    "content.ai.use",
  ],
  viewer: ["content.read", "content.export"],
};
export const CONTENT_MANIFEST = {
  appId: "content",
  displayName: "品牌内容",
  routePrefix: "/content",
  permissions: CONTENT_ROLES.manager,
  aiCapabilities: ["conversation", "brand_content", "controlled_actions"],
  defaultAgentId: "content.assistant",
};
export async function contentPermissions(
  db: any,
  tenantId: string,
  role: string,
  membershipId: string,
) {
  if (role === "admin") return CONTENT_ROLES.manager;
  const grant = await db.contentGrant.findUnique({
    where: { tenantId_membershipId: { tenantId, membershipId } },
  });
  return CONTENT_ROLES[grant?.role] ?? [];
}
