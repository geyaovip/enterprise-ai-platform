import { useState } from 'react';
import { api, erpApi, errorText, tenantApi } from '../api';
import { Field, Loading, Notice, Dialog, DialogAction } from '../components';
import { useApiData } from '../hooks';
import type { Customer, Member } from '../types';

export function CustomerOwnershipPanel({ tenantKey, customer, onDone, onCancel }: { tenantKey: string; customer: Customer; onDone: () => Promise<void>; onCancel: () => void }) {
  const members = useApiData<Member[]>(tenantApi(tenantKey, '/members'));
  const [target, setTarget] = useState('__choose__');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eligible = members.data?.filter(member => member.active && member.user.active && member.role === 'sales' && member.id !== customer.ownerMembershipId) ?? [];
  const currentOwner = customer.ownerMembershipId ? members.data?.find(member => member.id === customer.ownerMembershipId)?.user.name ?? '原负责人' : '公海';
  const transfer = async () => {
    if (target === '__choose__' || !reason.trim()) return;
    setBusy(true); setError(null);
    try {
      await api.post(erpApi(tenantKey, `/customers/${customer.id}/transfer`), { expectedOwnerMembershipId: customer.ownerMembershipId, newOwnerMembershipId: target === '__pool__' ? null : target, reason });
      await onDone();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  return <Dialog open title={"调整客户负责人 · "+customer.code} onClose={onCancel} busy={busy} dirtyCheck><section className="form-panel"><p>当前负责人：{currentOwner}。转派会同步变更关联商机与合同的负责人；有待审核事项时须先处理。退回公海仅适用于无商机、合同和到账记录的客户。</p><Notice text={members.error} /><Notice text={error} />{members.loading ? <Loading /> : <><Field label="新负责人"><select value={target} onChange={event => setTarget(event.target.value)}><option value="__choose__">请选择</option>{customer.ownerMembershipId && <option value="__pool__">退回公海</option>}{eligible.map(member => <option key={member.id} value={member.id}>{member.user.name} · {member.user.email}</option>)}</select></Field><Field label="转派原因"><textarea maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></Field><div className="form-actions"><DialogAction><button className="primary" disabled={busy || target === '__choose__' || !reason.trim()} onClick={() => void transfer()}>{busy ? '处理中…' : '确认调整'}</button></DialogAction><button type="button" onClick={onCancel}>取消</button></div></>}</section></Dialog>;
}
