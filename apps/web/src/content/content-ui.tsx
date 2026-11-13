import { useEffect, useRef, useState, type ReactNode } from "react";
import { useBlocker } from "react-router-dom";
import { errorText } from "../api";
import { useApiData } from "../hooks";
import { ConfirmDialog, DataResult, Field, Notice } from "../components";
export { Context, useContent } from "./content-context";
const labels: Record<string, string> = {
  draft: "草稿",
  submitted: "待审核",
  approved: "已批准",
  rejected: "已退回",
  exempt: "免审交付",
  queued: "排队中",
  rendering: "视频生成中",
  submitting: "生成中",
  storing: "保存结果",
  succeeded: "已完成",
  failed: "失败",
  needs_reconciliation: "待核实",
  cancelled: "已停止",
  reserved: "费用待确认",
  released: "未消耗",
  unknown: "费用待核实",
  usage_unknown_cost_pending: "用量及账单待核对",
  usage_reported_cost_pending: "账单待核对",
  hero: "主视觉",
  split: "左右分栏",
  minimal: "简洁留白",
  square: "方图",
  portrait: "竖版海报",
  story: "全屏竖图",
};
export const status = (v: string) => labels[v] ?? v;
export const key = () => crypto.randomUUID();
export function usePagedCollection<T>(path: string, page: number) {
  const result = useApiData<{
    items: T[];
    total: number;
    page: number;
    pageSize: number;
  }>(path + (path.includes("?") ? "&" : "?") + "page=" + page);
  return { ...result, data: result.data?.items, pagination: result };
}
export function useAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  return {
    busy,
    error,
    run: async (fn: () => Promise<unknown>) => {
      if (lock.current) return;
      lock.current = true;
      setBusy(true);
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(errorText(e));
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
  };
}
export function useDirty(dirty: boolean) {
  const currentDirty = useRef(dirty);
  currentDirty.current = dirty;
  useEffect(() => {
    const f = (e: BeforeUnloadEvent) => {
      if (currentDirty.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, [dirty]);
  const b = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  return (
    <ConfirmDialog
      open={b.state === "blocked"}
      title="放弃尚未保存的修改？"
      description="离开后保留上次保存的版本。"
      confirmLabel="放弃修改"
      cancelLabel="继续编辑"
      onConfirm={() => b.state === "blocked" && b.proceed()}
      onCancel={() => b.state === "blocked" && b.reset()}
    />
  );
}
export function Result({
  result,
  children,
}: {
  result: any;
  children: ReactNode;
}) {
  return (
    <DataResult
      data={result.data}
      loading={result.loading}
      error={result.error}
      reload={result.reload}
    >
      {children}
    </DataResult>
  );
}
export function Pager({
  result,
  page,
  setPage,
}: {
  result: any;
  page: number;
  setPage: (v: number) => void;
}) {
  return result.data?.total > 20 ? (
    <nav className="content-pagination" aria-label="分页">
      <button
        disabled={page === 1 || result.loading}
        onClick={() => setPage(page - 1)}
      >
        上一页
      </button>
      <span>
        第 {page} 页 · 共 {result.data.total} 项
      </span>
      <button
        disabled={page * 20 >= result.data.total || result.loading}
        onClick={() => setPage(page + 1)}
      >
        下一页
      </button>
    </nav>
  ) : null;
}
export function FileInput({
  label,
  onUpload,
  compact = false,
}: {
  label: string;
  onUpload: (filename: string, data: string) => Promise<void>;
  compact?: boolean;
}) {
  const a = useAction();
  const file = useRef<HTMLInputElement>(null);
  const control = (
    <input
      ref={file}
      type="file"
      hidden={compact}
      aria-label={label}
      accept="image/png,image/jpeg,image/webp"
      disabled={a.busy}
      onChange={(e) => {
        const input = e.currentTarget;
        const f = input.files?.[0];
        if (f)
          void a.run(async () => {
            if (f.size > 8 * 1024 * 1024) throw Error("图片最大8MiB");
            const data = await new Promise<string>((resolve, reject) => {
              const r = new FileReader();
              r.onload = () => resolve(String(r.result).split(",")[1]);
              r.onerror = reject;
              r.readAsDataURL(f);
            });
            await onUpload(f.name, data);
            input.value = "";
          });
      }}
    />
  );
  return (
    <div className="content-upload">
      {compact ? (
        <>
          <button
            className="primary"
            type="button"
            disabled={a.busy}
            onClick={() => file.current?.click()}
          >
            {a.busy ? "上传中…" : label}
          </button>
          {control}
        </>
      ) : (
        <Field label={label}>{control}</Field>
      )}
      <Notice text={a.error} />
    </div>
  );
}

// Uploaded images are normalized to PNG by the content API.
export function assetDownloadName(asset: { filename: string; mime?: string }) {
  const extension = asset.mime === "video/mp4" ? "mp4" : "png";
  return asset.filename.replace(/\.[^.]+$/, "") + "." + extension;
}
