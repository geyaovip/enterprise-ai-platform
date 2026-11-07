import { sourceQuantityConflict } from './bom-vision-compare';
import { GLM,KIMI,type VisionAnswer,type VisionModel } from './bom-vision.provider';
export type PagePreparation={mime:string;data:string;sha256:string;width:number;height:number;nativeTables:any[];risk:{dense:boolean;distorted:boolean;lowContrast:boolean};hasPartsHeader:boolean;preprocessVersion:string;detail?:{data:string;sha256:string;bbox:number[];width:number;height:number;method:string}|null};
export function kimiVisionEnabled(){return process.env.BOM_VISION_KIMI_ENABLED!=='false';}
export function primaryVisionModel(p:PagePreparation):VisionModel{return !kimiVisionEnabled()||process.env.BOM_VISION_GLM_FIRST==='true'?GLM:p.risk.dense||p.risk.distorted||p.risk.lowContrast?KIMI:GLM;}
export function recheckReasons(a:VisionAnswer|null,p:PagePreparation):string[]{
 if(!a)return ['主识别输出结构不完整'];
 if(!a.rows.length)return p.hasPartsHeader?['原页存在明细表标题，但主识别没有读到行']:[];
 const reasons:string[]=[...literalRecheckReasons(a,p)];
 if(a.uncertainties.length)reasons.push('主识别报告了不确定字段');
 if(a.rows.length>=35)reasons.push('电子或装配明细较密集');
 if(a.rows.some(r=>Object.keys(r.quantities).length&&r.qty!==null))reasons.push('多机型数量与单一用量冲突');
 if(a.rows.some(r=>!Object.keys(r.quantities).length&&r.qty===null&&!/^(?:A\/?R|DNP|DNI)$/i.test(r.sourceQty??'')))reasons.push('存在缺失或未能读出的数量');
 if(a.rows.some(r=>r.designators&&!r.mpn))reasons.push('存在有位号但缺少MPN的行');
 if(a.rows.some(r=>r.qty!==null&&!/^\d+(?:\.\d+)?$/.test(r.qty)))reasons.push('数量格式不明确');
 const numbers=a.rows.map(r=>r.item).filter((s):s is string=>s!==null&&/^\d+$/.test(s)).map(Number);
 if(numbers.length===a.rows.length&&new Set(numbers).size!==numbers.length)reasons.push('来源序号重复');
 if(numbers.length===a.rows.length&&Math.max(...numbers)-Math.min(...numbers)+1>numbers.length)reasons.push('来源序号可能有缺口');
 return reasons;
}
/** Visible source risks only; never consult an answer key or turn glyph guesses into facts. */
export function literalRecheckReasons(a:VisionAnswer,p:PagePreparation):string[]{
 const reasons:string[]=[],values=a.rows.map(r=>[r.part,r.mpn,r.name].filter(Boolean).join(' '));
 const versions=values.filter(v=>/\bV\d+\b/i.test(v)).length;
 const small=!!p.detail&&p.detail.width*p.detail.height/(p.width*p.height)<.15;
 if(a.rows.some(sourceQuantityConflict))reasons.push('原数量文字与结构化用量不一致');
 if(a.variants.length>1&&a.rows.some(r=>r.qty!==null&&!Object.keys(r.quantities).length))reasons.push('存在多个适用机型但单行用量缺少归属');
 if(a.rows.every(r=>!r.part&&!r.mpn&&!r.name)&&a.rows.some(r=>!!r.spec))reasons.push('候选身份字段缺失，仅说明列有内容');
 if(a.rows.length===1&&a.rows[0].qty===null&&a.rows[0].sourceQty===null&&!Object.keys(a.rows[0].quantities).length&&!a.rows[0].designators)reasons.push('孤立条目缺少数量依据，需核实是否为标题栏');
 if(versions&&(a.rows.length>=20||p.risk.distorted||p.risk.lowContrast))reasons.push('版本后缀与细小字符需逐字复核');
 if((small||p.risk.distorted||p.risk.lowContrast)&&values.some(v=>/\bX\s*\d[\d .-]*(?:MM|IN)\b/i.test(v)))reasons.push('尺寸与料号混合单元格需保留原标点');
 return reasons;
}
/** Cost-first mode keeps ordinary review hints visible without buying another pass. */
export function automaticKimiRecheck(a:VisionAnswer|null,p:PagePreparation){
 if(!kimiVisionEnabled())return false;
 if(process.env.BOM_VISION_GLM_FIRST!=='true')return recheckReasons(a,p).length>0;
 if(!a||!a.rows.length&&p.hasPartsHeader)return true;
 if(literalRecheckReasons(a,p).length)return true;
 return a.rows.some(r=>Object.keys(r.quantities).length&&r.qty!==null||r.qty!==null&&!/^\d+(?:\.\d+)?$/.test(r.qty))||a.uncertainties.some(s=>/illegible|unreadable|cannot read|无法辨认|看不清/i.test(s));
}
const normalized=(v:any):any=>typeof v==='string'?v.normalize('NFKC').replace(/\s+/g,'').toUpperCase():Array.isArray(v)?v.map(normalized):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,normalized(v[k])])):v;
export function sameVisionFacts(a:VisionAnswer,b:VisionAnswer){
 const rows=(v:VisionAnswer)=>v.rows.map(r=>JSON.stringify(normalized(r))).sort();
 return a.bomPresent===b.bomPresent&&JSON.stringify(rows(a))===JSON.stringify(rows(b));
}
