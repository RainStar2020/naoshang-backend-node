const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const A=require('../src/common/api-standard');
const P=require('../src/common/api-standard/users-pilot');
const L=require('../src/routes/hq/lib');
const users=require('../src/routes/hq/modules/users');
const source=fs.readFileSync(path.join(__dirname,'../src/routes/hq/index.js'),'utf8');
const dispatcher=source.slice(source.indexOf('async function handle('),source.indexOf('module.exports ='));
const routes=users.routes.filter(r=>r.method==='GET'&&['/users','/users/:accountId'].includes(r.path)).map(r=>({...r,perm:'admin',names:r.path.includes(':')?['accountId']:[],re:r.path.includes(':')?/^\/users\/([^/]+)$/:/^\/users$/}));
function fixture(){return {users:{'9007199254740993':{id:'9007199254740993',display_id:'QZ1',name:'13812345678',phone:'13812345678',tier:'vip',created_at:1728000000000,last_login_at:'2026-10-29T08:00:00+08:00',password:'NEVER',token:'NEVER',email:'secret@example.com',note:'internal'},'2':{id:'2',name:'Alice',phone:'13912345678',tier:'none',frozen:true,created_at:'2026-01-01T00:00:00Z'}},members:[],hqAuditLogs:[]};}
async function call(urlPath,version=2,sess={role:'hq_admin'},db=fixture()){
  const scope={L,ROUTES:routes,USERS_PILOT:P,SUPPORT_PILOT:require('../src/common/api-standard/support-pilot'),READONLY_BATCH:require('../src/common/api-standard/readonly-batch'),console:{error:()=>{throw Error('Unexpected internal exception');}}};vm.createContext(scope);vm.runInContext(dispatcher,scope);
  const url=new URL('http://memory'+urlPath),headers={authorization:'Bearer fixture','x-trace-id':'pilot-trace',...(version===2?{'x-api-version':'2'}:{})};
  const req={method:'GET',url:urlPath,headers};
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},headersSent:false};
  const before=JSON.stringify(db);
  const priorFlag=process.env.API_STANDARD_USERS_PILOT;
  if(priorFlag===undefined)process.env.API_STANDARD_USERS_PILOT='1';
  try{await A.context(req,res,()=>scope.handle(db,req,res,url,{sessions:sess?{fixture:sess}:{},persist(){throw Error('No persistence allowed');},readBody(){throw Error('No body read allowed');},sendJSON(r,http,body){const result=A.adapt(http,body);r.http=result.httpStatus;r.body=JSON.parse(JSON.stringify(result.body));r.headersSent=true;}}));}
  finally{if(priorFlag===undefined)delete process.env.API_STANDARD_USERS_PILOT;else process.env.API_STANDARD_USERS_PILOT=priorFlag;}
  // Legacy ensureCollections initializes empty collections; business fixtures must not change.
  assert.equal(JSON.stringify({users:db.users,members:db.members,hqAuditLogs:db.hqAuditLogs}),before);
  return res;
}
test('legacy list shape preserved; new pagination and DTO whitelist',async()=>{
  const old=await call('/api/hq/users?page=1&pageSize=1',1);
  assert.equal(old.http,200);assert.equal(old.body.code,0);assert.equal(old.body.message,'ok');assert.equal(old.body.data.page,1);assert.equal(old.body.data.items.length,1);assert.ok(old.body.data.summary);
  const fresh=await call('/api/hq/users?pageNum=1&pageSize=1');
  assert.equal(fresh.headers['X-Trace-Id'],'pilot-trace');assert.equal(fresh.body.status,1);assert.ok(!('message'in fresh.body));
  assert.deepEqual(Object.keys(fresh.body.response).sort(),['list','pageNum','pageSize','total','totalPages'].sort());
  assert.equal(fresh.body.response.total,2);assert.equal(fresh.body.response.totalPages,2);
  assert.equal(fresh.body.response.list[0].isFrozen,true);assert.ok(!('frozen'in fresh.body.response.list[0]));
});
test('detail projection string IDs, ISO timezone, phone/name masking, no secrets',async()=>{
  const old=await call('/api/hq/users/9007199254740993',1);assert.equal(old.body.data.profile.phone,'13812345678');assert.ok('note'in old.body.data.profile);assert.ok('audit'in old.body.data);
  const res=await call('/api/hq/users/9007199254740993');const profile=res.body.response.profile;
  assert.equal(profile.accountId,'9007199254740993');assert.equal(profile.phone,'138****5678');assert.equal(profile.nickname,'138****5678');assert.equal(profile.lastLoginAt,'2026-10-29T00:00:00.000Z');assert.match(profile.createdAt,/Z$/);
  assert.deepEqual(res.body.response.members,[]);
  for(const key of ['password','token','email','note','audit','stack','sql'])assert.ok(!JSON.stringify(res.body).includes('"'+key+'"'));
});
test('strict pagination limits, malformed values and sort whitelist',async()=>{
  for(const q of ['pageSize=101','pageNum=1000001','pageNum=0','pageSize=1x','pageNum=1.5','sortBy=password','sortOrder=drop']){
    const r=await call('/api/hq/users?'+q);assert.equal(r.http,400);assert.equal(r.body.code,'VALIDATION_ERROR');assert.equal(r.body.response,null);assert.ok(r.body.errors.length);assert.equal(typeof r.body.errors[0].field,'string');
  }
  const sorted=await call('/api/hq/users?sortBy=accountId&sortOrder=desc');assert.equal(sorted.body.response.list[0].accountId,'9007199254740993');
  const boundary=await call('/api/hq/users?pageNum=1000000&pageSize=100');assert.equal(boundary.http,200);assert.deepEqual(boundary.body.response.list,[]);
  const old=await call('/api/hq/users?pageNum=0&sortBy=password',1);assert.equal(old.http,200);
});
test('auth, permission and not-found mapping in both versions',async()=>{
  for(const version of [1,2]){
    const unauth=await call('/api/hq/users',version,null);assert.equal(unauth.http,401);assert.equal(unauth.body.code,version===2?'UNAUTHENTICATED':40100);
    const forbidden=await call('/api/hq/users',version,{role:'user'});assert.equal(forbidden.http,version===2?403:401);assert.equal(forbidden.body.code,version===2?'FORBIDDEN':40100);
    const missing=await call('/api/hq/users/missing',version);assert.equal(missing.http,404);assert.equal(missing.body.code,version===2?'NOT_FOUND':40400);
    if(version===2)assert.equal(missing.body.response,null);
  }
});
test('empty list and success-null helper contract without adding an endpoint',async()=>{
  const r=await call('/api/hq/users',2,undefined,{users:{},members:[],hqAuditLogs:[]});assert.deepEqual(r.body.response,{pageNum:1,pageSize:20,total:0,totalPages:0,list:[]});
  assert.deepEqual(A.success(P.project({path:'/users/:accountId'},null)),{status:1,response:null});
});
test('module and global kill switches restore legacy envelope for v2 requests',async()=>{
  for(const key of ['API_STANDARD_USERS_PILOT','API_STANDARD_V2']){
    const before=process.env[key];try{process.env[key]='0';const r=await call('/api/hq/users');assert.equal(r.body.code,0);assert.ok(r.body.data.items);assert.ok(!('status'in r.body));}finally{if(before===undefined)delete process.env[key];else process.env[key]=before;}
  }
});
test('unsafe numeric ID yields safe 500; expired session 401; email nickname masked',async()=>{
  const db=fixture();db.users['2'].id=Number.MAX_SAFE_INTEGER+1;
  const bad=await call('/api/hq/users',2,undefined,db);assert.equal(bad.http,500);assert.equal(bad.body.message,A.SYSTEM_MESSAGE);assert.equal(bad.body.response,null);
  const expired=await call('/api/hq/users',2,{role:'admin',expiresAt:1});assert.equal(expired.http,401);
  const mail=fixture();mail.users['2'].name='secret@example.com';const detail=await call('/api/hq/users/2',2,undefined,mail);assert.equal(detail.body.response.profile.nickname,'s***@example.com');
});
test('OpenAPI local references and pilot endpoint set match implementation',()=>{
  const text=fs.readFileSync(path.join(__dirname,'../docs/api-standardization/phase-2-users.openapi.json'),'utf8').replace(/^\uFEFF/,'');
  const spec=JSON.parse(text);assert.equal(spec.openapi,'3.1.0');
  assert.deepEqual(Object.keys(spec.paths).sort(),['/api/hq/users','/api/hq/users/{accountId}']);
  function walk(value){if(!value||typeof value!=='object')return;if(value.$ref){assert.ok(value.$ref.startsWith('#/'));let target=spec;for(const key of value.$ref.slice(2).split('/'))target=target?.[key];assert.ok(target,value.$ref);}for(const child of Object.values(value))walk(child);}
  walk(spec);
  assert.deepEqual(spec.paths['/api/hq/users'].get.parameters.find(x=>x.name==='sortBy').schema.enum,[...P.SORT_FIELDS]);
  assert.ok(spec.components.schemas.Error.required.includes('response'));
});
