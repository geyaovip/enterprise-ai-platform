# 本地 Docker 清理与存储重建

日期：2026-10-24，D-065。用户要求本地磁盘清理，保留知行方舟与GEO；随后明确同意“备份后重建Docker”。仅处理本机desktop-linux，没有访问或操作云服务器。

## 排查

- 初始Mac数据盘剩约4.5GiB；Docker.raw实际分配约23GiB，不把显示的60GiB最大容量当作实际用量。
- 10个容器中4个属于运行中的enterprise-ai-platform，其余6个已停止。21个数据卷合计约1.11GB，全部保留，包括映川/GEO、旧ERP/CRM/MES与其他项目数据库。
- 初始镜像7个、构建缓存0；VM中overlay2约20GiB，包含约11GiB的旧Ray/Anaconda层，明显高于Docker API所列镜像用量。普通镜像删除、官方空间回收、构建缓存清理及重启后仍未回收这些层。
- 按[Docker磁盘说明](https://docs.docker.com/desktop/troubleshoot-and-support/faqs/macfaqs/)使用官方回收方式，并遵循[存储层操作提醒](https://docs.docker.com/engine/storage/drivers/overlayfs-driver/)避免在运行的overlay2目录里直接删除文件。

## 已实施范围

- 删除6个停止容器：旧ERP、MES、CRM数据库，小蓝/WEIBOT发布器数据库和一套已停止的本项目开发数据库。没有删除其数据卷。
- 删除postgres:17、postgres:16-alpine、node:24.21.0-bookworm-slim、caddy:2.10.2-alpine四个闲置标签，以及5个闲置Compose网络。共享的当前镜像层由Docker自身管理。
- 初步清理后剩余空间约5.2GiB；用户确认备份后重建，才进入下述步骤。
- 保留当前4个容器的完整文件系统、配置/启动环境/挂载/网络/端口，备份全部21个卷并补做停机后的最终PostgreSQL快照。
- 最初docker image save会额外生成导出临时文件，磁盘余量过低时已中止，没有把失败导出当作有效备份；最终采用4个完整容器文件系统归档，并逐个检查归档可读性。
- 校验全部恢复材料后，停止Docker Desktop，确认数据盘没有打开句柄，仅移除指定Docker.raw并在同一位置重建。没有手工删除活动overlay2层，没有改动项目源码、Git、文档、主机目录中的凭据或其他用户文件。
- 恢复21个卷及当前4个容器，旧闲置项目的容器/镜像不恢复。GEO清理前没有运行容器，其数据按原名保留，不把数据恢复当作GEO应用验收。

## 限制增长

- 本机8GiB内存，Docker内存配额从4096MiB调至2048MiB，以减少主机内存压力；恢复后的服务另核健康。未来增加负载时再按实际需要调配。
- builder.gc启用，defaultKeepStorage由20GB调为2GB，这是垃圾回收策略目标，不是整个Docker磁盘的硬上限。
- 默认json-file日志设置max-size=10m、max-file=3；恢复的4个容器也显式应用相同设置。配置依据：[构建缓存GC](https://docs.docker.com/build/cache/garbage-collection/)、[日志配置](https://docs.docker.com/engine/logging/configure/)。

## 恢复与证据

受限本地目录：`var/operations/20261024-local-docker-cleanup/recovery/`。包含4份rootfs归档、21卷总归档、最终PG快照、容器私有配置、卷/网络元数据、SHA256清单及restore.py。该目录保留用于恢复，包含私有环境信息，不上传GitHub或外部服务。恢复脚本仅用于空的本地Docker引擎，不在已有运行环境里重复执行。

原始盘点、明确删除清单、空间回收/重启/导出与恢复日志位于同级operations目录。恢复后的逐文件校验、健康及最终磁盘数字在后续结果和final-receipt.json记录。

## 最终结果

- 21个卷全部恢复，20,101个文件SHA-256逐项匹配；卷名称、标签及挂载选项匹配。
- 4容器运行，API/Worker/PostgreSQL健康；本地4610首页及API健康均200。
- Docker实际数据盘约23GiB降至3GiB；最终Mac可用约24.6GiB（随主机swap等活动变化），原先约4.5GiB。
- 恢复归档约958MiB，继续受限保留。GEO未启动容器，不声称其完整应用验收通过。
