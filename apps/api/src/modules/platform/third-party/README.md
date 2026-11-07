# Official messaging integrations

The registration and transport modules adapt the following official projects to the platform's tenant, membership, queue, encryption and business assistant contracts.

| Source | Pinned source revision | Files referenced | Local adaptation |
| --- | --- | --- | --- |
| https://github.com/Tencent/openclaw-weixin | 874637a0dbc24050f72d1385add4fc6170a2d726 | docs/protocol.md, src/auth/login-qr.ts, src/api/api.ts, src/api/types.ts | QR onboarding, HTTP polling, cursor persistence, encrypted context tokens, text replies |
| https://github.com/WecomTeam/wecom-cli | 1d48b6c9ecd1b4897c4bf728d564bfda1d62fbde | crates/wecom-cli/src/auth/qrcode.rs | QR generation and result polling integrated with persisted setup state |
| https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector | 88df00ee594072e9941ef3f71da90a37f3291ad3 | src/device-auth.ts, src/device-auth-config.ts, src/core/connection.ts | Device registration protocol, normalized direct messages and durable acknowledgments |

The respective MIT notices are retained alongside this file. Runtime messaging uses the existing official @larksuiteoapi/node-sdk plus @wecom/aibot-node-sdk and dingtalk-stream installed as pinned dependencies. Weixin HTTP calls follow Tencent's published protocol directly. Group messages and rich media are excluded by the current text conversation transport. Provider credentials and callback context remain server-side.
