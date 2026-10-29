const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const A=require('../src/common/api-standard'),R=require('../src/common/api-standard/readonly-batch'),P=require('../src/common/api-standard/module-policy'),L=require('../src/routes/hq/lib');
const text=fs.readFileSync(path.join(__dirname,'../src/routes/hq/index.js'),'utf8'),dispatcher=text.slice(text.indexOf('async function handle('),text.indexOf('module.exports ='));
function fixture(){return {users:{},members:[],coStores:[],regionalAgents:[],quotaLedger:{},quota_transactions:[],inviteCodes:[],uplineHistory:[],promotionTasks:[],skus:[],hqProducts:[],hqAuditLogs:[]};}
async function env(flag,value,run){const old=process.env[flag];if(value===undefined)delete process.env[flag];else process.env[flag]=value;try{return await run();}finally{if(old===undefined)delete process.env[flag];else process.env[flag]=old;}}
function probe(name){const routes=require('../src/routes/hq/modules/'+name).routes.filter(r=>r.method==='GET');return routes.find(r=>r.path.endsWith('/catalog'))||routes.find(r=>!r.path.includes(':'));}
async function call(name,version){const route=probe(name),db=fixture(),req={method:'GET',url:'/api/hq'+route.path,headers:{authorization:'Bearer memory','x-trace-id':'module-trace',...(version===2?{'x-api-version':'2'}:{})}},res={headers:{},headersSent:false,setHeader(k,v){this.headers[k]=v;}};
  const compiled={...route,re:new RegExp('^'+route.path+'$'),perm:'admin',names:[]},scope={L,READONLY_BATCH:R,ROUTES:[compiled],console:{error(){throw Error('Unexpected old catch');}}};vm.createContext(scope);vm.runInContext(dispatcher,scope);
  await A.context(req,res,()=>scope.handle(db,req,res,new URL('http://memory'+req.url),{sessions:{memory:{role:'hq_admin'}},persist(){throw Error('PERSIST_FORBIDDEN');},readBody(){throw Error('BODY_READ_FORBIDDEN');},sendJSON(r,http,body){const output=A.adapt(http,body);r.http=output.httpStatus;r.body=JSON.parse(JSON.stringify(output.body));r.headersSent=true;}}));return res;}
for(const [name,config]of Object.entries(P.READ_MODULES)){
  test(name+': factory output',async()=>env(config.flag,'1',async()=>{const old=await call(name,1),fresh=await call(name,2);assert.equal(fresh.http,200);assert.equal(fresh.body.status,1);assert.ok(!('message'in fresh.body));assert.deepEqual(fresh.body.response,old.body.data);assert.equal(fresh.headers['X-Trace-Id'],'module-trace');}));
  test(name+': default legacy contract without version header',async()=>env(config.flag,undefined,async()=>{const result=await call(name,1);assert.equal(result.http,200);assert.equal(result.body.code,0);assert.equal(result.body.message,'ok');assert.ok(!('status'in result.body));assert.equal((await call(name,2)).body.status,1);}));
  test(name+': version2 plus module switch',async()=>env(config.flag,'1',async()=>{assert.equal((await call(name,1)).body.code,0);assert.equal((await call(name,2)).body.status,1);await env(config.flag,'0',async()=>assert.equal((await call(name,2)).body.code,0));}));
}
test('existing write/exception modules never selected by read factory',async()=>{for(const name of Object.keys(P.EXCEPTIONS)){const res={setHeader(){}};await A.context({headers:{'x-api-version':'2'},url:'/api/hq/test'},res,async()=>assert.equal(await R.handle({module:name,method:'GET'}, {},{},res,{}, {},{}),false));}assert.equal(Object.keys(P.READ_MODULES).length,14);});
test('new public interface uses factory without changing existing legacy interfaces',async()=>{
  const res={},ctx={sessions:{},sendJSON(r,http,body){r.http=http;r.body=body;}};let calls=0;
  assert.equal(await R.handleNew({apiStandard:true,perm:'public',handler:async()=>{calls++;return null;}},{},{method:'GET'},res,{searchParams:new URLSearchParams()},{},ctx),true);assert.deepEqual(res.body,{status:1,response:null});assert.equal(calls,1);
  assert.equal(await R.handleNew({apiStandard:false},{},{},res,{}, {},ctx),false);
});
test('new nonpublic factory interface maps auth/validation safely',async()=>{
  const res={},ctx={sessions:{},sendJSON(r,http,body){r.http=http;r.body=body;}};
  await R.handleNew({apiStandard:true,handler:async()=>{}},{},{headers:{},method:'GET'},res,{searchParams:new URLSearchParams()},{},ctx);assert.equal(res.http,401);assert.equal(res.body.response,null);
});
