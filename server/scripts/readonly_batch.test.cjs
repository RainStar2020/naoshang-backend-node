const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const A=require('../src/common/api-standard'),R=require('../src/common/api-standard/readonly-batch'),L=require('../src/routes/hq/lib');
const hq=fs.readFileSync(path.join(__dirname,'../src/routes/hq/index.js'),'utf8');
const dispatcher=hq.slice(hq.indexOf('async function handle('),hq.indexOf('module.exports ='));
const routes=['materials','announcements','course'].flatMap(name=>require('../src/routes/hq/modules/'+name).routes.filter(r=>r.method==='GET')).map(r=>{const names=[];return {...r,perm:'admin',names,re:new RegExp('^'+r.path.split('/').map(s=>{if(s.startsWith(':')){names.push(s.slice(1));return '([^/]+)';}return s;}).join('/')+'$')};}).sort((a,b)=>Number(a.path.includes(':'))-Number(b.path.includes(':')));
const values={materialId:'m1',announcementId:'a1',entitlementId:'e1'};
const urlFor=r=>'/api/hq'+r.path.replace(/:(\w+)/g,(_,key)=>values[key]);
function fixture(){return {users:{},members:[],hqAuditLogs:[],skus:[],hqProducts:[],hqMaterials:[{id:'m1',title:'Guide',status:'online',createdAt:'2026-01-01T00:00:00Z'}],hqAnnouncements:[{id:'a1',title:'Notice',status:'draft'}],hqCourseEntitlements:[{id:'e1',accountId:'u1',title:'Course',status:'ACTIVE',validUntil:'2099-01-01T00:00:00Z'}]};}
async function flags(config,run){const before={};for(const [k,v]of Object.entries(config)){before[k]=process.env[k];if(v===undefined)delete process.env[k];else process.env[k]=v;}try{return await run();}finally{for(const [k,v]of Object.entries(before))if(v===undefined)delete process.env[k];else process.env[k]=v;}}
const allOn=Object.fromEntries(Object.values(R.MODULES).map(c=>[c.flag,'1']));
async function request(url,{version=2,session={role:'hq_admin'},db=fixture(),override}={}){
  let calls=0;const wrapped=routes.map(r=>({...r,handler:async ctx=>{calls++;return (override||r.handler)(ctx);}}));
  const scope={L,ROUTES:wrapped,READONLY_BATCH:R,USERS_PILOT:require('../src/common/api-standard/users-pilot'),SUPPORT_PILOT:require('../src/common/api-standard/support-pilot'),console:{error(){}}};vm.createContext(scope);vm.runInContext(dispatcher,scope);
  const req={method:'GET',url,headers:{authorization:'Bearer fixture','x-trace-id':'readonly-batch-trace',...(version===2?{'x-api-version':'2'}:{})}},res={headers:{},headersSent:false,setHeader(k,v){this.headers[k]=v;}};
  const before=JSON.stringify(fixtureKeys(db));
  await A.context(req,res,()=>scope.handle(db,req,res,new URL('http://memory'+url),{sessions:session?{fixture:session}:{},readBody(){throw Error('BODY_READ_FORBIDDEN');},persist(){throw Error('PERSIST_FORBIDDEN');},sendJSON(r,http,body){const result=A.adapt(http,body);r.http=result.httpStatus;r.body=JSON.parse(JSON.stringify(result.body));r.headersSent=true;}}));
  assert.equal(JSON.stringify(fixtureKeys(db)),before);return {...res,calls};
}
function fixtureKeys(db){return Object.fromEntries(['users','members','hqAuditLogs','skus','hqProducts','hqMaterials','hqAnnouncements','hqCourseEntitlements'].map(k=>[k,db[k]]));}
test('nine real read handlers: old data equals new response, one shared invocation',async()=>flags(allOn,async()=>{
  assert.equal(routes.length,9);for(const route of routes){const old=await request(urlFor(route),{version:1}),fresh=await request(urlFor(route));assert.equal(old.body.code,0);assert.equal(old.body.message,'ok');assert.equal(fresh.body.status,1);assert.ok(!('message'in fresh.body));assert.deepEqual(fresh.body.response,old.body.data);assert.equal(fresh.calls,1);assert.equal(fresh.headers['X-Trace-Id'],'readonly-batch-trace');}
}));
test('module defaults ON for version 2, legacy unchanged, global and individual rollback',async()=>{
  const defaults=Object.fromEntries(Object.values(R.MODULES).map(c=>[c.flag,undefined]));await flags(defaults,async()=>{for(const route of routes){assert.equal((await request(urlFor(route))).body.status,1);assert.equal((await request(urlFor(route),{version:1})).body.code,0);}});
  await flags({...allOn,API_STANDARD_V2:'0'},async()=>{assert.equal((await request('/api/hq/materials')).body.code,0);});
  await flags({...allOn,API_STANDARD_MATERIALS_PILOT:'0'},async()=>{assert.equal((await request('/api/hq/materials')).body.code,0);assert.equal((await request('/api/hq/announcements')).body.status,1);});
});
test('authentication and permission contract across all nine endpoints',async()=>flags(allOn,async()=>{
  for(const route of routes){const none=await request(urlFor(route),{session:null});assert.equal(none.http,401);assert.equal(none.body.code,'UNAUTHENTICATED');assert.equal(none.body.response,null);assert.equal(none.calls,0);
    const user=await request(urlFor(route),{session:{role:'user'}});assert.equal(user.http,403);assert.equal(user.body.code,'FORBIDDEN');assert.equal(user.calls,0);
    const old=await request(urlFor(route),{version:1,session:{role:'user'}});assert.equal(old.http,401);assert.equal(old.body.code,40100);
  }
}));
test('actual details preserve legacy404 and map new NOT_FOUND',async()=>flags(allOn,async()=>{
  for(const route of routes.filter(r=>r.path.includes(':'))){const url=urlFor(route).replace(/\/(m1|a1|e1)$/,'/missing');const old=await request(url,{version:1}),fresh=await request(url);assert.equal(old.http,404);assert.equal(old.body.code,40400);assert.equal(fresh.http,404);assert.equal(fresh.body.code,'NOT_FOUND');assert.equal(fresh.body.response,null);}
}));
test('empty real lists remain [] without pagination/parameter semantic changes',async()=>flags(allOn,async()=>{
  const db=fixture();db.hqMaterials=[];db.hqAnnouncements=[];db.hqCourseEntitlements=[];
  for(const url of ['/api/hq/materials','/api/hq/announcements','/api/hq/course/entitlements']){const fresh=await request(url,{db});assert.deepEqual(fresh.body.response.items,[]);assert.equal(fresh.body.response.total,0);assert.equal(fresh.body.response.page,1);assert.equal(fresh.body.response.pageSize,20);}
}));
test('controlled validation exceptions map fields; generic metadata falls back to request',async()=>flags(allOn,async()=>{
  const error=()=>{throw L.err(40000,'参数不合法',{errors:[{field:'keyword',message:'格式不正确'}]});};
  const old=await request('/api/hq/materials',{version:1,override:error}),fresh=await request('/api/hq/materials',{override:error});assert.equal(old.body.code,40000);assert.equal(old.body.data,null);assert.equal(fresh.http,400);assert.deepEqual(fresh.body,A.failure('VALIDATION_ERROR','参数不合法',[{field:'keyword',message:'格式不正确'}]));
  const generic=await request('/api/hq/materials',{override:()=>{throw L.err(40000,'参数不合法');}});assert.equal(generic.body.errors[0].field,'request');
}));
test('unknown errors are fixed500; null/undefined handler fixtures normalize to null',async()=>flags(allOn,async()=>{
  const error=await request('/api/hq/materials',{override:()=>{throw Error('SQL secret internal class');}});assert.equal(error.http,500);assert.deepEqual(error.body,A.failure('INTERNAL_ERROR',A.SYSTEM_MESSAGE));
  for(const value of [null,undefined])assert.deepEqual((await request('/api/hq/materials',{override:()=>value})).body,{status:1,response:null});
  assert.deepEqual(R.mapped(null).body,A.failure('INTERNAL_ERROR',A.SYSTEM_MESSAGE));
}));
test('write routes and unrelated modules are excluded',async()=>{
  let called=false;const res={setHeader(){}};await A.context({headers:{'x-api-version':'2'},url:'/api/hq/materials/mutate'},res,async()=>{assert.equal(await R.handle({method:'POST',module:'materials',path:'/materials/mutate'}, {},{},res,{}, {},{sendJSON(){called=true;}}),false);});assert.equal(called,false);
});
test('published nine routes, baseline coverage and OpenAPI examples agree',()=>{
  const read=name=>JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/api-standardization/batch-readonly-01-'+name+'.json'),'utf8'));
  const register=read('register'),coverage=read('coverage'),spec=read('openapi'),examples=read('examples');assert.equal(register.endpoints.length,9);assert.equal(Object.keys(spec.paths).length,9);assert.equal(coverage.integrated,13);assert.equal(coverage.pending.length,321);assert.equal(coverage.integrated+coverage.pending.length,334);
  const baseline=fs.readFileSync(path.join(__dirname,'../docs/api-standardization/phase-1-route-register.json'));assert.equal(require('node:crypto').createHash('sha256').update(baseline).digest('hex'),coverage.baselineSha256);
  for(const endpoint of register.endpoints){assert.ok(endpoint.handler.line>0);assert.equal(endpoint.defaultEnabled,false);const sample=examples[endpoint.method+' '+endpoint.path];assert.deepEqual(sample.success.legacy.data,sample.success.v2.response);assert.equal(sample.validation.v2.response,null);assert.ok(sample.validation.v2.errors.length);}
  function walk(value){if(!value||typeof value!=='object')return;if(value.$ref){let target=spec;for(const part of value.$ref.slice(2).split('/'))target=target?.[part];assert.ok(target,value.$ref);}for(const child of Object.values(value))walk(child);}walk(spec);
  assert.ok(!Object.keys(require.cache).some(p=>/node_modules[\\/](mysql2|pg|sequelize|typeorm)[\\/]/.test(p)));
});
