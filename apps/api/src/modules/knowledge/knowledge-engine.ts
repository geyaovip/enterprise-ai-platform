export type EngineSource = { datasetId: string; documentId: string };
export type EngineChunk = { source: EngineSource; text: string; locator: Record<string, unknown>; retrieval?: { mode: string; reranker: string; degraded: boolean } };
export interface KnowledgeEngine {
  readonly provider: string;
  health(): Promise<void>;
  createDataset(stableName: string): Promise<string>;
  upload(datasetId: string, file: { filename: string; mimeType: string; bytes: Uint8Array }): Promise<string>;
  parse(source: EngineSource): Promise<void>;
  status(source: EngineSource): Promise<'processing' | 'ready' | 'failed'>;
  remove(source: EngineSource): Promise<void>;
  retrieve(query: string, authorizedSources: EngineSource[], authorize?: () => Promise<void>): Promise<EngineChunk[]>;
}
