# 统一 CRM：销售、客户运营与服务

2026-10-26 **D-078 已发布与退役**：统一CRM已发布生产；旧三应用Cloudflare入口和旧服务器运行资源已撤下，GitHub三个仓库按用户后续要求保留。最终数据库、源码配置已备份并在隔离环境恢复核验；旧真实数据未导入新CRM。发布、恢复和证据见[平台78](../78-统一CRM上线与旧三应用退役.md)。本决定覆盖此前“本轮未发布/旧服务继续运行”的状态，保留源码、配置、数据和独立恢复能力。

2026-10-26。用户授权将旧 Sales360 CRM 的有用功能整合进新 CRM，后续只使用新系统。D-077 覆盖此前“仅电商 CRM”的产品范围；旧系统在迁移核验和用户验收前保留，不在本轮删除、停服或自动迁入真实数据。

## 产品与领域

- 一个 CRM 应用，共用平台身份、组织、岗位、UI 与审计。保留客户导入、订单指标、分群和运营任务；增加销售工作台、线索、商机、逐客跟进、企业联系人、服务计划/任务与风险。
- 客户档案支持个人/企业，销售负责人和服务负责人独立。渠道身份继续作为来源依据；手动建档也指定组织与来源渠道，不按姓名/电话静默合并。
- 线索：录入→分配/轮转→接受→有效→申请转化→主管审核→事务性创建/关联客户和商机。退回/无效、驳回均需理由；重复请求返回同一回执。
- 商机：需求发现→方案沟通→商务谈判→赢单/输单；参与人、币种、预计日期/金额、概率、下一步行动和实际签约结果明确记录。终态不回退。
- 跟进记录按客户/线索/商机逐条保存；下一次跟进形成个人待办，完成或更正保留历史。人工记录不证明外部消息已送达。
- 服务：客户服务负责人→服务计划→任务指派→提交结果→主管审核；风险登记/关闭留解决说明。续约以关联客户的新商机记录；不伪造客户健康评分。
- ERP 继续拥有交易客户、现有商机及合同、履约、财务。新 CRM 商机不自动生成 ERP 数据、不直接访问 ERP 表。Q-003 仍限制跨应用自动关联；未来按显式映射和公开命令接合同，不能仅按名称匹配。

## 权限与数据

沿用组织×渠道的配对范围，新增 sales（销售）和 csm（客户服务）岗位；不借用 ERP 全局岗位。销售处理本人负责/参与的销售记录，CSM处理本人服务记录；manager 在自身配对范围内管理/审核。只读和分析岗位不自动获得销售/服务写权限。新旧客户都受现有敏感权限约束。

联系人原文加密，读取需 crm.customer.contact.read 并审计，列表仅脱敏。客户归属转移为管理动作，核对目标成员有效岗位及当前配对范围。关键命令须 version/requestKey、服务端状态校验、事务与审计。AI保持D-076提示模式，无模型调用、自动营销或新市场投稿。

## 迁移与替换门槛

旧数据先只读导出，核对租户、组织、成员、来源渠道和稳定 ID 映射；列出客户/联系人/线索/商机/跟进/待办/服务/风险的数量、金额币种、状态、时间和关联完整性。未知成员、重复候选和无效引用必须解决，不能默认挂管理员或丢弃历史。

真实导入先备份，在隔离环境演练、逐对象核对、测试重复导入和恢复；保留旧 ID 映射及批次回执。用户确认新系统完整流程及真实迁移结果后再冻结旧系统写入、最终增量核对与切换。开发完成不等于旧系统已退役。

## 验收

隔离数据库验证：新 CRM 单独启用、线索查重/轮转/审核转化与重试、客户联系人/归属、商机终态、跟进待办、服务审核/风险、跨租户/组织/渠道/归属、撤权、版本冲突、持久化；既有 CRM 导入/指标/分群/运营任务回归。浏览器核验桌面和窄屏，结果与发布状态另记。

## 新增接口

统一前缀 `/api/v1/tenants/:tenantKey/apps/crm`；所有写入携带UUID requestKey，编辑/状态变更另带正整数 version。403为无操作权限，404为对象不可见，409为状态/版本/重复候选冲突。新增接口不绕过邮箱登录或原有应用授权。

| 路径 | 操作 |
| --- | --- |
| GET /workbench | 当前授权范围的待处理线索、个人跟进/服务待办和销售阶段/分币种金额 |
| GET/POST /leads，GET/PATCH /leads/:id | 列表、录入、详情、编辑；联系方式仅脱敏 |
| POST /leads/duplicate-candidates，GET /leads/:id/contact | 当前可见范围候选；独立敏感授权后读取明文 |
| POST /leads/:id/actions | assign/accept/return/invalidate/qualify/request_conversion/approve/reject/convert |
| GET/POST /sales-pools | 有权主管维护指定组织/渠道的轮转成员；分配时跳过已失去权限成员 |
| POST /customers，PATCH /customers/:id/profile | 手动档案/来源身份、企业类型与行业/地区/统一标识 |
| POST /customers/:id/assignment | 销售与服务负责人、交接原因；现有商机/服务任务负责人独立保留，需逐项交接 |
| GET/POST /customers/:id/business-contacts，GET .../reveal | 企业独立联系人；新增/带id和version更正，明文读取单独审计 |
| GET/POST /opportunities，GET/PATCH /opportunities/:id | 商机列表、详情、新建/编辑；客户/渠道不可直接改绑 |
| POST /opportunities/:id/stage | 相邻阶段推进，赢单实际金额/时间，输单原因；终态不回退 |
| GET/POST /follow-ups，POST /follow-ups/:id/complete | 逐对象记录、追加更正、个人跟进待办；更正保留原文并关闭原待办 |
| GET/POST /service-plans，POST /service-plans/:id/actions | 服务期间/负责人/目标；完成须全部任务审核通过，取消终止未完成任务 |
| POST /service-plans/:id/tasks，POST /service-tasks/:id/actions | 指派/提交/退回/重提/审核；审核人与提交人分离 |
| GET/POST /service-risks，POST /service-risks/:id/close | 风险登记、程度、处理负责人和解决说明 |
| POST /service-renewals | 服务负责人将续约商机交给有权销售，不自动创建ERP合同 |

销售阶段 discovery→solution→negotiation→won；任一未终结阶段允许lost。线索创建后先分配/接受；所有转化统一经过主管审核。采用规范化名称或加密键HMAC生成的联系方式摘要查重；重复候选需明确保留原因，不静默合并客户。企业统一标识在CRM租户内唯一。

看板展示范围/时间和分币种金额。个人跟进待办最多展示100条，服务待办20条；卡片为展示条数，不能声称完整队列总量。客户归属交接不覆盖仍在执行的商机/服务任务负责人，界面明确提示需分别交接。

## 离线迁移预检工具

`apps/api/scripts/crm-legacy-preflight.cjs` 仅读取文件，不连接数据库、不写入新旧业务数据。输入为私有导出快照与显式映射文件：

```json
{
  "format": "sales360-crm-export-v1",
  "tenantId": "旧租户ID",
  "exportedAt": "ISO时间",
  "tables": {
    "Lead": [], "Customer": [], "Contact": [], "Opportunity": [],
    "OpportunityParticipant": [], "FollowUp": [], "Task": [],
    "ServicePlan": [], "ServiceTask": [], "ServiceRisk": [],
    "LeadAssignment": [], "ConversionRequest": [],
    "SalesPool": [], "SalesPoolMember": [], "AuditLog": []
  }
}
```

每项为旧数据库同名模型的原始记录数组，含软删除记录和原ID；不导出密码、会话或第三方凭据。缺表不能用空数组冒充零记录，先核对旧库计数。OrgUnit/User由显式映射承接，不复制旧身份体系。

```json
{
  "sourceTenantId": "旧租户ID", "targetTenantId": "新租户ID",
  "channelId": "新CRM专用来源渠道ID",
  "memberships": {"旧用户ID": "新平台成员ID"},
  "orgUnits": {"旧组织ID": "新平台组织ID"}
}
```

在 `apps/api` 目录执行：

```bash
node scripts/crm-legacy-preflight.cjs /私有路径/snapshot.json /私有路径/mapping.json /私有路径/report.json
```

检查缺表、跨租户、重复ID/客户标识、同名候选、无映射人员/组织及孤立引用，输出计数/状态和快照SHA256；报告默认600权限且拒绝覆盖已有文件。`readyForRehearsal=true` 仅表示可开始隔离演练，不证明目标映射存在、导入成功或可停旧系统。真正迁入旧业务历史需要另做批次导入、逐对象核对与恢复演练；本轮未执行真实迁移。

## 数据库与回退

本批迁移 `20261026090000_crm_unified_sales_service` 为增量新增字段/表；`20261026110000_crm_engagement_indexes` 补齐归属、查重和服务任务关联索引。两者保留原客户与交易/运营数据。先在独立QA从既有全部迁移重建并核对；生产发布前仍需现场备份及迁移前后计数检查。回退优先退应用版本，保留新增表及本批新写入；不能用DROP表脚本抹掉新业务记录来“回滚”。本轮不操作生产数据库或旧CRM数据库。
