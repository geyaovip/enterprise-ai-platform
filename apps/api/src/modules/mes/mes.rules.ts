import { z } from "zod";
import { Prisma } from "../../generated/prisma/client";
import { HttpException } from "@nestjs/common";
export const fail = (code: string, message: string, status = 409): never => {
  throw new HttpException({ code, message }, status);
};
export function parse<T>(s: z.ZodType<T>, raw: unknown): T {
  const v = s.safeParse(raw);
  if (!v.success)
    throw new HttpException(
      {
        code: "INVALID_REQUEST",
        message: "请检查填写内容",
        fieldErrors: v.error.issues.map((x) => ({
          path: x.path.join("."),
          message: x.message,
        })),
      },
      400,
    );
  return v.data;
}
export const json = (v: any): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(v));
export const version = z.int().positive(),
  requestKey = z.uuid(),
  text = z.string().trim().min(1).max(120),
  quantity = z.int().positive().max(10000000);
export const decimal = z
  .string()
  .regex(/^\d{1,9}(?:\.\d{1,3})?$/)
  .refine((v) => /^\d{1,9}(?:\.\d{1,3})?$/.test(v) && new Prisma.Decimal(v).gt(0), "用量必须大于零");
export function bomUnitKey(value:string){const v=value.normalize('NFKC').trim().toLowerCase();return ['pcs','pc','ea','piece','pieces','件','个'].includes(v)?'piece':v;}
export function notPopulated(population?:string,quantity?:string,mpn?:string){
  const clean=(v?:string)=>(v??'').normalize('NFKC').trim();
  return clean(population).split(/[\/;；|]/).some(v=>/^(?:DNP|DNI|DNE|NC|EXCLUDED\s+FROM\s+BOM|NOT\s*(?:FITTED|POPULATED)|NO|FALSE|不装|不贴|未装配)$/i.test(v.trim()))||/^(?:DNP|DNI|DNE)$/i.test(clean(quantity))||/^(?:DNP|DNI|DNE)$/i.test(clean(mpn));
}
const bomSourceFacts={
 // Accept and discard the retired field from already-open clients.
 ocrCheck:z.unknown().optional().transform(()=>undefined),
 sourceItem:z.string().max(500).optional(),vision:z.object({jobId:z.uuid(),fileId:z.uuid(),pageIndex:z.int().min(0).max(23),models:z.array(z.enum(['glm-5-3-flash-260828','kimi-k3-1-pro-261024'])).min(1).max(2),usageIds:z.array(z.uuid()).min(1).max(2),promptSha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict().optional(),
 spec:z.string().max(2000).optional(),length:z.string().max(500).optional(),comment:z.string().max(2000).optional(),value:z.string().max(2000).optional(),connector:z.string().max(2000).optional(),terminal:z.string().max(2000).optional(),
 quantities:z.record(z.string().min(1).max(500),z.string().max(100)).refine(v=>Object.keys(v).length<=64).optional(),selectedVariant:z.string().max(500).optional(),
 columnMapping:z.array(z.object({column:z.int().min(1).max(64),header:z.string().max(500),field:z.string().max(600)}).strict()).max(64).optional(),
};
export const lineSchema = z
  .object({
    materialId: z.uuid(),
    quantity: decimal,
    wastePercent: z
      .string()
      .regex(/^\d{1,2}(?:\.\d{1,2})?$/)
      .default("0"),
    sourceEvidence:z.object({...bomSourceFacts,filename:z.string().max(160),sha256:z.string().regex(/^[a-f0-9]{64}$/).nullable(),page:z.int().positive().nullable(),sheet:z.string().max(160).nullable(),table:z.int().positive(),row:z.int().positive(),method:z.string().max(40),originalSku:z.string().max(500),originalQuantity:z.string().max(100),originalUnit:z.string().max(100).optional(),mpn:z.string().max(500).optional(),manufacturer:z.string().max(500).optional(),designators:z.array(z.string().max(30)).max(300).optional(),population:z.string().max(100).optional(),revision:z.string().max(80).optional(),productCode:z.string().max(100).optional(),sourceObjectId:z.string().max(500).optional(),sourceDesignator:z.string().max(100).optional(),sourceDesignators:z.string().max(10000).optional(),sourceUniqueId:z.string().max(500).optional(),sourceHierarchy:z.string().max(500).optional(),footprint:z.string().max(500).optional(),quantityBasis:z.literal('pcb-object-count').optional(),historyMatch:z.object({bomId:z.uuid(),revision:z.int().positive(),version:z.int().positive()}).strict().optional(),factReview:z.object({productId:z.uuid(),materialId:z.uuid(),quantity:decimal,unit:z.string().max(100),selectedVariant:z.string().max(500).optional()}).strict().optional(),reviewNote:z.string().trim().min(4).max(500).optional(),bbox:z.array(z.number().finite().nonnegative()).length(4).optional(),pageSize:z.array(z.number().finite().positive()).length(2).optional(),hasConflict:z.boolean().optional(),factReviewed:z.boolean().optional(),reviewed:z.literal(true)}).strict().refine(v=>(!v.bbox&&!v.pageSize)||Boolean(v.bbox&&v.pageSize&&v.bbox[2]>v.bbox[0]&&v.bbox[3]>v.bbox[1]&&v.bbox[2]<=v.pageSize[0]&&v.bbox[3]<=v.pageSize[1]),'原图坐标或图幅无效').optional(),
  })
  .strict()
  .refine(v=>{const e=v.sourceEvidence;if(!e?.quantities||!Object.keys(e.quantities).length)return true;return Boolean(e.selectedVariant&&Object.hasOwn(e.quantities,e.selectedVariant)&&!/^(?:0+(?:\.0+)?)$/.test(e.quantities[e.selectedVariant].trim())&&e.originalQuantity===e.quantities[e.selectedVariant]&&e.factReviewed===true&&e.factReview?.selectedVariant===e.selectedVariant);},'多机型来源须选择适用数量列并核实；该机型数量0的行不能采用')
  .refine(v=>{const e=v.sourceEvidence;if(!e?.quantities||!e.selectedVariant)return true;const raw=e.quantities[e.selectedVariant]?.trim()??'';return Boolean(e.reviewNote)||/^\d+(?:\.\d+)?$/.test(raw)&&new Prisma.Decimal(raw).equals(v.quantity);},'机型来源缺量或更改原用量时须填写核对依据')
  .refine(v=>!/^0+(?:\.0+)?$/.test(v.sourceEvidence?.originalQuantity.trim()??'')||Boolean(v.sourceEvidence?.factReviewed&&v.sourceEvidence.factReview&&v.sourceEvidence.reviewNote),'来源数量为0，改量须明确核实并填写依据')
  .refine(v=>!v.sourceEvidence?.method.startsWith('vision-')||Boolean(v.sourceEvidence.vision&&v.sourceEvidence.sha256&&v.sourceEvidence.factReviewed&&v.sourceEvidence.factReview),'视觉候选须保留模型来源并明确核对后保存')
  .refine(v=>!v.sourceEvidence||!notPopulated(v.sourceEvidence.population,v.sourceEvidence.originalQuantity,v.sourceEvidence.mpn),'来源标记为不装件，不能计入装配BOM')
  .refine(v=>!v.sourceEvidence?.factReview||(v.sourceEvidence.factReview.materialId===v.materialId&&new Prisma.Decimal(v.sourceEvidence.factReview.quantity).equals(v.quantity)),'核对后的物料或用量已变化，须重新核实')
  .refine(v=>v.sourceEvidence?.method!=='manual-source'||Boolean(v.sourceEvidence.sha256&&v.sourceEvidence.reviewNote),'人工补行须保留原件摘要与补录依据')
  .refine(v=>(!['ocr-cells','manual-source'].includes(v.sourceEvidence?.method??'')&&!v.sourceEvidence?.hasConflict&&!v.sourceEvidence?.quantityBasis&&!v.sourceEvidence?.historyMatch)||v.sourceEvidence?.factReviewed===true,'来源存在差异，须明确核实后保存');
export const bomDraft = z
  .object({
    productId: z.uuid(),
    note: z.string().trim().max(2000).default(""),
    lines: z.array(lineSchema).min(1).max(200),
  })
  .strict()
  .refine(v=>v.lines.every(l=>!l.sourceEvidence?.factReview||l.sourceEvidence.factReview.productId===v.productId),'核对后的父产品已变化，须重新核实')
  .refine(
    (v) => new Set(v.lines.map((x) => x.materialId)).size === v.lines.length,
    "同一物料只能出现一次",
  );
export const planDraft = z
  .object({
    code: text,
    productId: z.uuid(),
    bomId: z.uuid(),
    targetQty: quantity,
    dueAt: z.iso.datetime({ offset: true }),
    note: z.string().trim().max(2000).default(""),
  })
  .strict();
export const findingsSchema = z
  .array(
    z
      .object({
        lineId: z.uuid().nullable(),
        severity: z.enum(["warning", "critical"]),
        message: z.string().trim().min(2).max(500),
      })
      .strict(),
  )
  .max(30);
export const assertVersion = (v: any, n: number) => {
  if (!v) fail("NOT_FOUND", "记录不存在或不可见", 404);
  if (v.version !== n) fail("VERSION_CONFLICT", "记录已变化，请刷新后核对");
};
