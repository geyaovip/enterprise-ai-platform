import type { Prisma } from '../../generated/prisma/client';

// Existing-tenant retries and the legacy backfill retain the original scope.
export const LEGACY_DEFAULT_APP_IDS = ['erp', 'crm', 'mes'] as const;
export const DEFAULT_APP_IDS = [...LEGACY_DEFAULT_APP_IDS, 'content', 'geo', 'manufacturing'] as const;
type DefaultAppId = (typeof DEFAULT_APP_IDS)[number];

/** Fill missing grants only. A disabled or revoked row is an administrator decision. */
export function ensureDefaultApps(
  tx: Prisma.TransactionClient,
  tenantId: string,
  appIds: readonly DefaultAppId[] = DEFAULT_APP_IDS,
) {
  return tx.tenantApp.createMany({
    data: appIds.map(appId => ({ tenantId, appId, granted: true, enabled: true })),
    skipDuplicates: true,
  });
}
