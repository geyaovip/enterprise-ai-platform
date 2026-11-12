import { DropdownSelect } from '@suite/frontend/components';
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Link,
  Route,
  Routes,
  useNavigate,
  useParams,
  useLocation,
  useSearchParams,
  Navigate,
} from "react-router-dom";
import { api, errorText, tenantApi } from "../api";
import { useApiData } from "../hooks";
import {
  PageTitle,
  Field,
  Notice,
  Dialog,
  DialogAction,
  Empty,
  Loading,
  Pager,
  DataResult,
  RecordActions,
  InfoTip,
  ConfirmDialog,
  SectionTabs,
  ChevronDown,
  Download,
  FolderOpen,
  Search,
} from "../components";
import "./geo.css";
const money = (v: number | null | undefined) =>
  v === null || v === undefined
    ? "待核实"
    : `¥${(v / 1000000).toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
const labels: Record<string, string> = {
  queued: "待执行",
  running: "执行中",
  completed: "已完成",
  partially_completed: "部分完成",
  failed: "失败",
  cancelled: "已停止",
  needs_review: "结果待核实",
  outcome_unknown: "结果未知",
  succeeded: "成功",
  skipped: "已跳过",
  pending: "待执行",
  submitted: "已提交",
  dead_letter: "重试已停止",
  open: "待处理",
  in_progress: "进行中",
  done: "已完成",
};
const state = (s: string) => labels[s] ?? s;
const split = (s: string) =>
  s
    .split(/[,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
const key = () => crypto.randomUUID();
export const geoNavigation = [
  ["", "品牌项目", "geo.read"],
  ["analyses", "分析任务", "geo.read"],
  ["settings", "模型与权限", "geo.settings.manage"],
] as const;
function useGeo(tenantKey: string) {
  return (path: string) => tenantApi(tenantKey, "/apps/geo" + path);
}
function useAction() {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState<string | null>(null),
    lock = useRef(false);
  return {
    busy,
    message,
    setMessage,
    run: async (fn: () => Promise<unknown>) => {
      if (lock.current) return;
      lock.current = true;
      setBusy(true);
      setMessage(null);
      try {
        await fn();
      } catch (e) {
        setMessage(errorText(e));
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
  };
}
function compatiblePairs(
  questions: any[],
  models: any[],
  questionIds: string[],
  modelIds: string[],
) {
  const selected = questions.filter((question) =>
    questionIds.includes(question.id),
  );
  const available = models.filter((model) => modelIds.includes(model.id));
  return selected.flatMap((question) =>
    available.map(
      (model) => !question.nativeWebSearch || model.nativeWebSearch,
    ),
  );
}
function modelOptions(models: any[], questions: any[], questionIds: string[]) {
  const selected = questions.filter((question) =>
    questionIds.includes(question.id),
  );
  return models
    .filter((model) => model.enabled)
    .map((model) => {
      const supported = selected.filter(
        (question) => !question.nativeWebSearch || model.nativeWebSearch,
      ).length;
      return {
        ...model,
        disabled: selected.length > 0 && supported === 0,
        detail:
          selected.length && supported < selected.length
            ? `支持 ${supported}/${selected.length} 个所选问题`
            : undefined,
      };
    });
}
const SAMPLE_SOURCE = "模型 API 抽样 · 不代表消费端 App 排名";
function sampleValue(
  rate: number | null,
  samples: number,
  diagnostic: boolean,
  count?: number,
) {
  if (rate === null || samples === 0) return "—";
  return diagnostic
    ? `${count ?? Math.round((rate * samples) / 100)}/${samples} 条`
    : `${rate}%`;
}
function CheckList({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: any[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <fieldset className="geo-checklist">
      <legend>{label}</legend>
      {items.length ? (
        items.map((x) => (
          <label key={x.id}>
            <input
              type="checkbox"
              checked={value.includes(x.id)}
              disabled={x.disabled && !value.includes(x.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...value, x.id]
                    : value.filter((id) => id !== x.id),
                )
              }
            />
            <span>
              {x.name ?? x.text}
              {x.nativeWebSearch ? " · 联网" : ""}
              {x.detail && <small>{x.detail}</small>}
            </span>
          </label>
        ))
      ) : (
        <p>暂无可选{label}</p>
      )}
    </fieldset>
  );
}
function SectionHead({
  title,
  info,
  action,
}: {
  title: string;
  info?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="geo-section-head">
      <div className="geo-section-label">
        <h2>{title}</h2>
        {info}
      </div>
      {action}
    </div>
  );
}
function GeoState({ value }: { value: string }) {
  return <span className={`geo-state geo-state-${value}`}>{state(value)}</span>;
}
function Stat({ title, value }: { title: string; value: ReactNode }) {
  return (
    <div className="panel geo-stat">
      <span>{title}</span>
      <strong>{value}</strong>
    </div>
  );
}
function ProjectList({
  tenantKey,
  permissions,
}: {
  tenantKey: string;
  permissions: string[];
}) {
  const url = useGeo(tenantKey),
    [page, setPage] = useState(1),
    [q, setQ] = useState(""),
    [search, setSearch] = useState("");
  const query = useApiData<any>(
    url(`/projects?page=${page}&q=${encodeURIComponent(q)}`),
  );
  const a = useAction(),
    [editing, setEditing] = useState<any>(null);
  const can = permissions.includes("geo.project.manage");
  return (
    <>
      <PageTitle
        title="品牌项目"
        action={
          can ? (
            <button className="primary" onClick={() => setEditing({})}>
              新建项目
            </button>
          ) : undefined
        }
      />
      <Notice text={a.message} />
      <section className="panel">
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setQ(search);
          }}
        >
          <input
            aria-label="搜索项目或品牌"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索项目或品牌"
          />
          <button type="submit">
            <Search size={16} aria-hidden="true" />
            搜索
          </button>
        </form>
        <DataResult {...query}>
          {!query.data?.items.length ? (
            <Empty text={q ? "没有找到匹配的项目" : "暂无品牌项目"} />
          ) : (
            <ul className="geo-records">
              {query.data.items.map((p: any) => (
                <li key={p.id}>
                  <div>
                    <Link
                      className="geo-project-link"
                      to={`/t/${tenantKey}/geo/projects/${p.id}`}
                    >
                      <FolderOpen size={17} aria-hidden="true" />
                      {p.name}
                    </Link>
                    {(p.brandName !== p.name || !p.active) && (
                      <small>
                        {p.brandName !== p.name ? p.brandName : ""}
                        {!p.active ? " · 已归档" : ""}
                      </small>
                    )}
                  </div>
                  {can && (
                    <RecordActions label={p.name}>
                      <button onClick={() => setEditing(p)}>编辑</button>
                    </RecordActions>
                  )}
                </li>
              ))}
            </ul>
          )}
        </DataResult>
        {query.data && query.data.total > query.data.page_size && (
          <Pager
            page={page}
            total={query.data.total}
            size={query.data.page_size}
            onPage={setPage}
          />
        )}
      </section>
      {editing && (
        <ProjectForm
          value={editing}
          busy={a.busy}
          message={a.message}
          close={() => setEditing(null)}
          save={(v) =>
            a.run(async () => {
              if (editing.id)
                await api.put(url("/projects/" + editing.id), {
                  ...v,
                  version: editing.version,
                });
              else await api.post(url("/projects"), v);
              setEditing(null);
              await query.reload();
            })
          }
        />
      )}
    </>
  );
}
function ProjectForm({
  value,
  busy,
  message,
  save,
  close,
}: {
  value: any;
  busy: boolean;
  message: string | null;
  save: (v: any) => void;
  close: () => void;
}) {
  const [v, setV] = useState({
    name: value.name ?? "",
    brandName: value.brandName ?? "",
    aliases: (value.aliases ?? []).join("，"),
    competitors: (value.competitors ?? []).join("，"),
    website: value.website ?? "",
    country: value.country ?? "CN",
    language: value.language ?? "zh-CN",
    timezone: value.timezone ?? "Asia/Shanghai",
    active: value.active ?? true,
  });
  return (
    <Dialog
      open
      title={value.id ? "编辑项目" : "新建品牌项目"}
      onClose={close}
      busy={busy}
      dirtyCheck
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save({
            ...v,
            aliases: split(v.aliases),
            competitors: split(v.competitors),
            website: v.website || null,
          });
        }}
      >
        <Notice text={message} />
        <div className="form-grid">
          {[
            ["name", "项目名称"],
            ["brandName", "品牌名称"],
            ["aliases", "品牌别名（逗号分隔）"],
            ["competitors", "确认竞品（逗号分隔）"],
            ["website", "官方网站"],
            ["country", "国家/地区代码"],
            ["language", "语言"],
            ["timezone", "时区"],
          ].map(([k, label]) => (
            <Field key={k} label={label}>
              <input
                required={!["aliases", "competitors", "website"].includes(k)}
                maxLength={
                  k === "website"
                    ? 2000
                    : k === "aliases" || k === "competitors"
                      ? 2000
                      : 120
                }
                value={(v as any)[k]}
                onChange={(e) => setV({ ...v, [k]: e.target.value })}
              />
            </Field>
          ))}
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={v.active}
            onChange={(e) => setV({ ...v, active: e.target.checked })}
          />
          启用项目
        </label>
        {!v.active && (
          <p className="geo-consequence">
            归档后不能发起分析，监测将跳过该项目。历史报告保留。
          </p>
        )}
        <DialogAction>
          <button className="primary" disabled={busy}>
            保存项目
          </button>
        </DialogAction>
      </form>
    </Dialog>
  );
}
function AnalysisList({
  tenantKey,
  projectId,
}: {
  tenantKey: string;
  projectId?: string;
}) {
  const url = useGeo(tenantKey),
    [page, setPage] = useState(1),
    location = useLocation(),
    navigate = useNavigate();
  const selected = new URLSearchParams(location.search).get("task");
  useEffect(() => {
    if (!selected || !/^[0-9a-f-]{36}$/i.test(selected)) return;
    let alive = true;
    api
      .get<any>(url("/analyses/" + selected))
      .then((a) => {
        if (alive)
          navigate(
            `/t/${tenantKey}/geo/projects/${a.projectId}/analyses/${a.id}`,
            { replace: true },
          );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [selected, tenantKey]);
  const query = useApiData<any>(
    url(
      projectId
        ? `/projects/${projectId}/analyses?page=${page}`
        : `/analyses?page=${page}`,
    ),
  );
  useEffect(() => {
    if (
      !query.data?.items.some((x: any) =>
        ["queued", "running"].includes(x.status),
      )
    )
      return;
    const timer = setInterval(() => {
      if (!document.hidden) void query.reload();
    }, 4000);
    return () => clearInterval(timer);
  }, [query.data, query.reload]);
  return (
    <section className="panel">
      <DataResult {...query}>
        {!query.data?.items.length ? (
          <Empty text="还没有分析任务" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{projectId ? "分析时间" : "项目 / 时间"}</th>
                  <th>状态</th>
                  <th>预估费用</th>
                  <th>实际费用</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((x: any) => (
                  <tr key={x.id}>
                    <td>
                      {!projectId && <strong>{x.project.name}</strong>}
                      {projectId ? (
                        new Date(x.createdAt).toLocaleString("zh-CN")
                      ) : (
                        <small>
                          {new Date(x.createdAt).toLocaleString("zh-CN")}
                        </small>
                      )}
                    </td>
                    <td>
                      <GeoState value={x.status} />
                    </td>
                    <td>{money(x.estimatedCostMicros)}</td>
                    <td>
                      {x.actualCostMicros === null
                        ? ["queued", "running"].includes(x.status)
                          ? "待结算"
                          : "待核实"
                        : money(x.actualCostMicros)}
                    </td>
                    <td>
                      <Link
                        to={`/t/${tenantKey}/geo/projects/${x.projectId}/analyses/${x.id}`}
                      >
                        {["queued", "running"].includes(x.status)
                          ? "查看任务"
                          : "查看报告"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataResult>
      {query.data && query.data.total > query.data.page_size && (
        <Pager
          page={page}
          total={query.data.total}
          size={query.data.page_size}
          onPage={setPage}
        />
      )}
    </section>
  );
}
export function GeoTaskPanel({ tenantKey }: { tenantKey: string }) {
  const catalog = useApiData<any[]>(tenantApi(tenantKey, "/applications"));
  const hasGeo = catalog.data?.some(
    (x) => x.appId === "geo" && x.permissions.includes("geo.read"),
  );
  return hasGeo ? <GeoTaskLists tenantKey={tenantKey} /> : null;
}
function GeoTaskLists({ tenantKey }: { tenantKey: string }) {
  const url = useGeo(tenantKey);
  const tasks = useApiData<any[]>(url("/optimizations/mine"));
  return (
    <>
      {Boolean(tasks.data?.length) && (
        <section className="panel geo-task-panel">
          <h2>我的 GEO 优化任务</h2>
          <ul className="geo-records">
            {tasks.data?.map((task) => (
              <li key={task.id}>
                <div>
                  <Link
                    to={`/t/${tenantKey}/geo/projects/${task.project.id}/optimizations?task=${task.id}`}
                  >
                    {task.title}
                  </Link>
                  <small>
                    {task.project.name} · {state(task.status)}
                    {task.dueAt
                      ? " · " + new Date(task.dueAt).toLocaleDateString("zh-CN")
                      : ""}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="geo-task-panel">
        <h2>GEO 分析任务</h2>
        <AnalysisList tenantKey={tenantKey} />
      </section>
    </>
  );
}
function ProjectDetail({
  tenantKey,
  permissions,
}: {
  tenantKey: string;
  permissions: string[];
}) {
  const { projectId = "" } = useParams(),
    url = useGeo(tenantKey),
    location = useLocation(),
    navigate = useNavigate();
  const p = useApiData<any>(url("/projects/" + projectId)),
    questions = useApiData<any[]>(url(`/projects/${projectId}/questions`)),
    models = useApiData<any[]>(url("/models"));
  const [editing, setEditing] = useState<any>(null),
    [analyze, setAnalyze] = useState<any>(null),
    [templates, setTemplates] = useState(false),
    [batchNote, setBatchNote] = useState(""),
    [taskDraft, setTaskDraft] = useState<any>(null),
    [scheduleDraft, setScheduleDraft] = useState<any>(null),
    a = useAction();
  const can = (s: string) => permissions.includes(s);
  const prefix = `/t/${tenantKey}/geo/projects/${projectId}`;
  const setupLink = `/t/${tenantKey}/geo/settings?project=${projectId}`;
  const atQuestions = location.pathname === prefix;
  const atHistory = location.pathname === prefix + "/analyses";
  const hasQuestions = questions.data?.some((q) => q.enabled);
  const hasModels = models.data?.some((model) => model.enabled);
  return (
    <>
      <PageTitle
        title={p.data?.name ?? "品牌项目"}
        back={
          location.pathname.includes("/analyses/") ? (
            <Link to={prefix + "/analyses"}>返回分析报告</Link>
          ) : (
            <Link to={`/t/${tenantKey}/geo`}>返回项目</Link>
          )
        }
        action={
          p.data?.active && (atQuestions || atHistory) ? (
            atQuestions &&
            questions.data &&
            !hasQuestions &&
            can("geo.project.manage") ? (
              <button className="primary" onClick={() => setEditing({})}>
                添加问题
              </button>
            ) : hasQuestions && can("geo.analysis.run") ? (
              hasModels === false ? (
                can("geo.settings.manage") ? (
                  <Link className="button primary" to={setupLink}>
                    配置模型
                  </Link>
                ) : (
                  <button
                    onClick={() =>
                      void a.run(async () => {
                        await navigator.clipboard.writeText(
                          new URL(setupLink, window.location.origin).href,
                        );
                        setBatchNote("已复制模型配置链接，请发给企业管理员。");
                      })
                    }
                  >
                    复制配置链接
                  </button>
                )
              ) : (
                <button
                  className="primary"
                  disabled={!hasModels}
                  onClick={() => setAnalyze({})}
                >
                  开始分析
                </button>
              )
            ) : undefined
          ) : undefined
        }
      />
      <DataResult {...p}>
        {p.data && (
          <>
            <div className="geo-project-summary">
              {p.data.brandName !== p.data.name && (
                <span>{p.data.brandName}</span>
              )}
              {!p.data.active && <span className="geo-state">已归档</span>}
              <InfoTip label="项目范围">
                地区 {p.data.country} · 语言 {p.data.language} · 时区{" "}
                {p.data.timezone}
              </InfoTip>
            </div>
            <nav className="tabs geo-tabs" aria-label="项目导航">
              {[
                ["", "问题", "问题"],
                ["analyses", "分析报告", "报告"],
                ["insights", "数据洞察", "洞察"],
                ["schedules", "自动监测", "监测"],
                ["optimizations", "优化复测", "复测"],
              ].map(([path, label, short]) => (
                <Link
                  key={path}
                  aria-label={label}
                  className={
                    location.pathname === prefix + (path ? "/" + path : "") ||
                    (path === "analyses" &&
                      location.pathname.startsWith(prefix + "/analyses/"))
                      ? "active"
                      : ""
                  }
                  aria-current={
                    location.pathname === prefix + (path ? "/" + path : "") ||
                    (path === "analyses" &&
                      location.pathname.startsWith(prefix + "/analyses/"))
                      ? "page"
                      : undefined
                  }
                  to={prefix + (path ? "/" + path : "")}
                >
                  {short}
                </Link>
              ))}
            </nav>
            <Notice text={a.message} />
            {batchNote && (
              <p className="geo-inline-meta" role="status">
                {batchNote}
              </p>
            )}
            {hasQuestions &&
              hasModels === false &&
              !can("geo.settings.manage") && (
                <p className="geo-consequence">
                  暂无可用模型，请企业管理员配置。
                </p>
              )}
            <Routes>
              <Route
                index
                element={
                  <>
                    <section className="panel">
                      <SectionHead
                        title="监测问题"
                        action={
                          can("geo.project.manage") ? (
                            <>
                              <button
                                onClick={() => {
                                  setBatchNote("");
                                  setTemplates(true);
                                }}
                              >
                                使用问题模板
                              </button>
                              {hasQuestions && (
                                <button onClick={() => setEditing({})}>
                                  添加问题
                                </button>
                              )}
                            </>
                          ) : undefined
                        }
                      />
                      <DataResult {...questions}>
                        {questions.data?.length ? (
                          <ul className="geo-records">
                            {questions.data.map((q) => (
                              <li key={q.id}>
                                <div>
                                  <strong>{q.text}</strong>
                                  <small>
                                    {q.category} ·{" "}
                                    {q.nativeWebSearch ? "原生联网" : "不联网"}{" "}
                                    · {q.enabled ? "启用" : "停用"}
                                  </small>
                                </div>
                                {can("geo.project.manage") && (
                                  <RecordActions label={q.text}>
                                    <button
                                      aria-label={`编辑问题：${q.text}`}
                                      onClick={() => setEditing(q)}
                                    >
                                      编辑
                                    </button>
                                  </RecordActions>
                                )}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <Empty text="暂无监测问题" />
                        )}
                      </DataResult>
                    </section>
                  </>
                }
              />
              <Route
                path="analyses"
                element={
                  <AnalysisList tenantKey={tenantKey} projectId={projectId} />
                }
              />
              <Route
                path="analyses/:analysisId"
                element={
                  <Report
                    tenantKey={tenantKey}
                    permissions={permissions}
                    onRetest={setAnalyze}
                    onNewBaseline={() => setAnalyze({})}
                    onOptimize={(draft) => {
                      setTaskDraft(draft);
                      navigate(prefix + "/optimizations");
                    }}
                    onSchedule={(draft) => {
                      setScheduleDraft(draft);
                      navigate(prefix + "/schedules");
                    }}
                  />
                }
              />
              <Route
                path="insights"
                element={
                  <Insights
                    tenantKey={tenantKey}
                    projectId={projectId}
                    models={models.data ?? []}
                    questions={questions.data ?? []}
                  />
                }
              />
              <Route
                path="schedules"
                element={
                  <Schedules
                    tenantKey={tenantKey}
                    project={p.data}
                    draft={scheduleDraft}
                    clearDraft={() => setScheduleDraft(null)}
                    questions={questions.data ?? []}
                    models={models.data ?? []}
                    permissions={permissions}
                  />
                }
              />
              <Route
                path="optimizations"
                element={
                  <Optimizations
                    tenantKey={tenantKey}
                    projectId={projectId}
                    permissions={permissions}
                    onRetest={setAnalyze}
                    draft={taskDraft}
                    clearDraft={() => setTaskDraft(null)}
                  />
                }
              />
            </Routes>
          </>
        )}
      </DataResult>
      {templates && (
        <QuestionTemplates
          brand={p.data?.brandName ?? ""}
          busy={a.busy}
          message={a.message}
          close={() => setTemplates(false)}
          save={(items) =>
            void a.run(async () => {
              const result = await api.post<{
                added: number;
                duplicates: number;
              }>(url(`/projects/${projectId}/questions/batch`), items);
              setTemplates(false);
              setBatchNote(
                `已添加 ${result.added} 条问题${result.duplicates ? `，跳过 ${result.duplicates} 条重复问法` : ""}。`,
              );
              await questions.reload();
            })
          }
        />
      )}
      {editing && (
        <QuestionForm
          value={editing}
          busy={a.busy}
          message={a.message}
          close={() => setEditing(null)}
          save={(v) =>
            a.run(async () => {
              if (editing.id)
                await api.put(
                  url(`/projects/${projectId}/questions/${editing.id}`),
                  { ...v, version: editing.version },
                );
              else await api.post(url(`/projects/${projectId}/questions`), v);
              setEditing(null);
              await questions.reload();
            })
          }
        />
      )}
      {analyze && (
        <AnalyzeForm
          tenantKey={tenantKey}
          projectId={projectId}
          questions={questions.data ?? []}
          models={models.data ?? []}
          baseline={analyze.baseline}
          optimizationId={analyze.optimizationId}
          close={() => setAnalyze(null)}
          submitted={(id) => {
            setAnalyze(null);
            navigate(prefix + "/analyses/" + id);
          }}
        />
      )}
    </>
  );
}
function QuestionTemplates({
  brand,
  busy,
  message,
  close,
  save,
}: {
  brand: string;
  busy: boolean;
  message: string | null;
  close: () => void;
  save: (
    items: { text: string; category: string; nativeWebSearch: boolean }[],
  ) => void;
}) {
  const examples: Record<string, string[]> = {
    品类推荐: [
      "有哪些值得考虑的［品类］品牌？",
      "预算有限的用户选［品类］时，有哪些推荐？",
    ],
    选购比较: [
      "选购［品类］时，应该比较哪些指标？",
      "针对［使用场景］，有哪些适合的［品类］产品？",
    ],
    品牌核查: [
      `${brand} 提供哪些产品或服务？`,
      `${brand} 的售后政策是什么？可以在哪里核实？`,
    ],
  };
  const [category, setCategory] = useState("品类推荐");
  const [text, setText] = useState(() => examples["品类推荐"]!.join("\n"));
  const [web, setWeb] = useState(false);
  const lines = text
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const canSave =
    lines.length > 0 &&
    lines.length <= 32 &&
    lines.every(
      (line) =>
        line.length >= 2 && line.length <= 1000 && !/[［］]/u.test(line),
    );
  return (
    <Dialog
      open
      title="批量添加监测问题"
      busy={busy}
      onClose={close}
      dirtyCheck
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave)
            save(
              lines.map((line) => ({
                text: line,
                category,
                nativeWebSearch: web,
              })),
            );
        }}
      >
        <Notice text={message} />
        <Field label="问题分组">
          <DropdownSelect
            value={category}
            onChange={(event) => {
              const next = event.target.value;
              setCategory(next);
              setText(examples[next]!.join("\n"));
            }}
          >
            {Object.keys(examples).map((label) => (
              <option key={label}>{label}</option>
            ))}
          </DropdownSelect>
        </Field>
        <Field label="监测问题（每行一条，最多 32 条）">
          <textarea
            required
            rows={6}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        {/[［］]/u.test(text) && (
          <p className="geo-consequence">
            请把方括号里的品类或场景换成实际内容。
          </p>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={web}
            onChange={(event) => setWeb(event.target.checked)}
          />
          要求模型原生联网
        </label>
        <DialogAction>
          <button className="primary" disabled={busy || !canSave}>
            添加 {lines.length} 条问题
          </button>
        </DialogAction>
      </form>
    </Dialog>
  );
}
function QuestionForm({
  value,
  busy,
  message,
  close,
  save,
}: {
  value: any;
  busy: boolean;
  message: string | null;
  close: () => void;
  save: (v: any) => void;
}) {
  const [v, setV] = useState({
    text: value.text ?? "",
    category: value.category ?? "品牌认知",
    nativeWebSearch: value.nativeWebSearch ?? false,
    enabled: value.enabled ?? true,
  });
  return (
    <Dialog
      open
      title={value.id ? "编辑问题" : "添加问题"}
      onClose={close}
      busy={busy}
      dirtyCheck
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(v);
        }}
      >
        <Notice text={message} />
        <Field label="监测问题">
          <textarea
            rows={4}
            required
            minLength={2}
            maxLength={1000}
            value={v.text}
            onChange={(e) => setV({ ...v, text: e.target.value })}
          />
        </Field>
        <Field label="问题分组">
          <input
            required
            maxLength={50}
            value={v.category}
            onChange={(e) => setV({ ...v, category: e.target.value })}
          />
        </Field>
        <label className="check">
          <input
            type="checkbox"
            checked={v.nativeWebSearch}
            onChange={(e) => setV({ ...v, nativeWebSearch: e.target.checked })}
          />
          要求模型原生联网
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={v.enabled}
            onChange={(e) => setV({ ...v, enabled: e.target.checked })}
          />
          启用问题
        </label>
        <DialogAction>
          <button className="primary" disabled={busy}>
            保存问题
          </button>
        </DialogAction>
      </form>
    </Dialog>
  );
}
function AnalyzeForm({
  tenantKey,
  projectId,
  questions,
  models,
  baseline,
  optimizationId,
  close,
  submitted,
}: {
  tenantKey: string;
  projectId: string;
  questions: any[];
  models: any[];
  baseline?: any;
  optimizationId?: string;
  close: () => void;
  submitted: (id: string) => void;
}) {
  const url = useGeo(tenantKey),
    [questionIds, setQuestions] = useState<string[]>(
      baseline?.snapshot.questions.map((q: any) => q.id) ??
        questions
          .filter((q) => q.enabled)
          .slice(0, 8)
          .map((q) => q.id),
    ),
    [modelIds, setModels] = useState<string[]>(
      baseline?.snapshot.models.map((m: any) => m.id) ??
        modelOptions(
          models,
          questions,
          questions
            .filter((q) => q.enabled)
            .slice(0, 8)
            .map((q) => q.id),
        )
          .filter((m) => !m.disabled)
          .map((m) => m.id),
    ),
    [max, setMax] = useState("1"),
    [estimate, setEstimate] = useState<any>(null),
    a = useAction(),
    requestKey = useRef(key());
  const pairs = compatiblePairs(questions, models, questionIds, modelIds);
  const eligible = pairs.filter(Boolean).length;
  const body = {
    questionIds,
    modelIds,
    maxCostMicros: Math.round(Number(max) * 1000000),
    ...(baseline ? { baselineId: baseline.id } : {}),
    ...(optimizationId ? { optimizationId } : {}),
  };
  const change = (fn: () => void) => {
    fn();
    setEstimate(null);
    requestKey.current = key();
  };
  return (
    <Dialog
      open
      title={baseline ? "同条件复测" : "开始品牌分析"}
      onClose={close}
      busy={a.busy}
      dirtyCheck
      size="large"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!baseline && !eligible) return;
          void a.run(async () =>
            setEstimate(
              await api.post(url(`/projects/${projectId}/estimate`), body),
            ),
          );
        }}
      >
        <Notice text={a.message} />
        {baseline ? (
          <div className="geo-inline-meta">
            <strong>沿用基线条件</strong>
            <InfoTip label="复测条件">
              使用基线保存的问题、模型版本、地域及联网条件。
            </InfoTip>
          </div>
        ) : (
          <div className="form-grid">
            <CheckList
              label="问题"
              items={questions.filter((q) => q.enabled)}
              value={questionIds}
              onChange={(v) => change(() => setQuestions(v))}
            />
            <CheckList
              label="模型"
              items={modelOptions(models, questions, questionIds)}
              value={modelIds}
              onChange={(v) => change(() => setModels(v))}
            />
          </div>
        )}
        {baseline?.retestComparisonBlock && (
          <p className="geo-consequence">{baseline.retestComparisonBlock}</p>
        )}
        {!baseline && !estimate && questionIds.length > 0 && (
          <p className="geo-inline-meta" role="status">
            {eligible
              ? `${eligible} 个可执行组合${pairs.length > eligible ? `，${pairs.length - eligible} 个因联网条件跳过` : ""}`
              : "当前没有兼容组合，请调整问题或模型。"}
          </p>
        )}
        <Field label="单次预估上限（元）">
          <input
            required
            type="number"
            step="0.01"
            min="0.01"
            max="100"
            value={max}
            onChange={(e) => change(() => setMax(e.target.value))}
          />
        </Field>
        {estimate && (
          <section className="panel geo-estimate">
            <strong>预估 {money(estimate.estimatedCostMicros)}</strong>
            <p>
              {estimate.eligibleRuns} 个可执行组合
              {estimate.skippedRuns
                ? `，${estimate.skippedRuns} 个组合不支持所需联网能力，将跳过`
                : ""}
              。按实际用量结算，费用可能高于预估。
            </p>
          </section>
        )}
        <DialogAction>
          {estimate ? (
            <button
              className="primary"
              type="button"
              disabled={a.busy}
              onClick={() =>
                void a.run(async () => {
                  const job = await api.post<any>(
                    url(`/projects/${projectId}/analyses`),
                    {
                      ...body,
                      requestKey: requestKey.current,
                      estimateHash: estimate.estimateHash,
                    },
                  );
                  submitted(job.id);
                })
              }
            >
              确认费用并{baseline ? "复测" : "分析"}
            </button>
          ) : (
            <button
              className="primary"
              type="submit"
              disabled={a.busy || (!baseline && !eligible)}
            >
              预估费用
            </button>
          )}
        </DialogAction>
      </form>
    </Dialog>
  );
}
function Report({
  tenantKey,
  permissions,
  onRetest,
  onNewBaseline,
  onOptimize,
  onSchedule,
}: {
  tenantKey: string;
  permissions: string[];
  onRetest: (v: any) => void;
  onNewBaseline: () => void;
  onOptimize: (v: any) => void;
  onSchedule: (v: any) => void;
}) {
  const { analysisId = "" } = useParams(),
    url = useGeo(tenantKey),
    query = useApiData<any>(url("/analyses/" + analysisId)),
    a = useAction();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const askReport = new URLSearchParams({
    type: "analysis",
    id: analysisId,
    returnTo: location.pathname + location.search,
  });
  const answer = params.get("answer");
  const [filter, setFilter] = useState(""),
    [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    if (!["queued", "running"].includes(query.data?.status)) return;
    const t = setInterval(() => {
      if (!document.hidden) void query.reload();
    }, 3000);
    return () => clearInterval(t);
  }, [query.data?.status, query.reload]);
  const r = query.data,
    report = r?.report;
  const diagnostic = report?.score?.diagnosticOnly === true;
  useEffect(() => {
    if (!answer || !r?.runs.some((run: any) => run.id === answer)) return;
    setFilter("");
    setExpanded(answer);
    const frame = requestAnimationFrame(() => {
      const item = document.getElementById(`geo-answer-control-${answer}`);
      item?.focus({ preventScroll: true });
      item?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [answer, r?.id]);
  const showAnswer = (id: string) => {
    if (id === answer) {
      setFilter("");
      setExpanded(id);
      requestAnimationFrame(() =>
        document
          .getElementById(`geo-answer-control-${id}`)
          ?.scrollIntoView({ block: "center" }),
      );
    } else setParams({ answer: id }, { replace: true });
  };
  const [cancelPending, setCancelPending] = useState(false);
  const download = () =>
    void a.run(async () => {
      const response = await fetch(
        `/api/v1${url(`/analyses/${analysisId}/report.pdf`)}`,
        { credentials: "same-origin", signal: AbortSignal.timeout(30000) },
      );
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.error?.message ?? "PDF 下载失败，请重试");
      }
      if (!response.headers.get("content-type")?.startsWith("application/pdf"))
        throw new Error("未取得 PDF，请重试");
      const href = URL.createObjectURL(await response.blob()),
        link = document.createElement("a");
      link.href = href;
      link.download =
        response.headers
          .get("content-disposition")
          ?.match(/filename="(GEO-\d{4}-\d{2}-\d{2}\.pdf)"/)?.[1] ??
        "GEO-报告.pdf";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    });
  return (
    <>
      <Notice text={a.message} />
      <DataResult {...query}>
        {r && (
          <>
            <div className="geo-section-head geo-report-head">
              <div className="geo-section-label">
                <h2>分析报告</h2>
                <span role="status">
                  <GeoState value={r.status} />
                </span>
              </div>
              <div className="geo-report-actions">
                {report && permissions.includes("geo.ai.use") && (
                  <button type="button" onClick={() => navigate(`/t/${tenantKey}/geo/ai?${askReport}`)}>
                    解读报告
                  </button>
                )}
                {["queued", "running"].includes(r.status) &&
                  permissions.includes("geo.analysis.run") && (
                    <button
                      disabled={a.busy}
                      onClick={() => setCancelPending(true)}
                    >
                      停止调用
                    </button>
                  )}
                {report &&
                  permissions.includes("geo.analysis.run") &&
                  (r.retestVersionCurrent === false ? (
                    <button onClick={onNewBaseline}>建立新基线</button>
                  ) : (
                    <button onClick={() => onRetest({ baseline: r })}>
                      同条件复测
                    </button>
                  ))}
                {r.status === "completed" &&
                  report?.validSamples === report?.plannedSamples &&
                  permissions.includes("geo.monitor.manage") &&
                  permissions.includes("geo.analysis.run") && (
                    <button
                      onClick={() =>
                        onSchedule({
                          name: "品牌可见度监测",
                          frequency: "weekly",
                          questionIds: r.snapshot.questions.map(
                            (question: any) => question.id,
                          ),
                          modelIds: r.snapshot.models.map(
                            (model: any) => model.id,
                          ),
                          maxCostMicros: Math.max(
                            1000000,
                            Math.ceil(r.estimatedCostMicros / 10000) * 10000,
                          ),
                        })
                      }
                    >
                      设为监测计划
                    </button>
                  )}
                {report && (
                  <button
                    type="button"
                    className="primary"
                    disabled={a.busy}
                    onClick={download}
                  >
                    <Download size={16} aria-hidden="true" />
                    {a.busy ? "正在处理…" : "下载 PDF"}
                  </button>
                )}
              </div>
            </div>
            <dl className="geo-costs">
              <div>
                <dt>预估费用</dt>
                <dd>{money(r.estimatedCostMicros)}</dd>
              </div>
              <div>
                <dt>实际费用</dt>
                <dd>
                  {r.actualCostMicros === null
                    ? ["queued", "running"].includes(r.status)
                      ? "待结算"
                      : "待核实"
                    : money(r.actualCostMicros)}
                </dd>
              </div>
            </dl>
            {cancelPending && (
              <ConfirmDialog
                open
                title="停止分析？"
                description="将停止后续模型调用。已发出的请求仍可能产生费用，已取得的回答会保留。"
                cancelLabel="继续执行"
                confirmLabel="停止调用"
                busy={a.busy}
                error={a.message}
                confirmDisabled={!["queued", "running"].includes(r.status)}
                onCancel={() => setCancelPending(false)}
                onConfirm={() =>
                  void a.run(async () => {
                    await api.post(url(`/analyses/${r.id}/cancel`), {
                      version: r.version,
                    });
                    setCancelPending(false);
                    await query.reload();
                  })
                }
              />
            )}
            {report && (
              <>
                <div className="geo-inline-meta geo-report-scope">
                  <span>{SAMPLE_SOURCE}</span>
                  {diagnostic && (
                    <span className="geo-state geo-state-needs_review">
                      样本不足 · 仅供诊断
                    </span>
                  )}
                  {r.retestVersionCurrent === false && (
                    <span className="geo-state">旧口径</span>
                  )}
                </div>
                <div className="geo-stats">
                  <Stat
                    title={diagnostic ? "品牌提及" : "品牌提及率"}
                    value={sampleValue(
                      report.mentionRate,
                      report.validSamples,
                      diagnostic,
                      report.mentionedSamples,
                    )}
                  />
                  <Stat
                    title={diagnostic ? "品牌推荐" : "品牌推荐率"}
                    value={sampleValue(
                      report.recommendationRate,
                      report.validSamples,
                      diagnostic,
                      report.recommendedSamples,
                    )}
                  />
                  <Stat
                    title={diagnostic ? "样本内排名" : "平均排名"}
                    value={
                      report.averageRank === null
                        ? "—"
                        : report.averageRank.toFixed(1)
                    }
                  />
                  <Stat
                    title="有效回答"
                    value={`${report.validSamples}/${report.plannedSamples}`}
                  />
                </div>
                <div className="geo-report-context">
                  {report.score && !diagnostic && (
                    <span>
                      综合评分 <strong>{report.score.overallScore}</strong>
                    </span>
                  )}
                  {report.score && !diagnostic && (
                    <span>置信度 {report.score.confidence}%</span>
                  )}
                  <InfoTip label="指标口径">
                    {report.limitation} 排名仅统计有明确推荐顺序或位次的回答（
                    {report.rankSamples} 个样本）。
                  </InfoTip>
                  {r.comparison &&
                    (r.comparison.comparable ? (
                      <span>
                        基线分差{" "}
                        <strong>
                          {r.comparison.delta > 0 ? "+" : ""}
                          {r.comparison.delta}
                        </strong>
                      </span>
                    ) : (
                      <span className="geo-inline-meta">
                        暂不可比
                        <InfoTip label="不可比原因">
                          {r.comparison.reason}
                        </InfoTip>
                      </span>
                    ))}
                </div>
                {Boolean(report.opportunities?.length) && (
                  <section className="panel">
                    <h3>竞品出现、本品牌缺席的问题</h3>
                    <ul className="geo-records">
                      {report.opportunities.map((item: any) => (
                        <li key={item.questionId}>
                          <div>
                            <strong>{item.question}</strong>
                            <small>
                              {item.count} 条回答 ·{" "}
                              {item.competitors.join("、")}
                            </small>
                          </div>
                          <RecordActions label={item.question}>
                            <button onClick={() => showAnswer(item.runId)}>
                              查看证据
                            </button>
                          </RecordActions>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                <div className="form-grid">
                  <section className="panel">
                    <h3>{diagnostic ? "竞品提及" : "竞品提及率"}</h3>
                    {report.competitors.length ? (
                      <ul className="geo-records">
                        {report.competitors.map((c: any) => (
                          <li key={c.name}>
                            {c.name}
                            <span>
                              {sampleValue(
                                c.mentionRate,
                                report.validSamples,
                                diagnostic,
                                c.mentions,
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <Empty text="未配置确认竞品" />
                    )}
                  </section>
                  <section className="panel">
                    <h3>引用排行</h3>
                    {report.citations.length ? (
                      <ol>
                        {report.citations.slice(0, 20).map((c: any) => (
                          <li key={c.url}>
                            <a
                              href={c.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {c.title}
                            </a>{" "}
                            · {c.count} 次
                            {c.runIds?.[0] && (
                              <button
                                type="button"
                                className="geo-text-action"
                                onClick={() => showAnswer(c.runIds[0])}
                              >
                                查看回答
                              </button>
                            )}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <Empty text="暂无引用" />
                    )}
                  </section>
                </div>
              </>
            )}
            <section className="panel">
              <div className="geo-section-head geo-evidence-head">
                <h3>回答证据</h3>
                <Field label="回答状态">
                  <DropdownSelect
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="">全部状态</option>
                    {[
                      "queued",
                      "running",
                      "succeeded",
                      "failed",
                      "skipped",
                      "cancelled",
                      "outcome_unknown",
                    ].map((s) => (
                      <option key={s} value={s}>
                        {state(s)}
                      </option>
                    ))}
                  </DropdownSelect>
                </Field>
              </div>
              <ul className="geo-records">
                {r.runs
                  .filter((x: any) => !filter || x.status === filter)
                  .map((x: any) => (
                    <li className="geo-evidence" key={x.id}>
                      <button
                        id={`geo-answer-control-${x.id}`}
                        aria-expanded={expanded === x.id}
                        aria-controls={
                          expanded === x.id ? `geo-answer-${x.id}` : undefined
                        }
                        onClick={() =>
                          setExpanded(expanded === x.id ? null : x.id)
                        }
                      >
                        <span>
                          <strong>{x.question.text}</strong>
                          <small>
                            {x.model.name} · {state(x.status)} ·{" "}
                            {x.actualCostMicros === null
                              ? "费用待确认"
                              : money(x.actualCostMicros)}
                          </small>
                        </span>
                        <ChevronDown size={17} aria-hidden="true" />
                      </button>
                      {expanded === x.id && (
                        <div className="geo-answer" id={`geo-answer-${x.id}`}>
                          {x.status === "outcome_unknown" &&
                            permissions.includes("geo.settings.manage") && (
                              <Reconcile
                                tenantKey={tenantKey}
                                analysis={r}
                                run={x}
                                reload={query.reload}
                              />
                            )}
                          {x.errorCode && <p>{errorLabel(x.errorCode)}</p>}
                          {x.validSample &&
                            x.parsed?.evidence?.recommendation && (
                              <p>
                                <strong>推荐依据</strong>{" "}
                                {x.parsed.evidence.recommendation}
                              </p>
                            )}
                          {x.validSample && x.parsed?.evidence?.ranking && (
                            <p>
                              <strong>排名依据</strong>{" "}
                              {x.parsed.evidence.ranking.excerpt}
                            </p>
                          )}
                          {x.text ? <pre>{x.text}</pre> : <p>暂无回答正文</p>}
                          {x.citations?.map((c: any, i: number) => (
                            <p key={i}>
                              <a
                                href={c.url}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {c.title ?? c.url}
                              </a>
                            </p>
                          ))}
                          {report &&
                            x.status === "succeeded" &&
                            x.text &&
                            permissions.includes("geo.optimization.manage") && (
                              <RecordActions label={x.question.text}>
                                <button
                                  onClick={() =>
                                    onOptimize({
                                      baselineId: r.id,
                                      sourceRunId: x.id,
                                      title:
                                        `核对回答：${x.question.text}`.slice(
                                          0,
                                          200,
                                        ),
                                      description: `问题：${x.question.text}\n回答证据：${(x.parsed?.evidence?.recommendation || x.parsed?.evidence?.mention || x.text).slice(0, 650)}\n\n优化措施：`,
                                    })
                                  }
                                >
                                  创建优化任务
                                </button>
                              </RecordActions>
                            )}
                          <small>
                            输入 {x.inputTokens ?? "—"} / 输出{" "}
                            {x.outputTokens ?? "—"} Token
                            {x.externalId
                              ? " · 供应商回执 " + x.externalId
                              : ""}
                          </small>
                        </div>
                      )}
                    </li>
                  ))}
              </ul>
            </section>
          </>
        )}
      </DataResult>
    </>
  );
}
function errorLabel(code: string) {
  return (
    (
      {
        NATIVE_SEARCH_UNAVAILABLE: "模型不支持所需原生联网，已跳过",
        MODEL_DISABLED: "模型已停用",
        BUDGET_EXHAUSTED: "已达到预估预算，停止后续调用",
        WORKER_LEASE_EXPIRED: "执行中断，结果未知，未自动重发",
        ACCESS_REVOKED: "权限已撤销，停止后续调用",
        ACCESS_OR_CANCELLATION: "权限失效或已取消",
        PROVIDER_RATE_LIMITED: "供应商限流",
        PROVIDER_USAGE_UNKNOWN: "供应商未返回完整用量，费用待核实",
      } as Record<string, string>
    )[code] ?? "调用未完成，请核对模型配置、供应商回执和用量记录"
  );
}
function Insights({
  tenantKey,
  projectId,
  models,
  questions,
}: {
  tenantKey: string;
  projectId: string;
  models: any[];
  questions: any[];
}) {
  const url = useGeo(tenantKey),
    [days, setDays] = useState("30"),
    [model, setModel] = useState(""),
    [question, setQuestion] = useState(""),
    [category, setCategory] = useState("");
  const query = useApiData<any>(
    url(
      `/projects/${projectId}/insights?days=${days}${model ? "&modelId=" + model : ""}${question ? "&questionId=" + question : ""}${category ? "&category=" + encodeURIComponent(category) : ""}`,
    ),
  );
  return (
    <section className="panel">
      <SectionHead
        title="数据对比"
        info={
          <InfoTip label="比较条件">
            不同问题、模型版本、地域或联网条件分组比较。样本不足时仅用于诊断。
          </InfoTip>
        }
      />
      <div className="geo-filters">
        <Field label="时间范围">
          <DropdownSelect value={days} onChange={(e) => setDays(e.target.value)}>
            {[7, 30, 90].map((d) => (
              <option key={d} value={d}>
                近{d}天
              </option>
            ))}
          </DropdownSelect>
        </Field>
        <Field label="模型">
          <DropdownSelect value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">全部模型</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </DropdownSelect>
        </Field>
        <Field label="问题">
          <DropdownSelect
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          >
            <option value="">全部问题</option>
            {questions.map((q) => (
              <option key={q.id} value={q.id}>
                {q.text}
              </option>
            ))}
          </DropdownSelect>
        </Field>
        <Field label="问题分组">
          <DropdownSelect
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">全部分组</option>
            {[...new Set(questions.map((q) => q.category))].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </DropdownSelect>
        </Field>
      </div>
      <DataResult {...query}>
        {query.data?.groups.length ? (
          query.data.groups.map((g: any, i: number) => (
            <section key={g.comparabilityHash}>
              {query.data.groups.length > 1 && <h3>对比组 {i + 1}</h3>}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>有效回答</th>
                      <th>品牌提及</th>
                      <th>品牌推荐</th>
                      <th>报告</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.points.map((p: any) => (
                      <tr key={p.id}>
                        <td>{new Date(p.createdAt).toLocaleString("zh-CN")}</td>
                        <td>
                          {p.validSamples}/{p.plannedSamples}
                        </td>
                        <td>
                          {sampleValue(
                            p.mentionRate,
                            p.validSamples,
                            p.score?.diagnosticOnly === true,
                            p.mentionedSamples,
                          )}
                        </td>
                        <td>
                          {sampleValue(
                            p.recommendationRate,
                            p.validSamples,
                            p.score?.diagnosticOnly === true,
                            p.recommendedSamples,
                          )}
                        </td>
                        <td>
                          <Link
                            to={`/t/${tenantKey}/geo/projects/${projectId}/analyses/${p.id}`}
                          >
                            查看证据
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))
        ) : (
          <Empty text="当前范围没有分析数据" />
        )}
      </DataResult>
    </section>
  );
}
function Schedules({
  tenantKey,
  project,
  draft,
  clearDraft,
  questions,
  models,
  permissions,
}: {
  tenantKey: string;
  project: any;
  draft?: any;
  clearDraft: () => void;
  questions: any[];
  models: any[];
  permissions: string[];
}) {
  const url = useGeo(tenantKey),
    query = useApiData<any[]>(url(`/projects/${project.id}/schedules`)),
    [editing, setEditing] = useState<any>(draft ?? null),
    [resuming, setResuming] = useState<any>(null),
    a = useAction(),
    can = permissions.includes("geo.monitor.manage");
  const close = () => {
    setEditing(null);
    clearDraft();
  };
  return (
    <section className="panel">
      <SectionHead
        title="监测计划"
        info={
          <InfoTip label="监测规则">
            按项目时区执行，使用问题和模型的最新配置。权限或预算不足时跳过；暂停不撤回已提交分析。
          </InfoTip>
        }
        action={
          can && permissions.includes("geo.analysis.run") ? (
            <button className="primary" onClick={() => setEditing({})}>
              新建计划
            </button>
          ) : undefined
        }
      />
      <Notice text={a.message} />
      <DataResult {...query}>
        {query.data?.length ? (
          <ul className="geo-records">
            {query.data.map((s) => (
              <li key={s.id}>
                <div>
                  <strong>{s.name}</strong>
                  <small>
                    {s.frequency === "daily"
                      ? "每日"
                      : `每周${["日", "一", "二", "三", "四", "五", "六"][s.weekday]}`}{" "}
                    {String(s.hour).padStart(2, "0")}:
                    {String(s.minute).padStart(2, "0")} · {s.timezone} ·{" "}
                    {s.active ? "启用" : "暂停"} · 上限 {money(s.maxCostMicros)}
                    /次
                  </small>
                  {s.active && (
                    <small>
                      下次 {new Date(s.nextRunAt).toLocaleString("zh-CN")}
                    </small>
                  )}
                  {s.executions.map((e: any) => (
                    <small key={e.id}>
                      {new Date(e.dueAt).toLocaleString("zh-CN")} ·{" "}
                      {state(e.status)}
                      {e.analysisId && (
                        <Link
                          to={`/t/${tenantKey}/geo/projects/${project.id}/analyses/${e.analysisId}`}
                        >
                          查看报告
                        </Link>
                      )}
                    </small>
                  ))}
                </div>
                {can && (
                  <RecordActions label={s.name}>
                    <button onClick={() => setEditing(s)}>编辑</button>
                    <button
                      disabled={a.busy}
                      onClick={() =>
                        !s.active
                          ? setResuming(s)
                          : void a.run(async () => {
                              await api.put(url(`/schedules/${s.id}/state`), {
                                active: false,
                                version: s.version,
                              });
                              await query.reload();
                            })
                      }
                    >
                      {s.active ? "暂停" : "恢复"}
                    </button>
                  </RecordActions>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Empty text="暂无监测计划" />
        )}
      </DataResult>
      {resuming && (
        <ConfirmDialog
          open
          title="恢复自动监测？"
          description={`恢复后将按计划自动调用模型并产生费用。单次预估上限 ${money(resuming.maxCostMicros)}。`}
          confirmLabel="恢复监测"
          busy={a.busy}
          error={a.message}
          onCancel={() => setResuming(null)}
          onConfirm={() =>
            void a.run(async () => {
              await api.put(url(`/schedules/${resuming.id}/state`), {
                active: true,
                version: resuming.version,
              });
              setResuming(null);
              await query.reload();
            })
          }
        />
      )}
      {editing && (
        <ScheduleForm
          value={editing}
          questions={questions}
          models={models}
          timezone={project.timezone}
          close={close}
          busy={a.busy}
          message={a.message}
          preview={(v) =>
            api.post(url(`/projects/${project.id}/schedules/preview`), v)
          }
          save={(v) =>
            a.run(async () => {
              const base = `/projects/${project.id}/schedules`;
              if (editing.id)
                await api.put(url(base + "/" + editing.id), {
                  ...v,
                  version: editing.version,
                });
              else
                await api.post(url(base), {
                  ...v,
                  requestKey:
                    editing.requestKey ?? (editing.requestKey = key()),
                });
              close();
              await query.reload();
            })
          }
        />
      )}
    </section>
  );
}
function ScheduleForm({
  value,
  questions,
  models,
  timezone,
  busy,
  message,
  close,
  save,
  preview,
}: {
  value: any;
  questions: any[];
  models: any[];
  timezone: string;
  busy: boolean;
  message: string | null;
  close: () => void;
  save: (v: any) => void;
  preview: (v: any) => Promise<any>;
}) {
  const [v, setV] = useState({
    name: value.name ?? "",
    frequency: value.frequency ?? "daily",
    hour: value.hour ?? 9,
    minute: value.minute ?? 0,
    weekday: value.weekday ?? 1,
    questionIds:
      value.questionIds ??
      questions
        .filter((q) => q.enabled)
        .slice(0, 8)
        .map((q) => q.id),
    modelIds:
      value.modelIds ??
      modelOptions(
        models,
        questions,
        questions
          .filter((q) => q.enabled)
          .slice(0, 8)
          .map((q) => q.id),
      )
        .filter((m) => !m.disabled)
        .map((m) => m.id),
    max: String((value.maxCostMicros ?? 1000000) / 1000000),
    active: value.active ?? false,
  });
  const previewAction = useAction();
  const [checked, setChecked] = useState<{ input: string; result: any } | null>(
    null,
  );
  const { max, ...fields } = v;
  const body = { ...fields, maxCostMicros: Math.round(Number(max) * 1000000) };
  const input = JSON.stringify(body);
  const estimated = checked?.input === input ? checked.result : null;
  const previewSummary = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!estimated) return;
    previewSummary.current?.focus({ preventScroll: true });
    previewSummary.current?.scrollIntoView({ block: "nearest" });
  }, [estimated]);
  const options = modelOptions(models, questions, v.questionIds);
  const pairs = compatiblePairs(
    questions.filter((question) => question.enabled),
    models.filter((model) => model.enabled),
    v.questionIds,
    v.modelIds,
  );
  const eligible = pairs.filter(Boolean).length;
  return (
    <Dialog
      open
      title={value.id ? "编辑监测计划" : "新建监测计划"}
      busy={busy || previewAction.busy}
      onClose={close}
      dirtyCheck
      size="large"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!eligible) return;
          if (estimated) save(body);
          else
            void previewAction.run(async () => {
              setChecked({ input, result: await preview(body) });
            });
        }}
      >
        <Notice text={message || previewAction.message} />
        <Field label="计划名称">
          <input
            required
            maxLength={120}
            value={v.name}
            onChange={(e) => setV({ ...v, name: e.target.value })}
          />
        </Field>
        <div className="form-grid">
          <Field label="频率">
            <DropdownSelect
              value={v.frequency}
              onChange={(e) => setV({ ...v, frequency: e.target.value })}
            >
              <option value="daily">每日</option>
              <option value="weekly">每周</option>
            </DropdownSelect>
          </Field>
          {v.frequency === "weekly" && (
            <Field label="星期">
              <DropdownSelect
                value={v.weekday}
                onChange={(e) =>
                  setV({ ...v, weekday: Number(e.target.value) })
                }
              >
                {["日", "一", "二", "三", "四", "五", "六"].map((d, i) => (
                  <option key={d} value={i}>
                    星期{d}
                  </option>
                ))}
              </DropdownSelect>
            </Field>
          )}
          <Field label={`执行时间（${timezone}）`}>
            <input
              type="time"
              required
              value={`${String(v.hour).padStart(2, "0")}:${String(v.minute).padStart(2, "0")}`}
              onChange={(e) => {
                const [hour, minute] = e.target.value.split(":").map(Number);
                setV({ ...v, hour, minute });
              }}
            />
          </Field>
          <Field label="单次预估上限（元）">
            <input
              type="number"
              min="0.01"
              max="100"
              step="0.01"
              required
              value={v.max}
              onChange={(e) => setV({ ...v, max: e.target.value })}
            />
          </Field>
        </div>
        <div className="form-grid">
          <CheckList
            label="问题"
            items={questions.filter((q) => q.enabled)}
            value={v.questionIds}
            onChange={(questionIds) => setV({ ...v, questionIds })}
          />
          <CheckList
            label="模型"
            items={options}
            value={v.modelIds}
            onChange={(modelIds) => setV({ ...v, modelIds })}
          />
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={v.active}
            onChange={(e) => setV({ ...v, active: e.target.checked })}
          />
          启用计划（会产生模型费用）
        </label>

        {!eligible && (
          <p className="geo-consequence">
            当前没有兼容组合，请调整问题或模型。
          </p>
        )}
        {estimated && (
          <section ref={previewSummary} className="panel geo-estimate" tabIndex={-1} aria-label="监测计划预览">
            <strong>单次预估 {money(estimated.estimatedCostMicros)}</strong>
            <p>
              {estimated.eligibleRuns} 个可执行组合
              {estimated.skippedRuns
                ? `，${estimated.skippedRuns} 个将跳过`
                : ""}
              。按实际用量结算。
            </p>
            <p>
              {v.active ? "下次执行" : "启用后预计下次执行"}{" "}
              {new Date(estimated.nextRunAt).toLocaleString("zh-CN", {
                timeZone: timezone,
              })}
              （{timezone}）
            </p>
          </section>
        )}
        <DialogAction>
          <button
            className="primary"
            disabled={busy || previewAction.busy || !eligible}
          >
            {estimated
              ? v.active
                ? "确认并启用监测"
                : "保存为暂停"
              : "预览计划"}
          </button>
        </DialogAction>
      </form>
    </Dialog>
  );
}
function Optimizations({
  tenantKey,
  projectId,
  permissions,
  onRetest,
  draft,
  clearDraft,
}: {
  tenantKey: string;
  projectId: string;
  permissions: string[];
  onRetest: (v: any) => void;
  draft?: any;
  clearDraft: () => void;
}) {
  const url = useGeo(tenantKey),
    query = useApiData<any[]>(url(`/projects/${projectId}/optimizations`)),
    history = useApiData<any>(
      url(`/projects/${projectId}/analyses?page_size=100`),
    ),
    members = useApiData<any[]>(url("/members")),
    [editing, setEditing] = useState<any>(draft ?? null),
    a = useAction();
  const [params] = useSearchParams();
  const taskId = params.get("task");
  const ready = Boolean(query.data?.some((task) => task.id === taskId));
  useEffect(() => {
    if (!ready) return;
    const target = document.getElementById(`geo-optimization-${taskId}`);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "center" });
  }, [ready, taskId]);
  const close = () => {
    setEditing(null);
    clearDraft();
  };
  const can = permissions.includes("geo.optimization.manage");
  return (
    <section className="panel">
      <SectionHead
        title="优化任务"
        action={
          can ? (
            <button className="primary" onClick={() => setEditing({})}>
              新建任务
            </button>
          ) : undefined
        }
      />
      <Notice text={a.message} />
      <DataResult {...query}>
        {query.data?.length ? (
          <ul className="geo-records">
            {query.data.map((t) => (
              <li
                key={t.id}
                id={`geo-optimization-${t.id}`}
                tabIndex={taskId === t.id ? -1 : undefined}
              >
                <div>
                  <strong>{t.title}</strong>
                  <small>
                    {state(t.status)} ·{" "}
                    {members.data?.find((m) => m.id === t.assigneeMembershipId)
                      ?.name ?? "未分配"}
                    {t.dueAt
                      ? " · " + new Date(t.dueAt).toLocaleDateString("zh-CN")
                      : ""}
                  </small>
                  <p>{t.description}</p>
                  {t.evidenceUrl && (
                    <a
                      href={t.evidenceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      措施证据
                    </a>
                  )}
                  <small>
                    <Link
                      to={`/t/${tenantKey}/geo/projects/${projectId}/analyses/${t.baselineId}`}
                    >
                      基线报告
                    </Link>
                    {t.sourceRunId && (
                      <Link
                        to={`/t/${tenantKey}/geo/projects/${projectId}/analyses/${t.baselineId}?answer=${t.sourceRunId}`}
                      >
                        原回答证据
                      </Link>
                    )}
                    {t.retests.map((r: any) => (
                      <Link
                        key={r.id}
                        to={`/t/${tenantKey}/geo/projects/${projectId}/analyses/${r.id}`}
                      >
                        复测 · {state(r.status)}
                      </Link>
                    ))}
                  </small>
                </div>
                <RecordActions label={t.title}>
                  {can && <button onClick={() => setEditing(t)}>编辑</button>}
                  {permissions.includes("geo.analysis.run") && (
                    <button
                      disabled={a.busy}
                      onClick={() =>
                        void a.run(async () => {
                          const baseline = await api.get<{
                            retestVersionCurrent?: boolean;
                            retestComparisonBlock?: string;
                          }>(url("/analyses/" + t.baselineId));
                          if (baseline.retestVersionCurrent === false)
                            throw new Error(
                              baseline.retestComparisonBlock ?? "请建立新基线",
                            );
                          onRetest({ baseline, optimizationId: t.id });
                        })
                      }
                    >
                      同条件复测
                    </button>
                  )}
                </RecordActions>
              </li>
            ))}
          </ul>
        ) : (
          <Empty text="暂无优化任务" />
        )}
      </DataResult>
      {editing && (
        <OptimizationForm
          value={editing}
          analyses={history.data?.items ?? []}
          members={(members.data ?? []).filter(
            (m) =>
              ["admin", "manager", "analyst"].includes(m.role) ||
              m.id === editing.assigneeMembershipId,
          )}
          busy={a.busy}
          message={a.message}
          close={close}
          save={(v) =>
            a.run(async () => {
              const base = `/projects/${projectId}/optimizations`;
              if (editing.id)
                await api.put(url(base + "/" + editing.id), {
                  ...v,
                  version: editing.version,
                });
              else
                await api.post(url(base), {
                  ...v,
                  ...(editing.sourceRunId
                    ? { sourceRunId: editing.sourceRunId }
                    : {}),
                });
              close();
              await query.reload();
            })
          }
        />
      )}
    </section>
  );
}
function OptimizationForm({
  value,
  analyses,
  members,
  busy,
  message,
  close,
  save,
}: {
  value: any;
  analyses: any[];
  members: any[];
  busy: boolean;
  message: string | null;
  close: () => void;
  save: (v: any) => void;
}) {
  const [v, setV] = useState({
    title: value.title ?? "",
    description: value.description ?? "",
    baselineId: value.baselineId ?? "",
    assigneeMembershipId: value.assigneeMembershipId ?? "",
    evidenceUrl: value.evidenceUrl ?? "",
    dueAt: value.dueAt ? value.dueAt.slice(0, 10) : "",
    status: value.status ?? "open",
  });
  return (
    <Dialog
      open
      title={value.id ? "编辑优化任务" : "新建优化任务"}
      busy={busy}
      onClose={close}
      dirtyCheck
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save({
            ...v,
            assigneeMembershipId: v.assigneeMembershipId || null,
            evidenceUrl: v.evidenceUrl || null,
            dueAt: v.dueAt
              ? new Date(v.dueAt + "T23:59:00+08:00").toISOString()
              : null,
          });
        }}
      >
        <Notice text={message} />
        <Field label="任务名称">
          <input
            required
            maxLength={200}
            value={v.title}
            onChange={(e) => setV({ ...v, title: e.target.value })}
          />
        </Field>
        <Field label="优化措施">
          <textarea
            required
            maxLength={2000}
            rows={4}
            value={v.description}
            onChange={(e) => setV({ ...v, description: e.target.value })}
          />
        </Field>
        <Field label="基线报告">
          <DropdownSelect
            required
            disabled={Boolean(value.id || value.sourceRunId)}
            value={v.baselineId}
            onChange={(e) => setV({ ...v, baselineId: e.target.value })}
          >
            <option value="">选择分析报告</option>
            {value.sourceRunId &&
              !analyses.some((item) => item.id === value.baselineId) && (
                <option value={value.baselineId}>当前报告</option>
              )}
            {analyses
              .filter((x) =>
                ["completed", "partially_completed", "needs_review"].includes(
                  x.status,
                ),
              )
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {new Date(x.createdAt).toLocaleString("zh-CN")} ·{" "}
                  {state(x.status)}
                </option>
              ))}
          </DropdownSelect>
        </Field>
        <div className="form-grid">
          <Field label="负责人">
            <DropdownSelect
              value={v.assigneeMembershipId}
              onChange={(e) =>
                setV({ ...v, assigneeMembershipId: e.target.value })
              }
            >
              <option value="">暂不分配</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </DropdownSelect>
          </Field>
          <Field label="截止日期">
            <input
              type="date"
              value={v.dueAt}
              onChange={(e) => setV({ ...v, dueAt: e.target.value })}
            />
          </Field>
        </div>
        <Field label="证据链接（可选）">
          <input
            type="url"
            maxLength={2000}
            value={v.evidenceUrl}
            onChange={(e) => setV({ ...v, evidenceUrl: e.target.value })}
          />
        </Field>
        <Field label="任务状态">
          <DropdownSelect
            value={v.status}
            onChange={(e) => setV({ ...v, status: e.target.value })}
          >
            {["open", "in_progress", "done"].map((s) => (
              <option key={s} value={s}>
                {state(s)}
              </option>
            ))}
          </DropdownSelect>
        </Field>
        <DialogAction>
          <button className="primary" disabled={busy}>
            保存任务
          </button>
        </DialogAction>
      </form>
    </Dialog>
  );
}
function Settings({ tenantKey }: { tenantKey: string }) {
  const url = useGeo(tenantKey),
    models = useApiData<any[]>(url("/models")),
    settings = useApiData<any>(url("/settings")),
    members = useApiData<any[]>(url("/members")),
    a = useAction(),
    [editing, setEditing] = useState<any>(null),
    [grantPending, setGrantPending] = useState<{
      member: any;
      role: string;
    } | null>(null),
    [budget, setBudget] = useState("20");
  const [params] = useSearchParams();
  const returnProject = params.get("project");
  useEffect(() => {
    if (settings.data)
      setBudget(String(settings.data.dailyBudgetMicros / 1000000));
  }, [settings.data]);
  return (
    <>
      <PageTitle
        title="模型与权限"
        back={
          returnProject && /^[0-9a-f-]{36}$/i.test(returnProject) ? (
            <Link to={`/t/${tenantKey}/geo/projects/${returnProject}`}>
              返回品牌项目
            </Link>
          ) : undefined
        }
      />
      <Notice text={a.message} />
      <SectionTabs
        label="GEO 设置"
        items={[
          {
            id: "models",
            label: "模型",
            content: (
              <section className="panel">
                <SectionHead
                  title="监测模型"
                  info={
                    <InfoTip label="模型配置说明">
                      使用企业的火山方舟模型。API Key
                      加密保存后不回显，单价请按供应商价格填写。
                    </InfoTip>
                  }
                  action={
                    <button className="primary" onClick={() => setEditing({})}>
                      添加模型
                    </button>
                  }
                />
                <DataResult {...models}>
                  {models.data?.length ? (
                    <ul className="geo-records">
                      {models.data.map((m) => (
                        <li key={m.id}>
                          <div>
                            <strong>{m.name}</strong>
                            <small>
                              {m.code} · {m.enabled ? "启用" : "停用"} ·{" "}
                              {m.nativeWebSearch ? "支持原生联网" : "不联网"}
                            </small>
                            <small>
                              每百万 Token：输入{" "}
                              {money(m.inputPriceMicrosPerMillion)} / 输出{" "}
                              {money(m.outputPriceMicrosPerMillion)}
                            </small>
                          </div>
                          <RecordActions label={m.name}>
                            <button
                              aria-label={`编辑模型：${m.name}`}
                              onClick={() => setEditing(m)}
                            >
                              编辑
                            </button>
                          </RecordActions>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Empty text="暂无监测模型" />
                  )}
                </DataResult>
              </section>
            ),
          },
          {
            id: "budget",
            label: "预算",
            content: (
              <section className="panel">
                <SectionHead
                  title="每日预算"
                  info={
                    <InfoTip label="预算结算规则">
                      按 UTC
                      日计算，待执行及结果未知的分析占用预算。按实际用量结算。
                    </InfoTip>
                  }
                />
                <DataResult {...settings}>
                  <form
                    className="toolbar"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void a.run(async () => {
                        await api.put(url("/settings"), {
                          dailyBudgetMicros: Math.round(
                            Number(budget) * 1000000,
                          ),
                          version: settings.data.version,
                        });
                        await settings.reload();
                      });
                    }}
                  >
                    <Field label="预算（元）">
                      <input
                        required
                        type="number"
                        min="0.01"
                        max="1000"
                        step="0.01"
                        value={budget}
                        onChange={(e) => setBudget(e.target.value)}
                      />
                    </Field>
                    <button
                      className="primary"
                      disabled={
                        a.busy ||
                        Math.round(Number(budget) * 1000000) ===
                          settings.data?.dailyBudgetMicros
                      }
                    >
                      保存预算
                    </button>
                  </form>
                </DataResult>
              </section>
            ),
          },
          {
            id: "members",
            label: "权限",
            content: (
              <section className="panel">
                <SectionHead title="成员权限" />
                <DataResult {...members}>
                  {members.data?.map((m) => (
                    <div className="geo-member" key={m.id}>
                      <span>{m.name}</span>
                      {m.role === "admin" ? (
                        <span>企业管理员</span>
                      ) : (
                        <DropdownSelect
                          aria-label={`${m.name}的GEO角色`}
                          value={m.role}
                          disabled={a.busy}
                          onChange={(e) =>
                            setGrantPending({ member: m, role: e.target.value })
                          }
                        >
                          {[
                            ["none", "未授权"],
                            ["viewer", "只读"],
                            ["analyst", "分析员"],
                            ["manager", "GEO管理员"],
                          ].map(([v, t]) => (
                            <option key={v} value={v}>
                              {t}
                            </option>
                          ))}
                        </DropdownSelect>
                      )}
                    </div>
                  ))}
                </DataResult>
              </section>
            ),
          },
        ]}
      />
      {grantPending && (
        <ConfirmDialog
          open
          title={`调整 ${grantPending.member.name} 的权限？`}
          description={
            (
              {
                none: "该成员将无法访问 GEO，后续模型调用会停止。",
                viewer: "该成员可以查看 GEO 项目和报告。",
                analyst: "该成员可以编辑项目、运行分析和管理监测。",
                manager: "该成员可以管理模型、费用和其他成员权限。",
              } as Record<string, string>
            )[grantPending.role]
          }
          confirmLabel="确认调整"
          busy={a.busy}
          error={a.message}
          onCancel={() => setGrantPending(null)}
          onConfirm={() =>
            void a.run(async () => {
              await api.put(url("/members"), {
                membershipId: grantPending.member.id,
                role: grantPending.role,
                version: grantPending.member.version,
              });
              setGrantPending(null);
              await members.reload();
            })
          }
        />
      )}
      {editing && (
        <ModelForm
          value={editing}
          busy={a.busy}
          message={a.message}
          close={() => setEditing(null)}
          save={(v) =>
            a.run(async () => {
              if (editing.id)
                await api.put(url("/models/" + editing.id), {
                  ...v,
                  version: editing.version,
                });
              else await api.post(url("/models"), v);
              setEditing(null);
              await models.reload();
            })
          }
        />
      )}
    </>
  );
}
function ModelForm({
  value,
  busy,
  message,
  close,
  save,
}: {
  value: any;
  busy: boolean;
  message: string | null;
  close: () => void;
  save: (v: any) => void;
}) {
  const [v, setV] = useState({
    name: value.name ?? "",
    family: value.family ?? "doubao",
    code: value.code ?? "",
    apiMode: value.apiMode ?? "responses",
    apiKey: "",
    nativeWebSearch: value.nativeWebSearch ?? false,
    input: String((value.inputPriceMicrosPerMillion ?? 1000000) / 1000000),
    output: String((value.outputPriceMicrosPerMillion ?? 1000000) / 1000000),
    search: String((value.searchPriceMicros ?? 0) / 1000000),
    enabled: value.enabled ?? true,
  });
  return (
    <Dialog
      open
      title={value.id ? "编辑模型" : "添加模型"}
      onClose={close}
      busy={busy}
      dirtyCheck
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const { input, output, search, apiKey, ...rest } = v;
          save({
            ...rest,
            ...(apiKey ? { apiKey } : {}),
            inputPriceMicrosPerMillion: Math.round(Number(input) * 1000000),
            outputPriceMicrosPerMillion: Math.round(Number(output) * 1000000),
            searchPriceMicros: Math.round(Number(search) * 1000000),
          });
        }}
      >
        <Notice text={message} />
        <Field label="显示名称">
          <input
            required
            maxLength={100}
            value={v.name}
            onChange={(e) => setV({ ...v, name: e.target.value })}
          />
        </Field>
        <Field label="模型系列">
          <DropdownSelect
            value={v.family}
            onChange={(e) => setV({ ...v, family: e.target.value })}
          >
            {[
              ["doubao", "豆包"],
              ["kimi", "Kimi"],
              ["glm", "GLM"],
              ["deepseek", "DeepSeek"],
            ].map(([id, n]) => (
              <option key={id} value={id}>
                {n}
              </option>
            ))}
          </DropdownSelect>
        </Field>
        <Field label="方舟模型 ID">
          <input
            required
            maxLength={150}
            value={v.code}
            onChange={(e) => setV({ ...v, code: e.target.value })}
          />
        </Field>
        <Field label="API 模式">
          <DropdownSelect
            value={v.apiMode}
            onChange={(e) =>
              setV({
                ...v,
                apiMode: e.target.value,
                nativeWebSearch:
                  e.target.value === "responses" && v.nativeWebSearch,
              })
            }
          >
            <option value="responses">Responses</option>
            <option value="chat_completions">Chat Completions</option>
          </DropdownSelect>
        </Field>
        <Field label={value.id ? "API Key（留空保持）" : "API Key"}>
          <input
            type="password"
            required={!value.id}
            autoComplete="new-password"
            minLength={8}
            maxLength={1000}
            value={v.apiKey}
            onChange={(e) => setV({ ...v, apiKey: e.target.value })}
          />
        </Field>
        <div className="form-grid">
          {[
            ["input", "输入价格（元/百万 Token）"],
            ["output", "输出价格（元/百万 Token）"],
            ["search", "联网价格（元/次）"],
          ].map(([k, label]) => (
            <Field key={k} label={label}>
              <input
                type="number"
                min="0"
                max={k === "search" ? 10 : 1000}
                step="0.000001"
                required
                value={(v as any)[k]}
                onChange={(e) => setV({ ...v, [k]: e.target.value })}
              />
            </Field>
          ))}
        </div>
        <label className="check">
          <input
            type="checkbox"
            disabled={v.apiMode !== "responses"}
            checked={v.nativeWebSearch}
            onChange={(e) => setV({ ...v, nativeWebSearch: e.target.checked })}
          />
          该模型已开通官方原生联网
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={v.enabled}
            onChange={(e) => setV({ ...v, enabled: e.target.checked })}
          />
          启用模型
        </label>
        <DialogAction>
          <button className="primary" disabled={busy}>
            保存模型
          </button>
        </DialogAction>
      </form>
    </Dialog>
  );
}
export function GeoPage({
  tenantKey,
}: {
  tenantKey: string;
  permissions: readonly string[];
  isTenantAdmin?: boolean;
}) {
  const url = useGeo(tenantKey),
    meta = useApiData<any>(url("/metadata"));
  if (meta.loading && !meta.data) return <Loading />;
  if (meta.error) return <DataResult {...meta}>{null}</DataResult>;
  const permissions = meta.data?.permissions ?? [];
  return (
    <div className="geo-app">
      <Routes>
        <Route
          index
          element={
            <ProjectList tenantKey={tenantKey} permissions={permissions} />
          }
        />
        <Route
          path="projects/:projectId/*"
          element={
            <ProjectDetail tenantKey={tenantKey} permissions={permissions} />
          }
        />
        <Route
          path="analyses"
          element={
            <>
              <PageTitle title="分析任务" />
              <AnalysisList tenantKey={tenantKey} />
            </>
          }
        />
        <Route
          path="settings"
          element={
            permissions.includes("geo.settings.manage") ? (
              <Settings tenantKey={tenantKey} />
            ) : (
              <Empty text="当前岗位没有模型设置权限" />
            )
          }
        />
        <Route path="ai" element={<div />} />
        <Route
          path="*"
          element={<Navigate to={`/t/${tenantKey}/geo`} replace />}
        />
      </Routes>
    </div>
  );
}
function Reconcile({
  tenantKey,
  analysis,
  run,
  reload,
}: {
  tenantKey: string;
  analysis: any;
  run: any;
  reload: () => Promise<void>;
}) {
  const url = useGeo(tenantKey),
    [open, setOpen] = useState(false),
    [cost, setCost] = useState("0"),
    [evidence, setEvidence] = useState(""),
    a = useAction();
  return (
    <>
      <button onClick={() => setOpen(true)}>核对供应商费用</button>
      {open && (
        <Dialog
          open
          title="核对未知结果"
          busy={a.busy}
          onClose={() => setOpen(false)}
          dirtyCheck
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void a.run(async () => {
                await api.post(url(`/analyses/${analysis.id}/reconcile`), {
                  runId: run.id,
                  version: analysis.version,
                  actualCostMicros: Math.round(Number(cost) * 1000000),
                  evidence,
                });
                setOpen(false);
                await reload();
              });
            }}
          >
            <Notice text={a.message} />
            <p>请先核对账单或回执。结算会释放预留费用，不会重发请求。</p>
            <Field label="实际费用（元，确认未计费可填0）">
              <input
                required
                type="number"
                min="0"
                max="1000"
                step="0.000001"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
              />
            </Field>
            <Field label="账单或回执核对依据">
              <textarea
                required
                minLength={8}
                maxLength={2000}
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
              />
            </Field>
            <DialogAction>
              <button className="primary" disabled={a.busy}>
                确认核对并结算
              </button>
            </DialogAction>
          </form>
        </Dialog>
      )}
    </>
  );
}
