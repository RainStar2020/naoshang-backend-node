'use strict';
// Artifact authoring only. No server entry, DB client or network calls.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const A=require('../src/common/api-standard'),R=require('../src/common/api-standard/readonly-batch'),L=require('../src/routes/hq/lib');
const root=path.join(__dirname,'..'),dir=path.join(root,'docs/api-standardization');
const baselineFile=path.join(dir,'phase-1-route-register.json'),baselineBytes=fs.readFileSync(baselineFile),baseline=JSON.parse(baselineBytes);
const output=(name,value)=>fs.writeFileSync(path.join(dir,'batch-readonly-01-'+name+'.json'),JSON.stringify(value,null,2)+'\n');
const ref=name=>({$ref:'#/components/schemas/'+name});
async function main(){
  const endpoints=[],examples={},paths={};
  for(const module of ['materials','announcements','course']){
    const config=R.MODULES[module];
    const file='src/routes/hq/modules/'+module+'.js',source=fs.readFileSync(path.join(root,file),'utf8');
    const routes=require(path.join(root,file)).routes.filter(r=>r.method==='GET');
    for(const route of routes){const key='GET /api/hq'+route.path,index=source.indexOf("path: '"+route.path+"'"),handlerIndex=source.indexOf('async handler',index);
      if(!baseline.endpoints.some(e=>e.method+' '+e.pathPattern===key))throw Error('NOT_IN_334_BASELINE: '+key);
      const endpoint={method:'GET',path:'/api/hq'+route.path,module,switch:config.flag,defaultEnabled:false,handler:{file:path.join(root,file),line:source.slice(0,handlerIndex).split('\n').length},oldShape:'{code:0,message:"ok",data} / {code:number,message,data:null}',newShape:'{status:1,response} / {status:0,code:string,message,response:null,errors?}',businessPayload:'unchanged',scope:'response envelope only'};endpoints.push(endpoint);
      const db={users:{},hqAuditLogs:[],skus:[],hqProducts:[],hqMaterials:[{id:'m1',title:'Guide',status:'online',createdAt:'2026-01-01T00:00:00Z'}],hqAnnouncements:[{id:'a1',title:'Notice',status:'draft'}],hqCourseEntitlements:[{id:'e1',title:'Course',status:'ACTIVE',validUntil:'2099-01-01T00:00:00Z'}]};
      const data=await route.handler({db,query:new URLSearchParams(),params:{materialId:'m1',announcementId:'a1',entitlementId:'e1'}});
      examples[key]={success:{legacy:L.ok(data),v2:A.success(data)},failure:{http:401,legacy:L.fail(40100,'未登录或 token 已失效'),v2:A.failure('UNAUTHENTICATED','未登录或 token 已失效')},validation:{fixtureOnly:true,http:400,legacy:L.fail(40000,'参数不合法',{errors:[{field:'keyword',message:'格式不正确'}]}),v2:A.failure('VALIDATION_ERROR','参数不合法',[{field:'keyword',message:'格式不正确'}])}};
      const url=endpoint.path.replace(/:(\w+)/g,'{$1}'),parameters=[{name:'X-API-Version',in:'header',required:true,schema:{type:'string',const:'2'},description:'Additionally requires '+config.flag+'=1. Otherwise legacy HQ envelope.'}];
      for(const match of route.path.matchAll(/:(\w+)/g))parameters.push({name:match[1],in:'path',required:true,schema:{type:'string'}});
      const responses={200:{description:'Unified envelope; inner data and legacy pagination are unchanged.',headers:{'X-Trace-Id':{schema:{type:'string'}}},content:{'application/json':{schema:ref('Success'),example:examples[key].success.v2}}}};
      for(const [http,code,message]of [[400,'VALIDATION_ERROR','参数不合法'],[401,'UNAUTHENTICATED','未登录或 token 已失效'],[403,'FORBIDDEN','需要总部后台管理员权限'],[404,'NOT_FOUND','资源不存在'],[500,'INTERNAL_ERROR',A.SYSTEM_MESSAGE]]){
        if(http===404&&!route.path.includes(':'))continue;
        responses[http]={description:http===400?'Common validation contract; fixture tested. This batch adds no parameter validation rules.':code,headers:{'X-Trace-Id':{schema:{type:'string'}}},content:{'application/json':{schema:ref('Error'),example:A.failure(code,message,http===400?[{field:'request',message}]:undefined)}}};
      }
      paths[url]={get:{summary:module+' read envelope pilot',description:'Default switch OFF. Existing business handler called once. No money/DB/catch changes.',parameters,security:[{bearerAuth:[]}],responses,'x-module-switch':config.flag,'x-legacy-success-example':examples[key].success.legacy}};
    }
  }
  const errors={mapping:A.LEGACY_CODES,http:A.CODES,validationFallbackField:'request',messageUsage:'display only; branch on string code',interceptorOrder:['HTTP status','numeric status','string code'],note:'Known field metadata is preserved; do not parse prose to guess fields. Non-admin legacy HQ returns40100; opted-in pilot returns FORBIDDEN403.'};
  const prior=new Set(['GET /api/hq/users','GET /api/hq/users/:accountId','GET /api/hq/support/tickets','GET /api/hq/support/tickets/:ticketId']),current=new Set([...prior,...endpoints.map(e=>e.method+' '+e.path)]);
  const pending=baseline.endpoints.filter(e=>!current.has(e.method+' '+e.pathPattern)).map(e=>({...e,reason:!e.handler.file.includes('/hq/')?'Legacy main/H5 dispatcher or catch chain not selected; avoid swallowed/reclassified errors':e.method!=='GET'?'Write/action endpoint excluded from read-only response batch':/products|orders|payments|revenue|withdrawals|partners|costore/.test(e.handler.file)?'Money/order-related payload requires separate review; outside this batch':'Read-only candidate not yet migrated; handler/DTO/security review pending'}));
  const next=pending.filter(e=>e.method==='GET'&&/\/(staff|training)\.js$/.test(e.handler.file)).slice(0,10).map(e=>({method:e.method,path:e.pathPattern,handler:e.handler,reason:'Proposed only; verify data sensitivity and read-only behavior before next batch.'}));
  output('register',{batchSize:endpoints.length,endpoints});output('examples',examples);output('errors',errors);
  output('coverage',{denominator:334,baselineFile,baselineSha256:crypto.createHash('sha256').update(baselineBytes).digest('hex'),definition:'Module-integrated response factory capability, including explicit disabled-by-default pilots. Transport-only global wrapping is not migration.',prior:prior.size,new:endpoints.length,integrated:current.size,coveragePercent:Number((current.size/334*100).toFixed(2)),defaultOffThisBatch:endpoints.length,outsideDenominator:['GET /api/hq/support/profile (added after baseline)'],pendingCount:pending.length,pending,nextProposed:next});
  const fieldError={type:'object',additionalProperties:false,required:['field','message'],properties:{field:{type:'string'},message:{type:'string'}}};
  const errorSchema={type:'object',additionalProperties:false,required:['status','code','message','response'],properties:{status:{const:0},code:{type:'string'},message:{type:'string'},response:{type:'null'},errors:{type:'array',items:fieldError}},'x-validation-note':'VALIDATION_ERROR includes errors; no known field -> request.'};
  const successSchema={type:'object',additionalProperties:false,required:['status','response'],properties:{status:{const:1},response:{}}};
  output('openapi',{openapi:'3.1.0',info:{title:'Read-only envelope batch 01',version:'1.0.0',description:'Default legacy. X-API-Version:2 AND per-module flag=1 required. Inner data unchanged; no new validation or pagination rules.'},paths,components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer'}},schemas:{Success:successSchema,Error:errorSchema}}});
  console.log(JSON.stringify({batch:endpoints.length,integrated:current.size,denominator:334,pending:pending.length,nextProposed:next}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
