import { RecordActions, ChoiceSelect } from '../components';
import { BomTaskHistory } from './BomTaskHistory';
import { usePagedArray } from '../hooks';
import {AiIntakePanel} from '../components/AiIntakePanel';
import {BomIntakePreview,bomSourceFacts,canAdoptBom,selectedBomGroup} from './BomIntakePreview';
import { useState, useEffect, useRef } from "react";
import { Routes, Route, Link, useParams, useNavigate } from "react-router-dom";
import { useApiData } from "../hooks";
import { actionName } from "@suite/frontend/labels";
import {
  PageTitle,
  Field,
  Notice,
  Empty,
  Dialog,
  DialogAction,
  Loading,
  ConfirmDialog,
} from "../components";
import {
  MesContext,
  useMes,
  base,
  api,
  labels,
  date,
  Table,
  Status,
  Result,
  useAction,
  useList,
  Picker,
  AiLink,
  useLeaveGuard,
} from "./common";
import "./mes.css";
export const mesNavigation = [
  ["", "生产概览", "mes.production.read"],
  ["materials", "物料", "mes.material.read"],
  ["boms", "BOM", "mes.bom.read"],
  ["plans", "生产计划", "mes.production.read"],
  ["orders", "工单", "mes.production.read"],
  ["reports", "报工与审核", "mes.report.read"],
  ["settings", "MES设置", "mes.settings.manage"],
  ["audit", "审计记录", "mes.audit.read"],
] as const;
export function MesPage({
  tenantKey,
}: {
  tenantKey: string;
  permissions: readonly string[];
}) {
  const meta = useApiData<any>(base(tenantKey) + "/metadata");
  useEffect(() => {
    const f = () => void meta.reload();
    window.addEventListener("focus", f);
    return () => window.removeEventListener("focus", f);
  }, [meta.reload]);
  if (meta.loading && !meta.data) return <Loading />;
  if (!meta.data) return <Notice text={meta.error ?? "没有MES访问权限"} />;
  const value = {
    tenantKey,
    base: base(tenantKey),
    prefix: `/t/${tenantKey}/mes`,
    meta: meta.data,
    can: (p: string) => meta.data.permissions.includes(p),
  };
  return (
    <MesContext.Provider value={value}>
      <div className="mes-app">
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="materials" element={<Materials />} />
          <Route path="boms" element={<Boms />} />
          <Route path="boms/new" element={<BomEditor />} />
          <Route path="boms/tasks" element={<BomTaskHistory />} />
          <Route path="boms/:id/edit" element={<BomEditor />} />
          <Route path="boms/:id" element={<BomDetail />} />
          <Route path="plans" element={<Plans />} />
          <Route path="plans/new" element={<PlanEditor />} />
          <Route path="plans/:id/edit" element={<PlanEditor />} />
          <Route path="plans/:id" element={<PlanDetail />} />
          <Route path="orders" element={<Orders />} />
          <Route path="orders/:id" element={<OrderDetail />} />
          <Route path="reports" element={<Reports />} />
          <Route path="settings" element={<Settings />} />
          <Route path="audit" element={<Audit />} />
          <Route path="ai" element={<Dashboard />} />
          <Route
            path="*"
            element={
              <Empty
                text="MES页面不存在"
                action={<Link to={value.prefix}>返回生产概览</Link>}
              />
            }
          />
        </Routes>
      </div>
    </MesContext.Provider>
  );
}
function Dashboard() {
  const c = useMes(),
    d = useApiData<any>(c.base + "/dashboard");
  return (
    <>
      <PageTitle
        title="生产概览"
        action={
          <>
            {c.can("mes.plan.write") && (
              <Link className="button primary" to={c.prefix + "/plans/new"}>
                新建计划
              </Link>
            )}
            <AiLink type="production">分析生产进展</AiLink>
          </>
        }
      />
      <Result {...d}>
        <div className="metric-grid">
          {[
            ["进行中计划", d.data?.activePlans],
            ["待完成工单", d.data?.activeOrders],
            ["待审核报工", d.data?.pendingReports],
            ["合格完成率", `${d.data?.progress ?? 0}%`],
          ].map(([name, v]) => (
            <div className="metric" key={name}>
              <span>{name}</span>
              <strong>{v}</strong>
            </div>
          ))}
        </div>
        <section className="panel form-panel">
          <h2>{d.data?.scope === "assigned" ? "我的生产任务" : "计划进度"}</h2>
          {d.data?.plans.length ? (
            d.data.plans.map((p: any) => (
              <Link
                className="mes-progress"
                key={p.id}
                to={c.prefix + "/plans/" + p.id}
              >
                <div>
                  <strong>{p.code}</strong>
                  <span className="muted">{p.productName}</span>
                </div>
                <progress
                  value={p.progress}
                  max={100}
                  aria-label={p.code + "合格进度"}
                />
                <span>
                  {p.goodQty} / {p.targetQty}
                </span>
                <Status value={p.status} />
                {p.overdue && <span className="error">逾期</span>}
              </Link>
            ))
          ) : (
            <Empty text="暂无生产计划" />
          )}
          <p className="muted">
            已审核合格 {d.data?.good} 件 · 不良 {d.data?.defect} 件
          </p>
        </section>
      </Result>
    </>
  );
}
function Materials() {
  const c = useMes(),
    d = useList("materials"),
    a = useAction(),
    [edit, setEdit] = useState<any>(null);
  const defaults = { sku: "", name: "", kind: "raw", unit: "件", active: true };
  const submit = async (e: any) => {
    e.preventDefault();
    const r = await a.write(
      c.base + "/materials" + (edit.id ? "/" + edit.id : ""),
      {
        sku: edit.sku,
        name: edit.name,
        kind: edit.kind,
        unit: edit.unit,
        active: edit.active,
        ...(edit.id ? { version: edit.version } : {}),
      },
      edit.id ? "patch" : "post",
    );
    if (r) {
      setEdit(null);
      await d.reload();
    }
  };
  return (
    <>
      <PageTitle
        title="物料"
        action={
          c.can("mes.material.write") && (
            <button
              className="primary"
              onClick={() => setEdit({ ...defaults })}
            >
              新建物料
            </button>
          )
        }
      />
      {a.notices}
      {d.filters}
      <Result {...d}>
        <Table headers={["SKU", "物料", "类型", "单位", "状态", "操作"]}>
          {d.data?.items.map((m: any) => (
            <tr key={m.id}>
              <td>{m.sku}</td>
              <td>{m.name}</td>
              <td>{labels[m.kind]}</td>
              <td>{m.unit}</td>
              <td>{m.active ? "正常" : "停用"}</td>
              <td><RecordActions>
                {c.can("mes.material.write") && (
                  <button onClick={() => setEdit({ ...m })}>编辑</button>
                )}
              </RecordActions></td>
            </tr>
          ))}
        </Table>
        {!d.data?.items.length && <Empty text="暂无物料" />}
        {d.pager}
      </Result>
      <Dialog
        open={!!edit}
        title={edit?.id ? "编辑物料" : "新建物料"}
        onClose={() => setEdit(null)}
        busy={a.busy}
        dirtyCheck
      >
        {edit && (
          <form onSubmit={submit}>
            {a.notices}
            <div className="form-grid">
              <Field label="SKU">
                <input
                  required
                  maxLength={120}
                  disabled={!!edit.id}
                  value={edit.sku}
                  onChange={(e) => setEdit({ ...edit, sku: e.target.value })}
                />
              </Field>
              <Field label="名称">
                <input
                  required
                  maxLength={120}
                  value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                />
              </Field>
              <Field label="类型">
                <select
                  disabled={!!edit.id}
                  value={edit.kind}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      kind: e.target.value,
                      unit: ["finished", "semi"].includes(e.target.value)
                        ? "件"
                        : edit.unit,
                    })
                  }
                >
                  {["finished", "semi", "raw", "packaging", "auxiliary"].map(
                    (k) => (
                      <option value={k} key={k}>
                        {labels[k]}
                      </option>
                    ),
                  )}
                </select>
              </Field>
              <Field label="基础单位">
                <input
                  required
                  maxLength={20}
                  disabled={
                    !!edit.id || ["finished", "semi"].includes(edit.kind)
                  }
                  value={edit.unit}
                  onChange={(e) => setEdit({ ...edit, unit: e.target.value })}
                />
              </Field>
              <Field label="状态">
                <select
                  value={String(edit.active)}
                  onChange={(e) =>
                    setEdit({ ...edit, active: e.target.value === "true" })
                  }
                >
                  <option value="true">正常</option>
                  <option value="false">停用</option>
                </select>
              </Field>
            </div>
            <DialogAction>
              <button type="submit" className="primary" disabled={a.busy}>
                保存物料
              </button>
            </DialogAction>
          </form>
        )}
      </Dialog>
    </>
  );
}
function Boms() {
  const c = useMes(),
    d = useList("boms");
  return (
    <>
      <PageTitle
        title="BOM"
        action={
          c.can("mes.bom.write") && (
            <div className="form-actions">{c.can("mes.ai.use")&&<Link className="button" to={c.prefix+"/boms/tasks"}>整理任务</Link>}<Link className="button primary" to={c.prefix + "/boms/new"}>新建BOM</Link></div>
          )
        }
      />
      {d.filters}
      <Result {...d}>
        <Table headers={["产品SKU", "产品", "修订", "状态", "组件", "操作"]}>
          {d.data?.items.map((b: any) => (
            <tr key={b.id}>
              <td>{b.productSku}</td>
              <td>{b.productName}</td>
              <td>v{b.revision}</td>
              <td>
                <Status value={b.status} />
              </td>
              <td>{b.lines.length}</td>
              <td><RecordActions>
                <Link to={c.prefix + "/boms/" + b.id}>查看</Link>
              </RecordActions></td>
            </tr>
          ))}
        </Table>
        {!d.data?.items.length && <Empty text="暂无BOM" />}
        {d.pager}
      </Result>
    </>
  );
}
function BomEditor() {
  const c = useMes(),
    { id } = useParams(),
    navigate = useNavigate(),
    d = useApiData<any>(id ? c.base + "/boms/" + id : null),
    a = useAction(),
    [draft, setDraft] = useState<any>({
      productId: "",
      productName: "",
      note: "",
      lines: [],
    }),
    [dirty, setDirty] = useState(false),
    [reviewDirty,setReviewDirty]=useState(false),
    guard = useLeaveGuard(dirty||reviewDirty);
  useEffect(() => {
    if (d.data)
      setDraft({ ...d.data, lines: d.data.lines.map((l: any) => ({ ...l })) });
  }, [d.data]);
  const change = (v: any) => {
    const sameUnit=(a:string,b:string)=>{const key=(x:string)=>['pcs','pc','ea','piece','pieces','件','个'].includes((x??'').toLowerCase())?'piece':(x??'').toLowerCase();return key(a)===key(b);};
    const lines=v.lines.map((line:any)=>{
      const previous=draft.lines.find((old:any)=>line.id?old.id===line.id:line.clientId?old.clientId===line.clientId:old===line);
      if(!previous||!line.sourceEvidence)return line;
      const productChanged=v.productId!==draft.productId,materialChanged=line.materialId!==previous.materialId;
      if(!productChanged&&!materialChanged&&line.quantity===previous.quantity&&line.wastePercent===previous.wastePercent)return line;
      return {...line,...(materialChanged&&!sameUnit(previous.unit,line.unit)?{quantity:''}:{}),sourceEvidence:{...line.sourceEvidence,hasConflict:true,factReviewed:false,...(productChanged||materialChanged?{historyMatch:undefined}:{} )}};
    });
    setDraft({...v,lines});
    setDirty(true);
  };
  if (!c.can("mes.bom.write")) return <Empty text="没有BOM编辑权限" />;
  return (
    <>
      <PageTitle
        title={id ? "编辑BOM草稿" : "新建BOM草稿"}
        back={<Link to={c.prefix + "/boms"}>返回BOM</Link>}
      />
      <Notice text={d.error} />
      {a.notices}
      <form
        className="panel form-panel"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await a.write(
            c.base + "/boms" + (id ? "/" + id : ""),
            {
              ...(id ? { version: d.data.version } : {}),
              draft: {
                productId: draft.productId,
                note: draft.note,
                lines: draft.lines.map((l: any) => ({
                  materialId: l.materialId,
                  quantity: l.quantity,
                  wastePercent: l.wastePercent,
                  ...(l.sourceEvidence?{sourceEvidence:l.sourceEvidence}:{}),
                })),
              },
            },
            id ? "patch" : "post",
          );
          if (r) {
            guard.allow();
            setDirty(false);
            navigate(c.prefix + "/boms/" + r.id);
          }
        }}
      >
        <fieldset disabled={a.busy || (!!id && !d.data)}>
          {id ? (
            <Field label="产品">
              <input readOnly value={draft.productName} />
            </Field>
          ) : (
            <Picker
              label="产品"
              type="materials"
              kind="production"
              value={draft.productId}
              selectedLabel={draft.productName}
              onChange={(m) =>
                change({
                  ...draft,
                  productId: m?.id ?? "",
                  productName: m?.name ?? "",
                })
              }
            />
          )}
          <h2>组件</h2>
          {draft.lines.map((l: any, n: number) => (
            <div className="mes-line" key={l.id ?? l.clientId ?? n}>
              <Picker
                label={`组件 ${n + 1}`}
                type="materials"
                value={l.materialId}
                selectedLabel={l.name}
                onChange={(m) => {
                  change({
                    ...draft,
                    lines: draft.lines.map((v: any, i: number) =>
                      i === n
                        ? {
                            ...v,
                            materialId: m?.id ?? "",
                            name: m?.name ?? "",
                            unit: m?.unit ?? "",
                          }
                        : v,
                    ),
                  });
                }}
              />
              <Field label={"单件用量" + (l.unit ? "（" + l.unit + "）" : "")}>
                <input
                  required
                  inputMode="decimal"
                  pattern="[0-9]+(\.[0-9]{1,3})?"
                  value={l.quantity}
                  onChange={(e) =>
                    change({
                      ...draft,
                      lines: draft.lines.map((v: any, i: number) =>
                        i === n ? { ...v, quantity: e.target.value } : v,
                      ),
                    })
                  }
                />
              </Field>
              <Field label="损耗率 %">
                <input
                  required
                  inputMode="decimal"
                  value={l.wastePercent}
                  onChange={(e) =>
                    change({
                      ...draft,
                      lines: draft.lines.map((v: any, i: number) =>
                        i === n ? { ...v, wastePercent: e.target.value } : v,
                      ),
                    })
                  }
                />
              </Field>
              <button
                type="button"
                aria-label={"移除组件" + (n + 1)}
                onClick={() =>
                  change({
                    ...draft,
                    lines: draft.lines.filter((_: any, i: number) => i !== n),
                  })
                }
              >
                移除
              </button>
              {l.sourceEvidence&&<div className="mes-source-review"><p>本次物料：{l.name||'待选择'}{l.unit?' · '+l.unit:''}</p><small>{l.sourceEvidence.filename}{l.sourceEvidence.page?` · 第${l.sourceEvidence.page}页`:''} · 来源行 {l.sourceEvidence.row}</small>{(l.sourceEvidence.hasConflict||l.sourceEvidence.historyMatch||l.sourceEvidence.quantityBasis||['ocr-cells','manual-source'].includes(l.sourceEvidence.method))&&<label className="check"><input type="checkbox" checked={Boolean(l.sourceEvidence.factReviewed)} onChange={e=>change({...draft,lines:draft.lines.map((v:any,i:number)=>i===n?{...v,sourceEvidence:{...v.sourceEvidence,factReviewed:e.target.checked,factReview:e.target.checked?{productId:draft.productId,materialId:v.materialId,quantity:v.quantity,unit:v.unit,...(v.sourceEvidence.selectedVariant?{selectedVariant:v.sourceEvidence.selectedVariant}:{})}:v.sourceEvidence.factReview}}:v)})}/>已重新核实组件{n+1}的物料、用量和适用产品</label>}</div>}
            </div>
          ))}
          <button
            type="button"
            disabled={draft.lines.length >= 200}
            onClick={() =>
              change({
                ...draft,
                lines: [
                  ...draft.lines,
                  {
                    clientId: crypto.randomUUID(),
                    materialId: "",
                    quantity: "1",
                    wastePercent: "0",
                  },
                ],
              })
            }
          >
            添加组件
          </button>
          <Field label="备注">
            <textarea
              maxLength={2000}
              value={draft.note}
              onChange={(e) => change({ ...draft, note: e.target.value })}
            />
          </Field>
          <button
            className="primary"
            disabled={!draft.lines.length||draft.lines.some((l:any)=>l.sourceEvidence&&(l.sourceEvidence.hasConflict||l.sourceEvidence.historyMatch||l.sourceEvidence.quantityBasis||['ocr-cells','manual-source'].includes(l.sourceEvidence.method))&&!l.sourceEvidence.factReviewed)}
            type="submit"
          >
            保存草稿
          </button>
        </fieldset>
      </form>
      <AiIntakePanel<any> onReviewDirtyChange={setReviewDirty} key={c.tenantKey+(id??'new')} tenantKey={c.tenantKey} appId="mes" kind="bom" title="从图纸明细或资料整理BOM" placeholder={'可直接从Excel复制明细，或粘贴带表头的清单，例如：\n父件编码\t物料编码\t物料名称\t单件用量\t单位'} documentIntake productId={draft.productId||undefined} enabled={c.can('mes.material.read')} formStamp={JSON.stringify(draft)} hasValues={Boolean(draft.productId||draft.lines.length)}
        canApply={r=>canAdoptBom(r,id?draft.productId:undefined)}
        render={(r,update,source)=><BomIntakePreview result={r} update={update} documents={source.documents} currentProductId={id?draft.productId:undefined}/>}
        onApply={r=>{const g=selectedBomGroup(r),lines=g.lines.filter((l:any)=>!l.excluded);change({...draft,...(!id?{productId:g.product.id,productName:g.product.name}:{}),lines:lines.map((l:any)=>({clientId:crypto.randomUUID(),materialId:l.material.id,name:l.material.name,unit:l.material.unit,quantity:l.quantity,wastePercent:l.wastePercent??'0',sourceEvidence:{...bomSourceFacts(l),filename:l.locator.filename,sha256:l.locator.sha256,page:l.locator.page,sheet:l.locator.sheet,table:l.locator.table,row:l.locator.row,method:l.locator.method,originalSku:l.sku,originalQuantity:l.sourceQuantity,originalUnit:l.sourceUnit,mpn:l.mpn,manufacturer:l.manufacturer,designators:l.designators,population:l.population,revision:l.revision,productCode:l.productCode,sourceObjectId:l.sourceObjectId,sourceDesignator:l.sourceDesignator,sourceDesignators:l.sourceDesignators,sourceUniqueId:l.sourceUniqueId,sourceHierarchy:l.sourceHierarchy,footprint:l.footprint,quantityBasis:l.quantityBasis,historyMatch:l.historyMatch,factReview:l.factReviewed?{productId:g.product.id,materialId:l.material.id,quantity:l.quantity,unit:l.material.unit,...(l.selectedVariant?{selectedVariant:l.selectedVariant}:{})}:undefined,reviewNote:l.reviewNote,...(l.locator.bbox&&l.locator.pageSize?{bbox:l.locator.bbox,pageSize:l.locator.pageSize}:{}),hasConflict:Boolean(l.conflict),factReviewed:Boolean(l.factReviewed),reviewed:true}})),note:[draft.note,...lines.map((l:any,n:number)=>`明细${n+1}：${l.sku||l.name} ${l.evidence}`)].filter(Boolean).join('；').slice(0,2000)});}}/>
      {guard.dialog}
    </>
  );
}
function BomDetail() {
  const c = useMes(),
    { id } = useParams(),
    navigate = useNavigate(),
    d = useApiData<any>(c.base + "/boms/" + id),
    a = useAction(),
    [confirm, setConfirm] = useState(false),
    [decisions, setDecisions] = useState<Record<string, any>>({});
  const b = d.data,
    review = b?.review;
  useEffect(
    () =>
      setDecisions(
        Object.fromEntries(
          (review?.decisions ?? []).map((x: any) => [x.findingId, x]),
        ),
      ),
    [review?.id, review?.version],
  );
  return (
    <>
      <PageTitle
        title={b ? `${b.productName} · BOM v${b.revision}` : "BOM详情"}
        back={<Link to={c.prefix + "/boms"}>返回BOM</Link>} action={<>

            {b?.status === "draft" && c.can("mes.bom.write") && (
              <Link className="button" to={c.prefix + "/boms/" + id + "/edit"}>
                编辑
              </Link>
            )}
            {b && c.can("mes.bom.write") && (
              <button
                onClick={async () => {
                  const r = await a.write(c.base + "/boms", {
                    draft: {
                      productId: b.productId,
                      note: b.note,
                      lines: b.lines.map((l: any) => ({
                        materialId: l.materialId,
                        quantity: l.quantity,
                        wastePercent: l.wastePercent,
                        ...(l.sourceEvidence?{sourceEvidence:{...l.sourceEvidence,...(b.status==="published"&&l.sourceEvidence.historyMatch?{historyMatch:{bomId:b.id,revision:b.revision,version:b.version}}:{})}}:{}),
                      })),
                    },
                  });
                  if (r) navigate(c.prefix + "/boms/" + r.id);
                }}
                disabled={a.busy}
              >
                创建新修订
              </button>
            )}
            {b?.status === "draft" && c.can("mes.bom.publish") && (
              <button className="primary" onClick={() => setConfirm(true)}>
                发布BOM
              </button>
            )}
            <AiLink type="bom" id={id}>
              AI核查BOM
            </AiLink>
          </>}
      />
      {a.notices}
      <Result {...d}>
        {b && (
          <>
            <section className="panel form-panel">
              <div className="toolbar">
                <Status value={b.status} />
                <span>{b.productSku}</span>
              </div>
              <Table paginate
                headers={["物料SKU", "物料", "单件用量", "单位", "损耗率"]}
              >
                {b.lines.map((l: any) => (
                  <tr key={l.id}>
                    <td>{l.sku}</td>
                    <td>{l.name}</td>
                    <td>{l.quantity}</td>
                    <td>{l.unit}</td>
                    <td>{l.wastePercent}%</td>
                  </tr>
                ))}
              </Table>
              {b.note && <p>{b.note}</p>}
            </section>
            {review && (
              <section className="panel form-panel">
                <h2>当前版本审查</h2>
                {review.findings.length ? (
                  review.findings.map((f: any) => (
                    <div key={f.id} className="mes-finding">
                      <strong>
                        {f.severity === "critical" ? "重点风险" : "提醒"} ·{" "}
                        {b.lines.find((l: any) => l.id === f.lineId)?.name ??
                          "整体"}
                      </strong>
                      <p>{f.message}</p>
                      {b.status === "draft" && c.can("mes.bom.write") ? (
                        <div className="form-grid">
                          <Field label="处理结论">
                            <select
                              value={decisions[f.id]?.decision ?? ""}
                              onChange={(e) =>
                                setDecisions({
                                  ...decisions,
                                  [f.id]: {
                                    ...decisions[f.id],
                                    decision: e.target.value,
                                    findingId: f.id,
                                  },
                                })
                              }
                            >
                              <option value="">请选择</option>
                              <option value="verified_retain">
                                已核实，保留设计
                              </option>
                              <option value="false_positive">误报</option>
                            </select>
                          </Field>
                          <Field label="核实依据">
                            <input
                              minLength={4}
                              maxLength={1000}
                              value={decisions[f.id]?.reason ?? ""}
                              onChange={(e) =>
                                setDecisions({
                                  ...decisions,
                                  [f.id]: {
                                    ...decisions[f.id],
                                    reason: e.target.value,
                                    findingId: f.id,
                                  },
                                })
                              }
                            />
                          </Field>
                        </div>
                      ) : (
                        <p>{decisions[f.id]?.reason ?? "待处理"}</p>
                      )}
                    </div>
                  ))
                ) : (
                  <p>本轮未记录审查问题</p>
                )}
                {b.status === "draft" &&
                  review.findings.length > 0 &&
                  c.can("mes.bom.write") && (
                    <button
                      className="primary"
                      disabled={
                        a.busy ||
                        review.findings.some(
                          (f: any) =>
                            !decisions[f.id]?.decision ||
                            decisions[f.id]?.reason?.trim().length < 4,
                        )
                      }
                      onClick={async () => {
                        if (
                          await a.write(
                            c.base + "/boms/" + id + "/review-resolution",
                            {
                              version: b.version,
                              reviewId: review.id,
                              reviewVersion: review.version,
                              decisions: Object.values(decisions),
                            },
                          )
                        )
                          await d.reload();
                      }}
                    >
                      保存处理结论
                    </button>
                  )}
              </section>
            )}
          </>
        )}
      </Result>
      <ConfirmDialog
        open={confirm}
        confirmLabel="发布BOM" title="发布此版BOM？"
        description="同产品的上一发布版本将归档，已有计划继续使用原版本。"
        busy={a.busy}
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          if (
            await a.write(c.base + "/boms/" + id + "/publish", {
              version: b.version,
            })
          ) {
            setConfirm(false);
            await d.reload();
          }
        }}
      />
    </>
  );
}
function Plans() {
  const c = useMes(),
    d = useList("plans");
  return (
    <>
      <PageTitle
        title="生产计划"
        action={
          c.can("mes.plan.write") && (
            <Link className="button primary" to={c.prefix + "/plans/new"}>
              新建计划
            </Link>
          )
        }
      />
      {d.filters}
      <Result {...d}>
        <Table
          headers={["计划编号", "产品", "计划量", "截止时间", "状态", "操作"]}
        >
          {d.data?.items.map((p: any) => (
            <tr key={p.id}>
              <td>{p.code}</td>
              <td>{p.productName}</td>
              <td>{p.targetQty ?? "受派范围"}</td>
              <td>{date(p.dueAt)}</td>
              <td>
                <Status value={p.status} />
              </td>
              <td><RecordActions>
                <Link to={c.prefix + "/plans/" + p.id}>查看</Link>
              </RecordActions></td>
            </tr>
          ))}
        </Table>
        {!d.data?.items.length && <Empty text="暂无计划" />}
        {d.pager}
      </Result>
    </>
  );
}
function Requirements({ items }: { items: any[] }) {
  return (
    <Table paginate headers={["物料SKU", "物料", "需求量", "单位"]}>
      {items.map((l) => (
        <tr key={l.materialId}>
          <td>{l.sku}</td>
          <td>{l.name}</td>
          <td>{l.quantity}</td>
          <td>{l.unit}</td>
        </tr>
      ))}
    </Table>
  );
}
function PlanEditor() {
  const c = useMes(),
    { id } = useParams(),
    navigate = useNavigate(),
    d = useApiData<any>(id ? c.base + "/plans/" + id : null),
    a = useAction(),
    [draft, setDraft] = useState<any>({
      code: "",
      productId: "",
      bomId: "",
      targetQty: 1,
      dueAt: "",
      note: "",
    }),
    [preview, setPreview] = useState<any>(null),
    [previewBusy, setPreviewBusy] = useState(false),
    revision = useRef(0),
    [error, setError] = useState<string | null>(null),
    [dirty, setDirty] = useState(false),
    guard = useLeaveGuard(dirty);
  useEffect(() => {
    if (d.data) {
      const p = d.data;
      setDraft({
        code: p.code,
        productId: p.productId,
        bomId: p.bomId,
        targetQty: p.targetQty,
        dueAt: new Date(
          new Date(p.dueAt).getTime() - new Date().getTimezoneOffset() * 60000,
        )
          .toISOString()
          .slice(0, 16),
        note: p.note,
      });
    }
  }, [d.data]);
  const change = (v: any) => {
    setDraft(v);
    setDirty(true);
    setPreview(null);
    revision.current++;
  };
  const wire = () => ({
    ...draft,
    targetQty: Number(draft.targetQty),
    dueAt: new Date(draft.dueAt).toISOString(),
  });
  if (!c.can("mes.plan.write")) return <Empty text="没有计划编辑权限" />;
  return (
    <>
      <PageTitle
        title={id ? "编辑生产计划" : "新建生产计划"}
        back={<Link to={c.prefix + "/plans"}>返回计划</Link>}
      />
      {a.notices}
      <Notice text={d.error ?? error} />
      <form
        className="panel form-panel"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await a.write(
            c.base + "/plans" + (id ? "/" + id : ""),
            { draft: wire(), ...(id ? { version: d.data.version } : {}) },
            id ? "patch" : "post",
          );
          if (r) {
            guard.allow();
            setDirty(false);
            navigate(c.prefix + "/plans/" + r.id);
          }
        }}
      >
        <fieldset disabled={a.busy || (!!id && !d.data)}>
          <div className="form-grid">
            <Field label="计划编号">
              <input
                required
                maxLength={120}
                value={draft.code}
                onChange={(e) => change({ ...draft, code: e.target.value })}
              />
            </Field>
            <Picker
              label="已发布BOM"
              type="boms"
              status="published"
              value={draft.bomId}
              selectedLabel={d.data?.productName}
              onChange={(b) =>
                change({
                  ...draft,
                  bomId: b?.id ?? "",
                  productId: b?.productId ?? "",
                })
              }
            />
            <Field label="计划量（件）">
              <input
                required
                type="number"
                min={1}
                max={10000000}
                step={1}
                value={draft.targetQty}
                onChange={(e) =>
                  change({ ...draft, targetQty: e.target.value })
                }
              />
            </Field>
            <Field label="截止时间">
              <input
                required
                type="datetime-local"
                value={draft.dueAt}
                onChange={(e) => change({ ...draft, dueAt: e.target.value })}
              />
            </Field>
          </div>
          <Field label="备注">
            <textarea
              value={draft.note}
              maxLength={2000}
              onChange={(e) => change({ ...draft, note: e.target.value })}
            />
          </Field>
          <div className="toolbar">
            <button
              type="button"
              disabled={previewBusy}
              onClick={async (e) => {
                if (!e.currentTarget.closest("form")?.reportValidity()) return;
                const stamp = revision.current;
                setPreviewBusy(true);
                try {
                  setError(null);
                  const value = await api.post(
                    c.base + "/plans/preview",
                    wire(),
                  );
                  if (stamp === revision.current) setPreview(value);
                } catch (err: any) {
                  if (stamp === revision.current) setError(err.message);
                } finally {
                  setPreviewBusy(false);
                }
              }}
            >
              预览物料需求
            </button>
            <button className="primary" type="submit">
              保存计划草稿
            </button>
          </div>
        </fieldset>
      </form>
      {preview && (
        <section className="panel form-panel">
          <h2>物料需求预览</h2>
          <Requirements items={preview.requirements} />
        </section>
      )}
      {guard.dialog}
    </>
  );
}
function PlanDetail() {
  const c = useMes(),
    { id } = useParams(),
    d = useApiData<any>(c.base + "/plans/" + id),
    members = useApiData<any[]>(c.base + "/members"),
    a = useAction(),
    [action, setAction] = useState(""),
    [dispatch, setDispatch] = useState(false),
    [form, setForm] = useState({
      code: "",
      operation: "",
      targetQty: 1,
      assigneeId: "",
    }),
    p = d.data;
  return (
    <>
      <PageTitle
        title={p?.code ?? "计划详情"}
        back={<Link to={c.prefix + "/plans"}>返回计划</Link>} action={<>

            {p?.status === "draft" && c.can("mes.plan.write") && (
              <Link className="button" to={c.prefix + "/plans/" + id + "/edit"}>
                编辑
              </Link>
            )}
            {p?.status === "draft" && c.can("mes.plan.publish") && (
              <button className="primary" onClick={() => setAction("release")}>
                发布计划
              </button>
            )}
            {p?.status === "released" &&
              c.can("mes.order.write") &&
              p.orders
                .filter((o: any) => o.status !== "cancelled")
                .reduce((n: number, o: any) => n + o.targetQty, 0) <
                p.targetQty && (
                <button className="primary" onClick={() => setDispatch(true)}>
                  派发工单
                </button>
              )}
            {["draft", "released"].includes(p?.status) &&
              !p?.orders.some((o: any) => o.status !== "cancelled") &&
              c.can("mes.plan.publish") && (
                <button onClick={() => setAction("cancel")}>取消计划</button>
              )}
            <AiLink type="plan" id={id}>
              分析计划
            </AiLink>
          </>}
      />
      {a.notices}
      <Result {...d}>
        {p && (
          <>
            <section className="panel form-panel">
              <h2>
                {p.productName} <Status value={p.status} />
              </h2>
              <div className="mes-details">
                <span>SKU：{p.productSku}</span>
                {p.targetQty !== undefined && (
                  <span>计划量：{p.targetQty} 件</span>
                )}
                <span>截止：{date(p.dueAt)}</span>
                {p.bomRevision && <span>BOM：v{p.bomRevision}</span>}
              </div>
              {p.note && <p>{p.note}</p>}
            </section>
            {p.requirements && (
              <section className="panel form-panel">
                <h2>计划物料需求</h2>
                <Requirements items={p.requirements} />
              </section>
            )}
            <section className="panel form-panel">
              <h2>工单</h2>
              <OrderRows items={p.orders} members={members.data ?? []} />
              {!p.orders.length && <Empty text="暂无工单" />}
            </section>
          </>
        )}
      </Result>
      <ConfirmDialog
        open={!!action}
        confirmLabel={action === "release" ? "发布计划" : "取消计划"} title={action === "release" ? "发布计划？" : "取消计划？"}
        description={
          action === "release"
            ? "发布后按已核对的BOM与物料需求执行，可以派发工单。"
            : "取消后不能继续派工。"
        }
        busy={a.busy}
        onCancel={() => setAction("")}
        onConfirm={async () => {
          if (
            await a.write(c.base + "/plans/" + id + "/actions", {
              version: p.version,
              action,
            })
          ) {
            setAction("");
            await d.reload();
          }
        }}
      />
      <Dialog
        open={dispatch}
        title="派发工单"
        onClose={() => setDispatch(false)}
        busy={a.busy}
        dirtyCheck
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await a.write(c.base + "/plans/" + id + "/orders", {
                ...form,
                version: p.version,
              })
            ) {
              setDispatch(false);
              await d.reload();
            }
          }}
        >
          {a.notices}
          <div className="form-grid">
            <Field label="工单编号">
              <input
                required
                maxLength={120}
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
              />
            </Field>
            <Field label="作业内容">
              <input
                required
                maxLength={120}
                value={form.operation}
                onChange={(e) =>
                  setForm({ ...form, operation: e.target.value })
                }
              />
            </Field>
            <Field label="计划量（件）">
              <input
                required
                type="number"
                min={1}
                max={p?.targetQty ?? 10000000}
                value={form.targetQty}
                onChange={(e) =>
                  setForm({ ...form, targetQty: Number(e.target.value) })
                }
              />
            </Field>
            <ChoiceSelect label="受派人" required
                value={form.assigneeId}
                onChange={(e) =>
                  setForm({ ...form, assigneeId: e.target.value })
                }><option value="">请选择</option>{members.data
                  ?.filter((m) => ["admin", "operator"].includes(m.role))
                  .map((m) => (
                    <option value={m.id} key={m.id}>
                      {m.name}
                    </option>
                  ))}</ChoiceSelect>
          </div>
          <DialogAction>
            <button className="primary" type="submit" disabled={a.busy}>
              确认派发
            </button>
          </DialogAction>
        </form>
      </Dialog>
    </>
  );
}
function OrderRows({ items, members }: { items: any[]; members: any[] }) {
  const c = useMes();
  return (
    <Table
      headers={[
        "工单",
        "作业",
        "受派人",
        "计划量",
        "合格 / 不良",
        "状态",
        "操作",
      ]}
    >
      {items.map((o) => (
        <tr key={o.id}>
          <td>{o.code}</td>
          <td>{o.operation}</td>
          <td>
            {members.find((m) => m.id === o.assigneeId)?.name ?? "已离职成员"}
          </td>
          <td>{o.targetQty}</td>
          <td>
            {o.goodQty} / {o.defectQty}
          </td>
          <td>
            <Status value={o.status} />
          </td>
          <td><RecordActions>
            <Link to={c.prefix + "/orders/" + o.id}>
              {o.assigneeId === c.meta.membershipId && c.can("mes.report.write")
                ? o.status === "in_progress"
                  ? "去报工"
                  : o.status === "ready"
                    ? "去开工"
                    : "查看"
                : "查看"}
            </Link>
          </RecordActions></td>
        </tr>
      ))}
    </Table>
  );
}
function Orders() {
  const c = useMes(),
    d = useList("orders"),
    members = useApiData<any[]>(c.base + "/members");
  return (
    <>
      <PageTitle
        title={c.meta.ownOnly ? "我的工单" : "工单"}
        action={<AiLink>分析工单进展</AiLink>}
      />
      {d.filters}
      <Result {...d}>
        <OrderRows items={d.data?.items ?? []} members={members.data ?? []} />
        {!d.data?.items.length && (
          <Empty
            text="暂无符合条件的工单"
            action={c.meta.ownOnly && d.status === "in_progress" ? (
              <Link to={c.prefix + "/orders?status=ready"}>查看待开工工单</Link>
            ) : undefined}
          />
        )}
        {d.pager}
      </Result>
    </>
  );
}
function OrderDetail() {
  const c = useMes(),
    { id } = useParams(),
    d = useApiData<any>(c.base + "/orders/" + id),
    a = useAction(),
    [action, setAction] = useState(""),
    [report, setReport] = useState(false),
    [form, setForm] = useState({ goodQty: "0", defectQty: "0", note: "" }),
    o = d.data,
    own = o?.assigneeId === c.meta.membershipId,
    pendingQty = (o?.reports ?? []).filter((r: any) => r.status === "pending").reduce((n: number, r: any) => n + r.goodQty + r.defectQty, 0),
    remainingQty = Math.max(0, (o?.targetQty ?? 0) - (o?.goodQty ?? 0) - (o?.defectQty ?? 0) - pendingQty),
    validReport = form.goodQty !== "" && form.defectQty !== "" && [form.goodQty, form.defectQty].every(q => Number.isInteger(Number(q)) && Number(q) >= 0) && Number(form.goodQty) + Number(form.defectQty) > 0 && Number(form.goodQty) + Number(form.defectQty) <= remainingQty;
  return (
    <>
      <PageTitle
        title={o?.code ?? "工单详情"}
        back={<Link to={c.prefix + "/orders"}>返回工单</Link>} action={<>

            {own && o?.status === "ready" && c.can("mes.report.write") && (
              <button className="primary" onClick={() => setAction("start")}>
                开工
              </button>
            )}
            {own &&
              o?.status === "in_progress" &&
              c.can("mes.report.write") && (
                <button className="primary" disabled={remainingQty === 0} title={remainingQty === 0 ? "已有报工占满计划量，请等待审核结果" : undefined} onClick={() => setReport(true)}>
                  {remainingQty === 0 ? "等待报工审核" : "提交报工"}
                </button>
              )}
            {["ready", "in_progress"].includes(o?.status) &&
              !o?.reports.length &&
              c.can("mes.order.write") && (
                <button onClick={() => setAction("cancel")}>取消工单</button>
              )}
            <AiLink type="order" id={id}>
              分析工单
            </AiLink>
          </>}
      />
      {a.notices}
      <Result {...d}>
        {o && (
          <>
            <section className="panel form-panel">
              <h2>
                {o.operation} <Status value={o.status} />
              </h2>
              <div className="mes-details">
                <Link to={c.prefix + "/plans/" + o.planId}>
                  计划：{o.plan.code}
                </Link>
                <span>产品：{o.plan.productName}</span>
                <span>计划量：{o.targetQty} 件</span>
                <span>已审核合格：{o.goodQty} 件</span>
                <span>已审核不良：{o.defectQty} 件</span>
              </div>
              <progress
                value={o.goodQty}
                max={o.targetQty}
                aria-label="工单合格进度"
              />
            </section>
            <section className="panel form-panel">
              <h2>报工记录</h2>
              <ReportRows items={o.reports} onReviewed={d.reload} />
              {!o.reports.length && <Empty text="暂无报工" />}
            </section>
          </>
        )}
      </Result>
      <ConfirmDialog
        open={!!action}
        confirmLabel={action === "start" ? "开始工单" : "取消工单"} title={action === "start" ? "开始此工单？" : "取消此工单？"}
        description={
          action === "start"
            ? "开工后可以提交分批报工。"
            : "工单取消后释放计划分配数量。已有报工不能取消。"
        }
        busy={a.busy}
        onCancel={() => setAction("")}
        onConfirm={async () => {
          if (
            await a.write(c.base + "/orders/" + id + "/actions", {
              version: o.version,
              action,
            })
          ) {
            setAction("");
            await d.reload();
          }
        }}
      />
      <Dialog
        open={report}
        title="提交报工"
        onClose={() => setReport(false)}
        busy={a.busy}
        dirtyCheck
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!validReport) return;
            if (
              await a.write(c.base + "/orders/" + id + "/reports", {
                version: o.version,
                ...form,
                goodQty: Number(form.goodQty),
                defectQty: Number(form.defectQty),
              })
            ) {
              setReport(false);
              setForm({ goodQty: "0", defectQty: "0", note: "" });
              await d.reload();
            }
          }}
        >
          {a.notices}
          <p className="muted">剩余可报 {remainingQty} 件 · 待审核 {pendingQty} 件</p>
          <div className="form-grid">
            {(["goodQty", "defectQty"] as const).map((k) => (
              <Field
                key={k}
                label={k === "goodQty" ? "合格数量（件）" : "不良数量（件）"}
              >
                <input
                  required
                  type="number"
                  min={0}
                  max={remainingQty}
                  step={1}
                  value={form[k]}
                  onChange={(e) =>
                    setForm({ ...form, [k]: e.target.value })
                  }
                />
              </Field>
            ))}
          </div>
          <Field label="备注">
            <textarea
              maxLength={2000}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </Field>
          <DialogAction>
            <button
              className="primary"
              type="submit"
              disabled={a.busy || !validReport}
            >
              提交审核
            </button>
          </DialogAction>
        </form>
      </Dialog>
    </>
  );
}
function ReportRows({
  items,
  onReviewed,
}: {
  items: any[];
  onReviewed: () => Promise<any>;
}) {
  const c = useMes(),
    members = useApiData<any[]>(c.base + "/members"),
    a = useAction(),
    [review, setReview] = useState<any>(null),
    [reason, setReason] = useState("");
  return (
    <>
      {a.notices}
      <Table
        headers={[
          "提交时间",
          "报工人",
          "工单",
          "合格",
          "不良",
          "备注 / 审核意见",
          "状态",
          "操作",
        ]}
      >
        {items.map((r) => (
          <tr key={r.id}>
            <td>{date(r.createdAt)}</td>
            <td>
              {members.data?.find((m) => m.id === r.reporterId)?.name ??
                "已离职成员"}
            </td>
            <td><RecordActions>
              <Link to={c.prefix + "/orders/" + r.orderId}>查看工单</Link>
            </RecordActions></td>
            <td>{r.goodQty}</td>
            <td>{r.defectQty}</td>
            <td>
              {r.note}
              {r.reason && <p>{r.reason}</p>}
            </td>
            <td>
              <Status value={r.status} />
            </td>
            <td><RecordActions>
              {r.status === "pending" &&
                r.reporterId !== c.meta.membershipId &&
                c.can("mes.report.review") && (
                  <div className="toolbar">
                    <button
                      onClick={() => {
                        setReason("");
                        setReview({ ...r, decision: "approve" });
                      }}
                    >
                      通过
                    </button>
                    <button
                      onClick={() => {
                        setReason("");
                        setReview({ ...r, decision: "reject" });
                      }}
                    >
                      拒绝
                    </button>
                  </div>
                )}
            </RecordActions></td>
          </tr>
        ))}
      </Table>
      <Dialog
        open={!!review}
        title={review?.decision === "approve" ? "审核通过报工" : "拒绝报工"}
        onClose={() => setReview(null)}
        busy={a.busy}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await a.write(c.base + "/reports/" + review.id + "/review", {
                version: review.version,
                decision: review.decision,
                reason,
              })
            ) {
              setReview(null);
              await onReviewed();
            }
          }}
        >
          {a.notices}
          <p>
            合格 {review?.goodQty} 件 · 不良 {review?.defectQty} 件
          </p>
          <Field
            label={review?.decision === "reject" ? "拒绝原因" : "审核意见"}
          >
            <textarea
              required={review?.decision === "reject"}
              minLength={review?.decision === "reject" ? 2 : 0}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <DialogAction>
            <button className="primary" type="submit" disabled={a.busy}>
              确认{review?.decision === "approve" ? "通过" : "拒绝"}
            </button>
          </DialogAction>
        </form>
      </Dialog>
    </>
  );
}
function Reports() {
  const c = useMes(),
    d = useList("reports", {
      defaultStatus: c.can("mes.report.review") ? "pending" : "",
    });
  return (
    <>
      <PageTitle
        title={c.meta.ownOnly ? "我的报工" : "报工与审核"}
        action={c.meta.ownOnly && c.can("mes.report.write") ? (
          <Link className="button primary" to={c.prefix + "/orders?status=in_progress"}>
            去报工
          </Link>
        ) : undefined}
      />
      {d.filters}
      <Result {...d}>
        <ReportRows items={d.data?.items ?? []} onReviewed={d.reload} />
        {!d.data?.items.length && (
          <Empty text={d.status === "pending" ? "暂无符合条件的待审核报工" : "暂无符合条件的报工记录"} />
        )}
        {d.pager}
      </Result>
    </>
  );
}
function Settings() {
  const c = useMes(),
    d = useApiData<any[]>(
      c.can("mes.settings.manage") ? c.base + "/settings/access" : null,
    ),
    a = useAction(),
    [edit, setEdit] = useState<any>(null);
  if (!c.can("mes.settings.manage")) return <Empty text="没有MES设置权限" />;
  return (
    <>
      <PageTitle title="MES设置" />
      {a.notices}
      <Result {...d}>
        <section className="panel form-panel">
          <h2>成员岗位</h2>
          <Table paginate headers={["成员", "MES岗位", "操作"]}>
            {d.data?.map((m) => (
              <tr key={m.id}>
                <td>{m.user.name}</td>
                <td>
                  {
                    labels[
                      m.role === "admin" ? "admin" : (m.grant?.role ?? "none")
                    ]
                  }
                </td>
                <td><RecordActions>
                  {m.role !== "admin" && (
                    <button
                      onClick={() =>
                        setEdit({
                          ...m,
                          selected:
                            m.grant?.role === "none"
                              ? ""
                              : (m.grant?.role ?? ""),
                        })
                      }
                    >
                      授权
                    </button>
                  )}
                </RecordActions></td>
              </tr>
            ))}
          </Table>
        </section>
      </Result>
      <Dialog
        open={!!edit}
        title="设置MES岗位"
        onClose={() => setEdit(null)}
        busy={a.busy}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await a.write(
                c.base + "/settings/access",
                {
                  membershipId: edit.id,
                  role: edit.selected || null,
                  version: edit.grant?.version ?? 0,
                },
                "put",
              )
            ) {
              setEdit(null);
              await d.reload();
            }
          }}
        >
          {a.notices}
          <p>{edit?.user.name}</p>
          <Field label="MES岗位">
            <select
              value={edit?.selected ?? ""}
              onChange={(e) => setEdit({ ...edit, selected: e.target.value })}
            >
              <option value="">未授权</option>
              {["planner", "supervisor", "operator", "viewer"].map((r) => (
                <option value={r} key={r}>
                  {labels[r]}
                </option>
              ))}
            </select>
          </Field>
          <DialogAction>
            <button className="primary" type="submit" disabled={a.busy}>
              保存授权
            </button>
          </DialogAction>
        </form>
      </Dialog>
    </>
  );
}
function Audit() {
  const c = useMes(),
    d = usePagedArray<any>(c.can("mes.audit.read") ? c.base + "/audit" : null);
  if (!c.can("mes.audit.read")) return <Empty text="没有MES审计权限" />;
  return (
    <>
      <PageTitle title="MES审计记录" />
      <Result {...d}>
        <Table pagination={d.pagination} headers={["时间", "操作", "对象类型", "对象ID"]}>
          {d.data?.map((e) => (
            <tr key={e.id}>
              <td>{date(e.createdAt)}</td>
              <td>{actionName(e.action)}</td>
              <td>{e.resourceType}</td>
              <td>{e.resourceId}</td>
            </tr>
          ))}
        </Table>
      </Result>
    </>
  );
}
