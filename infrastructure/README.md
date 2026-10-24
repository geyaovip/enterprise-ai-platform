# 运行与发布手册

更新：2026-10-20。操作前先读 [47项目现状](../docs/47-项目现状与文档维护.md)及 [25配置入口](../docs/25-首阶段组件部署与联调.md)，现场核对目标主机、版本、配置和备份。本文保留Compose/Caddy可选方案及已有Cloudflare部署步骤；最新现场发布见[49](../docs/49-三端UI与账号体系线上发布.md)，下文历史日期段落中的“当前”仅指当时环境。

本目录只操作新平台的 Compose 项目 `enterprise-ai-platform`。旧 CRM、MES、ERP 的容器、卷与备份不在本手册操作范围内。首客共享云发布前，按 [数据导入与上线验收](../docs/08-迁移与上线验收.md) 完成真实入口、模型、备份和回退验收。

默认使用内置知识库，RAGFlow Cloud、生产定时备份和用户安排的真实客户场景按D-022暂缓。真实模型/Tool/知识的已有记录见43；D-043/D-044新UI、注册和管理助手已按D-046正式发布，版本、21条迁移、备份和真实模型只读验证见49；以后部署仍须核对前后端、迁移、公共组件和回退。

本机隔离容器演练可参考 [本机 QA 变量模板](local-qa.env.example)；它使用回环 HTTP，只用于本机验收，不是客户环境配置。

## 首次准备

1. 在项目根目录复制 [环境变量模板](../.env.production.example) 为 `.env.production`，设置 `chmod 600 .env.production`。逐项填写发布标签、实际 HTTPS 域名、数据库密码、URL 编码后的数据库连接串、32 字节随机 AI 加密密钥及允许的模型供应商域名。数据库密码与加密密钥应放进目标环境的受限密钥管理；不要提交到 Git。
2. 配置 `SITE_ADDRESS` 为解析到目标机器的域名，`WEB_ORIGIN` 为相同的 `https://` 来源。Caddy 使用该域名签发 HTTPS 证书；80/443 必须按部署环境开放。确认目标主机剩余空间可容纳新旧两版镜像、构建缓存和一次数据库备份。不得在共享机器上做全局清理。
3. 先执行 `docker compose --env-file .env.production -f infrastructure/compose.production.yaml config --quiet`。该命令验证变量与配置，不输出 Secret。

## 发布

内置知识库增强镜像安装 Poppler、Python 标准库解析器和 Tesseract 中英文 fast 数据，不包含本地大模型。Worker 默认逐份处理；OCR 子进程单线程、30 秒超时，Linux 资源限制与 PDF/图片上限见 [32](../docs/32-轻量知识库检索与识别增强.md)。暂存页图像在任务结束清理，Worker 启动清理本模块带标记的过期残留。

默认规则重排序无需服务或模型。可选 OCR/重排序接口由平台运营按企业配置，加密凭据沿用现有基础设施绑定；服务地址须在允许名单内，详细 kind/provider 和 API 格式见 [32](../docs/32-轻量知识库检索与识别增强.md)。API 与 Worker 共用镜像层，不复制两份 OCR 模型。更新该功能没有新增数据库迁移；保留现有 pgvector 数据卷及备份。

在项目根目录执行：

```sh
docker compose --env-file .env.production -f infrastructure/compose.production.yaml stop api worker
./infrastructure/phase1-backup.sh
docker compose --env-file .env.production -f infrastructure/compose.production.yaml build migrate web admin platform-admin
docker compose --env-file .env.production -f infrastructure/compose.production.yaml up -d
docker compose --env-file .env.production -f infrastructure/compose.production.yaml ps
```

首次空库时可跳过第一条备份命令；已有客户数据或任何迁移升级前必须先备份，并将备份及其校验值转移到受限的异地存储。`migrate` 是一次性容器，完成后应显示退出码 0；`api`、`worker`、`postgres` 应健康，三个前端应运行。确认公网 `https://<SITE_ADDRESS>/api/v1/health` 返回就绪，再以授权账号检查当前企业、ERP 只读及受控写入、审计和 AI 模型状态。

### 共享服务器与 Cloudflare Worker 入口

当 80/443 已由同机共享 HTTPS 网关占用时，叠加 `compose.shared-server.yaml`：只启动新项目的 PostgreSQL、迁移、API 和 Worker；`web` 进入 `standalone-web` profile，不会抢占端口。API 同时接入共享网关所在的 `yingchuan_backend` Docker 网络。该文件只适用于已经核对该网络及网关的这台共享服务器；其他环境使用上面的通用 Compose。

共享网关为新平台添加独立路径 `/apaas-platform/*`，转发到 `enterprise-ai-platform-api-1:4600` 并去掉路径前缀。修改网关前备份其当前配置，先验证再热加载，随后同时复测旧应用和新平台的健康接口；新平台发布不应重建网关或旧应用容器。

Cloudflare 正式入口保留 `enterprise-ai-platform` Worker 和原域名。`wrangler.jsonc` 配置它将 `/api/*` 转发到 `API_ORIGIN` Secret，将 `/`、`/tenant-admin/*`、`/platform-admin/*` 经 Service Binding 转发至三个独立前端 Worker。`wrangler.workspace.jsonc`、`wrangler.tenant-admin.jsonc`、`wrangler.platform-admin.jsonc` 分别发布各自 `dist`；管理端构建保留原路径作为 Vite base。登录 Cookie、前端 `/api` 请求及跨端跳转仍在正式入口的同一来源下运行。三个子 Worker 不配置后端 Secret；正式切换后关闭其直接 `workers.dev` 入口，避免用户误入无 API 的独立域名。

发布顺序：先运行 `pnpm build:cloud` 和 `node infrastructure/cloud-routes.test.mjs`，再分别执行 `npx wrangler deploy --config wrangler.workspace.jsonc`、`npx wrangler deploy --config wrangler.tenant-admin.jsonc`、`npx wrangler deploy --config wrangler.platform-admin.jsonc`；初次迁移时先临时开放子 Worker 的 `workers.dev` 入口，以 `node infrastructure/cloud-live-smoke.mjs <子Worker来源> <workspace|tenant|platform>` 检查深链接与真实 JS/CSS，最后执行 `npx wrangler deploy --config wrangler.jsonc` 切换正式入口。切换后关闭子 Worker 的 `workers_dev` 与 `preview_urls`，只允许 Service Binding 调用。后续仅发布某端时，先执行对应的 `pnpm build:cloud:workspace`、`pnpm build:cloud:tenant-admin` 或 `pnpm build:cloud:platform-admin`，再部署相应配置；不需要改动入口 Worker。正式入口用 `node infrastructure/cloud-live-smoke.mjs <正式来源> gateway` 检查三端路径、资源与 API 健康，再核查登录状态及角色隔离；如入口路由回归失败，按切换前记录的版本 ID 执行 `npx wrangler rollback <版本ID> --config wrangler.jsonc --yes`。生产 `WEB_ORIGIN` 必须是最终正式入口来源。源代码和密钥分别管理；不要把 `.env.production`、Cloudflare 凭据或模型密钥提交到 Git。

首次创建租户时，由发布操作者在受限 shell 中设置 `BOOTSTRAP_EMAIL`、`BOOTSTRAP_PASSWORD`、`BOOTSTRAP_TENANT_SLUG`、`BOOTSTRAP_TENANT_NAME`，再执行：

```sh
docker compose --env-file .env.production -f infrastructure/compose.production.yaml exec -T \
  -e BOOTSTRAP_EMAIL -e BOOTSTRAP_PASSWORD -e BOOTSTRAP_TENANT_SLUG -e BOOTSTRAP_TENANT_NAME \
  api node apps/api/dist/bootstrap.js
```

该命令只适用于新租户和新管理员。不要把真实密码写入命令行参数、脚本、聊天记录或日志；创建后从 shell 清除临时环境变量。客户数据导入另按来源系统和授权映射实施。

## 备份与恢复演练

`./infrastructure/backup.sh` 将 PostgreSQL 全库导出为 `output/backups/suite-<UTC>.dump`，权限受限并输出 SHA-256。脚本还通过容器内 `pg_restore --list` 检查归档可读。它不负责加密、异地转移、保留期或恢复演练；这些须在首客开通前配置和验证。`AI_ENCRYPTION_KEY` 是解密已配置模型密钥所需的独立 Secret，必须与数据库备份一同纳入受控恢复方案。

恢复演练使用**隔离数据库或隔离环境**，不得覆盖当前生产库。用 PostgreSQL 17 的 `pg_restore --no-owner --no-acl` 导入备份后，核对租户、成员、主数据、订单、库存、账款、审计及 `_prisma_migrations`；再通过应用登录与业务只读接口验证。演练结束清理临时环境，保留验收记录。真正生产回退需先停写、保留故障证据，并根据迁移兼容性决定是仅回退镜像还是恢复数据库；不能只回退 Web。

## 故障定位

```sh
docker compose --env-file .env.production -f infrastructure/compose.production.yaml ps
docker compose --env-file .env.production -f infrastructure/compose.production.yaml logs --tail 100 api worker migrate web
```

日志不得包含客户正文、模型密钥或数据库密码。若出现跨租户数据、财务/库存事务不一致或备份失败，应停止试用扩量并记录版本、请求 ID、租户和对象 ID，再按已演练方案处理。

## 内置知识库生产升级（2026-10-08）

当前发布使用 PostgreSQL 17.11 + pgvector 0.8.7，启用命令必须同时叠加 `compose.native-knowledge.yaml` 与 `compose.native-release.yaml`。共享服务器历史命令见 [25](../docs/25-首阶段组件部署与联调.md#2026-10-08-native-生产运行命令)。当时保留的 Alpine 原卷已随 2026-10-11 旧机项目清理移除；恢复需使用新机或本地联合备份，不能把 Alpine 数据目录直接挂载到 Debian 镜像。当前实例已经过独立恢复、冻结写入后联合备份、迁移与切换，发布及恢复证据见 [21](../docs/21-云端发布记录.md)。


## 新独立服务器（2026-10-11）

当前主机 `ubuntu@152.32.223.97:22`，根目录 `/opt/apaas/enterprise-ai-platform`，`current` 指向 `releases/20261013-ai-process-r2`。API/Worker/PostgreSQL/知识原件和受管成员 Gateway 在该机；Cloudflare 三端静态入口保持原址。专属 Tunnel 将 `https://apaas-api.cryptopilot.chat` 转发至 `127.0.0.1:4600`，Worker 的 `API_ORIGIN` 已更新。当前状态见 [43](../docs/43-自动运行与工作体验优化.md)，备份/回退边界见 [41](../docs/41-六批优化交付与线上验收.md)，迁移历史见 [39](../docs/39-新服务器迁移与全量线上验收.md)。

在该项目当前发布目录执行以下配置校验/状态命令：

```sh
cd /opt/apaas/enterprise-ai-platform/current
sudo docker compose --env-file .env.production \
  -f infrastructure/compose.production.yaml \
  -f infrastructure/compose.native-knowledge.yaml \
  -f infrastructure/compose.native-release.yaml \
  -f infrastructure/compose.dedicated-server.yaml \
  -f infrastructure/compose.runtime-manager.yaml config --quiet
sudo docker compose --env-file .env.production \
  -f infrastructure/compose.production.yaml \
  -f infrastructure/compose.native-knowledge.yaml \
  -f infrastructure/compose.native-release.yaml \
  -f infrastructure/compose.dedicated-server.yaml \
  -f infrastructure/compose.runtime-manager.yaml ps
curl -fsS https://enterprise-ai-platform.492746023.workers.dev/api/v1/health
systemctl status cloudflared-suite --no-pager
```

独立配置包含当前镜像实际使用的 Prisma 迁移入口，无需额外 `compose.release.yaml`；受管 Gateway 必须同时叠加 `compose.runtime-manager.yaml`，否则 API/Worker 启动后无法访问私有 Manager Socket。三个前端使用 `standalone-web` profile，当前不启动宿主机 Web 容器。数据库使用 `enterprise-ai-platform_suite_native_postgres_data`。知识原件卷 `enterprise-ai-platform_knowledge_originals` 是外部持久卷，首次恢复前先显式创建并恢复归档；重启和更新时保留该卷。

现有 named 容器优先定向 restart；新发布按版本与联合备份流程处理。停止 API/Worker 后手动联合备份 DB/知识原件，并保存环境恢复材料与成员 Runtime 状态。当前受限手动维护脚本在 `shared/migration-20261011/`，备份位于该目录的 `post-test-backup/`；含密钥，不提交 Git。Gateway 冷启动按 180 秒等待就绪。没有安装生产定时备份。

2026-10-11 按用户要求，旧共享服务器的本项目容器、数据卷、专属镜像/网络、部署目录及旧转发路由已删除；旧 CRM、MES、ERP 的独立部署、数据库、配置和备份保留。当前运行与恢复入口是新机。回退需重新部署目标环境并恢复最新联合备份，不能切回已删除的旧冻结数据库，详见 [39](../docs/39-新服务器迁移与全量线上验收.md#旧服务器与回退)。

2026-10-12 批次优化的手动维护材料在 `shared/batches-20261012/`，最终联合备份在 `final-backup/`；80 表和知识原件的隔离恢复核对已通过。当前 API/Worker 镜像为 `enterprise-ai-platform/api:20261013-ai-process-r2`，Worker 九通道独立调度。速度优化前后的手动 DB/原件备份及八名成员私有配置快照在 `shared/speed-20261013/`；此前兼容 release/镜像保留，生产定时备份未安装。首字口径、流式输出和实际处理记录线上验证见 [43](../docs/43-自动运行与工作体验优化.md)。


## 受管 Runtime 的发布与回退

新独立服务器使用 `suite-runtime-manager.service`，配置保存在 `shared/runtime-manager/manager.env`、私有企业 Profile 和状态文件。API/Worker 追加 `compose.runtime-manager.yaml`，只挂载 `/run/suite-runtime` 的只读 Socket 目录。模型与 Gateway 凭据不入仓库。

配置示例见 `runtime-manager.env.example`。当前默认每 Gateway CPU 上限 2 核、内存上限 1536 MiB，可通过 `RUNTIME_GATEWAY_CPUS` / `RUNTIME_GATEWAY_MEMORY_MB` 调整；上限不是实际占用或资源预留。容器启动时应用上限，活动执行结束后才升级现有实例；OpenClaw 启动时读取内存约束，不能只在线修改 Docker 上限后就认定进程的内存压力阈值已更新。成员状态、模型凭据和平台绑定保持原身份。

受管请求使用每轮生成的 OpenClaw Incognito 会话，授权历史由平台传入，消息/业务回执/审计由平台持久化。控制器根据拥有者执行租约派生临时键，在后台经私有 loopback RPC 清理；失败保留重试，清理积压有准入上限，实例停止也会丢弃进程内临时状态。该 helper 不接受持久会话键或任意 RPC。快速 Agent 只允许只读工具并关闭已验证方舟模型的思考，纯深入分析使用独立只读 Agent，授权操作继续使用原业务 Agent。运营私有 Profile 保留原模型和密钥；外部手动绑定保持原接入契约。配置内容已相同的 Profile 升级只记录版本，不重启 Gateway。

新请求按成员自动准备 Gateway；已有手工地址不会被静默替换。人工停用绑定先于自动开通。新业务应用的 AI 接入还需明确 Gateway Agent 和对应工具白名单；只注册 Provider 不代表实际 Runtime 已验收。

检查 `systemctl is-active suite-runtime-manager`、API/Worker 健康、成员状态、活跃租约和模型运行回执。空闲暂停不等于服务未开通。当前测试主机最多保留 2 个成员 Gateway、每成员最多 2 个并发会话；当前批次冷启动历史样本约 80 秒，页面显示准备状态，详见 [43](../docs/43-自动运行与工作体验优化.md)。

手动回退时停止控制器，恢复之前的 API/Worker 与前端版本，并启动原已绑定的 Gateway。保留新增表、成员目录和已提交回执。联合备份必须覆盖 `runtime-manager`、原 `openclaw-members`、环境、数据库与知识原件。不得据此开启生产定时备份。

### D-037 处理记录发布与静态资源衔接

当前 API/Worker 为 `20261013-ai-process-r1`，本轮不迁移数据库或重启 Gateway。手动 DB、知识原件、环境和八名成员配置备份在 `shared/process-20261013/before-release-r1/`。原 `20261013-runtime-latency-r3` release 与镜像保留；本轮字段为兼容 JSON 扩展，回退不删除会话、动作或回执。

`build-cloud-frontends.mjs` 在构建时保留上一构建的哈希 JS/CSS，并在 `var/cloud-frontend-assets/` 保存本轮文件清单。清单在合并前写入，避免历史资源不断累积；发布需同时上传保留的资源，支持已打开客户端加载前一版分块。构建及 HTTP 旧资源检查通过后再发布。前端输出和源码同步至服务器仅用于恢复和未来构建，公开前端仍由各自 Cloudflare Worker 承载。


### D-038：任务结束即时交付与最新性能补测

当前 API/Worker `20261013-ai-process-r2`，员工端 `3630bb26-7440-4a89-98be-d73379119ee0`。任务 SSE 终态携带重新鉴权的最终消息和会话版本；前端即时结束等待，轮询保留作恢复。没有数据库迁移或 Gateway 重启。发布前手动 DB、知识原件、环境及八名成员配置备份在 `shared/performance-20261013/before-release-r2/`；R1 release/镜像保留。最新测试记录见 docs/43 的 D-038。

## 早期配置口径（历史追溯）

早期三端与知识能力的配置、QA 与回退步骤见 [25](../docs/25-首阶段组件部署与联调.md)。默认采用内置知识库，RAGFlow Cloud 保留为可选方案；2026-10-03 当前功能版本已发布到现有云端，2026-10-07 初始企业和管理员/运营账号已开通；2026-10-11 当前后端已迁移到独立服务器，迁移与验收见 [39](../docs/39-新服务器迁移与全量线上验收.md)；历史 release 的入口与回执见 [21](../docs/21-云端发布记录.md)。当前内置知识绑定已开通，生产成员 AI 执行环境尚未配置。按 D-022，RAGFlow Cloud 和生产定时备份暂缓，真实客户场景由用户后续测试。


这些描述不作为今天主机或模型状态的判定，按47和目标环境现场证据更新。

## 2026-10-20 D-046 三端UI、系统账号与管理助手

当前现场发布：`20261020-ui-accounts-r1`、21条迁移，三端前端版本、联合备份、实际验证和回退边界见[49](../docs/49-三端UI与账号体系线上发布.md)。D-043/D-044此前仅本地的状态由本次正式发布补充；历史段落不作为当前版本。

平台运营助手显式使用经核对的运营服务企业 `PLATFORM_AI_TENANT_KEY=xiaogai-studio`；身份与管理员关系逐请求验证，不隐式使用当前客户企业配置。Runtime控制器保持原代码和生命周期策略。

远程发布应上传脚本后执行，例如 `ssh <主机> sudo -n bash <脚本文件>`。迁移命令使用 `compose run --rm --no-deps -T migrate < /dev/null`，不要让容器读取通过SSH传入的后续脚本。联合Runtime备份须避免控制器并发写入；本次短暂冻结其进程状态写入，确保异常路径恢复控制器和API/Worker，成员网关不手动重启。完整备份保留于 `shared/release-20261020-ui-accounts/before-release/`。


## D-047：私有 memory-core 服务

分层记忆、数据/删除契约及日期验证见[50](../docs/50-AI分层记忆与上下文.md)。在上述五份现行Compose配置之后追加 `-f infrastructure/compose.memory-core.yaml`，API/Worker使用私网服务，不开放宿主机18790端口。`.env.production`增加独立随机 `MEMORY_CORE_TOKEN`（至少24字符）；不得复用Gateway/模型密钥，不输出或提交该值。新服务镜像为 `enterprise-ai-platform/memory-core:${RELEASE_TAG}`，固定复用已验OpenClaw 2026.9.7镜像digest。

发布先构建 API/Worker与memory-core镜像，在限额容器中用无业务数据的中文资料检查原生检索/隔离/失效，再备份并应用第22条兼容迁移。后端通过健康及记忆接口后再发布三端。只定向操作API、Worker和新memory-core；PostgreSQL、原件卷、成员Gateway、邻居服务保留。

索引卷 `enterprise-ai-platform_memory_core_index` 只含可重建派生资料与失效水位，仍属于企业数据；无需要不直接查看原文。恢复权威数据使用当前数据库，索引损坏时停止memory-core后按受限运维流程重建其专属卷/目录，禁止从旧索引导回平台。若恢复旧备份必须核对删除/过期记录及水位；不承诺备份永久擦除。代码编译缓存也在专属卷，和记忆目录分开。

回退优先恢复上一版API/Worker和三个前端，保留新增表与正式数据；可以停止memory-core关闭新检索。迁移是增表，不用删表回退；联合DB/原件/环境/Runtime备份、旧镜像和前端版本必须保留。不启用生产定时备份。


D-047后的回退额外要求：旧版API不识别`memoryRefs`。联合备份、停止API/Worker且无活动AI后，先运行`apps/api/scripts/ai-memory-rollback.cjs`检查，再使用`AI_MEMORY_ROLLBACK_MAINTENANCE=1`和`--apply`清理失效消息/任务正文及摘要，才可启动旧API。脚本只输出计数，不输出记忆原文。使用当前22迁移对应镜像；本次发布后增加的脚本可只读挂载到维护容器的`/app/apps/api/scripts/ai-memory-rollback.cjs`，以`compose run --rm --no-deps --entrypoint node -v <当前脚本绝对路径>:/app/apps/api/scripts/ai-memory-rollback.cjs:ro api apps/api/scripts/ai-memory-rollback.cjs`执行；apply时另加`-e AI_MEMORY_ROLLBACK_MAINTENANCE=1`及末尾`--apply`。不能在API/Worker仍写入时操作。

## 2026-10-23 D-056：AI用量治理与ERP专项发布

后端当前`20261023-ai-governance-r1`，25条迁移。沿用上述六份Compose配置、现有模型和持久卷；仅更新API/Worker及Runtime Manager，memory-core镜像仅保留兼容标签，其容器未重建。8个成员Runtime策略3、独立Agent设置`retry.provider.maxRetries=0`及新版指南已安装，两个常驻Gateway已重启并健康；不改全局OpenClaw。三端前端未重发，CRM AI仍关闭。发布、首轮备份传输中断后的恢复、最终切换和核验见[58](../docs/58-AI用量治理与ERP专项修复线上发布.md)。

备份在`shared/release-20261023-ai-governance-r1/before-release/`和`before-cutover/`；本地已核验恢复副本仅排除可重建编译缓存，完整Runtime快照仍在服务器。运行计量用`apps/api/scripts/report-model-usage.cjs`，支持环境/批次/企业/应用/用途筛选，不能把历史旧账本重复相加。新表不属于垃圾清理目标，也不为回退删表。未来回退先保留当时最新数据与Runtime，再选择代码/配置回退；不直接覆盖随后新增业务或模型设置。
