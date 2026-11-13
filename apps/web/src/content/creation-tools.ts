import {
  ArticleIcon,
  CropIcon,
  ClosedCaptioningIcon,
  FaceMaskIcon,
  MicrophoneStageIcon,
  TranslateIcon,
  WaveformIcon,
  FilmSlateIcon,
  FrameCornersIcon,
  ImageIcon,
  MegaphoneIcon,
  ShoppingBagIcon,
  VideoCameraIcon,
} from "@phosphor-icons/react";

import type { CloudMediaKind } from "./CloudMediaTool";

type Field = { label: string; placeholder: string; optional?: true };
type MediaTool = {
  mode: "image" | "video";
  requiresReference?: true;
  ratio: string;
};
export type CreationTool = {
  id: string;
  name: string;
  description: string;
  icon: typeof ImageIcon;
} & (
  | {
      category: "图片" | "视频";
      media: MediaTool;
      fields: readonly Field[];
      instruction: string;
    }
  | {
      category: "文案";
      fields: readonly Field[];
      instruction: string;
    }
  | { category: "素材处理"; operation: "image" | "frame" }
  | { category: "视频" | "音频" | "素材处理"; cloud: CloudMediaKind }
);
export type GuidedMediaTool = Extract<CreationTool, { media: MediaTool }>;

export const creationTools: readonly CreationTool[] = [
  {
    id: "product-scene", name: "商品场景图", description: "用商品原图制作电商场景图",
    category: "图片", icon: ShoppingBagIcon,
    media: { mode: "image", requiresReference: true, ratio: "1:1" },
    fields: [
      { label: "商品名称", placeholder: "例如 冷萃咖啡" },
      { label: "场景与风格", placeholder: "例如 木桌、晨光、自然商业摄影" },
      { label: "需要保留的细节", placeholder: "例如 瓶身标签与颜色", optional: true },
    ],
    instruction: "生成一张电商商品场景图。保留参考图中商品的外观、包装、颜色和标识，突出商品，采用清晰的商业摄影构图，不添加未提供的卖点、标志或装饰文字。",
  },
  {
    id: "event-poster", name: "活动海报", description: "填写活动信息，制作宣传海报",
    category: "图片", icon: MegaphoneIcon,
    media: { mode: "image", ratio: "3:4" },
    fields: [
      { label: "活动主题", placeholder: "例如 周末咖啡市集" },
      { label: "活动信息", placeholder: "例如 11 月 21 日，城市广场", optional: true },
      { label: "视觉风格", placeholder: "例如 暖色、手绘、轻松", optional: true },
    ],
    instruction: "设计一张品牌活动宣传海报。突出用户填写的活动主题，信息层级清楚。画面文字只采用填写的活动主题和活动信息，不虚构日期、地点、价格或权益。",
  },
  {
    id: "social-image", name: "社媒配图", description: "生成适合品牌社媒发布的图片",
    category: "图片", icon: ImageIcon,
    media: { mode: "image", ratio: "3:4" },
    fields: [
      { label: "内容主题", placeholder: "例如 冬季新品上架" },
      { label: "发布平台", placeholder: "例如 小红书、公众号", optional: true },
      { label: "画面风格", placeholder: "例如 暖色生活感，画面简洁", optional: true },
    ],
    instruction: "按主题创作一张品牌社媒配图。重点明确，兼顾手机屏幕可读性。画面保留后期排字空间，不添加未经提供的标志、数字或宣传语。",
  },
  {
    id: "image-to-video", name: "图生视频", description: "上传首帧，描述镜头和动作",
    category: "视频", icon: FilmSlateIcon,
    media: { mode: "video", requiresReference: true, ratio: "adaptive" },
    fields: [
      { label: "镜头或动作", placeholder: "例如 镜头缓慢推近，咖啡表面泛起涟漪" },
      { label: "氛围与节奏", placeholder: "例如 自然光、节奏舒缓", optional: true },
    ],
    instruction: "以参考图片为起始画面制作一个连续镜头。保持主体、标识和构图稳定，按要求实现镜头运动或主体动作，不新增字幕或商标。",
  },
  {
    id: "social-copy", name: "社媒文案", description: "生成标题、正文与话题建议",
    category: "文案", icon: ArticleIcon,
    fields: [
      { label: "主题与已知事实", placeholder: "例如 推广冬季新品，口味为燕麦拿铁" },
      { label: "发布平台", placeholder: "例如 小红书" },
      { label: "受众或语气", placeholder: "例如 上班族，简洁亲切", optional: true },
    ],
    instruction: "撰写一版可直接编辑的品牌社媒文案，包含三个备选标题、一版正文、建议话题及需人工核对的内容。只使用已提供的事实，不虚构价格、功效或活动承诺。",
  },
  {
    id: "video-script", name: "短视频脚本", description: "生成口播稿和按时间排列的分镜",
    category: "文案", icon: VideoCameraIcon,
    fields: [
      { label: "主题与卖点", placeholder: "例如 新品冷萃咖啡，低温萃取" },
      { label: "视频时长", placeholder: "例如 30 秒" },
      { label: "受众或语气", placeholder: "例如 通勤人群，轻松自然", optional: true },
    ],
    instruction: "输出可直接拍摄的中文短视频脚本。先给开场钩子，再按时间段列画面、镜头、口播和屏幕字幕，最后给出行动引导。时间段须与总时长一致，所有产品事实仅以用户提供的信息为准。",
  },
  {
    id: "presenter-video", name: "口播成片", description: "用现有出镜视频，把口播稿做成带字幕的成片",
    category: "视频", icon: VideoCameraIcon, cloud: "presenter-video",
  },
  {
    id: "voice-over", name: "文字配音", description: "把口播稿转成可下载的 MP3",
    category: "音频", icon: MicrophoneStageIcon, cloud: "voice-over",
  },
  {
    id: "auto-subtitles", name: "自动字幕", description: "从视频或音频识别语音，导出 SRT",
    category: "素材处理", icon: ClosedCaptioningIcon, cloud: "auto-subtitles",
  },
  {
    id: "burn-subtitles", name: "字幕压制", description: "把 SRT 烧录到 MP4 画面中",
    category: "素材处理", icon: FilmSlateIcon, cloud: "burn-subtitles",
  },
  {
    id: "lip-sync", name: "口型对齐", description: "用一段音频驱动视频中人物的口型",
    category: "视频", icon: WaveformIcon, cloud: "lip-sync",
  },
  {
    id: "face-swap", name: "视频换脸", description: "上传授权人像和单人视频，生成换脸成片",
    category: "视频", icon: FaceMaskIcon, cloud: "face-swap",
  },
  {
    id: "translate-subtitles", name: "字幕翻译", description: "翻译 SRT 文本并保留原时间轴",
    category: "素材处理", icon: TranslateIcon, cloud: "translate-subtitles",
  },
  {
    id: "image-edit", name: "图片处理", description: "裁剪、旋转和镜像本地图片",
    category: "素材处理", icon: CropIcon, operation: "image",
  },
  {
    id: "video-frame", name: "视频截帧", description: "从本地视频导出首帧、当前帧或尾帧",
    category: "素材处理", icon: FrameCornersIcon, operation: "frame",
  },
];

export function toolPrompt(tool: Extract<CreationTool, { fields: readonly Field[] }>, values: string[]) {
  return [
    tool.instruction,
    ...tool.fields.flatMap(({ label }, index) => {
      const value = values[index]?.trim();
      return value ? [label + "：" + value] : [];
    }),
  ].join("\n");
}
