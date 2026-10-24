export type ThinkingPreference = 'auto' | 'fast' | 'deep';
export type ThinkingMode = 'fast' | 'deep';

// Only unambiguous social/help messages bypass business context; business requests
// (including references like “那位客户”) keep the existing controlled path.
export function lightweightMessage(content:string,hasResource=false){return !hasResource&&/^(?:你好|您好|嗨|hi|hello|早上好|晚上好|在吗|谢谢|多谢|感谢|再见|你是谁|你能做什么|你可以做什么|有什么功能)[！!？?。.\s]*$/i.test(content.trim());}

export function chooseThinkingMode(input: {content: string; allowAction: boolean; requireConfirmation?: boolean; useKnowledge: boolean; thinkingMode?: ThinkingPreference}, hasResource: boolean): ThinkingMode {
  if((!input.thinkingMode||input.thinkingMode==='auto')&&lightweightMessage(input.content,hasResource))return 'fast';
  // The common composer can propose an action without enabling immediate writes.
  // Explicit fast answers in that mode remain read-only and expose no tools.
  if (input.requireConfirmation && input.thinkingMode === 'fast' && !input.useKnowledge && !hasResource) return 'fast';
  // Context with data, citations or writable tools needs the full controlled path.
  if (input.allowAction || input.useKnowledge || hasResource) return 'deep';
  if (input.thinkingMode === 'fast' || input.thinkingMode === 'deep') return input.thinkingMode;
  const text = input.content.trim();
  if (text.length > 160 || /(?:深入|详细|全面|仔细|系统性|逐步|推理|分析|比较|对比|权衡|评估|规划|计划|方案|原因|风险|预算|计算|预测|总结|综合|决策|为什么|怎么做)/i.test(text)) return 'deep';
  return 'fast';
}
