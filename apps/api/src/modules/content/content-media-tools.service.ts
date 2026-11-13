import {
  BadRequestException, ConflictException, ForbiddenException, Injectable,
  NotFoundException, PayloadTooLargeException, ServiceUnavailableException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { ContentMediaJob, Prisma } from "../../generated/prisma/client";
import { AgentExecutionService } from "../ai/agent.runtime";
import { nativeModelsEnabled } from "../ai/native-ai-policy";
import { ModelGateway } from "../ai/model.gateway";
import { ManagedRuntimeService } from "../ai/managed-runtime.service";
import { AuthService } from "../platform/auth.service";
import type { RequestContext } from "../platform/context";
import { readBody } from "../platform/security";
import { PrismaService } from "../prisma.service";
import { ContentService } from "./content.service";
import { getFile, putFile, removeFile } from "./content-storage";
import {
  cueList, inspectMedia, localMediaReady, makeSrt, mediaLimit, outputLimit, parseSrt, renderVideo,
} from "./content-media-formats";
import {
  downloadMedia, mediaKey, mediaPoll, mediaSubmit, mediaUpload, MediaProviderError, synthesizeVoice, voiceKey,
} from "./content-media-providers";

const fields = { requestKey: z.uuid() };
const slot = z.enum(["video", "audio", "face"]);
const text = z.string().trim().min(1).max(800);
const srt = z.string().trim().min(1).max(180000);
const languages = { en: "英语", zh: "简体中文", ja: "日语", ko: "韩语", es: "西班牙语" };
const jobInput = z.discriminatedUnion("kind", [
  z.object({ ...fields, kind: z.literal("face-swap"), videoId: z.uuid(), faceId: z.uuid(), consent: z.literal(true) }),
  z.object({ ...fields, kind: z.literal("auto-subtitles"), sourceId: z.uuid(), sourceType: z.enum(["audio", "video"]) }),
  z.object({ ...fields, kind: z.literal("burn-subtitles"), videoId: z.uuid(), srt }),
  z.object({ ...fields, kind: z.literal("lip-sync"), videoId: z.uuid(), audioId: z.uuid(), consent: z.literal(true) }),
  z.object({ ...fields, kind: z.literal("voice-over"), text }),
  z.object({ ...fields, kind: z.literal("presenter-video"), videoId: z.uuid(), text, consent: z.literal(true) }),
  z.object({ ...fields, kind: z.literal("translate-subtitles"), srt, language: z.enum(["en", "zh", "ja", "ko", "es"]) }),
]);
type JobInput = z.infer<typeof jobInput>;
type Kind = JobInput["kind"];
type Slot = z.infer<typeof slot>;
type Step = "voice" | "face" | "lips" | "asr" | "burn" | "label" | "translate";
type Progress = {
  binding: string;
  step: number;
  started?: boolean;
  taskId?: string;
  fileId?: string;
  uploads?: Partial<Record<Slot, string>>;
  audioId?: string;
  videoId?: string;
  subtitlesId?: string;
  artifacts?: Artifact[];
  retries?: number;
  mediaSubmitAt?: number;
};
type Artifact = { id: string; mime: string; filename: string };
const stages: Record<Kind, Step[]> = {
  "face-swap": ["face", "label"], "auto-subtitles": ["asr"], "burn-subtitles": ["burn"],
  "lip-sync": ["lips", "label"], "voice-over": ["voice"], "presenter-video": ["voice", "lips", "asr", "burn"],
  "translate-subtitles": ["translate"],
};
const active = ["queued", "running"];
const delayed = (seconds: number) => new Date(Date.now() + seconds * 1000);
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const mediaStep = (step: Step) => step === "face" || step === "lips" || step === "asr";
const needsLocal = (kind: Kind) => kind !== "translate-subtitles";
const asyncTask = z.object({ video_url: z.string(), duration: z.number().positive().optional() });
const asrTask = z.object({ duration: z.number().positive().optional(), subtitles: cueList });
const sourceMime: Record<Slot, string[]> = {
  video: ["video/mp4"], audio: ["audio/mpeg", "audio/wav"], face: ["image/png", "image/jpeg"],
};

@Injectable()
export class ContentMediaToolsService {
  private ready?: { until: number; result: Promise<boolean> };

  constructor(
    readonly db: PrismaService, readonly auth: AuthService, readonly content: ContentService,
    readonly runtime: AgentExecutionService, readonly models: ModelGateway, readonly managed: ManagedRuntimeService,
  ) {}

  private async allowed(c: RequestContext, kind?: Kind) {
    const current = await this.content.guard(c, "content.create");
    if (kind === "burn-subtitles") return current;
    this.auth.require(current, "content.ai.use");
    return current;
  }

  private localReady() {
    if (!this.ready || this.ready.until < Date.now()) this.ready = { until: Date.now() + 60000, result: localMediaReady() };
    return this.ready.result;
  }

  private async translationReady(c: RequestContext) {
    if (!nativeModelsEnabled()) return false;
    const directModel = (await this.models.status(c)).configured;
    if (process.env.NODE_ENV === "test" && process.env.AGENT_RUNTIME_PROVIDER === "test-model") return directModel;
    if (await this.db.infrastructureBinding.count({ where: {
      tenantId: c.tenantId, scopeKey: c.membershipId, kind: "runtime", enabled: true,
    } })) return true;
    return this.managed.enabled && (await this.managed.status(c).catch(() => ({ available: false }))).available;
  }

  private binding(kind: Kind) {
    return hash(JSON.stringify([
      stages[kind].some(mediaStep) ? mediaKey() : null,
      stages[kind].includes("voice") ? voiceKey() : null,
    ]));
  }

  async availability(c: RequestContext, rawKind: string) {
    const current = await this.content.guard(c);
    if (!Object.hasOwn(stages, rawKind)) throw new NotFoundException("工具不存在");
    return { blocker: await this.blocker(current, rawKind as Kind) };
  }

  private async blocker(c: RequestContext, kind: Kind) {
    const steps = stages[kind];
    if (!c.permissions.includes("content.create") || (kind !== "burn-subtitles" && !c.permissions.includes("content.ai.use")))
      return "当前账号没有该工具的使用权限";
    if (needsLocal(kind) && !await this.localReady()) return "媒体处理组件暂未就绪";
    if (steps.some(mediaStep) && !mediaKey()) return "当前环境尚未配置火山引擎 AI MediaKit";
    if (steps.includes("voice") && !voiceKey()) return "当前环境尚未配置豆包语音合成";
    if (kind === "translate-subtitles" && !await this.translationReady(c)) return "当前企业的文本模型暂不可用";
    return null;
  }

  async upload(c: RequestContext, rawSlot: string, req: AsyncIterable<Buffer>, size: number | undefined) {
    await this.content.guard(c, "content.create");
    const kind = readBody(slot, rawSlot);
    if (!await this.localReady()) throw new ServiceUnavailableException("媒体处理组件暂未就绪");
    const limit = kind === "video" ? mediaLimit : 8 * 1024 * 1024;
    if (size !== undefined && (!Number.isSafeInteger(size) || size < 1)) throw new BadRequestException("文件大小无效");
    if (size !== undefined && size > limit) throw new PayloadTooLargeException("文件超过大小限制");
    const parts: Buffer[] = [];
    let received = 0;
    for await (const chunk of req) {
      received += chunk.length;
      if (received > limit) throw new PayloadTooLargeException("文件超过大小限制");
      parts.push(chunk);
    }
    if (!received || (size !== undefined && received !== size)) throw new BadRequestException("文件上传不完整");
    const bytes = Buffer.concat(parts, received);
    const { mime, duration } = await inspectMedia(bytes, kind, false);
    const id = randomUUID();
    const filename = "工具素材." + ({ "video/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav", "image/png": "png", "image/jpeg": "jpg" })[mime];
    try {
      await this.saveAsset(c, { id, mime, filename }, bytes);
    } catch (error) {
      await removeFile(c.tenantId, id);
      throw error;
    }
    return { id, duration };
  }

  private async saveAsset(c: RequestContext, artifact: Artifact, bytes: Buffer) {
    await putFile(c.tenantId, artifact.id, bytes);
    await this.db.contentAsset.upsert({
      where: { id: artifact.id },
      create: { ...artifact, tenantId: c.tenantId, ownerId: c.membershipId, bytes: bytes.length, sha256: hash(bytes), width: 0, height: 0 },
      update: {},
    });
  }

  private async source(c: RequestContext, id: string, kind: Slot) {
    const asset = await this.content.asset(c, id);
    const limit = kind === "video" ? outputLimit : 8 * 1024 * 1024;
    if (!sourceMime[kind].includes(asset.mime) || asset.bytes > limit) throw new BadRequestException("素材类型或大小不符合要求");
    const bytes = await getFile(c.tenantId, id);
    await this.content.asset(c, id);
    return { asset, bytes };
  }

  private async validate(c: RequestContext, input: JobInput) {
    if ("videoId" in input) {
      const { bytes } = await this.source(c, input.videoId, "video");
      const video = await inspectMedia(bytes, "video", false);
      if (input.kind === "burn-subtitles" && parseSrt(input.srt).some((cue) => cue.end_time > video.duration + 0.1))
        throw new BadRequestException("SRT 字幕的结束时间超出了视频时长");
      if (input.kind === "lip-sync") {
        const audio = await this.source(c, input.audioId, "audio");
        const sound = await inspectMedia(audio.bytes, "audio", true);
        if (sound.duration > video.duration + 0.1) throw new BadRequestException("音频比视频长，请换用更长的视频，避免配音被截断");
      }
    }
    if (input.kind === "face-swap") {
      const { bytes } = await this.source(c, input.faceId, "face");
      await inspectMedia(bytes, "face", false);
    }
    if (input.kind === "auto-subtitles") {
      const { bytes } = await this.source(c, input.sourceId, input.sourceType);
      await inspectMedia(bytes, input.sourceType, true);
    }
    if (input.kind === "translate-subtitles") {
      const cues = parseSrt(input.srt);
      if (cues.length > 60 || cues.reduce((sum, cue) => sum + cue.subtitle_text.length, 0) > 1800)
        throw new BadRequestException("每次可翻译 60 条字幕、合计 1800 字，建议拆成多份 SRT");
    }
  }

  async submit(c: RequestContext, raw: unknown) {
    const input = readBody(jobInput, raw);
    const current = await this.allowed(c, input.kind);
    const scope = { tenantId: c.tenantId, membershipId: c.membershipId, requestKey: input.requestKey };
    const fingerprint = hash(JSON.stringify(input));
    const prior = await this.db.contentMediaJob.findUnique({ where: { tenantId_membershipId_requestKey: scope } });
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new ConflictException("提交内容已变更，请重新发起任务");
      return this.view(prior);
    }
    const blocker = await this.blocker(current, input.kind);
    if (blocker) throw new ServiceUnavailableException(blocker);
    await this.validate(current, input);
    const row = await this.db.$transaction(async (tx) => {
      // Serialize only admissions for this member. The upload and the upstream processing are outside the lock.
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${c.tenantId}), hashtext(${c.membershipId}))`;
      const existing = await tx.contentMediaJob.findUnique({ where: { tenantId_membershipId_requestKey: scope } });
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new ConflictException("提交内容已变更，请重新发起任务");
        return existing;
      }
      if (await tx.contentMediaJob.count({ where: { tenantId: c.tenantId, membershipId: c.membershipId, status: { in: active } } }) >= 3)
        throw new ConflictException("已有 3 个处理中的媒体任务，请等待其中一个完成");
      const job = await tx.contentMediaJob.create({ data: {
        ...scope, id: randomUUID(), userId: c.userId, kind: input.kind, fingerprint, input: json(input),
        checkpoint: json({ binding: this.binding(input.kind), step: 0 }),
      } });
      await this.content.audit(tx, current, "media_tool.submit", job.id, {
        kind: input.kind, consent: "consent" in input ? input.consent : undefined,
      });
      return job;
    });
    return this.view(row);
  }

  private view(job: ContentMediaJob) {
    const progress = job.checkpoint as Progress;
    return {
      id: job.id, kind: job.kind, status: job.status, error: job.error, createdAt: job.createdAt,
      step: stages[job.kind as Kind]?.[progress.step] ?? null,
      artifacts: progress.artifacts ?? [],
    };
  }

  async list(c: RequestContext, kind: string) {
    await this.content.guard(c);
    if (!Object.hasOwn(stages, kind)) throw new NotFoundException("工具不存在");
    const rows = await this.db.contentMediaJob.findMany({
      where: { tenantId: c.tenantId, membershipId: c.membershipId, kind },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20,
    });
    return { jobs: rows.map((row) => this.view(row)) };
  }

  async tick() {
    const now = new Date();
    const job = await this.db.contentMediaJob.findFirst({
      where: { status: { in: active }, nextRunAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
      orderBy: [{ nextRunAt: "asc" }, { id: "asc" }],
    });
    if (!job) return 0;
    const leaseUntil = delayed(450);
    const claimed = await this.db.contentMediaJob.updateMany({
      where: { id: job.id, status: job.status, leaseUntil: job.leaseUntil, updatedAt: job.updatedAt },
      data: { leaseUntil, status: "running" },
    });
    if (!claimed.count) return 0;
    const progress = job.checkpoint as Progress;
    const input = jobInput.parse(job.input);
    const step = stages[input.kind][progress.step];
    try {
      const current = await this.auth.taskContext({
        tenantId: job.tenantId, membershipId: job.membershipId, userId: job.userId, appId: "content", taskId: job.id,
      });
      await this.allowed(current, input.kind);
      if ("videoId" in input) await this.content.asset(current, input.videoId);
      if (input.kind === "face-swap") await this.content.asset(current, input.faceId);
      if (input.kind === "lip-sync") await this.content.asset(current, input.audioId);
      if (input.kind === "auto-subtitles") await this.content.asset(current, input.sourceId);
      if (progress.binding !== this.binding(input.kind)) throw new MediaProviderError("服务配置已变更，请核对原任务后重新提交");
      if (job.createdAt.getTime() < Date.now() - 12 * 60 * 60 * 1000)
        throw new MediaProviderError("处理超过等待时间，请核对原任务后重新提交");
      const complete = await this.runStep(current, job, input, progress, step, leaseUntil);
      if (complete) {
        progress.step++;
        delete progress.taskId;
        delete progress.fileId;
        delete progress.started;
        delete progress.retries;
        delete progress.uploads;
        delete progress.mediaSubmitAt;
      }
      const status = progress.step === stages[input.kind].length ? "succeeded" : "running";
      const committed = await this.db.contentMediaJob.updateMany({
        where: { id: job.id, leaseUntil }, data: {
          status, checkpoint: json(progress), nextRunAt: delayed(complete ? 0 : 5), leaseUntil: null, error: null,
        },
      });
      if (committed.count && status === "succeeded" && progress.videoId) await removeFile(job.tenantId, progress.videoId);
    } catch (error) {
      const upstream = error instanceof MediaProviderError;
      const unconfirmed = (progress.started && (step === "voice" || step === "translate")
        || (mediaStep(step) && progress.mediaSubmitAt && !progress.taskId && (progress.retries ?? 0) >= 8))
        && (!upstream || error.retryable);
      const retry = upstream && error.retryable && !unconfirmed && (progress.retries ?? 0) < 8;
      progress.retries = (progress.retries ?? 0) + 1;
      if (unconfirmed && step === "voice") await this.record(job, step, undefined);
      if (!retry && mediaStep(step) && (progress.taskId || progress.mediaSubmitAt) && (!upstream || error.retryable || progress.taskId))
        await this.record(job, step, undefined, progress.taskId);
      const message = unconfirmed ? "调用结果或费用待核对，系统未自动重复请求"
        : upstream || error instanceof BadRequestException ? error.message
        : error instanceof ForbiddenException || error instanceof NotFoundException ? "素材或操作权限已变更"
        : "媒体处理或结果保存失败";
      const committed = await this.db.contentMediaJob.updateMany({
        where: { id: job.id, leaseUntil }, data: {
          status: retry ? "running" : unconfirmed ? "needs_reconciliation" : "failed",
          checkpoint: json(progress), error: message, nextRunAt: delayed(Math.min(60, 5 * progress.retries)), leaseUntil: null,
        },
      });
      if (committed.count && !retry && progress.videoId) await removeFile(job.tenantId, progress.videoId);
    }
    return 1;
  }

  private async record(job: ContentMediaJob, step: Step, quantity: number | undefined, taskId?: string) {
    const metric = "content.media." + step;
    const requestKey = job.id + ":" + step;
    const data = {
      tenantId: job.tenantId, membershipId: job.membershipId, appId: "content", metric, requestKey,
      quantity: quantity !== undefined && Number.isFinite(quantity) && quantity >= 0 ? quantity : 0,
      status: quantity === undefined ? "usage_unknown_cost_pending" : "usage_reported_cost_pending",
      detail: json({ jobId: job.id, tool: job.kind, taskId, unit: step === "voice" ? "characters" : "seconds" }),
    };
    await this.db.usageRecord.createMany({ data: [data], skipDuplicates: true });
    if (quantity !== undefined) await this.db.usageRecord.updateMany({
      where: { tenantId: job.tenantId, metric, requestKey, status: "usage_unknown_cost_pending" },
      data: { status: data.status, quantity: data.quantity },
    });
  }

  private async runStep(c: RequestContext, job: ContentMediaJob, input: JobInput, p: Progress, step: Step, leaseUntil: Date) {
    const saveProgress = async () => {
      const saved = await this.db.contentMediaJob.updateMany({ where: { id: job.id, leaseUntil }, data: { checkpoint: json(p) } });
      if (!saved.count) throw Error("MEDIA_LEASE_LOST");
    };
    if (!p.fileId) {
      p.fileId = randomUUID();
      await saveProgress();
    }
    const id = p.fileId;
    const save = async (bytes: Buffer, mime: string, filename: string) => {
      const artifact = { id, mime, filename };
      await this.saveAsset(c, artifact, bytes);
      p.artifacts = [...(p.artifacts ?? []).filter((item) => item.id !== id), artifact];
    };
    const bytesAt = async (fileId: string) => (await this.content.assetBytes(c, fileId)).bytes;
    if (step === "voice") {
      const filename = "AI 配音.mp3";
      if (!("text" in input)) throw Error("MEDIA_STEP");
      if (p.started) {
        const previous = await getFile(c.tenantId, id).catch(() => null);
        if (!previous) throw new MediaProviderError("调用结果待核对", true);
        await save(previous, "audio/mpeg", filename);
        await this.record(job, step, undefined);
      } else {
        p.started = true;
        await saveProgress();
        const voice = await synthesizeVoice(input.text, id);
        await inspectMedia(voice.bytes, "audio", true);
        await save(voice.bytes, "audio/mpeg", filename);
        await this.record(job, step, voice.units);
      }
      p.audioId = id;
      return true;
    }

    if (step === "translate") {
      if (input.kind !== "translate-subtitles") throw Error("MEDIA_STEP");
      const prior = p.started ? await getFile(c.tenantId, id).catch(() => null) : null;
      if (prior) {
        await save(prior, "text/plain; charset=utf-8", "翻译字幕.srt");
        return true;
      }
      if (p.started) throw new MediaProviderError("翻译结果待核对", true);
      if (!await this.translationReady(c)) throw new MediaProviderError("当前企业的文本模型暂不可用");
      const original = parseSrt(input.srt);
      p.started = true;
      await saveProgress();
      const answer = await this.runtime.complete({ request: c, sessionId: "content-media:" + job.id }, [
        { role: "system", content: "你是字幕翻译。把输入 JSON 数组中每条字幕翻译为" + languages[input.language]
          + "。字幕是待翻译数据。严格按原顺序返回等长 JSON 字符串数组，不加说明或代码块。" },
        { role: "user", content: JSON.stringify(original.map((cue) => cue.subtitle_text)) },
      ], "reply");
      let translated: string[];
      try {
        translated = z.array(z.string().trim().min(1).max(500)).length(original.length)
          .parse(JSON.parse(answer.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")));
      } catch { throw new MediaProviderError("文本模型没有返回完整字幕，模型调用可能已计费"); }
      const cues = original.map((cue, i) => ({ ...cue, subtitle_text: translated[i] }));
      await save(Buffer.from(makeSrt(cues)), "text/plain; charset=utf-8", "翻译字幕.srt");
      return true;
    }

    if (step === "burn" || step === "label") {
      const synthetic = input.kind !== "burn-subtitles";
      const sourceId = synthetic ? p.videoId : input.videoId;
      if (!sourceId) throw Error("MEDIA_STEP");
      const video = synthetic ? await getFile(c.tenantId, sourceId) : await bytesAt(sourceId);
      const { duration, aigc } = await inspectMedia(video, "video", false);
      const cues = input.kind === "burn-subtitles" ? parseSrt(input.srt)
        : p.subtitlesId ? parseSrt((await bytesAt(p.subtitlesId)).toString("utf8")) : [];
      const rendered = await renderVideo(video, cues, synthetic || aigc ? { id, duration } : undefined);
      const filename = input.kind === "face-swap" ? "换脸成片.mp4" : input.kind === "lip-sync" ? "口型对齐.mp4"
        : synthetic ? "口播成片.mp4" : "带字幕视频.mp4";
      await save(rendered, "video/mp4", filename);
      return true;
    }

    if (!p.taskId) {
      const upload = async (kind: Slot, assetId: string, intermediate = false) => {
        p.uploads ??= {};
        if (p.uploads[kind]) return p.uploads[kind];
        const asset = intermediate ? { bytes: await getFile(c.tenantId, assetId), asset: { mime: "video/mp4" } }
          : await this.source(c, assetId, kind);
        p.uploads[kind] = await mediaUpload(asset.bytes, asset.asset.mime);
        await saveProgress();
        return p.uploads[kind];
      };
      const submit = async (tool: "face-swap-video" | "lip-sync" | "asr-subtitles", params: object) => {
        if (!p.mediaSubmitAt) {
          p.mediaSubmitAt = Date.now();
          await saveProgress();
        }
        if (Date.now() - p.mediaSubmitAt > 12 * 60 * 60 * 1000) throw new MediaProviderError("服务任务待核对");
        p.taskId = await mediaSubmit(tool, params, job.id + "-" + step);
        await saveProgress();
      };
      if (step === "face" && input.kind === "face-swap") {
        await submit("face-swap-video", {
          video_url: await upload("video", input.videoId),
          face_mappings: [{ target_face_url: await upload("face", input.faceId) }],
        });
      } else if (step === "lips" && (input.kind === "lip-sync" || input.kind === "presenter-video")) {
        const audioId = input.kind === "lip-sync" ? input.audioId : p.audioId;
        if (!audioId) throw Error("MEDIA_STEP");
        await submit("lip-sync", {
          video_url: await upload("video", input.videoId), audio_url: await upload("audio", audioId),
          enable_video_loop: input.kind === "presenter-video",
        });
      } else if (step === "asr") {
        if (input.kind === "auto-subtitles") {
          await submit("asr-subtitles", {
            [input.sourceType + "_url"]: await upload(input.sourceType, input.sourceId),
          });
        } else if (input.kind === "presenter-video" && p.videoId) {
          await submit("asr-subtitles", { video_url: await upload("video", p.videoId, true) });
        } else throw Error("MEDIA_STEP");
      } else throw Error("MEDIA_STEP");
      return false;
    }

    const result = await mediaPoll(p.taskId);
    if (!result) return false;
    if (step === "asr") {
      const data = asrTask.safeParse(result);
      if (!data.success) throw new MediaProviderError("无法读取识别结果");
      await this.record(job, step, data.data.duration, p.taskId);
      if (!data.data.subtitles.length) throw new MediaProviderError("没有识别到可用的语音字幕");
      await save(Buffer.from(makeSrt(data.data.subtitles)), "text/plain; charset=utf-8", "自动字幕.srt");
      p.subtitlesId = id;
    } else {
      const data = asyncTask.safeParse(result);
      if (!data.success) throw new MediaProviderError("无法读取生成的视频");
      const sourceVideoId = "videoId" in input ? input.videoId : undefined;
      const faceDuration = step === "face" && sourceVideoId
        ? (await inspectMedia(await bytesAt(sourceVideoId), "video", false)).duration : undefined;
      await this.record(job, step, step === "face" ? faceDuration : data.data.duration, p.taskId);
      const video = await downloadMedia(data.data.video_url);
      await inspectMedia(video, "video", step === "lips");
      await putFile(c.tenantId, id, video);
      p.videoId = id;
    }
    return true;
  }
}
