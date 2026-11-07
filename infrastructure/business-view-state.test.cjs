const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../apps/web/node_modules/typescript');
const compiled = ts.transpileModule(fs.readFileSync('apps/web/src/business-context.tsx', 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
let checks = 0;
function equal(actual,expected){assert.deepEqual(JSON.parse(JSON.stringify(actual)),expected);checks++;}
function setup({raw=null,blocked=false,search='',pathname='/t/alpha/erp/products',user='one'}={}){
 const values=new Map([['suite:view-user',user],['suite:view:'+user+':'+pathname+':page',raw]]);let state,started=false;
 const sandbox={exports:{},require:name=>name==='react'?{useState:init=>{if(!started){state=typeof init==='function'?init():init;started=true;}return[state,next=>{state=typeof next==='function'?next(state):next;}];},useCallback:fn=>fn}:name==='react-router-dom'?{useLocation:()=>({pathname,search})}: {},URLSearchParams};
 Object.defineProperty(sandbox,'sessionStorage',{get(){if(blocked==='property')throw Error('Storage denied');return{getItem:key=>{if(blocked)throw Error('Storage denied');return values.get(key)??null;},setItem:(key,value)=>{if(blocked)throw Error('Storage denied');values.set(key,value);}};}});
 vm.runInNewContext(compiled,sandbox);
 return{render:(field='page',initial=1)=>sandbox.exports.useViewState(field,initial),values,reset:()=>{started=false;}};
}
for(const blocked of [true,'property']){const e=setup({blocked});let [page,set]=e.render();equal(page,1);set(2);equal(e.render()[0],2);set(v=>v+1);equal(e.render()[0],3);}
for(const raw of ['-1','0','1.5','1e309','9007199254740992','"2"','null','broken']){equal(setup({raw}).render()[0],1);}
const stored=setup({raw:'3'});equal(stored.render()[0],3);stored.render()[1](p=>p+1);equal(stored.render()[0],4);equal(stored.values.get('suite:view:one:/t/alpha/erp/products:page'),'4');
equal(setup({raw:'3',search:'?q=coffee'}).render()[0],1);equal(setup({raw:'3',search:'?focus=record'}).render()[0],1);
const isolated=setup({user:'two'});isolated.values.set('suite:view:one:/t/alpha/erp/products:page','9');equal(isolated.render()[0],1);
const filter=setup();filter.values.set('suite:view:one:/t/alpha/erp/products:filters','{"q":"coffee","status":42,"obsolete":"ignore"}');equal(filter.render('filters',{q:'',status:''})[0],{q:'coffee',status:''});
console.log(JSON.stringify({passed:true,assertions:checks,coverage:['blocked storage reads and writes','functional updates without storage','invalid saved page recovery','query/focus overrides','account isolation','malformed filter compatibility'],realModelCalls:0}));
