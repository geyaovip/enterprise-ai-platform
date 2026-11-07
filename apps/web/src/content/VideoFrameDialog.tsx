import { useEffect, useRef, useState } from "react";
import { Dialog, Notice } from "../components";
import { api } from "../api";
import { useAction, useContent } from "./content-ui";

type FramePosition = "current" | "first" | "last";
const labels = { current: "当前帧", first: "首帧", last: "尾帧" };

// Frame decoding and drawing adapted from Toonflow videoPlayer.vue, commit
// af6e884c3d8cda353acaf8ef13aea8ea754a4afd, MIT. See third-party/Toonflow-LICENSE.
async function frameData(
  video: HTMLVideoElement,
  position: FramePosition,
  signal: AbortSignal,
) {
  let source = video;
  if (position !== "current") {
    source = document.createElement("video");
    source.muted = true;
    source.preload = "auto";
  }
  try {
    if (source !== video) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", abort);
          source.onloadeddata = source.onseeked = source.onerror = null;
        };
        const finish = () => {
          cleanup();
          resolve();
        };
        const abort = () => {
          cleanup();
          reject(new Error("无法读取视频帧"));
        };
        const timer = setTimeout(abort, 15000);
        signal.addEventListener("abort", abort, { once: true });
        source.onloadeddata = () => {
          if (position === "first") finish();
          else if (Number.isFinite(source.duration) && source.duration > 0.04)
            source.currentTime = source.duration - 0.04;
          else finish();
        };
        source.onseeked = finish;
        source.onerror = abort;
        source.src = video.currentSrc;
        if (signal.aborted) abort();
        else source.load();
      });
    }
    signal.throwIfAborted();
    if (
      source.seeking ||
      source.readyState < 2 ||
      !source.videoWidth ||
      !source.videoHeight
    )
      throw new Error("视频帧尚未就绪");
    const canvas = document.createElement("canvas");
    const scale = Math.min(
      1,
      Math.sqrt(2100000 / (source.videoWidth * source.videoHeight)),
    );
    canvas.width = Math.round(source.videoWidth * scale);
    canvas.height = Math.round(source.videoHeight * scale);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("浏览器无法截取视频帧");
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png").split(",")[1];
  } finally {
    if (source !== video) {
      source.removeAttribute("src");
      source.load();
    }
  }
}

export function VideoFrameDialog({
  assetId,
  projectId,
  onClose,
  onSaved,
}: {
  assetId: string;
  projectId: string;
  onClose: () => void;
  onSaved: (asset: { id: string; filename: string }) => void | Promise<void>;
}) {
  const { base } = useContent();
  const video = useRef<HTMLVideoElement>(null);
  const controller = useRef<AbortController>(null);
  const action = useAction();
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState<{ id: string; filename: string }>();
  useEffect(() => () => controller.current?.abort(), []);
  const capture = (position: FramePosition) =>
    void action.run(async () => {
      if (!video.current) return;
      const run = new AbortController();
      controller.current = run;
      const data = await frameData(video.current, position, run.signal);
      run.signal.throwIfAborted();
      const asset = await api.post<{ id: string; filename: string }>(
        base + "/assets",
        {
          filename: labels[position] + "-" + assetId.slice(0, 8) + ".png",
          data,
          projectId,
        },
      );
      if (!run.signal.aborted) {
        setSaved(asset);
        await onSaved(asset);
      }
    });
  return (
    <Dialog
      open
      title="截取视频帧"
      size="large"
      busy={action.busy}
      onClose={onClose}
    >
      <video
        ref={video}
        className="content-frame-video"
        controls
        preload="auto"
        aria-label="截帧预览"
        src={"/api/v1" + base + "/assets/" + assetId + "/file"}
        onLoadedData={() => setReady(true)}
        onError={() => setReady(false)}
      />
      <Notice text={action.error} />
      <div className="form-actions">
        {saved ? (
          <button
            type="button"
            disabled={action.busy}
            onClick={() =>
              void action.run(() => Promise.resolve(onSaved(saved)))
            }
          >
            继续使用已保存图片
          </button>
        ) : (
          (["current", "first", "last"] as const).map((position) => (
            <button
              type="button"
              key={position}
              disabled={!ready || action.busy}
              onClick={() => capture(position)}
            >
              保存{labels[position]}
            </button>
          ))
        )}
      </div>
    </Dialog>
  );
}
