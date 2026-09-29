# Enterprise AI Application Platform --- V0.1 Product & Technical Specification

> **用途**：本文件是交给 Codex 的 V0.1 主实施规格。\
> **目标**：Codex
> 应依据本文建立代码仓库、平台骨架和第一个建筑行业应用的端到端 Vertical
> Slice。\
> **状态**：V0.1 Architecture Baseline\
> **核心原则**：不要实现通用
> APaaS。应用采用正常代码开发；平台只沉淀真正跨应用、跨行业复用的企业 AI
> 基础能力。

------------------------------------------------------------------------

## 0. 给 Codex 的执行指令

请将本文视为当前阶段的 **Source of Truth**。

实施时遵循以下优先级：

1.  先保证核心端到端业务闭环可以运行。
2.  再保证多租户、权限、AI、知识、审计边界正确。
3.  再优化代码复用、UI 和工程体验。
4.  不要为了"未来可能需要"提前建设通用低代码/APaaS能力。
5.  不要未经明确需求增加大型基础设施、微服务、事件总线、工作流设计器、插件市场等。
6.  如果某项抽象只被一个业务模块使用，优先保留在该业务模块内部。
7.  如果未来出现重复需求，再将稳定能力提升到 shared/platform。
8.  所有 AI 行为必须遵守与普通用户相同的数据权限和 Tenant 边界。
9.  AI 不得绕过业务 Service 直接任意修改数据库。
10. 所有重要 AI Tool 调用和业务写操作必须可审计。
11. V0.1 优先选择简单、成熟、可维护的实现。
12. V0.1 首先做 Modular Monolith，不要拆成大量微服务。

------------------------------------------------------------------------

# 1. 产品定义

## 1.1 产品是什么

本产品是一个：

**Enterprise AI Application Platform（企业 AI 应用平台）**

平台提供企业级共享能力，在其上开发多个 **Code-native AI Business
Apps**。

第一阶段聚焦建筑行业，未来可以扩展制造、零售、物流等行业。

产品不是传统低代码平台，也不是通用 APaaS。

核心开发模式：

``` text
Shared Enterprise AI Platform
            +
       Industry Layer
            +
      Code-native Apps
            +
      AI-assisted Coding
```

AI/Codex
是我们的软件研发方式之一，而不是要求业务应用运行在一个通用低代码解释器上。

------------------------------------------------------------------------

## 1.2 产品长期结构

``` text
┌──────────────────────────────────────────────┐
│               Business Apps                  │
│                                              │
│ Construction                                 │
│ ├─ AI Project Operations                     │
│ ├─ AI Commercial Operations                  │
│ ├─ AI Owner Project Control                  │
│ ├─ AI Consulting Workspace                   │
│ └─ AI Design Operations                      │
│                                              │
│ Future Industries                            │
│ ├─ Manufacturing Apps                        │
│ ├─ Retail Apps                               │
│ └─ ...                                       │
├──────────────────────────────────────────────┤
│                Industry Layer                │
│                                              │
│ Construction Domain / Skills / Knowledge     │
│ Manufacturing Domain / Skills / Knowledge    │
│ ...                                          │
├──────────────────────────────────────────────┤
│          Enterprise AI Platform              │
│                                              │
│ Tenant / Identity / Organization             │
│ Permission / AI Gateway / Model Gateway      │
│ Knowledge / Integration / File               │
│ Notification / Audit                         │
├──────────────────────────────────────────────┤
│               Infrastructure                 │
│ DB / Object Storage / Queue / Cache / Models │
└──────────────────────────────────────────────┘
```

------------------------------------------------------------------------

# 2. V0.1 的目标

V0.1 不追求完整产品。

V0.1 要证明以下命题：

> 在严格 Tenant、权限、知识和审计约束下，AI
> 可以读取企业合同和项目资料，识别潜在业务事件，并通过受控 Tool
> 创建业务对象，最终协助用户完成一个真实的建筑业务闭环。

第一个应用：

# AI Project Operations / AI 项目经营

第一条端到端 Vertical Slice：

``` text
创建企业
    ↓
创建项目
    ↓
上传合同
    ↓
AI解析合同关键条款
    ↓
上传会议纪要
    ↓
AI识别潜在变更
    ↓
人工确认
    ↓
创建 ChangeEvent
    ↓
AI生成签证/变更通知草稿
    ↓
人工审核
    ↓
创建/更新 Variation
    ↓
跟踪状态和金额
```

如果这一条链路稳定运行，V0.1 即成功。

------------------------------------------------------------------------

# 3. V0.1 明确不做什么

Codex 不得在没有新需求的情况下实现以下能力：

-   通用 APaaS
-   Object Builder
-   Form Builder
-   Page Builder
-   Drag-and-drop UI Builder
-   Workflow Designer
-   BPMN Designer
-   通用 Rule Engine
-   通用 App Builder
-   App Marketplace
-   Plugin Marketplace
-   客户直接通过 AI 修改生产代码
-   自动生成任意企业应用
-   完整 ERP
-   完整财务系统
-   完整采购系统
-   BIM Viewer
-   CAD Editor
-   AI 自动设计
-   AI 自动算量
-   Billing / Subscription
-   复杂多 Agent Framework
-   大规模微服务架构
-   Kubernetes-first 架构
-   独立 Graph Database
-   为每个应用建设独立身份系统
-   为每个应用建设独立知识系统
-   为每个应用建设独立后台系统

------------------------------------------------------------------------

# 4. 核心架构原则

## 4.1 Monorepo

V0.1 使用一个 Monorepo。

代码在一个仓库中，但必须保持模块边界。

建议结构：

``` text
enterprise-ai-platform/
│
├── apps/
│   ├── web/                     # 统一业务 Web Shell
│   └── admin/                   # 统一企业管理后台
│
├── services/
│   ├── api/                     # Modular Monolith API
│   └── worker/                  # AI / document async jobs
│
├── packages/
│   ├── ui/
│   ├── sdk/
│   ├── ai-sdk/
│   ├── auth/
│   └── common/
│
├── platform/
│   ├── tenant/
│   ├── identity/
│   ├── organization/
│   ├── permission/
│   ├── ai/
│   ├── knowledge/
│   ├── integration/
│   ├── file/
│   ├── notification/
│   └── audit/
│
├── industries/
│   └── construction/
│       ├── shared/
│       ├── knowledge/
│       ├── ai/
│       └── apps/
│           └── project-operations/
│
├── infrastructure/
│
├── docs/
│
└── tests/
```

实际技术栈可以根据仓库现状调整，但模块边界必须保留。

------------------------------------------------------------------------

## 4.2 Modular Monolith

V0.1 后端优先一个 API 服务。

不要第一天拆：

``` text
user-service
tenant-service
contract-service
project-service
ai-service
knowledge-service
```

推荐：

``` text
API Service
│
├── Platform Modules
│   ├── Tenant
│   ├── Identity
│   ├── Organization
│   ├── Permission
│   ├── AI
│   ├── Knowledge
│   ├── File
│   ├── Integration
│   └── Audit
│
└── Construction Modules
    └── Project Operations
        ├── Project
        ├── Contract
        ├── Document
        ├── ChangeEvent
        └── Variation
```

异步 AI / 文档解析使用 Worker。

------------------------------------------------------------------------

## 4.3 Code-native Apps

业务应用直接写正常代码。

例如：

``` text
project-operations/
├── project/
├── contract/
├── document/
├── change-event/
├── variation/
├── dashboard/
├── ai/
└── admin/
```

不要将业务对象抽象成通用 `ObjectDefinition`。

不要让业务 UI 依赖动态 Form Schema 才能运行。

------------------------------------------------------------------------

## 4.4 抽象原则

遵循：

> Code first → Config when needed → Platform when repeated.

以及：

> 第一次出现放应用内；重复出现后观察；确认稳定复用后再提升到
> shared/platform。

不要因为两个行业都有 `Project` 或 `Contract` 就立刻合并模型。

例如：

``` text
construction.Project
manufacturing.Project
```

可以长期独立存在。

------------------------------------------------------------------------

# 5. 多租户模型

## 5.1 Tenant 是第一等安全边界

系统必须从第一天支持多租户。

主要模型：

``` text
User
Tenant
TenantMembership
Organization
Role
Permission
```

关系：

``` text
User
  │
  └── TenantMembership
          │
          ├── Tenant
          ├── Organization
          └── Roles
```

一个 User 可以属于多个 Tenant。

------------------------------------------------------------------------

## 5.2 TenantMembership

建议字段：

``` text
id
tenant_id
user_id
organization_id
status
job_title
joined_at
created_at
updated_at
```

Role 建议通过关联表实现，不要只在 membership 中存一个字符串角色。

------------------------------------------------------------------------

## 5.3 Tenant Scope

所有 Tenant 私有数据必须携带：

``` text
tenant_id
```

至少包括：

-   organization
-   project
-   contract
-   document
-   change_event
-   variation
-   knowledge_space
-   knowledge_document
-   ai_session
-   ai_task
-   ai_tool_call
-   integration
-   audit_log

禁止仅依赖前端传递 tenant_id。

后端必须从认证上下文解析当前 Tenant，并强制作用到查询。

------------------------------------------------------------------------

## 5.4 Request Context

每个请求建立统一 Context：

``` ts
type RequestContext = {
  tenantId: string
  userId: string
  membershipId: string
  organizationId?: string
  roles: string[]
  permissions: string[]
}
```

AI 执行时扩展为：

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
}
```

所有 AI Retrieval、Tool Call、业务查询必须继承此 Context。

------------------------------------------------------------------------

# 6. 权限模型

V0.1 使用简单 RBAC + Resource Scope。

不要一开始实现复杂 ABAC Policy Language。

初始角色：

``` text
TenantAdmin
AppAdmin
ProjectManager
CommercialManager
ProjectMember
Viewer
```

权限建议采用明确 action：

``` text
project.read
project.create
project.update

contract.read
contract.create
contract.update

document.read
document.upload

change_event.read
change_event.create
change_event.confirm
change_event.update

variation.read
variation.create
variation.update
variation.approve

admin.manage_members
admin.manage_app
```

同时支持 Project Scope：

``` text
all_projects
assigned_projects
specific_projects
```

AI Tool 必须调用同一套 Permission Service。

------------------------------------------------------------------------

# 7. 统一管理后台

产品采用：

> One Admin Console, Multiple App Admin Modules.

不是每个应用建设独立后台。

------------------------------------------------------------------------

## 7.1 Tenant Admin

统一企业管理后台包含：

``` text
企业概览

组织与成员
├── 组织架构
├── 成员
└── 角色

登录与安全
├── 登录方式
├── SSO（预留）
└── 安全策略

AI
├── 模型配置
├── AI能力状态
└── AI使用情况

企业知识
├── Knowledge Spaces
├── 文档来源
└── 权限

集成
├── API
├── Webhook
└── Connectors

应用
└── AI项目经营

审计
└── Audit Logs
```

V0.1 页面可以只实现必要子集。

------------------------------------------------------------------------

## 7.2 App Admin

`AI 项目经营` 在统一 Admin Console 内注册自己的管理模块：

``` text
AI项目经营
├── 概览
├── 成员与权限
├── 项目设置
├── 合同设置
├── 变更/签证设置
├── AI能力
├── 知识
└── 运行记录
```

第一版不要为了页面完整度做大量无实际功能的设置项。

------------------------------------------------------------------------

# 8. 第一应用：AI 项目经营

## 8.1 用户

主要用户：

### Tenant Admin

负责企业设置、成员和应用权限。

### Project Manager

管理项目和项目资料。

### Commercial Manager

负责合同、变更、签证等商务业务。

### Project Member

上传资料、查看自己有权限的数据。

------------------------------------------------------------------------

# 9. 核心业务模型

V0.1 只实现必要模型。

------------------------------------------------------------------------

## 9.1 Project

``` text
id
tenant_id

code
name
description

client_name
location

status

start_date
planned_end_date

created_by
created_at
updated_at
```

------------------------------------------------------------------------

## 9.2 Contract

``` text
id
tenant_id
project_id

contract_no
name

counterparty
contract_type

currency
contract_amount

signed_date
effective_date

status

document_id

created_by
created_at
updated_at
```

------------------------------------------------------------------------

## 9.3 ContractClause

用于保存 AI 从合同中提取的重要结构化条款。

``` text
id
tenant_id
project_id
contract_id

clause_type
title
content
source_reference

notice_period_days
confidence

ai_generated
confirmed_by
confirmed_at

created_at
updated_at
```

初始 clause_type：

``` text
variation
notice
claim
payment
extension_of_time
other
```

------------------------------------------------------------------------

## 9.4 Document

Document 作为业务文档元数据。

``` text
id
tenant_id
project_id?

name
file_id

document_type

source
status

uploaded_by
created_at
updated_at
```

初始 document_type：

``` text
contract
meeting_minutes
variation_support
other
```

------------------------------------------------------------------------

## 9.5 ChangeEvent

潜在或确认的项目变更事件。

``` text
id
tenant_id
project_id

title
description

source_document_id?

event_date
detected_at

status

estimated_amount?
currency?

confidence?

ai_generated
confirmed_by?
confirmed_at?

created_by
created_at
updated_at
```

建议状态：

``` text
detected
confirmed
rejected
converted
closed
```

------------------------------------------------------------------------

## 9.6 ChangeEvidence

``` text
id
tenant_id
change_event_id
document_id

quote_or_summary
source_reference

created_at
```

必须能够追溯 AI 为什么判断存在变更。

------------------------------------------------------------------------

## 9.7 Variation

``` text
id
tenant_id
project_id
contract_id?
change_event_id?

variation_no
title
description

status

claimed_amount?
approved_amount?
currency?

notice_date?
submitted_date?
approved_date?

draft_document_id?

created_by
created_at
updated_at
```

建议状态：

``` text
draft
internal_review
submitted
under_review
approved
rejected
closed
```

V0.1 不需要通用 Workflow Engine。

状态转换在 Variation Service 内明确实现。

------------------------------------------------------------------------

# 10. 文件与文档系统

平台提供共享 File Service。

File 负责：

``` text
file id
tenant_id
storage key
original filename
mime type
size
checksum
uploaded_by
created_at
```

业务 Document 引用 File。

不要让业务模块直接依赖 S3/OSS/MinIO SDK。

定义 StorageProvider：

``` ts
interface StorageProvider {
  upload(...)
  download(...)
  getSignedUrl(...)
  delete(...)
}
```

SaaS 和私有化可以使用不同实现。

------------------------------------------------------------------------

# 11. Knowledge Platform

## 11.1 原则

不要把 Knowledge 简化成：

``` text
PDF → chunk → embedding → vector DB
```

Knowledge 是 AI 获取企业上下文的统一层。

V0.1 先实现：

``` text
Document ingestion
Text extraction
Chunking
Embedding
Retrieval
Permission filtering
Source citation
```

同时允许 AI 通过业务 Tool 查询结构化对象。

最终 AI Context 来自：

``` text
Unstructured Knowledge
        +
Structured Business Data
```

------------------------------------------------------------------------

## 11.2 Knowledge Scope

至少支持：

``` text
Platform
Tenant
App
Project
```

V0.1 重点：

``` text
Tenant
Project
```

Knowledge 记录必须至少携带：

``` text
tenant_id
project_id?
document_id
source_type
permission_scope
version
```

------------------------------------------------------------------------

## 11.3 Retrieval 权限

流程必须是：

``` text
User
 ↓
Tenant Context
 ↓
Permission / Project Scope
 ↓
Allowed Knowledge Scope
 ↓
Retrieval
 ↓
AI
```

禁止：

``` text
全库向量搜索
 ↓
拿结果以后再让 AI 自己判断能不能看
```

权限过滤必须在 Retrieval 层完成。

------------------------------------------------------------------------

# 12. AI Gateway

AI Gateway 是所有业务 AI 调用的统一入口。

不要让各业务模块直接散落调用模型 Provider。

------------------------------------------------------------------------

## 12.1 AI Gateway 责任

``` text
Context Resolution
Model Routing
Prompt/Instruction Assembly
Knowledge Retrieval
Tool Registration
Tool Permission Check
Tool Execution
Approval Check
Tracing
Audit
Usage
```

------------------------------------------------------------------------

## 12.2 Model Gateway

业务代码不得硬编码某个模型供应商。

定义：

``` ts
interface ModelGateway {
  generateText(...)
  generateStructured(...)
  embed(...)
}
```

模型逻辑角色：

``` text
reasoning_model
fast_model
embedding_model
vision_model
```

Deployment/Tenant 决定具体 Provider。

V0.1 可以只实现一个实际 Provider，但接口必须抽象。

------------------------------------------------------------------------

# 13. AI Tool 模型

AI 不允许直接自由执行 SQL。

AI 通过显式 Tool 调用业务 Service。

例如：

``` text
project.get
contract.get
contract.list_clauses

document.get

change_event.search
change_event.get
change_event.create

variation.get
variation.create_draft
variation.update
```

Tool 实际调用：

``` text
AI
 ↓
Tool Gateway
 ↓
Permission Check
 ↓
Policy Check
 ↓
Business Service
 ↓
Database
 ↓
Audit
```

Tool 必须：

-   有明确 input schema
-   有明确 output schema
-   验证 tenant
-   验证 permission
-   记录 audit
-   不允许任意数据库访问

------------------------------------------------------------------------

# 14. AI Action Risk

V0.1 定义简单风险等级：

``` text
L0 Read
L1 Draft
L2 Internal Write
L3 External Action
L4 Financial / Legal
```

V0.1 实际使用：

### L0

读取合同、项目、知识。

自动允许。

### L1

生成合同分析、变更建议、签证草稿。

自动允许，但标记 AI Generated。

### L2

创建 ChangeEvent / 更新业务对象。

需要业务权限；关键动作需要用户确认。

### L3/L4

V0.1 不实现真正自动外发或财务/法律执行。

------------------------------------------------------------------------

# 15. 三个 V0.1 AI Capability

不要构建万能 Agent。

只实现以下三个明确能力。

------------------------------------------------------------------------

## 15.1 Contract Intelligence

输入：

``` text
Contract Document
```

输出：

``` text
Contract Summary
Key Clauses
Variation Clause
Notice Requirements
Claim Requirements
Payment Terms
Potential Risks
Source References
```

关键条款保存为 `ContractClause`。

AI 结果必须可以追溯原文位置。

------------------------------------------------------------------------

## 15.2 Change Detection

输入：

``` text
Meeting Minutes / Project Document
+
Project
+
Contract Clauses
```

输出：

``` text
Potential Change Events[]
```

每个候选事件包含：

``` text
title
description
reason
evidence
related_contract_clause
confidence
suggested_next_action
```

不要自动直接确认。

UI 显示：

``` text
AI发现潜在变更
        ↓
用户查看证据
        ↓
确认 / 驳回
```

确认后创建或确认 `ChangeEvent`。

------------------------------------------------------------------------

## 15.3 Variation Drafting

输入：

``` text
Confirmed ChangeEvent
+
Contract
+
Relevant Contract Clauses
+
Evidence Documents
```

输出：

``` text
Variation / Notice Draft
```

保存为草稿。

用户审核后才进入后续业务状态。

------------------------------------------------------------------------

# 16. AI Session 与 Task

## 16.1 AISession

``` text
id
tenant_id
user_id
app_id
project_id?

session_type
created_at
updated_at
```

------------------------------------------------------------------------

## 16.2 AITask

用于长任务：

``` text
id
tenant_id
session_id?

task_type
status

input
output
error

model
started_at
completed_at
created_at
```

状态：

``` text
queued
running
completed
failed
cancelled
```

文档解析和 Change Detection 可以异步执行。

------------------------------------------------------------------------

# 17. Audit

重要操作必须进入统一 Audit Log。

建议：

``` text
id
tenant_id

actor_type
actor_id

action
resource_type
resource_id

request_id
ai_session_id?
ai_task_id?

metadata

created_at
```

actor_type：

``` text
user
ai
system
```

必须能够回答：

> 谁在什么时候因为哪个 AI Task 创建了这个 ChangeEvent？

------------------------------------------------------------------------

# 18. Integration

V0.1 只建设接口和最小实现。

定义 Integration/Connector 抽象，但不要做 Connector Marketplace。

未来支持：

``` text
WeCom
Feishu
Email
ERP
BIM
Database
MCP
Webhook
```

V0.1 优先：

``` text
Webhook
Generic API
```

如果第一客户需要具体企业系统，再实现对应 Connector。

------------------------------------------------------------------------

# 19. 管理配置原则

不要把所有后端能力暴露为 UI 配置。

分三层：

``` text
Platform Defaults
       ↓
Tenant / App Config
       ↓
Business Data
```

例如：

平台后端决定：

``` text
tenant isolation
audit mechanism
AI execution context
tool permission
file storage
knowledge permission filtering
```

企业后台可以配置：

``` text
enabled login methods
member roles
AI feature enable/disable
selected integrations
app business thresholds
notification preferences
```

如果当前没有真实客户差异，优先代码默认值，不要提前制作配置页面。

------------------------------------------------------------------------

# 20. 前端信息架构

## 20.1 Business Web

统一 Web Shell：

``` text
Logo / Tenant
────────────────

应用

AI项目经营
├── 首页
├── 项目
├── 合同
├── 变更
├── 签证
├── 文档
├── 任务
└── AI

────────────────
企业管理（有权限时）
```

------------------------------------------------------------------------

## 20.2 首页

V0.1 Dashboard 保持简单：

``` text
项目数量
待确认潜在变更
进行中签证
待处理任务

最近 AI 发现
最近文档
最近变更
```

不要投入大量 BI 能力。

------------------------------------------------------------------------

## 20.3 Project Detail

项目详情建议：

``` text
项目概览
合同
文档
潜在变更
签证
AI
```

项目是 V0.1 主要上下文边界。

------------------------------------------------------------------------

# 21. Admin Console

统一 Admin Shell。

建议路由：

``` text
/admin

/admin/organization
/admin/members
/admin/security
/admin/ai
/admin/knowledge
/admin/integrations
/admin/audit

/admin/apps/project-operations
```

App Admin Module 可以由应用注册到 Admin Shell。

不要单独部署一套 Project Operations Admin。

------------------------------------------------------------------------

# 22. API 设计

推荐 REST 优先，保持简单。

统一前缀：

``` text
/api/v1/
```

示例：

``` text
GET    /api/v1/projects
POST   /api/v1/projects
GET    /api/v1/projects/:id

POST   /api/v1/projects/:id/contracts
GET    /api/v1/contracts/:id

POST   /api/v1/documents/upload

POST   /api/v1/contracts/:id/analyze

POST   /api/v1/documents/:id/detect-changes

GET    /api/v1/change-events
POST   /api/v1/change-events/:id/confirm
POST   /api/v1/change-events/:id/reject

POST   /api/v1/change-events/:id/variation-draft
```

API 不要求前端传 tenant_id 作为信任来源。

Tenant 来自 authenticated context。

------------------------------------------------------------------------

# 23. 数据库

V0.1 推荐 PostgreSQL。

可以使用同一个数据库。

逻辑模块分表，不要求物理拆库。

最低表集合：

``` text
users
tenants
tenant_memberships

organizations
roles
permissions
membership_roles
role_permissions

projects

files
documents

contracts
contract_clauses

change_events
change_evidence

variations

knowledge_spaces
knowledge_documents
knowledge_chunks

ai_sessions
ai_tasks
ai_tool_calls

integrations

audit_logs
```

所有 Tenant 私有表必须包含 `tenant_id`。

必要索引至少考虑：

``` text
tenant_id
tenant_id + project_id
tenant_id + status
tenant_id + created_at
```

------------------------------------------------------------------------

# 24. 数据一致性原则

业务写操作必须经过 Domain/Application Service。

例如：

``` text
ChangeEventService.confirm()
VariationService.createDraft()
ContractService.attachDocument()
```

不要让：

``` text
Controller
AI Tool
Background Job
```

各自直接写数据库并复制规则。

统一：

``` text
Controller ─┐
AI Tool ────┼─→ Business Service → Repository → DB
Worker ─────┘
```

这样 AI 与人使用同一套业务规则。

------------------------------------------------------------------------

# 25. 事件机制

V0.1 不需要建设 Kafka 等复杂 Event Bus。

可以使用：

``` text
Domain Event
+
DB-backed Job Queue
```

例如：

``` text
DocumentUploaded
ContractAnalysisRequested
ContractAnalyzed
ChangeDetectionRequested
PotentialChangeDetected
ChangeEventConfirmed
VariationDraftRequested
VariationDraftCreated
```

事件主要用于模块解耦和异步任务。

如果未来规模需要，再替换底层实现。

------------------------------------------------------------------------

# 26. Worker

Worker 负责：

``` text
document parsing
embedding
contract analysis
change detection
variation drafting
notifications
```

必须支持：

``` text
retry
failure status
idempotency
logging
tenant context
```

------------------------------------------------------------------------

# 27. 私有化准备

V0.1 不需要完成完整私有化交付，但代码不能把云供应商写死。

抽象：

``` text
StorageProvider
ModelProvider / ModelGateway
QueueProvider
Email/Notification Provider
```

未来 Deployment Mode：

``` text
SaaS
Dedicated
Private
Hybrid
```

业务模块不应该出现：

``` text
if privateDeployment ...
```

Deployment 差异由 Provider/Configuration 处理。

------------------------------------------------------------------------

# 28. Industry Layer

未来架构：

``` text
industries/
├── construction/
│   ├── shared/
│   ├── ai/
│   ├── knowledge/
│   └── apps/
│
├── manufacturing/
│   ├── shared/
│   └── apps/
│
└── ...
```

Platform Core 不允许出现建筑专属概念，例如：

``` text
Variation
RFI
Drawing
BOQ
```

这些必须留在 Construction Layer。

------------------------------------------------------------------------

# 29. 第二应用如何加入

未来 `AI Commercial Operations` 应以新模块加入：

``` text
industries/
  construction/
    apps/
      project-operations/
      commercial-operations/
```

它应直接复用：

``` text
Tenant
Identity
Permission
AI Gateway
Knowledge
Integration
File
Audit
UI package
```

而不是复制这些能力。

如果两个建筑应用都需要某个稳定业务能力，可以逐步提升到：

``` text
industries/construction/shared/
```

但不要提前抽象。

------------------------------------------------------------------------

# 30. 应用管理方式

一个 Tenant 可以启用多个应用。

建议预留：

``` text
App
TenantApp
```

例如：

``` text
App
- project_operations
- commercial_operations

TenantApp
- tenant_id
- app_id
- status
- settings
```

这不是 APaaS App Definition。

它只代表：

> 这个企业是否启用了某个 Code-native Product
> Module，以及该应用的有限配置。

------------------------------------------------------------------------

# 31. AI 修改应用：V0.1 不开放给客户

未来目标可以是：

``` text
Customer Admin
 ↓
AI Change Request
 ↓
Coding Agent
 ↓
Git Branch
 ↓
Tests
 ↓
Preview
 ↓
Review
 ↓
Deploy
```

但 V0.1：

**AI Coding 只作为研发团队内部开发工具。**

客户提出的应用修改需求暂时进入正常产品研发流程。

不要实现 AI 自动修改生产代码。

------------------------------------------------------------------------

# 32. 测试策略

至少覆盖四层。

## 32.1 Unit Test

重点：

``` text
permission
domain services
status transitions
tenant scoping
AI tool authorization
```

## 32.2 Integration Test

重点：

``` text
database
file
knowledge retrieval
AI tool → business service
worker jobs
```

## 32.3 Tenant Isolation Test

必须专门测试：

``` text
Tenant A user
cannot read Tenant B project

Tenant A AI
cannot retrieve Tenant B knowledge

Tenant A tool call
cannot mutate Tenant B object
```

这是 V0.1 的强制验收项。

## 32.4 E2E Test

至少实现核心 Vertical Slice 自动化测试。

------------------------------------------------------------------------

# 33. Observability

V0.1 至少需要：

``` text
structured logs
request id
tenant id
user id
AI task id
error tracking
basic metrics
```

AI 调用记录：

``` text
model
latency
token/usage
tool calls
success/failure
```

注意不要在普通日志中无控制记录完整敏感文档内容。

------------------------------------------------------------------------

# 34. 安全最低要求

必须做到：

-   password 使用成熟认证方案，不自行实现加密协议
-   Tenant 数据隔离
-   后端权限校验
-   文件访问鉴权
-   Signed URL 有时效
-   secrets 不进入代码仓库
-   AI Tool 有 schema 和 permission
-   AI 无任意 SQL 权限
-   AI 无任意网络访问权限
-   Audit 不可由普通用户修改
-   上传文件进行类型/大小校验
-   所有关键 ID 查询同时受 tenant scope 限制

------------------------------------------------------------------------

# 35. UI 原则

V0.1 UI 目标：

``` text
clean
enterprise
simple
AI-native but not chatbot-only
```

AI 不应占据整个产品。

正常业务 UI 仍然存在：

``` text
List
Detail
Form
Dashboard
Status
Task
```

AI 嵌入业务流程：

``` text
AI分析合同
AI发现潜在变更
AI生成草稿
AI解释风险
```

而不是所有事情都要求用户打开聊天框。

------------------------------------------------------------------------

# 36. 第一条完整 User Journey

## Step 1 --- 创建 Tenant

系统创建：

``` text
Tenant
Admin User
TenantMembership
Organization
TenantAdmin Role
```

------------------------------------------------------------------------

## Step 2 --- 创建项目

用户创建：

``` text
Project
```

------------------------------------------------------------------------

## Step 3 --- 上传合同

创建：

``` text
File
Document(type=contract)
Contract
```

------------------------------------------------------------------------

## Step 4 --- AI Contract Analysis

异步：

``` text
ContractAnalysisRequested
        ↓
Worker
        ↓
Knowledge extraction
        ↓
AI Gateway
        ↓
Structured Result
        ↓
ContractClause[]
```

UI 显示合同摘要和关键条款。

------------------------------------------------------------------------

## Step 5 --- 上传会议纪要

创建：

``` text
Document(type=meeting_minutes)
```

完成解析和 Knowledge ingestion。

------------------------------------------------------------------------

## Step 6 --- AI Change Detection

用户点击：

``` text
分析潜在变更
```

系统：

``` text
Meeting Minutes
+
Contract Clauses
+
Project Context
        ↓
AI Gateway
        ↓
Potential Change Events
```

------------------------------------------------------------------------

## Step 7 --- 人工确认

UI 显示：

``` text
潜在变更
原因
证据
合同依据
AI置信度
```

用户：

``` text
确认
或
驳回
```

确认后创建/更新：

``` text
ChangeEvent(status=confirmed)
```

------------------------------------------------------------------------

## Step 8 --- AI Variation Draft

用户点击：

``` text
生成签证草稿
```

AI 使用：

``` text
ChangeEvent
Contract
ContractClause
Evidence
Project
```

生成 Draft。

------------------------------------------------------------------------

## Step 9 --- 人工审核

用户编辑并确认。

Variation：

``` text
draft
→ internal_review
```

V0.1 到这里即可完成主要闭环。

------------------------------------------------------------------------

# 37. 建议技术栈

如果没有既有技术约束，优先采用主流、AI Coding 友好的栈。

一个可行默认：

### Frontend

``` text
TypeScript
React
Next.js
```

### Backend

可选择：

``` text
TypeScript + NestJS/Fastify
```

或团队更熟悉的成熟框架。

如果使用 TypeScript 全栈，可以减少 V0.1 上下文切换。

### Database

``` text
PostgreSQL
```

### ORM

选择成熟 ORM，要求：

-   migration 清晰
-   transaction 支持好
-   tenant scope 容易封装

### Queue

V0.1 选择简单 DB/Redis-backed job queue。

### Storage

S3-compatible interface。

### Vector

优先考虑 PostgreSQL + pgvector，以减少基础设施。

除非真实需求证明不够，否则不要第一版引入独立 Vector Database。

------------------------------------------------------------------------

# 38. 推荐开发阶段

## Milestone 0 --- Repository Foundation

完成：

-   Monorepo
-   lint
-   formatting
-   type checking
-   test framework
-   environment config
-   local development
-   CI baseline

验收：

``` text
one command starts local development
tests run in CI
```

------------------------------------------------------------------------

## Milestone 1 --- SaaS Foundation

完成：

``` text
User
Tenant
Membership
Organization
Auth
RBAC
RequestContext
Tenant Scope
Audit baseline
```

验收：

Tenant A/B 隔离测试全部通过。

------------------------------------------------------------------------

## Milestone 2 --- Project Operations Basic CRUD

完成：

``` text
Project
Contract
Document
ChangeEvent
Variation
```

完成最小业务 UI。

此阶段先不做复杂 AI。

------------------------------------------------------------------------

## Milestone 3 --- File + Knowledge

完成：

``` text
File upload
Document parsing
Knowledge ingestion
Chunk
Embedding
Retrieval
Permission filtering
Citation/source reference
```

验收：

不同 Tenant/Project 的文档检索严格隔离。

------------------------------------------------------------------------

## Milestone 4 --- AI Gateway

完成：

``` text
AIExecutionContext
ModelGateway
AI Session
AI Task
Tool Registry
Permission Check
AI Audit
```

------------------------------------------------------------------------

## Milestone 5 --- Contract Intelligence

完成合同上传 → AI 分析 → ContractClause。

------------------------------------------------------------------------

## Milestone 6 --- Change Detection

完成会议纪要 → AI 候选变更 → 人确认 → ChangeEvent。

------------------------------------------------------------------------

## Milestone 7 --- Variation Draft

完成 ChangeEvent → AI 草稿 → 人审核 → Variation。

此时形成 V0.1 Vertical Slice。

------------------------------------------------------------------------

## Milestone 8 --- Admin + Hardening

补：

``` text
member management
role management
app enablement
AI settings minimum
knowledge admin minimum
audit UI
error handling
observability
E2E tests
```

------------------------------------------------------------------------

# 39. Codex 每个 Milestone 的工作方式

每进入一个 Milestone：

1.  先阅读本文相关章节。
2.  检查现有仓库和前一个 Milestone。
3.  输出简短 implementation plan。
4.  明确需要新增/修改的模块。
5.  实现 migration。
6.  实现 domain/service。
7.  实现 API。
8.  实现必要 UI。
9.  添加测试。
10. 运行 lint/typecheck/test。
11. 修复失败。
12. 更新 `/docs/implementation-status.md`。
13. 不主动扩大范围。

------------------------------------------------------------------------

# 40. Definition of Done

V0.1 最终必须能够现场演示：

``` text
1. 登录
2. 进入某个 Tenant
3. 创建项目
4. 上传合同 PDF
5. AI 提取合同关键条款
6. 上传会议纪要
7. AI 发现潜在变更
8. 查看 AI 证据和合同依据
9. 人工确认变更
10. 系统创建 ChangeEvent
11. AI 生成签证/变更通知草稿
12. 人工审核
13. 创建/更新 Variation
14. Audit 中可以追踪全过程
```

同时证明：

``` text
Tenant A 看不到 Tenant B 数据
AI 也看不到 Tenant B 数据
AI Tool 无法越权写入
Knowledge Retrieval 遵守权限
所有关键 AI 写操作可审计
```

------------------------------------------------------------------------

# 41. V0.1 成功后再决定的事情

不要提前实现。

V0.1 完成并获得真实客户反馈后，再评估：

### V0.2

``` text
approval
notification
project member scope
better dashboards
enterprise integrations
knowledge connectors
more contract intelligence
variation lifecycle
```

### V0.3

开始第二个建筑应用：

``` text
AI Commercial Operations
```

验证 Platform 是否真正复用。

### 后续

只有在多个真实应用重复出现需求后，才考虑：

``` text
shared workflow capability
shared business modules
extension system
customer configuration system
AI-assisted application change
```

------------------------------------------------------------------------

# 42. 长期多行业原则

当进入制造等其他行业时：

``` text
Platform Core
    ↓
Construction Industry
    ↓
Construction Apps

Platform Core
    ↓
Manufacturing Industry
    ↓
Manufacturing Apps
```

所有行业共享：

``` text
Tenant
Identity
Organization
Permission
AI Gateway
Knowledge
Integration
File
Notification
Audit
Deployment abstractions
```

行业业务模型不进入 Platform Core。

------------------------------------------------------------------------

# 43. 最重要的架构约束

Codex 在整个开发过程中必须持续遵守：

### Constraint 1

**不要重新演化成通用 APaaS。**

### Constraint 2

**不要为了复用而过早抽象。**

### Constraint 3

**Tenant 是所有企业数据和 AI 数据的安全边界。**

### Constraint 4

**AI 使用与人相同的业务 Service、权限和审计体系。**

### Constraint 5

**业务应用是正常代码，不是动态 Schema Runtime。**

### Constraint 6

**平台只承载真正跨应用/跨行业共享的能力。**

### Constraint 7

**建筑专属能力属于 Construction Industry Layer。**

### Constraint 8

**一个统一 Admin Console，各应用注册自己的管理模块。**

### Constraint 9

**V0.1 使用 Modular Monolith，避免微服务复杂度。**

### Constraint 10

**优先完成真实业务闭环，而不是建设"看起来完整的平台"。**

------------------------------------------------------------------------

# 44. 最终架构摘要

``` text
                         ┌────────────────────┐
                         │     Web Shell      │
                         │ Business + Admin   │
                         └─────────┬──────────┘
                                   │
                 ┌─────────────────┴─────────────────┐
                 │                                   │
       ┌─────────▼──────────┐              ┌─────────▼──────────┐
       │ Enterprise Platform │              │ Construction Layer │
       │                     │              │                    │
       │ Tenant              │              │ Project Operations │
       │ Identity            │              │                    │
       │ Organization        │              │ Project            │
       │ Permission          │              │ Contract           │
       │ File                │              │ ChangeEvent        │
       │ Knowledge           │              │ Variation          │
       │ AI Gateway          │              │ Construction AI    │
       │ Model Gateway       │              │                    │
       │ Integration         │              └─────────┬──────────┘
       │ Audit               │                        │
       └─────────┬───────────┘                        │
                 └─────────────────┬──────────────────┘
                                   │
                         ┌─────────▼──────────┐
                         │ Modular Monolith   │
                         │ API + Worker       │
                         └─────────┬──────────┘
                                   │
                ┌──────────────────┼──────────────────┐
                │                  │                  │
          PostgreSQL          Object Storage       Models
          + pgvector          S3-compatible       via Gateway
```

------------------------------------------------------------------------

# 45. Codex 的第一项实际任务

在开始编码前：

1.  阅读完整规格。
2.  输出 `/docs/architecture.md`，将本文映射到实际选定技术栈。
3.  输出 `/docs/implementation-plan.md`，拆解 Milestone 0--8。
4.  输出 `/docs/data-model.md`，明确 V0.1 表、字段、关系、索引。
5.  输出 `/docs/security-model.md`，明确 Tenant Scope、RBAC、AI Tool
    权限。
6.  输出建议的最终 Monorepo 目录。
7.  检查是否存在任何不必要的 APaaS/微服务式过度设计。
8.  经确认后，从 **Milestone 0 → Milestone 1** 开始实现。

第一阶段不要直接同时实现所有业务功能。

------------------------------------------------------------------------

# 46. 产品北极星

整个系统最终要做到的不是：

> "AI 可以聊天。"

也不是：

> "AI 可以生成 CRUD。"

而是：

> **AI
> 可以在理解企业身份、权限、业务数据、知识和流程的前提下，安全地参与真实企业业务。**

第一阶段通过建筑行业的：

> **合同 → 会议纪要 → 潜在变更 → 签证**

证明这一点。

如果这个闭环成立，再扩展更多建筑应用；如果多个建筑应用共享平台能力成立，再进入其他行业。

这就是 V0.1 的核心任务。
