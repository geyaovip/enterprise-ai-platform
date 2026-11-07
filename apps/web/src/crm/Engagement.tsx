import { RecordActions, ChoiceSelect } from '../components';
import { EntitySelect } from '../components';
import { usePagedData } from '../hooks';
import { useState, useRef, useEffect } from "react";
import type { ReactNode, FormEvent } from "react";
import {
  Link,
  useParams,
  useSearchParams,
  useNavigate,
} from "react-router-dom";
import {
  PageTitle,
  DetailFacts,
  InfoTip,
  Field,
  Notice,
  Empty,
  Dialog,
  Pager,
  DialogAction,
} from "../components";
import { useApiData } from "../hooks";
import { useBusinessAction, ActionNotices } from "../pages/BusinessPrimitives";
import {
  useCrm,
  api,
  requestKey,
  date,
  Cards,
  Table,
  Result,
  Permission,
  CustomerLink,
  useCrmLeaveGuard,
} from "./common";
export const salesLabels: Record<string, string> = {
  new: "未分配",
  assigned: "待接受",
  working: "跟进中",
  qualified: "有效线索",
  conversion_pending: "待审核",
  conversion_approved: "待转化",
  converted: "已转化",
  returned: "已退回",
  invalid: "无效",
  discovery: "需求发现",
  solution: "方案沟通",
  negotiation: "商务谈判",
  won: "赢单",
  lost: "输单",
  open: "待处理",
  submitted: "待审核",
  approved: "审核通过",
  rejected: "需修改",
  active: "进行中",
  completed: "已完成",
  cancelled: "已取消",
  closed: "已关闭",
  low: "低",
  medium: "中",
  high: "高",
  call: "电话",
  visit: "拜访",
  chat: "沟通",
  email: "邮件",
  note: "备注",
};
const memberName = (c: any, id?: string) =>
  c.meta.members.find((m: any) => m.id === id)?.user.name ?? "未分配";
const local = (d = new Date()) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
type Choice = { id: string; name: string };
type Def = {
  key: string;
  label: string;
  type?:
    | "text"
    | "textarea"
    | "select"
    | "multi"
    | "number"
    | "datetime-local"
    | "checkbox"
    | "customer";
  options?: Choice[];
  required?: boolean;
  max?: number;
  min?: number;
};
type Editor = {
  title: string;
  fields: Def[];
  values: Record<string, any>;
  submit: (v: any) => Promise<void | string>;
  extra?: ReactNode | ((values: any) => ReactNode);
  submitLabel?: string;
};
// Keep a failed command's key while its path/body are unchanged, so retry is idempotent.
export function useCrmCommand() {
  const keys = useRef(new Map<string, string>());
  return async (path: string, body: any, method = "POST") => {
    const fingerprint = JSON.stringify([path, body, method]);
    let key = keys.current.get(fingerprint);
    if (!key) {
      key = requestKey();
      keys.current.set(fingerprint, key);
    }
    const result =
      method === "PATCH"
        ? await api.patch<any>(path, { ...body, requestKey: key })
        : await api.post<any>(path, { ...body, requestKey: key });
    keys.current.delete(fingerprint);
    return result;
  };
}
function CustomerPicker({
  label,
  value,
  onPick,
  required,
}: {
  label: string;
  value: string;
  onPick: (id: string, channel?: string) => void;
  required?: boolean;
}) {
  const c = useCrm();
  return <EntitySelect<any> label={label} required={required} value={value??''} path={c.base+'/customers'} format={item=>item.displayName} onChange={id=>onPick(id)}/>;
}
export function CrmEditor({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [values, setValues] = useState(editor.values),
    [dirty, setDirty] = useState(false),
    a = useBusinessAction(),
    leave = useCrmLeaveGuard(dirty);
  const set = (k: string, v: any) => {
    setDirty(true);
    setValues((old) => ({ ...old, [k]: v }));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void a.run(async () => {
      const v: any = { ...values };
      for (const f of editor.fields) {
        if (f.type === "number" && v[f.key] !== "") v[f.key] = Number(v[f.key]);
        if (f.type === "datetime-local" && v[f.key])
          v[f.key] = new Date(v[f.key]).toISOString();
        if (!f.required && (v[f.key] === "" || v[f.key] === undefined))
          delete v[f.key];
      }
      const destination = await editor.submit(v);
      setDirty(false);
      leave.allow();
      onClose();
      if (destination) navigate(destination);
    });
  };
  return (
    <>
      {leave.dialog}
      <Dialog
        open
        title={editor.title}
        busy={a.busy}
        dirtyCheck
        size={editor.fields.length > 6 ? "large" : "medium"}
        onClose={onClose}
      >
        <form onSubmit={submit}>
          <div className="form-grid">
            {editor.fields.map((f) => (
              f.type === 'customer' ? <CustomerPicker key={f.key} label={f.label} required={f.required} value={values[f.key]} onPick={(id,channel)=>{set(f.key,id);if(channel)set('channelId',channel);}}/> :
              f.type === 'select' && f.key.endsWith('Id') ? <ChoiceSelect key={f.key} label={f.label} value={values[f.key]??''} required={f.required} onChange={e=>set(f.key,e.target.value)}><option value="">请选择</option>{f.options?.map(o=><option value={o.id} key={o.id}>{o.name}</option>)}</ChoiceSelect> :
              <Field key={f.key} label={f.label}>
                {f.type === "textarea" ? (
                  <textarea
                    value={values[f.key] ?? ""}
                    required={f.required}
                    maxLength={f.max ?? 3000}
                    rows={4}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                ) : f.type === "select" || f.type === "multi" ? (
                  <select
                    multiple={f.type === "multi"}
                    value={values[f.key] ?? (f.type === "multi" ? [] : "")}
                    required={f.required}
                    onChange={(e) =>
                      set(
                        f.key,
                        f.type === "multi"
                          ? Array.from(e.target.selectedOptions, (x) => x.value)
                          : e.target.value,
                      )
                    }
                  >
                    {f.type !== "multi" && <option value="">请选择</option>}
                    {f.options?.map((o) => (
                      <option value={o.id} key={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                ) : f.type === "checkbox" ? (
                  <input
                    type="checkbox"
                    checked={Boolean(values[f.key])}
                    onChange={(e) => set(f.key, e.target.checked)}
                  />
                ) : (
                  <input
                    type={f.type ?? "text"}
                    value={values[f.key] ?? ""}
                    required={f.required}
                    maxLength={
                      f.type === "text" || !f.type ? (f.max ?? 200) : undefined
                    }
                    min={f.min}
                    max={f.type === "number" ? f.max : undefined}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                )}
              </Field>
            ))}
          </div>
          {typeof editor.extra === "function"
            ? editor.extra(values)
            : editor.extra}
          <Notice text={a.error} />
          <DialogAction>
            <button className="primary" disabled={a.busy}>
              {a.busy ? "保存中…" : (editor.submitLabel ?? "保存")}
            </button>
          </DialogAction>
        </form>
      </Dialog>
    </>
  );
}
const locationFields = (c: any): Def[] => [
  {
    key: "orgUnitId",
    label: "所属组织",
    type: "select",
    options: c.meta.orgUnits,
    required: true,
  },
  {
    key: "channelId",
    label: "来源渠道",
    type: "select",
    options: c.channels.filter((r: any) => r.active),
    required: true,
  },
];
const ownerField = (
  c: any,
  key = "ownerMembershipId",
  label = "负责人",
): Def => ({
  key,
  label,
  type: "select",
  options: c.meta.members.map((m: any) => ({ id: m.id, name: m.user.name })),
  required: true,
});
const customerField: Def = {
  key: "customerId",
  label: "客户",
  type: "customer",
  required: true,
};
const reasonField: Def = {
  key: "reason",
  label: "原因",
  type: "textarea",
  required: true,
};
function Paging({
  d,
  params,
  setParams,
}: {
  d: any;
  params: URLSearchParams;
  setParams: any;
}) {
  return (
    <Pager
      page={Number(params.get("page") ?? 1)}
      size={20}
      total={d?.total ?? 0}
      onPage={(p) => {
        const next = new URLSearchParams(params);
        next.set("page", String(p));
        setParams(next);
      }}
    />
  );
}
export function CrmNewCustomer({
  onCreated,
}: {
  onCreated: () => Promise<any>;
}) {
  const c = useCrm(),
    [editor, setEditor] = useState<Editor | null>(null),
    command = useCrmCommand();
  return (
    <>
      <Permission name="crm.customer.write">
        <button
          className="primary"
          onClick={() =>
            setEditor({
              title: "新建客户",
              fields: [
                { key: "displayName", label: "客户名称", required: true },
                {
                  key: "kind",
                  label: "客户类型",
                  type: "select",
                  options: [
                    { id: "consumer", name: "个人" },
                    { id: "organization", name: "企业" },
                  ],
                  required: true,
                },
                ...locationFields(c),
                { ...ownerField(c), required: false },
                { key: "registrationId", label: "统一标识（企业信用代码等）" },
                { key: "industry", label: "行业" },
                { key: "region", label: "地区" },
              ],
              values: {
                kind: "consumer",
                orgUnitId: c.meta.orgUnits[0]?.id ?? "",
                channelId: c.channels[0]?.id ?? "",
              },
              submit: async (v) => {
                const r = await command(c.base + "/customers", v);
                await onCreated();
                return c.prefix + "/customers/" + r.id;
              },
            })
          }
        >
          新建客户
        </button>
      </Permission>
      {editor && <CrmEditor editor={editor} onClose={() => setEditor(null)} />}
    </>
  );
}
export function CrmWorkbench({ compact = false }: { compact?: boolean }) {
  const c = useCrm(),
    d = useApiData<any>(c.base + "/workbench"),
    a = useBusinessAction(),
    command = useCrmCommand(),
    r = d.data;
  return (
    <>
      {!compact && <PageTitle title="我的工作" />}
      <ActionNotices action={a} />
      <Result {...d}>
        <Cards
          items={[
            ["待处理线索", r?.pendingLeads ?? 0],
            ["跟进待办（前100条）", r?.followUps.length ?? 0],
            ["其中逾期", r?.overdueFollowUps ?? 0],
            ["服务待办（前20条）", r?.serviceTasks.length ?? 0],
          ]}
        />
        {!compact && (
          <>
            <section className="panel form-panel">
              <h2>跟进待办 <InfoTip label="待办展示范围">按下次跟进时间展示最多100条；服务待办展示最近20条。</InfoTip></h2>
              {r?.followUps.length ? (
                <Table paginate headers={["内容", "下次跟进", "操作"]}>
                  {r.followUps.map((f: any) => (
                    <tr key={f.id}>
                      <td>
                        <Link
                          to={
                            c.prefix +
                            "/" +
                            (
                              {
                                customer: "customers",
                                lead: "leads",
                                opportunity: "opportunities",
                              } as any
                            )[f.targetType] +
                            "/" +
                            f.targetId
                          }
                        >
                          {f.content}
                        </Link>
                      </td>
                      <td>{date(f.nextAt)}</td>
                      <td><RecordActions>
                        <button
                          disabled={a.busy}
                          onClick={() =>
                            void a.run(async () => {
                              await command(
                                c.base + "/follow-ups/" + f.id + "/complete",
                                { version: f.version },
                              );
                              await d.reload();
                            })
                          }
                        >
                          完成待办
                        </button>
                      </RecordActions></td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <Empty text="暂无跟进待办" />
              )}
            </section>
            <div className="crm-engagement-grid">
              <section className="panel form-panel">
                <h2>销售处理</h2>
                {r?.leads.map((l: any) => (
                  <p key={l.id}>
                    <Link to={c.prefix + "/leads/" + l.id}>{l.name}</Link> ·{" "}
                    {salesLabels[l.status]}
                  </p>
                ))}
                {r?.opportunities.map((o: any) => (
                  <p key={o.id}>
                    <Link to={c.prefix + "/opportunities/" + o.id}>
                      {o.name}
                    </Link>{" "}
                    · {o.nextAction} · {date(o.nextActionAt)}
                  </p>
                ))}
                {!r?.leads.length && !r?.opportunities.length && (
                  <p>暂无待处理销售记录</p>
                )}
              </section>
              <section className="panel form-panel">
                <h2>服务与风险</h2>
                {r?.serviceTasks.map((t: any) => (
                  <p key={t.id}>
                    <Link to={c.prefix + "/service"}>{t.title}</Link> ·{" "}
                    {date(t.dueAt)}
                  </p>
                ))}
                {r?.risks.map((risk: any) => (
                  <p key={risk.id}>
                    <Link to={c.prefix + "/service?tab=risks"}>
                      {risk.title}
                    </Link>{" "}
                    · {salesLabels[risk.severity]}风险
                  </p>
                ))}
                {!r?.serviceTasks.length && !r?.risks.length && (
                  <p>暂无服务待办和风险</p>
                )}
              </section>
            </div>
            <Permission name="crm.sales.read">
              <section className="panel form-panel">
                <h2>销售阶段分布 <InfoTip label="销售金额统计口径">预计金额按币种分别汇总。</InfoTip></h2>
                <div className="cards">
                  {r?.funnel.map((f: any) => (
                    <div key={f.stage}>
                      <strong>{salesLabels[f.stage]}</strong> {f._count._all} 个
                    </div>
                  ))}
                </div>
                {r?.amounts.map((v: any) => (
                  <p key={v.currency}>
                    未结束商机预计金额：{v._sum.estimatedAmount} {v.currency}
                  </p>
                ))}
              </section>
            </Permission>
          </>
        )}
      </Result>
    </>
  );
}
export function CrmLeads() {
  const c = useCrm(),
    [params, setParams] = useSearchParams(),
    d = useApiData<any>(c.base + "/leads?" + params),
    [q, setQ] = useState(params.get("q") ?? ""),
    [editor, setEditor] = useState<Editor | null>(null),
    command = useCrmCommand();
  return (
    <>
      <PageTitle
        title="销售线索"
        action={
          <>
            <Permission name="crm.sales.write">
              <button
                className="primary"
                onClick={() =>
                  setEditor({
                    title: "录入线索",
                    fields: [
                      { key: "name", label: "线索/联系人名称", required: true },
                      { key: "companyName", label: "企业名称" },
                      { key: "contact", label: "电话或邮箱" },
                      ...locationFields(c),
                      { key: "source", label: "获客来源", required: true },
                      {
                        key: "requirement",
                        label: "需求说明",
                        type: "textarea",
                        required: true,
                      },
                      {
                        key: "allowDuplicate",
                        label: "已核对重复候选，仍需建档",
                        type: "checkbox",
                      },
                      {
                        key: "duplicateReason",
                        label: "重复建档原因",
                        type: "textarea",
                      },
                    ],
                    values: {
                      orgUnitId: c.meta.orgUnits[0]?.id ?? "",
                      channelId: c.channels[0]?.id ?? "",
                      source: "手动录入",
                    },
                    submit: async (v) => {
                      const r = await command(c.base + "/leads", v);
                      return c.prefix + "/leads/" + r.id;
                    },
                    extra: (v) => (
                      <LeadDuplicates name={v.name} contact={v.contact} />
                    ),
                  })
                }
              >
                录入线索
              </button>
            </Permission>
            <Permission name="crm.sales.manage">
              <Link className="button" to={c.prefix + "/sales-pools"}>
                销售分配池
              </Link>
            </Permission>
          </>
        }
      />
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setParams({ q, page: "1", status: params.get("status") ?? "" });
        }}
      >
        <input
          aria-label="搜索线索"
          value={q}
          placeholder="线索名称"
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          aria-label="线索状态"
          value={params.get("status") ?? ""}
          onChange={(e) => setParams({ status: e.target.value, q, page: "1" })}
        >
          <option value="">全部状态</option>
          {[
            "new",
            "assigned",
            "working",
            "qualified",
            "conversion_pending",
            "conversion_approved",
            "converted",
            "returned",
            "invalid",
          ].map((s) => (
            <option value={s} key={s}>
              {salesLabels[s]}
            </option>
          ))}
        </select>
        <button>查询</button>
      </form>
      <Result {...d}>
        {d.data?.items.length ? (
          <Table headers={["线索", "企业", "联系方式", "负责人", "状态"]}>
            {d.data.items.map((l: any) => (
              <tr key={l.id}>
                <td>
                  <Link to={c.prefix + "/leads/" + l.id}>{l.name}</Link>
                </td>
                <td>{l.companyName ?? "—"}</td>
                <td>{l.contactMasked ?? "—"}</td>
                <td>{memberName(c, l.ownerMembershipId)}</td>
                <td>{salesLabels[l.status]}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty text="暂无符合条件的线索" />
        )}
        <Paging d={d.data} params={params} setParams={setParams} />
      </Result>
      {editor && <CrmEditor editor={editor} onClose={() => setEditor(null)} />}
    </>
  );
}
export function CrmLeadDetail() {
  const c = useCrm(),
    { id } = useParams(),
    d = useApiData<any>(c.base + "/leads/" + id),
    pools = useApiData<any>(
      c.can("crm.sales.manage") ? c.base + "/sales-pools" : null,
    ),
    a = useBusinessAction(),
    command = useCrmCommand(),
    [editor, setEditor] = useState<Editor | null>(null),
    [contact, setContact] = useState<string | null>(null),
    r = d.data;
  useEffect(() => setContact(null), [id, c.meta.permissions.join(",")]);
  const act = (action: string, fields: Def[] = [], values: any = {}) =>
    setEditor({
      title: (
        {
          assign: "分配线索",
          accept: "接受线索",
          return: "退回线索",
          qualify: "标记有效",
          invalidate: "标记无效",
          request_conversion: "申请转化",
          approve: "审核通过",
          reject: "驳回转化",
          convert: "转为客户",
        } as any
      )[action],
      fields,
      values,
      submit: async (v) => {
        await command(c.base + "/leads/" + id + "/actions", {
          ...v,
          action,
          version: r.version,
        });
        await d.reload();
      },
    });
  return (
    <>
      <PageTitle
        title={r?.name ?? "线索详情"}
        back={
          <Link className="button" to={c.prefix + "/leads"}>
            返回线索
          </Link>
        }
      />
      <ActionNotices action={a} />
      <Result {...d}>
        <section className="panel form-panel">
          <h2>线索信息</h2>
          <p>
            {salesLabels[r?.status]} · 负责人：
            {memberName(c, r?.ownerMembershipId)}
          </p>
          <p>
            企业：{r?.companyName ?? "—"} · 来源：{r?.source}
          </p>
          <p>联系方式：{contact ?? r?.contactMasked ?? "未提供"}</p>
          <p className="crm-note">{r?.requirement}</p>
          <div className="form-actions">
            <Permission name="crm.customer.contact.read">
              <button
                disabled={a.busy}
                onClick={() =>
                  void a.run(async () => {
                    setContact(
                      (await api.get<any>(c.base + "/leads/" + id + "/contact"))
                        .value,
                    );
                  })
                }
              >
                查看联系方式
              </button>
            </Permission>
            <Permission name="crm.sales.write">
              {["new", "assigned", "working", "qualified", "returned"].includes(
                r?.status,
              ) && (
                <button
                  onClick={() =>
                    setEditor({
                      title: "编辑线索",
                      fields: [
                        {
                          key: "name",
                          label: "线索/联系人名称",
                          required: true,
                        },
                        { key: "companyName", label: "企业名称" },
                        {
                          key: "contact",
                          label: "更新电话或邮箱（留空保留原值）",
                        },
                        { key: "source", label: "获客来源", required: true },
                        {
                          key: "requirement",
                          label: "需求说明",
                          type: "textarea",
                          required: true,
                        },
                        {
                          key: "allowDuplicate",
                          label: "已核对，保留重复记录",
                          type: "checkbox",
                        },
                        {
                          key: "duplicateReason",
                          label: "保留重复记录原因",
                          type: "textarea",
                        },
                      ],
                      values: {
                        name: r.name,
                        companyName: r.companyName ?? "",
                        source: r.source,
                        requirement: r.requirement,
                      },
                      extra: (v) => (
                        <LeadDuplicates name={v.name} contact={v.contact} />
                      ),
                      submit: async (v) => {
                        await command(
                          c.base + "/leads/" + id,
                          { ...v, version: r.version },
                          "PATCH",
                        );
                        setContact(null);
                        await d.reload();
                      },
                    })
                  }
                >
                  编辑线索
                </button>
              )}
            </Permission>
            <Permission name="crm.sales.manage">
              {["new", "assigned", "returned"].includes(r?.status) && (
                <button
                  onClick={() =>
                    act("assign", [
                      { ...ownerField(c), required: false },
                      {
                        key: "poolId",
                        label: "或按销售池轮转",
                        type: "select",
                        options: pools.data?.items
                          .filter(
                            (p: any) =>
                              p.active &&
                              p.orgUnitId === r.orgUnitId &&
                              p.channelId === r.channelId,
                          )
                          .map((p: any) => ({ id: p.id, name: p.name })),
                      },
                    ])
                  }
                >
                  分配
                </button>
              )}
              {r?.status === "conversion_pending" && (
                <>
                  <button onClick={() => act("approve")}>审核通过</button>
                  <button onClick={() => act("reject", [reasonField])}>
                    驳回
                  </button>
                </>
              )}
            </Permission>
            <Permission name="crm.sales.write">
              {r?.status === "assigned" && (
                <button onClick={() => act("accept")}>接受</button>
              )}
              {["assigned", "working"].includes(r?.status) && (
                <button onClick={() => act("return", [reasonField])}>
                  退回
                </button>
              )}
              {r?.status === "working" && (
                <button onClick={() => act("qualify")}>标记有效</button>
              )}
              {r?.status === "qualified" && (
                <button onClick={() => act("request_conversion")}>
                  申请转化
                </button>
              )}
              {r?.status === "conversion_approved" && (
                <button
                  className="primary"
                  onClick={() =>
                    act(
                      "convert",
                      [
                        {
                          ...customerField,
                          label: "关联已有客户（留空则新建）",
                          required: false,
                        },
                        {
                          key: "createOpportunity",
                          label: "同时建立商机",
                          type: "checkbox",
                        },
                      ],
                      { createOpportunity: true },
                    )
                  }
                >
                  转为客户
                </button>
              )}
              {["new", "assigned", "working", "qualified", "returned"].includes(
                r?.status,
              ) && (
                <button onClick={() => act("invalidate", [reasonField])}>
                  标记无效
                </button>
              )}
            </Permission>
            {r?.customerId && (
              <CustomerLink id={r.customerId} name="查看转化客户" />
            )}
          </div>
        </section>
        {r && (
          <FollowUpPanel
            targetType="lead"
            targetId={r.id}
            channels={[r.channelId]}
          />
        )}
      </Result>
      {editor && <CrmEditor editor={editor} onClose={() => setEditor(null)} />}
    </>
  );
}
export function FollowUpPanel({
  targetType,
  targetId,
  channels,
}: {
  targetType: string;
  targetId: string;
  channels: string[];
}) {
  const c = useCrm(),
    [channel, setChannel] = useState(channels[0] ?? ""),
    [page, setPage] = useState(1),
    d = useApiData<any>(
      c.can("crm.followup.read") && channel
        ? c.base +
            "/follow-ups?" +
            new URLSearchParams({
              targetType,
              targetId,
              channelId: channel,
              page: String(page),
            })
        : null,
    ),
    [editor, setEditor] = useState<Editor | null>(null),
    command = useCrmCommand();
  if (!c.can("crm.followup.read")) return null;
  const create = (old?: any) =>
    setEditor({
      title: old ? "追加更正记录" : "记录客户跟进",
      fields: [
        {
          key: "type",
          label: "跟进方式",
          type: "select",
          options: ["call", "visit", "chat", "email", "note"].map((k) => ({
            id: k,
            name: salesLabels[k],
          })),
          required: true,
        },
        { key: "content", label: "跟进内容", type: "textarea", required: true },
        {
          key: "occurredAt",
          label: "实际发生时间",
          type: "datetime-local",
          required: true,
        },
        { key: "nextAt", label: "下次跟进时间", type: "datetime-local" },
      ],
      values: {
        type: old?.type ?? "note",
        content: old?.content ?? "",
        occurredAt: local(),
      },
      submit: async (v) => {
        await command(c.base + "/follow-ups", {
          ...v,
          targetType,
          targetId,
          channelId: channel,
          ...(old ? { correctsId: old.id } : {}),
        });
        await d.reload();
      },
    });
  return (
    <section className="panel form-panel">
      <div className="crm-section-heading">
        <h2>客户跟进</h2>
        <div className="form-actions">
          <ChoiceSelect label="跟进来源渠道"
            value={channel}
            onChange={(e) => {
              setChannel(e.target.value);
              setPage(1);
            }}>{channels.map((id) => (
              <option key={id} value={id}>
                {c.channels.find((r: any) => r.id === id)?.name ?? "来源渠道"}
              </option>
            ))}</ChoiceSelect>
          <Permission name="crm.followup.write">
            <button disabled={!channel} onClick={() => create()}>
              记录跟进
            </button>
          </Permission>
        </div>
      </div>
      <Notice text={d.error} />
      {d.data?.items.length ? (
        d.data.items.map((f: any) => (
          <article className="crm-follow-up" key={f.id}>
            <p>
              <strong>{salesLabels[f.type]}</strong> ·{" "}
              {memberName(c, f.authorMembershipId)} · {date(f.occurredAt)}
              {f.correctsId && " · 更正记录"}
            </p>
            <p className="crm-note">{f.content}</p>
            {f.nextAt && (
              <p>
                下次跟进：{date(f.nextAt)} ·{" "}
                {f.doneAt ? "待办已完成" : "待跟进"}
              </p>
            )}
            <Permission name="crm.followup.write">
              {f.authorMembershipId === c.meta.currentMembershipId && (
                <button onClick={() => create(f)}>追加更正</button>
              )}
            </Permission>
          </article>
        ))
      ) : (
        <p>暂无客户跟进记录</p>
      )}
      <Pager
        page={page}
        total={d.data?.total ?? 0}
        size={20}
        onPage={setPage}
      />
      {editor && <CrmEditor editor={editor} onClose={() => setEditor(null)} />}
    </section>
  );
}
export function CustomerEngagement({
  customer,
  onChange,
}: {
  customer: any;
  onChange: () => Promise<any>;
}) {
  const c = useCrm(),
    [editor, setEditor] = useState<Editor | null>(null),
    [revealed, setRevealed] = useState<any[] | null>(null),
    a = useBusinessAction(),
    command = useCrmCommand(),
    contacts = usePagedData<any>(
      c.base + "/customers/" + customer.id + "/business-contacts",
    ),
    channels = customer.identities.map((r: any) => r.channelId);
  useEffect(
    () => setRevealed(null),
    [customer.id, c.meta.permissions.join(",")],
  );
  return (
    <>
      <section className="panel detail-panel">
        <h2>客户归属与联系人</h2>
        <DetailFacts items={[
          {label:'客户类型',value:customer.kind==='organization'?'企业':'个人'},
          {label:'行业',value:customer.industry??'—'},
          {label:'地区',value:customer.region??'—'},
          {label:'销售负责人',value:memberName(c,customer.ownerMembershipId)},
          {label:'服务负责人',value:memberName(c,customer.serviceOwnerMembershipId)},
        ]}/>
        <ActionNotices action={a} />
        <div className="form-actions">
          <Permission name="crm.customer.write">
            <button
              onClick={() =>
                setEditor({
                  title: "编辑客户资料",
                  fields: [
                    {
                      key: "kind",
                      label: "客户类型",
                      type: "select",
                      options: [
                        { id: "consumer", name: "个人" },
                        { id: "organization", name: "企业" },
                      ],
                      required: true,
                    },
                    { key: "industry", label: "行业" },
                    { key: "region", label: "地区" },
                    { key: "registrationId", label: "统一标识" },
                  ],
                  values: {
                    kind: customer.kind,
                    industry: customer.industry ?? "",
                    region: customer.region ?? "",
                    registrationId: customer.registrationId ?? "",
                  },
                  submit: async (v) => {
                    await command(
                      c.base + "/customers/" + customer.id + "/profile",
                      { ...v, version: customer.version },
                      "PATCH",
                    );
                    await onChange();
                  },
                })
              }
            >
              编辑客户资料
            </button>
          </Permission>
          <Permission name="crm.customer.assign">
            <button
              onClick={() =>
                setEditor({
                  title: "客户归属与交接",
                  fields: [
                    { ...ownerField(c), required: false },
                    {
                      ...ownerField(
                        c,
                        "serviceOwnerMembershipId",
                        "服务负责人",
                      ),
                      required: false,
                    },
                    reasonField,
                  ],
                  values: {
                    ownerMembershipId: customer.ownerMembershipId ?? "",
                    serviceOwnerMembershipId:
                      customer.serviceOwnerMembershipId ?? "",
                  },
                  extra: (
                    <p className="muted">
                      客户归属与现有商机、服务任务的负责人分别管理；交接后请在相应记录核对负责人。
                    </p>
                  ),
                  submit: async (v) => {
                    await command(
                      c.base + "/customers/" + customer.id + "/assignment",
                      {
                        version: customer.version,
                        ownerMembershipId: v.ownerMembershipId ?? null,
                        serviceOwnerMembershipId:
                          v.serviceOwnerMembershipId ?? null,
                        reason: v.reason,
                      },
                    );
                    await onChange();
                  },
                })
              }
            >
              分配与交接
            </button>
          </Permission>
          <Permission name="crm.customer.write">
            <button
              onClick={() =>
                setEditor({
                  title: "新增联系人",
                  fields: [
                    { key: "name", label: "联系人姓名", required: true },
                    { key: "title", label: "职务" },
                    { key: "value", label: "电话或邮箱", required: true },
                    { key: "purpose", label: "使用用途", required: true },
                    { key: "preferred", label: "首选联系人", type: "checkbox" },
                  ],
                  values: { purpose: "客户服务", preferred: false },
                  submit: async (v) => {
                    await command(
                      c.base +
                        "/customers/" +
                        customer.id +
                        "/business-contacts",
                      v,
                    );
                    setRevealed(null);
                    await contacts.reload();
                  },
                })
              }
            >
              新增联系人
            </button>
          </Permission>
          <Permission name="crm.customer.contact.read">
            <button
              disabled={a.busy}
              onClick={() =>
                void a.run(async () => {
                  setRevealed(
                    (
                      await api.get<any>(
                        c.base +
                          "/customers/" +
                          customer.id +
                          "/business-contacts/reveal",
                      )
                    ).items,
                  );
                })
              }
            >
              查看联系人明文
            </button>
          </Permission>
          <Permission name="crm.sales.write">
            <Link
              className="button"
              to={c.prefix + "/opportunities?customerId=" + customer.id}
            >
              客户商机
            </Link>
          </Permission>
          <Permission name="crm.service.read">
            <Link
              className="button"
              to={c.prefix + "/service?customerId=" + customer.id}
            >
              客户服务
            </Link>
          </Permission>
        </div>
        <Notice text={contacts.error} />
        {contacts.data?.items.length ? (
          <Table pagination={contacts.pagination} headers={["联系人", "职务", "联系方式", "用途", "操作"]}>
            {contacts.data.items.map((r: any) => (
              <tr key={r.id}>
                <td>
                  {r.name}
                  {r.preferred ? "（首选）" : ""}
                </td>
                <td>{r.title ?? "—"}</td>
                <td>
                  {revealed?.find((v) => v.id === r.id)?.value ?? r.maskedValue}
                </td>
                <td>{r.purpose}</td>
                <td><RecordActions>
                  {c.can("crm.customer.write") &&
                    c.can("crm.customer.contact.read") && (
                      <button
                        disabled={a.busy}
                        onClick={() =>
                          void a.run(async () => {
                            const raw = (
                              await api.get<any>(
                                c.base +
                                  "/customers/" +
                                  customer.id +
                                  "/business-contacts/reveal",
                              )
                            ).items.find((x: any) => x.id === r.id);
                            if (!raw) throw Error("联系人已变化，请刷新");
                            setEditor({
                              title: "编辑联系人",
                              fields: [
                                {
                                  key: "name",
                                  label: "联系人姓名",
                                  required: true,
                                },
                                { key: "title", label: "职务" },
                                {
                                  key: "value",
                                  label: "电话或邮箱",
                                  required: true,
                                },
                                {
                                  key: "purpose",
                                  label: "使用用途",
                                  required: true,
                                },
                                {
                                  key: "preferred",
                                  label: "首选联系人",
                                  type: "checkbox",
                                },
                              ],
                              values: {
                                name: r.name,
                                title: r.title ?? "",
                                value: raw.value,
                                purpose: r.purpose,
                                preferred: r.preferred,
                              },
                              submit: async (v) => {
                                await command(
                                  c.base +
                                    "/customers/" +
                                    customer.id +
                                    "/business-contacts",
                                  { ...v, id: r.id, version: r.version },
                                );
                                setRevealed(null);
                                await contacts.reload();
                              },
                            });
                          })
                        }
                      >
                        编辑
                      </button>
                    )}
                </RecordActions></td>
              </tr>
            ))}
          </Table>
        ) : (
          <p>暂无独立联系人</p>
        )}
      </section>
      <FollowUpPanel
        targetType="customer"
        targetId={customer.id}
        channels={channels}
      />
      {editor && <CrmEditor editor={editor} onClose={() => setEditor(null)} />}
    </>
  );
}
function opportunityEditor(
  c: any,
  command: any,
  onSave: () => Promise<any>,
  existing?: any,
  customerId?: string,
): Editor {
  return {
    title: existing ? "编辑商机" : "新建商机",
    fields: [
      customerField,
      {
        key: "channelId",
        label: "客户来源渠道",
        type: "select",
        options: c.channels.filter((r: any) => r.active),
        required: true,
      },
      { key: "name", label: "商机名称", required: true },
      {
        key: "kind",
        label: "业务类型",
        type: "select",
        required: true,
        options: [
          { id: "new", name: "新签" },
          { id: "renewal", name: "续约" },
        ],
      },
      ownerField(c),
      {
        key: "participantMembershipIds",
        label: "协作销售（可多选）",
        type: "multi",
        options: c.meta.members.map((m: any) => ({
          id: m.id,
          name: m.user.name,
        })),
      },
      { key: "estimatedAmount", label: "预计签约金额", required: true },
      {
        key: "currency",
        label: "币种",
        type: "select",
        required: true,
        options: ["CNY", "USD", "EUR", "HKD"].map((id) => ({ id, name: id })),
      },
      {
        key: "probability",
        label: "赢单概率（%）",
        type: "number",
        required: true,
        min: 0,
        max: 100,
      },
      { key: "expectedCloseAt", label: "预计签约时间", type: "datetime-local" },
      { key: "nextAction", label: "下一步行动", type: "textarea" },
      { key: "nextActionAt", label: "下次行动时间", type: "datetime-local" },
    ],
    values: existing
      ? {
          customerId: existing.customerId,
          channelId: existing.channelId,
          name: existing.name,
          kind: existing.kind,
          ownerMembershipId: existing.ownerMembershipId,
          participantMembershipIds: existing.participantMembershipIds,
          estimatedAmount: existing.estimatedAmount,
          currency: existing.currency,
          probability: existing.probability,
          expectedCloseAt: existing.expectedCloseAt
            ? local(new Date(existing.expectedCloseAt))
            : "",
          nextAction: existing.nextAction ?? "",
          nextActionAt: existing.nextActionAt
            ? local(new Date(existing.nextActionAt))
            : "",
        }
      : {
          customerId: customerId ?? "",
          channelId: c.channels[0]?.id ?? "",
          ownerMembershipId: c.meta.currentMembershipId,
          participantMembershipIds: [],
          kind: "new",
          currency: c.meta.settings.currency,
          estimatedAmount: "0.00",
          probability: 10,
        },
    submit: async (v) => {
      await command(
        c.base + "/opportunities" + (existing ? "/" + existing.id : ""),
        { ...v, ...(existing ? { version: existing.version } : {}) },
        existing ? "PATCH" : "POST",
      );
      await onSave();
    },
  };
}
export function CrmOpportunities() {
  const c = useCrm(),
    [params, setParams] = useSearchParams(),
    d = useApiData<any>(c.base + "/opportunities?" + params),
    [editor, setEditor] = useState<Editor | null>(null),
    command = useCrmCommand(),
    [q, setQ] = useState(params.get("q") ?? "");
  return (
    <>
      <PageTitle
        title="销售商机"
        action={
          <Permission name="crm.sales.write">
            <button
              className="primary"
              onClick={() =>
                setEditor(
                  opportunityEditor(
                    c,
                    command,
                    d.reload,
                    undefined,
                    params.get("customerId") ?? undefined,
                  ),
                )
              }
            >
              新建商机
            </button>
          </Permission>
        }
      />
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          const p = new URLSearchParams(params);
          p.set("q", q);
          p.set("page", "1");
          setParams(p);
        }}
      >
        <input
          aria-label="搜索商机"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="商机名称"
        />
        <select
          aria-label="销售阶段"
          value={params.get("stage") ?? ""}
          onChange={(e) => {
            const p = new URLSearchParams(params);
            p.set("stage", e.target.value);
            p.set("page", "1");
            setParams(p);
          }}
        >
          <option value="">全部阶段</option>
          {["discovery", "solution", "negotiation", "won", "lost"].map((s) => (
            <option key={s} value={s}>
              {salesLabels[s]}
            </option>
          ))}
        </select>
        <button>查询</button>
      </form>
      <Result {...d}>
        {d.data?.items.length ? (
          <Table
            headers={["商机", "客户", "负责人", "阶段", "预计金额", "预计签约"]}
          >
            {d.data.items.map((o: any) => (
              <tr key={o.id}>
                <td>
                  <Link to={c.prefix + "/opportunities/" + o.id}>{o.name}</Link>
                  {o.kind === "renewal" ? "（续约）" : ""}
                </td>
                <td>
                  <CustomerLink
                    id={o.customerId}
                    name={o.customer.displayName}
                  />
                </td>
                <td>{memberName(c, o.ownerMembershipId)}</td>
                <td>{salesLabels[o.stage]}</td>
                <td>
                  {o.estimatedAmount} {o.currency}
                </td>
                <td>{date(o.expectedCloseAt)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty text="暂无符合条件的商机" />
        )}
        <Paging d={d.data} params={params} setParams={setParams} />
      </Result>
      {editor && <CrmEditor editor={editor} onClose={() => setEditor(null)} />}
    </>
  );
}
export function CrmOpportunityDetail() {
  const c = useCrm(),
    { id } = useParams(),
    d = useApiData<any>(c.base + "/opportunities/" + id),
    r = d.data,
    [editor, setEditor] = useState<Editor | null>(null),
    command = useCrmCommand();
  const stage = (s: string) =>
    setEditor({
      title: salesLabels[s],
      fields:
        s === "won"
          ? [
              { key: "actualAmount", label: "实际签约金额", required: true },
              {
                key: "actualCloseAt",
                label: "实际签约时间",
                type: "datetime-local",
                required: true,
              },
            ]
          : s === "lost"
            ? [reasonField]
            : [],
      values:
        s === "won"
          ? { actualAmount: r.estimatedAmount, actualCloseAt: local() }
          : {},
      submit: async (v) => {
        await command(c.base + "/opportunities/" + id + "/stage", {
          ...v,
          stage: s,
          version: r.version,
        });
        await d.reload();
      },
    });
  return (
    <>
      <PageTitle
        title={r?.name ?? "商机详情"}
        back={
          <Link className="button" to={c.prefix + "/opportunities"}>
            返回商机
          </Link>
        }
      />
      <Result {...d}>
        <section className="panel form-panel">
          <h2>销售进展</h2>
          <p>
            {salesLabels[r?.stage]} · {r?.kind === "renewal" ? "续约" : "新签"}{" "}
            · 负责人：{memberName(c, r?.ownerMembershipId)}
          </p>
          <p>
            预计金额：{r?.estimatedAmount} {r?.currency} · 赢单概率：
            {r?.probability}%
          </p>
          <p>预计签约：{date(r?.expectedCloseAt)}</p>
          <p>
            下一步：{r?.nextAction ?? "未填写"} · {date(r?.nextActionAt)}
          </p>
          <p>
            协作销售：
            {r?.participantMembershipIds
              .map((m: string) => memberName(c, m))
              .join("、") || "无"}
          </p>
          {r?.stage === "won" && (
            <p>
              实际签约：{r.actualAmount} {r.currency} · {date(r.actualCloseAt)}
            </p>
          )}
          {r?.stage === "lost" && <p>输单原因：{r.lostReason}</p>}
          <div className="form-actions">
            <CustomerLink id={r?.customerId ?? ""} name="查看客户" />
            <Permission name="crm.sales.write">
              {!["won", "lost"].includes(r?.stage) && (
                <>
                  <button
                    onClick={() =>
                      setEditor(opportunityEditor(c, command, d.reload, r))
                    }
                  >
                    编辑商机
                  </button>
                  {r?.stage === "discovery" && (
                    <button onClick={() => stage("solution")}>
                      进入方案沟通
                    </button>
                  )}
                  {r?.stage === "solution" && (
                    <button onClick={() => stage("negotiation")}>
                      进入商务谈判
                    </button>
                  )}
                  {r?.stage === "negotiation" && (
                    <button className="primary" onClick={() => stage("won")}>
                      登记赢单
                    </button>
                  )}
                  <button onClick={() => stage("lost")}>登记输单</button>
                </>
              )}
            </Permission>
          </div>
        </section>
        {r && (
          <FollowUpPanel
            targetType="opportunity"
            targetId={r.id}
            channels={[r.channelId]}
          />
        )}
      </Result>
      {editor && <CrmEditor editor={editor} onClose={() => setEditor(null)} />}
    </>
  );
}
export function CrmSalesPools() {
  const c = useCrm(),
    d = usePagedData<any>(c.base + "/sales-pools"),
    command = useCrmCommand(),
    [editor, setEditor] = useState<Editor | null>(null);
  const edit = (r?: any) =>
    setEditor({
      title: r ? "编辑销售池" : "新建销售池",
      fields: [
        { key: "name", label: "销售池名称", required: true },
        ...locationFields(c),
        {
          key: "memberIds",
          label: "轮转销售成员（可多选）",
          type: "multi",
          required: true,
          options: c.meta.members.map((m: any) => ({
            id: m.id,
            name: m.user.name,
          })),
        },
        { key: "active", label: "启用销售池", type: "checkbox" },
      ],
      values: r
        ? {
            name: r.name,
            orgUnitId: r.orgUnitId,
            channelId: r.channelId,
            memberIds: r.memberIds,
            active: r.active,
          }
        : {
            orgUnitId: c.meta.orgUnits[0]?.id ?? "",
            channelId: c.channels[0]?.id ?? "",
            memberIds: [],
            active: true,
          },
      submit: async (v) => {
        await command(c.base + "/sales-pools", {
          ...v,
          ...(r ? { id: r.id, version: r.version } : {}),
        });
        await d.reload();
      },
      extra: (
        <InfoTip label="轮转分配范围">轮转仅在对应组织和渠道内进行，分配时会重新检查成员权限。</InfoTip>
      ),
    });
  return (
    <>
      <PageTitle
        title="销售分配池"
        action={
          <button className="primary" onClick={() => edit()}>
            新建销售池
          </button>
        }
      />
      <Result {...d}>
        {d.data?.items.length ? (
          <Table pagination={d.pagination} headers={["销售池", "轮转成员", "状态", "操作"]}>
            {d.data.items.map((p: any) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>
                  {p.memberIds
                    .map((id: string) => memberName(c, id))
                    .join("、")}
                </td>
                <td>{p.active ? "启用" : "停用"}</td>
                <td><RecordActions>
                  <button onClick={() => edit(p)}>编辑</button>
                </RecordActions></td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty text="暂无销售分配池" />
        )}
      </Result>
      {editor && <CrmEditor editor={editor} onClose={() => setEditor(null)} />}
    </>
  );
}
export function CrmService() {
  const c = useCrm(),
    [params, setParams] = useSearchParams(),
    tab = params.get("tab") ?? "plans",
    query = new URLSearchParams(params);
  query.delete("tab");
  const plans = useApiData<any>(c.base + "/service-plans?" + query),
    risks = useApiData<any>(c.base + "/service-risks?" + query),
    command = useCrmCommand(),
    [editor, setEditor] = useState<Editor | null>(null);
  const reload = async () => {
    await Promise.all([plans.reload(), risks.reload()]);
  };
  const selectFields: Def[] = [
    customerField,
    {
      key: "channelId",
      label: "客户来源渠道",
      type: "select",
      options: c.channels.filter((r: any) => r.active),
      required: true,
    },
  ];
  const createPlan = () =>
    setEditor({
      title: "新建服务计划",
      fields: [
        ...selectFields,
        { key: "title", label: "计划名称", required: true },
        ownerField(c),
        {
          key: "startsAt",
          label: "服务开始",
          type: "datetime-local",
          required: true,
        },
        {
          key: "endsAt",
          label: "服务结束",
          type: "datetime-local",
          required: true,
        },
        { key: "note", label: "服务目标与说明", type: "textarea" },
      ],
      values: {
        customerId: params.get("customerId") ?? "",
        channelId: c.channels[0]?.id ?? "",
        ownerMembershipId: c.meta.currentMembershipId,
        startsAt: local(),
        endsAt: local(new Date(Date.now() + 30 * 86400000)),
      },
      submit: async (v) => {
        await command(c.base + "/service-plans", v);
        await reload();
      },
    });
  const createRisk = () =>
    setEditor({
      title: "登记客户风险",
      fields: [
        ...selectFields,
        { key: "title", label: "风险事项", required: true },
        {
          key: "severity",
          label: "严重程度",
          type: "select",
          options: ["low", "medium", "high"].map((id) => ({
            id,
            name: salesLabels[id],
          })),
          required: true,
        },
        { key: "detail", label: "情况说明", type: "textarea", required: true },
      ],
      values: {
        customerId: params.get("customerId") ?? "",
        channelId: c.channels[0]?.id ?? "",
        severity: "medium",
      },
      submit: async (v) => {
        await command(c.base + "/service-risks", v);
        await reload();
      },
    });
  return (
    <>
      <PageTitle
        title="客户服务"
        action={
          <Permission name="crm.service.write">
            <button
              className="primary"
              onClick={tab === "plans" ? createPlan : createRisk}
            >
              {tab === "plans" ? "新建服务计划" : "登记风险"}
            </button>
          </Permission>
        }
      />
      <div className="toolbar">
        <button
          aria-pressed={tab === "plans"}
          onClick={() => {
            const p = new URLSearchParams(params);
            p.set("tab", "plans");
            p.set("page", "1");
            setParams(p);
          }}
        >
          服务计划
        </button>
        <button
          aria-pressed={tab === "risks"}
          onClick={() => {
            const p = new URLSearchParams(params);
            p.set("tab", "risks");
            p.set("page", "1");
            setParams(p);
          }}
        >
          客户风险
        </button>
      </div>
      {tab === "plans" ? (
        <Result {...plans}>
          {plans.data?.items.length ? (
            plans.data.items.map((p: any) => (
              <section className="panel form-panel" key={p.id}>
                <div className="crm-section-heading">
                  <h2>{p.title}</h2>
                  <span>{salesLabels[p.status]}</span>
                </div>
                <p>
                  <CustomerLink
                    id={p.customerId}
                    name={p.customer.displayName}
                  />{" "}
                  · 负责人：{memberName(c, p.ownerMembershipId)}
                </p>
                <p>
                  {date(p.startsAt)} — {date(p.endsAt)}
                </p>
                {p.note && <p className="crm-note">{p.note}</p>}
                <div className="form-actions">
                  <Permission name="crm.sales.renewal">
                    <button
                      onClick={() => {
                        const e = opportunityEditor(c, command, reload);
                        setEditor({
                          ...e,
                          title: "创建续约商机",
                          values: {
                            ...e.values,
                            customerId: p.customerId,
                            channelId: p.channelId,
                            kind: "renewal",
                            ownerMembershipId: "",
                          },
                          submit: async (v) => {
                            await command(c.base + "/service-renewals", {
                              ...v,
                              kind: "renewal",
                            });
                            await reload();
                          },
                        });
                      }}
                    >
                      创建续约商机
                    </button>
                  </Permission>
                  <Permission name="crm.service.write">
                    {p.status === "active" && (
                      <>
                        <button
                          onClick={() =>
                            setEditor({
                              title: "指派服务任务",
                              fields: [
                                {
                                  key: "title",
                                  label: "任务名称",
                                  required: true,
                                },
                                ownerField(c, "assigneeMembershipId", "执行人"),
                                {
                                  key: "dueAt",
                                  label: "截止时间",
                                  type: "datetime-local",
                                  required: true,
                                },
                              ],
                              values: {
                                assigneeMembershipId: p.ownerMembershipId,
                                dueAt: local(new Date(p.endsAt)),
                              },
                              submit: async (v) => {
                                await command(
                                  c.base + "/service-plans/" + p.id + "/tasks",
                                  v,
                                );
                                await reload();
                              },
                            })
                          }
                        >
                          指派任务
                        </button>
                        {["complete", "cancel"].map((action) => (
                          <button
                            key={action}
                            onClick={() =>
                              setEditor({
                                title:
                                  action === "complete"
                                    ? "完成服务计划"
                                    : "取消服务计划",
                                fields: [reasonField],
                                values: {},
                                submit: async (v) => {
                                  await command(
                                    c.base +
                                      "/service-plans/" +
                                      p.id +
                                      "/actions",
                                    { ...v, action, version: p.version },
                                  );
                                  await reload();
                                },
                              })
                            }
                          >
                            {action === "complete" ? "完成计划" : "取消计划"}
                          </button>
                        ))}
                      </>
                    )}
                  </Permission>
                </div>
                {p.tasks.length ? (
                  <Table paginate
                    headers={[
                      "服务任务",
                      "执行人",
                      "期限",
                      "状态与结果",
                      "操作",
                    ]}
                  >
                    {p.tasks.map((t: any) => (
                      <tr key={t.id}>
                        <td>{t.title}</td>
                        <td>{memberName(c, t.assigneeMembershipId)}</td>
                        <td>{date(t.dueAt)}</td>
                        <td>
                          {salesLabels[t.status]}
                          <p className="crm-note">{t.completionNote}</p>
                          {t.reviewReason && <p>审核：{t.reviewReason}</p>}
                        </td>
                        <td><RecordActions>
                          <>
                            {p.status === "active" && (
                              <>
                                {["open", "rejected"].includes(t.status) &&
                                  t.assigneeMembershipId ===
                                    c.meta.currentMembershipId &&
                                  c.can("crm.service.write") && (
                                    <button
                                      onClick={() =>
                                        setEditor({
                                          title: "提交服务结果",
                                          fields: [
                                            {
                                              key: "note",
                                              label: "实际服务结果",
                                              type: "textarea",
                                              required: true,
                                            },
                                          ],
                                          values: {
                                            note: t.completionNote ?? "",
                                          },
                                          submit: async (v) => {
                                            await command(
                                              c.base +
                                                "/service-tasks/" +
                                                t.id +
                                                "/actions",
                                              {
                                                ...v,
                                                action: "submit",
                                                version: t.version,
                                              },
                                            );
                                            await reload();
                                          },
                                        })
                                      }
                                    >
                                      提交结果
                                    </button>
                                  )}
                                {t.status === "submitted" &&
                                  t.submittedBy !==
                                    c.meta.currentMembershipId &&
                                  c.can("crm.service.review") &&
                                  ["approve", "reject"].map((action) => (
                                    <button
                                      key={action}
                                      onClick={() =>
                                        setEditor({
                                          title:
                                            action === "approve"
                                              ? "通过服务审核"
                                              : "退回修改",
                                          fields: [
                                            {
                                              key: "note",
                                              label: "审核意见",
                                              type: "textarea",
                                              required: true,
                                            },
                                          ],
                                          values: {},
                                          submit: async (v) => {
                                            await command(
                                              c.base +
                                                "/service-tasks/" +
                                                t.id +
                                                "/actions",
                                              {
                                                ...v,
                                                action,
                                                version: t.version,
                                              },
                                            );
                                            await reload();
                                          },
                                        })
                                      }
                                    >
                                      {action === "approve"
                                        ? "审核通过"
                                        : "退回修改"}
                                    </button>
                                  ))}
                              </>
                            )}
                          </>
                        </RecordActions></td>
                      </tr>
                    ))}
                  </Table>
                ) : (
                  <p>尚未指派服务任务</p>
                )}
              </section>
            ))
          ) : (
            <Empty text="暂无服务计划" />
          )}
          <Paging d={plans.data} params={params} setParams={setParams} />
        </Result>
      ) : (
        <Result {...risks}>
          {risks.data?.items.length ? (
            <Table headers={["风险", "客户", "负责人", "程度", "状态", "处理"]}>
              {risks.data.items.map((r: any) => (
                <tr key={r.id}>
                  <td>
                    {r.title}
                    <p className="crm-note">{r.detail}</p>
                  </td>
                  <td>
                    <CustomerLink
                      id={r.customerId}
                      name={r.customer.displayName}
                    />
                  </td>
                  <td>{memberName(c, r.ownerMembershipId)}</td>
                  <td>{salesLabels[r.severity]}</td>
                  <td>{salesLabels[r.status]}</td>
                  <td><RecordActions>
                    {r.status === "open" ? (
                      <Permission name="crm.service.write">
                        <button
                          onClick={() =>
                            setEditor({
                              title: "关闭客户风险",
                              fields: [
                                {
                                  key: "resolution",
                                  label: "解决情况",
                                  type: "textarea",
                                  required: true,
                                },
                              ],
                              values: {},
                              submit: async (v) => {
                                await command(
                                  c.base + "/service-risks/" + r.id + "/close",
                                  { ...v, version: r.version },
                                );
                                await reload();
                              },
                            })
                          }
                        >
                          登记解决结果
                        </button>
                      </Permission>
                    ) : (
                      <p className="crm-note">{r.resolution}</p>
                    )}
                  </RecordActions></td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty text="暂无客户风险" />
          )}
          <Paging d={risks.data} params={params} setParams={setParams} />
        </Result>
      )}
      {editor && <CrmEditor editor={editor} onClose={() => setEditor(null)} />}
    </>
  );
}
function LeadDuplicates({
  name,
  contact,
}: {
  name?: string;
  contact?: string;
}) {
  const c = useCrm(),
    a = useBusinessAction(),
    [items, setItems] = useState<any[] | null>(null);
  return (
    <div className="panel form-panel">
      <button
        type="button"
        disabled={a.busy || !name?.trim()}
        onClick={() =>
          void a.run(async () => {
            setItems(
              (
                await api.post<any>(c.base + "/leads/duplicate-candidates", {
                  name,
                  ...(contact ? { contact } : {}),
                })
              ).items,
            );
          }, "候选已核对")
        }
      >
        检查重复候选
      </button>
      <ActionNotices action={a} />
      {items?.map((r) => (
        <p key={r.id}>
          <Link
            target="_blank"
            rel="noreferrer"
            to={c.prefix + "/leads/" + r.id}
          >
            {r.name}
          </Link>{" "}
          · {salesLabels[r.status]}
        </p>
      ))}
      {items?.length === 0 && <p>当前可见范围内没有重复候选。</p>}
    </div>
  );
}
