import { Dialog, Field, InfoTip } from "../components";
import { useState } from "react";
import { useContent } from "./content-ui";

export type MediaMode = "image" | "video";
export type PictureOptions = {
  ratio: string;
  resolution: "2K" | "4K";
  candidates: number;
};
export type ClipOptions = {
  ratio: string;
  resolution: "480p" | "720p" | "1080p";
  duration: number;
};
export const pictureDefaults: PictureOptions = {
  ratio: "1:1",
  resolution: "2K",
  candidates: 1,
};
export const clipDefaults: ClipOptions = {
  ratio: "16:9",
  resolution: "720p",
  duration: 5,
};
export const legacyRatios: Record<string, string> = {
  square: "1:1",
  portrait: "3:4",
  story: "9:16",
};
export const mediaActive = ["queued", "submitting", "storing", "rendering"];

// Adapted from Toonflow generationSettings.vue, commit af6e884c3d8cda353acaf8ef13aea8ea754a4afd.
// MIT license, see third-party/Toonflow-LICENSE.
function ratioStyle(value: string) {
  const [width = 1, height = 1] =
    value === "adaptive" ? [1, 1] : value.split(":").map(Number);
  return {
    width: `${16 * Math.min(width / height, 1)}px`,
    height: `${16 * Math.min(height / width, 1)}px`,
  };
}

export function constrainPicture(
  value: PictureOptions,
  limits: { ratios: string[]; resolutions: string[]; maxCandidates: number },
): PictureOptions {
  return {
    ratio: limits.ratios.includes(value.ratio)
      ? value.ratio
      : pictureDefaults.ratio,
    resolution: limits.resolutions.includes(value.resolution)
      ? value.resolution
      : pictureDefaults.resolution,
    candidates: Number.isInteger(value.candidates)
      ? Math.min(limits.maxCandidates, Math.max(1, value.candidates))
      : 1,
  };
}

type Props = {
  mode: MediaMode;
  picture: PictureOptions;
  clip: ClipOptions;
  hasFrame: boolean;
  preserveSize?: boolean;
  disabled: boolean;
  onPicture: (value: PictureOptions) => void;
  onClip: (value: ClipOptions) => void;
};

export function MediaOptions({
  mode,
  picture,
  clip,
  hasFrame,
  preserveSize = false,
  disabled,
  onPicture,
  onClip,
}: Props) {
  const [open, setOpen] = useState(false);
  const { meta } = useContent();
  const image = mode === "image";
  const options = meta.model.imageOptions;
  const selected = image ? picture : clip;
  const ratios: string[] = image
    ? options.ratios
    : meta.model.videoRatios.filter(
        (x: string) => hasFrame || x !== "adaptive",
      );
  const resolutions: string[] = image
    ? options.resolutions
    : ["480p", "720p", "1080p"];
  const ratioName = (value: string) =>
    value === "adaptive" ? "跟随首帧" : value;
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label="生成偏好"
        aria-haspopup="dialog"
      >
        {preserveSize
          ? "原图尺寸"
          : ratioName(selected.ratio) + " · " + selected.resolution}{" "}
        · {image ? picture.candidates + " 张" : clip.duration + " 秒"}
      </button>
      <Dialog open={open} title="生成偏好" onClose={() => setOpen(false)}>
        <div className="form-panel">
          <div className="media-model-setting">
            <Field label="企业模型">
              <output>{image ? meta.model.image : meta.model.video}</output>
            </Field>
            <InfoTip label="参考图片如何使用">
              用于生成的参考图片会发送至企业配置的模型服务。
            </InfoTip>
          </div>
          {preserveSize ? (
            <span>沿用原图尺寸</span>
          ) : (
            <>
              <fieldset className="media-ratios">
                <legend>比例</legend>
                {ratios.map((ratio) => (
                  <button
                    type="button"
                    key={ratio}
                    aria-pressed={ratio === selected.ratio}
                    onClick={() =>
                      image
                        ? onPicture({ ...picture, ratio })
                        : onClip({ ...clip, ratio })
                    }
                  >
                    <span aria-hidden="true" style={ratioStyle(ratio)} />
                    {ratioName(ratio)}
                  </button>
                ))}
              </fieldset>
              <Field label="清晰度">
                <select
                  value={selected.resolution}
                  onChange={(event) =>
                    image
                      ? onPicture({
                          ...picture,
                          resolution: event.target
                            .value as PictureOptions["resolution"],
                        })
                      : onClip({
                          ...clip,
                          resolution: event.target
                            .value as ClipOptions["resolution"],
                        })
                  }
                >
                  {resolutions.map((resolution) => (
                    <option key={resolution}>{resolution}</option>
                  ))}
                </select>
              </Field>
            </>
          )}
          {image ? (
            <Field label="候选张数">
              <select
                value={picture.candidates}
                onChange={(event) =>
                  onPicture({
                    ...picture,
                    candidates: Number(event.target.value),
                  })
                }
              >
                {Array.from(
                  { length: options.maxCandidates },
                  (_, index) => index + 1,
                ).map((n) => (
                  <option key={n} value={n}>
                    {n} 张
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="时长">
              <select
                value={clip.duration}
                onChange={(event) =>
                  onClip({ ...clip, duration: Number(event.target.value) })
                }
              >
                {Array.from({ length: 11 }, (_, index) => index + 2).map(
                  (n) => (
                    <option key={n} value={n}>
                      {n} 秒
                    </option>
                  ),
                )}
              </select>
            </Field>
          )}
          <button
            type="button"
            onClick={() =>
              image
                ? onPicture(pictureDefaults)
                : onClip({
                    ...clipDefaults,
                    ratio: hasFrame ? "adaptive" : clipDefaults.ratio,
                  })
            }
          >
            恢复默认
          </button>
        </div>
      </Dialog>
    </>
  );
}
