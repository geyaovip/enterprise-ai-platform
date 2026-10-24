import { Prisma } from '../../generated/prisma/client';
import type { Binding } from '../platform/infrastructure.service';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { InfrastructureService } from '../platform/infrastructure.service';
import { KnowledgeEngineRegistry } from './engine-registry';
import { KnowledgeEngineControlService } from './engine-control.service';
import { NativeKnowledgeError } from './native-parser';
import { readOriginal } from './knowledge-storage';

@Injectable()
export class KnowledgeProcessor {
  constructor(private readonly db: PrismaService, private readonly infra: InfrastructureService, private readonly registry: KnowledgeEngineRegistry, private readonly control: KnowledgeEngineControlService) {}
  async tick(): Promise<boolean> {
    const advancing = await this.control.advance();
    const stale = new Date(Date.now() - 300_000);
    const eligible = await this.db.$queryRaw<Array<{ tenantId: string }>>`SELECT DISTINCT b."tenantId" FROM "InfrastructureBinding" b JOIN "Tenant" t ON t."id" = b."tenantId" JOIN "TenantCapability" c ON c."tenantId" = b."tenantId" AND c."capability" = 'knowledge' WHERE b."kind" = 'knowledge' AND b."enabled" = true AND t."active" = true AND c."delivered" = true AND c."enabled" = true`;
    const tenantIds = eligible.map(x => x.tenantId);
    const index = await this.db.knowledgeIndex.findFirst({ where: { AND: [{ OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] }], OR: [{ status: 'deleting' }, { status: 'running', startedAt: { lt: stale }, version: { document: { status: 'deleted' } } }, { tenantId: { in: tenantIds }, version: { document: { status: 'active', space: { active: true } } }, OR: [{ status: 'queued' }, { status: 'parsing', updatedAt: { lt: new Date(Date.now() - 5000) } }, { status: 'running', startedAt: { lt: stale } }] }] }, include: { version: { include: { document: true } } }, orderBy: { updatedAt: 'asc' } });
    if (!index) {
      // New uploads and binding generations are discovered without losing platform originals.
      const bindings = await this.db.infrastructureBinding.findMany({ where: { kind: 'knowledge', enabled: true, tenantId: { in: tenantIds } } });
      for (const binding of bindings) {
        const versions = await this.db.$queryRaw<Array<{ id: string }>>`SELECT v."id" FROM "KnowledgeDocumentVersion" v JOIN "KnowledgeDocument" d ON d."id" = v."documentId" JOIN "KnowledgeSpace" s ON s."id" = d."spaceId" WHERE v."tenantId" = ${binding.tenantId} AND d."status" = 'active' AND s."active" = true AND v."version" = d."currentVersion" AND NOT EXISTS (SELECT 1 FROM "KnowledgeIndex" i WHERE i."versionId" = v."id" AND i."bindingId" = ${binding.id} AND i."bindingVersion" = ${binding.version}) ORDER BY v."createdAt" LIMIT 20`;
        for (const version of versions) await this.db.knowledgeIndex.upsert({ where: { versionId_bindingId_bindingVersion: { versionId: version.id, bindingId: binding.id, bindingVersion: binding.version } }, create: { tenantId: binding.tenantId, versionId: version.id, bindingId: binding.id, bindingVersion: binding.version, provider: binding.provider, bindingSnapshot: binding as unknown as Prisma.InputJsonValue }, update: {} });
        if (versions.length) return true;
      }
      return advancing;
    }
    const claimTime = new Date();
    const claimed = await this.db.knowledgeIndex.updateMany({ where: { id: index.id, status: index.status, updatedAt: index.updatedAt }, data: { status: 'running', startedAt: claimTime, nextAttemptAt: null, ...(index.status !== 'parsing' ? { attempts: { increment: 1 } } : {}) } });
    if (!claimed.count) return true;
    const claim = { id: index.id, status: 'running', startedAt: claimTime };
    try {
      const deleting = index.version.document.status === 'deleted' || index.status === 'deleting';
      if (!deleting && index.version.version !== index.version.document.currentVersion) {
        await this.db.knowledgeIndex.updateMany({ where: claim, data: { status: 'superseded' } }); return true;
      }
      const binding = deleting ? index.bindingSnapshot as unknown as Binding : await this.control.resolve(index);
      if (!binding || !deleting && (binding.id !== index.bindingId || binding.version !== index.bindingVersion)) {
        await this.db.knowledgeIndex.updateMany({ where: claim, data: { status: 'superseded' } }); return true;
      }
      const engine = this.registry.create(binding);
      if (index.version.document.status === 'deleted' || index.status === 'deleting') {
        if (index.datasetId) await engine.remove({ datasetId: index.datasetId, documentId: index.externalDocumentId ?? '' });
        await this.db.knowledgeIndex.updateMany({ where: claim, data: { status: 'deleted' } }); return true;
      }
      if (index.status !== 'parsing' && index.attempts >= 3) throw new Error('RETRY_LIMIT');
      const datasetId = index.datasetId ?? await engine.createDataset(`suite-${index.id}`);
      const savedDataset = await this.db.knowledgeIndex.updateMany({ where: claim, data: { datasetId } });
      if (!savedDataset.count) { await this.db.knowledgeIndex.update({ where: { id: index.id }, data: { datasetId, status: 'deleting' } }); return true; }
      const documentId = index.externalDocumentId ?? await engine.upload(datasetId, { filename: index.version.filename, mimeType: index.version.mimeType, bytes: await readOriginal(index.version.storageKey) });
      const savedDocument = await this.db.knowledgeIndex.updateMany({ where: claim, data: { externalDocumentId: documentId } });
      if (!savedDocument.count) { await this.db.knowledgeIndex.update({ where: { id: index.id }, data: { datasetId, externalDocumentId: documentId, status: 'deleting' } }); return true; }
      const source = { datasetId, documentId };
      if (index.status !== 'parsing') await engine.parse(source);
      const status = await engine.status(source);
      if (status === 'failed') throw new Error('PARSING_FAILED');
      const exists = await this.db.knowledgeDocument.findFirst({ where: { id: index.version.documentId, status: { not: 'deleted' }, tenantId: index.tenantId } });
      await this.db.knowledgeIndex.updateMany({ where: claim, data: { status: exists ? status === 'ready' ? 'ready' : 'parsing' : 'deleting', errorCode: null, nextAttemptAt: status === 'processing' ? new Date(Date.now() + 5000) : null } });
    } catch (error) {
      const attempts = index.attempts + 1;
      const deleting = index.status === 'deleting' || index.version.document.status === 'deleted';
      const transient = error instanceof NativeKnowledgeError ? ['EMBEDDING_UNAVAILABLE', 'OCR_UNAVAILABLE', 'PARSER_TIMEOUT'].includes(error.code) : error instanceof ServiceUnavailableException;
      const retry = deleting || transient && attempts < 3;
      await this.db.knowledgeIndex.updateMany({ where: claim, data: { status: deleting ? 'deleting' : retry ? index.status === 'parsing' ? 'parsing' : 'queued' : 'failed', attempts, nextAttemptAt: retry ? new Date(Date.now() + Math.min(300_000, 5000 * 2 ** Math.min(attempts, 6))) : null, errorCode: error instanceof Error ? error.name : 'UNKNOWN' } });
    }
    return true;
  }
}
