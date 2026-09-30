# 运行与发布手册

本目录只操作新平台的 Compose 项目 `enterprise-ai-platform`。旧 CRM、MES、ERP 的容器、卷与备份不在本手册操作范围内。首客共享云发布前，按 [数据导入与上线验收](../docs/08-迁移与上线验收.md) 完成真实入口、模型、备份和回退验收。

本机隔离容器演练可参考 [本机 QA 变量模板](local-qa.env.example)；它使用回环 HTTP，只用于本机验收，不是客户环境配置。

## 首次准备

1. 在项目根目录复制 [环境变量模板](../.env.production.example) 为 `.env.production`，设置 `chmod 600 .env.production`。逐项填写发布标签、实际 HTTPS 域名、数据库密码、URL 编码后的数据库连接串、32 字节随机 AI 加密密钥及允许的模型供应商域名。数据库密码与加密密钥应放进目标环境的受限密钥管理；不要提交到 Git。
2. 配置 `SITE_ADDRESS` 为解析到目标机器的域名，`WEB_ORIGIN` 为相同的 `https://` 来源。Caddy 使用该域名签发 HTTPS 证书；80/443 必须按部署环境开放。确认目标主机剩余空间可容纳新旧两版镜像、构建缓存和一次数据库备份。不得在共享机器上做全局清理。
3. 先执行 `docker compose --env-file .env.production -f infrastructure/compose.production.yaml config --quiet`。该命令验证变量与配置，不输出 Secret。

## 发布

在项目根目录执行：

```sh
./infrastructure/backup.sh
docker compose --env-file .env.production -f infrastructure/compose.production.yaml build migrate web
docker compose --env-file .env.production -f infrastructure/compose.production.yaml up -d
docker compose --env-file .env.production -f infrastructure/compose.production.yaml ps
```

首次空库时可跳过第一条备份命令；已有客户数据或任何迁移升级前必须先备份，并将备份及其校验值转移到受限的异地存储。`migrate` 是一次性容器，完成后应显示退出码 0；`api`、`worker`、`postgres` 应健康，`web` 应运行。确认公网 `https://<SITE_ADDRESS>/api/v1/health` 返回就绪，再以授权账号检查当前企业、ERP 只读及受控写入、审计和 AI 模型状态。

### 共享服务器与 Cloudflare Worker 入口

当 80/443 已由同机共享 HTTPS 网关占用时，叠加 `compose.shared-server.yaml`：只启动新项目的 PostgreSQL、迁移、API 和 Worker；`web` 进入 `standalone-web` profile，不会抢占端口。API 同时接入共享网关所在的 `yingchuan_backend` Docker 网络。该文件只适用于已经核对该网络及网关的这台共享服务器；其他环境使用上面的通用 Compose。

共享网关为新平台添加独立路径 `/apaas-platform/*`，转发到 `enterprise-ai-platform-api-1:4600` 并去掉路径前缀。修改网关前备份其当前配置，先验证再热加载，随后同时复测旧应用和新平台的健康接口；新平台发布不应重建网关或旧应用容器。

Cloudflare 入口使用项目根目录的 `wrangler.jsonc` 和 `cloudflare/worker.js`：静态文件来自 `apps/web/dist`，`/api/*` 由 Worker 转发到共享网关的 `https://.../apaas-platform/api/*`。先构建 Web，再用 `wrangler deploy --dry-run` 校验，配置该 Worker 专属的 `API_ORIGIN` Secret 后发布。生产 `WEB_ORIGIN` 必须是最终 `https://<worker>.workers.dev` 来源。源代码和密钥分别管理；不要把 `.env.production`、Cloudflare 凭据或模型密钥提交到 Git。

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
