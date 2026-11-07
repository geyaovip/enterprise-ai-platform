import { RecordActions, PagedCollection } from "../components";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { aiApi, api, errorText, tenantApi } from "../api";
import { useApiData } from "../hooks";
import { useServices } from "@suite/frontend/services";
import {
  Dialog,
  Empty,
  InfoTip,
  Loading,
  Notice,
  Status,
  ConfirmDialog,
} from "../components";
type Job = {
  id: string;
  kind: string;
  status: string;
  createdAt: string;
  result?: {
    answer?: string;
    draft?: {
      party?: { name: string; code: string };
      note?: string;
      lines: Array<{
        sku: string;
        quantity: number;
        product?: { name: string; unit?: string };
      }>;
    };
    missingReferences?: string[];
  };
  source?: { type: string; id?: string };
};
export function AiTaskPanel({ tenantKey,appId="erp" }: { tenantKey: string; appId?:string }) {
  const scopeApi=(path:string)=>appId==="erp"?aiApi(tenantKey,path):tenantApi(tenantKey,"/apps/"+appId+"/ai"+path);
  const [params, setParams] = useSearchParams(),
    selected = params.get("aiTask");
  const service = useServices();
  const jobs = useApiData<Job[]>(
    service.data?.ai.enabled && appId ? scopeApi("/tasks") : null,
  );
  const [stopping, setStopping] = useState(false),
    [stopPending, setStopPending] = useState(false),
    [stopError, setStopError] = useState<string | null>(null),
    stopLock = useRef(false);
  const detail = useApiData<Job>(
      selected && appId ? scopeApi(`/tasks/${selected}`) : null,
    ),
    job = detail.data;
  const select = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("aiTask", id);
    else next.delete("aiTask");
    setParams(next);
  };
  useEffect(() => {
    if (
      !jobs.data?.some((j) => ["queued", "running"].includes(j.status)) &&
      !["queued", "running"].includes(job?.status ?? "")
    )
      return;
    const timer = setInterval(() => {
      void jobs.reload();
      if (selected) void detail.reload();
    }, 3000);
    return () => clearInterval(timer);
  }, [jobs.data, jobs.reload, detail.reload, selected, job?.status]);
  useEffect(() => {
    setStopPending(false);
    setStopError(null);
  }, [selected, tenantKey]);
  const stop = async () => {
    if (!job || stopLock.current) return;
    stopLock.current = true;
    setStopping(true);
    setStopError(null);
    try {
      await api.post(scopeApi(`/tasks/${job.id}/cancel`), {});
      setStopPending(false);
      await Promise.all([detail.reload(), jobs.reload()]);
    } catch (e) {
      setStopError(errorText(e));
      await Promise.all([detail.reload(), jobs.reload()]);
    } finally {
      stopLock.current = false;
      setStopping(false);
    }
  };
  return (
    <>
      {Boolean(jobs.data?.length) && (
        <section className="panel table-wrap">
          <h2>
            分析与识别任务{" "}
            <InfoTip label="分析任务记录范围">
              显示最近100条分析或识别任务中当前仍有权查看的记录。
            </InfoTip>
          </h2>
          <PagedCollection label="分析任务分页">
            <table>
              <thead>
                <tr>
                  <th>任务</th>
                  <th>状态</th>
                  <th>提交时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {jobs.data?.map((j) => (
                  <tr key={j.id}>
                    <td>
                      {j.kind === "extract" ? "单据文字识别" : "业务分析"}
                    </td>
                    <td>
                      <Status value={j.status} />
                    </td>
                    <td>{new Date(j.createdAt).toLocaleString("zh-CN")}</td>
                    <td>
                      <RecordActions>
                        <button onClick={() => select(j.id)}>查看结果</button>
                      </RecordActions>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PagedCollection>
        </section>
      )}
      <Notice text={selected ? detail.error : jobs.error} />
      <Dialog
        open={Boolean(selected && !detail.error)}
        title={job?.kind === "extract" ? "单据识别结果" : "业务分析结果"}
        onClose={() => select(null)}
        size="large"
      >
        {detail.loading && !job ? (
          <Loading />
        ) : (
          job && (
            <>
              <Status value={job.status} />
              {job.result?.answer && (
                <p className="ai-result-text">{job.result.answer}</p>
              )}
              {job.result?.draft && (
                <>
                  <p>
                    {job.result.draft.party
                      ? `${job.result.draft.party.code} · ${job.result.draft.party.name}`
                      : "供应商或客户尚未匹配"}
                  </p>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>商品</th>
                          <th>数量</th>
                        </tr>
                      </thead>
                      <tbody>
                        {job.result.draft.lines.map((line, i) => (
                          <tr key={i}>
                            <td>
                              {line.sku} · {line.product?.name ?? "未匹配商品"}
                            </td>
                            <td>
                              {line.quantity} {line.product?.unit ?? ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {job.result.draft.note && <p>{job.result.draft.note}</p>}
                  {Boolean(job.result.missingReferences?.length) && (
                    <Notice text="部分业务资料未匹配，请先核对相关编号。" />
                  )}
                </>
              )}
              {["queued", "running"].includes(job.status) && (
                <>
                  <p>任务仍在处理，完成后将收到通知。</p>
                  <button
                    disabled={stopping}
                    onClick={() => setStopPending(true)}
                  >
                    停止执行
                  </button>
                </>
              )}
              {job.status === "failed" && (
                <Notice text="本次任务未完成，请回到来源页面重新发起。" />
              )}
              {job.source && (
                <Link
                  className="button"
                  to={appId!=="erp"?`/t/${tenantKey}/${appId}/ai?type=${encodeURIComponent(job.source.type)}${job.source.id?"&id="+encodeURIComponent(job.source.id):""}`:`/t/${tenantKey}/erp/${job.source.type === "purchase" ? "purchases" : job.source.type === "contract" ? "contracts" : job.source.type === "customer" ? "customers" : "inventory"}${job.source.id && ["purchase", "contract"].includes(job.source.type) ? "/" + job.source.id : ""}`}
                >
                  查看相关业务
                </Link>
              )}
            </>
          )
        )}
      </Dialog>
      <ConfirmDialog
        open={stopPending}
        title="停止执行此任务？"
        description="停止后不再推进后续步骤，已提交的处理可能仍会完成。"
        confirmLabel="停止执行"
        busy={stopping}
        confirmDisabled={!job || !["queued", "running"].includes(job.status)}
        error={stopError}
        onCancel={() => setStopPending(false)}
        onConfirm={() => void stop()}
      />
    </>
  );
}
