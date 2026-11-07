# CRM AI开启与线上验证（D-069）

2026-10-24。用户明确要求「CRM AI需要打开，不要关闭」，覆盖此前持续关闭总开关的决定。本次直接启用已发布的CRM助手链，不因完整质量验收尚未收尾而继续关闭所有入口；保留岗位授权、数据范围、写入提案和人工确认。

## 实际变更

- 生产当前release仍为`20261023-mes-v1-r2`，将`.env.production`的`CRM_AI_RELEASE_ENABLED=false`改为`true`。
- 先核对无执行中AI任务，再只重建本项目API/Worker加载环境；镜像、源码、数据库、Runtime策略及模型配置不变。PostgreSQL与memory-core容器ID不变，两个服务恢复健康。
- CRM继续使用原配置`doubao-seed-2-1-lite-260915`；ERP、MES与管理域模型不变。未开放新的外发、导出或无权业务操作。
- 开启是默认使用现有CRM AI入口；企业交付、启用、成员`crm.ai.use`及可用Runtime继续生效，不向所有企业或viewer自动授予AI权限。

## 验证结果

- 正式域名API：CRM元数据和AI状态均为enabled；当前成员有`crm.ai.use`，Runtime为ready且configured。
- 线上真实模型2轮：90天CNY经营指标查询、真实人群预览后只拟召回方案。均成功，无待确认写入操作；临时验证会话已删除，会话用量账本保留。
- 当前业务仍为60客户、4分群、6运营任务，两次业务快照一致。本轮没有点击确认创建任务或向外发送消息。
- 用户现有IAB页刷新后「询问AI」从禁用变为可用，实际打开对话面板，未观察到控制台错误。截图`online-ai-panel.jpg`。
- 本批仅为有限线上烟测，不标记20题×3轮、全部工作单交互、方案评分、真机或客户业务验收通过。此前AI-08历史失败及后续修复记录保留。

## 用量和证据

证据：`var/operations/20261024-crm-ai-enable/`。两轮会话产生4条reported模型用量记录：输入42,987、输出1,339、合计44,326 Token，其中缓存输入10,864包含于输入数，不重复累加。明细见`usage-receipt.json`。这是系统可查用量，不能代替火山账户总账。

`enable-receipt.json`记录环境前后哈希及不变的保护容器；`live-verification.json`记录线上接口与两轮结果，`other-app-status.json`确认ERP/MES仍ready、enabled、configured。本轮提供方型号未回传，记录配置型号与原始空model字段，不将配置型号冒充返回型号。

## 保持开启与恢复

后续官网、普通发布和清理沿用此开启状态；不得因引用历史文档再次设回false。必要的失败恢复、权限撤销和额度不足仍按正常业务错误处理。

本次环境原件备份在服务器`/opt/apaas/enterprise-ai-platform/shared/crm-ai-enable-20261024/environment-before.private`。仅环境变更，无数据库回退；历史false备份只作追溯，不作为后续默认部署输入。
