import { useEffect,useRef,useState } from 'react';
import { api,errorText,ApiError } from '../api';
import { useLocation } from 'react-router-dom';

type Callbacks={start:()=>void;busy:(v:boolean)=>void;result:(v:any)=>void;error:(v:string|null)=>void};
/** Polling only reads an existing task; it never submits a model retry. */
export function useBomVisionTask(path:string,enabled:boolean,callbacks:Callbacks){
 const [task,setTask]=useState<any>(null),[polling,setPolling]=useState(false);
 const refs=useRef(callbacks);refs.current=callbacks;
 const generation=useRef(0),active=useRef(false),key='bom-task:'+path;
 const location=useLocation(),requested=new URLSearchParams(location.search).get('bomTask');
 const store=(id?:string)=>{try{if(id)localStorage.setItem(key,id);else localStorage.removeItem(key);}catch{}};
 const cached=()=>{try{return localStorage.getItem(key);}catch{return null;}};
 async function watch(id:string,token:number){
  while(generation.current===token){
   const value=await api.get<any>(path+'/intake/jobs/'+id,{timeoutMs:20000});
   if(generation.current!==token)return;
   setTask(value);
   if(value.status==='completed'){refs.current.result(value.result);window.dispatchEvent(new Event('suite:notifications-changed'));return;}
   if(!['queued','running'].includes(value.status)){store();refs.current.error(value.message??(value.status==='cancelled'?'本次识别已停止':'识别未完成，请核对原件'));return;}
   await new Promise(resolve=>setTimeout(resolve,1500));
  }
 }
 async function run(start:()=>Promise<{id:string;status:string}>){
  if(active.current)return;active.current=true;const token=++generation.current;
  setTask(null);refs.current.start();refs.current.busy(true);setPolling(true);refs.current.error(null);
  try{const value=await start();if(generation.current!==token)return;store(value.id);setTask(value);await watch(value.id,token);}
  catch(e){if(generation.current===token){if(e instanceof ApiError&&[403,404].includes(e.status)){store();setTask(null);}refs.current.error(errorText(e));}}
  finally{if(generation.current===token){active.current=false;setPolling(false);refs.current.busy(false);}}
 }
 const resume=(id:string)=>run(async()=>({id,status:'queued'}));
 useEffect(()=>{
  ++generation.current;active.current=false;setTask(null);setPolling(false);refs.current.busy(false);
  if(!enabled)return;
  let stopped=false;const id=requested??cached();
  if(id&&!/^[0-9a-f-]{36}$/i.test(id)){refs.current.error('识别任务编号无效');return;}
  if(id){void resume(id);}else{void api.get<any[]>(path+'/intake/jobs',{timeoutMs:20000}).then(jobs=>{if(!stopped&&jobs[0])void resume(jobs[0].id);}).catch(()=>{});}
  return()=>{stopped=true;generation.current++;active.current=false;};
 },[path,enabled,requested]);
 async function cancel(){
  if(!task?.id)return;
  try{const value=await api.post<any>(path+'/intake/jobs/'+task.id+'/cancel');if(value.status==='completed'){await resume(task.id);return;}generation.current++;active.current=false;store();setTask({...task,status:value.status});setPolling(false);refs.current.busy(false);window.dispatchEvent(new Event('suite:notifications-changed'));refs.current.error('本次识别已停止；已发出请求的用量仍会保留核对');}catch(e){refs.current.error(errorText(e));}
 }
 return {task,polling,pending:task&&['queued','running'].includes(task.status),submit:(body:unknown)=>run(()=>api.post(path+'/intake/jobs',body,{timeoutMs:30000})),resume:()=>task?.id?resume(task.id):Promise.resolve(),cancel,recheck:(pageIndex:number)=>task?.id?run(()=>api.post(path+'/intake/jobs/'+task.id+'/recheck',{pageIndex})):Promise.resolve(),clear:()=>{generation.current++;active.current=false;store();setTask(null);}};
}
