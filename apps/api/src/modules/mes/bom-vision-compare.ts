import type { VisionAnswer } from './bom-vision.provider';
type Row=VisionAnswer['rows'][number];
const key=(v:unknown):string=>typeof v==='string'?v.normalize('NFKC').replace(/\s+/g,'').toUpperCase():v&&typeof v==='object'?JSON.stringify(Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[key(k),key(x)]))):'';
const numeric=(v:unknown)=>{const s=key(v);return /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(s)?('0'+s).replace(/^0+(?=\d)/,'').replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,''):s;};
const unit=(v:unknown)=>{const s=key(v);return ['PCS','PC','EA','PIECE','PIECES','件','个'].includes(s)?'PIECE':s;};
export function sourceQuantityConflict(r:Row){const literal=/^((?:\d+(?:\.\d+)?|\.\d+))(?:PCS|PC|EA|件|个|MM|CM|KG|G|M)?$/i.exec(key(r.sourceQty));return !!literal&&r.qty!==null&&numeric(literal[1])!==numeric(r.qty);}
const identity=(r:Row)=>[r.part,r.mpn,r.name].map(key).join('|');
/** Never pair duplicate item numbers with the first arbitrary row. No fuzzy identity matching. */
export function compareVisionRows(primary:VisionAnswer,secondary:VisionAnswer){
 return secondary.rows.map(r=>{
  const items=r.item===null?[]:primary.rows.filter(p=>key(p.item)===key(r.item));
  const itemUnique=items.length===1&&secondary.rows.filter(p=>key(p.item)===key(r.item)).length===1;
  const same=primary.rows.filter(p=>identity(p)===identity(r));
  const exactUnique=identity(r)!=='||'&&same.length===1&&secondary.rows.filter(p=>identity(p)===identity(r)).length===1;
  const other=itemUnique?items[0]:exactUnique?same[0]:undefined;
  const identityDifferent=!!other&&['part','mpn','name','spec','revision','manufacturer'].some(k=>key(other[k as keyof Row])!==key(r[k as keyof Row]));
  const quantityDifferent=sourceQuantityConflict(r)||!!other&&(sourceQuantityConflict(other)||numeric(other.qty)!==numeric(r.qty)||unit(other.unit)!==unit(r.unit)||key(other.quantities)!==key(r.quantities));
  return {other,aligned:!!other,different:!!other&&key(other)!==key(r),identityDifferent,quantityDifferent};
 });
}
