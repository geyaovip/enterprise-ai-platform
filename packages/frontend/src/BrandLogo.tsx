import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { brandMarks, brandColors, type BrandId } from './brand-marks';
export function BrandLogo({brand='ark',size=36,className=''}:{brand?:BrandId;size?:number;className?:string}) {
  const mark=brandMarks[brand],colors=brandColors();
  return <svg className={`brand-logo ${className}`} width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">{mark.parts.map((p,i)=><path key={i} d={p.d} fill={colors[p.fill]}/>)}</svg>;
}
export const ErpApplicationIcon=()=> <BrandLogo brand="erp"/>;
export const CrmApplicationIcon=()=> <BrandLogo brand="crm"/>;
export const MesApplicationIcon=()=> <BrandLogo brand="mes"/>;
export function BrandIdentity(){
  const {pathname}=useLocation();
  const brand=(pathname.match(/^\/t\/[^/]+\/(erp|crm|mes)(?:\/|$)/)?.[1]??'ark') as BrandId;
  useEffect(()=>{const icon=document.querySelector<HTMLLinkElement>('link[rel="icon"]');if(icon)icon.href=`${import.meta.env.BASE_URL}brand/${brand}.svg`;},[brand]);
  return null;
}
