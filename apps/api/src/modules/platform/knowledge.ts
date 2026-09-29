import type { RequestContext } from './context';

export type RetrievalContext = {
  request: RequestContext;
  query: string;
  resourceScope?: { type: string; id: string };
};

export type Citation = {
  appId: string;
  resourceType: string;
  resourceId: string;
  version?: number;
  title: string;
  excerpt?: string;
};

export type RetrievalResult = { text: string; citation: Citation };

export interface KnowledgeProvider {
  retrieve(context: RetrievalContext): Promise<RetrievalResult[]>;
}
