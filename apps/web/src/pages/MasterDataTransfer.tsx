import { useRef, useState } from 'react';
import { api, erpApi, errorText } from '../api';
import { ConfirmDialog, Notice, ActionPanel, DialogAction } from '../components';

type Kind = 'customers' | 'products' | 'suppliers';
type Preview = { total: number; valid: boolean; errors: Array<{ row: number; message: string }>; columns: Record<string, string>; items: Array<Record<string, unknown> | null> };
const templates: Record<Kind, string> = {
  customers: '客户编号,名称,联系人,电话,行业\r\n',
  products: '商品编码,名称,类别,单位,售价,采购价,低库存阈值\r\n',
  suppliers: '供应商编号,名称,联系人,电话\r\n',
};
function download(name: string, contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function MasterDataTransfer({ tenantKey, kind, canWrite, query, onImported }: { tenantKey: string; kind: Kind; canWrite: boolean; query: string; onImported: () => Promise<unknown> }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState(''); const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null); const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false); const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState<string | null>(null); const [tone, setTone] = useState<'error' | 'success'>('error');
  const base = erpApi(tenantKey, `/master/${kind}`);
  const load = async (file?: File) => {
    setPreview(null); setCsv(''); setFileName(file?.name ?? ''); setMessage(null); setRequestKey(crypto.randomUUID());
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 512 * 1024) throw Error('CSV 文件不能超过 512 KiB');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      const result = await api.post<Preview>(`${base}/import-preview`, { csv: text });
      setCsv(text); setPreview(result);
    } catch (error) { setTone('error'); setMessage(error instanceof TypeError ? '文件编码不是 UTF-8，请在表格软件中另存为 CSV UTF-8。' : errorText(error)); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  };
  const importRows = async () => {
    setBusy(true); setMessage(null);
    try {
      const result = await api.post<{ count: number }>(`${base}/import`, { csv, requestKey });
      setPreview(null); setCsv(''); setFileName(''); setRequestKey(crypto.randomUUID());
      setTone('success'); setMessage(`已导入 ${result.count} 条资料。`); await onImported();
    } catch (error) { setTone('error'); setMessage(errorText(error)); }
    finally { setBusy(false); setConfirm(false); }
  };
  const exportRows = async () => {
    setBusy(true); setMessage(null);
    try { const result = await api.get<{ filename: string; csv: string; total: number }>(`${base}/export?q=${encodeURIComponent(query)}`); download(result.filename, result.csv); setTone('success'); setMessage(`已导出当前搜索范围的 ${result.total} 条基础资料。`); }
    catch (error) { setTone('error'); setMessage(errorText(error)); }
    finally { setBusy(false); }
  };
  return <ActionPanel title="批量导入与导出" label="导入 / 导出" busy={busy} primary={false}><div className="data-transfer">
    <p>按当前搜索范围导出，不包含库存和账款。</p>
    <div className="form-actions"><button type="button" disabled={busy} onClick={() => void exportRows()}>导出 CSV</button>{canWrite && <><button type="button" disabled={busy} onClick={() => download(`${kind}-template.csv`, '\uFEFF' + templates[kind])}>下载导入模板</button><button type="button" disabled={busy} onClick={() => fileInput.current?.click()}>{busy ? '处理中…' : '选择 CSV 并预览'}</button><input ref={fileInput} hidden type="file" accept=".csv,text/csv" aria-label="选择要导入的 CSV 文件" onChange={e => void load(e.target.files?.[0])} /></>}</div>
    {canWrite && <p>UTF-8 CSV，最多 500 条、512 KiB；已有编号不覆盖。{kind === 'customers' ? '客户默认由你负责，管理员可在导入后调整。' : kind === 'products' ? '商品单位为“件”，初始库存为 0；已有库存请通过盘点处理。' : ''}</p>}
    <Notice text={message} tone={tone} />
    {preview && <section aria-label="导入预览"><h3>{fileName} · 共 {preview.total} 条</h3>{preview.errors.length ? <><p>请修改以下错误后重新选择文件：</p><ul>{preview.errors.slice(0, 30).map((error, i) => <li key={i}>第 {error.row} 行：{error.message}</li>)}</ul>{preview.errors.length > 30 && <p>还有 {preview.errors.length - 30} 个错误，请分批检查。</p>}</> : <p>校验通过。下表预览前 {preview.items.length} 条，确认后保存全部 {preview.total} 条。</p>}
      <div className="table-wrap"><table><thead><tr>{Object.values(preview.columns).map(title => <th key={title}>{title}</th>)}</tr></thead><tbody>{preview.items.map((row, index) => <tr key={index}>{Object.keys(preview.columns).map(key => <td key={key}>{String(row?.[key] ?? '—')}</td>)}</tr>)}</tbody></table></div>
      <div className="form-actions"><DialogAction><button type="button" className="primary" disabled={busy || !preview.valid} onClick={() => setConfirm(true)}>确认导入 {preview.total} 条</button></DialogAction><button type="button" disabled={busy} onClick={() => { setPreview(null); setCsv(''); setFileName(''); }}>取消</button></div>
    </section>}
    <ConfirmDialog error={tone === "error" ? message : null} open={confirm} title="确认批量导入" description={<p>将新增 {preview?.total ?? 0} 条资料。已有资料不会被覆盖，库存和历史单据不会导入。</p>} busy={busy} onCancel={() => setConfirm(false)} onConfirm={() => void importRows()} />
  </div></ActionPanel>;
}
