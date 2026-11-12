// One public role, backed by the existing content.assistant and its permission checks.
export const contentEmployee = {
  name: '品牌内容创作官',
  avatar: '/marketing/employee-content.png',
  role: '品牌短视频与图文创作',
  summary: '根据品牌与产品资料准备短视频脚本、分镜和宣传图文，协助核对素材与生成结果。',
  tasks: ['准备短视频脚本与分镜', '准备宣传图文与参考改图', '核对视频和图片生成进度'],
  outputs: ['短视频脚本与分镜', '宣传图描述与配套文案', '生成进度与可下载素材'],
  confirmation: '生成前确认规格和费用，发布前核对文案、产品细节和品牌要求。',
  starters: [
    ['短视频脚本', '根据我提供或当前项目的品牌与产品资料，设计一条竖屏短视频，给出脚本、分镜和生成描述。'],
    ['宣传图文', '根据当前项目已核对的品牌与产品资料，准备宣传图描述和配套文案。'],
    ['品牌核对', '核对当前项目的文案与品牌资料，列出需要人工确认的文字、产品事实和品牌要求。'],
    ['生成进展', '查看当前项目的视频和图片生成任务，列出当前进度和可下载的素材。'],
  ],
} as const;

export function contentProjectContext(pathname: string): string | null {
  return pathname.match(/^\/t\/[^/]+\/content\/projects\/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})(?:\/|$)/i)?.[1] ?? null;
}
