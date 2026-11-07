import { useEffect, useRef, useState } from 'react';
import { useApiData } from './hooks';
import { SearchSelect } from './SearchSelect';
const formLabels = new WeakMap<HTMLElement, Map<string,string>>();

/** One paged, scoped remote lookup. Search never commits an object ID. */
export function EntitySelect<T extends {id:string}>({label,labelHidden,path,value,selectedLabel,selectedPath,onChange,format,filter,required=false,disabled=false,emptyLabel,clearable=true}: {
  label:string;labelHidden?:boolean;path:string|null;value:string;selectedLabel?:string;selectedPath?:string|null;onChange:(id:string,item:T|null)=>void;format:(item:T)=>string;filter?:(item:T)=>boolean;required?:boolean;disabled?:boolean;emptyLabel?:string;clearable?:boolean;
}) {
  const anchor=useRef<HTMLDivElement>(null);
  const select=useRef<HTMLSelectElement>(null);
  const [open,setOpen]=useState(false);
  const [query,setQuery]=useState(''),[search,setSearch]=useState(''),[origin,setOrigin]=useState(path);
  if(origin!==path){setOrigin(path);setQuery('');setSearch('');}
  const scope=`${path}:${search}`;
  const [view,setView]=useState({scope,page:1});
  if(view.scope!==scope)setView({scope,page:1});
  const page=view.scope===scope?view.page:1;
  const [collection,setCollection]=useState<{scope:string;items:T[]}>({scope,items:[]});
  const chosen=useRef<{path:string|null;id:string;label:string}|null>(null);
  useEffect(()=>{const timer=setTimeout(()=>setSearch(query),250);return()=>clearTimeout(timer);},[query]);
  const params=new URLSearchParams(path?.split('?')[1]??'');params.set('q',search);params.set('page',String(page));params.set('page_size','20');
  const data=useApiData<{items:T[];total:number}|T[]>(path&&open&&!disabled&&query===search?`${path.split('?')[0]}?${params}`:null);
  useEffect(()=>{if(!data.data)return;const items=Array.isArray(data.data)?data.data:data.data.items;setCollection(previous=>({scope,items:page>1&&previous.scope===scope?[...new Map([...previous.items,...items].map(item=>[item.id,item])).values()]:items}));},[data.data,scope,page]);
  const received=data.data?(Array.isArray(data.data)?data.data:data.data.items):null;
  const rows=query!==search?[]:page===1&&received?received:collection.scope===scope?collection.items:[];
  const total=data.data?(Array.isArray(data.data)?data.data.length:data.data.total):0;
  const form=anchor.current?.closest<HTMLElement>('form,.form-panel');
  const cached=form?formLabels.get(form)?.get(`${path}:${value}`):undefined;
  const picked=useApiData<T>(value&&selectedPath&&!selectedLabel&&!cached&&chosen.current?.id!==value?selectedPath:null);
  const commit=(id:string)=>{const item=rows.find(item=>item.id===id)??null;chosen.current=item?{path,id:item.id,label:format(item)}:null;const owner=anchor.current?.closest<HTMLElement>('form,.form-panel');if(owner&&item){if(!formLabels.has(owner))formLabels.set(owner,new Map());formLabels.get(owner)!.set(`${path}:${id}`,format(item));}onChange(id,item);};
  return <div ref={anchor} className="entity-select"><SearchSelect label={label} labelHidden={labelHidden} value={value??''} required={required} disabled={disabled||!path} clearable={clearable} emptyLabel={emptyLabel}
    selectedLabel={chosen.current?.path===path&&chosen.current.id===value?chosen.current.label:selectedLabel??cached??(picked.data?format(picked.data):value?'已选择的记录':'')}
    options={rows.filter(item=>!filter||filter(item)).map(item=>({value:item.id,label:format(item)}))} query={query} onQueryChange={setQuery}
    onOpenChange={next=>{setOpen(next);if(next)setView({scope,page:1});}}
    loading={data.loading||query!==search} error={data.error??picked.error} onRetry={()=>void (picked.error?picked.reload():data.reload())}
    hasMore={rows.length<total} onMore={()=>{if(!data.loading)setView({scope,page:page+1});}}
    onChange={id=>{if(!select.current||select.current.matches(':disabled'))return;select.current.value=id;select.current.dispatchEvent(new Event('change',{bubbles:true}));}}/>
    <select ref={select} hidden style={{display:'none'}} aria-hidden="true" tabIndex={-1} disabled={disabled||!path} value={value??''} onChange={event=>commit(event.target.value)}>
      {[...new Set(['',value??'',...rows.map(item=>item.id)])].map(id=><option key={id} value={id}>{id}</option>)}
    </select>
  </div>;
}
