import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { GeoService } from "./geo.service";
import { GeoProvider } from "./geo.provider";
import { ModelGatewayError } from "./reused/contracts";
import { nextMonitoringAt } from "./reused/schedule";
import {
  json,
  runCost,
  type FrozenInput,
  type FrozenQuestion,
  type FrozenModel,
} from "./geo.rules";
import { parseGeoAnswer, reportFor, citationUrl } from "./geo.metrics";
@Injectable()
export class GeoWorker {
  constructor(
    readonly geo: GeoService,
    readonly provider: GeoProvider,
  ) {}
  async tick() {
    const db = this.geo.db,
      now = new Date();
    const candidate = await db.geoAnalysis.findFirst({
      where: {
        OR: [
          {
            status: "queued",
            OR: [
              {
                runs: {
                  some: {
                    status: "queued",
                    OR: [{ retryAt: null }, { retryAt: { lte: now } }],
                  },
                },
              },
              { runs: { none: { status: "queued" } } },
            ],
          },
          { status: "running", leaseUntil: { lt: now } },
        ],
      },
      orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
    });
    if (!candidate) return;
    const leaseToken = randomUUID();
    const claim = await db.geoAnalysis.updateMany({
      where: {
        id: candidate.id,
        version: candidate.version,
        OR: [
          { status: "queued" },
          { status: "running", leaseUntil: { lt: now } },
        ],
      },
      data: {
        status: "running",
        leaseToken,
        leaseUntil: new Date(Date.now() + 180000),
        version: { increment: 1 },
      },
    });
    if (!claim.count) return;
    const job = await db.geoAnalysis.findUniqueOrThrow({
      where: { id: candidate.id },
    });
    const snapshot = job.snapshot as unknown as FrozenInput;
    // A prior lease may have died after a paid POST. Never blindly resend that run.
    await db.geoRun.updateMany({
      where: { analysisId: job.id, status: "running" },
      data: {
        status: "outcome_unknown",
        errorCode: "WORKER_LEASE_EXPIRED",
        finishedAt: now,
      },
    });
    await db.aiModelUsage.updateMany({
      where: { batchId: job.id, source: "geo-analysis", status: "started" },
      data: {
        status: "outcome_unknown",
        usageStatus: "unknown",
        errorCode: "WORKER_LEASE_EXPIRED",
        finishedAt: now,
      },
    });
    let ctx;
    try {
      ctx = await this.geo.fresh(job);
      const p = await this.geo.project(ctx, job.projectId);
      if (!p.active) throw Error("PROJECT_ARCHIVED");
      if (job.cancelRequested) throw Error("CANCEL_REQUESTED");
    } catch {
      await db.geoRun.updateMany({
        where: { analysisId: job.id, status: "queued" },
        data: {
          status: "cancelled",
          actualCostMicros: 0,
          errorCode: "ACCESS_OR_CANCELLATION",
          finishedAt: now,
        },
      });
      await this.finish(job, leaseToken, "cancelled");
      return;
    }
    const run = await db.geoRun.findFirst({
      where: {
        analysisId: job.id,
        status: "queued",
        OR: [{ retryAt: null }, { retryAt: { lte: now } }],
      },
      orderBy: { id: "asc" },
    });
    if (!run) {
      const waiting = await db.geoRun.count({
        where: { analysisId: job.id, status: "queued" },
      });
      if (waiting) {
        await this.release(job.id, leaseToken);
        return;
      }
      await this.finish(job, leaseToken);
      return;
    }
    const version = await db.geoModelVersion.findFirst({
      where: {
        id: run.modelVersionId,
        tenantId: job.tenantId,
        model: { enabled: true },
      },
    });
    if (!version) {
      await db.geoRun.update({
        where: { id: run.id },
        data: {
          status: "skipped",
          actualCostMicros: 0,
          errorCode: "MODEL_DISABLED",
          finishedAt: now,
        },
      });
      await this.release(job.id, leaseToken);
      return;
    }
    const costs = await db.geoRun.findMany({
      where: { analysisId: job.id },
      select: {
        actualCostMicros: true,
        estimatedCostMicros: true,
        status: true,
      },
    });
    const spent = costs.reduce(
      (n, r) =>
        n +
        (r.actualCostMicros ??
          (r.status === "outcome_unknown" ? r.estimatedCostMicros : 0)),
      0,
    );
    if (spent + run.estimatedCostMicros > job.estimatedCostMicros) {
      await db.geoRun.updateMany({
        where: { analysisId: job.id, status: "queued" },
        data: {
          status: "skipped",
          actualCostMicros: 0,
          errorCode: "BUDGET_EXHAUSTED",
          finishedAt: now,
        },
      });
      await this.finish(job, leaseToken);
      return;
    }
    // Recheck immediately before the network boundary, then durably mark submission.
    try {
      ctx = await this.geo.fresh(job);
    } catch {
      await this.release(job.id, leaseToken);
      return;
    }
    const attempt = run.attempts + 1,
      usageId = "geo:" + run.id + ":" + attempt,
      startedAt = new Date();
    await db.$transaction(async (tx) => {
      await tx.geoRun.update({
        where: { id: run.id },
        data: {
          status: "running",
          attempts: attempt,
          startedAt,
          retryAt: null,
        },
      });
      await tx.aiModelUsage.create({
        data: {
          id: usageId,
          tenantId: job.tenantId,
          membershipId: job.createdByMembershipId,
          appId: "geo",
          requestId: run.id,
          source: "geo-analysis",
          environment: process.env.NODE_ENV ?? "development",
          batchId: job.id,
          status: "started",
          usageStatus: "pending",
          requestedModel: (run.model as any).code,
          model: (run.model as any).code,
          purpose: "geo.analysis",
        },
      });
    });
    try {
      const result = await this.provider.invoke(
        run.model as unknown as FrozenModel,
        run.question as unknown as FrozenQuestion,
        snapshot,
        version.secretCiphertext,
        run.id,
      );
      let stillAuthorized = true;
      try {
        await this.geo.fresh(job);
      } catch {
        stillAuthorized = false;
      }
      const parsed = parseGeoAnswer(
        result.text,
        snapshot,
        ["length", "max_tokens", "max_output_tokens"].includes(
          result.finishReason ?? "",
        ),
      );
      const actualCostMicros = runCost(
        result.inputTokens,
        result.outputTokens,
        run.model as unknown as FrozenModel,
        (run.question as any).nativeWebSearch ? (result.searchCalls ?? 0) : 0,
      );
      const citations = result.citations.flatMap((c) => {
        const url = citationUrl(c.url);
        return url ? [{ url, ...(c.title ? { title: c.title } : {}) }] : [];
      });
      await db.$transaction(async (tx) => {
        await tx.aiModelUsage.update({
          where: { id: usageId },
          data: {
            status: "succeeded",
            usageStatus: "recorded",
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            totalTokens: result.inputTokens + result.outputTokens,
            externalId: result.providerRequestId,
            finishedAt: new Date(),
          },
        });
        await tx.geoRun.updateMany({
          where: { id: run.id, status: "running", analysis: { leaseToken } },
          data: {
            status: "succeeded",
            text: result.text,
            citations: json(citations),
            parsed: json(parsed),
            validSample: parsed.validSample,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            actualCostMicros,
            durationMs: Date.now() - startedAt.getTime(),
            externalId: result.providerRequestId,
            finishedAt: new Date(),
            errorCode: stillAuthorized
              ? null
              : "ACCESS_REVOKED_AFTER_SUBMISSION",
          },
        });
        if (!stillAuthorized)
          await tx.geoRun.updateMany({
            where: { analysisId: job.id, status: "queued" },
            data: {
              status: "cancelled",
              errorCode: "ACCESS_REVOKED",
              finishedAt: new Date(),
            },
          });
      });
      if (!stillAuthorized) {
        await this.finish(job, leaseToken, "cancelled");
        return;
      }
    } catch (error) {
      const e = error instanceof ModelGatewayError ? error : null;
      const definite =
        (!!e &&
          ["authentication", "policy_rejection", "rate_limit"].includes(
            e.category,
          )) ||
        (!!e &&
          [
            "PROVIDER_MODEL_UNAVAILABLE",
            "PROVIDER_CAPABILITY_UNAVAILABLE",
            "PROVIDER_REQUEST_FAILED",
          ].includes(e.code));
      const retry = e?.category === "rate_limit" && attempt < 3;
      const status = retry ? "queued" : definite ? "failed" : "outcome_unknown";
      const code = e?.code ?? "PROVIDER_RESULT_UNKNOWN";
      await db.$transaction(async (tx) => {
        await tx.aiModelUsage.update({
          where: { id: usageId },
          data: {
            status: retry ? "rejected" : status,
            usageStatus: definite ? "not_billed" : "unknown",
            errorCode: code,
            finishedAt: new Date(),
          },
        });
        await tx.geoRun.updateMany({
          where: { id: run.id, status: "running", analysis: { leaseToken } },
          data: {
            status,
            errorCode: code,
            retryAt: retry ? new Date(Date.now() + 60000) : null,
            actualCostMicros: definite ? 0 : null,
            durationMs: Date.now() - startedAt.getTime(),
            finishedAt: retry ? null : new Date(),
          },
        });
      });
    }
    if (
      await db.geoRun.count({ where: { analysisId: job.id, status: "queued" } })
    )
      await this.release(job.id, leaseToken);
    else await this.finish(job, leaseToken);
  }
  private async release(id: string, leaseToken: string) {
    await this.geo.db.geoAnalysis.updateMany({
      where: { id, leaseToken },
      data: {
        status: "queued",
        leaseToken: null,
        leaseUntil: null,
        version: { increment: 1 },
      },
    });
  }
  private async finish(job: any, leaseToken: string, override?: string) {
    const db = this.geo.db;
    const runs = await db.geoRun.findMany({ where: { analysisId: job.id } });
    const snapshot = job.snapshot as FrozenInput;
    const report = reportFor(snapshot, runs);
    const unknown = runs.some((r) => r.status === "outcome_unknown"),
      succeeded = runs.filter((r) => r.status === "succeeded").length;
    const latest = await db.geoAnalysis.findUniqueOrThrow({
      where: { id: job.id },
    });
    const status = unknown
      ? "needs_review"
      : (override ??
        (latest.cancelRequested
          ? "cancelled"
          : succeeded === runs.length
            ? "completed"
            : succeeded
              ? "partially_completed"
              : "failed"));
    const actualCostMicros = unknown
      ? null
      : runs.reduce((n, r) => n + (r.actualCostMicros ?? 0), 0);
    await db.$transaction(async (tx) => {
      const change = await tx.geoAnalysis.updateMany({
        where: { id: job.id, leaseToken },
        data: {
          status,
          report: json(report),
          actualCostMicros,
          finishedAt: new Date(),
          leaseUntil: null,
          leaseToken: null,
          version: { increment: 1 },
        },
      });
      if (!change.count) return;
      await this.geo.notify(
        tx,
        job,
        status === "needs_review"
          ? "GEO 分析结果待核实"
          : status === "cancelled"
            ? "GEO 分析已停止"
            : "GEO 分析已结束",
        unknown
          ? "存在无法确认的调用，未自动重发；请核对供应商用量。"
          : `有效回答 ${report.validSamples}/${report.plannedSamples}`,
        `geo-analysis:${job.id}`,
      );
      await tx.auditEvent.create({
        data: {
          tenantId: job.tenantId,
          userId: job.userId,
          membershipId: job.createdByMembershipId,
          appId: "geo",
          requestId: job.id,
          action: "geo.analysis.finish",
          resourceType: "GeoAnalysis",
          resourceId: job.id,
        },
      });
    });
  }
  async schedules() {
    const db = this.geo.db,
      now = new Date();
    const due = await db.geoSchedule.findMany({
      where: { active: true, nextRunAt: { lte: now } },
      take: 10,
      orderBy: { nextRunAt: "asc" },
    });
    for (const s of due) {
      await db.$transaction(async (tx) => {
        const changed = await tx.geoSchedule.updateMany({
          where: { id: s.id, version: s.version, active: true },
          data: {
            nextRunAt: nextMonitoringAt(s as any, now),
            version: { increment: 1 },
          },
        });
        if (!changed.count) return;
        await tx.geoScheduleExecution.create({
          data: {
            tenantId: s.tenantId,
            scheduleId: s.id,
            dueAt: s.nextRunAt,
            snapshot: json(s),
          },
        });
      });
    }
    const pending = await db.geoScheduleExecution.findMany({
      where: {
        status: { in: ["pending", "running"] },
        AND: [
          { OR: [{ retryAt: null }, { retryAt: { lte: now } }] },
          { OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
        ],
      },
      orderBy: { dueAt: "asc" },
      take: 10,
    });
    for (const e of pending) {
      const claim = await db.geoScheduleExecution.updateMany({
        where: {
          id: e.id,
          status: e.status,
          attempts: e.attempts,
          OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
        },
        data: {
          status: "running",
          leaseUntil: new Date(Date.now() + 120000),
          attempts: { increment: 1 },
        },
      });
      if (!claim.count) continue;
      const s = e.snapshot as any;
      let errorCode: string | null = null,
        status = "submitted",
        analysisId: string | undefined;
      try {
        const ctx = await this.geo.fresh(s, "geo.monitor.manage");
        this.geo.require(ctx, "geo.analysis.run");
        const raw = {
          questionIds: s.questionIds,
          modelIds: s.modelIds,
          maxCostMicros: s.maxCostMicros,
        };
        const requestKey = `monitor:${e.id}`;
        const existing = await db.geoAnalysis.findUnique({
          where: { tenantId_requestKey: { tenantId: s.tenantId, requestKey } },
        });
        if (existing) analysisId = existing.id;
        else {
          const estimate = await this.geo.estimate(ctx, s.projectId, raw);
          analysisId = (
            await this.geo.submit(ctx, s.projectId, {
              ...raw,
              requestKey,
              estimateHash: estimate.estimateHash,
            })
          ).id;
        }
      } catch (err) {
        const http = (err as any)?.getStatus?.();
        errorCode =
          http === 403
            ? "ACCESS_REVOKED"
            : http === 400 || http === 409
              ? "MONITORING_ADMISSION_FAILED"
              : "MONITORING_EXECUTION_FAILED";
        status = [400, 403, 404, 409].includes(http)
          ? "skipped"
          : e.attempts + 1 >= 3
            ? "dead_letter"
            : "pending";
      }
      await db.$transaction(async (tx) => {
        const settled = await tx.geoScheduleExecution.updateMany({
          where: { id: e.id, status: "running", attempts: e.attempts + 1 },
          data: {
            status,
            errorCode,
            analysisId,
            leaseUntil: null,
            retryAt: status === "pending" ? new Date(Date.now() + 60000) : null,
          },
        });
        if (!settled.count) return;
        if (["skipped", "dead_letter"].includes(status)) {
          await this.geo.notify(
            tx,
            { ...s, id: e.id },
            "GEO 监测未执行",
            errorCode ?? "执行失败",
            `geo-monitor:${e.id}`,
            "geo-monitor",
          );
        }
      });
    }
  }
}
