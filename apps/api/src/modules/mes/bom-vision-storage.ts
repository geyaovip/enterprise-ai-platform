import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const bomHash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
function directory(tenant:string,job:string){
  if(!uuid.test(tenant)||!uuid.test(job))throw Error('BOM_STORAGE_ID_INVALID');
  return join(resolve(process.env.KNOWLEDGE_STORAGE_DIR??'var/knowledge'),'bom-vision',tenant,job);
}
function file(tenant:string,job:string,name:string){
  if(!/^(?:source-[0-9a-f-]{36}|page-\d{1,2}(?:-image|-result|-ocr)?)(?:\.json|\.png|\.bin)$/.test(name))throw Error('BOM_STORAGE_KEY_INVALID');
  return join(directory(tenant,job),name);
}
export async function writeBomFile(tenant:string,job:string,name:string,bytes:Buffer){
  await mkdir(directory(tenant,job),{recursive:true,mode:0o700});
  const target=file(tenant,job,name),temp=target+'.new';
  await writeFile(temp,bytes,{mode:0o600});await rename(temp,target);
}
export async function readBomFile(tenant:string,job:string,name:string){return readFile(file(tenant,job,name));}
export async function purgeBomFiles(tenant:string,job:string){await rm(directory(tenant,job),{recursive:true,force:true});}
