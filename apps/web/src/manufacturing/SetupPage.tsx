import { DropdownSelect } from '@suite/frontend/components';
import { ProductionTeam } from './ProductionPanel';
import { useState } from 'react';
import { DataResult, Empty, Field, Notice, PageTitle, Status } from '../components';
import { manufacturingApi, options, SaveDialog, Search, text, useCatalog } from './common';

const kinds: Record<string, string> = { finished: '成品', semi: '半成品', raw: '原料', packaging: '包装', auxiliary: '辅料' };
type Mode = 'customer' | 'supplier' | 'item' | 'link' | 'bom';

export function SetupPage({ tenantKey }: { tenantKey: string }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<string[]>([]);
  const [product, setProduct] = useState('');
  const [message, setMessage] = useState('');
  const catalog = useCatalog(tenantKey, q);
  const data = catalog.data;
  const ready = data?.materials.filter(m => data.links.some(l => l.materialId === m.id)) ?? [];
  const close = () => setMode(null);
  const saved = () => { close(); setMessage('已保存'); void catalog.reload(); };
  const base = (path: string) => manufacturingApi(tenantKey, path);
  function open(mode: Mode) {
    setProduct('');
    setRows([crypto.randomUUID()]);
    setMessage('');
    setMode(mode);
  }
  return <>
    <PageTitle title="基础资料" action={<button className="primary" onClick={() => open('item')}>新建物料</button>}/>
    <Notice text={message} tone="success"/>
    <DataResult {...catalog}>
      <div className="toolbar">
        <button onClick={() => open('bom')}>发布 BOM</button>
        <button onClick={() => open('link')}>关联已有物料</button>
        <button onClick={() => open('customer')}>新建客户</button>
        <button onClick={() => open('supplier')}>新建供应商</button>
      </div>
      <Search label="按名称或编码查找资料" value={q} onChange={setQ}/>
      <section className="panel table-wrap">
        <h2>物料与库存关联</h2>
        {!data?.materials.length ? <Empty text="先建立成品和原料，再为成品发布 BOM。"/> : <table>
          <thead><tr><th>编码</th><th>名称</th><th>类型</th><th>单位</th><th>库存关联</th><th>已发布 BOM</th></tr></thead>
          <tbody>{data.materials.map(m => {
            const bom = data.boms.find(b => b.productId === m.id);
            const linked = data.links.some(l => l.materialId === m.id);
            return <tr key={m.id}><td>{m.sku}</td><td>{m.name}</td><td>{kinds[m.kind]}</td><td>{m.unit}</td>
              <td><Status value={linked ? 'active' : 'pending'} label={linked ? '已关联' : '待关联'}/></td>
              <td>{bom ? 'V' + bom.revision : '—'}</td></tr>;
          })}</tbody>
        </table>}
      </section>
      <section className="panel">
        <h2>往来单位</h2>
        <div className="form-grid">
          <div><h3>客户</h3>{data?.customers.length ? <ul>{data.customers.map(x => <li key={x.id}>{x.code} · {x.name}</li>)}</ul> : <p className="muted">暂无客户</p>}</div>
          <div><h3>供应商</h3>{data?.suppliers.length ? <ul>{data.suppliers.map(x => <li key={x.id}>{x.code} · {x.name}</li>)}</ul> : <p className="muted">暂无供应商</p>}</div>
        </div>
      </section>
    </DataResult>
    <ProductionTeam tenantKey={tenantKey}/>
    {(mode === 'customer' || mode === 'supplier') && <SaveDialog title={mode === 'customer' ? '新建客户' : '新建供应商'} path={base('/parties')}
      close={close} saved={saved} body={f => ({ kind: mode, code: text(f, 'code'), name: text(f, 'name') })}>
      <div className="form-grid"><Field label="编码"><input name="code" required maxLength={60}/></Field>
        <Field label="名称"><input name="name" required maxLength={160}/></Field></div>
    </SaveDialog>}
    {mode === 'item' && <SaveDialog title="新建物料" path={base('/items')} close={close} saved={saved}
      body={f => ({ sku: text(f, 'sku'), name: text(f, 'name'), kind: text(f, 'kind'), unit: text(f, 'unit') })}>
      <div className="form-grid">
        <Field label="物料编码"><input name="sku" required maxLength={80}/></Field>
        <Field label="物料名称"><input name="name" required maxLength={160}/></Field>
        <Field label="物料类型"><DropdownSelect name="kind" defaultValue="raw">{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</DropdownSelect></Field>
        <Field label="基础单位" hint="成品和半成品使用「件」。"><input name="unit" required defaultValue="件" maxLength={20}/></Field>
      </div>
    </SaveDialog>}
    {mode === 'link' && <SaveDialog title="关联已有物料" path={base('/links')} close={close} saved={saved}
      body={f => ({ materialId: text(f, 'materialId'), productId: text(f, 'productId') })}>
      <div className="form-grid">
        <Field label="生产物料"><DropdownSelect required name="materialId" defaultValue=""><option value="">选择物料</option>{options(data?.materials.filter(m => !data.links.some(l => l.materialId === m.id)) ?? [])}</DropdownSelect></Field>
        <Field label="库存商品" hint="请核对编码、规格和基础单位。"><DropdownSelect required name="productId" defaultValue=""><option value="">选择商品</option>{options(data?.products ?? [])}</DropdownSelect></Field>
      </div>
    </SaveDialog>}
    {mode === 'bom' && <SaveDialog title="发布 BOM" path={base('/boms')} close={close} saved={saved} confirmLabel="确认发布"
      body={f => ({ draft: { productId: product, lines: rows.map(id => ({
        materialId: text(f, 'material-' + id), quantity: text(f, 'qty-' + id), wastePercent: text(f, 'waste-' + id) || '0',
      })) } })}>
      <Field label="成品或半成品"><DropdownSelect required value={product} onChange={e => { setProduct(e.target.value); setRows([crypto.randomUUID()]); }}><option value="">选择产品</option>{options(ready.filter(m => m.kind === 'finished' || m.kind === 'semi'))}</DropdownSelect></Field>
      {rows.map((id, index) => <fieldset key={id} className="manufacturing-line">
        <legend>组件 {index + 1}</legend>
        <div className="form-grid">
          <Field label="组件物料"><DropdownSelect required name={'material-' + id} defaultValue=""><option value="">选择组件</option>{options(ready.filter(m => m.id !== product))}</DropdownSelect></Field>
          <Field label="单件用量"><input required type="number" min="0.001" step="0.001" name={'qty-' + id}/></Field>
          <Field label="损耗率（%）"><input type="number" min="0" max="99.99" step="0.01" name={'waste-' + id} defaultValue="0"/></Field>
        </div>
        {rows.length > 1 && <button type="button" onClick={() => setRows(rows.filter(row => row !== id))}>移除组件 {index + 1}</button>}
      </fieldset>)}
      <button type="button" onClick={() => setRows([...rows, crypto.randomUUID()])} disabled={rows.length >= 200}>添加组件</button>
      <p className="muted">发布后新订单采用此版本。已接订单沿用接单时的用料。</p>
    </SaveDialog>}
  </>;
}
