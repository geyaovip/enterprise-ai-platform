# 企业 AI 原生应用平台：整体产品规划与分阶段实施路线 V3

> 开发基线：**ERP First + Unified AI Capability Model**
> 面向对象：产品、架构、研发、Codex
> 文档目的：明确平台最终形态、当前开发顺序、各阶段必须实现的能力、暂不实现的能力以及阶段验收标准。

---

## 1. 产品定位

本项目不是传统低代码 APaaS，也不是单纯的 Agent 平台，而是：

> **企业 AI 原生应用平台**

平台同时承载三类能力：

1. 企业通用业务应用：ERP、CRM、MES 等；
2. 行业 AI 原生应用：建筑、制造、零售、物流等行业应用；
3. 企业 AI 能力：Agent、Skill、Tool、Knowledge、Model、Workflow/Runtime。

最终目标：

```text
企业工作入口
    ↓
业务应用 + AI 助手
    ↓
Agent
    ↓
Skill
    ↓
Tool / Knowledge
    ↓
自有应用 / 客户系统 / 外部服务
```

核心原则：

> **App owns business. Skill owns reusable intelligence. Agent owns task orchestration. Platform owns governance and execution.**

中文表达：

> **应用承载业务，Skill 承载可复用智能，Agent 负责组织任务，平台负责治理与执行。**

---

## 2. 当前阶段的最重要决策

### 2.1 ERP First

ERP 已经进入开发，因此平台建设不能暂停 ERP，也不能先独立建设一个庞大的 AI 平台。

正确路线：

```text
ERP 正常开发
    +
最小企业平台能力
    +
最小 AI Core
    ↓
ERP Native Tools
    ↓
ERP Skills
    ↓
ERP Assistant
    ↓
第一个 AI Native ERP 闭环
```

ERP 是平台第一个真实宿主应用，也是 AI Core 的第一个真实验证场景。

### 2.2 Unified AI Capability Model

V1 不建立三套 Platform / Industry / App Agent、Skill、Tool、Knowledge 技术体系。

统一为：

```text
AgentDefinition
SkillDefinition
ToolDefinition
KnowledgeSource
```

通过以下属性表达归属和可用范围：

```text
owner
scope
permission
tenant/context
```

平台级、行业级、应用级只是能力未来形成的不同作用域，不是不同技术框架。

### 2.3 按真实复用演进

AI 能力默认留在首次产生它的业务中。

```text
第一次出现
→ App Local

第二个消费者出现
→ 比较语义和业务规则

确认稳定复用
→ Architecture Review

再决定提升为 Industry / Platform capability
```

原则：

> **Business first → Capability second → Reuse third → Abstraction last.**

---

# 3. 总体架构

```text
Users / Channels
Web | Mobile | Feishu | WeCom | DingTalk | API | External AI
                    ↓
Enterprise Workspace
工作台 | 应用中心 | 企业 AI | 待办 | 消息 | 搜索
                    ↓
Application Layer
├── ERP
├── CRM
├── MES
├── Construction Apps
├── Manufacturing Apps
└── Future Apps
                    ↓
Enterprise AI Layer
├── AI Gateway
├── Agent Registry
├── Skill Registry
├── Tool Registry
├── Knowledge
├── Agent Runtime
├── Model Gateway
├── Policy / Approval
├── Session / Task
├── Audit / Trace
└── Evaluation
                    ↓
Platform Core
├── Tenant
├── Identity
├── Organization
├── Permission
├── App Registry
├── File
├── Integration
├── Notification
├── Jobs
└── Audit
                    ↓
Infrastructure
PostgreSQL | pgvector | Object Storage | Redis/Queue | Model Providers
```

---

# 4. 应用、Agent、Skill、Tool、Knowledge 的关系

## 4.1 Application

应用是真正承载业务对象、状态、规则和流程的地方。

例如 ERP：

```text
Supplier
PurchaseOrder
Inventory
Contract
Receivable / Payable
Invoice
...
```

ERP 必须首先是一套正常可用的企业业务应用，而不是 Agent 的插件集合。

## 4.2 Tool

应用把适合 AI 使用的业务能力暴露为 Tool。

```text
Agent / Skill
    ↓
Tool Registry
    ↓
Tool Executor
    ↓
Permission / Policy / Approval
    ↓
ERP Application Service
    ↓
ERP Domain
    ↓
Database
```

禁止：

```text
Agent → ERP Repository
Agent → ERP Database
Skill → ERP Database
```

第一批 ERP Tool 示例：

```text
erp.supplier.query
erp.purchase_order.query
erp.inventory.query
erp.contract.query
erp.payable.query
erp.purchase_request.create_draft
```

不是所有 ERP 功能都必须变成 Tool，只暴露真实 AI 场景需要的能力。

## 4.3 Skill

Skill 是可执行、可测试、可版本化的 AI 专业能力，而不是一段 Prompt。

```text
SkillDefinition
├── id / code / name
├── owner
├── purpose
├── inputSchema
├── outputSchema
├── instructions
├── allowedTools
├── knowledgeScopes
├── executionStrategy
├── riskLevel
├── version
└── evaluationCases
```

ERP 示例：

```text
erp.supplier_risk_analysis
erp.inventory_risk_analysis
erp.purchase_analysis
```

## 4.4 Agent

Agent 负责根据用户目标组织 Skill、Tool、Knowledge 和模型完成任务。

V1 只有一个 `AgentDefinition` 模型，不建立 AppAgent / IndustryAgent / EnterpriseAgent 三套类型。

示例：

```text
ERP Assistant
├── allowedApps: [erp]
├── allowedSkills: [erp.*]
├── allowedTools: [erp.*]
├── knowledgeScopes
├── modelPolicy
├── permissionPolicy
└── approvalPolicy
```

未来 Enterprise Assistant 仍然是同一个 AgentDefinition：

```text
Enterprise Assistant
├── allowedApps: [erp, crm, mes]
├── allowedSkills: [...]
└── allowedTools: [...]
```

## 4.5 Knowledge

V1 不建设平台知识库、行业知识库、企业知识库、应用知识库、项目知识库等多套系统。

统一：

```text
KnowledgeSource
├── tenantId
├── ownerType
├── ownerId
├── appId?
├── resourceType?
├── resourceId?
├── permissionScope
├── source metadata
└── content/index metadata
```

知识检索由 AIExecutionContext + Permission 决定当前允许访问的内容。

原则：

> **能力共用，数据隔离。**

---

# 5. Enterprise AI Core

AI Core 的目标不是替代业务应用，而是成为企业 AI 的统一控制与执行层。

推荐结构：

```text
platform/ai/
├── context/
│   └── AIExecutionContext
├── agents/
│   ├── definition
│   ├── registry
│   └── execution
├── skills/
│   ├── definition
│   ├── registry
│   └── execution
├── tools/
│   ├── definition
│   ├── registry
│   └── executor
├── knowledge/
│   ├── source
│   └── provider
├── runtime/
│   └── AgentRuntime
├── models/
│   └── ModelGateway
├── policy/
├── approval/
├── sessions/
├── evaluations/
└── audit/
```

V1 重点不是管理后台，而是稳定的代码契约和运行链路。

---

# 6. Runtime 策略

平台必须拥有自己的 Runtime abstraction：

```ts
interface AgentRuntime {
  run(input: AgentRunInput): Promise<AgentRunResult>;
}
```

Runtime 实现可以包括：

```text
FastClawRuntimeAdapter
OpenClawRuntimeAdapter
OpenAIAgentsRuntimeAdapter
FutureRuntimeAdapter
```

原则：

> Runtime 是发动机，不是平台架构。

AgentDefinition、SkillDefinition、ToolDefinition、Tenant、Permission、Knowledge Scope、Audit 等 Source of Truth 必须掌握在自己的平台中。

第一阶段通过真实 ERP 场景 PoC 选择默认 Runtime，不允许业务代码直接依赖某一个 Runtime 的私有模型。

---

# 7. 企业基础平台

AI Core 必须建立在企业基础能力之上。

V1 必须有：

```text
Tenant
Identity / User
TenantMembership
Organization
Permission / RBAC
App Registry
TenantApp
Audit
```

RequestContext 示例：

```ts
type RequestContext = {
  tenantId: string;
  userId: string;
  membershipId: string;
  appId: string;
  organizationId?: string;
  roles: string[];
  permissions: string[];
  resourceScope?: unknown;
};
```

AIExecutionContext 示例：

```ts
type AIExecutionContext = {
  tenantId: string;
  userId: string;
  membershipId: string;
  appId: string;
  sessionId: string;
  organizationId?: string;
  resourceType?: string;
  resourceId?: string;
  roles: string[];
  permissions: string[];
  resourceScope?: unknown;
};
```

任何 AI 调用不得绕过企业权限。

---

# 8. Tool 安全模型

建议风险等级：

```text
L0 Read
L1 Draft
L2 Internal Write
L3 External Action
L4 Financial / Legal
```

执行链：

```text
Agent Runtime
    ↓
Tool Request
    ↓
Tool Gateway / Executor
    ↓
Tenant Check
    ↓
Permission Check
    ↓
Policy Check
    ↓
Risk Check
    ↓
Approval (when required)
    ↓
Application Service
    ↓
Audit
```

AI 的权限永远不能大于当前用户实际权限。

实际访问范围：

```text
Agent allowed scope
∩ User permission
∩ Tenant
∩ App / Resource context
= Effective AI access
```

---

# 9. MCP 与 Integration 的位置

内部自有应用默认使用 Native Tool：

```text
Agent / Skill
→ Tool Registry
→ Native Tool
→ Application Service
```

不采用：

```text
Agent → MCP → ERP
```

MCP 用于外部生态互操作。

调用客户系统：

```text
Agent
→ Tool Registry
→ Connector Tool
→ Integration Runtime
→ MCP / REST / SDK / Webhook
→ Customer System
```

外部 AI 调用本平台：

```text
External Agent
→ MCP Server / API
→ Authentication
→ Tenant Context
→ Permission
→ Tool Registry
→ Application Service
```

MCP 是协议/适配器，不是平台核心业务模型。

---

# 10. 应用建设原则

所有内部应用遵循：

```text
UI / API
    ↓
Application Service
    ↓
Domain
    ↓
Repository
    ↓
Database
```

AI 入口：

```text
Agent / Skill
    ↓
Tool
    ↓
Application Service
```

跨应用：

```text
ERP
→ CRM Public Contract
→ CRM Application Service
```

禁止应用直接 import 另一个应用的 Repository 或访问其表。

---

# 11. Native by Default, Connect when Available

产品原则：

> **默认开箱即用，已有系统即可连接替代。**

每个 AI Native App 的业务能力按三类判断：

### Core Native

必须由应用自己拥有，是产品差异化核心。

### Built-in Basic

为了开箱即用提供轻量基础能力。

### External Optional

客户已有系统可以替代的数据/能力。

不要为了“开箱即用”重新建设所有 ERP/OA/BIM 等系统。

---

# 12. Monorepo 建议

```text
enterprise-ai-platform/

apps/
├── web/
└── admin/

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
├── knowledge/
├── integration/
├── file/
├── notification/
├── jobs/
└── audit/

business-apps/
├── erp/
│   ├── domain/
│   ├── application/
│   ├── public/
│   ├── api/
│   ├── ai/
│   │   ├── assistants/
│   │   ├── skills/
│   │   └── tools/
│   └── web/
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

`business-apps/erp/ai` 保存 ERP 相关 AI 定义/适配，不承载平台 Runtime。

---

# 13. 技术基线

如无现有约束：

```text
Frontend: TypeScript + React + Vite
Backend: TypeScript + NestJS
Database: PostgreSQL
ORM: Prisma
Vector: pgvector
Storage: S3-compatible
Package Manager: pnpm
Queue: Redis / RabbitMQ / simple queue as needed
Deployment: Docker，后续 Kubernetes
```

技术选型必须通过 ADR 固化，避免 Codex 自行更换核心技术。

---

# 14. 分阶段产品与开发规划

## Phase 0 — Architecture Baseline

### 目标

建立可持续开发的工程和架构边界，不追求业务完整性。

### 必须实现

- Monorepo；
- Web/Admin/API/Worker 基础结构；
- PostgreSQL + Prisma；
- 基础 CI/test/lint/typecheck；
- 模块边界；
- ADR；
- 环境配置与 secrets 基础机制；
- 统一错误和日志规范。

### 不实现

- 微服务拆分；
- 通用低代码 Runtime；
- Dynamic Object/Form/View Builder；
- 多行业框架；
- 复杂插件市场。

### 验收

ERP 可以在该工程结构中持续开发，Platform Core 与业务模块边界清晰。

---

## Phase 1 — Enterprise Foundation + ERP Continuous Development

### 目标

ERP 不停工，同时建立所有业务和 AI 必须依赖的企业基础。

### 必须实现

- Tenant；
- User / Identity；
- TenantMembership；
- Organization 基础模型；
- Permission/RBAC；
- App / TenantApp；
- RequestContext；
- Audit 基础能力；
- ERP 按 Domain/Application/API/Web 正常开发。

### ERP 要求

ERP 核心业务逻辑必须位于 Domain / Application Service，不得写死在 Controller、页面或 AI 层。

### 验收

不同 Tenant 数据隔离；用户权限可验证；ERP 正常业务流程可以在统一上下文运行。

---

## Phase 2 — Minimal AI Core

### 目标

建立最小 AI 执行骨架，只满足 ERP 第一个真实 AI 场景。

### 必须实现

- AIExecutionContext；
- AgentDefinition / Registry；
- SkillDefinition / Registry；
- ToolDefinition / Registry / Executor；
- AgentRuntime interface；
- 一个 Runtime Adapter PoC；
- ModelGateway；
- Session 基础能力；
- AI Audit/Trace 基础能力；
- Policy/Approval 最小能力。

### 统一能力模型

V1 只建立一套 Agent、Skill、Tool 模型，不开发平台/行业/应用三级实现。

### 不实现

- Visual Agent Builder；
- Skill Builder；
- Marketplace；
- Multi-Agent 平台；
- Agent 自动创建 Agent；
- Scope inheritance engine；
- Capability promotion engine；
- 客户任意绑定高风险 Tool。

### 验收

一个代码定义的 Agent 可以通过 Runtime 调用一个受权限控制的测试 Tool，并产生完整 trace/audit。

---

## Phase 3 — First AI Native ERP Vertical Slice

### 目标

用真实 ERP 数据跑通第一个完整 AI Native 闭环。

### 场景选择原则

必须是真实 ERP 业务问题，而不是 Demo。

优先候选：

```text
供应商风险分析
库存风险分析
采购异常分析
应收/应付风险分析
```

具体选择以 ERP 当前已经稳定开发完成的模块为准。

### 必须实现

1. ERP Public/Application Services；
2. 3~8 个真实 ERP Native Tools；
3. 1 个 ERP Skill；
4. ERP Assistant AgentDefinition；
5. AIExecutionContext 注入；
6. Tool permission；
7. Knowledge 最小接入（如场景需要）；
8. 结构化输出；
9. Citation/Business Evidence；
10. Audit/Trace；
11. 若有写操作，支持 Draft + Approval。

### 完整链路

```text
User
↓
ERP
↓
ERP Assistant
↓
AI Gateway
↓
Agent Runtime
↓
ERP Skill
↓
ERP Native Tools
↓
Permission / Policy
↓
ERP Application Services
↓
ERP Data
↓
AI Result
↓
Evidence / Citation
↓
Optional Approval / Action
↓
Audit
```

### 验收

真实 ERP 用户可以完成至少一个具有业务价值的 AI 任务；AI 无法绕过权限；结果可追踪到业务数据/知识依据。

这是平台第一个关键里程碑：**First AI Native Loop**。

---

## Phase 4 — ERP AI Expansion

### 目标

在不泛化平台的前提下扩展 ERP AI 能力。

### 实现

- 根据真实 ERP 模块增加 Native Tools；
- 增加 2~5 个高价值 ERP Skills；
- ERP Assistant 支持更多业务上下文；
- Tool 风险等级；
- Approval 完善；
- Skill Eval 基础集；
- AI Usage/Cost；
- 更完整 trace；
- Knowledge ingestion/retrieval 按真实需求增强。

### 验收

ERP AI 不再只是聊天入口，而能够辅助分析、生成草稿、推动受控业务动作。

---

## Phase 5 — CRM Rebuild

### 目标

CRM 成为第二个内部业务应用，同时验证平台边界是否真正可复用。

### 实现

- CRM clean reimplementation；
- CRM Domain/Application/Public/API/Web；
- CRM Native Tools；
- CRM Skills；
- CRM Assistant；
- 与 ERP 的 Public Contract 边界。

### 关键要求

不要因为 ERP 和 CRM 都有 Customer/Contact 等概念就提前强制共享模型。

先比较：

```text
语义
生命周期
权限
唯一性
业务规则
```

确认稳定一致后再 Architecture Review。

### 验收

CRM 可以独立工作；CRM AI 可以独立工作；没有跨应用 Repository/DB 依赖。

---

## Phase 6 — First Cross-App AI

### 目标

第一次验证 Agent/Skill/Tool 与 App 解耦是否成立。

示例：

```text
Enterprise Assistant
↓
客户经营风险分析
↓
CRM customer/opportunity tools
+
ERP order/receivable tools
↓
Cross-App Analysis
```

### 实现

- 一个跨 ERP + CRM 的 AgentDefinition；
- 跨应用 Skill（只有真实需要时）；
- Tool Registry 跨应用组合；
- 多应用 permission/context；
- cross-app audit/trace；
- 必要的 Public Contracts。

### 验收

Agent 不属于 ERP 或 CRM，却可以在当前用户权限范围内组合两个应用的能力完成任务。

---

## Phase 7 — MES Rebuild + Three-App Intelligence

### 目标

完成第三个核心业务应用并验证 ERP + CRM + MES 企业级 AI 场景。

### 实现

- MES clean reimplementation；
- MES Native Tools；
- MES Skills；
- MES Assistant；
- ERP/CRM/MES cross-app scenarios。

示例：

```text
客户经营风险
=
CRM 商机/客户
+
ERP 订单/应收
+
MES 生产/质量/交付
```

### 验收

统一 AI Core 可以支持三个业务系统而无需为每个应用复制 Runtime/Registry/Gateway。

---

## Phase 8 — Architecture Review & Selective Promotion

### 目标

到此时才正式判断哪些能力值得提升为共享能力。

### Review 对象

- Shared Business；
- Shared Skills；
- Shared Tools；
- Knowledge patterns；
- UI components；
- Integration patterns；
- Approval patterns；
- Agent patterns。

### Promotion 条件

至少满足：

1. 两个或以上真实消费者；
2. 语义一致；
3. 生命周期一致；
4. 权限模型可兼容；
5. 抽取后确实降低复杂度。

### 不做

不得为了“看起来架构漂亮”而抽象。

---

## Phase 9 — Knowledge & Integration Platformization

### 目标

只有在 ERP/CRM/MES 形成真实重复需求后，将知识和集成能力进一步平台化。

### Knowledge

逐步完善：

```text
Ingestion
Parsing
Chunking
Embedding
Retrieval
Permission Filter
Citation
Evaluation
```

### Integration

逐步完善：

```text
Connector Registry
Connection
Credential
REST Adapter
MCP Adapter
Webhook Adapter
SDK Adapter
Sync/Event Runtime
Integration Audit
```

### 验收

同一 Knowledge/Integration engine 能服务多个 App，但 Tenant 数据与权限严格隔离。

---

## Phase 10 — First Industry Package: Construction

### 目标

验证平台从企业通用应用扩展到行业 AI Native Application。

建筑只是第一个 Industry，不允许把建筑概念写入 Platform Core。

候选应用：

```text
AI 项目经营
AI 商务经营
AI 项目总控
AI 咨询作业
AI Design Operations
```

不要求同时开发。

优先选择一个业务闭环最明确、价值最高的应用。

### 能力演进

第一个建筑 Skill 默认属于第一个产生它的 App。

例如：

```text
project_operations.contract_analysis
```

当多个建筑应用真实复用且语义稳定后，才提升为：

```text
construction.contract_analysis
```

此时 `industry` scope 是演进结果，而不是提前建设的框架。

### 验收

行业应用使用同一 AI Core、Platform Core、Tool/Skill/Knowledge 模型，不需要重新建立行业 AI Runtime。

---

## Phase 11 — Multi-Industry Expansion

### 目标

验证 Construction 之外的新行业。

候选：

```text
Manufacturing
Retail
Logistics
Energy
...
```

原则：

- Platform Core 保持行业中立；
- Industry Domain 留在行业层；
- 行业能力出现真实复用后再共享；
- 不建设“万能行业模型”。

---

## Phase 12 — Deployment Productization

平台统一代码库支持：

```text
标准云服务
企业专属云服务
企业内部部署
```

原则：

> **One Codebase, Multiple Deployment Profiles.**

不得为单客户创建长期代码分叉。

根据客户网络环境，可后续增加 Customer Connector Agent，用于安全连接客户内网 ERP/OA/BIM/文件/数据库等。

---

# 15. 产品里程碑

```text
M0 Architecture Baseline
↓
M1 Enterprise Foundation
↓
M2 Minimal AI Core
↓
M3 First AI Native ERP Loop
↓
M4 ERP AI Expansion
↓
M5 CRM Ready
↓
M6 ERP + CRM Cross-App AI
↓
M7 MES + Three-App Intelligence
↓
M8 Architecture Review
↓
M9 Knowledge / Integration Platformization
↓
M10 First Construction AI Native App
↓
M11 Multi-Industry Validation
↓
M12 Deployment Productization
```

其中 M3 是第一阶段最重要的产品里程碑。

---

# 16. Codex 当前执行优先级

当前不要按照最终架构一次性实现所有模块。

执行顺序：

```text
Priority 1
继续 ERP 核心业务开发

Priority 2
保证 Tenant / Identity / Organization / Permission / App Context

Priority 3
建立 Minimal AI Core contracts

Priority 4
选择一个 ERP 真实场景

Priority 5
实现 ERP Native Tools

Priority 6
实现第一个 ERP Skill

Priority 7
实现 ERP Assistant

Priority 8
接入 Runtime Adapter

Priority 9
跑通权限、证据、Audit、Approval

Priority 10
根据真实使用扩展，而不是提前平台化
```

---

# 17. 第一阶段 Codex Backlog

## Epic A — Enterprise Foundation

- Tenant；
- User/Identity；
- TenantMembership；
- Organization；
- Permission/RBAC；
- App Registry；
- TenantApp；
- RequestContext；
- Audit。

## Epic B — ERP Architecture Compliance

- ERP Domain；
- ERP Application Services；
- ERP Repository；
- ERP API；
- ERP Web；
- ERP Public Contract；
- 禁止 Controller/UI 承载核心业务规则。

## Epic C — Minimal AI Core

- AIExecutionContext；
- AgentDefinition；
- AgentRegistry；
- SkillDefinition；
- SkillRegistry；
- ToolDefinition；
- ToolRegistry；
- ToolExecutor；
- AgentRuntime；
- ModelGateway；
- Session；
- AI Audit；
- Policy/Approval minimal version。

## Epic D — ERP AI Vertical Slice

- 选择真实业务场景；
- 3~8 个 Native Tools；
- 1 个 Skill；
- ERP Assistant；
- Runtime execution；
- structured result；
- evidence/citation；
- permission enforcement；
- audit trace；
- optional approval/action。

## Epic E — Evaluation

- Skill 最小 eval cases；
- permission tests；
- tenant isolation tests；
- tool authorization tests；
- hallucination/evidence tests；
- end-to-end vertical slice tests。

---

# 18. Codex 禁止事项

1. 不得重建通用 APaaS；
2. 不得开发 Universal Object/Form/View/Workflow Builder；
3. 不得提前拆微服务；
4. 不得让 Agent/Skill 直接访问业务数据库；
5. 不得跨 App 直接访问 Repository/table；
6. 不得把 MCP 用作内部应用默认调用方式；
7. 不得把 FastClaw/OpenClaw 私有模型变成平台 Source of Truth；
8. 不得为 Platform/App/Industry 建三套 Agent 类型；
9. 不得为 Platform/App/Industry 建三套 Skill 实现；
10. 不得建立复杂 Knowledge 层级继承体系；
11. 不得提前开发 Capability Promotion Engine；
12. 不得看到重复代码就自动抽 Shared；
13. 不得看到两个相似 Skill 就自动合并；
14. 不得把所有业务 API 都暴露为 Tool；
15. 不得让 AI 权限高于当前用户；
16. 不得让高风险 AI Action 绕过审批；
17. 不得开发 Visual Agent Builder V1；
18. 不得开发 Skill Marketplace V1；
19. 不得同时开发多个行业；
20. 不得为客户创建长期代码 fork；
21. 不得因为未来可能需要就提前创建抽象；
22. 不得为了 AI 停止 ERP 正常业务开发。

---

# 19. Codex 开发新能力前必须回答的问题

每个新能力至少回答：

1. 这是 Platform capability、App business capability，还是目前无法确定？
2. 当前真实消费者是谁？
3. 是否已经存在第二个真实消费者？
4. 如果没有，为什么需要现在抽象？
5. 业务逻辑应该位于 Domain、Application Service、Skill 还是 Agent？
6. AI 是否可以通过 Tool 调用现有 Application Service，而不是新建重复逻辑？
7. Tenant/Permission/Resource Scope 如何传递？
8. Tool 的风险等级是什么？是否需要 Approval？
9. 结果如何 Audit/Trace/Evaluate？
10. 如果未来更换 Agent Runtime，这个能力是否仍然可以工作？

如果第 4 问没有明确答案，默认不提前抽象。

---

# 20. 数据所有权

可以使用一个 PostgreSQL 实例，但必须有清晰逻辑所有权：

```text
platform.*
erp.*
crm.*
mes.*
construction.*
manufacturing.*
```

物理 schema 是否分离可以后续决定，但业务所有权必须清楚。

禁止多个应用随意共同写一张所谓“通用业务表”。

---

# 21. AI 能力演进示例

ERP 首次出现：

```text
erp.supplier_risk_analysis
owner = erp
```

CRM 出现相似能力时：

```text
crm.customer_risk_analysis
```

先分别存在。

如果未来发现稳定共同模式：

```text
Architecture Review
↓
抽取稳定分析框架或 Platform Skill
```

建筑首次出现：

```text
construction.project_operations.contract_analysis
```

多个建筑 App 复用后：

```text
construction.contract_analysis
```

如果未来建筑、制造、零售都出现完全稳定的通用文档能力：

```text
platform.document.compare
platform.document.extract
```

共享是业务事实的结果，不是架构预设。

---

# 22. 最终平台形态

长期平台可以自然形成：

```text
Enterprise AI Native Platform
│
├── Platform Core
│   ├── Tenant
│   ├── Identity
│   ├── Organization
│   ├── Permission
│   ├── App Registry
│   └── Audit
│
├── Enterprise AI Core
│   ├── Agent
│   ├── Skill
│   ├── Tool
│   ├── Knowledge
│   ├── Runtime
│   ├── Model
│   ├── Policy
│   ├── Approval
│   └── Evaluation
│
├── Business Applications
│   ├── ERP
│   ├── CRM
│   └── MES
│
├── Industry Applications
│   ├── Construction
│   ├── Manufacturing
│   ├── Retail
│   └── ...
│
└── Integration Ecosystem
    ├── Native Tools
    ├── REST
    ├── MCP
    ├── Webhook
    ├── SDK
    └── Customer Connector
```

但是这个最终形态必须从真实业务逐步长出来，而不是第一天全部建设。

---

# 23. 当前开发基线摘要

Codex 应以以下内容作为当前项目基线：

```text
Architecture
✓ Monorepo
✓ Modular Monolith
✓ One Web/Admin
✓ One API
✓ One PostgreSQL
✓ Worker

Current Business Priority
✓ ERP first
✓ ERP development continues

Platform Foundation
✓ Tenant
✓ Identity
✓ Organization
✓ Permission
✓ App Registry
✓ Audit

AI Model
✓ Unified AgentDefinition
✓ Unified SkillDefinition
✓ Unified ToolDefinition
✓ Unified KnowledgeSource
✓ owner/scope/permission
✓ AIExecutionContext
✓ AgentRuntime abstraction

AI Development Strategy
ERP real requirement
→ Native Tool
→ Skill
→ ERP Assistant
→ Runtime
→ Permission / Evidence / Audit
→ First AI Native Loop

Reuse Strategy
App Local
→ Real Second Consumer
→ Semantic Review
→ Architecture Review
→ Promote only when justified

Runtime Strategy
Own control plane
→ AgentRuntime Interface
→ FastClaw/OpenClaw/OpenAI/etc Adapter

Internal AI Integration
Native Tool
→ Application Service

External Integration
Connector / REST / MCP / SDK

Current Order
ERP + Enterprise Foundation
→ Minimal AI Core
→ First ERP AI Native Loop
→ ERP AI Expansion
→ CRM
→ ERP + CRM Cross-App AI
→ MES
→ Three-App Intelligence
→ Architecture Review
→ Knowledge/Integration Platformization
→ First Industry App
→ Multi-Industry
```

---

# 24. 一句话开发原则

> **先把 ERP 做成真正可用的业务应用，再让最小 AI Core 通过 Tool 使用 ERP 的真实业务能力；Agent、Skill、Knowledge、Tool 使用统一模型，能力先留在产生它的业务中，只有真实复用出现后才提升作用域。**

这条原则优先于为了未来扩展而进行的提前抽象。
