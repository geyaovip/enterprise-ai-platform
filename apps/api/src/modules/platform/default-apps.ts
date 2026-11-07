import type { Prisma } from '../../generated/prisma/client';

// Product policy: explicitly selected apps, not every future registry entry.
export const DEFAULT_APP_IDS = ['erp', 'crm', 'mes'] as const;

/** Fill missing grants only. A disabled or revoked row is an administrator decision. */
export function ensureDefaultApps(tx: Prisma.TransactionClient, tenantId: string) {
  return tx.tenantApp.createMany({
    data: DEFAULT_APP_IDS.map(appId => ({ tenantId, appId, granted: true, enabled: true })),
    skipDuplicates: true,
  });
}
