import {GeoTaskPanel} from '../geo/GeoPage';
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, errorText, tenantApi } from "../api";
import { safeReturn } from "../business-context";
import { useApiData, usePagedArray } from "../hooks";
import {
  ChoiceSelect,
  ConfirmDialog,
  DataResult,
  Dialog,
  Empty,
  Field,
  InfoTip,
  Notice,
  PageTitle,
  PagedCollection,
  RecordActions,
  Status,
} from "../components";
import { AiTaskPanel } from "./AiTaskPanel";

type Step = {
  preview?: {
    supplier?: { name: string };
    lines?: Array<{
      productId: string;
      name: string;
      sku: string;
      quantity: number;
      unit: string;
      amount: string;
    }>;
    estimatedTotal?: string;
  };
  id: string;
  ordinal: number;
  title: string;
  appId: string;
  command: string;
  status: string;
  attempts: number;
  result: Record<string, unknown> | null;
  errorCode: string | null;
  finishedAt: string | null;
};
type Task = {
  restricted?: boolean;
  id: string;
  title: string;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  steps: Step[];
};
type Action = "confirm" | "retry" | "cancel";
const labels: Record<string, string> = {
  queued: "待执行",
  waiting: "等待业务办理",
  awaiting_confirmation: "待确认计划",
  pending: "待执行",
  running: "执行中",
  completed: "已完成",
  failed: "执行失败",
  cancelled: "已取消",
};
const active = (status?: string) =>
  ["queued", "running", "waiting"].includes(status ?? "");

export function TaskCenterPage({ tenantKey, appId = "erp" }: { tenantKey: string; appId?:string }) {
  const [params, setParams] = useSearchParams();
  const selected = params.get("task");
  const search = params.get("q") ?? "";
  const status =
    Object.hasOwn(labels, params.get("status") ?? "") &&
    params.get("status") !== "pending"
      ? params.get("status")!
      : "all";
  const [input, setInput] = useState(search);
  useEffect(() => {
    setInput(search);
  }, [search, tenantKey]);
  const setSelected = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("task", id);
    else next.delete("task");
    setParams(next);
  };
  const filter = (q: string, state: string) => {
    const next = new URLSearchParams(params);
    if (q.trim()) next.set("q", q.trim());
    else next.delete("q");
    if (state !== "all") next.set("status", state);
    else next.delete("status");
    setParams(next);
  };
  const returnTo = safeReturn(params.get("returnTo"), tenantKey);
  const query = usePagedArray<Task>(
    tenantApi(
      tenantKey,
      `/tasks?q=${encodeURIComponent(search)}&status=${status}`,
    ),
  );
  const detail = useApiData<Task>(
    selected ? tenantApi(tenantKey, `/tasks/${selected}`) : null,
  );
  const task = detail.data;
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<{ task: Task; action: Action } | null>(
    null,
  );
  useEffect(() => {
    setPending(null);
    setMessage(null);
  }, [tenantKey]);
  useEffect(() => {
    if (!query.data?.some((t) => active(t.status)) && !active(task?.status))
      return;
    const timer = setInterval(() => {
      if (document.hidden) return;
      void query.reload();
      if (selected) void detail.reload();
    }, 5000);
    return () => clearInterval(timer);
  }, [query.data, query.reload, task?.status, selected, detail.reload]);
  const act = async () => {
    if (!pending || lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await api.post(
        tenantApi(tenantKey, `/tasks/${pending.task.id}/actions`),
        { action: pending.action, version: pending.task.version },
      );
      setPending(null);
      await Promise.all([query.reload(), detail.reload()]);
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const actions = (t: Task) => (
    <div className="row-actions">
      {t.status === "awaiting_confirmation" && (
        <button
          className="primary"
          disabled={busy}
          onClick={() => setPending({ task: t, action: "confirm" })}
        >
          确认计划
        </button>
      )}
      {t.status === "failed" && (
        <button
          disabled={busy}
          onClick={() => setPending({ task: t, action: "retry" })}
        >
          重试
        </button>
      )}
      {!["completed", "cancelled"].includes(t.status) && (
        <button
          disabled={busy}
          onClick={() => setPending({ task: t, action: "cancel" })}
        >
          取消任务
        </button>
      )}
    </div>
  );
  return (
    <>
      <PageTitle
        title="任务中心"
        back={returnTo ? <Link to={returnTo}>返回来源页面</Link> : undefined}
        action={
          <button
            disabled={busy || query.loading}
            onClick={() => {
              void query.reload();
              if (selected) void detail.reload();
            }}
          >
            刷新
          </button>
        }
      />
      <Notice text={message} />
      <GeoTaskPanel tenantKey={tenantKey}/>
      <section className="panel">
        <form
          className="toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            filter(input, status);
          }}
        >
          <Field label="任务名称">
            <input
              value={input}
              maxLength={120}
              onChange={(event) => setInput(event.target.value)}
            />
          </Field>
          <ChoiceSelect
            label="任务状态"
            value={status}
            onChange={(event) => filter(search, event.target.value)}
          >
            <option value="all">全部状态</option>
            {Object.entries(labels)
              .filter(([key]) => key !== "pending")
              .map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
          </ChoiceSelect>
          <button type="submit" disabled={query.loading}>
            搜索
          </button>
          {(search || status !== "all") && (
            <button
              type="button"
              onClick={() => {
                setInput("");
                filter("", "all");
              }}
            >
              重置
            </button>
          )}
        </form>
        <DataResult {...query}>
          {query.data?.length ? (
            <PagedCollection label="业务任务分页" pagination={query.pagination}>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>任务</th>
                      <th>进度</th>
                      <th>状态</th>
                      <th>更新时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.map((t) => (
                      <tr key={t.id}>
                        <td>{t.title}</td>
                        <td>
                          {
                            t.steps.filter((s) => s.status === "completed")
                              .length
                          }{" "}
                          / {t.steps.length}
                        </td>
                        <td>
                          <Status value={t.status} label={labels[t.status]} />
                        </td>
                        <td>{new Date(t.updatedAt).toLocaleString("zh-CN")}</td>
                        <td>
                          <RecordActions label={t.title}>
                            {t.restricted ? (
                              !["completed", "cancelled"].includes(
                                t.status,
                              ) && (
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    setPending({ task: t, action: "cancel" })
                                  }
                                >
                                  取消任务
                                </button>
                              )
                            ) : (
                              <button onClick={() => setSelected(t.id)}>
                                查看详情
                              </button>
                            )}
                          </RecordActions>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </PagedCollection>
          ) : (
            <Empty
              text={
                search || status !== "all"
                  ? "没有符合条件的任务"
                  : "暂无执行任务"
              }
            />
          )}
        </DataResult>
      </section>
      <Dialog
        open={Boolean(selected)}
        title={task?.title ?? "任务详情"}
        onClose={() => setSelected(null)}
        busy={busy}
        size="large"
      >
        <DataResult {...detail}>
          {task && (
            <>
              <div className="task-detail-summary">
                <Status value={task.status} label={labels[task.status]} />
                {actions(task)}
              </div>
              <ol className="execution-steps">
                {task.steps.map((s) => (
                  <li key={s.id}>
                    <div className="execution-step-heading">
                      <h3>
                        {s.ordinal + 1}. {s.title}
                      </h3>
                      <Status value={s.status} label={labels[s.status]} />
                    </div>
                    {s.preview && (
                      <div className="table-wrap">
                        <p>
                          {s.preview.supplier?.name}
                          {s.preview.estimatedTotal
                            ? ` · 合计 ¥${s.preview.estimatedTotal}`
                            : ""}
                        </p>
                        <table>
                          <thead>
                            <tr>
                              <th>商品</th>
                              <th>数量</th>
                              <th>金额</th>
                            </tr>
                          </thead>
                          <tbody>
                            {s.preview.lines?.map((l, i) => (
                              <tr key={i}>
                                <td>{l.name ?? l.sku}</td>
                                <td>
                                  {l.quantity} {l.unit}
                                </td>
                                <td>¥{l.amount}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {s.errorCode && (
                      <p role="status">
                        此步骤未完成，请核对相关业务后重试。{" "}
                        <InfoTip label="查看任务错误代码">
                          {s.errorCode}
                        </InfoTip>
                      </p>
                    )}
                    <div className="execution-step-meta">
                      <span>执行次数 {s.attempts}</span>
                      {s.finishedAt && (
                        <span>
                          {new Date(s.finishedAt).toLocaleString("zh-CN")}
                        </span>
                      )}
                    </div>
                    {s.appId === "erp" &&
                      s.result &&
                      typeof s.result.id === "string" &&
                      s.command.startsWith("erp.purchase.") && (
                        <Link
                          className="button"
                          to={`/t/${tenantKey}/erp/purchases/${s.result.id}?returnTo=${encodeURIComponent(`/t/${tenantKey}/tasks?task=${task.id}`)}`}
                        >
                          {typeof s.result.number === "string"
                            ? s.result.number
                            : "查看采购单"}
                        </Link>
                      )}
                    {s.result?.receiptVerified === true && (
                      <p className="notice success">
                        已核对采购明细全部入库，库存已更新。
                      </p>
                    )}
                    {s.status === "waiting" && (
                      <p className="muted">
                        等待业务单据完成审批与办理，完成后自动继续。
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}
        </DataResult>
      </Dialog>
      <AiTaskPanel tenantKey={tenantKey} appId={appId} />
      <ConfirmDialog
        open={Boolean(pending)}
        confirmLabel={
          pending?.action === "confirm"
            ? "确认执行计划"
            : pending?.action === "retry"
              ? "重试未完成步骤"
              : "取消后续执行"
        }
        title={
          pending?.action === "confirm"
            ? "确认执行此计划？"
            : pending?.action === "retry"
              ? "重试未完成步骤？"
              : "取消后续执行？"
        }
        description={
          pending?.action === "confirm"
            ? "请核对计划步骤与采购信息。确认后执行草稿创建和提交，企业审批仍由指定审批人办理。"
            : pending?.action === "retry"
              ? "系统将核对已有业务回执，从未完成步骤继续。"
              : "已提交的业务单据会保留，请到单据详情继续处理。"
        }
        busy={busy}
        error={message}
        onCancel={() => setPending(null)}
        onConfirm={() => void act()}
      />
    </>
  );
}
