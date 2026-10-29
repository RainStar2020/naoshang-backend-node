'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const policy=require('../src/common/api-standard/module-policy');
const root=path.join(__dirname,'..'),repo=path.join(root,'..');
function literalRoutes(source){return new Set([...source.matchAll(/method:\s*'([^']+)'\s*,\s*path:\s*'([^']+)'/g)].map(m=>m[1].toUpperCase()+' '+m[2]));}
function checkModule(name,routes,source,baseline=''){
  const errors=[],old=literalRoutes(baseline);
  if(!policy.READ_MODULES[name]&&!policy.EXCEPTIONS[name]&&!routes.every(r=>r.apiStandard===true))errors.push(name+': unknown module requires explicit factory registration');
  if(/\b(?:res|response)\s*(?:\.|\[)|\bsendJSON\s*\(/.test(source))errors.push(name+': direct HTTP response access bypasses central factory');
  for(const route of routes){
    if(route.module!==name)errors.push(name+': route.module must identify its registered module');
    if(!old.has(route.method.toUpperCase()+' '+route.path)){
      const automatic=route.method.toUpperCase()==='GET'&&!!policy.READ_MODULES[name];
      if(!automatic&&route.apiStandard!==true)errors.push(name+': new '+route.method+' route must set apiStandard:true (legacy write/exception exemptions do not cover new routes)');
    }
  }
  return errors;
}
function legacyConditions(source){
  const result=new Set();
  for(const match of source.matchAll(/\bif\s*\(/g)){
    let depth=1,quote='',escaped=false,characterClass=false,i=match.index+match[0].length;const start=i;
    for(;i<source.length&&depth;i++){const c=source[i];if(escaped){escaped=false;continue;}if(c==='\\'){escaped=true;continue;}
      if(quote){if(quote==='/'&&c==='[')characterClass=true;if(quote==='/'&&c===']')characterClass=false;if(c===quote&&!characterClass)quote='';continue;}
      if("'\"`/".includes(c)){quote=c;continue;}if(c==='(')depth++;if(c===')')depth--;
    }
    const condition=source.slice(start,i-1);if(/\bp\s*(?:===|\.startsWith|\.match)|url\.pathname\s*(?:===|\.startsWith)|\.test\(\s*p\s*\)/.test(condition))result.add(condition.replace(/\s+/g,' ').trim());
  }
  const aliases=source.match(/const ROUTE_ALIASES\s*=\s*\{([\s\S]*?)\};/);
  if(aliases)for(const entry of aliases[1].matchAll(/'([^']+)'\s*:\s*'([^']+)'/g))result.add('alias:'+entry[1]+'='+entry[2]);
  return result;
}
function main(argv){
  const baseIndex=argv.indexOf('--base');let base=baseIndex>=0?argv[baseIndex+1]:process.env.API_CI_BASE_REF||'HEAD';if(/^0+$/.test(base))base='HEAD';
  const verified=spawnSync('git',['rev-parse','--verify',base+'^{commit}'],{cwd:repo,encoding:'utf8'});if(verified.status!==0)throw Error('Cannot resolve API CI Git base');
  function old(file){const r=spawnSync('git',['show',base+':'+file],{cwd:repo,encoding:'utf8'});return r.status===0?r.stdout:'';}
  const index=fs.readFileSync(path.join(root,'src/routes/hq/index.js'),'utf8');
  if(!index.includes('READONLY_BATCH.handle(matched')||!index.includes('READONLY_BATCH.handleNew(matched')||!index.includes('apiStandard: r.apiStandard === true'))throw Error('HQ factory dispatch wiring missing');
  const names=[...index.matchAll(/require\('\.\/modules\/([^']+)'\)/g)].map(m=>m[1]);
  const errors=[];
  for(const name of names){const relative='server/src/routes/hq/modules/'+name+'.js',file=path.join(repo,relative),source=fs.readFileSync(file,'utf8'),routes=require(file).routes;errors.push(...checkModule(name,routes,source,old(relative)));}
  for(const relative of ['server/server.js','server/src/routes/h5.js','server/src/routes/h5biz.js','server/src/routes/h5codes.js']){
    const source=fs.readFileSync(path.join(repo,relative),'utf8'),before=legacyConditions(old(relative));
    for(const line of legacyConditions(source))if(!before.has(line))errors.push(relative+': new legacy route branch prohibited; register new interfaces through the factory dispatcher');
  }
  for(const name of Object.keys(policy.READ_MODULES))if(!names.includes(name))errors.push('Read module no longer registered: '+name);
  if(errors.length){for(const error of errors)console.error(error);return 1;}
  console.log(JSON.stringify({check:'passed',base,readModules:Object.keys(policy.READ_MODULES).length,exceptionModules:Object.keys(policy.EXCEPTIONS).length,newRoutes:'Git-diff checked; no endpoint register'}));return 0;
}
if(require.main===module){try{process.exitCode=main(process.argv.slice(2));}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={checkModule,literalRoutes,legacyConditions,main};
