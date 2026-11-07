# 统一CRM上线与旧三应用退役

2026-10-26，D-078。用户在D-077本地实施后明确要求“发线上”，并清理旧三应用的Cloudflare、GitHub与云服务器资源；随后明确改为“暂时保留GitHub仓库”。按最新授权执行：新CRM已上线，旧Cloudflare与云端运行资源退役，三个原GitHub仓库保留。本页覆盖此前“未发布、旧服务继续运行”的阶段状态。

正式入口：[知行方舟](https://zhixingark.cn/login)。旧CRM/MES/ERP数据没有自动导入新平台，真实业务映射、迁移与客户验收未执行。退役不等于旧数据迁移验收。

## 新平台发布

- 服务器：`<服务器地址>`，部署根目录`/opt/apaas/enterprise-ai-platform`。
- 当前版本：`releases/20261026-crm-unified-r1`，API/Worker镜像`enterprise-ai-platform/api:20261026-crm-unified-r1`。仅重建API、Worker，数据库/Runtime/网关等受保护容器不重建。
- 发布源从实际D-076部署版本构建，311份旧源文件核对无差异，再加入47份后端补丁及统一CRM前端；没有把工作区未发布的D-063 AI资料整理/OCR增量夹带上线。
- 新增两条增量迁移：`20261026090000_crm_unified_sales_service`、`20261026110000_crm_engagement_indexes`。先在恢复后的生产快照验证两条迁移，再应用正式库。
- 应用内AI保持D-076提示模式，实际模型关闭，本轮模型调用0。OAuth、三连接器隔离和准备/确认/回执机制保留；没有重复提交WorkBuddy资产，也未将新增销售/服务接口宣称为已上架工具。

| Cloudflare前端 | 新版本ID |
| --- | --- |
| workspace | `41a423f2-ff7f-47b7-bcd9-085829e82030` |
| tenant-admin | `53eea563-61b0-4170-bdb1-9ea6c81cadfe` |
| platform-admin | `bb882fa3-430f-4fbd-89cb-107e3c49c3e7` |

公共API网关Worker未更新。构建前后记录与源码摘要位于受限目录`var/operations/20261026-crm-release/`。

## 已验证的上线结果

| 检查 | 实际结果 |
| --- | --- |
| 隔离发布源构建 | API、工作区、企业管理与平台运营三个前端通过 |
| 隔离CRM与连接器 | 新流程110次HTTP；连接器146断言/67次HTTP通过 |
| 正式域名新CRM流程 | 110次合成HTTP检查通过，包含线索、转化、联系人、归属、商机、跟进、服务/续约、越权/撤权/版本冲突；合成数据清理 |
| 公网静态与协议 | 27项页面/资源SHA256一致；API数据库ready；OAuth发现、三应用保护资源和未授权MCP拒绝正常 |
| 原正式数据 | CRM客户60、订单146、运营任务6；ERP客户118；MES工单10，发布前后数量一致 |
| 身份与受保护资源 | 原286条会话保留；认证/基础设施密钥摘要一致；受保护容器ID不变；运行镜像47份目标文件摘要一致 |

原32项浏览器布局和实际录入刷新验证属于D-077本地浏览器证据，未将其写成生产浏览器验收。公网HTTP和合成流程不替代客户业务、并发容量、原生移动设备或真实模型质量验收。

## 旧云端退役范围

Cloudflare账号中已删除`apaas-sales360-crm`、`apaas-mes`、`apaas-electronics-erp`三个Worker；核对无自定义域名和其他Worker服务绑定依赖。其他10个Worker保留，Pages项目未作删除。

旧服务器`<服务器地址>`是共享主机，未删除整台云服务器，也未执行全局Docker prune或其他项目Compose down。已完成：

- 冻结三个旧API，生成最终数据库快照和源码/配置归档，再在本地隔离环境恢复所有快照。
- 删除三个旧API和三个数据库容器，共6个；删除三个独占的`*_db-data`卷和三个`*_default`网络。
- 删除三个应用仓库前缀下的6个API镜像标签；归档保留退役时实际运行的3个API镜像。保留通用PostgreSQL镜像和共享`yingchuan_backend`网络。
- 将三个`/opt/apaas/apaas-*`源码运行目录移至受限退役备份目录，保留`.git`、`.env`、Compose与迁移。
- 从当前共享Caddy配置移除`/apaas-sales360/*`、`/apaas-mes/*`、`/apaas-erp/*`路由，并移除当前发布检查脚本中相应健康检查循环。保留挂载文件inode，先语法验证再热重载；未重建Caddy。
- 其余18个容器ID、运行及健康状态与清理前一致，映川`https://api.chatway.chat/api/v1/ready`正常。

共享网关的修改只应用于当时实际运行的发布目录，未推送其他项目Git仓库。未来发布映川时需保留这次路由/检查调整，避免历史模板重新引入已退役依赖。

## GitHub保留结果

复核发现CRM原仓库已进入GitHub删除列表，已通过“Restore”恢复原仓库。三个仓库的原ID及main HEAD均与事前镜像备份一致，没有用同名新仓库替代；MES、ERP未删除或归档。

| 原仓库 | 仓库ID | main HEAD |
| --- | --- | --- |
| `geyaovip/apaas-sales360-crm` | `1391994100` | `ef0bdadbef9dbcc5e45a034076a5a79c2e1316b7` |
| `geyaovip/apaas-mes` | `1391994750` | `6f69304a7efafe66758ceb4aa5f563956a295500` |
| `geyaovip/apaas-electronics-erp` | `1391995833` | `d72e41e9ffb9d671b34937bf55a7a27334cccaa4` |

本轮未向旧仓库推送任何文档或业务修改。本地工作区的退役提示独立维护，原仓库中的旧在线地址暂时仍是历史内容。

## 备份、恢复与回退

新平台发布前备份在本机`var/operations/20261026-crm-release/before-release.private.tar.gz`及服务器`shared/release-20261026-crm-unified-r1/`；真实配置/数据库受限保存，不随源码公开。上一版本`20261024-workbuddy-r2`、旧镜像、三个前端旧版本ID均保留。紧急回退应使用旧发布目录的原Compose组合只重建API/Worker，恢复`current`及原前端版本；两条迁移是增量结构，回退旧代码不应删除新表或覆盖发布后的业务数据。回退步骤未在生产实际执行。

旧服务器恢复根目录：`/opt/apaas/retirement-backups/20261026/`。本机副本：`var/operations/20261026-legacy-retirement/`。

| 备份/演练 | 结果 |
| --- | --- |
| `final-state.private.tar.gz` | SHA256 `932ba05aedd4ecd34b9c469950c1fb5a917f75a89c7b7a34d5d87ad241f62223`；已复制本机，归档及所有成员摘要一致 |
| 最终CRM数据库 | 27表、142行，隔离pg_restore成功，全部表行数一致 |
| 最终MES数据库 | 14表、130行，隔离pg_restore成功，全部表行数一致 |
| 最终ERP数据库 | 21表、126行，隔离pg_restore成功，全部表行数一致 |
| `runtime-images.tar.gz` | 约435MiB，3个实际运行API镜像；服务器SHA256 `19a707747942f9eed64a0e782585c56e682565282291f07fe131d4a59520cf38` 已核验；未完成镜像归档异地下载，不标成异地镜像备份 |
| Git仓库 | 三个完整镜像与bundle已fsck/摘要核验；GitHub原仓库保留 |
| 共享配置 | 当前Caddy与check-runtime脚本修改前副本、验证/热重载日志保留 |

需恢复旧系统时，先明确恢复目的，优先在隔离主机：核验归档摘要，使用`docker load`载入镜像；复制`retired-source/<仓库名>`或从最终源码归档恢复目录与原`.env`；按原Compose先建立独立数据库，再以`pg_restore --no-owner --no-privileges`恢复该应用最终dump并逐表核对。恢复API、授权及核心业务后，再单独决定是否恢复网关和公开Worker。数据库恢复已演练，完整旧应用/公网重建未执行；不得直接重跑整份历史网关配置覆盖共享服务。

证据：新版本`live-unified-flow.log`、`verify-server.log`、`live-verification.json`、`restore-verification.json`；旧系统`final-backup-summary.json`、`restore-verification.json`、`server-retirement-verification.json`、`cloudflare-verification.json`、`github-preserved-verification.json`。这些受限文件可能含内部标识或配置，不提交公开仓库。

本机演练产生的5个生产/旧库恢复副本已定向删除，两个本次QA容器已停止，QA卷保留；原本地平台4个容器继续运行。原始受限备份未删除。
