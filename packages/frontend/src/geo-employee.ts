export const geoEmployee = {
  name: 'GEO 品牌分析官',
  role: '品牌可见度分析',
  summary: '解读品牌分析报告，找出竞品出现而品牌缺席的问题，整理优化建议和复测条件。',
  tasks: ['解读品牌表现与样本限制', '核对竞品缺席问题和引用证据', '准备优化建议与复测条件'],
  outputs: ['品牌提及与推荐摘要', '带证据的差距清单', '优化建议与复测核对项'],
  confirmation: '请核对回答证据和优化建议。发起分析或复测时，在报告页面确认费用。',
  starters: [
    ['解读报告', '解读当前品牌分析报告，区分品牌提及、推荐和样本限制。没有关联报告时，请提示我从报告页打开对话。'],
    ['核对竞品差距', '根据当前报告找出竞品出现而品牌缺席的问题，列出对应的回答依据和引用。只列出报告中有证据的发现。'],
    ['优化与复测', '根据当前报告给出优先优化建议，列出应保持一致的复测条件，并说明有哪些结论还需要核实。'],
  ],
} as const;

export function geoEmployeeContext(pathname: string) {
  const match = pathname.match(/^\/t\/[^/]+\/geo\/projects\/([0-9a-f-]{36})(?:\/analyses\/([0-9a-f-]{36}))?(?:\/|$)/i);
  if (!match) return null;
  return match[2] ? { type: 'analysis', id: match[2] } : { type: 'project', id: match[1] };
}
