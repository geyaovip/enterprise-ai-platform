import { BadRequestException } from "@nestjs/common";
import { randomBytes } from "node:crypto";

export const channelProviders = [
  "feishu",
  "weixin",
  "wecom",
  "dingtalk",
] as const;
export type ChannelProvider = (typeof channelProviders)[number];
export const channelNames: Record<ChannelProvider, string> = {
  feishu: "飞书",
  weixin: "微信",
  wecom: "企业微信",
  dingtalk: "钉钉",
};
export function channelProvider(value: string): ChannelProvider {
  if (!channelProviders.includes(value as ChannelProvider))
    throw new BadRequestException("不支持的对话通道");
  return value as ChannelProvider;
}

export function officialUrl(raw: string, provider: ChannelProvider) {
  const url = new URL(raw);
  const domains = {
    feishu: ["feishu.cn", "larksuite.com"],
    weixin: ["weixin.qq.com"],
    wecom: ["work.weixin.qq.com"],
    dingtalk: ["dingtalk.com", "alibaba-inc.com"],
  }[provider];
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !domains.some(
      (domain) =>
        url.hostname === domain || url.hostname.endsWith("." + domain),
    )
  )
    throw new BadRequestException("通道返回了无法验证的官方地址");
  return url.toString();
}

export async function channelJson(
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
  timeout = 15000,
  signal?: AbortSignal,
) {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    redirect: "error",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
      : AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error("CHANNEL_HTTP_" + response.status);
  const data = await response.json();
  if (
    data.ret ||
    data.errcode ||
    (data.code && !["0", "ok", "OK"].includes(String(data.code)))
  )
    throw new Error(
      data.ret === -14 || data.errcode === -14
        ? "CHANNEL_SESSION_EXPIRED"
        : "CHANNEL_UPSTREAM_REJECTED",
    );
  return data;
}
export const weixinHeaders = () => ({
  AuthorizationType: "ilink_bot_token",
  "X-WECHAT-UIN": Buffer.from(String(randomBytes(4).readUInt32BE())).toString(
    "base64",
  ),
  "iLink-App-Id": "bot",
  "iLink-App-ClientVersion": String(0x020408),
});
export const weixinBase = {
  channel_version: "2.4.8",
  bot_agent: "ZhixingArk/1.0",
};
export type RegistrationState = {
  code: string;
  host?: string;
  interval?: number;
};
export type RegisteredChannel = {
  appId: string;
  secret: string;
  scannerId?: string;
};
export async function beginRegistration(
  provider: Exclude<ChannelProvider, "feishu">,
) {
  if (provider === "weixin") {
    const data = await channelJson(
      "https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3",
      { local_token_list: [] },
      weixinHeaders(),
    );
    if (!data.qrcode || !data.qrcode_img_content)
      throw new Error("CHANNEL_QR_INVALID");
    return {
      qrUrl: officialUrl(data.qrcode_img_content, provider),
      expiresIn: 300,
      state: { code: data.qrcode, interval: 3 },
    };
  }
  if (provider === "wecom") {
    const data = (
      await channelJson(
        "https://work.weixin.qq.com/ai/qc/generate?source=wecom_cli_external&plat=3",
      )
    ).data;
    if (!data?.scode || !data.auth_url) throw new Error("CHANNEL_QR_INVALID");
    return {
      qrUrl: officialUrl(data.auth_url, provider),
      expiresIn: 300,
      state: { code: data.scode, interval: 3 },
    };
  }
  const init = await channelJson(
    "https://oapi.dingtalk.com/app/registration/init",
    { source: "DING_DWS_CLAW" },
  );
  if (!init.nonce) throw new Error("CHANNEL_QR_INVALID");
  const data = await channelJson(
    "https://oapi.dingtalk.com/app/registration/begin",
    { nonce: init.nonce },
  );
  if (!data.device_code || !data.verification_uri_complete)
    throw new Error("CHANNEL_QR_INVALID");
  return {
    qrUrl: officialUrl(data.verification_uri_complete, provider),
    expiresIn: Math.min(7200, Math.max(60, Number(data.expires_in) || 7200)),
    state: {
      code: data.device_code,
      interval: Math.max(3, Math.min(15, Number(data.interval) || 3)),
    },
  };
}
export async function pollRegistration(
  provider: Exclude<ChannelProvider, "feishu">,
  state: RegistrationState,
  verifyCode?: string,
): Promise<{
  status:
    | "waiting_scan"
    | "scanned"
    | "need_verifycode"
    | "expired"
    | "failed"
    | "configured";
  state?: RegistrationState;
  credentials?: RegisteredChannel;
}> {
  if (provider === "weixin") {
    const host = officialUrl(
      state.host ?? "https://ilinkai.weixin.qq.com",
      provider,
    );
    const url = new URL("/ilink/bot/get_qrcode_status", host);
    url.searchParams.set("qrcode", state.code);
    if (verifyCode) url.searchParams.set("verify_code", verifyCode);
    const data = await channelJson(
      url.toString(),
      undefined,
      { "iLink-App-Id": "bot", "iLink-App-ClientVersion": String(0x020408) },
      40000,
    );
    if (data.status === "confirmed") {
      if (!data.bot_token || !data.ilink_bot_id || !data.ilink_user_id)
        throw new Error("CHANNEL_CREDENTIALS_MISSING");
      return {
        status: "configured",
        credentials: {
          appId: data.ilink_bot_id,
          secret: JSON.stringify({
            token: data.bot_token,
            baseUrl: officialUrl(data.baseurl || host, provider),
          }),
          scannerId: data.ilink_user_id,
        },
      };
    }
    if (data.status === "scaned_but_redirect" && data.redirect_host)
      return {
        status: "waiting_scan",
        state: {
          ...state,
          host: officialUrl(
            "https://" + String(data.redirect_host).replace(/^https:\/\//, ""),
            provider,
          ),
        },
      };
    return {
      status:
        data.status === "expired"
          ? "expired"
          : data.status === "need_verifycode"
            ? "need_verifycode"
            : data.status === "verify_code_blocked" ||
                data.status === "binded_redirect"
              ? "failed"
              : data.status === "scaned"
                ? "scanned"
                : "waiting_scan",
    };
  }
  if (provider === "wecom") {
    const data = (
      await channelJson(
        "https://work.weixin.qq.com/ai/qc/query_result?scode=" +
          encodeURIComponent(state.code),
      )
    ).data;
    if (data?.status === "success") {
      if (!data.bot_info?.botid || !data.bot_info.secret)
        throw new Error("CHANNEL_CREDENTIALS_MISSING");
      return {
        status: "configured",
        credentials: {
          appId: data.bot_info.botid,
          secret: data.bot_info.secret,
        },
      };
    }
    return {
      status:
        data?.status === "expired"
          ? "expired"
          : data?.status === "failed"
            ? "failed"
            : "waiting_scan",
    };
  }
  const data = await channelJson(
    "https://oapi.dingtalk.com/app/registration/poll",
    { device_code: state.code },
  );
  if (data.status === "SUCCESS") {
    if (!data.client_id || !data.client_secret)
      throw new Error("CHANNEL_CREDENTIALS_MISSING");
    return {
      status: "configured",
      credentials: { appId: data.client_id, secret: data.client_secret },
    };
  }
  return {
    status:
      data.status === "EXPIRED"
        ? "expired"
        : data.status === "FAIL"
          ? "failed"
          : "waiting_scan",
  };
}
