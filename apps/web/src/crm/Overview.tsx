import { useSearchParams, Link } from 'react-router-dom';
import { ForwardIcon, PageTitle, DataResult, Empty } from '../components';
import { useApiData } from '../hooks';
import { useCrm, defaultRule, Meta, date } from './common';
import { CrmNewCustomer } from './Engagement';
import { CrmGrowthBoard } from './Growth';
import './overview.css';

const currencies = ['CNY', 'USD', 'EUR', 'HKD'];
export function CrmOverview() {
  const c = useCrm(), [params, setParams] = useSearchParams();
  const requested = params.get('currency') ?? c.meta.settings.currency;
  const currency = currencies.includes(requested) ? requested : c.meta.settings.currency;
  const metrics = useApiData<any>(c.can('crm.analytics.read') ? c.base + '/dashboard?rule=' + encodeURIComponent(JSON.stringify({ ...defaultRule(), currency })) : null);
  const growth = useApiData<any>(c.base + '/growth?currency=' + currency);
  const work = useApiData<any>(c.base + '/workbench');
  const busy = growth.loading || work.loading || metrics.loading;
  const refresh = async () => { await Promise.all([metrics.reload(), growth.reload(), work.reload()]); };
  const count = (v: number | undefined) => v == null ? '—' : v.toLocaleString('zh-CN');
  const signals = growth.data?.signals ?? [];
  const metric = metrics.data;
  const actions = [
    ...(c.can('crm.sales.read') ? [{ title: '待处理线索', value: work.data?.pendingLeads, path: '/leads' }] : []),
    ...signals.map((s: any) => ({ title: s.title, value: s.count, path: s.path })),
  ];
  return <div className="crm-overview">
    <PageTitle title="客户总览" action={<>
      {(c.can('crm.analytics.read') || c.can('crm.segment.read')) && <select aria-label="统计币种" value={currency} onChange={event => {
        const next = new URLSearchParams(params); next.set('currency', event.target.value); setParams(next);
      }}>{currencies.map(value => <option key={value}>{value}</option>)}</select>}
      <button type="button" disabled={busy} onClick={() => void refresh()}>{busy ? '更新中…' : '刷新'}</button>
      <CrmNewCustomer onCreated={refresh}/>
    </>}/>
    {c.can('crm.analytics.read') && <DataResult {...metrics}>
      <div className="crm-overview-period"><Meta value={metric?.metadata}/><Link to={c.prefix + '/reports?currency=' + currency}>查看效果报表<ForwardIcon size={14} aria-hidden="true"/></Link></div>
      <div className="crm-overview-metrics" aria-label="客户经营指标">
        {[
          ['可见客户', count(metric?.customerCount), '人'],
          ['有效订单', count(metric?.validOrders), '笔'],
          ['净消费', metric?.netAmount == null ? '—' : Number(metric.netAmount).toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2}), currency],
          ['复购率', metric?.repeatRate == null ? '暂无购买' : metric.repeatRate + '%', ''],
        ].map(([label, value, unit]) => <div className="panel crm-overview-metric" key={label}><span>{label}</span><div><strong>{value}</strong>{unit && <small>{unit}</small>}</div></div>)}
      </div>
    </DataResult>}
    <div className="crm-overview-columns">
      <section className="panel crm-overview-panel">
        <div className="crm-overview-heading"><h2>待处理事项</h2><Link to={c.prefix + '/workbench'}>我的工作<ForwardIcon size={14} aria-hidden="true"/></Link></div>
        <DataResult {...growth}>
          {c.can('crm.sales.read') && work.error && <DataResult {...work}>{null}</DataResult>}
          {actions.length ? <ul className="crm-overview-action-list">{actions.map((item: any) => <li key={item.path}>
            <Link to={c.prefix + item.path}><span>{item.title}</span><strong className={item.value > 0 ? 'crm-attention' : undefined}>{count(item.value)}</strong><ForwardIcon size={16} aria-hidden="true"/></Link>
          </li>)}</ul> : <Empty text="暂无待处理事项"/>}
        </DataResult>
      </section>
      <CrmGrowthBoard currency={currency} resource={growth}/>
    </div>
    <div className="crm-overview-columns">
      {c.can('crm.analytics.read') && <section className="panel crm-overview-panel">
        <div className="crm-overview-heading"><h2>客户活跃分布</h2><Link to={c.prefix + '/customers?currency=' + currency}>客户列表<ForwardIcon size={14} aria-hidden="true"/></Link></div>
        <DataResult {...metrics}>
          {metric?.customerCount ? <div className="crm-overview-distribution">{metric?.rfm?.map((row: any) => <div className="crm-distribution" key={row.name}>
            <span>{row.name}</span><progress value={row.count} max={Math.max(1, metric.customerCount)} aria-label={row.name}/><strong>{row.count}<small> 人</small></strong>
          </div>)}</div> : <Empty text="还没有客户数据" action={c.can('crm.import.write') ? <Link className="button" to={c.prefix + '/imports'}>导入客户</Link> : undefined}/>}
        </DataResult>
      </section>}
      {c.can('crm.followup.read') && <section className="panel crm-overview-panel">
        <div className="crm-overview-heading"><h2>我的跟进</h2><Link to={c.prefix + '/workbench'}>查看待办<ForwardIcon size={14} aria-hidden="true"/></Link></div>
        <DataResult {...work}>
          {work.data?.followUps?.length ? <ul className="crm-overview-followups">{work.data.followUps.slice(0, 4).map((row: any) => <li key={row.id}>
            <Link to={c.prefix + '/' + ({customer: 'customers', lead: 'leads', opportunity: 'opportunities'} as Record<string,string>)[row.targetType] + '/' + row.targetId}>
              <span>{row.content}</span><time className={new Date(row.nextAt).getTime() < Date.now() ? 'crm-attention' : undefined} dateTime={row.nextAt}>{date(row.nextAt)}</time>
            </Link>
          </li>)}</ul> : <Empty text="暂无跟进待办"/>}
        </DataResult>
      </section>}
    </div>
  </div>;
}
