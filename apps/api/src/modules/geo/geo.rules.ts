import { createHash } from "node:crypto";
import { z } from "zod";
export const json = (v: unknown): any => JSON.parse(JSON.stringify(v));
function canonical(v: any): any {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .filter((k) => v[k] !== undefined)
        .map((k) => [k, canonical(v[k])]),
    );
  return v;
}
export const hash = (v: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(v)))
    .digest("hex");
const names = z.array(z.string().trim().min(1).max(100)).max(20).default([]);
export const projectInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    brandName: z.string().trim().min(1).max(100),
    aliases: names,
    competitors: names,
    website: z
      .url()
      .max(2000)
      .refine((v) => /^https?:\/\//.test(v), "仅支持 HTTP(S)")
      .optional()
      .nullable(),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .default("CN"),
    language: z.string().min(2).max(30).default("zh-CN"),
    timezone: z
      .string()
      .max(100)
      .refine((v) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }, "时区无效")
      .default("Asia/Shanghai"),
    active: z.boolean().default(true),
  })
  .strict();
export const questionInput = z
  .object({
    text: z.string().trim().min(2).max(1000),
    category: z.string().trim().min(1).max(50).default("品牌认知"),
    nativeWebSearch: z.boolean().default(false),
    enabled: z.boolean().default(true),
  })
  .strict();
export const modelInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    family: z.enum(["doubao", "kimi", "glm", "deepseek"]),
    code: z.string().trim().min(1).max(150),
    apiMode: z.enum(["responses", "chat_completions"]),
    apiKey: z.string().min(8).max(1000).optional(),
    nativeWebSearch: z.boolean().default(false),
    inputPriceMicrosPerMillion: z.int().nonnegative().max(1000000000),
    outputPriceMicrosPerMillion: z.int().nonnegative().max(1000000000),
    searchPriceMicros: z.int().nonnegative().max(10000000).default(0),
    enabled: z.boolean().default(true),
  })
  .strict()
  .refine(
    (v) => !v.nativeWebSearch || v.apiMode === "responses",
    "联网模型须使用 Responses API",
  );
export const selection = z
  .object({
    questionIds: z.array(z.uuid()).min(1).max(32),
    modelIds: z.array(z.uuid()).min(1).max(8),
    maxCostMicros: z.int().positive().max(100000000),
    baselineId: z.uuid().optional(),
    optimizationId: z.uuid().optional(),
  })
  .strict();
export const submitInput = selection.extend({
  requestKey: z.string().min(8).max(160),
  estimateHash: z.string().length(64),
});
export const scheduleInput = selection
  .omit({ baselineId: true, optimizationId: true })
  .extend({
    name: z.string().trim().min(1).max(120),
    frequency: z.enum(["daily", "weekly"]),
    hour: z.int().min(0).max(23),
    minute: z.int().min(0).max(59),
    weekday: z.int().min(0).max(6).default(1),
    active: z.boolean().default(true),
  })
  .strict();
export const optimizationInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(2000),
    baselineId: z.uuid(),
    sourceRunId: z.uuid().optional(),
    assigneeMembershipId: z.uuid().nullable().optional(),
    evidenceUrl: z
      .url()
      .max(2000)
      .refine((v) => /^https?:\/\//.test(v))
      .nullable()
      .optional(),
    dueAt: z.iso.datetime().nullable().optional(),
    status: z.enum(["open", "in_progress", "done"]).default("open"),
  })
  .strict();
export const versionInput = z.object({ version: z.int().positive() });
export const pageInput = z.object({
  page: z.coerce.number().int().positive().max(100000).default(1),
  page_size: z.coerce.number().int().positive().max(100).default(20),
  q: z.string().max(120).default(""),
});
export const GEO_ROLES: Record<string, string[]> = {
  manager: [
    "geo.read",
    "geo.project.manage",
    "geo.analysis.run",
    "geo.monitor.manage",
    "geo.optimization.manage",
    "geo.settings.manage",
    "geo.ai.use",
  ],
  analyst: [
    "geo.read",
    "geo.project.manage",
    "geo.analysis.run",
    "geo.monitor.manage",
    "geo.optimization.manage",
    "geo.ai.use",
  ],
  viewer: ["geo.read", "geo.ai.use"],
};
export const GEO_MANIFEST = {
  appId: "geo",
  displayName: "GEO 品牌可见度",
  routePrefix: "/geo",
  permissions: GEO_ROLES.manager,
  aiCapabilities: ["conversation", "geo_analysis", "evidence_reports"],
  defaultAgentId: "geo.assistant",
};
export async function geoPermissions(
  db: any,
  tenantId: string,
  role: string,
  membershipId: string,
) {
  if (role === "admin") return GEO_ROLES.manager;
  const grant = await db.geoGrant.findUnique({
    where: { tenantId_membershipId: { tenantId, membershipId } },
  });
  return GEO_ROLES[grant?.role] ?? [];
}
export const activeStatuses = ["queued", "running"];
export const terminalStatuses = [
  "completed",
  "partially_completed",
  "failed",
  "cancelled",
  "needs_review",
];
export const OUTPUT_LIMIT = 2048;
export const PROTOCOL_VERSION = "geo-analysis-v1";
export function runCost(
  inputTokens: number,
  outputTokens: number,
  m: {
    inputPriceMicrosPerMillion: number;
    outputPriceMicrosPerMillion: number;
    searchPriceMicros: number;
  },
  search: boolean | number,
) {
  return (
    Math.ceil(
      (inputTokens * m.inputPriceMicrosPerMillion +
        outputTokens * m.outputPriceMicrosPerMillion) /
        1000000,
    ) +
    (typeof search === "number" ? search : search ? 1 : 0) * m.searchPriceMicros
  );
}
export type FrozenQuestion = {
  id: string;
  text: string;
  category: string;
  nativeWebSearch: boolean;
  version: number;
};
export type FrozenModel = {
  id: string;
  versionId: string;
  name: string;
  family: string;
  code: string;
  apiMode: "responses" | "chat_completions";
  nativeWebSearch: boolean;
  inputPriceMicrosPerMillion: number;
  outputPriceMicrosPerMillion: number;
  searchPriceMicros: number;
  revision: number;
};
export type FrozenInput = {
  protocolVersion: string;
  brandName: string;
  aliases: string[];
  competitors: string[];
  country: string;
  language: string;
  questions: FrozenQuestion[];
  models: FrozenModel[];
  parserVersion: string;
  scoreVersion: string;
};
export function promptText(q: FrozenQuestion, s: FrozenInput) {
  return `请按问题本身回答，提供准确事实；如需排名，只在有可靠依据时用明确数字编号。国家/地区：${s.country}；语言：${s.language}。\n\n${q.text}`;
}
