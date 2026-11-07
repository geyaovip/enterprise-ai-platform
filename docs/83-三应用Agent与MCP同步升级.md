# 三应用Agent与MCP同步升级

2026-10-29更新：当前Agent/Skill/MCP包、网页AI及视觉能力边界见[121](121-Agent与MCP文档同步更新.md)，生产发布见[120](120-本地待发布功能联合上线.md)。下文保留当时实施/提审记录；旧提示模式、工具/Skill数和审核状态不能直接当作现状。

2026-10-27，D-083。用户要求同步补齐连接器中尚未覆盖的业务，并检查更新三个Agent与MCP，明确“先别在WorkBuddy提交”。本批更新API/Worker及本地升级包，不操作WorkBuddy投稿、撤回、市场版本或审核记录。

## 当前覆盖

| 应用 | 本地Agent/MCP包 | 管理员工具数 | 只读授权 | 内嵌Skill |
|---|---|---:|---:|---:|
| ERP 管家 | 1.2.0 | 15 | 14 | 4 |
| CRM 运营官 | 1.3.0 | 22 | 20 | 4 |
| MES 生产官 | 1.2.0 | 7 | 5 | 4 |

数量来自当前实现及授权交集，不是WorkBuddy或MCP协议上限。MES计划预览仍需计划准备授权。原工具名、三个OAuth资源、作者和原市场资产ID保持兼容，专家各自引用本应用连接器，不新增独立Skill投稿。

CRM客户、订单、线索、商机、逐客跟进、服务计划/风险及运营任务反馈已由D-081覆盖。本批补crm_workbench和crm_sales_pools：本人工作台明确complete=false、domains与limits，有限展示不当企业全量；销售池配置按crm.sales.manage授权。逐客户运营反馈与销售跟进记录来源不同，不能相互替代。

ERP补erp_customers、erp_opportunities、erp_opportunity_follow_ups、erp_purchase_detail、erp_sales_list、erp_sales_detail、erp_inventory_balances、erp_stock_movements、erp_accounts。沿用业务Service的角色、归属和租户权限；采购列表也改为字段白名单。客户电话/地址、单据交付地址、付款凭据不返回，财务查询按财务权限开放。账款用十进制计算未结额，ERP金额单位CNY；商机预计、合同、应收应付、已结/未结分别解释，库存企业汇总和仓库数量分开。

MES原mes_list_records补reports类型、非物料status、reports.orderId与orders.planId筛选；mes_inspect补material/report详情。工具schema按岗位减少类型，操作员仅本人报工或获派工单。详情关联报工/工单输出最多50条，明确total/truncated及nextQuery；继续查询使用数据库分页的列表，不把截断当全量，不重复相加详情和列表。

## Agent与Skill

三个专家分别增加“销售履约与账款核对”“销售跟进与客户服务”“报工与审核追踪”，各四个Skill，共12个。补实时查询路由、ID/分页/范围、业务口径、异常处理和交付样例，保留离线只读计算脚本。

版本单一来源integrations/workbuddy/package-versions.json。工具名从本仓库服务定义同步生成，包校验核对实际名字，防止工具已增加而Skill清单遗漏。完整目录见integrations/workbuddy/contracts/tool-catalog.json及business-tools.md。

写入仍为准备三种业务草稿→用户在平台确认→真实回执；查询不直接群发、发券、收付款、审批、报工或派工。应用内AI保持提示模式，没有实际调用模型。

## 验证与发布

发布源为D-081实际生产源码，仅覆盖8份API/测试文件；没有修改数据库结构、前端、身份规则或模型配置。

隔离构建及回归通过：新增44项断言覆盖ERP租户/归属隔离、字段过滤、账款口径、MES分页/截断/本人范围和CRM受限业务域；官方SDK三应用160项断言/74次HTTP；CRM逐客流程37项断言/50次HTTP；资料整理提示模式29项断言/15次HTTP。六包406项结构、依赖、工具清单及合成计算校验通过。

API/Worker发布版本20261027-connectors-r2；前端沿用D-081。生产数据库、环境和会话已备份并异地校验，快照在隔离pgvector库恢复，确认没有新增迁移，五类业务计数保持一致。正式HTTPS官方SDK162项断言/74次HTTP通过，覆盖新增查询、三应用授权/确认/回执及撤销，合成企业、用户、业务记录、授权和Token已清理。随后补齐MES同时间记录的ID稳定排序，并用55条同时间报工跨三页去重复验，最终为44项断言。正式HTTPS162项验证在r1完成；最终r2仅修正列表排序，无协议/权限变化；生产隔离合成租户再次通过44项业务Reader检查（含跨页去重），测试记录已清理。镜像571份源/构建文件摘要及原有286条会话再次核验。

记录位置：var/operations/20261027-connector-update。线上合成测试与包校验不等于WorkBuddy原生客户端自然语言验收、市场审核或真实客户接受度；本批没有提交市场。

r2可回退到20261027-connectors-r1；整批可回退到20261027-crm-growth-r1镜像及原release目录，无需覆盖数据库；本批未执行生产回退。生产备份含私有数据，不能进入GitHub或WorkBuddy包。
