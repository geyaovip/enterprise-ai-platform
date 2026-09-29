# Construction AI Suite --- 五大建筑行业应用产品与实施规格

> **Future Product Specification — NOT CURRENT IMPLEMENTATION PLAN**
> 当前实施顺序：**Platform → 新 ERP → 新 CRM → 新 MES → Architecture Review → Construction Suite**。本文件是未来产品输入，不是当前开发任务；进入建筑阶段前须以真实客户需求重新确认范围、应用顺序及平台实际已交付能力。[当前启动基线](docs/15-开发启动基线.md)和[决策记录](docs/00-文档索引与决策记录.md)优先于下文的旧执行说明。下文提到的 File、Knowledge、Integration 或 `construction/shared` 均不表示已实现或首期必建。

> **用途**：本文件是 `Enterprise AI Application Platform V0.1`
> 完成后的建筑行业应用实施规格。\
> **目标读者**：Codex、产品、研发、实施团队。\
> **前置条件**：共享 Enterprise AI Platform 已具备 Tenant / Identity /
> Organization / Permission / File / Knowledge / AI Gateway / Model
> Gateway / Integration / Audit 等基础能力。\
> **核心原则**：以下五个应用均为 **Code-native Business
> Apps**，不是通过通用 APaaS Schema 动态生成的应用。Codex
> 应复用平台能力，并在 Construction Industry Layer
> 内沉淀稳定的建筑行业共享模型与能力。

------------------------------------------------------------------------

# 0. 给 Codex 的执行说明

在平台基础能力完成后，不要一次性并行开发五个应用。

推荐顺序：

``` text
1. AI 项目经营
      ↓
2. AI 商务经营
      ↓
3. AI 项目总控
      ↓
4. AI 咨询作业平台
      ↓
5. AI Design Operations
```

每增加一个应用：

1.  先复用 Platform Core。
2.  检查 Construction Shared 中已有能力。
3.  不得复制 Tenant / Identity / Permission / AI / Knowledge / File /
    Audit。
4.  新业务能力优先留在当前 App。
5.  两个或以上应用重复出现时再评估是否提升到 `construction/shared`。
6.  不要为了五个应用提前设计万能业务模型。
7.  所有 AI 写操作必须通过业务 Service + Permission + Audit。
8.  所有应用必须使用统一 Admin Console。
9.  所有应用必须支持 Tenant Scope。
10. 五个应用最终可以独立启用，但属于同一个 Construction AI Suite。

------------------------------------------------------------------------

# 1. Construction AI Suite 产品定位

建筑行业产品不是一套"大而全 ERP"。

整体定位：

> **面向建筑工程产业链不同角色的 AI 原生业务应用套件。**

核心价值不是替代所有已有 ERP / OA / BIM / 财务软件，而是：

``` text
连接业务数据
+
理解工程文件
+
发现经营事件
+
辅助专业判断
+
推动业务动作
+
形成闭环
```

五个应用分别服务五类核心客户。

  ------------------------------------------------------------------------------------------------
  应用                    主要客户                核心问题
  ----------------------- ----------------------- ------------------------------------------------
  AI 项目经营             施工总包                每个项目到底赚不赚钱、哪里正在失控

  AI 商务经营             专业分包                哪些钱该拿但还没拿、哪里正在漏钱

  AI 项目总控             建设单位/业主           多项目投资、进度、风险是否受控

  AI 咨询作业平台         造价/工程咨询机构       如何让专业人员更快完成高质量咨询工作

  AI Design Operations    设计院                  如何控制设计任务、版本、审查、变更、工时和交付
  ------------------------------------------------------------------------------------------------

------------------------------------------------------------------------

# 2. 五个应用之间的关系

``` text
                     Construction AI Suite
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
      施工企业              建设单位             专业服务机构
          │                   │                   │
    ┌─────┴─────┐             │             ┌─────┴─────┐
    │           │             │             │           │
AI项目经营   AI商务经营    AI项目总控    AI咨询作业   AI设计运营
   总包        分包          业主         咨询机构      设计院
```

它们共享平台，但不是同一个业务系统的五个菜单。

每个 Tenant 可以按需要启用：

``` text
Tenant A（总包）
├── AI项目经营
└── AI商务经营（可选）

Tenant B（专业分包）
└── AI商务经营

Tenant C（开发商）
└── AI项目总控

Tenant D（造价咨询）
└── AI咨询作业平台

Tenant E（设计院）
└── AI Design Operations
```

大型集团可以同时启用多个应用。

------------------------------------------------------------------------

# 3. Construction Shared Layer

随着五个应用逐步开发，以下概念可能成为 Construction Shared。

注意：**这是候选集合，不要求第一天全部抽象。**

``` text
industries/construction/shared/

├── project/
├── organization-party/
├── contract/
├── document/
├── project-member/
├── counterparty/
├── currency-money/
├── location/
├── milestone/
├── issue/
├── risk/
└── construction-ai-context/
```

可能跨应用共享的行业概念：

``` text
Project
ProjectParty
Contract
Counterparty
Document
ProjectMember
Milestone
Issue
Risk
Money
```

而以下对象应优先留在具体 App：

``` text
ChangeEvent
Variation
Opportunity
Bid
Settlement
Receivable
ConsultingAssignment
ReviewFinding
DrawingPackage
DesignTask
```

只有真实重复后才提升。

------------------------------------------------------------------------

# 4. 统一 Construction AI Context

五个应用的 AI 都应该能够理解统一的工程上下文。

建议：

``` ts
type ConstructionAIContext = {
  tenantId: string
  userId: string
  appId: string

  projectId?: string
  contractId?: string

  organizationId?: string
  roleIds: string[]

  knowledgeScopes: string[]
  permissions: string[]
}
```

未来可扩展：

``` text
project phase
discipline
counterparty
contract package
WBS
cost code
```

不要一次全部实现。

------------------------------------------------------------------------

# 5. Application 1 --- AI 项目经营

# 5.1 产品定位

目标客户：

> 施工总承包企业 / EPC 总包 / 大型施工企业项目部及公司经营管理部门。

核心问题：

> **每个项目到底赚不赚钱？利润正在从哪里流失？哪些风险需要现在处理？**

产品不是完整施工 ERP。

重点围绕：

``` text
合同
变更
签证
成本影响
回款影响
风险
项目经营状态
```

------------------------------------------------------------------------

# 5.2 主要角色

``` text
公司经营负责人
公司商务负责人
项目经理
项目商务经理
项目成本负责人
项目成员
公司领导
```

------------------------------------------------------------------------

# 5.3 核心导航

``` text
首页

项目

合同

变更
├── 潜在变更
├── 已确认变更
└── 变更台账

签证/索赔
├── 草稿
├── 内部审核
├── 已提交
├── 审核中
└── 已确认

经营
├── 合同额
├── 变更额
├── 确认额
├── 预计影响
└── 回款影响

风险

文档

任务

AI
```

V1 可以逐步开放，不要求一次完成全部页面。

------------------------------------------------------------------------

# 5.4 核心业务对象

``` text
Project
Contract
ContractClause
Document

ChangeEvent
ChangeEvidence

Variation
Claim

Risk
Issue

ProjectTask
```

后续可能加入：

``` text
Budget
CostItem
Payment
Forecast
```

不要在第一版本强制实现。

------------------------------------------------------------------------

# 5.5 核心业务闭环

## 闭环 A --- 合同风险

``` text
上传合同
 ↓
AI解析
 ↓
提取关键条款
 ↓
识别通知期限 / 变更条款 / 索赔条件
 ↓
生成风险提示
 ↓
进入项目经营上下文
```

## 闭环 B --- 潜在变更

``` text
会议纪要 / 指令 / 邮件 / 文件
 ↓
AI识别潜在变更
 ↓
提供证据
 ↓
人工确认
 ↓
ChangeEvent
 ↓
跟踪处理
```

## 闭环 C --- 签证

``` text
ChangeEvent
 ↓
AI整理事实
 ↓
匹配合同条款
 ↓
生成签证/通知草稿
 ↓
内部审核
 ↓
提交
 ↓
跟踪甲方确认
 ↓
更新项目经营状态
```

------------------------------------------------------------------------

# 5.6 AI 能力

第一优先级：

``` text
AI合同分析
AI潜在变更识别
AI签证/通知起草
AI风险摘要
```

第二优先级：

``` text
AI遗漏签证检查
AI通知期限提醒
AI变更证据整理
AI项目经营日报/周报
AI项目风险问答
```

未来：

``` text
预测毛利
现金流风险
索赔机会识别
经营异常检测
```

------------------------------------------------------------------------

# 5.7 首页核心指标

``` text
项目合同额
已识别变更金额
已提交签证金额
已确认金额
待确认金额
潜在未申报金额
高风险事项
即将到期通知
```

------------------------------------------------------------------------

# 5.8 关键 AI 问题示例

``` text
这个项目最近有哪些可能漏掉的签证？

哪些变更已经发生但还没有正式通知甲方？

本月有哪些通知期限快到了？

目前哪些签证金额最大但还没有确认？

根据合同，这个事件是否可能构成变更？

帮我整理本周项目经营风险。
```

------------------------------------------------------------------------

# 6. Application 2 --- AI 商务经营

# 6.1 产品定位

目标客户：

> 专业分包企业、机电、幕墙、装饰、钢结构、消防、设备安装等专业承包商。

核心目标：

> **别漏钱。**

业务主线：

``` text
机会
→ 投标
→ 合同
→ 施工商务
→ 变更
→ 进度款
→ 结算
→ 应收
→ 回款
```

产品关注：

> 从拿项目开始，到最后把钱收回来。

------------------------------------------------------------------------

# 6.2 主要角色

``` text
老板 / 总经理
经营负责人
商务负责人
投标经理
项目经理
项目商务经理
结算人员
财务/应收人员
```

------------------------------------------------------------------------

# 6.3 核心导航

``` text
首页

商机
投标

项目

合同

变更签证

进度款

结算

应收回款

风险

文档

任务

AI
```

------------------------------------------------------------------------

# 6.4 核心业务对象

``` text
Opportunity
Customer

Tender
Bid

Project
Contract

ChangeEvent
Variation

ProgressClaim
PaymentCertificate

Settlement

Receivable
Receipt

CommercialRisk
Task
Document
```

------------------------------------------------------------------------

# 6.5 核心业务闭环

## 闭环 A --- 商机到合同

``` text
商机
 ↓
招标文件
 ↓
AI读取招标要求
 ↓
投标风险/缺失项
 ↓
Bid
 ↓
中标
 ↓
Contract
```

## 闭环 B --- 施工中别漏签证

``` text
项目资料持续进入
 ↓
AI发现潜在变更
 ↓
商务人员确认
 ↓
Variation
 ↓
跟踪申报
 ↓
跟踪确认
```

## 闭环 C --- 进度款

``` text
本期完成工作
 ↓
Progress Claim
 ↓
申报
 ↓
甲方/总包审核
 ↓
Payment Certificate
 ↓
形成应收
```

## 闭环 D --- 结算回款

``` text
完工
 ↓
AI整理合同 + 变更 + 已确认金额
 ↓
结算准备
 ↓
Settlement
 ↓
确认结算
 ↓
Receivable
 ↓
Receipt
```

------------------------------------------------------------------------

# 6.6 AI 能力

第一优先级：

``` text
招标文件分析
合同风险分析
潜在变更识别
签证草稿生成
结算资料整理
应收风险提醒
```

第二优先级：

``` text
投标检查
商务漏项检查
未申报变更识别
未确认签证追踪
结算差异分析
回款优先级分析
```

------------------------------------------------------------------------

# 6.7 首页核心指标

``` text
在手合同额
累计产值
累计申报
累计确认
累计回款
未确认签证
未结算金额
应收账款
逾期应收
潜在漏收金额
```

------------------------------------------------------------------------

# 6.8 关键 AI 问题示例

``` text
哪些项目还有钱没有申报？

有哪些签证已经发生但商务还没处理？

这个项目结算还有哪些资料缺失？

哪些应收已经逾期？

这个月最应该追哪几笔款？

这份招标文件有哪些商务风险？
```

------------------------------------------------------------------------

# 7. Application 3 --- AI 项目总控

# 7.1 产品定位

目标客户：

> 建设单位、地产开发商、政府投资平台、产业园区业主、基础设施投资建设单位。

核心问题：

> **我的项目群现在是否在投资、进度、合同和风险范围内受控？**

重点不是替代项目管理系统，而是建立：

``` text
Portfolio
+
Project
+
Investment
+
Schedule
+
Contract
+
Change
+
Risk
+
Decision
```

的管理视图。

------------------------------------------------------------------------

# 7.2 主要角色

``` text
集团领导
投资负责人
工程负责人
成本负责人
项目负责人
合同负责人
项目管理人员
```

------------------------------------------------------------------------

# 7.3 核心导航

``` text
总览

项目群

项目

投资

进度

合同

变更

风险

决策事项

文档

AI
```

------------------------------------------------------------------------

# 7.4 核心业务对象

``` text
Portfolio
Project

InvestmentPlan
ProjectBudget
Forecast

Milestone
ScheduleSnapshot

Contract
ChangeRequest

Risk
Issue

DecisionItem

Document
Report
```

------------------------------------------------------------------------

# 7.5 核心业务闭环

## 闭环 A --- 项目群监控

``` text
多个项目数据
 ↓
统一指标
 ↓
AI发现异常
 ↓
风险排序
 ↓
管理层关注
```

## 闭环 B --- 投资变化

``` text
原始投资计划
 ↓
合同
 ↓
变更
 ↓
预测
 ↓
AI分析偏差
 ↓
投资风险
```

## 闭环 C --- 进度风险

``` text
计划里程碑
 ↓
实际进展
 ↓
延期信号
 ↓
AI解释原因
 ↓
风险/决策事项
```

## 闭环 D --- 管理层决策

``` text
风险/异常
 ↓
形成 DecisionItem
 ↓
指定责任人
 ↓
跟踪
 ↓
关闭
```

------------------------------------------------------------------------

# 7.6 AI 能力

``` text
AI项目群经营摘要
AI投资偏差分析
AI进度风险识别
AI变更影响分析
AI合同风险摘要
AI管理层周报/月报
AI决策事项提取
AI跨项目对比
```

未来：

``` text
投资完成预测
竣工日期预测
项目风险评分
```

预测类必须基于足够数据，不得用 LLM 凭空预测。

------------------------------------------------------------------------

# 7.7 首页核心指标

``` text
项目总数
总投资
已签合同额
累计支付
预测最终投资
投资偏差
延期项目
重大变更
重大风险
待决策事项
```

------------------------------------------------------------------------

# 7.8 关键 AI 问题示例

``` text
哪些项目本月风险明显上升？

哪些项目预计会突破投资控制目标？

集团目前最大的十个变更是什么？

哪些项目关键里程碑已经有延期迹象？

帮我生成本周项目群管理摘要。

这个项目为什么预测投资增加了？
```

------------------------------------------------------------------------

# 8. Application 4 --- AI 咨询作业平台

# 8.1 产品定位

目标客户：

> 工程咨询、造价咨询、全过程咨询、项目管理咨询机构。

核心目标：

> **AI 做重复的信息处理和初步专业分析，人做最终专业判断。**

不是简单"知识库聊天"。

产品应该成为：

> 咨询人员的 AI 作业工作台。

------------------------------------------------------------------------

# 8.2 主要角色

``` text
咨询公司负责人
项目负责人
专业负责人
造价工程师
咨询工程师
审核人
项目助理
```

------------------------------------------------------------------------

# 8.3 核心导航

``` text
工作台

咨询项目

任务

资料

分析

成果

复核

知识

客户

AI
```

------------------------------------------------------------------------

# 8.4 核心业务对象

``` text
ConsultingProject

Assignment
Task

SourceDocument

AnalysisCase
Finding

Deliverable
DeliverableVersion

Review
ReviewComment

Client
KnowledgeCase
```

不同咨询类型未来通过具体模块扩展，不要 V1 建万能咨询 Schema。

------------------------------------------------------------------------

# 8.5 核心业务闭环

## 闭环 A --- 接收资料

``` text
客户资料
 ↓
AI分类
 ↓
识别缺失资料
 ↓
项目知识空间
```

## 闭环 B --- 专业分析

``` text
任务
 ↓
资料 + 企业知识 + 历史案例
 ↓
AI读取/比较/检查
 ↓
Finding
 ↓
咨询人员判断
```

## 闭环 C --- 成果编制

``` text
Findings
 ↓
AI生成初稿
 ↓
专业人员编辑
 ↓
Deliverable
 ↓
Review
 ↓
Final
```

## 闭环 D --- 经验沉淀

``` text
项目完成
 ↓
高价值案例
 ↓
KnowledgeCase
 ↓
未来项目复用
```

------------------------------------------------------------------------

# 8.6 AI 能力

第一优先级：

``` text
资料分类
资料缺失检查
文档摘要
多版本比较
条款/数据核对
问题发现
成果初稿生成
复核辅助
历史案例检索
```

后续可针对造价咨询加入：

``` text
清单对比
价格异常检查
变更资料检查
结算资料检查
```

注意：

> AI 输出应定位为辅助分析，最终专业结论由具备相应职责的人员确认。

------------------------------------------------------------------------

# 8.7 首页核心指标

``` text
进行中项目
我的任务
即将到期
待复核成果
资料缺失
AI发现问题
项目进度
```

------------------------------------------------------------------------

# 8.8 关键 AI 问题示例

``` text
这个项目还缺哪些资料？

比较这两个版本，主要变化是什么？

这份结算资料有哪些明显问题？

帮我整理这次审核发现。

以前有没有类似项目案例？

根据当前分析结果生成成果初稿。
```

------------------------------------------------------------------------

# 9. Application 5 --- AI Design Operations

# 9.1 产品定位

目标客户：

> 建筑设计院、工程设计公司、EPC 设计团队。

第一阶段不做：

``` text
AI自动建筑设计
CAD生成
BIM几何生成
```

重点做设计生产运营：

``` text
Project
Task
Discipline
Drawing
Version
Review
Change
Man-hour
Delivery
```

核心问题：

> **项目设计任务是否按计划推进？版本是否清晰？审查问题是否关闭？变更是否失控？工时和交付是否可控？**

------------------------------------------------------------------------

# 9.2 主要角色

``` text
院领导
项目负责人
设计经理
专业负责人
设计师
校核人
审核人
项目助理
```

------------------------------------------------------------------------

# 9.3 核心导航

``` text
首页

项目

设计任务

专业

图纸/文件

审查

设计变更

交付

工时

风险

知识

AI
```

------------------------------------------------------------------------

# 9.4 核心业务对象

``` text
DesignProject

Discipline

DesignTask

DrawingPackage
Drawing
DrawingVersion

Review
ReviewComment

DesignChange

Deliverable
DeliveryPackage

Timesheet
ManHourBudget

DesignRisk
Document
```

------------------------------------------------------------------------

# 9.5 核心业务闭环

## 闭环 A --- 设计任务

``` text
项目
 ↓
阶段
 ↓
专业
 ↓
DesignTask
 ↓
责任人
 ↓
计划日期
 ↓
完成
```

## 闭环 B --- 版本

``` text
Drawing
 ↓
Version
 ↓
校核
 ↓
审核
 ↓
发布
```

必须明确当前有效版本。

## 闭环 C --- 审查问题

``` text
Review
 ↓
ReviewComment
 ↓
责任人
 ↓
整改
 ↓
复核
 ↓
关闭
```

## 闭环 D --- 设计变更

``` text
外部条件/业主要求/专业协调
 ↓
DesignChange
 ↓
影响分析
 ↓
涉及图纸/专业
 ↓
任务更新
 ↓
重新交付
```

## 闭环 E --- 工时

``` text
ManHourBudget
 ↓
Task
 ↓
Timesheet
 ↓
实际工时
 ↓
偏差
 ↓
项目经营风险
```

------------------------------------------------------------------------

# 9.6 AI 能力

``` text
AI任务拆解建议
AI审查意见归类
AI重复问题识别
AI版本差异摘要
AI设计变更影响分析
AI会议纪要转任务
AI交付检查
AI项目风险摘要
AI历史项目经验检索
```

后续可以增加专业设计辅助，但必须作为独立能力逐步验证。

------------------------------------------------------------------------

# 9.7 首页核心指标

``` text
项目数量
本周到期任务
逾期任务
待校核
待审核
未关闭审查意见
设计变更
交付节点
工时偏差
高风险项目
```

------------------------------------------------------------------------

# 9.8 关键 AI 问题示例

``` text
哪些设计任务本周可能延期？

这次审查意见主要集中在哪些问题？

这个设计变更影响哪些专业和图纸？

当前最新有效图纸版本是什么？

有哪些审查问题反复出现？

这个项目工时为什么超预算？
```

------------------------------------------------------------------------

# 10. 五个应用的共享能力矩阵

  能力                  项目经营   商务经营   项目总控   咨询作业   设计运营
  ------------------- ---------- ---------- ---------- ---------- ----------
  Tenant / Identity            ✓          ✓          ✓          ✓          ✓
  Organization                 ✓          ✓          ✓          ✓          ✓
  Permission                   ✓          ✓          ✓          ✓          ✓
  File / Document              ✓          ✓          ✓          ✓          ✓
  Knowledge                    ✓          ✓          ✓          ✓          ✓
  AI Gateway                   ✓          ✓          ✓          ✓          ✓
  Model Gateway                ✓          ✓          ✓          ✓          ✓
  Audit                        ✓          ✓          ✓          ✓          ✓
  Integration                  ✓          ✓          ✓          ✓          ✓
  Project                      ✓          ✓          ✓          ✓          ✓
  Contract                     ✓          ✓          ✓       部分       部分
  Change                       ✓          ✓          ✓       部分          ✓
  Variation                    ✓          ✓          ✓         \-         \-
  Task                         ✓          ✓          ✓          ✓          ✓
  Risk                         ✓          ✓          ✓          ✓          ✓

此表只说明概念复用可能性，不代表必须共用同一张数据库表。

------------------------------------------------------------------------

# 11. 跨应用数据原则

同一个 Tenant 同时启用多个应用时，避免无控制复制同一业务事实。

例如：

``` text
Project
Contract
Organization
Counterparty
```

如果已经稳定成为 Construction Shared，可被多个应用引用。

但：

``` text
Project Operations Variation
Commercial Operations Variation
```

在没有证明语义完全一致前，不要强行合并。

跨 App 访问必须通过明确 Service/API，而不是直接 import 另一个 App
的内部实现。

禁止：

``` text
commercial_app
  → import project_operations.internal_service
```

允许：

``` text
commercial_app
  → construction shared service

或

commercial_app
  → project_operations public API
```

------------------------------------------------------------------------

# 12. 跨应用 AI

长期目标是：

> AI 能在权限允许的情况下理解一个企业跨应用的业务状态。

例如某总包同时启用：

``` text
AI项目经营
+
AI商务经营
```

用户问：

> 这个项目目前最大的经营风险是什么？

AI 可以通过统一 Tool Registry 查询：

``` text
Project
Contract
Variation
Payment
Receivable
Risk
Knowledge
```

但 Tool Registry 必须根据：

``` text
Tenant
User
Enabled Apps
Role
Permission
Project Scope
```

动态过滤。

------------------------------------------------------------------------

# 13. Knowledge 架构

五个应用共用 Knowledge Platform。

逻辑范围：

``` text
Platform Knowledge
        ↓
Tenant Knowledge
        ↓
Industry Knowledge
        ↓
App Knowledge
        ↓
Project Knowledge
```

建筑行业可以有 Construction Knowledge：

``` text
行业术语
企业允许使用的行业资料
标准知识
历史案例
```

注意外部标准、规范、商业数据库的版权和许可。

------------------------------------------------------------------------

# 14. App Enablement

统一使用：

``` text
App
TenantApp
```

建议 App Codes：

``` text
construction.project_operations
construction.commercial_operations
construction.owner_control
construction.consulting_workspace
construction.design_operations
```

TenantApp：

``` text
id
tenant_id
app_code
status
settings
enabled_at
```

应用代码存在不代表 Tenant 自动拥有访问权。

------------------------------------------------------------------------

# 15. Admin Console 中的五个应用

统一后台：

``` text
企业管理
├── 组织与成员
├── 登录与安全
├── AI
├── 企业知识
├── 集成
├── 应用
│   ├── AI项目经营
│   ├── AI商务经营
│   ├── AI项目总控
│   ├── AI咨询作业
│   └── AI设计运营
└── 审计
```

每个应用注册自己的 App Admin Module。

------------------------------------------------------------------------

# 16. 应用配置原则

只把真实需要客户修改的内容做成配置。

例如：

### 项目经营

``` text
签证金额阈值
提醒期限
AI检测开关
```

### 商务经营

``` text
应收逾期规则
商务提醒
投标检查项
```

### 项目总控

``` text
重大变更阈值
投资预警阈值
管理层报告周期
```

### 咨询作业

``` text
复核流程
成果模板
项目分类
```

### 设计运营

``` text
设计阶段
专业列表
校审规则
工时规则
```

如果所有客户都一样，先写默认代码，不要制造无意义设置页面。

------------------------------------------------------------------------

# 17. 通知与任务

五个应用可以共享 Platform Notification 和基础 Task 能力。

但具体业务 Task 由 App 决定。

统一通知渠道未来：

``` text
In-app
Email
WeCom
Feishu
DingTalk
```

V1 不要求全部实现。

------------------------------------------------------------------------

# 18. Integration Strategy

不同客户可能已有：

``` text
ERP
OA
财务系统
BIM平台
项目管理系统
企业网盘
邮件
企业微信
飞书
```

本套产品不要求替换所有系统。

原则：

> 能连接则连接，AI 和业务应用负责形成新的智能业务层。

每个 Connector 归 Platform Integration Runtime。

具体字段映射和业务同步规则可属于 Industry/App。

------------------------------------------------------------------------

# 19. 数据来源优先级

AI 回答业务问题时建议优先：

``` text
Current Business Object
        ↓
Current Project
        ↓
Current App
        ↓
Tenant Knowledge
        ↓
Construction Knowledge
        ↓
Platform Knowledge
```

避免公共知识覆盖企业事实。

------------------------------------------------------------------------

# 20. AI 输出的可追溯性

所有高价值 AI 结论应尽可能显示：

``` text
来源文档
来源页/段落
相关业务对象
相关合同条款
生成时间
AI状态
人工确认状态
```

尤其：

``` text
合同风险
潜在变更
签证依据
咨询 Finding
设计变更影响
```

不得只给"AI认为......"。

------------------------------------------------------------------------

# 21. Human-in-the-loop 原则

AI 可以：

``` text
读取
总结
比较
发现
建议
起草
分类
整理
提醒
```

涉及以下行为默认需要明确业务权限和适当人工确认：

``` text
确认重大变更
批准签证
确认结算
对外正式提交
修改关键合同数据
关闭重大风险
发布正式咨询成果
发布正式设计成果
```

------------------------------------------------------------------------

# 22. AI Risk Level

统一沿用平台：

``` text
L0 Read
L1 Draft
L2 Internal Write
L3 External Action
L4 Financial / Legal
```

五个应用不得自行绕开平台 AI Policy。

------------------------------------------------------------------------

# 23. 统一 UI 设计语言

五个应用使用同一个 UI Package。

共享：

``` text
App Shell
Navigation
Table
Form
Detail
Status
Timeline
Document Viewer
AI Insight Card
Evidence Card
Task
Risk
Dashboard Widget
```

但不要把 UI Package 演化成低代码页面 Builder。

------------------------------------------------------------------------

# 24. AI UX Pattern

推荐统一几个 AI 交互模式。

## Pattern A --- Inline AI Insight

业务页面直接显示：

``` text
AI发现：
该会议纪要可能涉及合同范围外新增工作。
```

## Pattern B --- AI Action

``` text
[AI分析合同]
[AI检查潜在变更]
[AI生成草稿]
```

## Pattern C --- Evidence

``` text
结论
依据
来源
置信度
人工状态
```

## Pattern D --- Contextual Chat

在 Project / Contract / Consulting Project 等上下文中：

``` text
Ask AI about this project
```

Chat 是补充入口，不是整个产品。

------------------------------------------------------------------------

# 25. 五个应用的优先开发顺序

## Phase 1 --- AI 项目经营

原因：

-   能验证合同 + 文档 + AI + Knowledge + Tool + Audit。
-   是平台第一条 Vertical Slice。
-   可沉淀 Project / Contract / Document 等基础建筑概念。

------------------------------------------------------------------------

## Phase 2 --- AI 商务经营

目的：

> 验证平台是否真的能快速生成第二个 App。

重点观察：

``` text
哪些模块真正可以复用？
哪些所谓共享模型其实不同？
```

不要强行复用。

------------------------------------------------------------------------

## Phase 3 --- AI 项目总控

目的：

> 从单项目/施工方视角扩展到业主多项目管理视角。

此阶段开始验证：

``` text
Portfolio
Cross-project AI
Executive Dashboard
```

------------------------------------------------------------------------

## Phase 4 --- AI 咨询作业平台

目的：

> 验证平台是否不仅能做"施工企业业务流程"，还能支持知识密集型专业工作。

重点验证：

``` text
Document-heavy workflow
Finding
Deliverable
Review
Knowledge reuse
```

------------------------------------------------------------------------

## Phase 5 --- AI Design Operations

目的：

> 验证设计生产场景，以及任务/版本/审查/变更/工时的复杂协作。

第一阶段不要进入 CAD/BIM authoring。

------------------------------------------------------------------------

# 26. 每个 App 的 Codex 开发模板

开始一个新应用前，Codex 必须先输出：

``` text
1. Product Scope
2. User Roles
3. Navigation
4. Domain Model
5. Permission Matrix
6. AI Capabilities
7. Knowledge Scope
8. Integrations
9. Admin Settings
10. E2E Journeys
11. Database Changes
12. API Changes
13. Shared Modules Reused
14. New App-only Modules
15. Candidate Shared Abstractions
16. Tests
17. Definition of Done
```

经确认后再编码。

------------------------------------------------------------------------

# 27. 每个 App 的目录模板

建议：

``` text
industries/construction/apps/<app-name>/

├── domain/
├── application/
├── infrastructure/
├── api/
├── ai/
│   ├── tools/
│   ├── capabilities/
│   └── prompts/
├── knowledge/
├── admin/
├── web/
└── tests/
```

实际可根据框架调整。

核心要求是边界清晰。

------------------------------------------------------------------------

# 28. AI Tool 命名建议

按领域命名。

例如项目经营：

``` text
construction.project.get
construction.contract.get
construction.contract.list_clauses

construction.change_event.search
construction.change_event.get
construction.change_event.create

construction.variation.get
construction.variation.create_draft
```

商务经营：

``` text
construction.opportunity.search
construction.bid.get

construction.progress_claim.get

construction.settlement.get

construction.receivable.search
```

设计运营：

``` text
construction.design_task.search
construction.drawing.get_current_version
construction.review.list_open_comments
construction.design_change.get
```

Tool 必须调用业务 Service。

------------------------------------------------------------------------

# 29. Prompt 管理原则

不要在 Controller/UI 中散落长 Prompt。

每个 AI Capability 有明确：

``` text
name
version
purpose
input schema
output schema
allowed tools
knowledge scope
risk level
prompt/instructions
evaluation cases
```

例如：

``` text
Capability:
construction.change_detection.v1
```

这样未来可以独立迭代。

------------------------------------------------------------------------

# 30. AI Evaluation

每个关键 AI Capability 必须建立最小 Evaluation Set。

例如：

### Contract Intelligence

测试：

``` text
是否识别变更条款
是否识别通知期限
是否引用正确来源
是否避免编造不存在条款
```

### Change Detection

测试：

``` text
真实变更是否发现
普通会议事项是否误报
证据是否正确
合同依据是否正确
```

### Consulting Review

测试：

``` text
Finding 是否有依据
是否遗漏关键问题
是否编造数据
```

不要只测试 API 是否返回 200。

------------------------------------------------------------------------

# 31. 业务审计

除 Platform Audit 外，重要对象保留业务 Timeline。

例如 Variation：

``` text
AI生成草稿
张三编辑
李四提交审核
王五批准
提交甲方
甲方确认
```

业务 Timeline 给用户看。

Platform Audit 给安全/运维/审计看。

两者概念不要混淆。

------------------------------------------------------------------------

# 32. Search

随着五个应用增加，需要统一搜索体验。

长期支持：

``` text
Project
Contract
Document
Variation
Settlement
Deliverable
Drawing
```

但搜索结果必须根据 Enabled App + Permission + Tenant Scope 过滤。

V1 可以先实现 App 内搜索。

------------------------------------------------------------------------

# 33. 跨应用首页

如果 Tenant 只启用一个 App：

直接进入该 App。

如果启用多个：

``` text
XX集团 AI 工作平台

我的应用

AI项目经营
AI商务经营
AI项目总控
...
```

未来可以增加企业级 AI 首页，但不要第一阶段做万能工作助手。

------------------------------------------------------------------------

# 34. App 独立性

每个 App 必须做到：

``` text
可独立启用
可独立隐藏
有独立权限
有独立导航
有独立业务模块
有独立 AI Capability
有独立 Admin Settings
```

同时共享：

``` text
identity
tenant
organization
platform AI
knowledge
file
integration
audit
UI
```

------------------------------------------------------------------------

# 35. 不要做成一个"大建筑 ERP"

即使五个 App 最终都存在，也不要把所有功能塞进：

``` text
一个超级 Construction App
```

产品层面保持清晰：

``` text
Suite
  ├── App 1
  ├── App 2
  ├── App 3
  ├── App 4
  └── App 5
```

大型客户可以组合购买/启用。

------------------------------------------------------------------------

# 36. 五个应用的最终北极星

## AI 项目经营

> 从"出了问题以后统计"变成"AI 持续发现正在影响项目经营的问题"。

## AI 商务经营

> 从"靠商务人员记住每一笔钱"变成"系统持续发现可能漏掉的钱"。

## AI 项目总控

> 从"管理层等报表"变成"AI 持续解释项目群正在发生什么"。

## AI 咨询作业平台

> 从"专业人员大量时间花在找、读、比、整理"变成"AI
> 完成信息劳动，人负责专业判断"。

## AI Design Operations

> 从"设计管理依赖会议、Excel
> 和人工追踪"变成"任务、版本、审查、变更和交付形成可计算的设计生产系统"。

------------------------------------------------------------------------

# 37. 五个应用完成后的产品形态

``` text
                   Enterprise AI Platform
                            │
                  Construction Industry
                            │
       ┌────────────┬───────┼───────┬────────────┐
       │            │       │       │            │
       ▼            ▼       ▼       ▼            ▼
   AI项目经营    AI商务经营  AI项目总控 AI咨询作业   AI设计运营
       │            │       │       │            │
       └────────────┴───────┼───────┴────────────┘
                            │
                 Shared Enterprise Context
                            │
          Tenant / Identity / Permission
          AI / Knowledge / Integration
          File / Audit / Notification
```

------------------------------------------------------------------------

# 38. 完成标准

五个应用不是以"页面做完"为完成。

每个 App 至少需要：

``` text
1 个清晰目标用户
1 条核心业务主线
3–5 个真正有价值的 AI Capability
完整 Permission
完整 Tenant Isolation
Knowledge Integration
Audit
关键业务 Timeline
Admin Module
至少 1 条 E2E 自动化测试
关键 AI Capability Evaluation
```

------------------------------------------------------------------------

# 39. 最重要的实施原则

Codex 必须持续遵守：

1.  **平台不是 APaaS。**
2.  **应用是真实代码。**
3.  **五个应用共享平台，不复制平台。**
4.  **行业能力属于 Construction Layer。**
5.  **业务差异优先留在 App 内。**
6.  **真实重复后才抽象 Shared。**
7.  **AI 必须有证据、权限和审计。**
8.  **Human-in-the-loop 用于重要业务决定。**
9.  **不要让聊天框取代正常业务软件。**
10. **不要为了功能数量牺牲核心业务闭环。**
11. **先做项目经营，再逐个验证其余应用。**
12. **每完成一个 App，都重新检查平台抽象是否正确。**

------------------------------------------------------------------------

# 40. Codex 在平台 V0.1 完成后的下一步

当 `Enterprise AI Application Platform V0.1` 已完成并通过验收后：

### 第一步

检查平台实际代码，输出：

``` text
/docs/construction/platform-reuse-audit.md
```

内容：

``` text
平台已有能力
可以直接复用的能力
与本文规格存在的差距
建议补充的平台能力
不应该放进平台的建筑业务能力
```

### 第二步

检查现有 `AI Project Operations` Vertical Slice。

不要推倒重写。

将现有能力扩展成本文定义的第一个正式应用。

输出：

``` text
/docs/construction/project-operations-v1-plan.md
```

### 第三步

完成 AI 项目经营 V1 后，做一次 Architecture Review：

``` text
哪些能力留在 App
哪些能力提升到 Construction Shared
哪些能力应该提升到 Platform
哪些抽象其实不需要
```

### 第四步

再启动 AI 商务经营。

之后按同样流程依次开发：

``` text
AI项目总控
AI咨询作业平台
AI Design Operations
```

------------------------------------------------------------------------

# 41. 最终要求

不要把本文件理解成：

> "一次性生成五套完整 ERP。"

正确理解是：

> **在统一企业 AI 平台之上，逐步建设五个聚焦核心业务价值的 AI
> 原生建筑应用，并在真实复用中逐渐形成 Construction Industry Layer。**

最终希望证明三件事：

``` text
第一：
AI 可以真正参与建筑企业业务闭环。

第二：
同一个 Enterprise AI Platform 可以快速支撑多个建筑应用。

第三：
平台与行业边界足够清晰，使未来进入其他行业时无需重做底层。
```

这三件事比功能数量更重要。
