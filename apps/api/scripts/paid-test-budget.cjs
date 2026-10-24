const fs=require('node:fs');
class PaidTestBudget {
 constructor({maxCalls=24,maxTokens=100000,file}){
  if(!Number.isSafeInteger(maxCalls)||maxCalls<1||!Number.isSafeInteger(maxTokens)||maxTokens<1)throw Error('Invalid paid test budget');
  this.maxCalls=maxCalls;this.maxTokens=maxTokens;this.file=file;this.calls=0;this.knownTokens=0;this.unknown=0;
 }
 stop(message){return Object.assign(Error(message),{infrastructure:true});}
 begin(){if(this.calls>=this.maxCalls||this.knownTokens>=this.maxTokens||this.unknown)throw this.stop('PAID_TEST_BUDGET_STOP');this.calls++;return this.calls;}
 record(receipt){
  const input=receipt.inputTokens,output=receipt.outputTokens;
  const known=Number.isSafeInteger(input)&&input>=0&&Number.isSafeInteger(output)&&output>=0;
  if(known)this.knownTokens+=Math.max(Number.isSafeInteger(receipt.totalTokens)&&receipt.totalTokens>=0?receipt.totalTokens:0,input+output);else if(receipt.usageStatus!=='not_requested')this.unknown++;
  const record={...receipt,budget:{attempts:this.calls,knownTokens:this.knownTokens,unknown:this.unknown,maxCalls:this.maxCalls,maxTokens:this.maxTokens}};
  if(this.file){const fd=fs.openSync(this.file,'a',0o600);try{fs.writeSync(fd,JSON.stringify(record)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  return record;
 }
}
module.exports={PaidTestBudget};
