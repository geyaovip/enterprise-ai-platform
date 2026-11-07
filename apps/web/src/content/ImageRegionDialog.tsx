import { useRef, useState, type PointerEvent } from "react";
import { Dialog, Field, Notice } from "../components";

export type EditRegion = { x: number; y: number; w: number; h: number };
type Point = { x: number; y: number };
const initial = { x: 25, y: 25, w: 50, h: 50 };

export function ImageRegionDialog({
  image,
  initialRegion,
  title = "局部改图",
  actionLabel = "使用选区",
  busy = false,
  error,
  onClose,
  onSelect,
}: {
  image: { url: string; name: string };
  initialRegion?: EditRegion;
  title?: string;
  actionLabel?: string;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSelect: (region: EditRegion) => void;
}) {
  const [region, setRegion] = useState(
    initialRegion
      ? {
          x: initialRegion.x * 100,
          y: initialRegion.y * 100,
          w: initialRegion.w * 100,
          h: initialRegion.h * 100,
        }
      : initial,
  );
  const start = useRef<{ id: number; point: Point }>(null);
  const point = (e: PointerEvent<HTMLDivElement>) => {
    const bounds = e.currentTarget.getBoundingClientRect();
    const percent = (n: number) =>
      Math.max(0, Math.min(100, Math.round(n * 100)));
    return {
      x: percent((e.clientX - bounds.left) / bounds.width),
      y: percent((e.clientY - bounds.top) / bounds.height),
    };
  };
  const draw = (e: PointerEvent<HTMLDivElement>) => {
    if (start.current?.id !== e.pointerId) return;
    const a = start.current.point;
    const b = point(e);
    setRegion({
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(a.x - b.x),
      h: Math.abs(a.y - b.y),
    });
  };
  const valid =
    region.w >= 1 &&
    region.h >= 1 &&
    region.x >= 0 &&
    region.y >= 0 &&
    region.x + region.w <= 100 &&
    region.y + region.h <= 100;
  return (
    <Dialog open title={title} busy={busy} size="large" onClose={onClose}>
      <div
        className="content-region-preview"
        onPointerDown={(e) => {
          if (busy || e.button !== 0 || !e.isPrimary) return;
          start.current = { id: e.pointerId, point: point(e) };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={draw}
        onPointerUp={(e) => {
          draw(e);
          start.current = null;
        }}
        onPointerCancel={() => {
          start.current = null;
        }}
        onLostPointerCapture={() => {
          start.current = null;
        }}
      >
        <img src={image.url} alt={image.name} draggable={false} />
        {valid && (
          <span
            aria-hidden="true"
            style={{
              left: region.x + "%",
              top: region.y + "%",
              width: region.w + "%",
              height: region.h + "%",
            }}
          />
        )}
      </div>
      <div className="content-region-fields">
        {(
          [
            ["x", "左侧"],
            ["y", "顶部"],
            ["w", "宽度"],
            ["h", "高度"],
          ] as const
        ).map(([key, name]) => (
          <Field key={key} label={name + " (%)"}>
            <input
              type="number"
              disabled={busy}
              min={key === "w" || key === "h" ? 1 : 0}
              max={100}
              value={region[key]}
              onChange={(e) =>
                setRegion({ ...region, [key]: Number(e.target.value) })
              }
            />
          </Field>
        ))}
      </div>
      <Notice text={error} />
      <button
        type="button"
        className="primary"
        disabled={!valid || busy}
        onClick={() =>
          onSelect({
            x: region.x / 100,
            y: region.y / 100,
            w: region.w / 100,
            h: region.h / 100,
          })
        }
      >
        {actionLabel}
      </button>
    </Dialog>
  );
}
