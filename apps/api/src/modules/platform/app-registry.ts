import {MES_MANIFEST} from '../mes/mes-permissions';
import {CRM_MANIFEST} from '../crm/crm-permissions';
export type AppManifest = {
  appId: string;
  displayName: string;
  routePrefix: string;
  permissions: readonly string[];
  aiCapabilities: readonly string[];
  defaultAgentId?: string;
};

export const APP_MANIFESTS: readonly AppManifest[] = [
  {
    appId: 'erp',
    displayName: 'ERP',
    routePrefix: '/erp',
    permissions: ['erp.collaboration.emit', 'erp.master.read', 'erp.master.write', 'erp.purchase.read', 'erp.purchase.write', 'erp.purchase.approve', 'erp.purchase.receive', 'erp.sales.read', 'erp.sales.write', 'erp.sales.approve', 'erp.sales.ship', 'erp.inventory.read', 'erp.inventory.write', 'erp.finance.read', 'erp.finance.write', 'erp.ai.use'],
    aiCapabilities: ['conversation', 'controlled_actions', 'order_analysis', 'text_extract', 'shortage_suggestion'],
    defaultAgentId: 'erp.assistant',
  },
 CRM_MANIFEST,MES_MANIFEST,
];

export function appManifest(appId: string) { return APP_MANIFESTS.find(x => x.appId === appId); }
