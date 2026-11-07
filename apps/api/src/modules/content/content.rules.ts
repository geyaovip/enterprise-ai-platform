import { videoOptions } from "./seedance.provider";
import { imageRatios } from "./content-image-options";
import { z } from "zod";
import { createHash } from "node:crypto";
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, value]) => [k, canonical(value)]),
    );
  return v;
}
export const hash = (v: unknown) =>
  createHash("sha256")
    .update(typeof v === "string" ? v : JSON.stringify(canonical(v)))
    .digest("hex");
export const json = (v: unknown) => JSON.parse(JSON.stringify(v));
export const id = z.uuid();
const text = z.string().trim().max(2000);
export const sizes = {
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1440 },
  story: { width: 1080, height: 1920 },
} as const;
export const documentInput = z
  .object({
    version: z.int().positive().optional(),
    name: z.string().trim().min(1).max(120),
    data: z
      .object({
        logoId: id.optional(),
        imageId: id.optional(),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .default("#6153cc"),
        font: z.enum(["sans"]).default("sans"),
        tone: text.default(""),
        forbiddenWords: z.array(z.string().min(1).max(50)).max(100).default([]),
        sellingPoints: text.default(""),
        parameters: text.default(""),
        price: z.string().max(80).default(""),
        validUntil: z.string().max(80).default(""),
        disclaimer: text.default(""),
        template: z.enum(["hero", "split", "minimal"]).default("hero"),
        layout: z
          .array(
            z
              .object({
                role: z.string().min(1).max(30),
                x: z.number().min(0).max(1),
                y: z.number().min(0).max(1),
                w: z.number().min(0.01).max(1),
                h: z.number().min(0.01).max(1),
                fontSize: z.number().min(10).max(150),
                color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
                locked: z.boolean(),
              })
              .strict(),
          )
          .max(30)
          .optional(),
      })
      .strict(),
  })
  .strict();
export const projectInput = z
  .object({
    version: z.int().positive().optional(),
    name: z.string().trim().min(1).max(120),
    visibility: z.enum(["private", "tenant"]).default("private"),
    participants: z.array(id).max(100).default([]),
    brief: z
      .object({
        templateId: id.optional(),
        templateVersion: z.int().positive().optional(),
        workflow: z.enum(["layout", "studio"]).optional(),
        brandId: id.optional(),
        brandVersion: z.int().positive().optional(),
        productIds: z
          .array(id)
          .max(20)
          .refine((a) => new Set(a).size === a.length, "产品不能重复"),
        productVersions: z.record(z.string(), z.number().int().positive()),
        prompt: text.min(1),
        audience: text.default(""),
        channel: text.default(""),
        title: z.string().max(120).default(""),
        cta: z.string().max(120).default("了解更多"),
        template: z.enum(["hero", "split", "minimal"]).default("hero"),
        sizes: z
          .array(z.enum(["square", "portrait", "story"]))
          .min(1)
          .max(3)
          .refine((a) => new Set(a).size === a.length, "尺寸不能重复"),
        variants: z.int().min(1).max(3).default(1),
        disclaimer: text.default(""),
      })
      .strict()
      .superRefine((b, ctx) => {
        if (
          b.workflow !== "studio" &&
          (!b.brandId || !b.brandVersion || !b.productIds.length)
        )
          ctx.addIssue({
            code: "custom",
            message: "版式项目需要品牌及产品资料",
          });
        if (Boolean(b.brandId) !== Boolean(b.brandVersion))
          ctx.addIssue({ code: "custom", message: "品牌及版本必须一起选择" });
      }),
  })
  .strict();
export const layer = z
  .object({
    id: z.string().max(80),
    type: z.enum(["text", "image"]),
    role: z.enum([
      "title",
      "body",
      "price",
      "date",
      "disclaimer",
      "cta",
      "product",
      "logo",
      "decoration",
    ]),
    text: z.string().max(2000).optional(),
    assetId: id.optional(),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(0.01).max(1),
    h: z.number().min(0.01).max(1),
    fontSize: z.number().min(10).max(150).default(36),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#222222"),
    locked: z.boolean().default(false),
    crop: z
      .object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        w: z.number().positive().max(1),
        h: z.number().positive().max(1),
      })
      .strict()
      .refine((r) => r.x + r.w <= 1.00001 && r.y + r.h <= 1.00001)
      .optional(),
  })
  .strict();
export const artwork = z
  .object({
    width: z.int().min(64).max(2048),
    height: z.int().min(64).max(2048),
    backgroundId: id.optional(),
    backgroundColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#f2f0fc"),
    layers: z
      .array(layer)
      .max(30)
      .refine(
        (layers) => new Set(layers.map((l) => l.id)).size === layers.length,
        "图层ID不能重复",
      )
      .refine(
        (layers) => layers.every((l) => l.type !== "image" || !!l.assetId),
        "图片图层需要素材",
      ),
    copy: z.object({
      title: z.string().max(2000),
      body: z.string().max(12000),
      cta: z.string().max(2000),
    }),
    source: z.record(z.string(), z.unknown()),
  })
  .strict()
  .refine(
    (a) => a.layers.length > 0 || a.source.workflow === "studio",
    "版式作品至少需要一个图层",
  );
/** Visible text is the source of the delivered copy. Layout edits never create a second text truth. */
export function syncArtworkCopy<T extends { layers: any[]; copy: any }>(
  data: T,
): T {
  return {
    ...data,
    copy: {
      title:
        data.layers.find((l) => l.type === "text" && l.role === "title")
          ?.text ?? "",
      body: data.layers
        .filter(
          (l) =>
            l.type === "text" &&
            ["body", "price", "date", "disclaimer"].includes(l.role),
        )
        .map((l) => l.text ?? "")
        .filter(Boolean)
        .join("\n"),
      cta:
        data.layers.find((l) => l.type === "text" && l.role === "cta")?.text ??
        "",
    },
  };
}
export const editRegion = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().positive().max(1),
    h: z.number().positive().max(1),
  })
  .refine((r) => r.x + r.w <= 1.00001 && r.y + r.h <= 1.00001);
export const generation = z
  .object({
    projectVersion: z.int().positive(),
    mode: z
      .enum(["background", "local_edit", "image", "video"])
      .default("background"),
    referenceAssetId: id.optional(),
    referenceAssetIds: z
      .array(id)
      .min(1)
      .max(4)
      .refine((ids) => new Set(ids).size === ids.length)
      .optional(),
    ratio: z.enum(imageRatios).optional(),
    resolution: z.enum(["2K", "4K"]).optional(),
    video: videoOptions.optional(),
    candidates: z.int().min(1).max(3).optional(),
    brand: z.object({ id, version: z.int().positive() }).strict().optional(),
    size: z.enum(["square", "portrait", "story"]).optional(),
    artifactId: id.optional(),
    artifactVersion: z.int().positive().optional(),
    instruction: text.default(""),
    region: editRegion.optional(),
  })
  .strict();
export function compose(
  brief: any,
  brand: any,
  product: any,
  size: keyof typeof sizes,
  source: any,
) {
  const title = brief.title || product.name;
  const d = product.data;
  const template = brief.template;
  const layers: any[] = [
    {
      id: "title",
      type: "text",
      role: "title",
      text: title,
      x: 0.07,
      y: 0.07,
      w: 0.86,
      h: 0.18,
      fontSize: 64,
      color: brand.data.color,
      locked: false,
    },
    {
      id: "body",
      type: "text",
      role: "body",
      text: [d.sellingPoints, d.parameters].filter(Boolean).join("\n"),
      x: 0.07,
      y: 0.25,
      w: 0.86,
      h: 0.12,
      fontSize: 30,
      color: "#333333",
      locked: false,
    },
    {
      id: "product",
      type: "image",
      role: "product",
      assetId: d.imageId,
      x: template === "split" ? 0.42 : template === "minimal" ? 0.45 : 0.2,
      y: template === "minimal" ? 0.42 : 0.38,
      w: template === "split" ? 0.5 : template === "minimal" ? 0.45 : 0.6,
      h: 0.39,
      fontSize: 36,
      color: "#222222",
      locked: true,
    },
    {
      id: "price",
      type: "text",
      role: "price",
      text: d.price,
      x: 0.07,
      y: 0.78,
      w: 0.55,
      h: 0.08,
      fontSize: 52,
      color: brand.data.color,
      locked: false,
    },
    {
      id: "date",
      type: "text",
      role: "date",
      text: d.validUntil,
      x: 0.07,
      y: 0.87,
      w: 0.86,
      h: 0.04,
      fontSize: 24,
      color: "#333333",
      locked: false,
    },
    {
      id: "disclaimer",
      type: "text",
      role: "disclaimer",
      text: brief.disclaimer || d.disclaimer,
      x: 0.07,
      y: 0.93,
      w: 0.86,
      h: 0.04,
      fontSize: 18,
      color: "#555555",
      locked: true,
    },
  ];
  if (brand.data.logoId)
    layers.push({
      id: "logo",
      type: "image",
      role: "logo",
      assetId: brand.data.logoId,
      x: 0.76,
      y: 0.02,
      w: 0.17,
      h: 0.06,
      fontSize: 36,
      color: "#222222",
      locked: true,
    });
  if (brief.cta)
    layers.push({
      id: "cta",
      type: "text",
      role: "cta",
      text: brief.cta,
      x: 0.65,
      y: 0.8,
      w: 0.28,
      h: 0.06,
      fontSize: 28,
      color: brand.data.color,
      locked: false,
    });
  return artwork.parse({
    ...sizes[size],
    layers: layers.filter((l) => l.type !== "image" || l.assetId),
    copy: {
      title,
      body: [
        d.sellingPoints,
        d.parameters,
        d.price,
        d.validUntil,
        brief.disclaimer || d.disclaimer,
      ]
        .filter(Boolean)
        .join("\n"),
      cta: brief.cta,
    },
    source,
    backgroundColor: "#f2f0fc",
  });
}

/** Supply visual color language rather than a hex string that can be painted as text. */
export function colorDescription(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16),
    g = parseInt(hex.slice(3, 5), 16),
    b = parseInt(hex.slice(5, 7), 16),
    max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  if (max - min < 25)
    return max < 80 ? "深灰中性色" : max > 210 ? "浅白中性色" : "柔和灰色";
  return r >= g && r >= b
    ? g > b * 1.25
      ? "温暖的米黄棕色系"
      : "柔和的暖红色系"
    : g >= r && g >= b
      ? "自然柔和的绿色系"
      : "柔和的蓝紫色系";
}
