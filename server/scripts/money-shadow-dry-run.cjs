#!/usr/bin/env node
'use strict';
// Read-only CLI. No DB drivers, no default data file, no apply mode.
const fs=require('node:fs');
const S=require('../src/common/api-standard/money-shadow');
const D=require('../src/common/api-standard/money-migration-diagnostic');
function main(argv){
  if(argv.includes('--apply'))throw new Error('APPLY_NOT_IMPLEMENTED: separate approval required');
  const index=argv.indexOf('--input');if(index<0||!argv[index+1])throw new Error('--input <isolated-json-file> is required');
  const db=JSON.parse(fs.readFileSync(argv[index+1],'utf8').replace(/^\uFEFF/,''));
  const result=S.plan(db,{after:argv.includes('--after')});
  if(argv.includes('--diagnostic-half-up'))result.diagnostics=result.differences.filter(d=>d.code==='PRECISION_EXCEEDED').map(d=>{
    const spec=S.SPEC[d.kind],record=db[spec.collection].find(r=>String(r[spec.key])===d.id);
    try{return {kind:d.kind,id:d.id,field:d.field,diagnosticOnly:true,roundedCents:D.fromYuanHalfUpMigration(String(S.get(record,d.field))).amountCents};}
    catch{return {kind:d.kind,id:d.id,field:d.field,diagnosticOnly:true,error:'NOT_CONVERTIBLE'};}
  });
  process.stdout.write(JSON.stringify({dryRun:true,...result})+'\n');
  return result.blocking?2:0;
}
if(require.main===module){try{process.exitCode=main(process.argv.slice(2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={main};
