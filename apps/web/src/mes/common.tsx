import { createContext, useContext, useState, useRef, useEffect } from "react";
import type { ReactNode } from "react";
import {
  Link,
  useLocation,
  useBlocker,
  useSearchParams,
} from "react-router-dom";
import { api, errorText, tenantApi } from "../api";
import { useApiData } from "../hooks";
import {
  Field,
  Notice,
  Loading,
  Empty,
  Pager,
  ConfirmDialog,
} from "../components";
export const MesContext = createContext<any>(null);
export const useMes = () => useContext(MesContext);
export const base = (key: string) => tenantApi(key, "/apps/mes");
export const labels: Record<string, string> = {
  draft: "草稿",
  published: "已发布",
  archived: "已归档",
  released: "已发布",
  ready: "待开工",
  in_progress: "进行中",
  completed: "已结束",
  cancelled: "已取消",
  pending: "待审核",
  approved: "已通过",
  rejected: "已拒绝",
  finished: "成品",
  semi: "半成品",
  raw: "原料",
  packaging: "包装",
  auxiliary: "辅料",
  admin: "管理员",
  planner: "计划员",
  supervisor: "主管",
  operator: "操作员",
  viewer: "只读",
  none: "未授权",
};
export const date = (v: any) =>
  v ? new Date(v).toLocaleString("zh-CN", { hour12: false }) : "—";
export function Status({ value }: { value: string }) {
  return <span className="badge">{labels[value] ?? value}</span>;
}
export function Table({
  headers,
  children,
}: {
  headers: string[];
  children: ReactNode;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export function Result({ data, loading, error, children }: any) {
  return (
    <>
      <Notice text={error} />
      {loading && !data ? (
        <Loading />
      ) : data ? (
        children
      ) : (
        <Empty text="暂无数据" />
      )}
    </>
  );
}
export function useAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null),
    keys = useRef(new Map<string, string>()),
    running = useRef(false);
  async function write(
    path: string,
    body: any,
    method: "post" | "patch" | "put" = "post",
  ) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    const signature = JSON.stringify([path, body, method]),
      key = keys.current.get(signature) ?? crypto.randomUUID();
    keys.current.set(signature, key);
    try {
      const r: any = await api[method](path, { ...body, requestKey: key });
      keys.current.delete(signature);
      setNotice("已保存");
      return r;
    } catch (e) {
      setError(errorText(e));
      return undefined;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return {
    busy,
    write,
    notices: (
      <>
        <Notice text={error} />
        <Notice text={notice} tone="info" />
      </>
    ),
  };
}
export function AiLink({
  type,
  id,
  children,
}: {
  type?: string;
  id?: string;
  children?: ReactNode;
}) {
  const c = useMes(),
    location = useLocation();
  return c.can("mes.ai.use") ? (
    <Link
      className="button"
      to={
        c.prefix +
        "/ai?" +
        new URLSearchParams({
          ...(type ? { type } : {}),
          ...(id ? { id } : {}),
          returnTo: location.pathname + location.search,
        })
      }
    >
      {children ?? "询问AI"}
    </Link>
  ) : null;
}
export function useList(type: string) {
  const c = useMes(),
    [params, setParams] = useSearchParams(),
    [q, setQ] = useState(params.get("q") ?? ""),
    page = Math.max(1, Number(params.get("page")) || 1),
    status = params.get("status") ?? "";
  useEffect(() => setQ(params.get("q") ?? ""), [params.get("q")]);
  const d = useApiData<any>(
    c.base +
      "/" +
      type +
      "?" +
      new URLSearchParams({
        q: params.get("q") ?? "",
        page: String(page),
        ...(status ? { status } : {}),
      }),
  );
  const update = (values: Record<string, string>) => {
    setParams(values);
  };
  useEffect(() => {
    if (d.data && page > 1 && page > Math.max(1, Math.ceil(d.data.total / 20)))
      update({
        q: params.get("q") ?? "",
        status,
        page: String(Math.max(1, Math.ceil(d.data.total / 20))),
      });
  }, [d.data, page]);
  return {
    ...d,
    q,
    status,
    filters: (
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q, status, page: "1" });
        }}
      >
        <input
          aria-label="搜索"
          placeholder="搜索"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {type !== "materials" && (
          <select
            aria-label="状态"
            value={status}
            onChange={(e) =>
              update({
                q: params.get("q") ?? "",
                status: e.target.value,
                page: "1",
              })
            }
          >
            <option value="">全部状态</option>
            {(type === "boms"
              ? ["draft", "published", "archived"]
              : type === "plans"
                ? ["draft", "released", "completed", "cancelled"]
                : type === "orders"
                  ? ["ready", "in_progress", "completed", "cancelled"]
                  : ["pending", "approved", "rejected"]
            ).map((s) => (
              <option value={s} key={s}>
                {labels[s]}
              </option>
            ))}
          </select>
        )}
        <button type="submit">查询</button>
        <button
          type="button"
          onClick={() => {
            setQ("");
            update({});
          }}
        >
          重置
        </button>
      </form>
    ),
    pager: d.data ? (
      <Pager
        page={page}
        total={d.data.total}
        size={20}
        onPage={(p) =>
          update({ q: params.get("q") ?? "", status, page: String(p) })
        }
      />
    ) : null,
  };
}
export function Picker({
  label,
  type,
  value,
  onChange,
  kind,
  status,
  selectedLabel,
}: {
  label: string;
  type: "materials" | "boms";
  value: string;
  onChange: (v: any) => void;
  kind?: string;
  status?: string;
  selectedLabel?: string;
}) {
  const c = useMes(),
    [q, setQ] = useState(""),
    [search, setSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearch(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const d = useApiData<any>(
    c.base +
      "/" +
      type +
      "?" +
      new URLSearchParams({
        q: search,
        page_size: "50",
        ...(type === "materials" ? { active: "true" } : {}),
        ...(kind ? { kind } : {}),
        ...(status ? { status } : {}),
      }),
  );
  return (
    <Field label={label}>
      <input
        aria-label={"搜索" + label}
        placeholder={"搜索" + label}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <select
        aria-label={label}
        required
        value={value}
        onChange={(e) =>
          onChange(d.data?.items.find((x: any) => x.id === e.target.value))
        }
      >
        <option value="">请选择</option>
        {value && !d.data?.items.some((x: any) => x.id === value) && (
          <option value={value}>{selectedLabel ?? "当前选择"}</option>
        )}
        {d.data?.items.map((x: any) => (
          <option value={x.id} key={x.id}>
            {type === "materials"
              ? `${x.sku} · ${x.name} (${x.unit})`
              : `${x.productSku} · ${x.productName} v${x.revision}`}
          </option>
        ))}
      </select>
      <Notice text={d.error} />
      {d.data?.total > 50 && <span className="muted">输入关键词缩小范围</span>}
    </Field>
  );
}
export function useLeaveGuard(dirty: boolean) {
  const allow = useRef(false);
  useEffect(() => {
    const f = (e: BeforeUnloadEvent) => {
      if (dirty && !allow.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, [dirty]);
  const block = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !allow.current &&
      dirty &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  );
  return {
    allow: () => {
      allow.current = true;
    },
    dialog: (
      <ConfirmDialog
        open={block.state === "blocked"}
        title="放弃尚未保存的修改？"
        cancelLabel="继续编辑"
        description="离开后只保留已保存的版本。"
        confirmLabel="放弃修改并离开"
        onCancel={() => block.state === "blocked" && block.reset()}
        onConfirm={() => block.state === "blocked" && block.proceed()}
      />
    ),
  };
}
export { api };
