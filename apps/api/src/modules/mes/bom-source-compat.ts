/** Retired comparison metadata is hidden without rewriting stored source evidence. */
export function withoutRetiredBomChecks<T>(value:T):T{
 if(Array.isArray(value))return value.map(withoutRetiredBomChecks) as T;
 if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return value;
 return Object.fromEntries(Object.entries(value).filter(([key])=>!['ocrCheck','ocrComparison'].includes(key)).map(([key,item])=>[
  key,withoutRetiredBomChecks(key==='reviewReasons'&&Array.isArray(item)?item.filter(reason=>typeof reason!=='string'||!reason.startsWith('独立OCR发现疑点')):item),
 ])) as T;
}
