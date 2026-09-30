import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api, errorText, tenantApi } from '../api';
import { Notice, PageTitle, Status } from '../components';

type Connection = { id: string; appId: string; status: string; lastError?: string | null; connectedAt?: string | null };
type Channel = { provider: string; availability: string; connection?: Connection | null; reason?: string };
type Attempt = { id: string; status: string; qrUrl?: string | null; expiresAt?: string | null; errorCode?: string | null };
type Identity = { connected: boolean; linkedAt?: string | null };
type Pair = { code: string; expiresInSeconds: number; instruction: string };
type Delivery = { id: string; status: string; attempts?: number; errorCode?: string | null; providerMessageId?: string | null };

export function ChannelPage({ tenantKey, isAdmin }: { tenantKey: string; isAdmin: boolean }) {
  const base = tenantApi(tenantKey, '/channels');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [identity, setIdentity] = useState<Identity>({ connected: false });
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [pair, setPair] = useState<Pair | null>(null);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = async () => {
    const own = await api.get<Identity>(`${base}/feishu/me`);
    setIdentity(own);
    setChannels(await api.get<Channel[]>(base));
  };
  useEffect(() => { void refresh().catch(e => setError(errorText(e))); }, [base, isAdmin]);
  useEffect(() => {
    if (!attempt || !['starting', 'waiting_scan'].includes(attempt.status)) return;
    const timer = window.setInterval(() => { void api.get<Attempt>(`${base}/feishu/attempts/${attempt.id}`).then(next => { setAttempt(next); if (next.status === 'configured') void refresh(); }).catch(e => setError(errorText(e))); }, 2000);
    return () => window.clearInterval(timer);
  }, [attempt?.id, attempt?.status, base]);
  useEffect(() => {
    if (!delivery || !['queued', 'retry', 'sending', 'awaiting_identity'].includes(delivery.status)) return;
    const timer = window.setInterval(() => { void api.get<Delivery>(`${base}/deliveries/${delivery.id}`).then(setDelivery).catch(e => setError(errorText(e))); }, 2000);
    return () => window.clearInterval(timer);
  }, [delivery?.id, delivery?.status, base]);
  const action = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } };
  const start = () => void action(async () => { setAttempt(await api.post<Attempt>(`${base}/feishu/connect`, {})); });
  const getPair = () => void action(async () => { setPair(await api.post<Pair>(`${base}/feishu/pair-code`, {})); });
  const unlink = () => void action(async () => { await api.del(`${base}/feishu/me`); setPair(null); await refresh(); });
  const sendTest = () => void action(async () => { setDelivery(await api.post<Delivery>(`${base}/feishu/test`, {})); });
  const feishu = channels.find(x => x.provider === 'feishu');
  const connection = feishu?.connection;
  return <><PageTitle title="工作通道" subtitle="让平台内的业务通知和 AI 助手进入常用工作软件。业务记录与权限仍以本平台为准。" /><Notice text={error} />
    <section className="panel channel-panel"><div className="channel-heading"><div><h2>飞书</h2><p>企业管理员扫码创建业务机器人；平台自动建立长连接，不需要填写回调地址。</p></div>{isAdmin && (connection ? <Status value={connection.status} /> : <span>未接入</span>)}</div>
      {isAdmin && !connection && <div className="channel-steps"><p>1. 点击生成二维码　2. 用飞书管理员账号扫码并核对申请的消息权限　3. 等待连接成功</p><button className="primary" disabled={busy || Boolean(attempt && ['starting', 'waiting_scan'].includes(attempt.status))} onClick={start}>扫码接入飞书</button></div>}
      {isAdmin && attempt && ['starting', 'waiting_scan'].includes(attempt.status) && <div className="channel-qr"><h3>{attempt.qrUrl ? '请用飞书扫码确认' : '正在向飞书申请二维码…'}</h3>{attempt.qrUrl && <><QRCodeSVG value={attempt.qrUrl} size={188} marginSize={2} /><a href={attempt.qrUrl} target="_blank" rel="noreferrer">在当前设备打开授权页</a></>}{attempt.expiresAt && <small>二维码有效至 {new Date(attempt.expiresAt).toLocaleTimeString('zh-CN')}</small>}</div>}
      {isAdmin && attempt?.status === 'failed' && <Notice text={`本次接入未完成：${attempt.errorCode ?? '授权失败'}。请刷新后重试。`} />}
      {isAdmin && attempt?.status === 'expired' && <Notice text="扫码二维码已过期，请重新发起接入。" tone="info" />}
      {isAdmin && connection && <div className="channel-steps"><p>应用编号：{connection.appId}</p><p>{connection.status === 'connected' ? '长连接已建立。成员还需各自绑定飞书身份，业务通知才会投递到对应人员。' : `机器人尚未连通：${connection.lastError ?? '等待 Worker 建立连接'}`}</p></div>}
      {identity.connected ? <div className="channel-steps"><p>你的飞书账号已绑定{identity.linkedAt ? ` · ${new Date(identity.linkedAt).toLocaleString('zh-CN')}` : ''}。</p><p>私聊机器人可查询 ERP 业务；发送“执行：具体操作”才会授权该条消息发起可用业务工具。高影响操作请回平台确认。</p>{isAdmin && <><button disabled={busy || connection?.status !== 'connected'} onClick={sendTest}>发送测试消息给我</button>{delivery && <p>测试消息：{delivery.status === 'sent' ? `飞书已接收（回执 ${delivery.providerMessageId ?? '—'}）` : delivery.status === 'failed' ? `投递失败（${delivery.errorCode ?? '未知错误'}）` : '正在投递…'}</p>}</>}<button disabled={busy} onClick={unlink}>解除我的绑定</button></div> : connection?.status === 'connected' ? <div className="channel-steps"><h3>绑定我的飞书账号</h3><p>获取一次性绑定码后，在飞书中私聊“知行方舟业务助手”发送绑定指令。绑定码 10 分钟有效。</p><button disabled={busy} onClick={getPair}>获取绑定码</button>{pair && <div className="channel-pair"><strong>{pair.code}</strong><p>{pair.instruction}</p><small>绑定完成后点击“刷新绑定状态”。</small></div>}<button disabled={busy} onClick={() => void refresh().catch(e => setError(errorText(e)))}>刷新绑定状态</button></div> : <p>企业飞书机器人连通后，可在这里绑定自己的账号。</p>}
    </section>
    {isAdmin && <div className="two-column"><section className="panel"><h2>企业微信</h2><p>接入方式正在核对官方企业授权与消息能力，当前尚未开放绑定。</p><span>待接入</span></section><section className="panel"><h2>钉钉</h2><p>接入方式正在核对官方企业授权与消息能力，当前尚未开放绑定。</p><span>待接入</span></section></div>}
  </>;
}
