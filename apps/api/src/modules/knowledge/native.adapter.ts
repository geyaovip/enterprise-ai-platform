import { createHash } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import type { Binding } from '../platform/infrastructure-contract';
import type { EngineChunk, EngineSource, KnowledgeEngine } from './knowledge-engine';
import { NativeEmbedding } from './native-embedding';
import { NativeKnowledgeError, parseNativeDocument, command } from './native-parser';
import { hybridCandidates, queryTerms, type RankedRow } from './native-ranking';
import { rerank } from './knowledge-addons';
import { readOriginal } from './knowledge-storage';

export class NativeKnowledgeAdapter implements KnowledgeEngine {
  readonly provider = 'native';
  private readonly embedding: NativeEmbedding;
  constructor(private readonly binding: Binding, private readonly db: PrismaService) { this.embedding = new NativeEmbedding(binding); }
  async health() {
    try { await this.db.$queryRaw`SELECT '[1,0]'::halfvec <=> '[1,0]'::halfvec`; } catch { throw new NativeKnowledgeError('VECTOR_EXTENSION_UNAVAILABLE'); }
    await this.embedding.embed('public knowledge connection check');
    const ocr = await this.db.infrastructureBinding.findUnique({ where: { tenantId_kind_scopeKey: { tenantId: this.binding.tenantId, kind: 'knowledge-ocr', scopeKey: 'tenant' } } });
    if (!ocr?.enabled) {
      const languages = await command(process.env.KNOWLEDGE_TESSERACT_PATH ?? 'tesseract', ['--list-langs'], Buffer.alloc(0), undefined, 'OCR_UNAVAILABLE');
      if (!/^chi_sim$/m.test(languages) || !/^eng$/m.test(languages)) throw new NativeKnowledgeError('OCR_UNAVAILABLE');
    }
  }
  private async index(id: string) {
    const index = await this.db.knowledgeIndex.findFirst({ where: { id, tenantId: this.binding.tenantId, bindingId: this.binding.id, bindingVersion: this.binding.version, provider: 'native' }, include: { version: { include: { document: true } } } });
    if (!index) throw new NativeKnowledgeError('SOURCE_CHANGED');
    return index;
  }
  async createDataset(stableName: string) {
    const id = stableName.replace(/^suite-/, ''); const index = await this.index(id);
    if (index.status !== 'running') throw new NativeKnowledgeError('SOURCE_CHANGED');
    await this.db.nativeKnowledgeDataset.upsert({ where: { id }, create: { id, tenantId: this.binding.tenantId, embeddingModel: this.embedding.model }, update: {} });
    return id;
  }
  async upload(datasetId: string, file: { filename: string; mimeType: string; bytes: Buffer }) {
    const index = await this.index(datasetId);
    if (createHash('sha256').update(file.bytes).digest('hex') !== index.version.sha256 || file.filename !== index.version.filename || file.mimeType !== index.version.mimeType) throw new NativeKnowledgeError('SOURCE_CHANGED');
    return index.versionId;
  }
  async parse(source: EngineSource) {
    try { await this.db.$queryRaw`SELECT '[1,0]'::halfvec <=> '[1,0]'::halfvec`; } catch { throw new NativeKnowledgeError('VECTOR_EXTENSION_UNAVAILABLE'); }
    const index = await this.index(source.datasetId);
    if (source.documentId !== index.versionId || index.status !== 'running' || index.version.document.status !== 'active' || index.version.version !== index.version.document.currentVersion) throw new NativeKnowledgeError('SOURCE_CHANGED');
    const dataset = await this.db.nativeKnowledgeDataset.update({ where: { id: source.datasetId }, data: { generation: { increment: 1 }, status: 'processing' } });
    const abort = new AbortController(); const timeout = setTimeout(() => abort.abort(), 210_000);
    try {
      const ocr = await this.db.infrastructureBinding.findUnique({ where: { tenantId_kind_scopeKey: { tenantId: this.binding.tenantId, kind: 'knowledge-ocr', scopeKey: 'tenant' } } });
      const parsing = new AbortController(); const parserTimeout = setTimeout(() => parsing.abort(), 90_000);
      const stop = () => parsing.abort(); abort.signal.addEventListener('abort', stop, { once: true });
      let chunks;
      try { chunks = await parseNativeDocument(index.version.filename, await readOriginal(index.version.storageKey), { binding: ocr, signal: parsing.signal }); }
      finally { clearTimeout(parserTimeout); abort.signal.removeEventListener('abort', stop); }
      const vectors: number[][] = new Array(chunks.length); let cursor = 0;
      await Promise.all([0, 1].map(async () => {
        while (cursor < chunks.length) { const ordinal = cursor++; if (abort.signal.aborted) throw new NativeKnowledgeError('EMBEDDING_UNAVAILABLE'); vectors[ordinal] = await this.embedding.embed(chunks[ordinal].text, abort.signal); }
      }));
      const dimension = vectors[0].length;
      if (vectors.some(x => x.length !== dimension)) throw new NativeKnowledgeError('EMBEDDING_DIMENSION_CHANGED');
      await this.db.$transaction(async tx => {
        const cap = await tx.tenantCapability.findFirst({ where: { tenantId: this.binding.tenantId, capability: 'knowledge', delivered: true, enabled: true } });
        const tenant = await tx.tenant.findFirst({ where: { id: this.binding.tenantId, active: true } });
        if (!cap || !tenant) throw new NativeKnowledgeError('SOURCE_CHANGED');
        const live = await tx.knowledgeIndex.findFirst({ where: { id: index.id, status: 'running', startedAt: index.startedAt, version: { document: { status: 'active', currentVersion: index.version.version, space: { active: true } } } } });
        if (!live) throw new NativeKnowledgeError('SOURCE_CHANGED');
        const changed = await tx.nativeKnowledgeDataset.updateMany({ where: { id: dataset.id, generation: dataset.generation, status: 'processing' }, data: { dimension, status: 'ready' } });
        if (!changed.count) throw new NativeKnowledgeError('SOURCE_CHANGED');
        await tx.nativeKnowledgeChunk.deleteMany({ where: { datasetId: dataset.id } });
        await tx.nativeKnowledgeChunk.createMany({ data: chunks.map((chunk, ordinal) => ({ tenantId: this.binding.tenantId, datasetId: dataset.id, ordinal, text: chunk.text, locator: chunk.locator as Prisma.InputJsonValue, embedding: vectors[ordinal] })) });
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      abort.abort(); await this.db.nativeKnowledgeDataset.updateMany({ where: { id: dataset.id, generation: dataset.generation, status: 'processing' }, data: { status: 'failed' } }); throw error;
    } finally { clearTimeout(timeout); }
  }
  async status(source: EngineSource): Promise<'processing' | 'ready' | 'failed'> {
    const index = await this.index(source.datasetId); if (index.versionId !== source.documentId) throw new NativeKnowledgeError('SOURCE_CHANGED');
    const dataset = await this.db.nativeKnowledgeDataset.findUnique({ where: { id: source.datasetId } });
    return dataset?.status === 'ready' ? 'ready' : dataset?.status === 'failed' ? 'failed' : 'processing';
  }
  async remove(source: EngineSource) {
    await this.index(source.datasetId);
    await this.db.nativeKnowledgeDataset.deleteMany({ where: { id: source.datasetId, tenantId: this.binding.tenantId } });
  }
  async retrieve(query: string, sources: EngineSource[], authorize?: () => Promise<void>): Promise<EngineChunk[]> {
    if (!sources.length) return [];
    const vector = await this.embedding.embed(query);
    const pairs = Prisma.join(sources.map(x => Prisma.sql`(i."id" = ${x.datasetId} AND i."versionId" = ${x.documentId})`), ' OR ');
    // MATERIALIZED authorization scope prevents scoring any rows outside the authorized source pairs.
    const terms = queryTerms(query);
    const tokens = terms.length ? Prisma.join(terms.map(x => Prisma.sql`(${x.text}::text, ${x.weight}::float8)`)) : Prisma.sql`(''::text, 0::float8)`;
    const rows = await this.db.$queryRaw<RankedRow[]>(Prisma.sql`
      WITH scope AS MATERIALIZED (
        SELECT c."datasetId", c."ordinal", i."versionId" AS "documentId", c."text", c."locator", c."embedding", n."dimension"
        FROM "NativeKnowledgeChunk" c JOIN "NativeKnowledgeDataset" n ON n."id" = c."datasetId" AND n."tenantId" = c."tenantId"
        JOIN "KnowledgeIndex" i ON i."id" = n."id" AND i."tenantId" = n."tenantId"
        JOIN "KnowledgeDocumentVersion" v ON v."id" = i."versionId" AND v."tenantId" = i."tenantId"
        JOIN "KnowledgeDocument" d ON d."id" = v."documentId" AND d."tenantId" = v."tenantId"
        JOIN "KnowledgeSpace" s ON s."id" = d."spaceId" AND s."tenantId" = d."tenantId"
        WHERE i."tenantId" = ${this.binding.tenantId} AND i."bindingId" = ${this.binding.id} AND i."bindingVersion" = ${this.binding.version}
          AND i."provider" = 'native' AND i."status" = 'ready' AND n."status" = 'ready' AND d."status" = 'active' AND s."active" = true
          AND v."version" = d."currentVersion" AND (${pairs})
      ), scored AS MATERIALIZED (
        SELECT "datasetId", "documentId", "ordinal", "text", "locator", "dimension",
          CASE WHEN "dimension" = ${vector.length} THEN "embedding"::halfvec <=> ${JSON.stringify(vector)}::halfvec ELSE NULL END AS distance,
          (SELECT COALESCE(sum(t.weight), 0) FROM (VALUES ${tokens}) AS t(term, weight) WHERE t.term <> '' AND strpos(lower(scope."text"), t.term) > 0)::float8 AS lexical
        FROM scope
      ), dense AS (SELECT * FROM scored WHERE distance <= 0.8 ORDER BY distance, "datasetId", "ordinal" LIMIT 32),
      lexical AS (SELECT * FROM scored WHERE lexical > 0 ORDER BY lexical DESC, "datasetId", "ordinal" LIMIT 32),
      invalid AS (SELECT * FROM scored WHERE "dimension" <> ${vector.length} LIMIT 1)
      SELECT * FROM dense UNION SELECT * FROM lexical UNION SELECT * FROM invalid`);
    if (rows.some(x => x.dimension !== vector.length)) throw new NativeKnowledgeError('EMBEDDING_DIMENSION_CHANGED');
    const candidates = hybridCandidates(rows, query);
    const addon = await this.db.infrastructureBinding.findUnique({ where: { tenantId_kind_scopeKey: { tenantId: this.binding.tenantId, kind: 'knowledge-rerank', scopeKey: 'tenant' } } });
    // Check the caller's current permissions before sending any passage to another provider.
    if (addon?.enabled && candidates.length) await authorize?.();
    const ranked = await rerank(query, candidates, addon);
    return ranked.rows.slice(0, 8).map(x => ({ source: { datasetId: x.datasetId, documentId: x.documentId }, text: x.text, locator: x.locator,
      retrieval: { mode: 'hybrid', reranker: ranked.mode, degraded: ranked.degraded } }));
  }
}
