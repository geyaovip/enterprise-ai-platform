import { useEffect, useRef, useState } from "react";
import { Field, Notice } from "../components";
import { ImageRegionDialog, type EditRegion } from "./ImageRegionDialog";
import { frameData, type FramePosition } from "./VideoFrameDialog";
import { useAction } from "./content-ui";

const limit = 24_000_000;
type Result = { url: string; label: string };
type ImageOperation = "crop" | "rotate" | "mirror";

function useObjectUrl(blob: Blob | undefined) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!blob) {
      setUrl("");
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

export function LocalMediaTool({ operation }: { operation: "image" | "frame" }) {
  const [file, setFile] = useState<File>();
  const [error, setError] = useState("");
  const url = useObjectUrl(file);
  const image = operation === "image";
  return (
    <div className="content-local-tool">
      <Field label={image ? "选择本地图片" : "选择本地视频"}>
        <input type="file" accept={image ? "image/png,image/jpeg,image/webp" : "video/mp4,video/webm"}
          onChange={(event) => {
            const next = event.target.files?.[0];
            event.target.value = "";
            if (!next) return;
            const valid = (image ? /^image\/(png|jpeg|webp)$/ : /^video\/(mp4|webm)$/).test(next.type);
            setError(valid ? "" : image ? "请选择 PNG、JPEG 或 WebP 图片" : "请选择 MP4 或 WebM 视频");
            if (valid) setFile(next);
          }} />
      </Field>
      <Notice text={error} />
      {file && url && <MediaEditor key={url} operation={operation} name={file.name} url={url} />}
    </div>
  );
}

function MediaEditor({ operation, name, url }: { operation: "image" | "frame"; name: string; url: string }) {
  const [ready, setReady] = useState(false);
  const [decodeError, setDecodeError] = useState("");
  const [result, setResult] = useState<Result>();
  const [cropOpen, setCropOpen] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const abort = useRef<AbortController>(null);
  const action = useAction();
  const image = operation === "image";
  useEffect(() => () => abort.current?.abort(), []);

  const edit = (kind: ImageOperation, region?: EditRegion) => void action.run(async () => {
    const source = img.current;
    if (!source?.naturalWidth || !source.naturalHeight) throw Error("图片尚未就绪");
    const { naturalWidth: width, naturalHeight: height } = source;
    const canvas = document.createElement("canvas");
    const rotate = kind === "rotate";
    const x = region ? Math.round(region.x * width) : 0;
    const y = region ? Math.round(region.y * height) : 0;
    const w = region ? Math.max(1, Math.round((region.x + region.w) * width) - x) : width;
    const h = region ? Math.max(1, Math.round((region.y + region.h) * height) - y) : height;
    if (w * h > limit) throw Error("导出图片最多支持 2400 万像素，请缩小裁剪范围");
    canvas.width = rotate ? h : w;
    canvas.height = rotate ? w : h;
    const context = canvas.getContext("2d");
    if (!context) throw Error("当前浏览器无法处理图片");
    if (rotate) {
      context.translate(h, 0);
      context.rotate(Math.PI / 2);
    } else if (kind === "mirror") {
      context.translate(w, 0);
      context.scale(-1, 1);
    }
    context.drawImage(source, x, y, w, h, 0, 0, w, h);
    const output = canvas.toDataURL("image/png");
    if (output === "data:,") throw Error("图片过大，无法导出");
    setResult({ url: output, label: { crop: "裁剪", rotate: "旋转", mirror: "镜像" }[kind] });
    setCropOpen(false);
  });

  const capture = (position: FramePosition, label: string) => void action.run(async () => {
    if (!video.current) return;
    const controller = new AbortController();
    abort.current = controller;
    const data = await frameData(video.current, position, controller.signal);
    if (!data) throw Error("当前浏览器无法导出视频帧");
    setResult({ url: "data:image/png;base64," + data, label });
  });

  return (
    <>
      {image ? (
        <img ref={img} src={url} alt={name} className="content-local-preview"
          onLoad={() => setReady(true)} onError={() => setDecodeError("无法读取此图片")} />
      ) : (
        <video ref={video} src={url} controls playsInline preload="auto" className="content-local-preview"
          aria-label="截帧预览" onLoadedData={() => setReady(true)}
          onError={() => { setReady(false); setDecodeError("当前浏览器无法播放此视频编码"); }} />
      )}
      <Notice text={decodeError || (!cropOpen ? action.error : null)} />
      <div className="form-actions">
        {image ? (
          <>
            <button disabled={!ready || action.busy} onClick={() => setCropOpen(true)}>裁剪</button>
            <button disabled={!ready || action.busy} onClick={() => edit("rotate")}>顺时针旋转 90°</button>
            <button disabled={!ready || action.busy} onClick={() => edit("mirror")}>水平镜像</button>
          </>
        ) : ([
          ["first", "首帧"], ["current", "当前帧"], ["last", "尾帧"],
        ] as const).map(([position, label]) => (
          <button key={position} disabled={!ready || action.busy} onClick={() => capture(position, label)}>截取{label}</button>
        ))}
      </div>
      {cropOpen && (
        <ImageRegionDialog image={{ url, name }} title="裁剪图片" actionLabel="应用裁剪"
          busy={action.busy} error={action.error} onClose={() => setCropOpen(false)}
          onSelect={(region) => edit("crop", region)} />
      )}
      {result && (
        <section className="content-local-result" aria-label="处理结果">
          <img className="content-local-preview" src={result.url} alt={result.label + "结果"} />
          <a href={result.url} download={name.replace(/\.[^.]+$/, "") + "-" + result.label + ".png"}>下载 PNG</a>
        </section>
      )}
    </>
  );
}
