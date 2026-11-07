export function matchSourceReference<T extends { id:string; name:string }>(rows:T[], code:string, name:string, codeOf:(v:T)=>string) {
  const candidates=code?rows.filter(r=>codeOf(r)===code):name?rows.filter(r=>r.name===name):[];
  return { record:candidates.length===1?candidates[0]:null, status:candidates.length===1?'matched':candidates.length>1?'ambiguous':'unmatched' };
}
