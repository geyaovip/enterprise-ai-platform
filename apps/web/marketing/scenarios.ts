export type ScenarioId = 'bom' | 'production' | 'fulfillment' | 'receipts' | 'retention' | 'knowledge';
export type ScenarioGroup = 'production' | 'trade' | 'customers' | 'shared';
export type Scenario = {
  id: ScenarioId;
  group: ScenarioGroup;
  product: 'erp' | 'crm' | 'mes' | null;
  title: string;
  audience: string;
  problem: string;
  inputs: readonly string[];
  steps: readonly [string, string][];
  outputs: readonly string[];
  confirmation: string;
};

// Public examples describe existing workflows. They are not customer results.
export const scenarios: readonly Scenario[] = [
  {
    id:'bom', group:'production', product:'mes', title:'从资料到BOM草稿', audience:'工程资料 · 生产计划',
    problem:'物料散在图纸和表格里，型号、用量、单位需要一项项核对。',
    inputs:['PDF或图片中的物料表','Excel、CSV物料清单','企业已有物料资料'],
    steps:[['整理物料信息','读取清单中的型号、用量、单位与来源。'],['逐行核对','检查匹配物料、数量、单位和重复项，保留待确认内容。'],['确认并保存','由人员确认后生成BOM草稿，发布时保留版本。']],
    outputs:['带来源的BOM草稿','待核对物料与用量','可追溯的发布版本'],
    confirmation:'物料身份、用量和单位由人员逐行核对，草稿确认后再发布。',
  },
  {
    id:'production', group:'production', product:'mes', title:'从生产计划到报工审核', audience:'生产计划 · 主管 · 操作员',
    problem:'计划排下去了，现场做了多少、还有哪些待审，需要反复追问。',
    inputs:['已发布的BOM版本','计划数量与截止时间','工序、成员及报工记录'],
    steps:[['预览物料需求','按选定BOM展开多级需求，核对计划使用的版本。'],['发布计划与派工','由有权人员发布计划，将工单分配到工序和成员。'],['分批报工与审核','操作员记录合格、不良数量，主管审核后更新进度。']],
    outputs:['物料需求清单','工单与受派记录','已审核进度和待审数量'],
    confirmation:'计划发布、派工和报工审核分别按岗位办理，待审数量独立显示。',
  },
  {
    id:'fulfillment', group:'trade', product:'erp', title:'采购与订单履约', audience:'采购 · 销售 · 仓库',
    problem:'接了订单还要查库存、核对在途采购，再逐个问入库和发货进度。',
    inputs:['销售合同与采购订单','当前库存与已确认待入库','商品、供应商及履约记录'],
    steps:[['核对需求和库存','查看订单需求、可用库存与已确认待入库，核对缺口。'],['准备采购与履约','整理采购草稿，按实际业务办理分批入库和出库。'],['跟进状态与待办','从单据查看履约记录、负责人和需要继续处理的事项。']],
    outputs:['库存缺口与补货建议','待确认的采购草稿','出入库及履约记录'],
    confirmation:'供应商、采购数量与交期需要确认；库存按实际入库、出库记录更新。',
  },
  {
    id:'receipts', group:'trade', product:'erp', title:'到账认领与应收核对', audience:'销售 · 财务',
    problem:'钱已经到账，对应哪个客户、抵扣哪些应收，还要来回核对。',
    inputs:['客户到账流水','当前客户的未结应收','银行流水号与款项记录'],
    steps:[['登记到账','核对客户、流水号、到账金额与时间。'],['提出认领分摊','选择相关应收，核对本次认领和各笔分摊金额。'],['财务确认','确认后查看收款记录及应收余额变化。']],
    outputs:['到账流水与认领申请','应收分摊明细','确认后的收款与余额记录'],
    confirmation:'提交认领不会直接记收款，由财务确认后进入实际账款记录。',
  },
  {
    id:'retention', group:'customers', product:'crm', title:'客户分群与跟进', audience:'客户运营 · 销售 · 负责人',
    problem:'客户和购买记录都有了，但先联系谁、谁来跟、结果如何仍不清楚。',
    inputs:['客户与交易数据','购买时间、订单数、净消费等指标','客户负责人和历史跟进记录'],
    steps:[['预览目标客户','按购买行为、来源和标签筛选，查看实际名单。'],['安排跟进任务','确认目标、方案、负责人、时间和执行清单。'],['记录结果与复盘','逐客户记录处理结果，再观察目标人群的购买变化。']],
    outputs:['可核对的客户名单','带负责人和清单的任务','逐客户反馈与效果观察'],
    confirmation:'目标人群和运营方案由人员确认，客户沟通及结果记录由负责人执行。',
  },
  {
    id:'knowledge', group:'shared', product:null, title:'带来源的企业知识查询', audience:'业务团队 · 新员工 · 管理者',
    problem:'文件找到了，还要确认是哪一版、答案出自哪里、自己能不能查看。',
    inputs:['制度、手册与业务文档','PDF、表格和其他受支持资料','知识空间与成员访问范围'],
    steps:[['整理知识空间','上传资料，设置负责人和访问范围。'],['检索相关内容','在有权查看的资料中查找，回答保留来源引用。'],['回看原文','按页、表格或段落定位，核对版本及原始内容。']],
    outputs:['带引用的检索结果','原文位置与文档版本','按企业和成员权限提供的资料'],
    confirmation:'引用可回到原文核对；知识查询沿用企业、空间和成员的访问权限。',
  },
];

export const featuredScenarios: readonly ScenarioId[] = ['bom','fulfillment','retention'];
export const scenarioHref = (scenario: Scenario) => scenario.product ? `/products/${scenario.product}#scenario-${scenario.id}` : '/products#knowledge';
