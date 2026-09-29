export type AppContext = { appId: 'platform' | 'erp'; tenantAppId?: string };
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

export const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  admin: ['platform.manage', 'platform.audit.read', 'erp.master.read', 'erp.master.write', 'erp.purchase.read', 'erp.purchase.write', 'erp.purchase.receive', 'erp.sales.read', 'erp.sales.write', 'erp.sales.ship', 'erp.inventory.read', 'erp.inventory.write', 'erp.finance.read', 'erp.finance.write', 'erp.ai.use'],
  sales: ['erp.master.read', 'erp.master.write', 'erp.sales.read', 'erp.sales.write', 'erp.ai.use'],
  purchasing: ['erp.master.read', 'erp.master.write', 'erp.purchase.read', 'erp.purchase.write', 'erp.ai.use'],
  warehouse: ['erp.master.read', 'erp.purchase.read', 'erp.purchase.receive', 'erp.sales.read', 'erp.sales.ship', 'erp.inventory.read', 'erp.inventory.write', 'erp.ai.use'],
  finance: ['erp.master.read', 'erp.purchase.read', 'erp.sales.read', 'erp.finance.read', 'erp.finance.write', 'erp.ai.use'],
};
