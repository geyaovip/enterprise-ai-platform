import { employees, employeeHref, employeeAvatar } from './employees';
export type ExampleId = 'bom' | 'fulfillment' | 'retention';

function table(label:string,headers:string[],rows:string[][]){return `<div class="example-table" role="region" tabindex="0" aria-label="${label}"><table><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;}
const examples = {
  bom:{
    label:'BOM草稿', request:'把这份物料清单整理成BOM，缺失和待核对的内容单独列出。',
    sourceTitle:'装配清单.xlsx', sourceNote:'驱动组件 · 客户提供的物料信息',
    source:table('原始物料清单',['物料','型号','用量'],[['电机','MTR-24','2 台'],['支架','BR-08','4 件'],['紧固件','M5×16','待核对']]),
    steps:['MES生产官核查清单','列出待确认项','你核对物料与用量','确认后保存草稿'],
    resultTitle:'驱动组件 · BOM草稿',
    result:table('BOM草稿示例',['物料','用量','核对状态'],[['MTR-24 电机','2 台','<span class="example-state">已匹配</span>'],['BR-08 支架','4 件','<span class="example-state">已匹配</span>'],['M5×16 紧固件','—','<span class="example-state pending">待确认用量</span>']]),
    note:'缺失用量保留为待确认，来源可回查到清单对应行。',
    href:'/solutions#bom-review', cta:'查看BOM整理方案',
  },
  fulfillment:{
    label:'采购与履约', request:'这笔订单还缺什么料？把需要核对的采购数量列出来。',
    sourceTitle:'销售合同 SO-1028', sourceNote:'订单需求、可用库存与已确认待入库',
    source:table('订单与库存示例',['商品','订单需求','可用库存','待入库'],[['电机','24 台','8 台','4 台'],['支架','48 件','20 件','0 件']]),
    steps:['ERP管家核对需求','整理采购建议','你核对供应商与数量','确认后准备采购草稿'],
    resultTitle:'待核对的采购草稿',
    result:table('采购缺口示例',['商品','待核对数量','计算依据'],[['电机','12 台','24 − 8 − 4'],['支架','28 件','48 − 20 − 0']]),
    note:'先核对供应商和交期，确认后再推进采购与实际入库。',
    href:'/solutions#replenishment', cta:'查看采购履约方案',
  },
  retention:{
    label:'客户跟进', request:'找出首购后7～30天未复购的客户，安排一次回访。',
    sourceTitle:'客户购买记录', sourceNote:'按有效订单数和距最近购买天数筛选',
    source:table('客户购买记录示例',['客户','有效订单','最近购买'],[['客户 A','1 笔','18 天前'],['客户 B','1 笔','52 天前'],['客户 C','1 笔','12 天前']]),
    steps:['CRM运营官筛选客户','整理回访方案','你确认名单与安排','负责人执行并反馈'],
    resultTitle:'首购回访 · 运营草稿',
    result:`<dl class="example-facts"><div><dt>目标人群</dt><dd>客户 A、客户 C</dd></div><div><dt>负责人</dt><dd>客户运营</dd></div><div><dt>执行清单</dt><dd>核对需求、记录回访结果、安排下次跟进</dd></div></dl><div class="example-task"><span class="example-state pending">待确认</span><strong>2 位客户的回访任务</strong></div>`,
    note:'确认名单与方案后，由负责人执行回访并逐客户记录结果。',
    href:'/solutions#customer-operations', cta:'查看客户跟进方案',
  },
} as const;

const exampleEmployee = {bom:'mes',fulfillment:'erp',retention:'crm'} as const;

export const exampleIds: readonly ExampleId[] = ['bom','fulfillment','retention'];

export function examplePanel(id:ExampleId,prefix:string,tabbed=false,inline=false){const e=examples[id],employeeId=exampleEmployee[id],employee=employees[employeeId];return `<section class="work-example" id="${prefix}-panel-${id}"${tabbed?` role="tabpanel" aria-labelledby="${prefix}-tab-${id}" tabindex="0"${id!=='bom'?' hidden':''}`:` aria-label="${e.label}处理示例"`}><div class="example-request"><div><${inline?'span':'a'} class="example-assignee"${inline?'':` href="${employeeHref(employeeId)}"`}><img src="${employeeAvatar(employeeId)}" width="32" height="32" loading="lazy" decoding="async" alt=""><span>${employee.name}</span></${inline?'span':'a'}><p>${e.request}</p></div><span>示例数据</span></div><ol class="example-steps" aria-label="处理步骤">${e.steps.map(step=>`<li>${step}</li>`).join('')}</ol><div class="example-columns"><section class="example-source"><div class="example-pane-heading"><span>输入资料</span><h3>${e.sourceTitle}</h3><p>${e.sourceNote}</p></div>${e.source}</section><section class="example-result"><div class="example-pane-heading"><span>处理结果</span><h3>${e.resultTitle}</h3></div>${e.result}<p class="example-note">${e.note}</p>${inline?'':`<a class="text-link" href="${e.href}">${e.cta}<img class="arrow-icon" src="/marketing/arrow-right.svg" width="18" height="18" alt=""></a>`}</section></div></section>`;}

export function exampleTabs(prefix='home-example'){return `<div class="example-switcher" data-example-switcher><div class="example-tabs" role="tablist" aria-label="选择处理示例">${exampleIds.map((id,index)=>`<button type="button" role="tab" id="${prefix}-tab-${id}" aria-controls="${prefix}-panel-${id}" aria-selected="${index===0}" tabindex="${index===0?0:-1}">${examples[id].label}</button>`).join('')}</div>${exampleIds.map(id=>examplePanel(id,prefix,true)).join('')}</div>`;}
