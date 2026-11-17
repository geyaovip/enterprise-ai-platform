import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, errorText } from "../api";
import { DropdownSelect, Field } from "../components";
import { useContent } from "./content-ui";
import { ToolEmpty, ToolFilePicker, ToolPanelHeading } from "./ToolForm";
import { ArrowRightIcon, ClockCounterClockwiseIcon, CloudArrowUpIcon, DownloadSimpleIcon, FileTextIcon,
  FilmSlateIcon, FolderOpenIcon, InfoIcon, ShieldCheckIcon, UserCircleIcon, WaveformIcon } from "@phosphor-icons/react";

type Slot = "video" | "audio" | "face" | "source";
export type CloudMediaKind = "face-swap" | "auto-subtitles" | "burn-subtitles" | "lip-sync" | "voice-over"
  | "presenter-video" | "translate-subtitles";
type Artifact = { id: string; mime: string; filename: string };
type Job = {
  id: string; status: string; error: string | null; step: string | null; createdAt: string; artifacts: Artifact[];
};
type Handoff = { asset?: Artifact };
const toolFields: Record<CloudMediaKind, { files: Slot[]; script?: true; srt?: true; consent?: string; note?: string }> = {
  "face-swap": { files: ["video", "face"], consent: "我已获得视频及参考照片中人物的授权，并同意将素材提交至火山引擎进行人脸处理。" },
  "auto-subtitles": { files: ["source"], note: "素材会提交至火山引擎处理。" },
  "burn-subtitles": { files: ["video"], srt: true },
  "lip-sync": { files: ["video", "audio"], consent: "我已获得出镜人物和音频权利人的授权，并同意将素材提交至火山引擎进行口型合成。",
    note: "视频应至少与驱动音频等长。" },
  "voice-over": { files: [], script: true, note: "口播稿会提交至豆包语音，使用标准女声。" },
  "presenter-video": { files: ["video"], script: true, consent: "我已获得出镜人物的授权，并同意将视频和口播稿提交至火山引擎处理。",
    note: "配音长于原视频时，画面会往复播放以匹配完整口播。" },
  "translate-subtitles": { files: [], srt: true, note: "使用企业文本模型。每次最多 60 条字幕，合计 1800 字。" },
};
const fileFields = {
  video: { label: "视频", accept: ".mp4,video/mp4", hint: "MP4 · 最长 3 分钟 · 最大 32 MB", icon: FilmSlateIcon },
  audio: { label: "驱动音频", accept: ".mp3,.wav,audio/mpeg,audio/wav", hint: "MP3 / WAV · 最长 3 分钟 · 最大 8 MB", icon: WaveformIcon },
  face: { label: "参考人像", accept: ".jpg,.jpeg,.png,image/jpeg,image/png", hint: "JPG / PNG · 最大 8 MB", icon: UserCircleIcon },
  source: { label: "视频或音频", accept: ".mp4,.mp3,.wav,video/mp4,audio/mpeg,audio/wav", hint: "最长 3 分钟 · MP4 最大 32 MB · MP3 / WAV 最大 8 MB", icon: CloudArrowUpIcon },
} satisfies Record<Slot, { label: string; accept: string; hint: string; icon: typeof FilmSlateIcon }>;
const stepLabels: Record<string, string> = {
  voice: "合成配音", face: "视频换脸", lips: "对齐口型", asr: "识别字幕", burn: "压制字幕", label: "标记并保存成片", translate: "翻译字幕",
};
const statuses: Record<string, string> = {
  queued: "排队中", running: "处理中", succeeded: "已完成", failed: "处理失败", needs_reconciliation: "待核对",
};
const choices = [["en", "英语"], ["zh", "简体中文"], ["ja", "日语"], ["ko", "韩语"], ["es", "西班牙语"]];
const isActive = (job: Job) => job.status === "running" || job.status === "queued";
const isVideo = (file: File) => /\.mp4$/i.test(file.name) || file.type === "video/mp4";

export function CloudMediaTool({ kind }: { kind: CloudMediaKind }) {
  const { base, prefix } = useContent();
  const location = useLocation();
  const config = toolFields[kind];
  const [files, setFiles] = useState<Partial<Record<Slot, File>>>({});
  const [linked, setLinked] = useState<Artifact>();
  const [text, setText] = useState("");
  const [srt, setSrt] = useState("");
  const [language, setLanguage] = useState("en");
  const [consent, setConsent] = useState(false);
  const [blocker, setBlocker] = useState<string | null | undefined>(undefined);
  const [jobs, setJobs] = useState<Job[]>();
  const [srtFilename, setSrtFilename] = useState("");
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [loadingSrt, setLoadingSrt] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const attempt = useRef<{ key: string; body?: Record<string, unknown> } | undefined>(undefined);
  const root = base + "/media-tools";
  const assetUrl = (id: string) => "/api/v1" + base + "/assets/" + id + "/file";

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      const [availability, history] = await Promise.allSettled([
        api.get<{ blocker: string | null }>(root + "/availability/" + kind, { timeoutMs: 10000 }),
        api.get<{ jobs: Job[] }>(root + "/jobs/" + kind, { timeoutMs: 10000 }),
      ]);
      if (!mounted) return;
      if (availability.status === "fulfilled") setBlocker(availability.value.blocker);
      else setBlocker(errorText(availability.reason));
      if (history.status === "fulfilled") {
        setJobs(history.value.jobs);
        setLoadError("");
      } else setLoadError(errorText(history.reason));
      timer = setTimeout(load, history.status === "fulfilled" && history.value.jobs.some(isActive) ? 3500 : 12000);
    };
    void load();
    return () => { mounted = false; clearTimeout(timer); };
  }, [root, kind]);

  useEffect(() => {
    const artifact = (location.state as Handoff | null)?.asset;
    if (!artifact) return;
    if ((artifact.mime === "audio/mpeg" && kind === "lip-sync") || (artifact.mime === "video/mp4" && kind === "burn-subtitles")) {
      setLinked(artifact);
      attempt.current = undefined;
    }
    if (!artifact.filename.endsWith(".srt") || !config.srt) return;
    const controller = new AbortController();
    setLoadingSrt(true);
    fetch(assetUrl(artifact.id), { signal: controller.signal }).then((response) => {
      if (!response.ok) throw Error("无法读取历史字幕");
      return response.text();
    }).then((value) => { setSrt(value); setSrtFilename(artifact.filename); attempt.current = undefined; })
      .catch((e) => { if (!controller.signal.aborted) setError(errorText(e)); })
      .finally(() => { if (!controller.signal.aborted) setLoadingSrt(false); });
    return () => controller.abort();
  }, [location.key, kind, config.srt, base]);

  const linkedSlot = linked?.mime === "video/mp4" ? "video" : "audio";
  const ready = config.files.every((slot) => Boolean(files[slot] || linked && linkedSlot === slot))
    && (!config.script || text.trim()) && (!config.srt || srt.trim()) && (!config.consent || consent);

  function changeFile(slot: Slot, file: File | undefined) {
    setError("");
    attempt.current = undefined;
    if (file) {
      const accepted = fileFields[slot].accept.split(",").some((type) =>
        type.startsWith(".") ? file.name.toLowerCase().endsWith(type) : file.type === type);
      if (!accepted) {
        setError("请选择“" + fileFields[slot].label + "”支持的文件格式");
        return;
      }
      const limit = slot === "video" || slot === "source" && isVideo(file) ? 32 : 8;
      if (file.size < 1 || file.size > limit * 1024 * 1024) {
        setError(file.size < 1 ? "文件为空，请选择其他文件" : "请选择不超过 " + limit + " MB 的文件");
        return;
      }
    }
    if (linked && linkedSlot === slot) setLinked(undefined);
    setFiles((current) => ({ ...current, [slot]: file }));
  }

  async function upload(slot: Slot, file: File) {
    const mediaType = slot === "source" ? isVideo(file) ? "video" : "audio" : slot;
    const response = await fetch("/api/v1" + root + "/inputs/" + mediaType, {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/octet-stream" },
      body: file, signal: AbortSignal.timeout(120000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.id) throw Error(result?.error?.message ?? "素材上传失败，请检查网络或文件大小");
    return result.id as string;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || blocker !== null || loadingSrt || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    const submission = attempt.current ?? { key: crypto.randomUUID() };
    attempt.current = submission;
    try {
      if (!submission.body) {
        const fields: Record<string, unknown> = { kind, requestKey: submission.key };
        for (const slot of config.files) {
          const file = files[slot];
          fields[slot + "Id"] = file ? await upload(slot, file) : linked?.id;
        }
        if (kind === "auto-subtitles") fields.sourceType = isVideo(files.source!) ? "video" : "audio";
        if (config.script) fields.text = text;
        if (config.srt) fields.srt = srt;
        if (config.consent) fields.consent = consent;
        if (kind === "translate-subtitles") fields.language = language;
        submission.body = fields;
      }
      const job = await api.post<Job>(root + "/jobs", submission.body, { timeoutMs: 35000 });
      setJobs((old) => [job, ...(old ?? []).filter((item) => item.id !== job.id)]);
      setConsent(false);
      attempt.current = undefined;
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }

  const edit = () => { attempt.current = undefined; setError(""); };
  const useResult = (artifact: Artifact, target: CloudMediaKind, title: string) => (
    <Link to={prefix + "/tools/" + target} state={{ asset: artifact } satisfies Handoff}>{title}</Link>
  );

  const pendingReason = blocker === undefined ? "正在检查工具可用性…"
    : loadingSrt ? "正在读取字幕…"
    : config.files.some((slot) => !files[slot] && !(linked && linkedSlot === slot)) ? "请先添加所需素材"
    : config.script && !text.trim() ? "请填写口播稿"
    : config.srt && !srt.trim() ? "请添加 SRT 字幕"
    : config.consent && !consent ? "请确认素材授权" : "";
  const submitLabel = {
    "face-swap": "开始换脸", "auto-subtitles": "识别字幕", "burn-subtitles": "压制字幕",
    "lip-sync": "开始对齐", "voice-over": "生成配音", "presenter-video": "生成口播成片",
    "translate-subtitles": "翻译字幕",
  }[kind];

  return (
    <div className="content-media-layout">
      <form className="content-writing-form content-cloud-media-form" onSubmit={submit}>
        <ToolPanelHeading title="处理设置" icon={FolderOpenIcon} />
        <div className="tool-panel-body">
          <fieldset disabled={busy} aria-label="素材与参数">
            {config.files.length > 0 && <div className="tool-file-grid">
              {config.files.map((slot) => {
                const field = fileFields[slot];
                const historical = linked && linkedSlot === slot ? linked : undefined;
                const selected = files[slot]?.name ?? historical?.filename;
                return <ToolFilePicker key={slot} {...field}
                  label={slot === "video" && config.consent ? "单人出镜视频" : field.label}
                  selected={selected} linked={Boolean(historical)} onPick={(file) => changeFile(slot, file)}
                  onClear={() => changeFile(slot, undefined)} />;
              })}
            </div>}
            {config.script && <Field label="口播稿">
              <textarea rows={5} maxLength={800} value={text} placeholder="输入或粘贴需要朗读的内容"
                aria-label="口播稿" aria-describedby="tool-script-count" onChange={(event) => { setText(event.target.value); edit(); }} />
              <small id="tool-script-count" className="tool-field-count">{text.length} / 800 字</small>
            </Field>}
            {config.srt && <>
              <ToolFilePicker label="导入字幕（选填）" hint="SRT · 最大 512 KB" accept=".srt"
                icon={FileTextIcon} compact disabled={loadingSrt} selected={srtFilename}
                onPick={async (file) => {
                  if (file.size > 512 * 1024) { setError("SRT 文件最多 512 KB"); return; }
                  setLoadingSrt(true);
                  try {
                    const source = await file.text();
                    if (source.length > 180000) throw Error("SRT 字幕内容过长");
                    setSrt(source);
                    setSrtFilename(file.name);
                    edit();
                  } catch (e) { setError(errorText(e)); }
                  finally { setLoadingSrt(false); }
                }} />
              <Field label="SRT 字幕">
                <textarea rows={6} maxLength={180000} value={srt} disabled={loadingSrt}
                  placeholder={"1\n00:00:00,000 --> 00:00:02,000\n欢迎观看"}
                  onChange={(event) => { setSrt(event.target.value); setSrtFilename(""); edit(); }} />
              </Field>
            </>}
            {kind === "translate-subtitles" && <Field label="目标语言">
              <DropdownSelect value={language} onChange={(event) => { setLanguage(event.target.value); edit(); }}>
                {choices.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </DropdownSelect>
            </Field>}
            {config.consent && <div className="content-cloud-media-consent">
              <span><ShieldCheckIcon size={19} aria-hidden="true" />素材授权</span>
              <label>
                <input type="checkbox" checked={consent} onChange={(event) => {
                  setConsent(event.target.checked);
                  if (!attempt.current?.body) edit();
                }} />
                {config.consent}
              </label>
            </div>}
          </fieldset>
          {blocker && <p role="status" className="tool-message">{blocker}</p>}
          {error && <p role="alert" className="tool-message" data-error>{error}</p>}
        </div>
        <div className="tool-panel-footer">
          {config.note && <div className="tool-note"><InfoIcon size={17} aria-hidden="true" /><p>{config.note}</p></div>}
          <div className="tool-submit">
            {!busy && !blocker && pendingReason && <span>{pendingReason}</span>}
            <button type="submit" className="primary" disabled={blocker !== null || !ready || busy || loadingSrt}>
              {busy ? "正在提交…" : submitLabel}<ArrowRightIcon size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      </form>
      <section className="content-media-history" aria-label="处理记录">
        <ToolPanelHeading title="处理记录" icon={ClockCounterClockwiseIcon} />
        <div className="tool-history-body">
        {loadError && <p role="status" className="tool-message">{loadError}</p>}
        {!jobs && !loadError && <p role="status" className="tool-history-loading">正在读取处理记录…</p>}
        {jobs?.length === 0 && !loadError && <ToolEmpty icon={ClockCounterClockwiseIcon} title="暂无处理记录">提交后，可在这里查看进度和下载结果。</ToolEmpty>}
        {jobs?.map((job) => (
          <article key={job.id} className="content-media-job">
            <div className="content-media-job-heading">
              <strong className="tool-job-status" data-status={job.status}>{statuses[job.status] ?? job.status}</strong>
              <time dateTime={job.createdAt}>{new Date(job.createdAt).toLocaleString("zh-CN")}</time>
            </div>
            {isActive(job) && job.step && stepLabels[job.step] && <p className="content-tool-description">{stepLabels[job.step]}</p>}
            {job.error && <p className="content-tool-description">{job.error}</p>}
            {job.artifacts.map((artifact) => (
              <div key={artifact.id} className="content-media-result">
                {artifact.mime === "video/mp4" && <video controls playsInline preload="none" src={assetUrl(artifact.id)} aria-label={artifact.filename} />}
                {artifact.mime === "audio/mpeg" && <audio controls preload="none" src={assetUrl(artifact.id)} aria-label={artifact.filename} />}
                <div className="content-media-result-links">
                  <a download={artifact.filename} href={assetUrl(artifact.id)}><DownloadSimpleIcon size={16} aria-hidden="true" />下载 {artifact.filename}</a>
                  {artifact.mime === "audio/mpeg" && useResult(artifact, "lip-sync", "用于口型对齐")}
                  {artifact.mime === "video/mp4" && kind !== "burn-subtitles" && useResult(artifact, "burn-subtitles", "添加字幕")}
                  {artifact.filename.endsWith(".srt") && useResult(artifact, "burn-subtitles", "压制到视频")}
                  {artifact.filename.endsWith(".srt") && kind !== "translate-subtitles" && useResult(artifact, "translate-subtitles", "翻译字幕")}
                </div>
              </div>
            ))}
          </article>
        ))}
        </div>
      </section>
    </div>
  );
}
