# 企业 AI 原生应用平台总体规划 V3.6.1

> 阅读位置：历史/未来规划输入。当前已确认范围与环境状态见 [47](docs/47-项目现状与文档维护.md)，新应用公共UI见 [ui/00](docs/ui/00-公共UI规范.md)；下文旧执行说明不授权开发或发布。


> **历史规划输入 V3.6.1，保留追溯，不作为当前架构基线或实施指令。**
>
> 当前总体目标与路线见 [42](docs/42-总体目标与发展路线.md)，范围和优先级遵从 [决策记录](docs/00-文档索引与决策记录.md)、[开发基线](docs/15-开发启动基线.md)。ERP 六批工程交付已完成；电商CRM已进入开发前文档准备，尚未开发/发布；当前使用内置知识库，Cloud/生产定时备份/真实客户场景按用户决定暂缓。下文的固定应用顺序、PoC、组件唯一性、数量要求与执行说明保留历史含义，不自动生成任务。采纳关系见 [23](docs/23-V3.6.1规划采纳评审.md)。

------------------------------------------------------------------------

## 1. 产品定位

### 1.1 一句话定位

**企业 AI 原生应用平台 = 企业工作空间 + 业务应用 + 企业 AI + 企业知识 +
AI 执行基础设施 + 企业级治理平台。**

平台不是通用低代码 APaaS，也不是单纯 ChatBot、RAG 系统或 Agent Builder。

### 1.2 核心价值

``` text
企业业务
ERP / CRM / MES / 行业应用
        +
企业知识
制度 / SOP / 项目资料 / 文档
        +
企业 AI
Agent / Skill / Tool / Model
        +
企业治理
Tenant / Identity / Permission / Approval / Audit
        ↓
AI 真正理解业务、读取授权数据、依据企业知识、执行授权操作
```

### 1.3 核心原则

1.  Platform Foundation First, Real Application Validation First.
2.  Code First → Config when needed → Platform when repeated.
3.  Business First → Capability Second → Reuse Third → Abstraction Last.
4.  平台只承载跨应用、跨行业的稳定公共能力。
5.  App owns business; Skill owns reusable intelligence; Agent owns task
    orchestration; Platform owns governance.
6.  Agent 少而精，Skill 多而专业，Tool 多而标准。
7.  Single Agent First, Multi-Agent On Demand.
8.  AI inherits user authority, not platform authority.
9.  Tenant 是第一安全边界。
10. Internal Apps 默认使用 Native Tool，不通过 MCP 绕行。
11. **OpenClaw Capability First：凡 OpenClaw 已稳定提供且满足要求的通用 AI 能力，V1 必须优先直接复用，不允许为了“平台自主”再建设平行实现。**
12. **Adopt / Integrate before Build：先采用、再集成、最后才自研。** 新增通用 AI 基础设施前必须先证明 OpenClaw 不满足需求。
13. OpenClaw 是 V1 默认且唯一的主 Agent Infrastructure；Agent Runtime、Session/Context、Memory、Skills、Tool Calling、Hooks、Automation、Browser、MCP、Plugins、Sandbox、Model/Provider、Sub-agent 等已有能力不重复开发。
14. RAGFlow 在 V1 严格定位为 Knowledge Engine，仅使用 Parsing / OCR / Layout / Table / Chunking / Embedding / Indexing / Retrieval / Rerank / Citation 等知识能力；其 Agent / Chat / Memory / Model Management 不作为平台主实现。
15. 平台掌握企业语义和治理边界，通过薄 Adapter / Guard / Binding 与外部基础设施连接；**Control Ownership ≠ Implementation Ownership**。
16. 第三方 Runtime / RAG / Model / Integration 都不是 Tenant、Permission、Business Data 等企业业务 Source of Truth。
17. 只有当 OpenClaw 经真实业务 PoC 证明无法满足企业边界、稳定性、安全性或关键能力要求时，才允许评估替代/自研，并形成 ADR。
15. 不提前建设没有真实消费者的抽象。
16. Modular Monolith First。

------------------------------------------------------------------------

## 2. 产品全景

``` text
用户
├── 企业员工
├── 管理者
├── 业务人员
├── 专业人员
└── 企业管理员
        ↓
Enterprise Workspace
├── 首页 / 工作台
├── 应用
├── 企业 AI
├── 知识库
├── 待办
└── 消息
        ↓
Applications
├── ERP
├── CRM
├── MES
├── Future Business Apps
└── Industry AI Apps
        ↓
Enterprise AI Control Plane
├── Agent
├── Skill
├── Tool
├── Knowledge Context
├── Model Policy
├── Policy / Approval
├── Session / Task Governance
├── Audit / Usage
└── Runtime Abstraction
        ↓
Execution Infrastructure
├── Agent Runtime
├── Knowledge Engine
├── Model Providers
└── Integration Runtime
        ↓
Business / Enterprise Systems
├── Native Application Services
├── Existing ERP / OA / SAP / Yonyou / Kingdee
├── MCP / REST / Webhook / Database
└── Files / Object Storage / Databases
```

------------------------------------------------------------------------

## 3. 三个产品 Surface

``` text
apps/
├── web/             # Enterprise Workspace
├── admin/           # Tenant Admin
└── platform-admin/  # Platform Admin
```

三者共享 Platform Core 与业务后端，不复制 Domain Logic。

### 3.1 Enterprise Workspace

员工真正工作的地方：

``` text
首页
应用
企业 AI
知识库
待办
消息
```

业务含义：

-   应用：去做业务
-   企业 AI：让 AI 帮我做业务
-   知识：找到企业知道的东西

### 3.2 Tenant Admin

客户内部管理：

``` text
企业管理
├── 企业信息
├── 组织与成员
├── 角色与权限
├── 应用访问
├── AI 访问
├── 知识权限
├── App-specific Admin
└── 安全与审计
```

### 3.3 Platform Admin

平台运营方管理：

``` text
平台管理
├── 租户
├── 应用
├── AI
│   ├── Agents
│   ├── Skills
│   └── Tools
├── 集成
├── 模型
├── Entitlements
├── Usage / Cost / Quota
└── 系统 / Audit / Health
```

核心区别：

> Platform Admin 决定"客户拥有什么"。\
> Tenant Admin 决定"客户内部谁能用、能用什么、能做到什么程度"。

------------------------------------------------------------------------

## 4. 总体技术架构

``` text
┌──────────────── Enterprise Experience ────────────────┐
│ Workspace / Business Apps / Enterprise AI / Knowledge │
└──────────────────────────┬─────────────────────────────┘
                           ↓
┌──────────────── API / Context Layer ──────────────────┐
│ RequestContext / AIExecutionContext / API / Streaming │
└──────────────────────────┬─────────────────────────────┘
                           ↓
┌────────────── Enterprise AI Control Plane ────────────┐
│ Agent Registry / Skill Registry / Tool Registry       │
│ Knowledge Gateway / Model Gateway                     │
│ Permission / Policy / Approval / Audit / Usage        │
│ Runtime Abstraction / Session & Task Governance       │
└───────────────┬───────────────────────┬───────────────┘
                ↓                       ↓
┌──── Agent Execution Infra ───┐  ┌── Knowledge Infra ──┐
│ AgentRuntime Adapter         │  │ KnowledgeEngine      │
│ OpenClaw: priority adoption / PoC  │  │ RAGFlow: priority PoC│
│ Session / Context / Hooks    │  │ Parse / Chunk / RAG  │
│ Compaction / Tool Loop / MCP │  │ OCR / Rerank / Index │
└──────────────┬───────────────┘  └──────────┬───────────┘
               ↓                             ↓
┌──────────────── Tool / Integration Gateway ────────────┐
│ Native Tools / MCP / REST / Webhook / Database        │
└──────────────────────────┬─────────────────────────────┘
                           ↓
┌──────────────── Business Application Layer ────────────┐
│ ERP / CRM / MES / Industry Apps                       │
│ Application Service → Domain → Repository             │
└──────────────────────────┬─────────────────────────────┘
                           ↓
┌──────────────── Data / Infrastructure ─────────────────┐
│ PostgreSQL / pgvector / Object Storage / Redis / Jobs  │
│ Logs / Metrics / Tracing / Secrets                    │
└────────────────────────────────────────────────────────┘
```

------------------------------------------------------------------------

## 5. Monorepo 与模块边界

``` text
enterprise-ai-platform/

apps/
├── web/
├── admin/
└── platform-admin/

services/
├── api/
└── worker/

platform/
├── tenant/
├── identity/
├── organization/
├── permission/
├── app-registry/
├── ai/
│   ├── gateway/
│   ├── context/
│   ├── agents/
│   ├── skills/
│   ├── tools/
│   ├── runtime/
│   ├── models/
│   ├── policy/
│   ├── approval/
│   ├── sessions/
│   ├── evaluations/
│   └── audit/
├── knowledge/
│   ├── spaces/
│   ├── documents/
│   ├── permissions/
│   ├── engine/
│   ├── retrieval/
│   └── citations/
├── integration/
├── file/
├── notification/
├── jobs/
└── audit/

business-apps/
├── erp/
├── crm/
└── mes/

industries/
├── construction/
├── manufacturing/
├── retail/
└── ...

packages/
├── ui/
├── business-ui/
├── sdk/
├── ai-sdk/
└── common/

infrastructure/
docs/
tests/
```

依赖方向：

``` text
App
↓
Industry Shared
↓
Shared Business（有真实复用后再出现）
↓
Platform Core
```

Platform Core 禁止 import ERP / CRM / 行业内部实现。

------------------------------------------------------------------------

## 6. Tenant / Identity / Organization / Permission

### 6.1 Tenant

Tenant 是数据、权限、AI、知识和审计的第一隔离边界。

### 6.2 Identity

``` text
User
↓
TenantMembership
↓
Tenant
```

一个 User 可以属于多个 Tenant。

### 6.3 RequestContext

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

### 6.4 权限层级

``` text
1. App Permission
2. Function Permission
3. Data Scope
4. AI Access
5. Knowledge Access
6. Action Risk / Approval
```

AI 不重新发明业务权限体系。

有效 AI 权限：

``` text
Tenant Entitlement
∩ App Enablement
∩ Agent Allowed Scope
∩ User Permission
∩ Data Scope
∩ Knowledge Scope
∩ Current Context
∩ Policy
= Effective AI Authority
```

------------------------------------------------------------------------

## 7. App Registry 与 Entitlement

``` text
Application
TenantApp
TenantAgent
TenantSkill（仅需要 override 时）
TenantConnection
TenantModelPolicy
```

平台 Catalog：

``` text
Apps
Agents
Skills
Tools
Integrations
Models
```

交付：

``` text
Platform Catalog
↓
Entitlement
↓
Tenant
↓
Tenant-specific Assignment / Configuration
```

定义不按 Tenant 复制。

App 可以有：

``` ts
interface AppAIConfig {
  appId: string
  defaultAgentId?: string
}
```

但 App ≠ Agent，且不是每个 App 都需要 Agent。

------------------------------------------------------------------------

## 8. Enterprise AI Experience

Enterprise AI 是 Experience Layer，不是 Agent 类型。

``` text
AI Experience
├── Enterprise AI unified entry
├── App Assistant
├── Embedded AI
├── AI Insight
├── AI Task
└── AI Notification
```

单 App 场景：

``` text
Enterprise AI ─┐
               ├──→ App Default Agent
App 内 AI ─────┘
```

两个入口必须复用同一 AgentDefinition 与执行链，只允许 Context 不同。

多 App 并不自动产生 Enterprise
Assistant。只有真实跨应用独立工作责任出现，才考虑新增 Agent。

------------------------------------------------------------------------

## 9. Unified AI Capability Model

系统只有一套：

``` text
AgentDefinition
SkillDefinition
ToolDefinition
KnowledgeSource
```

通过 owner / scope / permission 区分平台、应用和行业能力。

``` ts
type CapabilityOwner = {
  type: "platform" | "app" | "industry"
  id?: string
}
```

### 9.1 Agent

Agent = 谁负责完成任务。

``` text
AgentDefinition
├── id / code / name
├── owner
├── defaultAppId
├── instructions
├── allowedApps
├── skills
├── toolScopes
├── knowledgeScopes
├── modelPolicy
├── permissionPolicy
├── approvalPolicy
├── sessionPolicy
├── version
└── status
```

AgentDefinition 不承载业务规则。

### 9.2 Skill

Skill = 可复用、可执行、可评估的 AI 专业能力。

``` text
SkillDefinition
├── inputSchema
├── outputSchema
├── instructions
├── tools
├── knowledgeScopes
├── execution strategy
├── risk
├── version
└── evaluations
```

供应商风险分析、库存分析、合同分析通常是 Skill，不是 Agent。

### 9.3 Tool

Tool = AI 获得业务数据或执行动作的标准边界。

命名空间示例：

``` text
document.read
knowledge.search
erp.supplier.query
erp.purchase_order.query
crm.customer.query
```

### 9.4 Agent 创建原则

``` text
Skill 能解决
↓ 不创建 Agent

Existing Agent + Skill 能解决
↓ 不创建 Agent

只有存在独立工作责任、独立上下文/生命周期/权限/交付物
↓
New AgentDefinition
```

------------------------------------------------------------------------

## 10. AI Execution Control Plane

### 10.1 AIExecutionContext

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
  currentResource?: {
    type: string
    id: string
  }
}
```

必须由可信服务端构建。

### 10.2 Thin Agent Resolver

``` text
explicit agentId
→ app/tenant defaultAgent
→ unique available Agent
```

不是智能 Router。

### 10.3 Runtime Contract

``` ts
interface AgentRuntime {
  run(input: AgentRunInput): Promise<AgentRunResult>
  stream?(input): AsyncIterable<AgentRunEvent>
  cancel?(runId): Promise<void>
  resume?(runId, input?): Promise<AgentRunResult>
}
```

业务代码只依赖 Contract。

------------------------------------------------------------------------

## 11. Agent Execution Infrastructure

当前首选 Agent Infrastructure：OpenClaw。

执行策略：V1 采用 **OpenClaw First**。优先复用 OpenClaw 已成熟提供的 Agent Runtime、Session/Context、Memory、Skills、Tool Calling、Hooks、Automation、Browser、MCP、Plugins、Sandbox、Model/Provider 等通用 Agent Infrastructure；我们只补 Tenant、Identity、Organization、Permission、Data Scope、App Entitlement、企业审计、业务规则等企业特有边界。若 OpenClaw 在真实 ERP 场景中的嵌入性、企业治理接入、稳定性、维护成本或能力表现不达标，再保持相同 `AgentRuntime` Contract 评估 Hermes Agent。

定位：

> OpenClaw = 首选、但仍可替换的 Agent Infrastructure；不是 Tenant / Permission / Business Data 的 Source of Truth
> Control Plane。

优先直接复用的通用能力：

``` text
Agent Loop
Tool Loop
Streaming
Execution Session
Context Assembly
Context Compaction
Runtime Hooks
Skill Runtime Loading
MCP Client
Provider Adapter（评估）
```

我们仍然掌握的是**企业控制语义与 Source of Truth**，而不是重新实现 OpenClaw 的执行机制：

``` text
Tenant / Identity / Organization / Membership
Permission / Role / Data Scope
App Registry / Entitlement
Business Domain / Business Rules / Business Data
Enterprise AI metadata / bindings（保持最薄）
Knowledge Ownership / Knowledge Permission
Risk / Approval Policy
Enterprise Audit semantics / records
Billing / Quota / Tenant Model Policy
```

明确禁止在 V1 平行建设：Agent Runtime、Skill Runtime/Loader、Tool Calling Runtime、Session/Context Engine、Memory Engine、MCP Runtime、Browser Runtime、Automation/Cron Engine、Plugin Framework、Sandbox/Code Execution Runtime、通用 Model Gateway / Provider Framework。

建议：

``` text
Our AgentRuntime
↓
OpenClawRuntimeAdapter
↓
OpenClaw
```

禁止业务 App 直接依赖 OpenClaw API/内部实现；统一通过 Adapter / Plugin / Contract 接入。

------------------------------------------------------------------------

## 12. Tool Gateway / Native Tools

内部应用：

``` text
Agent Runtime
↓
Enterprise Tool Guard / Adapter
↓
Tenant Check
↓
Permission
↓
Agent Scope
↓
Resource Scope
↓
Policy
↓
Approval
↓
Native Tool
↓
Application Service
↓
Domain
```

Agent / Skill / Tool 不直接访问 Repository / DB。

风险等级：

``` text
L0 Read
L1 Draft
L2 Internal Write
L3 External Action
L4 Financial / Legal
```

L2+ 必须支持确认/审批。

------------------------------------------------------------------------

## 13. Model Management：OpenClaw First

V1 **不自研通用 Model Gateway / Provider Framework**。模型接入与运行能力默认复用 OpenClaw 已有 Model / Provider Infrastructure。

OpenClaw 负责：

``` text
Provider Integration / Authentication
Model Catalog / Selection
Agent / Session Model Binding
Fallback / Failover
Provider Runtime Invocation
Custom / OpenAI-compatible Endpoint
Local / Private Model Integration（能力满足时）
```

我们的平台只负责企业治理与产品配置：

``` text
TenantModelPolicy
Allowed Providers / Models
Default Model Policy
Quota / Budget / Cost Governance
Data / Privacy / Region Policy
Entitlement
Enterprise Usage / Audit
```

执行关系：

``` text
Platform Admin / Tenant Policy
↓
Thin Model Policy Binding
↓
OpenClaw Model / Provider Layer
↓
LLM Providers / Private Models
```

禁止业务 App / Skill 直接硬编码模型 Provider SDK；也禁止为了统一接口而再造一套与 OpenClaw 平行的模型调用、Provider Adapter、Fallback 或 Routing Runtime。只有 OpenClaw 明确无法满足的企业治理缺口，才由平台补充薄 Policy / Adapter。

------------------------------------------------------------------------

## 14. 企业知识架构

### 14.1 三类知识/数据必须分离

``` text
① Agent Memory
   对话 / Session / Execution Memory
   → Agent Infrastructure（OpenClaw First）

② Enterprise Knowledge
   制度 / SOP / 文档 / 项目资料
   → Our Knowledge Platform

③ Business Data
   ERP / CRM / MES 实时结构化数据
   → Native Tool → Application Service
```

禁止把三者统一塞进"向量知识库"。

### 14.2 Knowledge Platform 分层

``` text
Knowledge Product Layer
↓
Knowledge Control Plane（OURS）
↓
KnowledgeEngine Contract
↓
Knowledge Engine Infrastructure
↓
Storage
```

#### 我们掌握

``` text
KnowledgeSpace
Document
DocumentVersion
KnowledgeSource
Tenant
Owner
Scope
PermissionPolicy
Lifecycle
Citation
Audit
App Binding
Project Binding
```

#### Knowledge Engine 负责

``` text
Parsing
OCR
Layout Analysis
Table Extraction
Chunking
Embedding
Indexing
Vector Search
Keyword / Hybrid Search
Reranking
Query Processing
```

当前优先 PoC：RAGFlow。

**V1 边界写死：RAGFlow 只作为 Knowledge Engine。** 即使 RAGFlow 同时提供 Agent、Chat、Memory、Model Management、MCP 等能力，也不作为本平台对应能力的主实现；这些通用 Agent Infrastructure 统一由 OpenClaw 承担，避免形成两套 Agent / Memory / Session / Model / MCP 体系。

RAGFlow 在本平台中的核心价值不是“支持多种文件格式”本身，而是承担 **Document → AI-usable Knowledge** 的知识引擎工作：重点验证复杂企业文档的 Parsing / OCR / Layout / Table Extraction、结构感知 Chunking、Embedding、Hybrid Retrieval 与 Reranking。它不等于 Enterprise Knowledge Platform，也不拥有企业知识的产品模型、权限与生命周期。

建议：

``` text
KnowledgeEngine
├── RAGFlowAdapter
├── NativeAdapter
└── FutureAdapter
```

### 14.3 Knowledge Engine Binding

Knowledge 产品模型与外部引擎必须解耦：

```text
KnowledgeSpace / Document / Version / Permission
↓
KnowledgeEngineBinding
├── engine
├── deployment
├── externalDatasetId
├── externalDocumentId
├── syncStatus
└── lastSyncedAt
↓
RAGFlowAdapter
├── Cloud Free（前期功能 PoC）
└── Self-hosted（生产候选）
```

从 Cloud 切换到 Self-hosted 时，上层 Workspace、Agent、Skill、Permission、KnowledgeSpace 和 Document 不应改变，只更换连接配置并执行必要的重新索引。

### 14.4 Permission Before Retrieval

``` text
User
↓
Tenant
↓
Permission / Resource Scope
↓
Allowed Knowledge Sources
↓
Knowledge Engine Retrieval
↓
Rerank
↓
Allowed Chunks
↓
Agent / Skill / Human
```

禁止先检索整个 Tenant 或跨权限内容，再在模型输出后过滤。

### 14.5 Citation

Knowledge API 不返回纯 String。

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

AI 结果必须可以追溯来源。

### 14.6 Knowledge 的三种消费方式

``` text
Human Search
AI Search
Skill Context
```

Knowledge 是 Workspace 一级产品能力，不只是给 ChatBot 上传 PDF 的后台。

------------------------------------------------------------------------

## 15. Integration Runtime

``` text
Integration Platform
├── Connector Registry
├── Connection
├── Protocol Adapters
│   ├── MCP
│   ├── REST
│   ├── Webhook
│   ├── Database
│   └── SDK
├── Sync Runtime
├── Event Runtime
└── Integration Audit
```

原则：

> Native by Default, Connect when Available.

内部第一方 App 不通过 MCP 调自己的业务能力。

MCP 用于外部互操作：

``` text
Our Agent
→ Tool Registry
→ Integration Runtime
→ MCP Client
→ External MCP Server
```

或：

``` text
External Agent
→ Our MCP Server
→ Auth / Tenant / Permission
→ Tool Registry
→ Application Service
```

------------------------------------------------------------------------

## 16. Business Applications

ERP / CRM / MES 是平台内一等应用，不是外部系统适配器。

业务结构：

``` text
business-apps/erp/
├── domain/
├── application/
├── public/
├── infrastructure/
├── api/
├── web/
└── ai/
    ├── assistants/
    ├── skills/
    └── tools/
```

`ai/` 保存定义与适配，不承载 Runtime。

跨 App：

``` text
App A
→ App B Public Contract / Public Application Service
```

禁止 import 另一个 App 的 internals。

------------------------------------------------------------------------

## 17. 现有 ERP / CRM / MES 重构策略

旧系统作为：

``` text
Business Requirement
+
Reference Implementation
```

而不是：

-   原样复制
-   外部 API 集成
-   一开始拆微服务

流程：

``` text
Legacy System
→ Capability Inventory
→ Domain Ownership Map
→ New App Specification
→ Clean Reimplementation
```

建立 Traceability：

``` text
Legacy Feature
→ New Feature ID
→ Domain
→ API
→ UI
→ Permission
→ AI
→ Test
→ Migration/N/A
→ Status
```

------------------------------------------------------------------------

## 18. Industry Layer

行业不是 Platform Core。

``` text
industries/
├── construction/
├── manufacturing/
├── retail/
└── ...
```

行业层可以拥有：

``` text
Industry Shared
Industry Skills
Industry Knowledge Templates
Industry Tools
Industry Apps
```

但只有出现真实重复后才抽象。

建筑行业可能包含：

``` text
AI 项目经营
AI 商务经营
AI 项目总控
AI 咨询作业
AI Design Operations
```

Platform Core 禁止出现 Variation / RFI / Drawing / BOQ / BOM
等行业概念。

------------------------------------------------------------------------

## 19. Shared Capability Promotion

``` text
Level 0 App Local
↓
Level 1 Duplicate
↓
Level 2 Candidate Shared
↓
Level 3 Architecture Review
↓
Shared
```

成为 Shared 的条件：

-   至少两个真实消费者
-   语义一致
-   生命周期一致
-   权限模型一致
-   抽象后没有明显业务泄漏

不做自动 Promotion Engine。

------------------------------------------------------------------------

## 20. Admin 模型

### 20.1 Tenant 360°

``` text
Tenant
├── Overview
├── Apps
├── AI
├── Knowledge
├── Connections
├── Model Policy
├── Usage / Quota
├── Audit
└── Configuration
```

### 20.2 Tenant Admin 权限模型

``` text
Tenant
↓
Organization
↓
Member
↓
Role
↓
Permission
↓
App / Data / AI / Knowledge
```

App Admin 仍然归 App 自己，例如 ERP 设置：

``` text
财务
采购
库存
编码规则
业务参数
```

------------------------------------------------------------------------

## 21. Audit / Observability / Evaluation

企业 AI 必须可追溯。

AI Audit 至少记录：

``` text
tenantId
userId
membershipId
appId
agentId
skillId
sessionId
toolCalls
resourceIds
knowledgeSources
model
approval
status
duration
usage
timestamp
```

同时建设：

``` text
Logs
Metrics
Tracing
Model Usage
Token / Cost
Tool Error
Retrieval Quality
Agent Evaluation
Skill Evaluation
```

Skill 应支持版本与 Eval Cases。

------------------------------------------------------------------------

## 22. Security

必须验证：

1.  Tenant Isolation
2.  User Permission
3.  Data Scope
4.  Agent Scope
5.  Knowledge Permission
6.  Tool Risk
7.  Approval
8.  Secret Management
9.  Audit Integrity
10. Third-party adapter isolation

核心规则：

> Prompt 不是安全边界。\
> Runtime 不是权限 Source of Truth。\
> RAG Engine 不是权限 Source of Truth。

------------------------------------------------------------------------

## 23. Infrastructure Adapter Strategy

统一模式：

``` text
AgentRuntime
→ OpenClawRuntimeAdapter

KnowledgeEngine
→ RAGFlowAdapter

ModelGateway
→ ProviderAdapter

Integration
→ MCP / REST / Webhook Adapter
```

所有 Adapter：

-   不拥有 Tenant Domain
-   不拥有 Permission Source of Truth
-   不拥有业务数据 Source of Truth
-   不向业务层泄漏第三方 SDK
-   必须可被 Contract Test
-   必须可替换

------------------------------------------------------------------------

## 24. 部署策略

保持一个代码库，可支持不同部署模式：

``` text
Cloud SaaS
Dedicated Tenant
Private Deployment
Hybrid Deployment
```

Provider / Storage / Model / Integration 通过配置与 Adapter 替换。

避免为不同客户维护分叉产品代码。

------------------------------------------------------------------------

## 25. 开发路线

``` text
Stage 1
Platform Foundation
+ Admin Foundation
+ AI Core Contracts
+ Agent Runtime PoC
+ Knowledge Engine PoC
+ First Real AI Native Business Loop

Stage 2
Continue ERP
+ More Skills / Tools
+ Approval / Tasks
+ Knowledge maturity

Stage 3
CRM
+ Cross-App validation

Stage 4
MES
+ Manufacturing scenarios

Stage 5
Architecture Review
+ Shared capability promotion

Stage 6
Industry Apps
```

------------------------------------------------------------------------

## 26. 当前优先技术决策

### Agent Execution Infrastructure

优先 PoC：

``` text
OpenClaw
```

对照：

``` text
OpenAI Agents / Minimal Native Runtime
```

评估：

-   Agent loop
-   Tool calling
-   streaming
-   session
-   context
-   compaction
-   hooks
-   permission integration
-   audit integration
-   MCP
-   model flexibility
-   deployment
-   failure handling
-   maintenance cost

### Knowledge Engine

优先 PoC：

``` text
RAGFlow
```

对照：

``` text
Native baseline / other replaceable engine
```

评估：

-   中文 PDF / Word / Excel / PPT
-   扫描件 / OCR
-   Layout / Table
-   Chunk quality
-   Hybrid retrieval
-   Reranking
-   Citation metadata
-   Incremental update
-   Permission filter integration
-   Deployment / performance / operations

功能 PoC 与 Self-hosted 基础设施 PoC 均通过后，才决定是否成为默认 Infrastructure。Cloud Free 阶段仅使用公开、测试或脱敏资料，不上传真实客户敏感数据。

------------------------------------------------------------------------

## 27. 明确不做

当前阶段不建设：

``` text
Generic APaaS / Low-code Runtime
Object / Form / View Builder

Agent Builder
Skill Builder
Workflow Builder
Marketplace

默认 Enterprise Agent
Master/Sub Agent Framework
Agent-to-Agent
Multi-Agent by default
Intelligent Agent Router

Complex Durable / Distributed Runtime

Knowledge Graph / Ontology Builder
Knowledge Agent

Automatic Capability Promotion

大量无真实场景的 Industry Abstraction
```

------------------------------------------------------------------------

## 28. 最终架构判断标准

平台必须同时做到：

``` text
业务应用是真实业务系统
+
AI 通过正式 Agent / Skill / Tool 执行业务
+
AI 权限与人一致
+
企业知识有权限、有来源、有治理
+
Runtime / RAG / Model / Integration 可替换
+
Tenant / Permission / Business Data 永远掌握在平台自己手里
+
所有关键 AI 行为可审计
```

最终原则：

> **Workspace 是员工工作的地方。**\
> **Business Apps 是业务事实与交易的来源。**\
> **Knowledge Platform 是企业知识的来源。**\
> **Enterprise AI Control Plane 决定 AI 能做什么、以什么权限做。**\
> **Agent Execution Infrastructure 负责把 Agent 跑起来。**\
> **Knowledge Engine Infrastructure 负责把文档变成可检索知识。**\
> **Platform Admin 决定客户拥有什么。**\
> **Tenant Admin 决定客户内部谁能使用。**\
> **平台掌握企业语义和治理；底层基础设施保持可替换。**
