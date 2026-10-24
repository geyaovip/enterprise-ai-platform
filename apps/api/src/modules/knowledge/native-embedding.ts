import { infrastructureEndpoint, infrastructureSecret, type Binding } from '../platform/infrastructure-contract';
import { NativeKnowledgeError } from './native-parser';
export class NativeEmbedding {
  readonly model: string;
  private readonly format: string;
  constructor(private readonly binding: Binding) {
    const options = binding.options as { embeddingModel?: string; embeddingFormat?: string };
    this.model = options.embeddingModel ?? ''; this.format = options.embeddingFormat ?? 'openai';
    if (!this.model || !['openai', 'ark-multimodal'].includes(this.format)) throw new NativeKnowledgeError('EMBEDDING_CONFIGURATION');
  }
  async embed(text: string, signal?: AbortSignal): Promise<number[]> {
    try {
      const baseUrl = infrastructureEndpoint(this.binding.baseUrl);
      const ark = this.format === 'ark-multimodal';
      const response = await fetch(`${baseUrl}/embeddings${ark ? '/multimodal' : ''}`, { method: 'POST', redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]), headers: { authorization: `Bearer ${infrastructureSecret(this.binding.secretCiphertext, true)}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: this.model, input: ark ? [{ type: 'text', text }] : [text] }) });
      if (!response.ok) throw new NativeKnowledgeError('EMBEDDING_UNAVAILABLE');
      const reader = response.body!.getReader(); let size = 0; const bytes: Uint8Array[] = [];
      while (true) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > 1024 * 1024) { await reader.cancel(); throw new NativeKnowledgeError('EMBEDDING_INVALID'); } bytes.push(item.value); }
      const result = JSON.parse(Buffer.concat(bytes).toString('utf8'));
      const vector = ark ? result.data?.embedding ?? result.data?.[0]?.embedding : result.data?.[0]?.embedding;
      if (!Array.isArray(vector) || !vector.length || vector.length > 4000 || vector.some(x => typeof x !== 'number' || !Number.isFinite(x)) || !vector.some(x => x !== 0) || vector.some(x => Math.abs(x) > 65504)) throw new NativeKnowledgeError('EMBEDDING_INVALID');
      const norm = Math.hypot(...vector);
      if (!Number.isFinite(norm) || norm === 0) throw new NativeKnowledgeError('EMBEDDING_INVALID');
      return vector.map(x => x / norm);
    } catch (error) { if (error instanceof NativeKnowledgeError) throw error; throw new NativeKnowledgeError('EMBEDDING_UNAVAILABLE'); }
  }
}
