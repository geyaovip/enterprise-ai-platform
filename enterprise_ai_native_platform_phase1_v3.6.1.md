# 企业 AI 原生应用平台第一阶段实施方案 V3.6.1

> 阅读位置：历史/未来规划输入。当前已确认范围与环境状态见 [47](docs/47-项目现状与文档维护.md)，新应用公共UI见 [ui/00](docs/ui/00-公共UI规范.md)；下文旧执行说明不授权开发或发布。


> **历史第一阶段方案，不作为当前接续任务。**
>
> 六批工程交付与当前边界见 [41](docs/41-六批优化交付与线上验收.md)；总体路线见 [42](docs/42-总体目标与发展路线.md)，当前计划见 [09](docs/09-首阶段实施计划.md)。下文 Phase、M0～M6、Runtime/知识 PoC 和 ERP→CRM→MES 顺序为原输入，不能覆盖后续决策或要求重做已交付三端、AI 和知识底座。

> 第一阶段不是"先做完整平台"，也不是"先做一个 AI Demo"。\
> 目标是建立长期正确的承重边界，并用一个真实业务 AI 闭环证明
> Tenant、Permission、Agent、Skill、Tool、Knowledge、Runtime、Audit

> **V3.6 新增实施原则：Adopt / Integrate before Build。能复用成熟外部能力就优先复用，OpenClaw First；只有企业特有边界或外部能力不满足要求时才自研。**
> 能共同工作。

------------------------------------------------------------------------

## 1. 第一阶段最终目标

第一阶段结束时必须跑通：

``` text
Platform Admin
↓
Tenant / Entitlement
↓
Tenant Admin
↓
Organization / Member / Role / Permission
↓
Workspace
↓
Enterprise AI / App AI / Knowledge
↓
Agent Resolver
↓
AgentDefinition
↓
AIExecutionContext
↓
AgentRuntime Adapter
↓
Agent Execution Infrastructure
↓
Skill
↓
Tool Gateway
├── Native Business Tool → Application Service → Business Data
└── Knowledge Tool → Knowledge Gateway → Knowledge Engine
↓
Structured AI Result
+ Business Evidence
+ Knowledge Citation
↓
Policy / Approval（按风险）
↓
Audit / Usage / Trace
```

成功标准：

> **真实 Tenant + 真实 User + 真实 Permission + 真实业务数据 +
> 真实企业知识 + 正式 Agent/Skill/Tool 执行链 + Citation + Audit。**

------------------------------------------------------------------------

## 2. 第一阶段交付范围

### 2.1 Platform Foundation

-   Tenant
-   User / Identity
-   TenantMembership
-   Organization
-   Role / Permission
-   Resource Scope 基础
-   RequestContext
-   App Registry
-   TenantApp
-   TenantAgent
-   Audit

### 2.2 Admin Foundation

-   Platform Admin Minimum
-   Tenant Admin Minimum
-   Workspace Minimum

### 2.3 AI Core

-   AIExecutionContext
-   Thin Agent / App / Tenant bindings（仅企业元数据）
-   AgentRuntime portability seam（保持最薄）
-   OpenClaw Integration PoC
-   OpenClaw Skills / Tools / Session / Memory / Hooks / Automation / MCP / Browser / Plugins / Sandbox 直接复用
-   Enterprise Tool Guard / Adapter（只补 Tenant / Permission / Data Scope / Risk）
-   OpenClaw Model / Provider 直接复用
-   Tenant Model Policy / Quota / Cost / Data Policy（企业治理层）
-   Approval Policy Minimum（优先通过 OpenClaw Hooks + 既有 ERP/OA 流程）
-   Enterprise Audit Adapter（优先消费 OpenClaw events / traces）

### 2.4 Knowledge Platform

-   KnowledgeSpace
-   Document / DocumentVersion
-   Knowledge Permission
-   KnowledgeEngine Contract
-   RAGFlowAdapter PoC
-   **RAGFlow 仅作为 Knowledge Engine：不采用其 Agent / Chat / Memory / Model Management 作为平台主实现**
-   Ingestion status
-   Permission-aware retrieval
-   Citation
-   Workspace Knowledge UI

### 2.5 First AI Native Business Loop

至少一个真实业务 Skill，组合：

``` text
Business Data
+
Enterprise Knowledge
+
Agent
+
Skill
+
Tools
```

具体业务场景根据当前已完成业务模块选择，不为 Demo 虚构业务数据。

------------------------------------------------------------------------

## 3. 第一阶段不做

``` text
Generic APaaS
Object / Form / View Builder
Low-code Runtime

Agent Builder
Skill Builder
Workflow Builder

默认 Enterprise Assistant
Master Agent / SubAgent Framework
Agent-to-Agent
Multi-Agent
Intelligent Agent Router

Complex Durable Runtime
Distributed Agent Runtime

Knowledge Graph
Ontology
Knowledge Agent

Marketplace
Automatic Capability Promotion
Complex Billing
Large Integration Marketplace
```

------------------------------------------------------------------------

## 4. Phase 0：统一 Architecture Audit

在写新架构代码前，Codex 必须扫描当前代码。

检查：

``` text
AiService
AppAiProvider
ErpAiProvider
AI Controllers
Prompt / Model SDK
Existing Session code
ERP Domain / Application Service
Repository access
Tenant / User / Permission
File / Knowledge related code
Audit
Admin frontend
```

必须输出：

1.  Current Architecture Map
2.  V3.6 Gap Analysis
3.  Keep / Refactor / Replace / Remove 分类
4.  Dependency risks
5.  Minimal Migration Plan
6.  第一阶段实施顺序

原则：

> 不为架构名称重写正确工作的业务代码；但从此以后不继续扩大临时边界。

------------------------------------------------------------------------

## 5. Phase 1A：Platform Foundation

### 5.1 Tenant

Tenant 是第一安全边界。

必须保证：

-   所有业务数据归属 Tenant
-   所有知识归属 Tenant
-   AI Session / Audit 归属 Tenant
-   Tenant 间不可交叉访问

### 5.2 Identity / Membership

``` text
User
↓
TenantMembership
↓
Tenant
```

Membership 承载：

-   tenantId
-   userId
-   status
-   roles
-   organization relationships

### 5.3 Organization

第一阶段：

``` text
OrganizationUnit
OrganizationMembership
```

满足公司 / 部门 / 子部门 / 成员归属即可。

### 5.4 Permission

至少：

``` text
App Permission
Function Permission
Data Scope
AI Access
Knowledge Access
```

不建设万能 ABAC DSL。

### 5.5 RequestContext

``` ts
type RequestContext = {
  tenantId: string
  userId: string
  membershipId: string
  appId: string
  organizationId?: string
  roles: string[]
  permissions: string[]
  resourceScope?: unknown
}
```

只能由可信服务端构建。

------------------------------------------------------------------------

## 6. Phase 1B：App Registry / Entitlement

最小模型：

``` text
Application
TenantApp
TenantAgent
```

预留但不强制复杂 UI：

``` text
TenantSkill
TenantConnection
TenantModelPolicy
```

平台决定：

``` text
Tenant 是否拥有某 App / Agent
```

Tenant Admin 只能在已 Entitle 的能力内做内部 Assignment。

App 可配置：

``` ts
interface AppAIConfig {
  appId: string
  defaultAgentId?: string
}
```

App ≠ Agent。

------------------------------------------------------------------------

## 7. Phase 1C：Admin Foundation

### 7.1 Platform Admin Minimum

``` text
租户
应用
AI
├── Agents
├── Skills
└── Tools
集成
模型
审计
```

必须支持：

``` text
Create Tenant
Enable App
Enable Agent
View Tenant Detail
View Catalog Definitions
View Audit
```

Tenant Detail：

``` text
Overview
Apps
AI
Knowledge
Connections
Usage
Audit
```

### 7.2 Tenant Admin Minimum

``` text
企业信息
组织与成员
角色与权限
应用访问
AI访问
知识权限
安全与审计
```

必须支持：

``` text
Member → Organization
Member → Role
Role → Permission
Role/Org/Member → App Access
Role/Org/Member → AI Access
Role/Org/Member → Knowledge Access
```

### 7.3 Workspace Minimum

``` text
首页
应用
企业 AI
知识库
```

不要第一阶段做复杂 Agent 市场或大量 AI 卡片。

------------------------------------------------------------------------

## 8. Phase 1D：Thin Enterprise AI Control Contracts

本阶段的目标不是建立第二套 Agent 平台，而是建立企业上下文与 OpenClaw 之间的**最薄控制边界**。

### 8.1 AIExecutionContext

``` ts
type AIExecutionContext = {
  tenantId: string
  userId: string
  membershipId: string
  appId: string
  projectId?: string
  sessionId: string
  roles: string[]
  permissions: string[]
  resourceScope?: unknown
  currentResource?: { type: string; id: string }
}
```

### 8.2 Thin Agent Binding

只保存企业侧必须的绑定信息，例如：

``` text
agentId / runtimeRef
appId
tenant entitlement
permissionPolicyId
knowledge scopes
modelPolicyId
status / version binding
```

Agent 的运行、Session、Context、Memory、Tool Loop 等不在此重复实现。

### 8.3 Skill / Tool Binding

优先直接采用 OpenClaw 的 Skills / Tools / Plugins 机制。我们只在确有企业治理需求时保存：

``` text
app / tenant ownership
required permission
data scope rule
risk level
entitlement
version / status binding
```

**禁止建设私有 Skill DSL、Skill Loader、Skill Runtime、Tool Calling Engine、Tool Runtime 或 Plugin Framework。**

------------------------------------------------------------------------

## 9. Phase 1E：Agent Execution Infrastructure PoC

第一阶段不再默认自己造完整 Runtime。更强的约束是：**OpenClaw 已有且满足要求的通用 AI 能力，不得在平台内建设平行实现。** 新增自研基础设施必须先给出 OpenClaw Gap、真实业务证据和 ADR。

先建立：

``` ts
interface AgentRuntime {
  run(input: AgentRunInput): Promise<AgentRunResult>
  stream?(input): AsyncIterable<AgentRunEvent>
  cancel?(runId): Promise<void>
  resume?(runId, input?): Promise<AgentRunResult>
}
```

然后首选 PoC：

``` text
OpenClawRuntimeAdapter
```

失败回退顺序：

``` text
OpenClaw
↓ 若未达到验收标准
Hermes Agent Adapter PoC
↓ 若仍不适合
Minimal Native Runtime / 其他 Runtime
```

这不是业务架构切换。上层始终只依赖 `AgentRuntime` Contract。

### 9.1 PoC 必测项

-   Single Agent loop
-   Tool calling
-   Structured output
-   Streaming
-   Session
-   Context assembly
-   Context compaction
-   Runtime hooks
-   Error handling
-   Tool timeout
-   Permission integration
-   Approval interception
-   Audit integration
-   MCP client potential
-   Model/provider flexibility
-   Deployment complexity
-   Observability
-   Upgrade/maintenance cost

### 9.2 Source of Truth 边界

OpenClaw 优先负责并尽量直接复用：

``` text
Agent Runtime / Agent Loop
Execution Session / Context / Compaction
Memory
Skills Runtime / Skill Loading
Tool Calling / Tool Runtime / Tool Policy
Hooks
Automation / Cron
Browser
MCP
Plugins
Sandbox / Code Execution
Model / Provider Runtime
Sub-agent / Multi-agent（未来真实需要时再启用）
```

我们只补企业产品与治理边界：

``` text
Tenant / Identity / Organization / Membership
Role / Permission / Data Scope
App Registry / Tenant Entitlement
Business Domain / Business Rules / Business Data
Enterprise Skill / Tool metadata & bindings（仅在确有需要时）
Knowledge Ownership / Knowledge Permission
Risk / Approval Policy（优先利用 OpenClaw Hooks 接入）
Enterprise Audit Record（优先消费 OpenClaw events / traces）
Billing / Quota / Tenant-level model policy
```

原则：**Control Ownership ≠ Implementation Ownership**。企业控制权和 Source of Truth 属于我们，不代表底层执行机制必须由我们重新开发。

OpenClaw 作为 V1 默认 Agent Infrastructure 先进入真实 ERP 场景验证；若不达标，则保持相同 `AgentRuntime` Contract，转入 Hermes Agent Adapter PoC。

业务代码不得直接依赖 OpenClaw SDK/内部实现。

------------------------------------------------------------------------

## 10. Phase 1F：Tool Gateway

执行链：

``` text
Runtime Tool Request
↓
Enterprise Tool Guard / Adapter
↓
Tenant Check
↓
Agent Scope
↓
User Permission
↓
Resource Scope
↓
Policy
↓
Approval
↓
Native Tool / Integration Tool
↓
Application Service
↓
Audit
```

Tool 不直接访问 Repository / DB。

风险：

``` text
L0 Read
L1 Draft
L2 Internal Write
L3 External Action
L4 Financial / Legal
```

第一闭环可以先以 L0/L1 为主，但 Contract 必须支持高风险动作。

------------------------------------------------------------------------

## 11. Phase 1G：Model Management — OpenClaw Direct Reuse

第一阶段**不开发 ModelGateway、Provider Adapter Framework、Model Router、Fallback Engine**。凡 OpenClaw 已提供并满足要求的模型能力直接使用 OpenClaw。

OpenClaw 负责：

``` text
Provider integration / auth
Model catalog / selection
Runtime invocation
Fallback / failover
Agent / session model binding
Custom / compatible endpoints
```

我们只实现企业治理层：

``` text
TenantModelPolicy
AllowedProviders
AllowedModels
DefaultModelPolicy
Quota / Budget
Data / Privacy / Region Policy
Usage / Cost / Enterprise Audit
```

业务 App / Skill 禁止硬编码 Provider SDK，也禁止再包一套与 OpenClaw 平行的通用模型调用框架。只有真实 PoC 证明 OpenClaw 存在明确企业治理缺口时，才补最薄 Adapter / Policy，并记录 ADR。

------------------------------------------------------------------------

## 12. Phase 1H：Knowledge Domain

知识平台首先建立自己的 Domain，而不是直接把 RAGFlow 数据模型当产品模型。

### 12.1 KnowledgeSpace

``` text
id
tenantId
name
description
owner
scopeType
scopeId
permissionPolicy
status
```

Scope 模型允许：

``` text
tenant
organization
app
project
resource
```

第一阶段 UI 可只开放真实需要的类型。

### 12.2 Document

``` text
Document
DocumentVersion
KnowledgeSource
```

状态至少：

``` text
uploaded
processing
ready
failed
archived
```

### 12.3 Knowledge Ownership

知识空间必须可委派 Owner：

``` text
企业制度 → 企业管理员
采购知识 → 采购负责人
App 知识 → App Admin
项目知识 → 项目负责人
```

------------------------------------------------------------------------

## 13. Phase 1I：KnowledgeEngine Contract + RAGFlow PoC

建立：

``` ts
interface KnowledgeEngine {
  ingest(...)
  remove(...)
  retrieve(...)
  health(...)
}
```

具体 Contract 根据 PoC 细化，但业务层不得依赖 RAGFlow API。

第一优先 PoC：

``` text
RAGFlowAdapter
```

### 13.1 PoC 文档集

必须使用真实或高度代表性的中文企业文档：

-   普通 PDF
-   复杂 PDF
-   Word
-   Excel
-   PPT
-   表格
-   扫描 PDF / 图片
-   长文档
-   多版本文档

如果未来近期面向建筑客户，应加入：

-   合同
-   招标文件
-   规范
-   会议纪要
-   项目资料
-   复杂表格

### 13.2 PoC 指标

验证：

-   parsing fidelity
-   OCR
-   layout
-   table extraction
-   chunk quality
-   embedding
-   hybrid retrieval
-   reranking
-   citation metadata
-   incremental update
-   delete/reindex
-   failure recovery
-   permission filter integration
-   Chinese search quality
-   deployment
-   resource usage
-   operational complexity

Cloud 功能 PoC 与 Self-hosted 基础设施 PoC 均通过，并形成 ADR 后，才决定是否成为默认 Knowledge Engine。

------------------------------------------------------------------------

## 14. Phase 1J：Knowledge Engine Binding 与部署切换

我们的数据库保持 Knowledge Source of Truth，并记录外部引擎映射：

```text
KnowledgeEngineBinding
├── knowledgeSpaceId
├── documentId / documentVersionId
├── engine = ragflow
├── deployment = cloud | self-hosted
├── externalDatasetId
├── externalDocumentId
├── syncStatus
└── lastSyncedAt
```

验收要求：Cloud Free → Self-hosted 切换时，上层 Workspace、Agent、Skill、Knowledge Permission 和业务 API 不修改；只允许 Adapter / Connection 配置、外部映射和重新索引发生变化。

## 15. Phase 1K：Knowledge Permission Gateway

权限必须在 Retrieval / Context Injection 前生效。

``` text
User
↓
Tenant
↓
Role / Organization / Resource Scope
↓
Knowledge Permission
↓
Allowed Knowledge Sources
↓
KnowledgeEngine.retrieve()
↓
Allowed Hits
↓
Agent / Skill / Human
```

禁止：

``` text
Search everything
→ send to model
→ filter final answer
```

### 14.1 KnowledgeHit

``` ts
type KnowledgeHit = {
  documentId: string
  documentVersionId: string
  chunkId: string
  content: string
  score: number
  pageNumber?: number
  section?: string
  heading?: string
  metadata?: Record<string, unknown>
  citation: unknown
}
```

Citation 必须可回到原文。

------------------------------------------------------------------------

## 16. Phase 1L：Workspace Knowledge MVP

普通员工可使用：

``` text
知识库
├── Knowledge Spaces
├── Document List
├── Upload
├── Processing Status
├── Search
├── Document View
└── Citation Navigation
```

Tenant Admin 管权限和 Owner，不要求所有知识都由 Tenant Admin 上传。

Knowledge 同时服务：

``` text
Human Search
Enterprise AI
Skills
```

------------------------------------------------------------------------

## 17. Phase 1M：First Real Agent / Skill / Tools

根据当前真实业务模块选一个场景。

优先选择同时需要：

``` text
Structured Business Data
+
Enterprise Knowledge
```

例如在对应业务数据已经存在时：

``` text
Supplier Risk Analysis
```

可能使用：

``` text
erp.supplier.query
erp.purchase_order.query
knowledge.search
```

但如果当前 ERP 还没有这些真实模块，必须选择已经真实存在的业务对象，不为
Demo 造假接口。

------------------------------------------------------------------------

## 18. Phase 1N：统一 AI Entry

目标：

``` text
Enterprise AI ─┐
               ├──→ same App Default Agent
App 内 AI ─────┘
```

两条入口必须：

-   同一个 AgentDefinition
-   同一个 Agent Resolver
-   同一个 Runtime Adapter
-   同一个 Skill
-   同一个 Tool Gateway
-   同一权限体系
-   同一 Audit 链

只允许 Context / UI Surface 不同。

------------------------------------------------------------------------

## 19. Phase 1O：Business Data + Knowledge Loop

最终闭环：

``` text
Real User
↓
AIExecutionContext
↓
App Default Agent
↓
OpenClawRuntimeAdapter（若 PoC 通过）
↓
Skill
├── Business Native Tools
│   ↓
│   Application Service
│   ↓
│   Real Business Data
│
└── Knowledge Tool
    ↓
    Our Knowledge Gateway
    ↓
    Permission Filter
    ↓
    RAGFlowAdapter（若 PoC 通过）
    ↓
    Enterprise Documents
↓
AI Analysis
↓
Business Evidence + Knowledge Citation
↓
Audit
```

这是第一阶段最重要的验收链。

------------------------------------------------------------------------

## 20. Approval Minimum

第一阶段建立 Contract 和最小实现：

``` text
allow
deny
require_confirmation
require_approval
```

如果首个场景只有读和分析，不强行制造审批 Demo。

但 Tool Executor 必须预留正式拦截点。

------------------------------------------------------------------------

## 21. Audit / Usage / Trace

至少记录：

``` text
tenantId
userId
membershipId
appId
agentId
skillId
sessionId
runtime
toolCalls
resourceIds
knowledgeSources
citations
model
approval
status
duration
usage
timestamp
traceId
```

必须能够从一次 AI 回答追溯：

``` text
谁
在什么 Tenant
使用哪个 Agent / Skill
访问哪些业务对象
检索哪些知识
调用哪个模型
执行哪些 Tool
结果是否成功
```

------------------------------------------------------------------------

## 22. Security Test Matrix

### Tenant Isolation

Tenant A 不得访问 Tenant B：

-   business data
-   knowledge
-   session
-   audit
-   files

### Business Permission

用户没有某业务 Permission：

``` text
Human UI = denied
AI Tool = denied
```

### Agent Scope

Agent 不允许的 App / Tool：

``` text
Runtime request = denied
```

### Resource Scope

只能看部门 / 项目范围时，AI 同样只能看该范围。

### Knowledge

无权 KnowledgeSource 不得进入 Retrieval / Model Context。

### Approval

高风险 Tool 不得通过 Prompt 或 Runtime 绕过 Approval。

### Adapter

OpenClaw / RAGFlow 故障或配置错误不得突破 Tenant / Permission 边界。

------------------------------------------------------------------------

## 23. 第一阶段代码结构

``` text
platform/
├── tenant/
├── identity/
├── organization/
├── permission/
├── app-registry/
├── ai/
│   ├── context/
│   ├── agents/
│   ├── skills/
│   ├── tools/
│   ├── runtime/
│   │   ├── contracts/
│   │   └── adapters/
│   │       └── openclaw/
│   ├── models/
│   ├── policy/
│   ├── approval/
│   ├── sessions/
│   ├── evaluations/
│   └── audit/
├── knowledge/
│   ├── domain/
│   ├── spaces/
│   ├── documents/
│   ├── permissions/
│   ├── engine/
│   │   ├── contracts/
│   │   └── adapters/
│   │       └── ragflow/
│   ├── retrieval/
│   └── citations/
├── integration/
├── file/
└── audit/
```

------------------------------------------------------------------------

## 24. 推荐实施顺序

``` text
01 Architecture Audit
02 Tenant / Identity / Membership
03 Organization
04 Permission / Resource Scope
05 RequestContext
06 App Registry / Entitlement
07 Platform Admin Minimum
08 Tenant Admin Minimum
09 AIExecutionContext
10 Agent / Skill / Tool Contracts
11 ModelGateway
12 AgentRuntime Contract
13 OpenClaw Agent Infrastructure PoC
14 Tool Gateway / Executor
15 Knowledge Domain
16 KnowledgeEngine Contract
17 RAGFlow Cloud Free 功能 PoC
18 Knowledge Engine Binding
19 RAGFlow Self-hosted PoC（Cloud PoC 通过后）
20 Knowledge Permission Gateway
21 Workspace Knowledge MVP
22 First Real Native Tools
23 First Real Skill
24 Unified Enterprise AI / App AI Entry
25 Business Data + Knowledge AI Loop
26 Policy / Approval Minimum
27 Audit / Usage / Trace
28 Security Test Matrix
29 Architecture Review
30 Continue Business App Development
```

可并行，但不能跳过 Contract 与安全边界直接扩大 Provider / RAG 临时代码。

------------------------------------------------------------------------

## 25. Milestones

### M0 --- Architecture Baseline

-   Current Architecture Map
-   Gap Analysis
-   Migration Plan
-   No new temporary architecture expansion

### M1 --- Platform Foundation Ready

-   Tenant
-   Identity / Membership
-   Organization
-   Permission
-   RequestContext
-   App Registry
-   Entitlement
-   Audit baseline

### M2 --- Admin Ready

Platform Admin：

``` text
Create Tenant
→ Enable App
→ Enable Agent
```

Tenant Admin：

``` text
Organization / Member
→ Role / Permission
→ App / AI / Knowledge access
```

### M3 --- AI Infrastructure Decision Ready

-   AgentRuntime Contract
-   OpenClaw PoC completed
-   comparison recorded
-   ADR created
-   default Runtime selected
-   adapter isolated

### M4 --- Knowledge Infrastructure Decision Ready

-   Knowledge Domain
-   KnowledgeEngine Contract
-   RAGFlow PoC completed
-   representative Chinese docs tested
-   permission integration validated
-   ADR created
-   default engine selected

### M5 --- Knowledge Product Ready

-   Knowledge Space
-   Upload
-   Processing
-   Permission
-   Search
-   Citation
-   Workspace UI

### M6 --- First AI Native Business Loop

``` text
Real Tenant
+ Real User
+ Real Permission
+ Real Business Data
+ Real Knowledge
+ Agent
+ Skill
+ Native Tools
+ Runtime
+ Citation
+ Audit
```

全部跑通。

------------------------------------------------------------------------

## 26. Architecture Decision Records

第一阶段至少形成：

``` text
ADR-001 Runtime Infrastructure
ADR-002 Knowledge Engine
ADR-003 Model Provider Strategy
ADR-004 Permission / Resource Scope
ADR-005 AI Tool Risk / Approval
```

ADR 必须记录：

-   decision
-   alternatives
-   evidence
-   trade-offs
-   exit strategy

避免以后只知道"用了 OpenClaw/RAGFlow"，不知道为什么。

------------------------------------------------------------------------

## 27. Codex 强制规则

1.  先扫描现有代码再实施。
2.  保留正确的 Domain / Application Service。
3.  不为目录漂亮重写业务代码。
4.  新代码遵守 V3.3 Contract。
5.  Tenant 是第一安全边界。
6.  Context 由可信服务端构建。
7.  AgentDefinition 不含业务规则。
8.  Skill 不复制 Domain Rule。
9.  Tool 不直接访问 Repository / DB。
10. AI 不能绕过用户 Permission。
11. Knowledge Permission 在 Retrieval 前生效。
12. Internal App 使用 Native Tool。
13. MCP 属于 Integration。
14. Enterprise AI 与 App AI 复用同一执行链。
15. 不默认创建 Enterprise Agent。
16. 不建设智能 Agent Router。
17. 不建设 Multi-Agent。
18. `AgentRuntime` Contract 必须保留。
19. OpenClaw 通过 Adapter / Plugin 接入。
20. 业务代码不得直接 import OpenClaw SDK/内部实现。
21. `KnowledgeEngine` Contract 必须保留。
22. RAGFlow 通过 Adapter 接入。
23. Knowledge Domain 不使用 RAGFlow 数据模型替代。
24. Agent Memory ≠ Enterprise Knowledge。
25. Enterprise Knowledge ≠ Business Data。
26. Business structured data 通过 Native Tool 获取。
27. Citation 必须可追溯。
28. Platform Admin 管 Entitlement。
29. Tenant Admin 管 Assignment / Permission。
30. Knowledge 是 Workspace 产品能力。
31. Tool 调用必须 Audit。
32. AI 运行必须 Trace。
33. Skill 必须可版本化并支持 Eval。
34. L2+ 动作必须具备确认/审批能力。
35. 第三方基础设施故障不得突破安全边界。
36. 没有两个真实消费者不提前抽 Shared。
37. 不建设 Generic APaaS。
38. 不建设 Agent/Skill/Workflow Builder。
39. 每个 Milestone 有自动测试或可重复验收。
40. PoC 结论必须形成 ADR，不凭印象选型。

------------------------------------------------------------------------

## 28. 第一阶段自动化测试要求

至少覆盖：

``` text
Tenant isolation tests
Permission tests
Resource scope tests
Agent scope tests
Tool executor tests
Approval interception tests
Knowledge permission tests
Citation integrity tests
Runtime adapter contract tests
Knowledge engine adapter contract tests
Audit completeness tests
Failure / timeout tests
```

关键安全测试不得只靠手工 UI 验证。

------------------------------------------------------------------------

## 29. 第一阶段失败判定

以下任一情况都不能算完成：

#### 只有平台 CRUD

``` text
很多 Registry
很多 Admin
没有真实业务 AI 闭环
```

#### 只有 AI Demo

``` text
Chat
→ Prompt
→ 直接查 DB
```

#### 只有 RAG Demo

``` text
Upload PDF
→ Chat
```

但没有 Tenant / Permission / Citation / Workspace / Governance。

#### 第三方反客为主

``` text
OpenClaw 成为 Tenant/Permission Source of Truth
或
RAGFlow 成为 Knowledge Product Domain
```

#### 两套 AI 链路

``` text
Enterprise AI 一套
App AI 另一套
```

------------------------------------------------------------------------

## 30. 第一阶段完成定义

真正完成必须同时满足：

``` text
平台承重边界已经稳定
+
Tenant / Permission 真实生效
+
Platform Admin 能交付能力
+
Tenant Admin 能分配能力
+
Workspace 能消费 App / AI / Knowledge
+
Runtime 通过可替换 Adapter 接入
+
Knowledge Engine 通过可替换 Adapter 接入
+
真实业务数据通过 Native Tool 获取
+
企业知识经过权限过滤并带 Citation
+
AI 行为可 Audit / Trace
+
第一条真实 AI Native Business Loop 跑通
```

第一阶段的本质：

> **我们不是先造一个"大平台"，而是建立最小但正式的企业 AI
> 操作系统骨架，并用真实业务证明它可以继续承载 ERP → CRM → MES →
> Industry Apps，而无需推翻重来。**
