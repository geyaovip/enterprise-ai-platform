/** Original vector brand masters. Public assets and React marks share these paths. */
export type BrandId = 'ark' | 'erp' | 'crm' | 'mes';
type Part = { d: string; fill: 'primary' | 'accent' | 'white' };
export const brandMarks: Record<BrandId, {name:string;meaning:string;parts:Part[]}> = {
  ark: {name:'知行方舟',meaning:'扬帆前行，承载企业行动',parts:[
    {d:'M23 5 7 28h16V5Z',fill:'primary'},
    {d:'M28 12v16h14L28 12Z',fill:'accent'},
    {d:'M5 33h38l-5.4 7.2a4 4 0 0 1-3.2 1.6H14.6a4 4 0 0 1-3.2-1.6L5 33Z',fill:'primary'},
  ]},
  erp: {name:'进销存 ERP',meaning:'货物流转，业务闭环',parts:[
    {d:'m24 6 17 9.5L24 25 7 15.5 24 6Z',fill:'primary'},
    {d:'m7 20 14 8v15L7 35V20Z',fill:'accent'},
    {d:'m27 28 14-8v15l-14 8V28Z',fill:'primary'},
  ]},
  crm: {name:'电商 CRM',meaning:'连接客户，持续经营',parts:[
    {d:'M24 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM10 24a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm28 0a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z',fill:'primary'},
    {d:'m19 18 3 2-5.5 8-3-2L19 18Zm10 0 5.5 8-3 2-5.5-8 3-2ZM19 28h10v4H19v-4ZM12 42a16 16 0 0 1 24 0l-3 2a12 12 0 0 0-18 0l-3-2Z',fill:'accent'},
  ]},
  mes: {name:'制造执行 MES',meaning:'生产协同，执行落地',parts:[
    {d:'M21 4h6l1.5 5.5 4 2.3 5.5-1.5 3 5.2-4 4v5l4 4-3 5.2-5.5-1.5-4 2.3L27 40h-6l-1.5-5.5-4-2.3-5.5 1.5-3-5.2 4-4v-5l-4-4 3-5.2 5.5 1.5 4-2.3L21 4Z',fill:'primary'},
    {d:'M24 12a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z',fill:'white'},
    {d:'m22 16 9 6-9 6V16Z',fill:'primary'},
    {d:'M14 43h20v3H14v-3Z',fill:'accent'},
  ]},
};
export function brandColors(mode:'color'|'mono'|'inverse'='color') {
  return mode==='inverse'?{primary:'#ffffff',accent:'#ffffff',white:'#6554d9'}:mode==='mono'?{primary:'#202535',accent:'#202535',white:'#ffffff'}:{primary:'#6554d9',accent:'#a294ed',white:'#ffffff'};
}
export function brandSvg(id:BrandId,mode:'color'|'mono'|'inverse'='color') {
  const mark=brandMarks[id],colors=brandColors(mode);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none" role="img" aria-label="${mark.name}"><title>${mark.name}</title>${mark.parts.map(p=>`<path d="${p.d}" fill="${colors[p.fill]}"/>`).join('')}</svg>`;
}
