#!/usr/bin/env node
'use strict';
// Source schema is read-only. DDL/import/drop permitted ONLY with explicit flag,
// ONLY in the fixed, absent temporary restore schema. Never run batch A here.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process'),mysql=require('mysql2/promise');
const ROOT=path.join(__dirname,'..'),SOURCE='naoshang',TEMP='naoshang_restore_check',TABLES=['skus','activity_prices','columns','quotes'];
const hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
const q=x=>'`'+x+'`';
async function command(exe,args,env,input){return new Promise((resolve,reject)=>{
  const child=spawn(exe,args,{env,windowsHide:true,stdio:[input?'pipe':'ignore','pipe','pipe']});let out='',err='';
  child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.once('error',reject);
  child.once('exit',code=>code===0?resolve({stdout:out,stderr:err}):reject(Object.assign(new Error('MYSQL_CLIENT_COMMAND_FAILED'),{commandCode:code,diagnostic:err.replace(/(password\s*[=:]\s*)\S+/ig,'$1[REDACTED]')})));
  if(input){const stream=fs.createReadStream(input);stream.once('error',reject);stream.pipe(child.stdin);child.stdin.on('error',e=>{if(e.code!=='EPIPE')reject(e);});}
});}
async function snapshot(connection,database){const result={};for(const table of TABLES){
  const [create]=await connection.query('SHOW CREATE TABLE '+q(database)+'.'+q(table));
  const [columns]=await connection.query('SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',[database,table]);
  const [count]=await connection.query('SELECT COUNT(*) AS n FROM '+q(database)+'.'+q(table));
  const pk=table==='activity_prices'?'product_id':'id';const [sample]=await connection.query('SELECT * FROM '+q(database)+'.'+q(table)+' ORDER BY '+q(pk)+' LIMIT 5');
  result[table]={ddl:Object.values(create[0]).find(v=>typeof v==='string'&&v.startsWith('CREATE TABLE')),columns,count:String(count[0].n),sampleCount:sample.length,sampleSha256:hash(JSON.stringify(sample))};
}return result;}
async function main(){
  const index=process.argv.indexOf('--backup-dir'),directory=path.resolve(process.argv[index+1] || '');
  const parent=path.resolve('E:/mysql/stage3-backups');if(index<0||!directory.startsWith(parent+path.sep)||!fs.statSync(directory).isDirectory())throw new Error('APPROVED_BACKUP_DIRECTORY_REQUIRED');
  const host=process.env.MYSQL_HOST || '127.0.0.1',port=Number(process.env.MYSQL_PORT || 3307),database=process.env.MYSQL_DATABASE || SOURCE;
  if(host!=='127.0.0.1'||port!==3307||database!==SOURCE)throw new Error('CONFIRMED_LOCAL_TARGET_ONLY');
  let password=process.env.MYSQL_PASSWORD || '';const text=fs.readFileSync(path.join(ROOT,'mysql/.env.local'),'utf8');const line=text.split('\n').find(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('='));if(line)password=line.slice(line.indexOf('=')+1).trim();
  const user=process.env.MYSQL_USER || 'naoshang',env={...process.env,MYSQL_PWD:password};
  const connection=await mysql.createConnection({host,port,user,password,database:SOURCE,multipleStatements:false,dateStrings:true,supportBigNumbers:true,bigNumberStrings:true});
  const evidence={startedAt:new Date().toISOString(),node:process.version,nodeExecutable:process.execPath,target:{host,port,database:SOURCE,user},temporarySchema:TEMP,originalSchemaWrites:false,batchAExecuted:false,backupDirectory:directory,restoreStatus:'not-started',temporarySchemaCreatedByThisRun:false};
  const reportFile=path.join(directory,'verification.json');
  try{
    const [identity]=await connection.query('SELECT CURRENT_USER() AS currentUser, @@version AS mysqlVersion');evidence.identity=identity[0];
    const [processList]=await connection.query("SELECT ID,USER,HOST,DB,COMMAND,TIME,INFO FROM information_schema.PROCESSLIST WHERE HOST LIKE 'localhost:49172' OR HOST LIKE '127.0.0.1:49172'");evidence.viewerConnection=processList;
    try{const [attrs]=await connection.query("SELECT PROCESSLIST_ID,ATTR_NAME,ATTR_VALUE FROM performance_schema.session_connect_attrs WHERE PROCESSLIST_ID=24 AND ATTR_NAME IN ('_pid','program_name')");evidence.viewerConnectionAttributes=attrs;}catch(error){evidence.viewerAttributesError=error.code;}
    evidence.sourceBefore=await snapshot(connection,SOURCE);
    const dump=path.join(directory,'naoshang-full.sql');if(fs.existsSync(dump))throw new Error('REFUSE_BACKUP_OVERWRITE');
    const executable='E:/mysql/server/bin/mysqldump.exe';const args=['--host='+host,'--port='+port,'--user='+user,'--single-transaction','--quick','--no-tablespaces','--set-gtid-purged=OFF','--result-file='+dump,SOURCE];
    evidence.backupCommand={executable,args,credentialTransport:'MYSQL_PWD child-process environment; value omitted'};
    await command(executable,args,env);const content=fs.readFileSync(dump);
    evidence.backup={path:dump,bytes:content.length,sha256:hash(content),completedAt:new Date().toISOString(),scope:'single schema table DDL/data; default triggers; routines/events not requested'};
    if(!content.length||!content.toString('utf8').includes('-- Dump completed on'))throw new Error('INCOMPLETE_LOGICAL_BACKUP');
    const structure=path.join(directory,'four-target-tables.schema.sql');fs.writeFileSync(structure,'-- Structural backup, source schema unchanged. Apply only to approved restore destination.\n'+TABLES.map(t=>evidence.sourceBefore[t].ddl+';').join('\n\n')+'\n',{flag:'wx'});
    const structureBytes=fs.readFileSync(structure);evidence.structureBackup={path:structure,bytes:structureBytes.length,sha256:hash(structureBytes)};
    evidence.sourceAfter=await snapshot(connection,SOURCE);
    for(const table of TABLES)if(JSON.stringify(evidence.sourceBefore[table])!==JSON.stringify(evidence.sourceAfter[table]))throw new Error('SOURCE_CHANGED_DURING_BACKUP: '+table);
    if(!process.argv.includes('--allow-temp-restore')){evidence.restoreStatus='awaiting-explicit-temporary-schema-authorization';return;}
    const sql=content.toString('utf8');if(/^\s*(?:CREATE\s+DATABASE|USE\s+)/mi.test(sql)||/`naoshang`\s*\./i.test(sql))throw new Error('DUMP_COULD_ESCAPE_TEMP_SCHEMA');
    const [exists]=await connection.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',[TEMP]);if(exists.length)throw new Error('TEMP_SCHEMA_ALREADY_EXISTS_PRESERVE_IT');
    evidence.restoreStatus='creating-temporary-schema';evidence.restoreCreateSql='CREATE DATABASE `'+TEMP+'` CHARACTER SET utf8mb4';
    await connection.query(evidence.restoreCreateSql);evidence.temporarySchemaCreatedByThisRun=true;
    const importArgs=['--host='+host,'--port='+port,'--user='+user,'--database='+TEMP,'--binary-mode=1','--skip-reconnect'];
    evidence.restoreCommand={executable:'E:/mysql/server/bin/mysql.exe',args:importArgs,stdinFile:dump,credentialTransport:'MYSQL_PWD child-process environment; value omitted'};
    evidence.restoreStatus='importing';await command(evidence.restoreCommand.executable,importArgs,env,dump);
    const restored=await snapshot(connection,TEMP);evidence.restored=restored;evidence.comparison={};
    for(const table of TABLES){const a=evidence.sourceBefore[table],b=restored[table];const match={rowCounts:a.count===b.count,columnTypes:JSON.stringify(a.columns)===JSON.stringify(b.columns),sampleHash:a.sampleSha256===b.sampleSha256};evidence.comparison[table]=match;if(Object.values(match).includes(false))throw new Error('RESTORE_COMPARISON_FAILED: '+table);}
    evidence.restoreStatus='verified';
    if(!evidence.temporarySchemaCreatedByThisRun)throw new Error('TEMP_SCHEMA_OWNERSHIP_NOT_PROVEN');
    await connection.query('DROP DATABASE `'+TEMP+'`');evidence.temporarySchemaDeleted=true;
    evidence.restoreStatus='passed-and-temporary-schema-deleted';
  }catch(error){evidence.failure={stage:evidence.restoreStatus,code:error.code || error.message,sqlState:error.sqlState || null,commandCode:error.commandCode || null,diagnostic:error.diagnostic || null};evidence.restoreStatus='failed-stopped-no-further-ddl';process.exitCode=1;}
  finally{evidence.finishedAt=new Date().toISOString();fs.writeFileSync(reportFile,JSON.stringify(evidence,null,2)+'\n');fs.writeFileSync(path.join(ROOT,'docs/api-standardization/phase-3-backup-restore-evidence.json'),JSON.stringify(evidence,null,2)+'\n');await connection.end();console.log(JSON.stringify({backup:evidence.backup,structureBackup:evidence.structureBackup,viewerConnection:evidence.viewerConnection,restoreStatus:evidence.restoreStatus,failure:evidence.failure,temporarySchemaCreatedByThisRun:evidence.temporarySchemaCreatedByThisRun,temporarySchemaDeleted:evidence.temporarySchemaDeleted || false,evidence:reportFile}));}
}
main().catch(error=>{console.error(JSON.stringify({error:error.code || error.message,originalSchemaWrites:false}));process.exitCode=1;});
