import { erpPermissions } from '../erp/erp-permissions';
import type { Transaction } from '../erp/erp.common';

const read = 'manufacturing.read';
const permissions = [
  read, 'manufacturing.setup', 'manufacturing.order', 'manufacturing.buy',
  'manufacturing.approve', 'manufacturing.stock', 'manufacturing.complete',
  'manufacturing.plan', 'manufacturing.report', 'manufacturing.review',
] as const;

export const MANUFACTURING_MANIFEST = {
  appId: 'manufacturing',
  displayName: '制造业进销存',
  routePrefix: '/manufacturing',
  permissions,
  aiCapabilities: [],
};

function rolePermissions(role: string): readonly string[] {
  switch (role) {
    case 'admin': return permissions;
    case 'sales': return [read, 'manufacturing.order'];
    case 'purchasing': return [read, 'manufacturing.buy'];
    case 'warehouse': return [read, 'manufacturing.stock', 'manufacturing.complete'];
    default: return [];
  }
}

export const productionRoles = {
  planner: [read, 'manufacturing.plan'],
  operator: [read, 'manufacturing.report'],
  supervisor: [read, 'manufacturing.review'],
} as const;

export async function manufacturingPermissions(db: Transaction, tenantId: string, role: string, membershipId: string) {
  const base = rolePermissions(role);
  if (role === 'admin') return base;
  const [approvals, grant] = await Promise.all([
    erpPermissions(db, tenantId, role, membershipId),
    db.manufacturingMemberGrant.findUnique({ where: { tenantId_membershipId: { tenantId, membershipId } } }),
  ]);
  const extra = productionRoles[grant?.role as keyof typeof productionRoles] ?? [];
  return [...new Set([...base, ...extra,
    ...(approvals.includes('erp.purchase.approve') ? [read, 'manufacturing.approve'] : [])])];
}
