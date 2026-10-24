import { isManagementAi } from './management-ai';
import { ConflictException, Injectable } from '@nestjs/common';
import type { AppManifest } from './app-registry';
export type PermissionContributor = (tenantId: string, role: string, membershipId: string) => Promise<readonly string[]>;

/** Applications are registered by trusted server composition, not user supplied code. */
@Injectable()
export class ApplicationRegistry {
  private readonly entries = new Map<string, { manifest: AppManifest; permissions: PermissionContributor }>();
  register(manifest: AppManifest, permissions: PermissionContributor) {
    if (!/^[a-z][a-z0-9_]{1,31}$/.test(manifest.appId) || manifest.appId === 'platform' || isManagementAi(manifest.appId) || this.entries.has(manifest.appId)) throw new Error('Invalid or duplicate application');
    if (manifest.permissions.some(p => !p.startsWith(`${manifest.appId}.`))) throw new Error('Application permission namespace mismatch');
    this.entries.set(manifest.appId, { manifest: Object.freeze({...manifest}), permissions });
  }
  get(appId: string) {
    const entry = this.entries.get(appId);
    if (!entry) throw new ConflictException('应用尚未注册');
    return entry.manifest;
  }
  list() { return [...this.entries.values()].map(x => x.manifest); }
  async permissions(appId: string, tenantId: string, role: string, membershipId: string) {
    const manifest = this.get(appId);
    const permissions = await this.entries.get(appId)!.permissions(tenantId,role,membershipId);
    return permissions.filter(p => manifest.permissions.includes(p));
  }
}
