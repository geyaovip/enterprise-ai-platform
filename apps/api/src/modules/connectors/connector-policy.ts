import { HttpException } from '@nestjs/common';
export const MARKETPLACE_CONNECTOR_IDS={"erp": "oc_06ab32b1a28708ab", "crm": "oc_dcfa66bf4a96b64a", "mes": "oc_ea90fbdbc89d6582"};
export const CONNECTOR_APPS = ['erp','crm','mes'] as const;
export type ConnectorApp = typeof CONNECTOR_APPS[number];
export const CONNECTOR_NAMES = {erp:'知行方舟 ERP',crm:'知行方舟 CRM',mes:'知行方舟 MES'};
export const DRAFT_PERMISSIONS = {erp:'erp.purchase.write',crm:'crm.task.write',mes:'mes.plan.write'};
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
    if(u.protocol==='workbuddy:'&&u.hostname==='workbuddy')return CONNECTOR_APPS.some(app=>['zhixing-ark-'+app,MARKETPLACE_CONNECTOR_IDS[app]].some(source=>decodeURIComponent(u.pathname)==='/mcp/connector:'+source+'/oauth/callback'));
    return u.protocol==='http:'&&u.hostname==='127.0.0.1'&&Number(u.port)>=1024&&u.pathname==='/oauth/callback';
  }catch{return false;}
}
