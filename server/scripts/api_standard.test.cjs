const test=require('node:test');
const assert=require('node:assert/strict');
const A=require('../src/common/api-standard');
const M=require('../src/common/api-standard/money');
test('response factories and validation',()=>{
  assert.deepEqual(A.success(),{status:1,response:null});
  assert.deepEqual(A.failure('VALIDATION_ERROR','错误',[{field:'name',message:'必填'}]),{status:0,code:'VALIDATION_ERROR',message:'错误',response:null,errors:[{field:'name',message:'必填'}]});
  assert.throws(()=>A.success({n:NaN})); assert.throws(()=>A.success({n:1n}));
});
test('exception mapping',()=>{
  for(const [code,http] of [['VALIDATION_ERROR',400],['UNAUTHENTICATED',401],['FORBIDDEN',403]]) assert.equal(A.mapException(new A.ApiError(code,'提示')).httpStatus,http);
  assert.equal(A.mapException(new SyntaxError('secret')).body.code,'INTERNAL_ERROR');
  assert.equal(A.mapException(new A.ApiError('INVALID_JSON','请求体不是合法 JSON')).body.code,'INVALID_JSON');
  assert.equal(A.mapException(new Error('SQL password')).body.message,A.SYSTEM_MESSAGE);
  assert.equal(A.mapException(new A.ApiError(40901,'冲突')).body.code,'VERSION_CONFLICT');
});
test('default identity and opt-in response adaptation',()=>{
  for(const body of [{x:1},{error:'失败'},{code:0,message:'ok',data:[]},{ok:false,error:'失败'}]) assert.equal(A.adapt(200,body,{version:1}).body,body);
  assert.equal(A.version({}),1); assert.equal(A.version({'x-api-version':'2'}),2);
  assert.deepEqual(A.adapt(200,{x:1},{version:2}).body,A.success({x:1}));
  assert.deepEqual(A.adapt(200,{code:0,message:'ok',data:[]},{version:2,isHq:true}).body,A.success([]));
  assert.equal(A.adapt(401,{error:'未登录'},{version:2}).body.code,'UNAUTHENTICATED');
  assert.equal(A.adapt(500,{error:'SQL secret'},{version:2}).body.message,A.SYSTEM_MESSAGE);
});
test('trace propagation and safe logger without network',async()=>{
  const headers={};
  await A.context({headers:{'x-trace-id':'trace-123'},url:'/me'},{setHeader:(k,v)=>headers[k]=v},async()=>{
    await Promise.resolve(); assert.equal(A.storage.getStore().traceId,'trace-123');
    let log; A.logEvent('request.complete',s=>log=s); assert.match(log,/trace-123/);
  });
  assert.equal(headers['X-Trace-Id'],'trace-123');
});
test('paging strictness, whitelist and legacy adapter',()=>{
  const p=A.paging({pageNum:'2',pageSize:'10',sortBy:'id'},{sortFields:['id']});
  assert.deepEqual(A.legacyPage(A.page([],0,p)),{items:[],total:0,page:2,pageSize:10});
  for(const q of [{pageSize:'101'},{pageNum:'1x'},{pageNum:'0'},{sortBy:'password'},{sortOrder:'SQL'}]) assert.throws(()=>A.paging(q));
});
test('money conversion, precision, limits and currency',()=>{
  assert.deepEqual(M.fromYuan('19.90'),{amountCents:1990,currency:'CNY'});
  assert.equal(M.toYuan(M.fromYuan('0.10')),'0.10');
  assert.equal(M.add(M.fromYuan('0.10'),M.fromYuan('0.20')).amountCents,30);
  for(const v of ['1.001','1e2','-1','NaN']) assert.throws(()=>M.fromYuan(v));
  assert.throws(()=>M.fromYuan(0.1)); assert.throws(()=>M.cents(1,'USD'));
  assert.throws(()=>M.cents(101,'CNY',{maxCents:100}));
  assert.equal(M.cents(Number.MAX_SAFE_INTEGER).amountCents,Number.MAX_SAFE_INTEGER);
  assert.throws(()=>M.add(M.cents(Number.MAX_SAFE_INTEGER),M.cents(1)));
});
test('integer HALF_UP, allocation, sum, subtraction',()=>{
  assert.equal(M.ratio(M.cents(1),1,2).amountCents,1);
  assert.equal(M.ratio(M.cents(1),1n,3n).amountCents,0);
  assert.equal(M.ratio(M.cents(105),1,10).amountCents,11);
  assert.deepEqual(M.split(M.cents(5),3).map(x=>x.amountCents),[2,2,1]);
  assert.equal(M.sum(M.split(M.cents(5),3)).amountCents,5);
  assert.throws(()=>M.subtract(M.cents(0),M.cents(1)));
  assert.throws(()=>M.ratio(M.cents(1),1,0));
});
test('JSON round trip and BigInt guard',()=>{
  const m=M.cents(123); assert.deepEqual(M.deserialize(M.serialize(m)),m);
  assert.throws(()=>M.serialize({amountCents:1n,currency:'CNY'}));
  assert.throws(()=>M.deserialize('{"amountCents":9007199254740992,"currency":"CNY"}'));
});
// Evaluate only the HTTP utility functions and callback with inert injected dependencies.
// Never require server.js (which would initialize data and listen).
const fs=require('node:fs');
const vm=require('node:vm');
const {EventEmitter}=require('node:events');
const source=fs.readFileSync(require('node:path').join(__dirname,'../server.js'),'utf8');
const utilities=source.slice(source.indexOf('function sendJSON('),source.indexOf('function getSession('));
const entry=source.slice(source.indexOf('const server = http.createServer('),source.indexOf('// 启动前预检：端口'));
function harness(overrides={}) {
  let callback;
  const sandbox={API_STANDARD:A,URL,console:{error:()=>{}},http:{createServer:cb=>{callback=cb;return {}; }},db:{},sessions:{},saveDb:()=>{},
    HQ:{handle:async()=>{}},H:{handle:async()=>false},handleApi:async()=>{},notApiPath:()=>{},...overrides};
  vm.createContext(sandbox);
  vm.runInContext(utilities+'\n'+entry,sandbox);
  return {sandbox,callback};
}
function response() {
  const r=new EventEmitter();r.headers={};r.headersSent=false;
  r.setHeader=(k,v)=>r.headers[k]=v;
  r.writeHead=(status,headers)=>{r.status=status;Object.assign(r.headers,headers);r.headersSent=true;};
  r.end=body=>{r.body=body?JSON.parse(body):null;};
  return r;
}
function request(version,path='/api/test') {const r=new EventEmitter();r.headers={host:'localhost','x-trace-id':'memory-trace',...(version===2?{'x-api-version':'2'}:{})};r.url=path;r.method='POST';return r;}
test('actual entry callback unknown exception and legacy preservation, no listen',async()=>{
  for(const v of [1,2]) {
    const h=harness({handleApi:async()=>{throw new Error('SQL secret');}}),res=response();
    await h.callback(request(v),res);
    assert.equal(res.status,500);
    assert.equal(res.headers['X-Trace-Id'],'memory-trace');
    assert.deepEqual(res.body,v===1?{error:'SQL secret'}:A.failure('INTERNAL_ERROR',A.SYSTEM_MESSAGE));
  }
});
test('actual readBody invalid JSON, including swallowed error, preserves default',async()=>{
  for(const v of [1,2]) {
    const h=harness(),res=response(),req=request(v);
    h.sandbox.handleApi=async(r,s)=>{
      let body;try{body=await h.sandbox.readBody(r);}catch{body={};}
      h.sandbox.sendJSON(s,200,body);
    };
    const work=h.callback(req,res);
    // v2 context schedules callback in a microtask.
    await Promise.resolve();req.emit('data','{broken');req.emit('end');await work;
    assert.deepEqual(res.body,v===1?{}:A.failure('INVALID_JSON','请求体不是合法 JSON'));
    assert.equal(res.status,v===1?200:400);
  }
});
test('legacy HQ HqError, H5 auth and validation shapes through entry sender',async()=>{
  for(const v of [1,2]) for(const [http,body,code] of [
    [401,{error:'未登录'},'UNAUTHENTICATED'],[400,{error:'phone 必填'},'VALIDATION_ERROR'],
    [409,{code:40901,message:'版本冲突',data:null},'VERSION_CONFLICT'],
    [500,{code:50000,message:'SQL internal class',data:null},'INTERNAL_ERROR']]) {
    const h=harness(),res=response();h.sandbox.handleApi=async(_,s)=>h.sandbox.sendJSON(s,http,body);
    await h.callback(request(v),res);
    assert.deepEqual(res.body,v===1?body:A.failure(code,http>=500?A.SYSTEM_MESSAGE:(body.message||body.error)));
  }
});
test('new validation exception fields and outer rejection boundary',async()=>{
  const res=response();await A.context(request(2),res,async()=>{throw new A.ApiError('VALIDATION_ERROR','参数错误',[{field:'phone',message:'必填'}]);});
  assert.deepEqual(res.body,A.failure('VALIDATION_ERROR','参数错误',[{field:'phone',message:'必填'}]));
});
test('health, OPTIONS remain legacy by default; opt-in kill switch',async()=>{
  const h=harness(),res=response(),req=request(1,'/health');await h.callback(req,res);
  assert.equal(res.body.ok,true);assert.equal(res.body.service,'naoshang-api');
  const options=response(),preflight=request(2);preflight.method='OPTIONS';await h.callback(preflight,options);
  assert.equal(options.status,204);assert.equal(options.body,null);
  const previous=process.env.API_STANDARD_V2;try{process.env.API_STANDARD_V2='0';assert.equal(A.version({'x-api-version':'2'}),1);}finally{if(previous===undefined)delete process.env.API_STANDARD_V2;else process.env.API_STANDARD_V2=previous;}
});
test('actual HQ dispatcher HqError/auth/unknown paths with memory fixtures only',async()=>{
  const L=require('../src/routes/hq/lib');
  const hqSource=fs.readFileSync(require('node:path').join(__dirname,'../src/routes/hq/index.js'),'utf8');
  const dispatcher=hqSource.slice(hqSource.indexOf('async function handle('),hqSource.indexOf('module.exports ='));
  for(const v of [1,2]) for(const mode of ['auth','validation','unknown']) {
    const h=harness(),res=response(),req=request(v,'/api/hq/memory-test');req.method='GET';
    const route={method:'GET',re:/^\/memory-test$/,names:[],path:'/memory-test',module:'fixture',perm:mode==='auth'?'admin':'public',handler:async()=>{
      if(mode==='validation')throw L.err(L.ERR.INVALID_INPUT,'参数错误');
      throw new Error('SQL secret');
    }};
    const scope={L,ROUTES:[route],USERS_PILOT:require('../src/common/api-standard/users-pilot'),SUPPORT_PILOT:require('../src/common/api-standard/support-pilot'),READONLY_BATCH:require('../src/common/api-standard/readonly-batch'),console:{error:()=>{}}};vm.createContext(scope);vm.runInContext(dispatcher,scope);
    h.sandbox.HQ={handle:scope.handle};await h.callback(req,res);
    if(v===2){assert.equal(res.body.status,0);assert.equal(res.body.response,null);assert.equal(res.body.code,mode==='auth'?'UNAUTHENTICATED':mode==='validation'?'VALIDATION_ERROR':'INTERNAL_ERROR');if(mode==='unknown')assert.equal(res.body.message,A.SYSTEM_MESSAGE);}
    else {assert.equal(res.body.data,null);assert.equal(res.body.code,mode==='auth'?40100:mode==='validation'?40000:50000);}
  }
});
test('route evidence reconciles, aliases and exceptions excluded from denominator',()=>{
  const r=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../docs/api-standardization/phase-1-route-register.json'),'utf8'));
  assert.equal(r.denominator,r.endpoints.length);
  assert.equal(new Set(r.endpoints.map(x=>x.id)).size,r.denominator);
  assert.equal(r.evidenceReconciliation.candidateRecords, Object.entries(r.evidenceReconciliation).filter(([key])=>key!=='candidateRecords').reduce((n,[,v])=>n+v,0));
  assert.equal(r.endpoints.flatMap(x=>x.aliases||[]).length,8);
  for(const x of [...r.endpoints,...r.exceptions])assert.ok(x.handler.line>0);
});
