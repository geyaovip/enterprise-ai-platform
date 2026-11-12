import { DropdownSelect } from '@suite/frontend/components';
import { useState } from 'react';
import { DetailFacts, Empty, Field, Status } from '../components';
import { useApiData } from '../hooks';
import { amount, manufacturingApi, options, qty, SaveDialog, text } from './common';
import type { Order, ProductionJob, ProductionReport, TeamMember } from './common';

type Mode = { kind: 'plan' | 'release' | 'dispatch' }
  | { kind: 'report' | 'cancel_job'; job: ProductionJob }
  | { kind: 'review'; report: ProductionReport; decision: 'approved' | 'rejected' };

const labels = { plan: '新建生产计划', release: '发布计划', dispatch: '下达工单', cancel_job: '取消工单', report: '登记报工', review: '审核报工' };
const roleLabels: Record<string, string> = { planner: '计划员', operator: '生产操作员', supervisor: '生产主管' };

export function ProductionPanel({ order, tenantKey, permissions, saved }: {
  order: Order; tenantKey: string; permissions: readonly string[]; saved: (result: { id: string; number?: string }) => void;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const canPlan = permissions.includes('manufacturing.plan');
  const canReport = permissions.includes('manufacturing.report');
  const canReview = permissions.includes('manufacturing.review');
  const team = useApiData<TeamMember[]>(order.plan || mode?.kind === 'dispatch' ? manufacturingApi(tenantKey, '/team') : null);
  const plan = order.plan;
  const remaining = (job: ProductionJob) => job.quantity - job.reports
    .filter(r => r.status !== 'rejected').reduce((total, r) => total + r.good + r.defective, 0);
  const title = mode?.kind === 'review' ? mode.decision === 'approved' ? '通过报工' : '退回报工' : mode ? labels[mode.kind] : '';
  return <>
    <section className="panel">
      <div className="panel-heading manufacturing-heading"><h2>生产计划</h2>
        {!plan && canPlan && !order.completedQty && <button className="primary" onClick={() => setMode({ kind: 'plan' })}>{labels.plan}</button>}
        {plan?.status === 'draft' && canPlan && <button className="primary" onClick={() => setMode({ kind: 'release' })}>{labels.release}</button>}
        {plan?.status === 'released' && canPlan && <button className="primary" onClick={() => setMode({ kind: 'dispatch' })}>{labels.dispatch}</button>}
      </div>
      {plan ? <DetailFacts items={[
        { label: '状态', value: <Status value={plan.status === 'released' ? 'active' : 'draft'} label={plan.status === 'released' ? '已发布' : '草稿'}/> },
        { label: '计划日期', value: `${plan.startDate} 至 ${plan.dueDate}` },
        { label: '已审核合格', value: amount(order.production.good) },
        { label: '已审核不良', value: amount(order.production.defective) },
        { label: '待审核报工', value: amount(order.production.pending) },
      ]}/> : <Empty text={order.completedQty ? '该订单按直接完工流程执行。' : '发布计划并派工后，由操作员报工、主管审核。'}/>}
    </section>
    {!!plan?.jobs.length && <section className="panel table-wrap"><h2>工单与报工</h2>
      <table><thead><tr><th>工单</th><th>负责人</th><th>派工量</th><th>报工记录</th><th>操作</th></tr></thead>
        <tbody>{plan.jobs.map(job => <tr key={job.id}><td>{job.label}</td>
          <td>{team.data?.find(m => m.id === job.assigneeId)?.name ?? '—'}</td><td>{amount(job.quantity)}</td>
          <td>{job.reports.length ? job.reports.map(report => <div key={report.id} className="manufacturing-report">
            <Status value={report.status} label={report.status === 'pending' ? '待审核' : undefined}/><span>合格 {report.good} · 不良 {report.defective}</span>
            {report.note && <small>{report.note}</small>}
            {report.reviewNote && <small>{report.reviewNote}</small>}
            {canReview && report.status === 'pending' && report.reporterId !== order.actorMembershipId && <div className="manufacturing-actions">
              <button onClick={() => setMode({ kind: 'review', report, decision: 'approved' })}>通过报工</button>
              <button onClick={() => setMode({ kind: 'review', report, decision: 'rejected' })}>退回报工</button>
            </div>}
          </div>) : '暂无报工'}</td>
          <td><div className="manufacturing-actions">
            {canReport && job.assigneeId === order.actorMembershipId && remaining(job) > 0 &&
              <button onClick={() => setMode({ kind: 'report', job })}>登记报工</button>}
            {canPlan && !job.reports.length && <button onClick={() => setMode({ kind: 'cancel_job', job })}>取消工单</button>}
          </div></td>
        </tr>)}</tbody></table>
    </section>}
    {mode && <SaveDialog title={title} path={manufacturingApi(tenantKey, '/orders/' + order.id + '/production')}
      close={() => setMode(null)} saved={result => { setMode(null); saved(result); }} confirmLabel={title} body={form => {
        if (mode.kind === 'plan') return { action: mode.kind, startDate: text(form, 'startDate'), dueDate: text(form, 'dueDate') };
        if (mode.kind === 'dispatch') return { action: mode.kind, version: plan?.version, assigneeId: text(form, 'assigneeId'), label: text(form, 'label'), quantity: qty(form) };
        if (mode.kind === 'report') return { action: mode.kind, jobId: mode.job.id, good: qty(form, 'good'), defective: qty(form, 'defective'), note: text(form, 'note') };
        if (mode.kind === 'review') return { action: mode.kind, reportId: mode.report.id, decision: mode.decision, note: text(form, 'note') };
        return { action: mode.kind, version: plan?.version, ...('job' in mode ? { jobId: mode.job.id } : {}) };
      }}>
      {mode.kind === 'plan' && <div className="form-grid">
        <Field label="计划开始"><input type="date" name="startDate" required/></Field>
        <Field label="计划完成"><input type="date" name="dueDate" required defaultValue={order.dueDate ?? undefined}/></Field>
      </div>}
      {mode.kind === 'release' && <p>发布后可下达工单。成品入库按审核通过的合格数量控制。</p>}
      {mode.kind === 'dispatch' && <div className="form-grid">
        <Field label="工单名称"><input required name="label" maxLength={80}/></Field>
        <Field label="负责人"><DropdownSelect required name="assigneeId" defaultValue=""><option value="">选择负责人</option>
          {options(team.data?.filter(m => m.role === 'admin' || m.productionRole === 'operator') ?? [])}
        </DropdownSelect></Field>
        <Field label="派工数量"><input required name="quantity" type="number" min="1" max={order.quantity} step="1"/></Field>
      </div>}
      {mode.kind === 'cancel_job' && 'job' in mode && <p>取消「{mode.job.label}」并释放尚未报工的派工量。</p>}
      {mode.kind === 'report' && <div className="form-grid">
        <Field label="合格数量"><input required type="number" name="good" defaultValue="0" min="0" step="1" max={remaining(mode.job)}/></Field>
        <Field label="不良数量"><input required type="number" name="defective" defaultValue="0" min="0" step="1" max={remaining(mode.job)}/></Field>
        <Field label="报工备注"><input name="note" maxLength={500}/></Field>
      </div>}
      {mode.kind === 'review' && <>
        <p>合格 {mode.report.good} 件，不良 {mode.report.defective} 件。</p>
        <Field label={mode.decision === 'rejected' ? '退回原因' : '审核备注'}><input name="note" maxLength={500} required={mode.decision === 'rejected'}/></Field>
      </>}
    </SaveDialog>}
  </>;
}

export function ProductionTeam({ tenantKey }: { tenantKey: string }) {
  const [selected, setSelected] = useState<TeamMember | null>(null);
  const path = manufacturingApi(tenantKey, '/team');
  const team = useApiData<TeamMember[]>(path);
  return <section className="panel table-wrap"><h2>生产岗位</h2>
    {team.error && <p role="alert">{team.error}</p>}
    {team.data?.filter(m => m.role !== 'admin').length ? <table><thead><tr><th>成员</th><th>生产岗位</th><th>操作</th></tr></thead>
      <tbody>{team.data.filter(m => m.role !== 'admin').map(m => <tr key={m.id}><td>{m.name}</td>
        <td>{m.productionRole ? roleLabels[m.productionRole] : '未分配'}</td>
        <td><button onClick={() => setSelected(m)} aria-label={`设置${m.name}的生产岗位`}>设置岗位</button></td></tr>)}</tbody>
    </table> : <p className="muted">先在企业管理邀请成员，再分配生产岗位。</p>}
    {selected && <SaveDialog title="设置生产岗位" path={path} close={() => setSelected(null)} saved={() => { setSelected(null); void team.reload(); }}
      body={form => ({ membershipId: selected.id, role: text(form, 'role') || null })}>
      <p>{selected.name}</p>
      <Field label="生产岗位"><DropdownSelect name="role" defaultValue={selected.productionRole ?? ''}><option value="">未分配</option>
        {Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </DropdownSelect></Field>
    </SaveDialog>}
  </section>;
}
