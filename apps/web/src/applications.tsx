import type { ComponentType } from 'react';
// Frontend modules are trusted build-time code, paired with a server manifest.
export type BusinessApplicationEntry = {appId:string;routePrefix:string;description?:string;shortName?:string;Page:ComponentType<{tenantKey:string;permissions:readonly string[]}>};
const entries=new Map<string,BusinessApplicationEntry>();
export function registerBusinessApplication(entry:BusinessApplicationEntry){
 const refreshing=import.meta.env.DEV&&entries.get(entry.appId)?.routePrefix===entry.routePrefix;
 if(!/^[a-z][a-z0-9_]{1,31}$/.test(entry.appId)||!/^\/[a-z][a-z0-9_-]*$/.test(entry.routePrefix)||entry.appId==='erp'||(!refreshing&&entries.has(entry.appId)))throw Error('Invalid application UI registration');
 entries.set(entry.appId,entry);
}
export function businessApplicationEntries(){return [...entries.values()];}
