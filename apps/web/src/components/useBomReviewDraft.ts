import { useEffect,useRef,useState } from 'react';
import { api,errorText } from '../api';
import { encodeBomReview } from '../mes/bomReviewDraft';

export function useBomReviewDraft(path:string,task:any,result:any,onDirty?:(v:boolean)=>void){
 const signature=task?.status==='completed'&&result?JSON.stringify(encodeBomReview(result)):'';
 const [saved,setSaved]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState<string|null>(null),[savedAt,setSavedAt]=useState<string|null>(null),[blocked,setBlocked]=useState(false);
 const version=useRef(0),pending=useRef<any>(null),lock=useRef(false),epoch=useRef(0),live=useRef({signature,task}),dirtyCallback=useRef(onDirty);live.current={signature,task};dirtyCallback.current=onDirty;
 const dirty=!!signature&&signature!==saved;
 useEffect(()=>{epoch.current++;version.current=task?.review?.version??0;pending.current=null;lock.current=false;setSaving(false);setSaved(signature);setSavedAt(task?.review?.savedAt??null);setBlocked(false);setError(null);},[task]);
 useEffect(()=>{dirtyCallback.current?.(dirty);},[dirty]);
 useEffect(()=>()=>{epoch.current++;dirtyCallback.current?.(false);},[]);
 async function save(){
  const current=live.current;if(lock.current||!current.signature||current.task?.status!=='completed')return;
  lock.current=true;setSaving(true);setError(null);const stamp=epoch.current;
  const attempt=pending.current?.signature===current.signature?pending.current:{signature:current.signature,version:version.current,resultVersion:current.task.resultVersion,requestKey:crypto.randomUUID()};pending.current=attempt;
  try{
   const value=await api.put<any>(path+'/intake/jobs/'+current.task.id+'/review',{version:attempt.version,resultVersion:attempt.resultVersion,requestKey:attempt.requestKey,review:JSON.parse(attempt.signature)},{timeoutMs:20000});
   if(epoch.current!==stamp)return;version.current=value.version;pending.current=null;setSaved(attempt.signature);setSavedAt(value.savedAt);setBlocked(false);
  }catch(e){if(epoch.current===stamp){setBlocked(true);setError(errorText(e)+'；自动暂存已停止，当前修改仍保留在本页。');}}
  finally{if(epoch.current===stamp){lock.current=false;setSaving(false);}}
 }
 useEffect(()=>{if(!dirty||blocked||saving)return;const timer=setTimeout(()=>void save(),900);return()=>clearTimeout(timer);},[signature,saved,blocked,saving,task]);
 return {dirty,saving,error,savedAt,save,blocked};
}
