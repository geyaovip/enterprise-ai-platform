import { HttpException } from '@nestjs/common';
const MARKETPLACE_CONNECTOR_IDS: Partial<Record<ConnectorApp, string>>={"erp": "oc_06ab32b1a28708ab", "crm": "oc_dcfa66bf4a96b64a", "mes": "oc_ea90fbdbc89d6582"};
export const CONNECTOR_APPS = ['erp','crm','mes','content','geo','manufacturing'] as const;
export type ConnectorApp = typeof CONNECTOR_APPS[number];
export const CONNECTOR_NAMES = {erp:'知行方舟 ERP',crm:'知行方舟 CRM',mes:'知行方舟 MES',content:'知行方舟 品牌内容',geo:'知行方舟 GEO',manufacturing:'知行方舟 制造业进销存'};
const DRAFT_PERMISSIONS = {erp:'erp.purchase.write',crm:'crm.task.write',mes:'mes.plan.write'};
export type DraftConnectorApp = keyof typeof DRAFT_PERMISSIONS;
const EXECUTION_PERMISSIONS = {content:'content.create',geo:'geo.analysis.run'};
export type ExecutionConnectorApp = keyof typeof EXECUTION_PERMISSIONS;
export function supportsDraft(app: ConnectorApp): app is DraftConnectorApp {
  return Object.hasOwn(DRAFT_PERMISSIONS, app);
}
export function supportsExecution(app: ConnectorApp): app is ExecutionConnectorApp {
  return Object.hasOwn(EXECUTION_PERMISSIONS, app);
}
export const connectorScopes = (app: ConnectorApp) =>
  [app + '.read', ...(supportsDraft(app) ? [app + '.draft'] : supportsExecution(app) ? [app + '.execute'] : [])];
export const canPrepareDraft = (app: ConnectorApp, permissions: readonly string[]) =>
  supportsDraft(app) && permissions.includes(DRAFT_PERMISSIONS[app]);
export const canExecute = (app: ConnectorApp, permissions: readonly string[]) =>
  supportsExecution(app) && permissions.includes(EXECUTION_PERMISSIONS[app]) &&
  (app!=='content' || permissions.includes('content.ai.use'));
export const canReadConnector = (app: ConnectorApp, permissions: readonly string[]) =>
  permissions.some(permission => permission.startsWith(app + '.') && permission.endsWith('.read'));
export function appId(value:string):ConnectorApp {
  if(!(CONNECTOR_APPS as readonly string[]).includes(value))oauthError('invalid_target','不支持的应用',400);
  return value as ConnectorApp;
}
export function publicOrigin() {
  const raw=process.env.CONNECTOR_PUBLIC_ORIGIN??process.env.PUBLIC_WEB_ORIGIN??process.env.WEB_ORIGIN??'https://zhixingark.cn';
  const u=new URL(raw);
  if(u.protocol!=='https:'&&!(process.env.NODE_ENV==='test'&&u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname)))throw Error('Connector origin requires HTTPS');
  if(u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('Invalid connector public origin');
  return u.origin;
}
export const resourceFor=(app:ConnectorApp)=>publicOrigin()+'/api/v1/mcp/'+app;
export function resourceApp(value:string):ConnectorApp {
  const found=CONNECTOR_APPS.find(app=>resourceFor(app)===value);
  if(!found)oauthError('invalid_target','resource必须为指定应用的MCP地址',400);
  return found!;
}
export function oauthError(error:string,description:string,status=400):never {throw new HttpException({error,error_description:description},status);}
export function redirectAllowed(raw:string) {
  try {
    const u=new URL(raw);
    if(u.username||u.password||u.search||u.hash)return false;
    if(u.protocol==='workbuddy:'&&u.hostname==='workbuddy')return CONNECTOR_APPS.some(app=>['zhixing-ark-'+app,MARKETPLACE_CONNECTOR_IDS[app]].some(source=>source && decodeURIComponent(u.pathname)==='/mcp/connector:'+source+'/oauth/callback'));
    return u.protocol==='http:'&&u.hostname==='127.0.0.1'&&Number(u.port)>=1024&&u.pathname==='/oauth/callback';
  }catch{return false;}
}
