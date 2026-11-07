import type { EmployeeProduct } from './employees';

export type EmployeeJob = {
  id: string;
  employee: Exclude<EmployeeProduct, 'geo'>;
  group: 'trade' | 'customers' | 'production' | 'creative';
  name: string;
  request: string;
  inputs: readonly string[];
  steps: readonly (readonly [string, string])[];
  outputs: readonly string[];
  confirmation: string;
  aliases: readonly string[];
  example?: string;
};

// Task scenarios follow the existing app assistants and business workflows.
export const employeeJobs: readonly EmployeeJob[] = [
  {
    id: 'replenishment', employee: 'erp', group: 'trade', name: '库存补货',
    request: '哪些商品需要补货，建议数量怎么算？',
    inputs: ['商品与库存余额', '已确认销售需求与待入库采购', '供应商及当前补货条件'],
    steps: [['核对当前事实', '读取有权查看的库存、销售需求与采购在途，标明查询范围和时间。'], ['列出补货建议', '逐项给出建议数量及计算依据，留出需要核对的供应商与交期。'], ['确认采购草稿', '由采购人员核对数量、供应商和交期，再确认准备采购草稿。']],
    outputs: ['商品补货建议表', '库存、需求和在途的数量依据', '待确认的采购草稿'],
    confirmation: '补货建议以当前数据为准；确认、审批和实际入库由有权人员办理。',
    aliases: ['fulfillment'], example: '看采购协作示例',
  },
  {
    id: 'purchase-followup', employee: 'erp', group: 'trade', name: '采购跟单',
    request: '采购单到哪一步了，还有哪些数量没入库？',
    inputs: ['采购单及明细', '确认状态与分批入库记录', '供应商、负责人和约定交期'],
    steps: [['读取单据和记录', '按实际采购单核对确认状态、订单数量与已入库数量。'], ['整理待办事项', '列出未入库明细、交期与负责人，说明需要继续核实的事项。'], ['按岗位继续办理', '采购人员核实交期，仓库按实际到货办理入库，处理结果保留记录。']],
    outputs: ['采购履约进度汇总', '未入库明细与剩余数量', '需要继续处理的跟单清单'],
    confirmation: '供应商沟通与实际入库由人员办理；待入库数量不作为现有库存。',
    aliases: [],
  },
  {
    id: 'accounts', employee: 'erp', group: 'trade', name: '账款核对',
    request: '哪些款还没结清，这笔到账应该认领到哪几笔应收？',
    inputs: ['客户或供应商往来单据', '应收应付与收付款记录', '到账流水及认领资料'],
    steps: [['核对往来与余额', '区分应收、应付、已结和未结金额，按客户或供应商回查业务单据。'], ['准备认领与分摊', '将实际到账与相关应收逐笔核对，保留金额、流水号和待确认项。'], ['财务确认并回查', '由财务办理确认，再核对收付款记录和余额变化。']],
    outputs: ['往来账款与未结明细', '待确认的到账认领及分摊', '可回查的单据与款项记录'],
    confirmation: '提交认领不会直接记收款；实际收付款和财务确认沿用岗位权限。',
    aliases: ['receipts'],
  },
  {
    id: 'customer-operations', employee: 'crm', group: 'customers', name: '客户运营',
    request: '先回访哪些客户，怎么把名单交给负责人跟进？',
    inputs: ['客户与交易数据', '购买时间、有效订单和净消费等指标', '客户归属及历史执行反馈'],
    steps: [['预览目标人群', '按购买行为、来源和标签筛选，查看名单与当前数据范围。'], ['整理运营方案', '明确目标、负责人、时间与执行清单，由人员确认后安排任务。'], ['记录反馈并复盘', '负责人逐客户记录处理结果，结合购买变化观察执行情况。']],
    outputs: ['符合条件的客户名单', '带负责人和清单的运营方案', '逐客户反馈与效果观察'],
    confirmation: '名单和方案由你确认，负责人执行客户沟通；购买变化不直接归因为营销效果。',
    aliases: ['retention'], example: '看客户运营示例',
  },
  {
    id: 'sales-followup', employee: 'crm', group: 'customers', name: '销售跟进',
    request: '今天先跟谁，哪些商机还没有明确下一步？',
    inputs: ['本人有权查看的线索与商机', '客户归属、销售阶段与预计日期', '跟进记录和个人待办'],
    steps: [['汇总销售事项', '核对当前可见的线索、商机与待办，明确各自负责人和阶段。'], ['梳理下一步', '依据已有跟进记录整理需要联系、补充需求或继续推进的事项。'], ['人员执行与记录', '销售人员完成沟通后登记结果和下一次跟进，阶段变化沿原业务规则办理。']],
    outputs: ['销售跟进待办清单', '商机阶段与最近跟进汇总', '待确认的下一步行动'],
    confirmation: '客户联系和销售阶段变更由有权人员办理；跟进意向不作为已成交事实。',
    aliases: [],
  },
  {
    id: 'customer-service', employee: 'crm', group: 'customers', name: '客户服务',
    request: '哪些服务任务待处理，哪些客户风险还没解决？',
    inputs: ['当前客户的服务计划', '服务任务、提交结果与审核记录', '客户风险与解决说明'],
    steps: [['核对服务进展', '汇总有权查看的服务计划、任务状态和处理负责人。'], ['列出待办与风险', '区分待执行、待审核和未关闭风险，保留原记录作为依据。'], ['处理后提交审核', '负责人完成服务并提交结果，主管审核，风险关闭保留解决说明。']],
    outputs: ['服务任务与审核待办', '未解决客户风险清单', '可回查的服务处理记录'],
    confirmation: '服务实施、结果提交和主管审核由相应岗位办理，风险解决需保留说明。',
    aliases: [],
  },
  {
    id: 'bom-review', employee: 'mes', group: 'production', name: 'BOM核查',
    request: '这份清单有哪些物料、用量和单位需要核对？',
    inputs: ['PDF或图片中的物料明细表', 'Excel、CSV物料清单与历史BOM', '企业物料、装配和版本资料'],
    steps: [['整理明细与来源', '读取型号、用量和单位，按装配保留原始行与资料来源。'], ['列出待核对项', '检查匹配物料、用量、单位和重复项，缺失或冲突内容留待确认。'], ['核对并保存草稿', '由人员逐行核实后填入BOM草稿，发布时保留版本与审核依据。']],
    outputs: ['带来源的物料明细', 'BOM待核对清单', '经人员核对的BOM草稿'],
    confirmation: '物料身份、用量和单位须逐行核对；BOM发布由有权人员确认。',
    aliases: ['bom'], example: '看BOM核查示例',
  },
  {
    id: 'plan-preparation', employee: 'mes', group: 'production', name: '计划准备',
    request: '按这个BOM生产一批，需要准备哪些物料？',
    inputs: ['已发布的产品BOM及子BOM', '计划数量与截止时间', '物料单位、损耗和版本信息'],
    steps: [['核对产品与版本', '选定已发布BOM和计划数量，检查子BOM链及当前版本。'], ['展开理论需求', '按业务规则展开多级物料用量，保留汇总数量及所用版本快照。'], ['确认计划草稿', '计划人员核对产品、数量和时间后保存草稿，再按权限发布与派工。']],
    outputs: ['多级物料需求清单', '计划使用的BOM版本与快照', '待确认的生产计划草稿'],
    confirmation: '这里计算理论物料需求；库存齐套、设备产能和可承诺交期需另外核实。',
    aliases: [],
  },
  {
    id: 'production-progress', employee: 'mes', group: 'production', name: '进度追踪',
    request: '哪些工单还没完成，哪些报工正在等审核？',
    inputs: ['生产计划与受派工单', '开工及分批报工记录', '合格、不良和审核状态'],
    steps: [['核对执行记录', '按当前岗位查看计划或受派工单，核对开工和分批报工情况。'], ['汇总进度与待审', '区分已审核合格、不良与待审核数量，列出未完成和待处理事项。'], ['人员处理并回查', '操作员记录实际产量，主管审核；处理后回看进度和原始报工。']],
    outputs: ['计划与工单进度汇总', '合格、不良及待审数量', '未完成和待审核事项清单'],
    confirmation: '操作员只处理本人受派范围；实际产量和报工审核由人员办理，待审不计入已完成进度。',
    aliases: ['production'],
  },
  {
    id:'brand-content', employee:'content', group:'creative', name:'品牌宣传图片创作',
    request:'如何把品牌和产品要求整理成一张可修改、可下载的宣传图？',
    inputs:['活动目标、画面内容与尺寸','可选的品牌、产品资料或参考图片'],
    steps:[['描述需求','确认用途、主体、风格和文案，按需结合已有品牌或产品资料准备创作描述。'],['生成图片','在创作页核对需求后提交生成，查看处理状态和完整图片。'],['描述修改','选用结果作为参考，说明要调整的背景、色调或内容。'],['下载交付','查看原图，核对文案和产品细节后下载选中的结果。']],
    outputs:['待确认的创作描述与文案建议','生成图片与参考修改结果','可继续创作的历史记录、可下载的原图'],
    confirmation:'发布前核对文案、产品细节和品牌使用要求。',
    aliases:[],
  },
];

export const jobHref = (job: EmployeeJob) => `/solutions#${job.id}`;
