import { DropdownSelect } from '@suite/frontend/components';
import { useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { api, errorText, tenantApi } from '../api';
import { useApiData } from '../hooks';
import { Dialog, DialogAction, Field, Notice } from '../components';

export const manufacturingApi = (tenantKey: string, path: string) => tenantApi(tenantKey, '/apps/manufacturing' + path);
export type Choice = { id: string; name: string; code?: string; sku?: string };
export type Material = Choice & { sku: string; unit: string; kind: string };
export type Catalog = {
  customers: Choice[]; suppliers: Choice[]; warehouses: Choice[]; products: (Choice & { unit: string })[];
  materials: Material[]; links: { materialId: string; productId: string }[]; materialTotal: number;
  boms: { id: string; productId: string; revision: number; productName: string; productSku: string }[];
};
export type Page<T> = { items: T[]; total: number; page: number; page_size: number };
export type OrderSummary = {
  id: string; number: string; customerName: string; productName: string; sku: string; quantity: number;
  completedQty: number; shippedQty: number; salesStatus: string; salesReviewNote: string | null; createdBy: string; dueDate: string | null; version: number;
};
export type Requirement = {
  productId: string; sku: string; name: string; unit: string; quantity: string;
  issued: string; consumed: string; onHand: string; pending: string; incoming: string;
  shortage: string; suggested: string; available: string; reserved: string;
};
export type Purchase = {
  id: string; number: string; version: number; status: string; createdByMembershipId: string;
  supplier: { name: string };
  lines: { id: string; sku: string; quantity: number; receivedQty: number }[];
};
export type Order = OrderSummary & {
  productId: string; bomRevision: number; requirements: Requirement[]; purchases: Purchase[];
  finishedOnHand: number; finishedAvailable: string; finishedReserved: string; readyToComplete: number; warehouse: Choice | null; actorMembershipId: string; canApproveDraft: boolean;
  plan: ProductionPlan | null; production: { pending: number; good: number; defective: number };
  documents: { id: string; number: string; kind: string; createdAt: string; movements: { productId: string; quantity: number; trackingCode: string | null }[] }[];
};

export type ProductionReport = { id: string; reporterId: string; good: number; defective: number; status: string; note: string | null; reviewNote: string | null };
export type ProductionJob = { id: string; assigneeId: string; quantity: number; label: string; reports: ProductionReport[] };
export type ProductionPlan = { id: string; startDate: string; dueDate: string; version: number; status: string; jobs: ProductionJob[] };

export const amount = (value: string | number) => Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 6 });
export const text = (form: FormData, name: string) => String(form.get(name) ?? '').trim();
export const qty = (form: FormData, name = 'quantity') => Number(form.get(name));

export function options(items: Choice[]) {
  return items.map(x => <option key={x.id} value={x.id}>{x.code || x.sku ? `${x.code ?? x.sku} · ` : ''}{x.name}</option>);
}

export function useCatalog(tenantKey: string, q = '', enabled = true) {
  return useApiData<Catalog>(enabled ? manufacturingApi(tenantKey, '/catalog?q=' + encodeURIComponent(q)) : null);
}

export function Search({ label, value, onChange, maxLength = 80 }: { label: string; value: string; onChange: (q: string) => void; maxLength?: number }) {
  return <form className="toolbar" onSubmit={e => { e.preventDefault(); onChange(text(new FormData(e.currentTarget), 'search')); }}>
    <input key={value} name="search" aria-label={label} defaultValue={value} placeholder={label} maxLength={maxLength}/>
    <button>搜索</button>{value && <button type="reset" onClick={() => onChange('')}>清除</button>}
  </form>;
}

export function SaveDialog({
  title, path, close, saved, body, children, confirmLabel = '保存',
}: {
  title: string; path: string; close: () => void; saved: (result: { id: string; number?: string }) => void;
  body: (form: FormData) => Record<string, unknown>; children: ReactNode; confirmLabel?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const inFlight = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    setError('');
    inFlight.current = true;
    setBusy(true);
    try {
      const input = body(new FormData(event.currentTarget));
      const payload = JSON.stringify(input);
      if (attempt.current?.payload !== payload) attempt.current = { payload, key: crypto.randomUUID() };
      const result = await api.post<{ id: string; number?: string }>(path, { ...input, requestKey: attempt.current.key });
      saved(result);
    } catch (e) {
      setError(errorText(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return <Dialog open title={title} onClose={close} busy={busy} size="large" dirtyCheck>
    <Notice text={error}/><form onSubmit={submit} className="form-panel">
      {children}
      <DialogAction><button className="primary" disabled={busy}>{busy ? '正在提交…' : confirmLabel}</button></DialogAction>
    </form>
  </Dialog>;
}

export function trackingFrom(form: FormData, suffix = '') {
  const code = text(form, 'trackingCode' + suffix);
  return code ? { code, kind: text(form, 'trackingKind' + suffix) } : undefined;
}

export function TrackingFields({ suffix = '' }: { suffix?: string }) {
  return <div className="form-grid">
    <Field label="批次／序列号" hint="可用扫码枪录入，也可手填。留空按无批次库存办理。">
      <input name={'trackingCode' + suffix} maxLength={100} onKeyDown={e => {
        if (e.key === 'Enter') e.preventDefault();
      }}/>
    </Field>
    <Field label="追溯类型"><DropdownSelect name={'trackingKind' + suffix} defaultValue="lot">
      <option value="lot">批次</option><option value="serial">序列号</option>
    </DropdownSelect></Field>
  </div>;
}

export type TeamMember = { id: string; name: string; role: string; productionRole: string | null };
