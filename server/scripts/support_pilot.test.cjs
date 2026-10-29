const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const A=require('../src/common/api-standard'),P=require('../src/common/api-standard/support-pilot'),U=require('../src/common/api-standard/users-pilot'),L=require('../src/routes/hq/lib');
const support=require('../src/routes/hq/modules/support');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const source=read('server.js'),hq=read('src/routes/hq/index.js');
const utilities=source.slice(source.indexOf('function sendJSON('),source.indexOf('function getSession('));
const dispatcher=hq.slice(hq.indexOf('async function handle('),hq.indexOf('module.exports ='));
const routes=[...support.routes.filter(r=>r.method==='GET'&&P.PATHS.includes(r.path)),...require('../src/routes/hq/modules/users').routes.filter(r=>r.method==='GET'&&r.path==='/users')].map(r=>({...r,perm:'admin',names:r.path.includes(':')?['ticketId']:[],re:r.path.includes(':')?/^\/support\/tickets\/([^/]+)$/:new RegExp('^'+r.path+'$')}));
function fixture(){return {users:{},hqAdmins:[{adminId:'9007199254740993',displayName:'13812345678 secret@example.com',phone:'13812345678',email:'secret@example.com',createdAt:'2026-10-29T08:00:00+08:00',updatedAt:1728000000000,password:'SECRET',token:'SECRET',status:'ACTIVE'}],hqSupportTickets:[{id:'9007199254740993',accountId:'12345678901234567',status:'OPEN',category:'general',subject:'联系 13812345678 secret@example.com',createdAt:1728000000000},{id:'2',status:'CLOSED',category:'technical',subject:'Second',createdAt:'2026-01-01T00:00:00Z'}],hqSupportMessages:[{id:'12345678901234567',ticketId:'9007199254740993',senderRole:'user',senderId:'12345678901234567',content:'13812345678 secret@example.com',createdAt:'2026-10-29T08:00:00+08:00'}]};}
function response(){return {headers:{},headersSent:false,setHeader(k,v){this.headers[k]=v;},writeHead(status,headers){this.http=status;Object.assign(this.headers,headers);this.headersSent=true;},end(body){this.body=body?JSON.parse(body):null;}};}
async function call(urlPath,version=2,sess={role:'hq_admin',adminId:'9007199254740993'},db=fixture()){
  const scope={L,ROUTES:routes,USERS_PILOT:U,SUPPORT_PILOT:P,READONLY_BATCH:require('../src/common/api-standard/readonly-batch'),API_STANDARD:A,console:{error:()=>{throw Error('Unexpected old catch');}}};vm.createContext(scope);vm.runInContext(utilities+'\n'+dispatcher,scope);
  const req={method:'GET',url:urlPath,headers:{authorization:'Bearer fixture','x-trace-id':'support-trace',...(version===2?{'x-api-version':'2'}:{})}},res=response(),url=new URL('http://memory'+urlPath);
  const snapshot=JSON.stringify([db.users,db.hqAdmins,db.hqSupportTickets,db.hqSupportMessages]);
  const priorFlags={API_STANDARD_SUPPORT_PILOT:process.env.API_STANDARD_SUPPORT_PILOT,API_STANDARD_USERS_PILOT:process.env.API_STANDARD_USERS_PILOT};
  for(const [key,value]of Object.entries(priorFlags))if(value===undefined)process.env[key]='1';
  try{await A.context(req,res,()=>scope.handle(db,req,res,url,{sessions:sess?{fixture:sess}:{},sendJSON:scope.sendJSON,readBody(){throw Error('No body read');},persist(){throw Error('No writes');}}));}
  finally{for(const [key,value]of Object.entries(priorFlags))if(value===undefined)delete process.env[key];else process.env[key]=value;}
  assert.equal(JSON.stringify([db.users,db.hqAdmins,db.hqSupportTickets,db.hqSupportMessages]),snapshot);return res;
}
test('optional profile is null when absent; no account seeded, legacy and v2',async()=>{
  for(const v of [1,2]){const db=fixture();db.hqAdmins=[];const r=await call('/api/hq/support/profile',v,undefined,db);assert.equal(r.http,200);assert.deepEqual(r.body,v===2?{status:1,response:null}:{code:0,message:'ok',data:null});assert.deepEqual(db.hqAdmins,[]);}
});
test('profile string ID, ISO time, masked phone/email, DTO whitelist',async()=>{
  const r=await call('/api/hq/support/profile');assert.equal(r.headers['X-Trace-Id'],'support-trace');assert.equal(r.body.status,1);const p=r.body.response;
  assert.equal(p.adminId,'9007199254740993');assert.equal(p.createdAt,'2026-10-29T00:00:00.000Z');assert.equal(p.phone,'138****5678');assert.equal(p.email,'s***@example.com');assert.equal(p.isActive,true);
  assert.ok(!JSON.stringify(r.body).includes('SECRET'));assert.ok(!JSON.stringify(r.body).includes('secret@example.com'));assert.ok(!JSON.stringify(r.body).includes('13812345678'));assert.ok(!('message'in r.body));
});
test('shared filtering, new pagination/sort, legacy default shape',async()=>{
  const url='/api/hq/support/tickets?status=OPEN&category=general&keyword=联系';
  const old=await call(url,1);assert.equal(old.body.code,0);assert.equal(old.body.data.items.length,1);assert.equal(old.body.data.page,1);assert.ok(old.body.data.summary);
  const fresh=await call(url+'&pageNum=1&pageSize=1');assert.equal(fresh.body.response.total,1);assert.equal(fresh.body.response.totalPages,1);assert.equal(fresh.body.response.list[0].ticketId,'9007199254740993');
  const empty=await call('/api/hq/support/tickets?status=PENDING');assert.deepEqual(empty.body.response,{pageNum:1,pageSize:20,total:0,totalPages:0,list:[]});
  const sorted=await call('/api/hq/support/tickets?sortBy=ticketId&sortOrder=asc');assert.equal(sorted.body.response.list[0].ticketId,'2');
});
test('validation field errors and upper bounds',async()=>{
  for(const [q,field] of [['pageNum=1000001','pageNum'],['pageSize=101','pageSize'],['pageSize=1x','pageSize'],['pageNum=0','pageNum'],['sortBy=password','sortBy'],['sortOrder=sql','sortOrder']]){const r=await call('/api/hq/support/tickets?'+q);assert.equal(r.http,400);assert.equal(r.body.code,'VALIDATION_ERROR');assert.equal(r.body.response,null);assert.equal(r.body.errors[0].field,field);}
  assert.equal((await call('/api/hq/support/tickets?pageNum=1000000&pageSize=100')).http,200);
});
test('authentication and permission errors across all pilot paths',async()=>{
  for(const url of ['/api/hq/support/profile','/api/hq/support/tickets','/api/hq/support/tickets/2'])for(const v of [1,2]){
    const absent=await call(url,v,null);assert.equal(absent.http,401);assert.equal(absent.body.code,v===2?'UNAUTHENTICATED':40100);
    const user=await call(url,v,{role:'user'});assert.equal(user.http,v===2?403:401);assert.equal(user.body.code,v===2?'FORBIDDEN':40100);if(v===2)assert.equal(user.body.response,null);
  }
});
test('detail string IDs, masked messages and resource-not-found scoped code',async()=>{
  const r=await call('/api/hq/support/tickets/9007199254740993');assert.equal(r.body.response.ticket.ticketId,'9007199254740993');assert.equal(r.body.response.messages[0].senderId,'12345678901234567');assert.ok(!JSON.stringify(r.body).includes('secret@example.com'));
  const missing=await call('/api/hq/support/tickets/missing');assert.equal(missing.http,404);assert.deepEqual(missing.body,A.failure('RESOURCE_NOT_FOUND','请求的资源不存在'));
  const old=await call('/api/hq/support/tickets/missing',1);assert.equal(old.http,404);assert.equal(old.body.code,40400);
});
test('support switch only disables support; global switch preserves old body',async()=>{
  for(const key of ['API_STANDARD_SUPPORT_PILOT','API_STANDARD_V2']){const before=process.env[key];try{process.env[key]='0';const r=await call('/api/hq/support/tickets');assert.equal(r.body.code,0);assert.ok(r.body.data.items);if(key==='API_STANDARD_SUPPORT_PILOT'){const users=await call('/api/hq/users');assert.equal(users.body.status,1);assert.deepEqual(users.body.response.list,[]);}}finally{if(before===undefined)delete process.env[key];else process.env[key]=before;}}
});
test('support unknown exception returns fixed message; no original internal detail',async()=>{
  const db=fixture();db.hqSupportTickets[0].id=Number.MAX_SAFE_INTEGER+1;
  const r=await call('/api/hq/support/tickets',2,undefined,db);assert.equal(r.http,500);assert.deepEqual(r.body,A.failure('INTERNAL_ERROR',A.SYSTEM_MESSAGE));assert.equal(r.headers['Access-Control-Expose-Headers'],'X-Trace-Id');
});
test('support OpenAPI references, sort whitelist and additive route evidence',()=>{
  const spec=JSON.parse(read('docs/api-standardization/phase-2b-support.openapi.json'));
  assert.equal(Object.keys(spec.paths).length,3);
  assert.deepEqual(spec.paths['/api/hq/support/tickets'].get.parameters.find(p=>p.name==='sortBy').schema.enum,[...P.SORT_FIELDS]);
  function walk(value){if(!value||typeof value!=='object')return;if(value.$ref){let target=spec;for(const key of value.$ref.slice(2).split('/'))target=target?.[key];assert.ok(target,value.$ref);}for(const child of Object.values(value))walk(child);}walk(spec);
  assert.ok(spec.components.schemas.ProfileSuccess.properties.response.anyOf.some(s=>s.type==='null'));
  const delta=JSON.parse(read('docs/api-standardization/phase-2b-route-delta.json'));assert.equal(delta.currentDenominator,335);assert.equal(delta.endpoints.filter(e=>e.newRoute).length,1);
  for(const e of delta.endpoints){const lines=read(e.handler.file.replace(/^server\//,'')).split('\n');assert.ok(lines[e.handler.line-1].includes(e.path.replace('/api/hq','')));}
});
test('actual OPTIONS callback remains 204 empty; CORS only adds requested headers',async()=>{
  let callback;const scope={API_STANDARD:A,URL,http:{createServer(cb){callback=cb;return {};}},console:{error(){}},db:{},sessions:{},saveDb(){},HQ:{},H:{},handleApi(){},notApiPath(){}};vm.createContext(scope);
  vm.runInContext(utilities+'\n'+source.slice(source.indexOf('const server = http.createServer('),source.indexOf('// 启动前预检：端口')),scope);
  for(const v of [1,2]){const req={method:'OPTIONS',url:'/api/hq/support/tickets',headers:{host:'memory',...(v===2?{'x-api-version':'2'}:{})}},res=response();await callback(req,res);assert.equal(res.http,204);assert.equal(res.body,null);assert.equal(res.headers['Access-Control-Allow-Origin'],'*');assert.equal(res.headers['Access-Control-Allow-Methods'],'GET,POST,OPTIONS');assert.equal(res.headers['Access-Control-Allow-Headers'],'Content-Type,Authorization,X-API-Version');assert.equal(res.headers['Access-Control-Expose-Headers'],'X-Trace-Id');}
  const r=await call('/api/hq/support/tickets',1);assert.equal(r.body.code,0);assert.equal(r.headers['Access-Control-Expose-Headers'],'X-Trace-Id');
});
