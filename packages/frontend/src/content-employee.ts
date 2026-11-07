// One public role, backed by the existing content.assistant and its permission checks.
export const contentEmployee = {
  name: '品牌内容创作官',
  role: '品牌宣传图片创作',
  summary: '结合品牌与产品资料整理创作需求，准备画面和文案建议，协助核对修改与生成结果。',
  tasks: ['整理创作需求与描述', '核对品牌资料与文案', '跟进图片生成与修改'],
  outputs: ['待确认的画面描述与标题建议', '品牌及产品事实核对项', '图片生成清单与结果记录'],
  confirmation: '请确认创作描述，发布前核对文案、产品细节和品牌要求。',
  starters: [
    ['创作需求', '帮我梳理一张品牌宣传图的需求，先确认用途、主体、画面风格与文案；产品事实以我提供或当前项目资料为准。'],
    ['标题建议', '根据当前项目已核对的品牌与产品资料，给我三个标题建议；缺少资料时先询问。'],
    ['品牌核对', '核对当前项目的文案与品牌资料，列出需要人工确认的文字、产品事实和品牌要求。'],
    ['生成进展', '查看当前项目已有的图片生成任务和结果，整理可继续修改或下载的内容。'],
  ],
} as const;

export function contentProjectContext(pathname: string): string | null {
  return pathname.match(/^\/t\/[^/]+\/content\/projects\/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})(?:\/|$)/i)?.[1] ?? null;
}
