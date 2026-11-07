import { useEffect, useState } from 'react';
import { api, errorText, tenantApi } from '../api';
import { useApiData } from '../hooks';
import { useServices } from '../services';
import { RecordActions, DataResult, DialogAction, PasswordInput, Dialog, Field, Notice, InfoTip, ConfirmDialog } from '../components';

type Kind = 'text' | 'image' | 'video';
type Model = { source: 'platform' | 'custom'; configured: boolean; model: string; baseUrl: string; version: number };
const names: Record<Kind, string> = { text: '文字模型', image: '生图模型', video: '视频模型' };

export function ManagedAiSettings({ tenantKey, onSaved }: { tenantKey: string; onSaved: () => Promise<void> }) {
  const base = tenantApi(tenantKey, '/model-settings');
  const settings = useApiData<Record<Kind, Model>>(base), services = useServices();
  useEffect(() => { if (window.location.hash === '#enterprise-models' && settings.data) document.getElementById('enterprise-models')?.scrollIntoView({block:'start'}); }, [settings.data]);
  const [kind, setKind] = useState<Kind | null>(null), [resetting, setResetting] = useState<Kind | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ model: '', baseUrl: '', apiKey: '', version: 0 });
  const close = () => { setKind(null); setForm(v => ({ ...v, apiKey: '' })); setError(null); };
  const refresh = async () => { await settings.reload(); await onSaved(); await services.reload?.(); };
  return <><section className="panel" id="enterprise-models"><h2>企业模型</h2><DataResult {...settings}>{settings.data && (['text', 'image', 'video'] as const).map(key => {
    const value = settings.data![key];
    return <div className="setting-row" key={key}><div className="enterprise-model-summary"><strong>{names[key]}</strong>{key !== 'text' && <InfoTip label={`${names[key]}接口说明`}>{key === 'image' ? '使用与 Seedream 兼容的图片生成接口。' : '用于品牌内容工作台的视频生成。填写与 Seedance 兼容的接口。'}</InfoTip>}<p className="enterprise-model-name">{value.model}</p><small>{value.source === 'custom' ? '企业自定义' : value.configured ? '平台默认' : '平台默认尚未配置'}</small></div><RecordActions><button aria-label={`配置${names[key]}`} disabled={busy} onClick={() => { setForm({ model: value.model, baseUrl: value.baseUrl, apiKey: '', version: value.version }); setError(null); setKind(key); }}>配置</button>{value.source === 'custom' && <button aria-label={`${names[key]}恢复平台默认`} disabled={busy} onClick={() => { setError(null); setResetting(key); }}>恢复默认</button>}</RecordActions></div>;
  })}</DataResult></section>
  <Dialog open={kind !== null} title={kind ? `配置${names[kind]}` : '配置模型'} onClose={close} busy={busy} dirtyCheck><Notice text={error}/><form className="form-panel" onSubmit={async event => {
    event.preventDefault(); if (!kind) return; setBusy(true); setError(null);
    try { await api.put(`${base}/${kind}`, form); await refresh(); close(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }}><Field label="模型名称"><input required maxLength={120} value={form.model} onChange={e => setForm({ ...form, model: e.target.value })}/></Field><Field label="模型 API 地址"><input required type="url" value={form.baseUrl} placeholder="https://模型服务域名/v1" onChange={e => setForm({ ...form, baseUrl: e.target.value })}/></Field><Field label="API 密钥"><PasswordInput required autoComplete="new-password" minLength={8} maxLength={1000} value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })}/></Field><DialogAction><button className="primary" disabled={busy}>{busy ? '保存中…' : '保存配置'}</button></DialogAction></form></Dialog>
  <ConfirmDialog open={resetting !== null} title={`${resetting ? names[resetting] : '模型'}恢复平台默认`} confirmLabel="恢复默认" description="将移除此项企业自定义密钥并使用平台默认配置，已有作品和记录保留。" error={error} busy={busy} onCancel={() => { setResetting(null); setError(null); }} onConfirm={() => void (async () => {
    if (!resetting || !settings.data) return; setBusy(true); setError(null);
    try { await api.post(`${base}/${resetting}/reset`, { version: settings.data[resetting].version }); await refresh(); setResetting(null); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  })()}/></>;
}
