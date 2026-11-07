import assert from 'node:assert/strict';
import {contentProjectContext} from '../packages/frontend/src/content-employee.ts';
const id='d41db9a6-7cb3-40e1-9918-15dc8bd3de6d';
assert.equal(contentProjectContext('/t/example/content/projects/'+id),id);
assert.equal(contentProjectContext('/t/example/content/projects/'+id+'/manage'),id);
for(const path of ['/t/example/content','/t/example/content/brands','/t/example/content/ai','/t/example/crm/projects/'+id,'/content/projects/'+id,'/t/example/content/projects/not-an-id','/t/example/content/projects/'+id+'extra'])assert.equal(contentProjectContext(path),null);
console.log('9 current-project context checks passed; unrelated app and malformed paths excluded');
