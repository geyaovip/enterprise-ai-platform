import { spawn } from "node:child_process";
import { join } from "node:path";
import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { GEO_SAMPLE_SOURCE } from "./geo.metrics";
import type { GeoService } from "./geo.service";
import type { FrozenInput, FrozenModel, FrozenQuestion } from "./geo.rules";

type Analysis = Awaited<ReturnType<GeoService["analysis"]>>;
let running = 0;
const maxBytes = 16 * 1024 * 1024;
const errors: Record<string, string> = {
  NATIVE_SEARCH_UNAVAILABLE: "模型不支持所需联网能力",
  MODEL_DISABLED: "模型已停用",
  BUDGET_EXHAUSTED: "达到预估预算，停止后续调用",
  WORKER_LEASE_EXPIRED: "执行中断，结果待核实",
  PROVIDER_RATE_LIMITED: "模型服务限流",
  MANUALLY_RECONCILED: "已人工核对费用，未取得回答",
};
export async function renderGeoReportPdf(analysis: Analysis) {
  if (!analysis.report) throw new ConflictException("报告生成后可下载 PDF");
  if (running >= 2)
    throw new ServiceUnavailableException("PDF 生成繁忙，请稍后重试");
  const snapshot = analysis.snapshot as unknown as FrozenInput;
  const input = JSON.stringify({
    brand: snapshot.brandName,
    sampleSource: GEO_SAMPLE_SOURCE,
    legacy: !analysis.retestVersionCurrent,
    country: snapshot.country,
    language: snapshot.language,
    models: snapshot.models.map(({ name, code, revision }) => ({
      name,
      code,
      revision,
    })),
    createdAt: analysis.createdAt,
    status: analysis.status,
    estimated: analysis.estimatedCostMicros,
    actual: analysis.actualCostMicros,
    comparison: analysis.comparison,
    report: analysis.report,
    runs: analysis.runs.map((r) => ({
      question: (r.question as unknown as FrozenQuestion).text,
      model: (r.model as unknown as FrozenModel).name,
      status: r.status,
      cost: r.actualCostMicros,
      text: r.text,
      citations: r.citations ?? [],
      error: r.errorCode ? (errors[r.errorCode] ?? "调用未完成") : null,
    })),
  });
  if (Buffer.byteLength(input) > maxBytes)
    throw new ConflictException("报告内容过多，请缩小分析范围");
  running++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      const child = spawn(
        process.env.KNOWLEDGE_PYTHON_PATH ?? "python3",
        [join(__dirname, "geo-report-pdf.py")],
        { stdio: ["pipe", "pipe", "ignore"] },
      );
      const chunks: Buffer[] = [];
      let size = 0;
      const timer = setTimeout(() => child.kill("SIGKILL"), 25000);
      child.stdout.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) child.kill("SIGKILL");
        else chunks.push(chunk);
      });
      child.stdin.on("error", () => {});
      child.once("error", () => {
        clearTimeout(timer);
        reject(new ServiceUnavailableException("暂时无法生成 PDF，请稍后重试"));
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        const pdf = Buffer.concat(chunks);
        if (
          code !== 0 ||
          size > maxBytes ||
          !pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))
        )
          reject(
            new ServiceUnavailableException("暂时无法生成 PDF，请稍后重试"),
          );
        else resolve(pdf);
      });
      child.stdin.end(input);
    });
  } finally {
    running--;
  }
}
