# 知行方舟 · 企业 AI 应用平台

以 ERP、电商 CRM、MES 为业务应用，共享账号、企业、权限、知识、审计和受控 AI 执行能力。一个 Monorepo，三个独立前端，一个模块化 API、PostgreSQL 数据库和异步 Worker。

[总官网](https://zhixingark.cn) · [产品中心](https://zhixingark.cn/products) · [登录工作区](https://zhixingark.cn/login) · [品牌标识](https://zhixingark.cn/brand/identity.html)

## 应用与当前范围

| 应用 | 已实现的业务范围 | 产品官网 |
| --- | --- | --- |
| ERP 进销存 | 客户与商机、采购、销售合同、出入库、调拨、应收应付、收款认领、开票及岗位协作 | [ERP](https://zhixingark.cn/products/erp) |
| 电商 CRM | 客户与交易导入、购买/复购指标、标签与分群、人工运营任务、效果观察和审计 | [CRM](https://zhixingark.cn/products/crm) |
| MES 制造执行 | 物料、BOM 版本、多级需求展开、生产计划、工单、分批报工和审核 | [MES](https://zhixingark.cn/products/mes) |

ERP 与 MES 提供受控 AI 助手，具体可用性取决于企业开通、成员权限、模型和运行环境。AI 从授权业务事实查询、分析并准备提案，业务写入需确认；发布、派工、报工和审核继续遵守业务规则。**当前生产 CRM AI 闸门关闭**，人工客户经营功能可用。

账号使用系统内注册和密码登录；首次登录后创建企业，或通过邀请加入已有企业。工作台、企业管理端和平台运营端共用一套 UI 与品牌规范。

## 架构与目录

| 路径 | 职责 |
| --- | --- |
| `apps/web` | 静态官网、登录与企业业务工作台 |
| `apps/admin` | 企业组织、成员、应用交付、知识及订阅管理 |
| `apps/platform-admin` | 平台企业管理、运行与用量、运营审计 |
| `apps/api` | NestJS API、异步 Worker、Prisma 模型、迁移和领域测试 |
| `packages/frontend` | 三端共享 UI、账号、通知、AI 对话和品牌标识 |
| `cloudflare` | 总入口、独立前端路由和同源 API 转发 |
| `infrastructure` | Docker、Runtime Manager、OpenClaw/memory-core 适配、备份与部署 |
| `docs` | 产品契约、公共规范、实施与验收记录 |

- 企业、应用、成员及对象范围由服务端逐请求校验；前端菜单不作为权限依据。
- 各应用拥有自己的业务数据和规则，跨应用经公开契约协作。
- 平台保存会话历史、授权、原文和版本，OpenClaw 承接受控执行及摘要/记忆能力。
- AI 模型请求与重试有计量、预算和上下文限制；真实模型测试与普通回归分开执行。

## 本地开发

需要 Node.js **24.21.0**（见 [.nvmrc](.nvmrc)）、pnpm **11.19.0**、PostgreSQL 17；Docker 可用于启动独立开发数据库。CRM 文件导入和知识解析需要 Python 3，PDF/OCR 另需 Poppler、Tesseract，依赖以 [Dockerfile](infrastructure/Dockerfile.api) 为准。

```sh
git clone https://github.com/geyaovip/enterprise-ai-platform.git
cd enterprise-ai-platform
cp .env.example .env
cp .env.example apps/api/.env
pnpm install --frozen-lockfile
```

填写两份本地环境文件：数据库密码与 `DATABASE_URL` 保持一致，为 `AI_ENCRYPTION_KEY`、`CHANNEL_ENCRYPTION_KEY` 配置独立随机值。使用独立开发库，不复制生产配置。开发数据库示例默认绑定 `127.0.0.1:54329`：

```sh
# compose.yaml 使用本地已有镜像，首次需要先拉取
docker pull postgres:17-alpine
docker compose --env-file .env -f infrastructure/compose.yaml up -d postgres
pnpm db:deploy
```

分别在独立终端运行：

```sh
pnpm dev:api               # API，4600
pnpm dev:web               # 工作台，4601
pnpm dev:admin             # 企业管理，4603
pnpm dev:platform-admin    # 平台运营，4604
```

异步任务另运行 `pnpm --filter @suite/api start:worker`；先构建 API，再启动 Worker。普通注册不会授予平台运营权限，也不会自动提供模型凭据。初始化与 Runtime 配置见[部署联调说明](docs/25-首阶段组件部署与联调.md)和[运行手册](infrastructure/README.md)。

## 构建与检查

```sh
pnpm typecheck
pnpm build
pnpm build:cloud
pnpm test:seo
```

`build:cloud` 按正式基路径生成三个前端，并保留前一版哈希资源供已打开的客户端加载。SEO 检查覆盖公开 HTML、结构化数据、正式域名、robots/sitemap、图片索引、重定向及 404。仓库 CI 执行安装、类型检查、构建与 SEO 回归，不运行数据库写入或付费模型测试。

业务、权限和 AI 用例在 `apps/api/tests`，具体命令及验收条件见[测试规范](docs/06-开发与测试规范.md)。数据库测试只连接隔离测试库；真实模型测试需单独配置、设置预算并确认授权。

## 发布与官网

正式来源为 **[https://zhixingark.cn](https://zhixingark.cn)**。官网、ERP/CRM/MES、两个管理端和 API 共用此来源；应用官网分别位于 `/products/erp`、`/products/crm`、`/products/mes`。

Cloudflare 使用一个入口 Worker 和三个前端 Service Binding；API/Worker、PostgreSQL 和受控 Runtime 在独立服务端运行。`wrangler*.jsonc` 是本项目的部署配置；部署自己的实例前，需替换账号、Worker 名称、域名与绑定，并通过受控配置提供后端地址和凭据。

- [品牌与正式域名](docs/59-品牌官网与正式域名发布.md)
- [官网代码 SEO 与验收边界](docs/60-官网代码SEO优化与发布.md)
- [生产环境模板](.env.production.example)与[运行手册](infrastructure/README.md)

本仓库提供源码、迁移、配置模板及文档，不包含生产密钥、数据库、上传原件、运行会话、私有验收数据或部署备份。旧三应用是独立工作区和仓库，本次同步不修改它们。

## 文档与验收边界

| 主题 | 入口 |
| --- | --- |
| 项目当前状态与已知限制 | [47 项目现状](docs/47-项目现状与文档维护.md) |
| 规则、授权和决策 | [AGENTS.md](AGENTS.md)、[文档索引](docs/00-文档索引与决策记录.md) |
| 公共 UI、AI 交互与品牌 | [公共 UI 索引](docs/ui/00-公共UI规范.md) |
| ERP 功能及覆盖 | [ERP 追踪矩阵](docs/17-ERP功能追踪矩阵.md) |
| 电商 CRM | [CRM 文档](docs/crm/00-文档索引与决策.md) |
| MES 与真实模型代表题集 | [MES 文档](docs/mes/00-文档索引.md)、[MES 发布记录](docs/mes/06-真实模型验收与线上发布.md) |
| AI 记忆与用量治理 | [记忆分层](docs/50-AI分层记忆与上下文.md)、[用量治理](docs/57-AI用量治理与Evolving复测.md) |

历史记录中的本机/服务器路径、截图和私有 JSON 是当时的验收位置，不一定随仓库分发。构建、隔离测试、真实模型代表题集、生产演示和客户验收分别记录；当前代码与上线记录不代表全部行业场景、容量或客户业务已验收。设备采集、自动排程、ERP/MES 库存对接和 CRM 自动群发等不在当前交付范围。
