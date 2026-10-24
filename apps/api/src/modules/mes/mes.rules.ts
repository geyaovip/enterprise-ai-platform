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
  .refine((v) => new Prisma.Decimal(v).gt(0), "用量必须大于零");
export const lineSchema = z
  .object({
    materialId: z.uuid(),
    quantity: decimal,
    wastePercent: z
      .string()
      .regex(/^\d{1,2}(?:\.\d{1,2})?$/)
      .default("0"),
  })
  .strict();
export const bomDraft = z
  .object({
    productId: z.uuid(),
    note: z.string().trim().max(2000).default(""),
    lines: z.array(lineSchema).min(1).max(50),
  })
  .strict()
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
