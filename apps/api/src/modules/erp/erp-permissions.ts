export const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  admin: ['erp.collaboration.emit', 'knowledge.use', 'knowledge.manage', 'platform.manage', 'platform.audit.read', 'erp.master.read', 'erp.master.write', 'erp.purchase.read', 'erp.purchase.write', 'erp.purchase.approve', 'erp.purchase.receive', 'erp.sales.read', 'erp.sales.write', 'erp.sales.approve', 'erp.sales.ship', 'erp.inventory.read', 'erp.inventory.write', 'erp.finance.read', 'erp.finance.write', 'erp.ai.use'],
  sales: ['knowledge.use', 'erp.master.read', 'erp.master.write', 'erp.sales.read', 'erp.sales.write', 'erp.ai.use'],
  purchasing: ['erp.collaboration.emit', 'knowledge.use', 'erp.master.read', 'erp.master.write', 'erp.purchase.read', 'erp.purchase.write', 'erp.inventory.read', 'erp.ai.use'],
  warehouse: ['knowledge.use', 'erp.master.read', 'erp.purchase.read', 'erp.purchase.receive', 'erp.sales.read', 'erp.sales.ship', 'erp.inventory.read', 'erp.inventory.write', 'erp.ai.use'],
  finance: ['knowledge.use', 'erp.master.read', 'erp.purchase.read', 'erp.sales.read', 'erp.finance.read', 'erp.finance.write', 'erp.ai.use'],
};

import type { PrismaService } from '../prisma.service';
export async function erpPermissions(db: PrismaService, tenantId: string, role: string, membershipId: string) {
  const settings = await db.erpBusinessSettings.findUnique({where:{tenantId}});
  const config = (settings?.approvalConfig ?? {}) as Record<string, unknown>;
  const extra: string[] = [];
  const delegation = config.delegation as {from?:string;to?:string;until?:string} | undefined;
  for (const kind of ['purchase','sales']) {
    const high=config[kind==='sales'?'salesHigh':'purchaseHigh'] as {members:string[]}|undefined;
    const ids = [...(config[kind] as string[]??[]),...(high?.members??[])];
    if (ids.includes(membershipId) || (delegation?.until && new Date(delegation.until)>new Date() && delegation.to===membershipId && ids.includes(delegation.from??''))) extra.push(`erp.${kind}.approve`, `erp.${kind}.read`);
  }
  const flows=await db.erpWorkflow.findMany({where:{tenantId,status:{in:['active','exception']}},select:{steps:true}});
  for(const flow of flows)for(const step of flow.steps as Array<{type:string;permission:string;members:string[]}>)if(step.type==='approval'&&step.members.includes(membershipId))extra.push(step.permission,step.permission.replace('.approve','.read'));
  return [...new Set([...(ROLE_PERMISSIONS[role] ?? []).filter(p=>p.startsWith('erp.')),...extra])];
}
