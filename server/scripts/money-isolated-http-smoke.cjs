#!/usr/bin/env node
'use strict';
// Real ephemeral loopback HTTP, production callback/JSON utilities/HQ dispatcher,
// memory-only fixtures. NEVER import server.js or start its initialization code.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),http=require('node:http'),Module=require('node:module');
const originalLoad=Module._load;
Module._load=function(name,...args){if(/^(pg|mysql|mysql2|sqlite3|better-sqlite3)(\/|$)|^node:sqlite$/.test(name))throw new Error('DATABASE_DRIVER_FORBIDDEN');return originalLoad.call(this,name,...args);};
for(const key of ['writeFile','writeFileSync','appendFile','appendFileSync','rename','renameSync','unlink','unlinkSync','mkdir','mkdirSync','rm','rmSync','open','openSync','createWriteStream'])fs[key]=()=>{throw new Error('FILESYSTEM_WRITE_FORBIDDEN');};
for(const key of ['writeFile','appendFile','rename','unlink','mkdir','rm','open'])fs.promises[key]=()=>{throw new Error('FILESYSTEM_WRITE_FORBIDDEN');};
const A=require('../src/common/api-standard');
const HQ=require('../src/routes/hq');
const {randomUUID}=require('node:crypto');
async function main(){
  for(const flag of ['MONEY_SHADOW_WRITE_PRODUCTS','MONEY_SHADOW_WRITE_CHECKOUT_QUOTES','MONEY_CENTS_READ_PRODUCTS','MONEY_CENTS_READ_CHECKOUT_QUOTES'])process.env[flag]='0';
  delete process.env.API_STANDARD_V2;delete process.env.API_STANDARD_USERS_PILOT;
  const token=randomUUID(),db={users:{},members:[],hqAuditLogs:[]};
  const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
  const utilities=source.slice(source.indexOf('function sendJSON('),source.indexOf('function getSession('));
  const entry=source.slice(source.indexOf('const server = http.createServer('),source.indexOf('// 启动前预检：端口'));
  const scope={API_STANDARD:A,http,URL,HQ,db,sessions:{[token]:{role:'hq_admin'}},console,saveDb(){throw Error('PERSIST_FORBIDDEN');},handleApi(){throw Error('NON_PILOT_FORBIDDEN');},H:{handle(){throw Error('NON_PILOT_FORBIDDEN');}},notApiPath(){throw Error('NON_PILOT_FORBIDDEN');}};
  vm.createContext(scope);vm.runInContext(utilities+'\n'+entry,scope);const server=vm.runInContext('server',scope);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const base='http://127.0.0.1:'+server.address().port;let passed=0;
  const assert=(value,name)=>{if(!value)throw Error('SMOKE_FAILED: '+name);passed++;};
  try{
    const pre=await fetch(base+'/api/hq/users',{method:'OPTIONS',headers:{Origin:'https://isolated.invalid','Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'X-API-Version'}});
    assert(pre.status===204&&await pre.text()==='','OPTIONS204');
    assert(pre.headers.get('access-control-allow-headers').toLowerCase().split(',').includes('x-api-version'),'allow-version');
    assert(pre.headers.get('access-control-expose-headers').toLowerCase()==='x-trace-id','expose-trace');
    assert(pre.headers.get('access-control-allow-origin')==='*','origin-unchanged');
    const get=await fetch(base+'/api/hq/users',{headers:{Authorization:'Bearer '+token,'X-API-Version':'2','X-Trace-Id':'isolated-smoke'}}),body=await get.json();
    assert(get.status===200&&body.status===1&&Array.isArray(body.response.list),'v2-read-only');
    assert(get.headers.get('x-trace-id')==='isolated-smoke'&&get.headers.get('access-control-expose-headers')==='X-Trace-Id','trace-readable');
    const denied=await fetch(base+'/api/hq/users',{headers:{'X-API-Version':'2'}}),error=await denied.json();assert(denied.status===401&&error.code==='UNAUTHENTICATED','auth');
    console.log(JSON.stringify({smoke:'passed',assertions:passed,loopback:true,ephemeralPort:true,database:'forbidden',filesystemWrites:'forbidden',productionEntryInitialization:false}));
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
