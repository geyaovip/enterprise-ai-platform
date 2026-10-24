import { ServiceUnavailableException } from '@nestjs/common';
import { infrastructureEndpoint, infrastructureSecret, type Binding } from '../platform/infrastructure-contract';
import type { EngineChunk, EngineSource, KnowledgeEngine } from './knowledge-engine';

export class RagflowAdapter implements KnowledgeEngine {
  readonly provider = 'ragflow';
  constructor(private readonly binding: Binding) {}
  async health() { const data = await this.request('/datasets?page=1&page_size=1'); if (!Array.isArray(data)) throw new ServiceUnavailableException('知识引擎状态无效'); }
  private async request(path: string, method = 'GET', body?: unknown, form?: FormData): Promise<any> {
    try {
      const response = await fetch(`${infrastructureEndpoint(this.binding.baseUrl)}/api/v1${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { authorization: `Bearer ${infrastructureSecret(this.binding.secretCiphertext, true)}`, ...(!form ? { 'content-type': 'application/json' } : {}) }, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) });
      if (!response.ok) throw new ServiceUnavailableException(`RAGFlow 返回 ${response.status}`);
      const value = await response.json() as { code?: number; data?: unknown };
      if (value.code !== 0) throw new ServiceUnavailableException('RAGFlow 操作失败');
      return value.data;
    } catch (error) { if (error instanceof ServiceUnavailableException) throw error; throw new ServiceUnavailableException('RAGFlow 连接失败或超时'); }
  }
  async createDataset(stableName: string) {
    const existing = await this.request(`/datasets?name=${encodeURIComponent(stableName)}&page_size=100`);
    if (Array.isArray(existing)) { const found = existing.find(x => x.name === stableName); if (typeof found?.id === 'string') return found.id; }
    const options = this.binding.options as { embeddingModel?: string };
    const created = await this.request('/datasets', 'POST', { name: stableName, embedding_model: options.embeddingModel, permission: 'me', chunk_method: 'naive' });
    if (typeof created?.id !== 'string') throw new ServiceUnavailableException('RAGFlow 数据集结构无效');
    return created.id as string;
  }
  async upload(datasetId: string, file: { filename: string; mimeType: string; bytes: Uint8Array }) {
    const form = new FormData(); form.append('file', new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }), file.filename);
    const files = await this.request(`/datasets/${encodeURIComponent(datasetId)}/documents`, 'POST', undefined, form);
    if (!Array.isArray(files) || typeof files[0]?.id !== 'string') throw new ServiceUnavailableException('RAGFlow 文档结构无效');
    return files[0].id as string;
  }
  async parse(source: EngineSource) { await this.request(`/datasets/${encodeURIComponent(source.datasetId)}/chunks`, 'POST', { document_ids: [source.documentId] }); }
  async status(source: EngineSource): Promise<'processing' | 'ready' | 'failed'> {
    const data = await this.request(`/datasets/${encodeURIComponent(source.datasetId)}/documents?id=${encodeURIComponent(source.documentId)}`);
    const docs = data?.docs ?? data;
    const doc = Array.isArray(docs) ? docs.find(x => x.id === source.documentId) : undefined;
    if (!doc) throw new ServiceUnavailableException('RAGFlow 文档状态不可用');
    if (['FAIL', '4', 4, 'CANCEL', '2', 2].includes(doc.run) || Number(doc.progress) < 0) return 'failed';
    return ['DONE', '3', 3].includes(doc.run) || Number(doc.progress) >= 1 ? 'ready' : 'processing';
  }
  async remove(source: EngineSource) {
    // Every platform index owns an exclusive dataset, including any unacknowledged upload retries.
    const existing = await this.request(`/datasets?id=${encodeURIComponent(source.datasetId)}`);
    if (Array.isArray(existing) && !existing.some(d => d.id === source.datasetId)) return;
    await this.request('/datasets', 'DELETE', { ids: [source.datasetId] });
  }
  async retrieve(query: string, sources: EngineSource[]): Promise<EngineChunk[]> {
    if (!sources.length) return [];
    const data = await this.request('/retrieval', 'POST', { question: query, dataset_ids: [...new Set(sources.map(x => x.datasetId))], document_ids: sources.map(x => x.documentId), page: 1, page_size: 8, highlight: false, use_kg: false, include_knowledge_compilation: false });
    if (!Array.isArray(data?.chunks)) throw new ServiceUnavailableException('RAGFlow 检索结构无效');
    return data.chunks.slice(0, 8).map((chunk: any) => {
      const datasetId = chunk.dataset_id ?? chunk.kb_id;
      const source = sources.find(x => x.datasetId === datasetId && x.documentId === chunk.document_id);
      // An out-of-scope result means the engine failed the isolation contract.
      if (!source || typeof chunk.content !== 'string' || chunk.content.length > 100_000) throw new ServiceUnavailableException('知识引擎返回超范围或无效内容');
      return { source, text: chunk.content.slice(0, 6000), locator: { positions: Array.isArray(chunk.positions) ? chunk.positions : [] } };
    });
  }
}
