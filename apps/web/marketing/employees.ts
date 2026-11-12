import { contentEmployee } from '@suite/frontend/content-employee';
import { geoEmployee } from '@suite/frontend/geo-employee';
export type EmployeeProduct = 'erp' | 'crm' | 'mes' | 'content' | 'geo';

// Public roles describe the existing application assistants and permission boundaries.
export const employees = {
  erp: {
    name: 'ERP 管家',
    role: '进销存与账款协同',
    summary: '核对订单、库存和账款，整理需要继续处理的采购与履约事项。',
    tasks: ['库存与补货分析', '采购与销售履约跟进', '应收应付与未结账款核对'],
    outputs: ['补货建议与计算依据', '待确认的采购草稿', '履约与账款待办清单'],
    confirmation: '供应商、数量和交期由你核对；审批、出入库与收付款由有权人员办理。',
    scenario: 'fulfillment',
  },
  crm: {
    name: 'CRM 运营官',
    role: '客户经营与销售服务',
    summary: '从客户与购买记录中找出目标人群，整理运营方案和销售服务跟进事项。',
    tasks: ['客户购买与复购洞察', '客户分群与回访方案', '销售跟进与客户服务梳理'],
    outputs: ['可核对的目标客户名单', '带执行清单的运营方案', '逐客户反馈与跟进汇总'],
    confirmation: '名单和方案由你确认，负责人执行客户沟通并记录结果。',
    scenario: 'retention',
  },
  mes: {
    name: 'MES 生产官',
    role: '生产计划与执行协同',
    summary: '核查物料清单、准备生产计划，汇总工单进度与待审核报工。',
    tasks: ['BOM物料清单核查', '物料需求与生产计划准备', '生产进度及报工审核追踪'],
    outputs: ['BOM待核对清单', '生产计划准备资料', '进度与待审事项汇总'],
    confirmation: '物料用量由人员核对；发布BOM、派工和审核报工由有权人员办理。',
    scenario: 'bom',
  },
  content: { ...contentEmployee, scenario: 'brand-content' },
  geo: { ...geoEmployee, scenario: 'brand-visibility' },
} as const;

export const employeeIds: readonly EmployeeProduct[] = ['erp', 'crm', 'mes', 'content', 'geo'];
export const employeeHref = (id: EmployeeProduct) => `/employees#${id}`;
export const employeeAvatar = (id: EmployeeProduct) => id === 'content' || id === 'geo' ? employees[id].avatar : `/marketing/employee-${id}.png`;
