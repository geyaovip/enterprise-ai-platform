import { All, Body, Controller, Get, HttpException, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ConnectorAuthService } from './connector-auth.service';
import { ConnectorBusinessService } from './connector-business.service';
import { appId, connectorScopes, publicOrigin, resourceApp } from './connector-policy';

@Controller()
export class ConnectorController {
  constructor(readonly access:ConnectorAuthService,readonly business:ConnectorBusinessService){}
  private secure(res:Response){res.set({'Cache-Control':'no-store','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});}
  private async oauth(res:Response,run:()=>Promise<unknown>,status=200){
    this.secure(res);
    try{res.status(status).json(await run());}
    catch(e){const n=e instanceof HttpException?e.getStatus():500,r=e instanceof HttpException?e.getResponse():null;const p=typeof r==='object'&&r!==null?r as any:{};res.status(n).json({error:typeof p.error==='string'?p.error:n===500?'server_error':'invalid_request',error_description:p.error_description??(n===500?'服务暂不可用':Array.isArray(p.message)?'请求参数不符合规范':p.message??'请求无效')});}
  }
  @Get('.well-known/oauth-authorization-server') metadata(@Res()res:Response){this.secure(res);res.json(this.access.metadata());}
  @Get('.well-known/oauth-protected-resource/api/v1/mcp/:app') protected(@Param('app')a:string,@Res()res:Response){this.secure(res);res.json(this.access.protectedMetadata(appId(a)));}
  @Get('.well-known/oauth-protected-resource') rootProtected(@Query('resource')resource:string,@Res()res:Response){this.secure(res);res.json(this.access.protectedMetadata(resourceApp(resource??'')));}
  @Post('api/v1/oauth/register') register(@Req()req:Request,@Body()body:unknown,@Res()res:Response){return this.oauth(res,()=>this.access.register(req,body),201);}
  @Get('api/v1/oauth/authorize') async authorize(@Req()req:Request,@Query()query:unknown,@Res()res:Response){
    this.secure(res);try{res.redirect(302,await this.access.authorize(req,query));}catch(e){await this.oauth(res,async()=>{throw e;});}
  }
  @Post('api/v1/oauth/token') token(@Req()req:Request,@Body()body:unknown,@Res()res:Response){return this.oauth(res,()=>this.access.token(req,body));}
  @Post('api/v1/oauth/revoke') revoke(@Req()req:Request,@Body()body:unknown,@Res()res:Response){return this.oauth(res,()=>this.access.revokeToken(req,body));}
  @Get('api/v1/connect/requests/:id') details(@Req()req:Request,@Param('id')id:string){return this.access.consentDetails(req,id);}
  @Post('api/v1/connect/requests/:id') consent(@Req()req:Request,@Param('id')id:string,@Body()body:unknown){return this.access.consent(req,id,body);}
  @Get('api/v1/connect/connections') connections(@Req()req:Request){return this.access.connections(req);}
  @Post('api/v1/connect/connections/:id/revoke') disconnect(@Req()req:Request,@Param('id')id:string){return this.access.revokeConnection(req,id);}
  @Get('api/v1/connect/actions/:id') action(@Req()req:Request,@Param('id')id:string){return this.business.actionDetails(req,id);}
  @Post('api/v1/connect/actions/:id') decide(@Req()req:Request,@Param('id')id:string,@Body()body:unknown){return this.business.decide(req,id,body);}

  @All('api/v1/mcp/:app') async mcp(@Req()req:Request,@Res()res:Response,@Param('app')rawApp:string){
    this.secure(res);const app=appId(rawApp);
    let actor:Awaited<ReturnType<ConnectorAuthService['bearer']>>;
    try{actor=await this.access.bearer(req,app);}
    catch(e){
      const status=e instanceof HttpException?e.getStatus():500;
      if(status===401)res.set('WWW-Authenticate',`Bearer resource_metadata="${publicOrigin()}/.well-known/oauth-protected-resource/api/v1/mcp/${app}", scope="${connectorScopes(app).join(' ')}"`);
      return res.status(status).json({error:status===401?'invalid_token':status===429?'rate_limited':'server_error',error_description:status===401?'请连接并授权当前应用':status===429?'请求过于频繁':'服务暂不可用'});
    }
    if(req.method!=='POST')return res.status(405).set('Allow','POST').json({jsonrpc:'2.0',id:null,error:{code:-32000,message:'Stateless endpoint accepts POST only'}});
    const server=new McpServer({name:'zhixing-ark-'+app,version:'1.1.0'});
    for(const tool of this.business.tools(app,actor.grant,actor.ctx)){
      server.registerTool(tool.name,{description:tool.description,inputSchema:tool.schema,annotations:{readOnlyHint:tool.readOnly,destructiveHint:false,idempotentHint:tool.readOnly,openWorldHint:false}},async(input:any)=>{
        try{
          // Refresh identity and tool visibility at actual execution, not only discovery.
          const fresh=await this.access.current(await this.access.db.connectorGrant.findUnique({where:{id:actor.grant.id}}));
          const available=this.business.tools(app,actor.grant,fresh).find(t=>t.name===tool.name);
          if(!available)throw new HttpException('当前工具权限已变化',403);
          const result=JSON.parse(JSON.stringify(await available.run(input)));
          await this.access.db.auditEvent.create({data:{tenantId:fresh.tenantId,userId:fresh.userId,membershipId:fresh.membershipId,appId:app,requestId:fresh.requestId,action:app+'.connector.tool',resourceType:'ConnectorGrant',resourceId:actor.grant.id,detail:{tool:tool.name,channel:'workbuddy'}}});
          return {content:[{type:'text' as const,text:JSON.stringify(result)}],structuredContent:typeof result==='object'&&!Array.isArray(result)&&result!==null?result:{result}};
        }catch(e){const status=e instanceof HttpException?e.getStatus():500,r=e instanceof HttpException?e.getResponse():null,p=typeof r==='object'&&r!==null?r as any:{};return {isError:true,content:[{type:'text' as const,text:JSON.stringify({code:p.code??(status===403||status===401?'FORBIDDEN':status===409?'CONFLICT':status===400?'INVALID_INPUT':'UNAVAILABLE'),message:status>=500?'服务暂不可用，请先回查操作状态':typeof r==='string'?r:p.message??'请求未完成，请核对权限和参数'})}]};}
      });
    }
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    res.on('close',()=>{void transport.close();void server.close();});
    try{await server.connect(transport);await transport.handleRequest(req,res,req.body);}
    catch{if(!res.headersSent)res.status(500).json({jsonrpc:'2.0',id:null,error:{code:-32603,message:'Internal error'}});}
  }
}
