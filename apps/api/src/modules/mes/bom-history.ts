import { notPopulated } from './mes.rules';

export const bomIdentityKey=(v:unknown)=>{
  const value=typeof v==='string'?v.normalize('NFKC').trim().toUpperCase():'';
  return ['','~','-','N/A','UNKNOWN','未提供','待定','?'].includes(value)?'':value;
};
const key=bomIdentityKey;

/** Exact, reviewed source-row reuse only; no fuzzy OCR alias learning. */
export function sameReviewedSource(current:any,prior:any):boolean {
  const source=prior?.sourceEvidence;
  if(Object.keys(current.quantities??{}).length&&!current.selectedVariant)return false;
  if(!source?.reviewed||source.factReviewed!==true||current.method==='manual-source'||source.method==='manual-source')return false;
  if(!/^[a-f0-9]{64}$/.test(current.sha256??'')||current.sha256!==source.sha256)return false;
  if(!current.method||current.method!==source.method||!Number.isInteger(current.row)||current.row<1||!Number.isInteger(current.table)||current.table<1)return false;
  for(const f of ['page','sheet','table','row'])if((current[f]??null)!==(source[f]??null))return false;
  if(!key(current.originalSku??current.sku)||key(current.originalSku??current.sku)!==key(source.originalSku))return false;
  for(const f of ['revision','productCode','spec','length','comment','value','connector','terminal','selectedVariant'])if(key(current[f])!==key(source[f]))return false;
  if(key(current.originalUnit??current.sourceUnit)!==key(source.originalUnit))return false;
  for(const f of ['mpn','manufacturer','footprint','population'])if(key(current[f])&&key(source[f])&&key(current[f])!==key(source[f]))return false;
  return true;
}

/** Identity evidence only. Never transfers historical quantity, population or a
 * supplier code into current facts. Published status/ACL/product are caller checks. */
export function compatibleHistory(current:any,prior:any):boolean {
  const source=prior?.sourceEvidence;
  if(Object.keys(current.quantities??{}).length&&!current.selectedVariant)return false;
  if(!source?.reviewed||((source.hasConflict||source.quantityBasis||source.historyMatch)&&!source.factReviewed))return false;
  if(notPopulated(source.population,source.originalQuantity,source.mpn)||notPopulated(current.population,current.sourceQuantity,current.mpn))return false;
  if(sameReviewedSource(current,prior))return true;
  if(!key(current.mpn)||!key(current.manufacturer)||key(current.mpn)!==key(source.mpn)||key(current.manufacturer)!==key(source.manufacturer))return false;
  for(const field of ['footprint','revision','spec','length','comment','value','connector','terminal','selectedVariant'])if(key(current[field])&&key(source[field])&&key(current[field])!==key(source[field]))return false;
  return true;
}
