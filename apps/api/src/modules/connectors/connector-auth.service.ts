import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../platform/auth.service';
import { readBody } from '../platform/security';
import { appId, CONNECTOR_APPS, CONNECTOR_NAMES, canExecute, canPrepareDraft, canReadConnector, connectorScopes, publicOrigin, resourceFor, resourceApp, redirectAllowed, oauthError, type ConnectorApp } from './connector-policy';

export const connectorHash=(s:string)=>createHash('sha256').update(s).digest('hex');
const secret=()=>randomBytes(32).toString('base64url');
const json=(v:unknown)=>JSON.parse(JSON.stringify(v));
const scopeList=(v:string)=>[...new Set(v.split(/\s+/).filter(Boolean))];
type Tx=Prisma.TransactionClient;

@Injectable()
export class ConnectorAuthService {
  constructor(readonly db:PrismaService,readonly auth:AuthService){}

  metadata(){const issuer=publicOrigin();return {issuer,authorization_endpoint:issuer+'/api/v1/oauth/authorize',token_endpoint:issuer+'/api/v1/oauth/token',registration_endpoint:issuer+'/api/v1/oauth/register',revocation_endpoint:issuer+'/api/v1/oauth/revoke',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'],scopes_supported:CONNECTOR_APPS.flatMap(connectorScopes),authorization_response_iss_parameter_supported:true};}
  protectedMetadata(app:ConnectorApp){return {resource:resourceFor(app),resource_name:CONNECTOR_NAMES[app],authorization_servers:[publicOrigin()],scopes_supported:connectorScopes(app),bearer_methods_supported:['header']};}

  async limit(req:Request,purpose:string,max:number,seconds=300){
    const window=Math.floor(Date.now()/(seconds*1000));
    const key=purpose+':'+connectorHash(req.ip??'unknown').slice(0,32)+':'+window;
    const row=await this.db.connectorRate.upsert({where:{key},create:{key,expiresAt:new Date((window+1)*seconds*1000)},update:{count:{increment:1}}});
    if(row.count>max)oauthError('temporarily_unavailable','请求过于频繁，请稍后重试',429);
  }
  async register(req:Request,raw:unknown){
    await this.limit(req,'register',20,3600);
    const p=readBody(z.object({client_name:z.string().trim().min(1).max(100).default('WorkBuddy'),redirect_uris:z.array(z.string().max(500)).min(1).max(3),grant_types:z.array(z.enum(['authorization_code','refresh_token'])).optional(),response_types:z.array(z.literal('code')).optional(),token_endpoint_auth_method:z.literal('none').optional()}),raw);
    if(p.redirect_uris.some(uri=>!redirectAllowed(uri)))oauthError('invalid_redirect_uri','仅支持指定WorkBuddy连接器回调或本机回环回调');
    const c=await this.db.connectorClient.create({data:{name:p.client_name,redirectUris:p.redirect_uris}});
    return {client_id:c.id,client_name:c.name,redirect_uris:p.redirect_uris,grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'};
  }
  async authorize(req:Request,raw:unknown){
    await this.limit(req,'authorize',60);
    const p=readBody(z.object({client_id:z.uuid(),redirect_uri:z.string().max(500),response_type:z.literal('code'),code_challenge:z.string().regex(/^[A-Za-z0-9_-]{43}$/),code_challenge_method:z.literal('S256'),resource:z.string().max(500),scope:z.string().max(300).optional(),state:z.string().min(1).max(2048).optional()}),raw);
    const client=await this.db.connectorClient.findUnique({where:{id:p.client_id}});
    if(!client||!(client.redirectUris as string[]).includes(p.redirect_uri)||!redirectAllowed(p.redirect_uri))oauthError('invalid_request','客户端或回调地址不匹配');
    const app=resourceApp(p.resource),supported=connectorScopes(app),scopes=p.scope===undefined?supported:scopeList(p.scope);
    if(!scopes.includes(app+'.read')||scopes.some(s=>!supported.includes(s)))oauthError('invalid_scope','授权范围必须属于当前应用');
    const row=await this.db.connectorAuthorization.create({data:{clientId:client.id,redirectUri:p.redirect_uri,appId:app,resource:p.resource,scopes,state:p.state,challenge:p.code_challenge,expiresAt:new Date(Date.now()+10*60000)}});
    return publicOrigin()+'/connect/authorize?request='+row.id;
  }
  private async pending(id:string){
    const row=await this.db.connectorAuthorization.findUnique({where:{id}});
    if(!row||row.expiresAt<=new Date()||row.deniedAt||row.codeHash||row.consumedAt)oauthError('invalid_request','连接请求已失效，请回WorkBuddy重新连接');
    return row;
  }
  async consentDetails(req:Request,id:string){
    const user=await this.auth.user(req),row=await this.pending(id),app=row.appId as ConnectorApp;
    const memberships=await this.db.membership.findMany({where:{userId:user.id,active:true,tenant:{active:true}},include:{tenant:{select:{slug:true,name:true}}},take:100});
    const tenants=[] as Array<{key:string;name:string;draftAllowed:boolean;executionAllowed:boolean}>;
    for(const m of memberships){
      try{const ctx=await this.auth.context(req,m.tenant.slug,app);if(canReadConnector(app,ctx.permissions))tenants.push({key:m.tenant.slug,name:m.tenant.name,draftAllowed:canPrepareDraft(app,ctx.permissions),executionAllowed:canExecute(app,ctx.permissions)});}catch{}
    }
    const nonce=secret();
    const changed=await this.db.connectorAuthorization.updateMany({where:{id,codeHash:null,deniedAt:null,expiresAt:{gt:new Date()}},data:{consentUserId:user.id,consentHash:connectorHash(nonce)}});
    if(!changed.count)oauthError('invalid_request','连接请求已变化');
    const c=await this.db.connectorClient.findUnique({where:{id:row.clientId}});
    return {id,appId:app,name:CONNECTOR_NAMES[app],clientName:c?.name??'WorkBuddy',requestedScopes:row.scopes,expiresAt:row.expiresAt,tenants,nonce};
  }
  async consent(req:Request,id:string,raw:unknown){
    const user=await this.auth.user(req);
    const p=readBody(z.object({nonce:z.string().min(32).max(100),decision:z.enum(['allow','deny']),tenantKey:z.string().max(100).optional(),allowDraft:z.boolean().default(false),allowExecution:z.boolean().default(false)}).strict(),raw);
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "ConnectorAuthorization" WHERE id=${id} FOR UPDATE`;
      const row=await tx.connectorAuthorization.findUnique({where:{id}});
      if(!row||row.expiresAt<=new Date()||row.codeHash||row.deniedAt||row.consumedAt||row.consentUserId!==user.id||row.consentHash!==connectorHash(p.nonce))oauthError('invalid_request','连接请求已失效或不属于当前登录用户');
      const redirect=new URL(row.redirectUri);if(row.state)redirect.searchParams.set('state',row.state);redirect.searchParams.set('iss',publicOrigin());
      if(p.decision==='deny'){await tx.connectorAuthorization.update({where:{id},data:{deniedAt:new Date(),consentHash:null}});redirect.searchParams.set('error','access_denied');return {redirect:redirect.toString()};}
      if(!p.tenantKey)oauthError('invalid_request','请选择企业');
      const app=row.appId as ConnectorApp,ctx=await this.auth.context(req,p.tenantKey!,app);
      if(!canReadConnector(app,ctx.permissions))throw new ForbiddenException('当前岗位无可授权的业务读取权限');
      if(p.allowDraft&&(!(row.scopes as string[]).includes(app+'.draft')||!canPrepareDraft(app,ctx.permissions)))throw new ForbiddenException('当前岗位无草稿准备权限');
      if(p.allowExecution&&(!(row.scopes as string[]).includes(app+'.execute')||!canExecute(app,ctx.permissions)))throw new ForbiddenException('当前岗位无付费任务提交权限');
      const scopes=[app+'.read',...(p.allowDraft?[app+'.draft']:[]),...(p.allowExecution?[app+'.execute']:[])];
      const grant=await tx.connectorGrant.create({data:{clientId:row.clientId,userId:user.id,tenantId:ctx.tenantId,membershipId:ctx.membershipId,appId:app,resource:row.resource,scopes,expiresAt:new Date(Date.now()+30*86400000)}});
      const code=secret();await tx.connectorAuthorization.update({where:{id},data:{grantId:grant.id,codeHash:connectorHash(code),consentHash:null,expiresAt:new Date(Date.now()+5*60000)}});
      await tx.auditEvent.create({data:{tenantId:ctx.tenantId,userId:ctx.userId,membershipId:ctx.membershipId,appId:'platform',requestId:ctx.requestId,action:'platform.connector.authorize',resourceType:'ConnectorGrant',resourceId:grant.id,detail:{appId:app,scopes,clientId:row.clientId}}});
      redirect.searchParams.set('code',code);return {redirect:redirect.toString()};
    },{timeout:15000});
  }
  private async issue(tx:Tx,grant:any){
    const access=secret(),refresh=secret(),expiresAt=new Date(Math.min(Date.now()+3600000,grant.expiresAt.getTime()));
    await tx.connectorToken.createMany({data:[{hash:connectorHash(access),grantId:grant.id,kind:'access',expiresAt},{hash:connectorHash(refresh),grantId:grant.id,kind:'refresh',expiresAt:grant.expiresAt}]});
    return {access_token:access,token_type:'Bearer',expires_in:Math.floor((expiresAt.getTime()-Date.now())/1000),refresh_token:refresh,scope:(grant.scopes as string[]).join(' ')};
  }
  async token(req:Request,raw:unknown){
    await this.limit(req,'token',120);
    const p=readBody(z.object({grant_type:z.enum(['authorization_code','refresh_token']),client_id:z.uuid(),code:z.string().max(200).optional(),code_verifier:z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/).optional(),redirect_uri:z.string().max(500).optional(),refresh_token:z.string().max(200).optional(),resource:z.string().max(500),scope:z.string().max(300).optional()}),raw);
    resourceApp(p.resource);
    if(p.grant_type==='authorization_code'){
      if(!p.code||!p.code_verifier||!p.redirect_uri)oauthError('invalid_request','授权码参数不完整');
      return this.db.$transaction(async tx=>{
        const hash=connectorHash(p.code!);await tx.$queryRaw`SELECT id FROM "ConnectorAuthorization" WHERE "codeHash"=${hash} FOR UPDATE`;
        const a=await tx.connectorAuthorization.findUnique({where:{codeHash:hash}});
        const challenge=createHash('sha256').update(p.code_verifier!).digest('base64url');
        if(!a||!a.grantId||a.consumedAt||a.expiresAt<=new Date()||a.clientId!==p.client_id||a.redirectUri!==p.redirect_uri||a.resource!==p.resource||a.challenge!==challenge)oauthError('invalid_grant','授权码、PKCE或资源不匹配');
        const grant=await tx.connectorGrant.findUnique({where:{id:a.grantId}});if(!grant||grant.revokedAt||grant.expiresAt<=new Date())oauthError('invalid_grant','连接授权已失效');
        await this.current(grant);
        await tx.connectorAuthorization.update({where:{id:a.id},data:{consumedAt:new Date()}});
        return this.issue(tx,grant);
      },{timeout:15000});
    }
    if(!p.refresh_token)oauthError('invalid_request','缺少刷新凭证');
    const answer=await this.db.$transaction(async tx=>{
      const t=await tx.connectorToken.findUnique({where:{hash:connectorHash(p.refresh_token!)}});if(!t||t.kind!=='refresh')return {error:true};
      await tx.$queryRaw`SELECT id FROM "ConnectorGrant" WHERE id=${t.grantId} FOR UPDATE`;
      const grant=await tx.connectorGrant.findUnique({where:{id:t.grantId}}),fresh=await tx.connectorToken.findUnique({where:{id:t.id}});
      if(!grant||grant.clientId!==p.client_id||grant.resource!==p.resource||grant.revokedAt||grant.expiresAt<=new Date()||!fresh||fresh.expiresAt<=new Date())return {error:true};
      if(fresh.usedAt){await tx.connectorGrant.update({where:{id:grant.id},data:{revokedAt:new Date()}});return {error:true};}
      if(p.scope&&scopeList(p.scope).sort().join(' ')!==(grant.scopes as string[]).slice().sort().join(' '))return {error:true};
      await this.current(grant);
      await tx.connectorToken.update({where:{id:t.id},data:{usedAt:new Date()}});
      return {tokens:await this.issue(tx,grant)};
    },{timeout:15000});
    if('error'in answer)oauthError('invalid_grant','刷新凭证失效，请重新连接');
    return answer.tokens;
  }
  async current(grant:any){
    if(!grant||grant.revokedAt||grant.expiresAt<=new Date())oauthError('invalid_token','连接授权已失效',401);
    try{
      const app=appId(grant.appId);
      const ctx=await this.auth.taskContext({tenantId:grant.tenantId,userId:grant.userId,membershipId:grant.membershipId,appId:app,taskId:'mcp:'+randomUUID()});
      if(!canReadConnector(app,ctx.permissions))oauthError('invalid_token','岗位读取权限已失效',401);
      return ctx;
    }
    catch{oauthError('invalid_token','企业、应用或成员授权已失效',401);}
  }
  async bearer(req:Request,app:ConnectorApp){
    const m=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization??'');if(!m)oauthError('invalid_token','请先连接并授权当前应用',401);
    const token=await this.db.connectorToken.findUnique({where:{hash:connectorHash(m![1])}});
    if(!token||token.kind!=='access'||token.expiresAt<=new Date())oauthError('invalid_token','访问凭证已失效',401);
    const grant=await this.db.connectorGrant.findUnique({where:{id:token.grantId}});
    if(!grant||grant.appId!==app||grant.resource!==resourceFor(app))oauthError('invalid_token','凭证不属于当前应用',401);
    const ctx=await this.current(grant);await this.limit(req,'mcp:'+grant!.id,180);
    await this.db.connectorGrant.update({where:{id:grant!.id},data:{lastUsedAt:new Date()}});
    return {grant:grant!,ctx};
  }
  async revokeToken(req:Request,raw:unknown){
    await this.limit(req,'revoke',60);
    const p=readBody(z.object({token:z.string().min(1).max(200),client_id:z.uuid(),token_type_hint:z.string().optional()}),raw);
    const t=await this.db.connectorToken.findUnique({where:{hash:connectorHash(p.token)}});
    if(t)await this.db.connectorGrant.updateMany({where:{id:t.grantId,clientId:p.client_id,revokedAt:null},data:{revokedAt:new Date()}});
    return {};
  }
  async connections(req:Request){
    const user=await this.auth.user(req),grants=await this.db.connectorGrant.findMany({where:{userId:user.id},orderBy:{createdAt:'desc'},take:100});
    const tenants=await this.db.tenant.findMany({where:{id:{in:grants.map(g=>g.tenantId)}},select:{id:true,name:true}});
    return grants.map(g=>({id:g.id,appId:g.appId,name:CONNECTOR_NAMES[g.appId as ConnectorApp],tenantName:tenants.find(t=>t.id===g.tenantId)?.name??'企业不可用',scopes:g.scopes,expiresAt:g.expiresAt,createdAt:g.createdAt,lastUsedAt:g.lastUsedAt,status:g.revokedAt?'revoked':g.expiresAt<=new Date()?'expired':'active'}));
  }
  async revokeConnection(req:Request,id:string){
    const user=await this.auth.user(req),g=await this.db.connectorGrant.findFirst({where:{id,userId:user.id}});if(!g)throw new NotFoundException('授权不存在');
    await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "ConnectorGrant" WHERE id=${id} FOR UPDATE`;
      await tx.connectorGrant.update({where:{id},data:{revokedAt:new Date()}});
      await tx.auditEvent.create({data:{tenantId:g.tenantId,userId:user.id,membershipId:g.membershipId,appId:'platform',requestId:randomUUID(),action:'platform.connector.revoke',resourceType:'ConnectorGrant',resourceId:id}});
    });return {revoked:true};
  }
}
