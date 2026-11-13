import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, errorText } from "../api";
import { Field } from "../components";
import { useContent } from "./content-ui";

type Slot = "video" | "audio" | "face" | "source";
export type CloudMediaKind = "face-swap" | "auto-subtitles" | "burn-subtitles" | "lip-sync" | "voice-over"
  | "presenter-video" | "translate-subtitles";
type Artifact = { id: string; mime: string; filename: string };
type Job = {
  id: string; status: string; error: string | null; step: string | null; createdAt: string; artifacts: Artifact[];
};
type Handoff = { asset?: Artifact };
const toolFields: Record<CloudMediaKind, { files: Slot[]; script?: true; srt?: true; consent?: string; cost: string }> = {
  "face-swap": { files: ["video", "face"], consent: "我已获得视频及参考照片中人物的授权，并同意将素材提交至火山引擎进行人脸处理。",
    cost: "参考价 ¥0.80／分钟，按输入视频时长计费。" },
  "auto-subtitles": { files: ["source"], cost: "参考价 ¥0.03／分钟，按输入时长计费。素材提交至火山引擎处理。" },
  "burn-subtitles": { files: ["video"], srt: true, cost: "应用内压制，无外部接口费用。" },
  "lip-sync": { files: ["video", "audio"], consent: "我已获得出镜人物和音频权利人的授权，并同意将素材提交至火山引擎进行口型合成。",
    cost: "参考价 ¥1.00／分钟，按输出时长计费。视频应至少与音频等长。" },
  "voice-over": { files: [], script: true, cost: "使用豆包标准女声。参考价 ¥3.00／万字。口播稿提交至豆包语音处理。" },
  "presenter-video": { files: ["video"], script: true, consent: "我已获得出镜人物的授权，并同意将视频和口播稿提交至火山引擎处理。",
    cost: "包含配音、口型对齐、语音识别和字幕压制。配音比素材长时，画面会往复播放以匹配完整口播。" },
  "translate-subtitles": { files: [], srt: true, cost: "使用企业文本模型，按模型用量计费。每次最多 60 条字幕、合计 1800 字。" },
};
const fileFields: Record<Slot, { label: string; accept: string }> = {
  video: { label: "视频（MP4）", accept: ".mp4,video/mp4" },
  audio: { label: "驱动音频（MP3、WAV）", accept: ".mp3,.wav,audio/mpeg,audio/wav" },
  face: { label: "参考人像（JPG、PNG）", accept: ".jpg,.jpeg,.png,image/jpeg,image/png" },
  source: { label: "视频或音频（MP4、MP3、WAV）", accept: ".mp4,.mp3,.wav,video/mp4,audio/mpeg,audio/wav" },
};
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
  const [jobs, setJobs] = useState<Job[]>([]);
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
    }).then((value) => { setSrt(value); attempt.current = undefined; })
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
    if (linked && linkedSlot === slot) setLinked(undefined);
    setFiles((current) => ({ ...current, [slot]: undefined }));
    if (!file) return;
    const limit = slot === "video" || slot === "source" && isVideo(file) ? 32 : 8;
    if (file.size < 1 || file.size > limit * 1024 * 1024) {
      setError("请选择不超过 " + limit + " MB 的文件");
      return;
    }
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
      setJobs((old) => [job, ...old.filter((item) => item.id !== job.id)]);
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

  return (
    <>
      <form className="content-writing-form content-cloud-media-form" onSubmit={submit}>
        <p className="content-tool-description">{config.cost}{kind === "presenter-video" ? " 参考价 ¥3／万字，口型与识别合计约 ¥1.03／分钟。" : ""}</p>
        <fieldset disabled={busy}>
          {config.files.map((slot) => (
            <Field key={slot} label={slot === "video" && config.consent ? "单人出镜视频（MP4）" : fileFields[slot].label}>
              <input type="file" accept={fileFields[slot].accept} onChange={(event) => changeFile(slot, event.target.files?.[0])} />
              {linked && linkedSlot === slot && <span>已选历史结果 {linked.filename}</span>}
            </Field>
          ))}
          {config.files.length > 0 && <p className="content-tool-description">视频及音频最长 3 分钟。MP4 最大 32 MB，音频与图片最大 8 MB。</p>}
          {config.script && (
            <Field label="口播稿（最多 800 字）">
              <textarea rows={5} maxLength={800} value={text} placeholder="粘贴需要朗读的内容"
                onChange={(event) => { setText(event.target.value); edit(); }} />
            </Field>
          )}
          {config.srt && (
            <>
              <Field label="导入 SRT">
                <input type="file" accept=".srt" onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  if (file.size > 512 * 1024) { setError("SRT 文件最多 512 KB"); return; }
                  setLoadingSrt(true);
                  try {
                    const source = await file.text();
                    if (source.length > 180000) throw Error("SRT 字幕内容过长");
                    setSrt(source);
                    edit();
                  } catch (e) { setError(errorText(e)); }
                  finally { setLoadingSrt(false); }
                }} />
              </Field>
              <Field label="SRT 字幕">
                <textarea rows={7} maxLength={180000} value={srt} disabled={loadingSrt}
                  placeholder={"1\n00:00:00,000 --> 00:00:02,000\n欢迎观看"}
                  onChange={(event) => { setSrt(event.target.value); edit(); }} />
              </Field>
            </>
          )}
          {kind === "translate-subtitles" && (
            <Field label="目标语言">
              <select value={language} onChange={(event) => { setLanguage(event.target.value); edit(); }}>
                {choices.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </select>
            </Field>
          )}
          {config.consent && (
            <label className="content-cloud-media-consent">
              <input type="checkbox" checked={consent} onChange={(event) => {
                setConsent(event.target.checked);
                if (!attempt.current?.body) edit();
              }} />
              {config.consent}
            </label>
          )}
        </fieldset>
        {blocker && <p role="status" className="content-tool-description">{blocker}</p>}
        {error && <p role="alert">{error}</p>}
        <button type="submit" className="primary" disabled={blocker !== null || !ready || busy || loadingSrt}>
          {busy ? "正在提交…" : kind === "burn-subtitles" ? "压制字幕" : "开始处理"}
        </button>
      </form>
      <section className="content-media-history" aria-label="处理记录">
        <h2>处理记录</h2>
        {loadError && <p role="status">{loadError}</p>}
        {!jobs.length && !loadError && <p className="content-tool-description">暂无处理记录</p>}
        {jobs.map((job) => (
          <article key={job.id} className="content-media-job">
            <div className="content-media-job-heading">
              <strong>{statuses[job.status] ?? job.status}{isActive(job) && job.step ? " · " + stepLabels[job.step] : ""}</strong>
              <time dateTime={job.createdAt}>{new Date(job.createdAt).toLocaleString("zh-CN")}</time>
            </div>
            {job.error && <p className="content-tool-description">{job.error}</p>}
            {job.artifacts.map((artifact) => (
              <div key={artifact.id} className="content-media-result">
                {artifact.mime === "video/mp4" && <video controls playsInline preload="none" src={assetUrl(artifact.id)} aria-label={artifact.filename} />}
                {artifact.mime === "audio/mpeg" && <audio controls preload="none" src={assetUrl(artifact.id)} aria-label={artifact.filename} />}
                <div className="content-media-result-links">
                  <a download={artifact.filename} href={assetUrl(artifact.id)}>下载{artifact.filename}</a>
                  {artifact.mime === "audio/mpeg" && useResult(artifact, "lip-sync", "用于口型对齐")}
                  {artifact.mime === "video/mp4" && kind !== "burn-subtitles" && useResult(artifact, "burn-subtitles", "添加字幕")}
                  {artifact.filename.endsWith(".srt") && useResult(artifact, "burn-subtitles", "压制到视频")}
                  {artifact.filename.endsWith(".srt") && kind !== "translate-subtitles" && useResult(artifact, "translate-subtitles", "翻译字幕")}
                </div>
              </div>
            ))}
          </article>
        ))}
      </section>
    </>
  );
}
