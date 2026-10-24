import { randomUUID } from "node:crypto";
import { CommandRegistry } from "../orchestration/command-registry";
import { MesService } from "./mes.service";
import { bomDraft, planDraft, json, fail } from "./mes.rules";
export function registerMesContract(
  registry: CommandRegistry,
  mes: MesService,
) {
  registry.register({
    appId: "mes",
    id: "mes.bom.create_draft",
    permission: "mes.bom.write",
    title: "创建BOM草稿",
    confirmation: true,
    input: bomDraft,
    execute: async (tx, ctx, draft) => ({
      state: "completed",
      result: json(
        await mes.saveBom(
          ctx,
          undefined,
          { requestKey: randomUUID(), draft },
          tx,
        ),
      ),
    }),
  });
  registry.register({
    appId: "mes",
    id: "mes.plan.create_draft",
    permission: "mes.plan.write",
    title: "创建生产计划草稿",
    confirmation: true,
    input: planDraft,
    preview: (ctx, draft) => mes.planPreview(ctx, draft),
    execute: async (tx, ctx, draft) => ({
      state: "completed",
      result: json(
        await mes.savePlan(
          ctx,
          undefined,
          { requestKey: randomUUID(), draft },
          tx,
        ),
      ),
    }),
  });
  registry.registerReader("mes", (ctx, type, id) => {
    if (!["bom", "plan", "order"].includes(type))
      fail("NOT_FOUND", "MES不公开此类对象", 404);
    return mes.get(ctx, type, id);
  });
}
