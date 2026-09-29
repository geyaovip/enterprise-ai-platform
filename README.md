# 企业 AI 应用平台

项目工作名：**企业 AI 应用平台**（`enterprise-ai-platform`）。

已确认的建设顺序：

1. 建设供多个业务应用共用的平台能力。
2. 在统一架构中从零开发 ERP，供真实客户在共享云服务中试用；架构同时考虑未来的客户专属部署。
3. 再开发 CRM、MES。三套新应用稳定运行并完成验收后，才考虑移除旧项目。
4. 后续开发建筑行业应用。

[`enterprise_ai_platform_v0.1_codex_spec.md`](enterprise_ai_platform_v0.1_codex_spec.md) 是原始规划草案。草案中的“建筑应用先行”及里程碑顺序尚未按上述决策更新，因此目前不能直接作为实施指令。新平台与 ERP 正在开发和内部验证；当前代码不代表已经通过真实客户试用准入。

每次开始新阶段先读 [开发启动基线](docs/15-开发启动基线.md)，再由[文档索引与决策记录](docs/00-文档索引与决策记录.md)定位对应功能、架构、UI、路由、开发、运维和客户数据导入文档。[ADR-001](docs/ADR-001-技术栈决策.md)固定技术栈与 M1 兼容性验证门槛。文档描述目标和验收条件，尚未表示新平台功能已交付。

[总体架构](docs/03-架构与数据安全.md)定义一个 Web、一个模块化后端 API 和一个数据库中的平台及业务模块；[应用模块契约](docs/10-应用接入契约.md)说明 ERP、CRM、MES 及未来应用如何复用公共能力。旧项目只供参考业务功能和规则，新项目不以迁入旧服务或旧数据库为实施路径。

[旧三应用能力盘点](docs/13-三应用业务能力清单与领域归属.md)列出当前代码、迁移及验收记录支持的业务范围，并记录新项目的领域归属待决点。新 ERP 按旧 ERP 当前已实现的完整功能范围重新开发；采购确认、分批入库及库存/应付只是第一条技术验证切片。[领域边界与协作契约](docs/12-领域边界与协作契约.md)定义数据所有者、关键业务规则与跨应用协作；AI 聊天和业务页面使用相同的应用命令。

[共享能力准入与模块公开契约](docs/14-共享能力准入与模块公开契约.md)规定平台技术能力先建设、业务能力默认由应用拥有，以及第二个真实场景出现后如何评审共享。[ERP/CRM 客户商机模型评审](docs/16-ERP与CRM客户商机模型评审.md)决定 ERP 首期自有稳定 ID，不预建 Party；真实跨应用身份仍待 Q-003。[ERP 功能追踪矩阵](docs/17-ERP功能追踪矩阵.md)用于逐项核对旧功能到新 API、UI、权限、AI、测试和数据处理。

[建筑五应用规格](construction_ai_suite_5_apps_spec.md)已标为未来产品输入；必须先完成 ERP、CRM、MES 与架构复盘，再确定建筑阶段实施计划。

## 当前开发运行

本地开发需要 Node 24、pnpm 11.19 和 PostgreSQL 17。在本目录复制 `.env.example` 为 `.env`，同时复制一份到 `apps/api/.env`；设置相同的本地 PostgreSQL 密码、API 的 `DATABASE_URL` 和 32 字节 AI 加密密钥。执行 `docker compose --env-file .env -f infrastructure/compose.yaml up -d postgres`、`pnpm install --frozen-lockfile`、`pnpm db:deploy`，再分别启动 `pnpm dev:api` 和 `pnpm dev:web`。异步 AI 任务使用 `pnpm --filter @suite/api start:worker` 启动独立 Worker。初始化测试企业和管理员前，在隔离开发环境设置 `BOOTSTRAP_EMAIL`、`BOOTSTRAP_PASSWORD`、`BOOTSTRAP_TENANT_SLUG`、`BOOTSTRAP_TENANT_NAME`，然后执行 `pnpm --filter @suite/api bootstrap`；此命令无交互提示，仅允许新租户首次初始化。

容器部署样例见 [生产 Compose](infrastructure/compose.production.yaml) 和 [环境变量模板](.env.production.example)，备份命令见 [备份脚本](infrastructure/backup.sh)。实施状态、已验证证据和剩余准入项见 [开发与内部验收记录](docs/18-开发与内部验收记录.md)。
