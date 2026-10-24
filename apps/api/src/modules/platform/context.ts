export type AppContext = { appId: string; tenantAppId?: string };
export type RequestContext = {
  requestId: string;
  tenantId: string;
  tenantKey: string;
  userId: string;
  membershipId: string;
  app: AppContext;
  roles: readonly string[];
  permissions: readonly string[];
};
