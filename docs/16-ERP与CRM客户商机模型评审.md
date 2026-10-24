# ERP 与 CRM 客户/商机模型专项评审

> 文档属性：参考评审。旧应用/原始规划用于追溯，当前决定与新电商CRM按对应索引。状态入口：[47](47-项目现状与文档维护.md)；公共UI：[ui/00](ui/00-公共UI规范.md)。

状态：2026-09-29 **开发前证据评审**。仅阅读旧项目 PRD、Prisma 模型和现有能力盘点，未核对真实客户数据或重新运行旧系统。本文决定新 ERP 首期的安全建模边界；Q-003 的实际跨应用同一性仍须在 CRM 联动前结合真实客户样本关闭。

## 证据对照

| 对象 | 旧 ERP 当前模型 | 旧 CRM 当前模型 | 对新项目的含义 |
| --- | --- | --- | --- |
| Customer | 租户内 `code` 唯一；名称、内嵌联系人姓名/电话、销售负责人、启停；关联商机和销售合同。 | 可选 `registrationId`、`normalizedName`、行业/地区、销售和服务负责人、`orgUnitId`、来源线索、版本/软删除；关联联系人、商机和服务。 | 可能指向同一企业，但主键、识别依据、字段所有者与生命周期不同；名称不能作为自动合并键。 |
| Opportunity | 关联 ERP Customer；名称、阶段、预计金额、负责人；可被销售合同引用。 | 关联 CRM Customer；有参与人、类型、概率、币种、预计/实际签约与金额、输单原因、下一步行动、版本/软删除。 | ERP 只需当前轻量流程；CRM 后续销售管道不是把 ERP 行直接加字段就能证明同一对象。 |
| Contact | Customer 上的联系人姓名/电话字段。 | 独立 Contact，隶属 CRM Customer，有职务、联系方式、偏好、版本/软删除。 | ERP 首期保留现有交易输入；不预建统一联系人表或默默迁移到 CRM。 |
| Supplier | 独立 ERP Supplier，有编码、名称、联系人、启停和采购引用。 | 无对应采购供应商模型。 | 不因供应商和客户都可能是企业而预建 `Party + Role`。 |
| 内部 Organization | 旧 ERP 只有用户角色和业务对象负责人。 | `OrgUnit` 树、`Membership` 与组织/角色关系；线索、客户和商机含组织范围。 | 内部组织单元归平台，和外部客户/供应商主体分开。平台应有稳定组织关系，CRM 再实现团队业务规则。 |

证据：[ERP Prisma 模型](../../existing-business-apps/apps/electronics-erp/backend/prisma/schema.prisma)、[ERP 产品需求](../../existing-business-apps/apps/electronics-erp/docs/01-产品需求.md)、[CRM Prisma 模型](../../existing-business-apps/apps/sales360-crm/backend/prisma/schema.prisma)、[CRM 产品需求](../../existing-business-apps/apps/sales360-crm/docs/02-产品需求.md)。旧模型只说明已实现的语义，不证明两套历史数据可直接合并。

## ERP 开发前的结论

1. ERP 首期由 ERP 模块拥有 Customer、Opportunity、Supplier 及其交易规则，完成 [D-008](00-文档索引与决策记录.md#已确认的决策) 要求的全部当前功能。每个对象使用租户内稳定、不可由名称推导的 ID；交易单据保留必要快照与历史引用。客户编码只在 ERP 租户内唯一，不能当成未来 CRM 的全局身份。
2. ERP Customer 和 Opportunity 的应用服务预留**公开查询/命令边界**及未来显式关联能力，不预建无消费者的共享 Party、统一商机或同步任务。外部注册标识、规范化名称只在实际客户数据与去重规则明确时进入实现，不能凭旧字段直接合并。
3. CRM 建设前用真实业务样本比较“同一企业/商机”的识别规则、拥有者、生命周期、权限及从线索转化到合同的过程。若确属同一对象，可引用 ERP ID 或按 [14 共享准入规则](14-共享能力准入与模块公开契约.md) 提出提升方案；若语义不同，保留各自 ID 和显式映射。任何方案都要覆盖历史引用、数据导入、冲突处理和回退。

**Q-003 仍未关闭**：未来 CRM 与 ERP 是否共用同一客户/商机身份，需要真实客户数据和跨应用使用场景。它不阻挡平台 M1/M2 或 ERP 自有模型，但阻挡自动关联、同一 ID 假设及共享模块提升。若首客 ERP 上线时必须与新 CRM 同时协作，应在 ERP Customer/Opportunity 迁移前提前关闭 Q-003。
