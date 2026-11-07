import { z } from 'zod';
import { readBody } from './security';

const input = z.object({page:z.coerce.number().int().min(1).max(100000).default(1),page_size:z.coerce.number().int().min(1).max(100).default(20)});

/** Optional pagination preserves existing array consumers that omit both keys. */
export function readCollectionPage(query: unknown) {
  if (!query || typeof query !== 'object' || !('page' in query || 'page_size' in query)) return null;
  const value = readBody(input, query);
  return {...value,skip:(value.page - 1) * value.page_size,take:value.page_size};
}

export function collectionResult<T>(items:T[], total:number, page:NonNullable<ReturnType<typeof readCollectionPage>>) {
  return {items,total,page:page.page,page_size:page.page_size};
}
