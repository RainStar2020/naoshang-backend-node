#!/usr/bin/env node
'use strict';
// Stage zero only: SHOW/SELECT statements; no application imports, no DDL/DML.
const fs=require('node:fs'),path=require('node:path'),mysql=require('mysql2/promise');
const root=path.join(__dirname,'..');
async function main(){
  const host=process.env.MYSQL_HOST || '127.0.0.1';
  if(!['127.0.0.1','localhost','::1'].includes(host))throw new Error('NON_LOOPBACK_TARGET_REFUSED');
  let password=process.env.MYSQL_PASSWORD || '';
  try{const text=fs.readFileSync(path.join(root,'mysql/.env.local'),'utf8');const line=text.split('\n').find(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('='));if(line)password=line.slice(line.indexOf('=')+1).trim();}catch{}
  const config={host,port:Number(process.env.MYSQL_PORT || 3307),database:process.env.MYSQL_DATABASE || 'naoshang',user:process.env.MYSQL_USER || 'naoshang',password,multipleStatements:false,connectTimeout:5000};
  console.log(JSON.stringify({target:{host:config.host,port:config.port,database:config.database,user:config.user},mode:'SHOW_SELECT_ONLY'}));
  const connection=await mysql.createConnection(config);
  try{
    const [identity]=await connection.query('SELECT DATABASE() AS db, CURRENT_USER() AS authenticatedUser, USER() AS connectionUser, @@hostname AS serverHostname, @@port AS serverPort, @@version AS serverVersion, @@read_only AS serverReadOnly');
    const [grants]=await connection.query('SHOW GRANTS FOR CURRENT_USER');
    const sanitizedGrants=grants.flatMap(r=>Object.values(r)).map(v=>String(v).replace(/IDENTIFIED\s+.*$/i,'[AUTHENTICATION CLAUSE REDACTED]'));
    const tables={},differences=[],dump=fs.readFileSync(path.join(root,'mysql/naoshang.sql'),'utf8');
    for(const table of ['skus','activity_prices','columns','quotes']){
      const [create]=await connection.query('SHOW CREATE TABLE `'+table+'`');
      const [columns]=await connection.query('SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',[config.database,table]);
      const [count]=await connection.query('SELECT COUNT(*) AS rowCount FROM `'+table+'`');
      const start=dump.indexOf('CREATE TABLE `'+table+'` ('),end=dump.indexOf(') ENGINE=',start),definition=dump.slice(start,end);
      const expected=[...definition.matchAll(/^\s*`([^`]+)`\s+([A-Z]+(?:\([^)]*\))?)/gm)].map(m=>({name:m[1],type:m[2].toLowerCase()}));
      if(start<0||end<0)throw new Error('BASELINE_DEFINITION_MISSING: '+table);
      for(const col of expected){const actual=columns.find(c=>c.COLUMN_NAME===col.name);if(!actual||actual.COLUMN_TYPE.toLowerCase()!==col.type)differences.push({table,column:col.name,expectedType:col.type,actualType:actual?.COLUMN_TYPE || null});}
      const shadowNames=table==='skus'?['list_price_cents','currency']:table==='activity_prices'?['activity_price_cents','currency']:table==='columns'?['price_cents','currency']:['payable_amount_cents','goods_amount_cents','discount_amount_cents','list_amount_cents','currency'];
      const existingShadow=columns.filter(c=>shadowNames.includes(c.COLUMN_NAME));
      if(existingShadow.length)differences.push({table,code:'SHADOW_COLUMNS_ALREADY_EXIST',columns:existingShadow.map(c=>c.COLUMN_NAME)});
      tables[table]={createTable:Object.values(create[0]).find(v=>typeof v==='string'&&v.startsWith('CREATE TABLE')),columns,rowCount:String(count[0].rowCount),expectedBaselineColumns:expected.length,existingShadow};
    }
    let clients,clientInspectionError;
    try{const [rows]=await connection.query('SELECT ID, USER, HOST, DB, COMMAND FROM information_schema.PROCESSLIST');clients=rows;}catch(e){clientInspectionError=e.code;}
    const [backups]=await connection.query("SELECT TABLE_NAME, CREATE_TIME, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND (LEFT(TABLE_NAME,4)='bak_' OR LEFT(TABLE_NAME,7)='stage3_')",[config.database]);
    const report={observedAt:new Date().toISOString(),node:process.version,target:{host:config.host,port:config.port,database:config.database,user:config.user},identity:identity[0],grants:sanitizedGrants,tables,differences,clients,clientInspectionError,backupCandidates:backups,backupVerified:false,disposableDedicatedSchemaConfirmed:false,ddlExecuted:false,dmlExecuted:false,decision:'WAIT_USER_CONFIRMATION_BEFORE_BATCH_A'};
    const output=path.join(root,'docs/api-standardization/phase-3-local-preflight.json');fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({identity:report.identity,grants:sanitizedGrants,counts:Object.fromEntries(Object.entries(tables).map(([k,v])=>[k,v.rowCount])),differences,clients,clientInspectionError,backupCandidates:backups,backupVerified:false,disposableDedicatedSchemaConfirmed:false,report:output}));
  }finally{await connection.end();}
}
main().catch(e=>{console.error(JSON.stringify({errorCode:e.code || e.message,ddlExecuted:false,dmlExecuted:false}));process.exitCode=1;});
