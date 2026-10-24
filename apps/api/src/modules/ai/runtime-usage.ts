/** Usage is provider-reported metadata. Cache/reasoning are subsets, never extra totals. */
export type RuntimeUsage = {
  inputTokens?: number; outputTokens?: number; totalTokens?: number;
  cachedInputTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number;
  transportTiming?: { gatewayHeadersMs: number; gatewayFirstDeltaMs: number | null; gatewayTotalMs: number };
};
export type RuntimeReceipt = { externalId?: string; model?: string; requestedModel?: string; usage?: RuntimeUsage };
const count = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
export function responseReceipt(payload: unknown, requestedModel?: string): RuntimeReceipt {
  const value = payload as any;
  const raw = value?.usage;
  const usage: RuntimeUsage = {
    inputTokens: count(raw?.input_tokens), outputTokens: count(raw?.output_tokens), totalTokens: count(raw?.total_tokens),
    cachedInputTokens: count(raw?.input_tokens_details?.cached_tokens), cacheWriteTokens: count(raw?.input_tokens_details?.cache_write_tokens),
    reasoningTokens: count(raw?.output_tokens_details?.reasoning_tokens),
  };
  // Gateway failures can synthesize an all-zero usage object without a provider receipt.
  const allZeroGatewayDefault=requestedModel?.startsWith('openclaw/')&&Object.values(usage).some(x=>x!==undefined)&&!Object.values(usage).some(x=>typeof x==='number'&&x>0);
  const hasUsage = !allZeroGatewayDefault&&Object.values(usage).some(x => x !== undefined) &&
    (!['failed', 'incomplete'].includes(value?.status) || Object.values(usage).some(x => typeof x === 'number' && x > 0));
  return { externalId: typeof value?.id === 'string' ? value.id : undefined, requestedModel,
    model: typeof value?.model === 'string' && !value.model.startsWith('openclaw/') ? value.model : undefined,
    ...(hasUsage ? { usage: Object.fromEntries(Object.entries(usage).filter(([, v]) => v !== undefined)) } : {}) };
}
export function usageColumns(receipt?: RuntimeReceipt) {
  const usage = receipt?.usage;
  const complete = count(usage?.inputTokens) !== undefined && count(usage?.outputTokens) !== undefined;
  return {
    externalId: receipt?.externalId, model: receipt?.model, requestedModel: receipt?.requestedModel,
    usageStatus: complete ? 'reported' : usage&&[usage.inputTokens,usage.outputTokens,usage.totalTokens].some(x=>count(x)!==undefined) ? 'partial' : 'unknown',
    inputTokens: count(usage?.inputTokens), outputTokens: count(usage?.outputTokens),
    totalTokens: count(usage?.totalTokens) ?? (complete ? usage!.inputTokens! + usage!.outputTokens! : undefined),
    cachedInputTokens: count(usage?.cachedInputTokens), cacheWriteTokens: count(usage?.cacheWriteTokens), reasoningTokens: count(usage?.reasoningTokens),
  };
}
