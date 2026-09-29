export type AppManifest = {
  appId: string;
  displayName: string;
  routePrefix: string;
  permissions: readonly string[];
  aiCapabilities: readonly string[];
};

export const APP_MANIFESTS: readonly AppManifest[] = [
  {
    appId: 'erp',
    displayName: 'ERP',
    routePrefix: '/erp',
    permissions: ['erp.master.read', 'erp.master.write', 'erp.purchase.read', 'erp.purchase.write', 'erp.purchase.receive', 'erp.sales.read', 'erp.sales.write', 'erp.sales.ship', 'erp.inventory.read', 'erp.inventory.write', 'erp.finance.read', 'erp.finance.write', 'erp.ai.use'],
    aiCapabilities: ['conversation', 'controlled_actions', 'order_analysis', 'text_extract', 'shortage_suggestion'],
  },
];

export function appManifest(appId: string) { return APP_MANIFESTS.find(x => x.appId === appId); }
