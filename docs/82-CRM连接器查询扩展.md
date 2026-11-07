# CRM连接器查询扩展

2026-10-27 D-083：补本人待办与销售池查询，现为管理员22工具/只读20工具。三个专家各内嵌4个Skill，本批不向WorkBuddy提交，详见[83](83-三应用Agent与MCP同步升级.md)。

2026-10-27，D-081。此前5个工具为首版实现数量，不是WorkBuddy或MCP协议上限。本次按业务域扩充，实际数量由当前成员权限与连接授权交集决定。

## 当前工具

管理员拥有全部CRM权限并允许草稿时共22个工具：

|范围|工具|
|---|---|
|连接与回执|ark_context、ark_action_status|
|经营机会与待办|crm_growth_opportunities、crm_metrics、crm_workbench|
|客户与交易|crm_customers、crm_customer_detail、crm_customer_orders|
|分群|crm_segments、crm_preview_segment|
|运营任务|crm_tasks、crm_task_detail、crm_task_customers、crm_task_results、crm_prepare_task_draft|
|销售|crm_leads、crm_lead_detail、crm_opportunities、crm_opportunity_detail、crm_follow_ups、crm_sales_pools|
|客户服务|crm_service_records（plans/risks）|

crm_preview_segment会保存快照，标记非只读，并要求crm.draft；crm_prepare_task_draft只准备提案，也要求crm.draft。其余20个工具只读取业务事实（底层沿用既有鉴权/审计与指标设置），不调用应用内模型。只读授权不会暴露上述两项写入工具。

客户读取不返回明文联系方式、密文、摘要密钥、导入来源哈希等内部字段。客户与订单按真实ID查询，CRM与ERP身份不互换；跟进需明确targetType、targetId及channelId。订单金额为主币单位的十进制字符串，实付、退款、状态、补偿和币种分别返回，不直接当收入。

分页默认20、最大100。列表返回total/page/page_size，多数查询同时给asOf/hasMore/授权范围。任务列表沿用最近1000条候选扫描，超限明确truncated=true，其total仅代表扫描范围可见数；任务详情最多最近100条日志。逐客户最新反馈从crm_task_customers分页读取。人群规则和任务结果保留原有窗口、币种、口径及权限校验。

保存链保持“准备提案→用户在平台确认具体参数→ark_action_status真实回执”。不提供直接群发、发券、审批、成交或逐客户结果写入工具。服务计划、风险、线索和商机仍经现有CRM业务Service鉴权。

## 专家与连接器

CRM连接器和CRM运营官专家更新为1.3.0，专家仍只引用原CRM连接器ID；ERP/MES更新为1.2.0。专家内嵌三个Skill不单独投稿。新增工具按实际tools/list发现；工具数量随岗位变化，无需重新创建连接器或授权资源。服务地址、OAuth资源、回调及原有工具名兼容。

本地包由integrations/workbuddy/build_packages.py --app crm生成，validate_packages.py校验。历史1.1.0提交ID和记录保留，新的市场状态以实际平台核验为准，不能把本地包校验当作市场审核通过。
