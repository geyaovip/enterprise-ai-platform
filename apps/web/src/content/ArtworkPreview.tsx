import { useEffect, useId, useRef, useState } from "react";
import { api } from "../api";
import { errorText } from "../api";
import { useContent } from "./content-ui";
function CroppedImage({ src, layer: l }: { src: string; layer: any }) {
  const [size, setSize] = useState({ width: 1, height: 1 });
  const id = useId();
  const crop = l.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  return (
    <div className="content-image-clip">
      <img
        className="content-image-probe"
        src={src}
        alt=""
        onLoad={(e) =>
          setSize({
            width: e.currentTarget.naturalWidth,
            height: e.currentTarget.naturalHeight,
          })
        }
      />
      <svg
        width="100%"
        height="100%"
        viewBox={`${Math.round(crop.x * size.width)} ${Math.round(crop.y * size.height)} ${Math.max(1, Math.round(crop.w * size.width))} ${Math.max(1, Math.round(crop.h * size.height))}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={
          l.role === "product"
            ? "产品原图"
            : l.role === "logo"
              ? "品牌Logo"
              : "素材"
        }
      >
        <defs>
          <clipPath id={id}>
            <rect
              x={Math.round(crop.x * size.width)}
              y={Math.round(crop.y * size.height)}
              width={Math.max(1, Math.round(crop.w * size.width))}
              height={Math.max(1, Math.round(crop.h * size.height))}
            />
          </clipPath>
        </defs>
        <image
          href={src}
          width={size.width}
          height={size.height}
          clipPath={`url(#${id})`}
        />
      </svg>
    </div>
  );
}
export function ArtworkPreview({
  data,
  onLayer,
  selected,
  region,
  onRegion,
  artifactId,
  editable = false,
  onPatch,
  onGesture,
  onLayout,
  thumbnail = false,
}: {
  data: any;
  onLayer?: (id: string) => void;
  selected?: string;
  region?: any;
  onRegion?: (r: any) => void;
  artifactId?: string;
  editable?: boolean;
  onPatch?: (id: string, changes: any) => void;
  onGesture?: (phase: "begin" | "end") => void;
  onLayout?: (value: any) => void;
  thumbnail?: boolean;
}) {
  const c = useContent(),
    ref = useRef<HTMLDivElement>(null),
    start = useRef<any>(null),
    drag = useRef<any>(null);
  const [layout, setLayout] = useState<any>(null);
  const [layoutEpoch, setLayoutEpoch] = useState(0);
  useEffect(() => {
    const online = () => setLayoutEpoch((n) => n + 1);
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, []);
  const fingerprint = JSON.stringify(data);
  useEffect(() => {
    if (!artifactId) return;
    let active = true;
    onLayout?.(null);
    const timer = setTimeout(
      () => {
        void api
          .post<any>(c.base + "/artifacts/" + artifactId + "/layout", { data })
          .then((value) => {
            if (active) {
              setLayout(value);
              onLayout?.(value);
            }
          })
          .catch((error) => {
            if (active)
              onLayout?.({
                error: errorText(error),
                issues: [],
                retry: () => setLayoutEpoch((n) => n + 1),
              });
          });
      },
      thumbnail ? 80 : 220,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [fingerprint, artifactId, c.base, onLayout, thumbnail, layoutEpoch]);
  const img = (id: string) =>
    "/api/v1" + c.base + "/assets/" + id + (thumbnail ? "/thumbnail" : "/file");
  const beginDrag = (e: React.PointerEvent, l: any, resize = false) => {
    if (onRegion) return;
    onLayer?.(l.id);
    if (!editable || l.locked || !onPatch || !ref.current || e.button !== 0)
      return;
    e.preventDefault();
    e.stopPropagation();
    ref.current.focus({ preventScroll: true });
    ref.current.setPointerCapture(e.pointerId);
    drag.current = {
      layer: { ...l },
      x: e.clientX,
      y: e.clientY,
      resize,
      rect: ref.current.getBoundingClientRect(),
    };
    onGesture?.("begin");
  };
  const begin = (e: any) => {
    if (!onRegion || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    start.current = { x, y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: any) => {
    if (drag.current && onPatch) {
      const { layer: l, x, y, rect, resize } = drag.current,
        dx = (e.clientX - x) / rect.width,
        dy = (e.clientY - y) / rect.height;
      onPatch(
        l.id,
        resize
          ? {
              w: Math.max(0.01, Math.min(1 - l.x, l.w + dx)),
              h: Math.max(0.01, Math.min(1 - l.y, l.h + dy)),
            }
          : {
              x: Math.max(0, Math.min(1 - l.w, l.x + dx)),
              y: Math.max(0, Math.min(1 - l.h, l.y + dy)),
            },
      );
      return;
    }
    if (!start.current || !ref.current || !onRegion) return;
    const r = ref.current.getBoundingClientRect(),
      x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    onRegion({
      x: Math.min(x, start.current.x),
      y: Math.min(y, start.current.y),
      w: Math.min(
        1 - Math.min(x, start.current.x),
        Math.max(0.01, Math.abs(x - start.current.x)),
      ),
      h: Math.min(
        1 - Math.min(y, start.current.y),
        Math.max(0.01, Math.abs(y - start.current.y)),
      ),
    });
  };
  return (
    <div
      ref={ref}
      className={
        "content-artwork " +
        (onRegion ? "region-mode" : editable ? "editable" : "")
      }
      tabIndex={editable ? 0 : undefined}
      style={{
        aspectRatio: `${data.width}/${data.height}`,
        ["--art-ratio" as any]: data.width / data.height,
        backgroundColor: data.backgroundColor,
      }}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={() => {
        start.current = null;
        if (drag.current) {
          drag.current = null;
          onGesture?.("end");
        }
      }}
      onPointerCancel={() => {
        start.current = null;
        if (drag.current) {
          onPatch?.(drag.current.layer.id, drag.current.layer);
          drag.current = null;
          onGesture?.("end");
        }
      }}
      onKeyDown={(e) => {
        if (!editable || onRegion || e.nativeEvent.isComposing) return;
        const l = data.layers.find((l: any) => l.id === selected);
        if (
          !l ||
          l.locked ||
          !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
        )
          return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        onPatch?.(l.id, {
          x: Math.max(
            0,
            Math.min(
              1 - l.w,
              l.x +
                (e.key === "ArrowLeft"
                  ? -step
                  : e.key === "ArrowRight"
                    ? step
                    : 0) /
                  data.width,
            ),
          ),
          y: Math.max(
            0,
            Math.min(
              1 - l.h,
              l.y +
                (e.key === "ArrowUp"
                  ? -step
                  : e.key === "ArrowDown"
                    ? step
                    : 0) /
                  data.height,
            ),
          ),
        });
      }}
      aria-label={`作品预览 ${data.width}×${data.height}`}
    >
      {data.backgroundId && (
        <img
          className="content-background"
          src={img(data.backgroundId)}
          alt="生成背景"
        />
      )}
      {data.layers.map((l: any) => (
        <div
          key={l.id}
          className={"content-layer " + (selected === l.id ? "selected" : "")}
          style={{
            left: l.x * 100 + "%",
            top: l.y * 100 + "%",
            width: l.w * 100 + "%",
            height: l.h * 100 + "%",
            color: l.color,
            fontSize: (l.fontSize / 1080) * 100 + "cqw",
          }}
          onClick={() => !onRegion && onLayer?.(l.id)}
          onPointerDown={(e) => beginDrag(e, l)}
          data-layer-id={l.id}
        >
          {l.type === "image" ? (
            <CroppedImage src={img(l.assetId)} layer={l} />
          ) : layout?.layers.find((x: any) => x.id === l.id)?.image ? (
            <img
              className="content-text-raster"
              src={layout.layers.find((x: any) => x.id === l.id).image}
              alt={l.text ?? ""}
              draggable={false}
            />
          ) : (
            <span aria-label={l.text ?? ""}>{artifactId ? "" : l.text}</span>
          )}
          {editable && !onRegion && selected === l.id && !l.locked && (
            <button
              type="button"
              className="content-resize-handle"
              aria-label="缩放所选图层"
              onPointerDown={(e) => beginDrag(e, l, true)}
            />
          )}
        </div>
      ))}
      {region && (
        <div
          className="content-region"
          style={{
            left: region.x * 100 + "%",
            top: region.y * 100 + "%",
            width: region.w * 100 + "%",
            height: region.h * 100 + "%",
          }}
        />
      )}
    </div>
  );
}
