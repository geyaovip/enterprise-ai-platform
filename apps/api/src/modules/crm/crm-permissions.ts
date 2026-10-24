import {z} from 'zod';
export const CRM_ROLES=['manager','operator','analyst','viewer'] as const;
export const EXTRA_PERMISSIONS=['crm.customer.contact.read','crm.customer.export','crm.import.confirm','crm.import.compensate','crm.audit.read'] as const;
const read=['crm.customer.read','crm.segment.read','crm.task.read','crm.analytics.read'];
export const ROLE_PERMISSIONS:Record<string,string[]>={manager:[...read,'crm.customer.write','crm.segment.write','crm.task.write','crm.task.confirm','crm.task.execute','crm.import.read','crm.import.write','crm.import.confirm','crm.ai.use','crm.audit.read'],operator:[...read,'crm.customer.write','crm.segment.write','crm.task.write','crm.task.execute','crm.ai.use'],analyst:[...read,'crm.segment.write','crm.import.read','crm.import.write','crm.ai.use'],viewer:read};
export const CRM_PERMISSIONS=[...new Set([...Object.values(ROLE_PERMISSIONS).flat(),...EXTRA_PERMISSIONS,'crm.settings.manage'])];
export const CRM_MANIFEST={appId:'crm',displayName:'电商 CRM',routePrefix:'/crm',permissions:CRM_PERMISSIONS,aiCapabilities:['conversation','customer_insight','segment_advisor','retention_plan','controlled_actions'],defaultAgentId:'crm.assistant'};
export const bindingSchema=z.object({orgUnitIds:z.union([z.literal('all'),z.array(z.uuid()).min(1).max(100)]),includeDescendants:z.boolean().default(false),channelIds:z.union([z.literal('all'),z.array(z.uuid()).min(1).max(100)])}).strict();
export type ScopeBinding=z.infer<typeof bindingSchema>;
export const ALL_SCOPE:ScopeBinding={orgUnitIds:'all',includeDescendants:false,channelIds:'all'};
export const prerequisite:Record<string,string[]>={'crm.customer.contact.read':['crm.customer.read'],'crm.customer.export':['crm.customer.read'],'crm.import.confirm':['crm.import.read','crm.import.write'],'crm.import.compensate':['crm.import.read','crm.import.write'],'crm.audit.read':['crm.customer.read']};
export async function crmPermissions(db:any,tenantId:string,role:string,membershipId:string):Promise<string[]>{
 const releaseFilter=(values:string[])=>process.env.CRM_AI_RELEASE_ENABLED==='false'?values.filter(p=>p!=='crm.ai.use'):values;
 if(role==='admin')return releaseFilter(CRM_PERMISSIONS);
 const grants=await db.crmMemberGrant.findMany({where:{tenantId,membershipId,active:true}});const base=[...new Set(grants.flatMap((g:any)=>ROLE_PERMISSIONS[g.role]??[]))] as string[];
 if(!grants.length)return [];
 const extra=await db.crmMemberPermissionGrant.findMany({where:{tenantId,membershipId,active:true}});
 return releaseFilter([...new Set([...base,...extra.filter((g:any)=>EXTRA_PERMISSIONS.includes(g.permission)&&prerequisite[g.permission]?.every(p=>base.includes(p))).map((g:any)=>g.permission)])] as string[]);
}
