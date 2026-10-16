# 知行方舟 · 企业智能业务平台

面向企业业务协作与 AI 辅助操作的统一平台，以 ERP 为首个业务应用，集中建设身份、租户、组织、权限、审计及 AI 工具执行能力。项目采用模块化单体架构，将业务页面、对话操作和异步任务纳入同一套业务规则。

[产品官网与工作区](https://enterprise-ai-platform.492746023.workers.dev/) · [文档索引](docs/00-文档索引与决策记录.md) · [内部验收记录](docs/18-开发与内部验收记录.md) · [云端发布记录](docs/21-云端发布记录.md)

**当前阶段：开发与内部验证。** 官网可公开浏览，业务工作区需要授权账号；真实客户试用、真实模型效果和工作通道实连需按验收记录单独确认。

## 核心模块

| 模块 | 当前建设内容 |
| --- | --- |
| 平台基础 | 租户、身份、组织与成员、应用上下文、角色权限和审计。 |
| ERP 业务 | 客户与商机、商品与供应商、采购、销售、库存、应收应付及收付款。 |
| 业务协作 | 客户公海与领用、跟进记录、采购与销售审核等流程。 |
| AI 运行时 | 对话上下文、受控业务 Tool、敏感动作确认、模型配置及任务队列。 |
| 异步 Worker | 执行后台 AI 任务，并在执行时重新校验权限。 |

平台和 ERP 已有代码、迁移与内部验证记录；CRM、MES 及建筑行业应用属于后续建设范围。各业务模块的覆盖情况以 [ERP 功能追踪矩阵](docs/17-ERP功能追踪矩阵.md)为准。

## 架构设计

- **统一工程与运行边界**：一个 Monorepo、一个 Web、一个模块化 API、一个 PostgreSQL 数据库及独立 Worker。
- **业务模块拥有数据与规则**：跨模块通过公开契约协作，避免直接改写其他模块的数据表。
- **关键业务保持事务一致性**：采购入库、库存变化和应付账款在同库事务中处理。
- **AI 与页面共用业务服务**：对话操作遵守租户、权限、确认和审计约束。
- **按真实需求共享**：先建设平台技术能力，业务对象在出现明确复用需求后评审共享。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| Web | React、TypeScript、Vite |
| API | NestJS、TypeScript |
| 数据 | PostgreSQL 17、Prisma |
| 工程 | Node.js 24、pnpm 11.19、Workspace Monorepo |
| 部署 | Docker Compose、Cloudflare Worker 前端与同源 API 代理 |

## 本地运行

需要 Node.js 24.15+（24.x）、pnpm 11.19、Docker 与 PostgreSQL 17。

```bash
git clone https://github.com/geyaovip/enterprise-ai-platform.git
cd enterprise-ai-platform
cp .env.example .env
cp .env.example apps/api/.env
```

先配置两份环境文件：使用一致的本地 PostgreSQL 密码，设置 API 的 `DATABASE_URL`，并分别生成独立的 32 字节 AI 加密密钥与 `CHANNEL_ENCRYPTION_KEY`。具体字段见[环境模板](.env.example)。

```bash
docker compose --env-file .env -f infrastructure/compose.yaml up -d postgres
pnpm install --frozen-lockfile
pnpm db:deploy
pnpm dev:api
```

在其他终端分别启动 Web 与 Worker：

```bash
pnpm dev:web
pnpm --filter @suite/api start:worker
```

首次初始化测试企业前，在隔离开发环境设置 `BOOTSTRAP_EMAIL`、`BOOTSTRAP_PASSWORD`、`BOOTSTRAP_TENANT_SLUG` 和 `BOOTSTRAP_TENANT_NAME`，再执行 `pnpm --filter @suite/api bootstrap`。该命令仅用于新租户首次初始化。

## 项目结构与检查

| 路径 | 用途 |
| --- | --- |
| [`apps/web/`](apps/web/) | 官网、登录和业务工作区 |
| [`apps/api/`](apps/api/) | 平台、业务模块与 Worker |
| [`infrastructure/`](infrastructure/) | Compose、生产配置与备份脚本 |
| [`cloudflare/`](cloudflare/) | 公网前端与 API 转发 |
| [`docs/`](docs/) | 架构决策、模块契约、功能追踪与验收 |

```bash
pnpm typecheck
pnpm build
```

生产部署示例见[生产 Compose](infrastructure/compose.production.yaml)，备份入口见[备份脚本](infrastructure/backup.sh)。涉及数据库与业务数据的验证应使用独立测试环境。

## 实施与文档

开发前阅读[开发启动基线](docs/15-开发启动基线.md)，技术选择见 [ADR-001](docs/ADR-001-技术栈决策.md)，AI 运行边界见 [ADR-002](docs/ADR-002-AI运行边界与外部协议.md)。模型测试、渠道接入与真实客户试用分别验收，模拟模型结果不能替代真实业务验收。
