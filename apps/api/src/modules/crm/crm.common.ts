import {HttpException} from '@nestjs/common';
import {z} from 'zod';
import {Prisma} from '../../generated/prisma/client';
import {fingerprint} from '../orchestration/command-registry';
export const hash=fingerprint;
export function problem(code:string,message:string,status=409):never{throw new HttpException({code,message},status);}
export function parse<T>(schema:z.ZodType<T>,raw:unknown):T{const result=schema.safeParse(raw);if(!result.success)throw new HttpException({code:'INVALID_REQUEST',message:'请检查填写的字段',fieldErrors:result.error.issues.slice(0,30).map(x=>({path:x.path.join('.'),code:x.code,message:x.message}))},400);return result.data;}
export const uuid=z.uuid();export const key=z.uuid();export const version=z.int().positive();
export const currency=z.enum(['CNY','USD','EUR','HKD']);
export const money=z.string().regex(/^\d{1,15}(?:\.\d{1,2})?$/,'金额须为非负十进制字符串，最多两位小数');
export const iso=z.iso.datetime({offset:true});
export const reason=z.string().trim().min(2).max(1000);
export const Decimal=Prisma.Decimal;
export const json=(value:any):Prisma.InputJsonValue=>JSON.parse(JSON.stringify(value));
export const dec=(value:any)=>new Decimal(value??0);
export const amount=(value:any)=>dec(value).toFixed(2);
export function pagination(q:any){return parse(z.object({page:z.coerce.number().int().min(1).max(100000).default(1),page_size:z.coerce.number().int().min(1).max(100).default(20)}),q??{});}
export const pageResult=(items:any[],total:number,p:{page:number;page_size:number},extra={})=>({items,total,...p,...extra});
export function assertVersion(record:{version:number}|null,expected:number){if(!record)problem('NOT_FOUND','记录不存在',404);if(record.version!==expected)problem('VERSION_CONFLICT','记录已变化，请重新打开后核对。');}
export function cleanText(value:string){if(/(?:1[3-9]\d{9})|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:api[_-]?key|password|secret|密码|密钥)\s*[:=：]/i.test(value))problem('SENSITIVE_CONTENT','请勿在方案、备注或AI草稿中保存联系方式、密码或密钥。',400);return value;}
export function day(value:Date,zone='Asia/Shanghai'){return new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(value);}
export function dayDifference(a:Date,b:Date,zone='Asia/Shanghai'){return Math.round((Date.parse(day(a,zone))-Date.parse(day(b,zone)))/86400000);}
export function subtractDays(value:Date,count:number){return new Date(value.getTime()-count*86400000);}
export const conditionalStates=['paid','completed'];
