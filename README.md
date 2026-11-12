# 知行方舟 · 企业 AI 应用平台

知行方舟把企业知识、业务应用和数字员工接入同一个工作台。团队可以用 ERP 管理进销存，用 CRM 跟进客户，用 MES 管理生产，用品牌内容创作素材，用 GEO 分析品牌在 AI 回答中的可见度，并用制造业进销存协同接单、采购、生产和交付。六个应用共用企业账号、岗位权限、任务、通知和审计。

[官网](https://zhixingark.cn) · [工作场景](https://zhixingark.cn/solutions) · [数字员工](https://zhixingark.cn/employees) · [登录工作台](https://zhixingark.cn/login)

## 应用与数字员工

| 应用 | 主要功能 | 数字员工 |
| --- | --- | --- |
| [ERP 进销存](https://zhixingark.cn/products#erp) | 采购、销售、出入库、调拨、应收应付 | ERP 管家 |
| [客户 CRM](https://zhixingark.cn/products#crm) | 线索、客户、商机、跟进、客户分群、服务与续约 | CRM 运营官 |
| [MES 制造执行](https://zhixingark.cn/products#mes) | 图纸与 BOM 核查、生产计划、工单、报工审核 | MES 生产官 |
| [品牌内容](https://zhixingark.cn/products#content) | 图片与视频工作流、参考素材、画布、生成记录和下载 | 品牌内容创作官 |
| [GEO 品牌可见度](https://zhixingark.cn/products#geo) | 多模型分析、品牌与竞品对比、回答与引用证据、PDF 报告、定期监测和同条件复测 | GEO 品牌分析官 |
| [制造业进销存](https://zhixingark.cn/products#manufacturing) | 销售接单、备料采购、生产派工、库存和发货追溯 | 制造履约与物料协同专家 |

GEO 按企业开通。获授权的成员可以在报告中点「解读报告」，让品牌分析官基于当前报告解释品牌提及、竞品缺席和引用证据，并准备复测。批量分析与复测由用户在 GEO 页面确认费用。平台 GEO 从新数据开始。 [GEO 接入与权限](docs/geo/01-接口权限与状态.md) · [GEO 品牌分析官](docs/158-GEO品牌分析官.md)

应用内 AI 按企业、岗位和业务对象鉴权。涉及业务写入的提议需要人工确认，执行结果以业务回执为准。模型生成能力取决于企业开通与模型配置。 [AI 能力与业务规范](docs/11-AI能力与业务嵌入规范.md)

## 项目结构

三个 React/Vite 前端连接同一个模块化 NestJS API。PostgreSQL 保存平台和业务数据，独立 Worker 执行异步任务。Cloudflare 提供官网和各前端入口，API、Worker、数据库与受管 OpenClaw Runtime 部署在平台服务器上。

| 目录 | 内容 |
| --- | --- |
| `apps/web` | 官网、登录、企业工作台和六个应用 |
| `apps/admin`、`apps/platform-admin` | 企业管理端与平台运营端 |
| `apps/api` | API、Worker、应用模块、Prisma 模型和迁移 |
| `packages/frontend` | 共享 UI、账号、通知、AI 对话和品牌组件 |
| `cloudflare` | 路由、前端服务绑定和同源 API 转发 |
| `infrastructure` | 开发与部署模板、Runtime Manager、备份与检查脚本 |
| `docs` | 架构、产品与接口契约、验证和版本记录 |

## 本地开发

需要 Node.js **24.21.0**、pnpm **11.19.0** 和 PostgreSQL 17。下面使用 Docker 创建本地数据库，默认端口为 `54329`。

```sh
git clone https://github.com/geyaovip/enterprise-ai-platform.git
cd enterprise-ai-platform
cp .env.example .env
cp .env.example apps/api/.env
pnpm install --frozen-lockfile
```

配置两个环境文件，让 `DATABASE_URL` 使用本地数据库的密码。为 `AI_ENCRYPTION_KEY`、`CHANNEL_ENCRYPTION_KEY` 和 `AUTH_EMAIL_SECRET` 生成各自的随机值。要体验邮箱验证码登录，还需填写 Resend 发件配置和适用于本地环境的 Turnstile 配置。变量见 [开发模板](.env.example) 和 [运行手册](infrastructure/README.md)。

```sh
docker pull postgres:17-alpine
docker compose --env-file .env -f infrastructure/compose.yaml up -d postgres
pnpm db:deploy
```

在各自终端运行所需服务。

```sh
pnpm dev:api               # API，4600
pnpm dev:web               # 工作台，4601
pnpm dev:admin             # 企业管理端，4603
pnpm dev:platform-admin    # 平台运营端，4604
```

API 构建后，可运行 `pnpm --filter @suite/api start:worker` 启动异步任务。知识解析、媒体处理和 GEO PDF 的系统依赖见 [API Dockerfile](infrastructure/Dockerfile.api)。部署自己的实例时，根据 [生产环境模板](.env.production.example) 配置域名、数据库和凭据，并替换 Wrangler 中的 Cloudflare 账号及服务绑定。

## 构建与检查

```sh
pnpm typecheck
pnpm --filter @suite/api build
pnpm build:cloud
pnpm test:seo
```

GitHub Actions 执行锁定依赖安装、类型检查、API 与三前端构建、官网路由及 SEO 检查。前端发布使用通过 CI 的提交产物，Cloudflare 记录 Git SHA 与 CI 运行编号。 [前端发布手册](infrastructure/frontend-release.md) 业务和权限用例位于 `apps/api/tests`，数据库回归使用独立测试库，真实模型调用单独验证。 [开发与测试规范](docs/06-开发与测试规范.md)

## 文档入口

- [总体架构与数据安全](docs/03-架构与数据安全.md) · [应用接入契约](docs/10-应用接入契约.md) · [公共 UI 规范](docs/ui/00-公共UI规范.md)
- [ERP](docs/17-ERP功能追踪矩阵.md) · [CRM](docs/crm/00-文档索引与决策.md) · [MES](docs/mes/00-文档索引.md) · [品牌内容](docs/content/01-产品与功能.md) · [GEO](docs/geo/00-原生接入方案.md)
- [项目现状](docs/47-项目现状与文档维护.md) · [GEO 上线记录](docs/154-GEO官网与生产上线.md) · [官网访客流程](docs/157-官网访客流程走查与修正.md) · [完整文档索引](docs/00-文档索引与决策记录.md)

公开仓库包含平台源码、迁移、配置模板和技术文档。文档中的内部验收记录、截图和生产备份由运维环境保存。
