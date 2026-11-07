import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, RefreshCw } from "lucide-react";
import { api, errorText, tenantApi } from "../api";
import { useApiData } from "../hooks";
import {
  ConfirmDialog,
  DataResult,
  Dialog,
  Field,
  InfoTip,
  Notice,
  PageTitle,
} from "../components";

type Provider = "feishu" | "weixin" | "wecom" | "dingtalk";
type Channel = {
  provider: Provider;
  name: string;
  linked: boolean;
  connection?: { id: string; status: string; lastError?: string | null } | null;
};
type Attempt = {
  id: string;
  status: string;
  qrUrl?: string | null;
  expiresAt?: string | null;
  errorCode?: string | null;
};
type Identity = {
  connected: boolean;
  appId?: string;
  apps?: Array<{ id: string; name: string }>;
};
type Pair = { code: string; expiresInSeconds: number; instruction: string };
type Delivery = {
  id: string;
  status: string;
  providerMessageId?: string | null;
  errorCode?: string | null;
};
const pending = ["starting", "waiting_scan", "scanned", "need_verifycode"];
const channelStatus: Record<string, string> = {
  configured: "正在连接",
  connected: "已连接",
  reconnecting: "正在重连",
  error: "连接失败",
  expired: "授权已失效",
  disconnected: "未接入",
};
const attemptStatus: Record<string, string> = {
  starting: "正在获取二维码…",
  waiting_scan: "请使用手机扫码",
  scanned: "已扫码，请在手机上确认",
  need_verifycode: "请完成微信验证",
  configured: "授权完成，正在连接",
  expired: "二维码已过期",
  failed: "接入未完成，请重新扫码",
  cancelled: "接入已取消",
};

function ChannelCard({
  channel,
  base,
  isAdmin,
  refresh,
}: {
  channel: Channel;
  base: string;
  isAdmin: boolean;
  refresh: () => Promise<void>;
}) {
  const path = base + "/" + channel.provider;
  const identity = useApiData<Identity>(path + "/me");
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [open, setOpen] = useState(false);
  const [pair, setPair] = useState<Pair | null>(null);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [verifyCode, setVerifyCode] = useState("");
  const [confirm, setConfirm] = useState<"unlink" | "disconnect" | null>(null);
  const lock = useRef(false);
  const storageKey = "suite-channel-attempt:" + path;
  const configured = Boolean(
    channel.connection &&
      !["disconnected", "expired"].includes(channel.connection.status),
  );
  const connected = channel.connection?.status === "connected";
  const run = useCallback(async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, []);
  const remember = (next: Attempt) => {
    setAttempt(next);
    try {
      if (pending.includes(next.status))
        sessionStorage.setItem(storageKey, next.id);
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* browser storage can be unavailable */
    }
  };
  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    let id: string | null = null;
    try {
      id = sessionStorage.getItem(storageKey);
    } catch {
      return;
    }
    if (id)
      void api
        .get<Attempt>(path + "/attempts/" + encodeURIComponent(id), {
          timeoutMs: 45000,
        })
        .then((next) => {
          if (!active) return;
          remember(next);
          if (pending.includes(next.status)) setOpen(true);
        })
        .catch(() => {
          try {
            sessionStorage.removeItem(storageKey);
          } catch {}
        });
    return () => {
      active = false;
    };
  }, [path, isAdmin]);
  useEffect(() => {
    if (!attempt || !pending.includes(attempt.status)) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api.get<Attempt>(path + "/attempts/" + attempt.id, {
          timeoutMs: 45000,
        });
        if (!active) return;
        remember(next);
        if (next.status === "configured") {
          setOpen(false);
          void identity.reload();
          void refresh();
        }
      } catch (e) {
        if (active) setError(errorText(e));
      }
      if (active) timer = setTimeout(poll, 3000);
    };
    timer = setTimeout(poll, 2000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [attempt?.id, attempt?.status, path]);
  useEffect(() => {
    if (
      !delivery ||
      !["queued", "retry", "sending", "awaiting_identity"].includes(
        delivery.status,
      )
    )
      return;
    let active = true;
    const timer = setInterval(() => {
      void api
        .get<Delivery>(base + "/deliveries/" + delivery.id)
        .then((next) => {
          if (active) setDelivery(next);
        })
        .catch((e) => {
          if (active) setError(errorText(e));
        });
    }, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [delivery?.id, delivery?.status, base]);
  useEffect(() => {
    if (channel.linked !== identity.data?.connected || connected)
      void identity.reload();
  }, [channel.linked, connected]);
  const start = () =>
    void run(async () => {
      const next = await api.post<Attempt>(path + "/connect", {});
      remember(next);
      setVerifyCode("");
      setOpen(true);
    });
  const close = () =>
    void run(async () => {
      if (attempt && pending.includes(attempt.status)) {
        await api.del(path + "/attempts/" + attempt.id);
        remember({ ...attempt, status: "cancelled" });
      }
      setOpen(false);
    });
  const finishConfirm = () =>
    void run(async () => {
      if (confirm === "unlink") await api.del(path + "/me");
      else await api.post(path + "/disconnect", {});
      setPair(null);
      setDelivery(null);
      setConfirm(null);
      await identity.reload();
      await refresh();
    });
  return (
    <section className="panel channel-panel">
      <div className="channel-heading">
        <h2>{channel.name}</h2>
        <span className="status" role="status">
          {channelStatus[channel.connection?.status ?? "disconnected"] ??
            "正在检查"}
        </span>
      </div>
      <Notice text={error ?? identity.error} />
      {isAdmin && !configured && (
        <button
          className="primary"
          aria-label={"扫码接入" + channel.name}
          disabled={busy}
          onClick={start}
        >
          {channel.connection?.status === "expired" ? "重新扫码" : "扫码接入"}
        </button>
      )}
      {isAdmin && configured && channel.connection?.status === "error" && (
        <p role="status">连接失败，请刷新状态或重新接入。</p>
      )}
      {identity.data?.connected ? (
        <div className="channel-steps">
          <div className="channel-identity-heading">
            <span>我的账号已绑定</span>
            <InfoTip label={channel.name + "对话操作"}>
              私聊发送“助手”查看可用助手，发送“切换
              CRM”等指令切换。发送“执行：具体操作”可发起业务动作，高影响操作会请你回平台确认。
            </InfoTip>
          </div>
          <Field label={channel.name + "默认助手"}>
            <select
              value={identity.data.appId ?? ""}
              disabled={busy || !connected || !identity.data.apps?.length}
              onChange={(event) => {
                const appId = event.target.value;
                void run(async () => {
                  await api.post(path + "/assistant", { appId });
                  await identity.reload();
                });
              }}
            >
              {!identity.data.apps?.some(
                (app) => app.id === identity.data?.appId,
              ) && (
                <option value={identity.data.appId ?? ""}>
                  请选择可用助手
                </option>
              )}
              {identity.data.apps?.map((app) => (
                <option key={app.id} value={app.id}>
                  {app.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="form-actions">
            <button
              disabled={busy || !connected}
              onClick={() =>
                void run(async () => {
                  setDelivery(await api.post<Delivery>(path + "/test", {}));
                })
              }
            >
              发送测试消息
            </button>
            <button disabled={busy} onClick={() => setConfirm("unlink")}>
              解除我的绑定
            </button>
          </div>
          {delivery && (
            <p role="status">
              {delivery.status === "sent"
                ? "通道已接收测试消息"
                : delivery.status === "failed"
                  ? "测试消息未送达，请刷新状态后重试"
                  : delivery.status === "awaiting_identity"
                    ? "等待绑定账号"
                    : delivery.status === "cancelled"
                      ? "测试消息已取消"
                      : "正在发送测试消息…"}
            </p>
          )}
        </div>
      ) : connected ? (
        <div className="channel-steps">
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setPair(await api.post<Pair>(path + "/pair-code", {}));
                setCopied(false);
              })
            }
          >
            绑定我的账号
          </button>
          {pair && (
            <div className="channel-pair">
              <p>私聊机器人发送以下内容，10 分钟内有效。</p>
              <div className="channel-binding-code">
                <code>绑定 {pair.code}</code>
                <button
                  aria-label={"复制" + channel.name + "绑定指令"}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await navigator.clipboard.writeText("绑定 " + pair.code);
                      setCopied(true);
                    })
                  }
                >
                  <Copy size={16} aria-hidden="true" />
                  {copied ? "已复制" : "复制"}
                </button>
              </div>
              <button disabled={busy} onClick={() => void identity.reload()}>
                我已发送，刷新状态
              </button>
            </div>
          )}
        </div>
      ) : (
        !isAdmin && <p>请联系企业管理员接入{channel.name}。</p>
      )}
      {configured && (
        <div className="form-actions">
          <button
            aria-label={"刷新" + channel.name + "状态"}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await identity.reload();
                await refresh();
              })
            }
          >
            <RefreshCw size={16} aria-hidden="true" />
            刷新状态
          </button>
          {isAdmin && (
            <button disabled={busy} onClick={() => setConfirm("disconnect")}>
              断开连接
            </button>
          )}
        </div>
      )}
      <Dialog
        open={open}
        title={"扫码接入" + channel.name}
        busy={busy}
        onClose={close}
      >
        <Notice text={error} />
        <div className="channel-qr">
          <p role="status">{attemptStatus[attempt?.status ?? "starting"]}</p>
          {attempt?.qrUrl && pending.includes(attempt.status) && (
            <>
              <QRCodeSVG
                value={attempt.qrUrl}
                size={188}
                marginSize={2}
                role="img"
                aria-label={channel.name + "接入二维码"}
              />
              <a href={attempt.qrUrl} target="_blank" rel="noreferrer">
                在当前设备打开授权页
              </a>
            </>
          )}
          {attempt?.expiresAt && pending.includes(attempt.status) && (
            <small>
              有效至 {new Date(attempt.expiresAt).toLocaleTimeString("zh-CN")}
            </small>
          )}
        </div>
        {attempt?.status === "need_verifycode" && (
          <form
            className="form-panel"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                remember(
                  await api.post<Attempt>(
                    path + "/attempts/" + attempt.id + "/verify",
                    { code: verifyCode },
                    { timeoutMs: 45000 },
                  ),
                );
                setVerifyCode("");
              });
            }}
          >
            <Field label="微信验证码">
              <input
                required
                autoComplete="one-time-code"
                minLength={4}
                maxLength={12}
                value={verifyCode}
                onChange={(event) => setVerifyCode(event.target.value)}
              />
            </Field>
            <button type="submit" className="primary" disabled={busy}>
              提交验证码
            </button>
          </form>
        )}
        {attempt &&
          ["failed", "expired", "cancelled"].includes(attempt.status) && (
            <button className="primary" disabled={busy} onClick={start}>
              重新获取二维码
            </button>
          )}
      </Dialog>
      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm === "disconnect"
            ? "断开" + channel.name + "？"
            : "解除我的绑定？"
        }
        description={
          confirm === "disconnect"
            ? "断开后，该企业的所有成员都将无法通过此通道对话或接收新通知。再次使用需要重新扫码接入。"
            : "解除后，你将无法通过此账号查询企业业务或接收通知，再次使用需要重新绑定。"
        }
        confirmLabel={confirm === "disconnect" ? "断开连接" : "解除绑定"}
        confirmPrimary={false}
        busy={busy}
        error={error}
        onCancel={() => setConfirm(null)}
        onConfirm={finishConfirm}
      />
    </section>
  );
}

export function ChannelPage({
  tenantKey,
  isAdmin,
}: {
  tenantKey: string;
  isAdmin: boolean;
}) {
  const base = tenantApi(tenantKey, "/channels");
  const [result, setResult] = useState<{
    base: string;
    data: Channel[] | null;
    error: string | null;
  }>({ base, data: null, error: null });
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const fetchChannels = async () => {
      try {
        const data = await api.get<Channel[]>(base, { timeoutMs: 20000 });
        if (active) setResult({ base, data, error: null });
      } catch (e) {
        if (active)
          setResult((old) => ({
            base,
            data: old.base === base ? old.data : null,
            error: errorText(e),
          }));
      }
      if (active) timer = setTimeout(fetchChannels, 10000);
    };
    void fetchChannels();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [base, reload]);
  const refresh = useCallback(async () => {
    setReload((n) => n + 1);
  }, []);
  const current = result.base === base ? result : { data: null, error: null };
  return (
    <>
      <PageTitle title="消息与通知" />
      <Notice text={current.data ? current.error : null} />
      <DataResult
        data={current.data}
        loading={!current.data && !current.error}
        error={current.data ? null : current.error}
        reload={refresh}
      >
        {current.data && (
          <div className="two-column channel-list">
            {current.data.map((channel) => (
              <ChannelCard
                key={base + "/" + channel.provider}
                channel={channel}
                base={base}
                isAdmin={isAdmin}
                refresh={refresh}
              />
            ))}
          </div>
        )}
      </DataResult>
    </>
  );
}
