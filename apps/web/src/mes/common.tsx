import { DropdownSelect } from '@suite/frontend/components';
import { PagedCollection } from '../components';
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
  DataResult,
  EntitySelect,
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
export function Table({headers,children,paginate=false,pagination}:{headers:string[];children:ReactNode;paginate?:boolean;pagination?:{page:number;total:number;size:number;onPage:(page:number)=>void}}){const content=<table><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table>;return paginate||pagination?<PagedCollection label={headers[0]+'分页'} pagination={pagination}>{content}</PagedCollection>:<div className="table-wrap">{content}</div>;}
export function Result(props: any) { return <DataResult {...props}/>; }
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
export function useList(type: string, { defaultStatus = "" } = {}) {
  const c = useMes(),
    [params, setParams] = useSearchParams(),
    [q, setQ] = useState(params.get("q") ?? ""),
    page = Math.max(1, Number(params.get("page")) || 1),
    status = params.get("status") ?? defaultStatus;
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
          <DropdownSelect
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
          </DropdownSelect>
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
export function Picker({label,type,value,onChange,kind,status,selectedLabel}:{label:string;type:'materials'|'boms';value:string;onChange:(value:any)=>void;kind?:string;status?:string;selectedLabel?:string}) {
  const c=useMes(),params=new URLSearchParams({...(type==='materials'?{active:'true'}:{}),...(kind?{kind}:{}),...(status?{status}:{})});
  return <EntitySelect<any> label={label} required value={value} selectedLabel={selectedLabel} path={`${c.base}/${type}?${params}`} format={item=>type==='materials'?`${item.sku} · ${item.name} (${item.unit})`:`${item.productSku} · ${item.productName} v${item.revision}`} onChange={(_,item)=>onChange(item)}/>;
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
