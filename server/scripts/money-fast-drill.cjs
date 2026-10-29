#!/usr/bin/env node
'use strict';
// Local fake-data rehearsal. Original SQL files are immutable inputs.
// Any SQL failure stops immediately; never repair SQL or advance to another batch.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),mysql=require('mysql2/promise'),{spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..'),tables=['skus','activity_prices','columns','quotes'];
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function main(){
  if((process.env.MYSQL_HOST||'127.0.0.1')!=='127.0.0.1'||Number(process.env.MYSQL_PORT||3307)!==3307||(process.env.MYSQL_DATABASE||'naoshang')!=='naoshang')throw Error('ONLY_CONFIRMED_LOCAL_FAKE_DATABASE_ALLOWED');
  let password=process.env.MYSQL_PASSWORD||'';const line=fs.readFileSync(path.join(root,'mysql/.env.local'),'utf8').split('\n').find(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('='));if(line)password=line.slice(line.indexOf('=')+1).trim();
  const user=process.env.MYSQL_USER||'naoshang';
  const conn=await mysql.createConnection({host:'127.0.0.1',port:3307,user,password,database:'naoshang',multipleStatements:false});
  const run='fast-drill-'+new Date().toISOString().replace(/[:.]/g,'-'),directory=path.join('E:/mysql/stage3-backups',run);
  const evidence={run,startedAt:new Date().toISOString(),node:process.version,executable:process.execPath,target:'127.0.0.1:3307/naoshang',originalSqlFilesModified:false,events:[],batches:{A:'not-started',B:'not-run',C:'not-run',D:'not-run'},backup:null};
  async function schema(){const result={};for(const table of tables){const [cols]=await conn.query('SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,COLUMN_KEY,EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',[table]);const [count]=await conn.query('SELECT COUNT(*) AS n FROM `'+table+'`');result[table]={columns:cols,count:count[0].n};}return result;}
  async function fileSql(file,phase){const contents=fs.readFileSync(path.join(root,'sql/money-shadow-stage3',file),'utf8'),sql=contents.split('\n').filter(l=>!l.trim().startsWith('--')).join('\n').trim();
    const event={phase,file,sha256:sha(contents),sql,status:'started'};evidence.events.push(event);
    try{await conn.query(sql);event.status='passed';}catch(error){event.status='failed';event.error={code:error.code,errno:error.errno,sqlState:error.sqlState,message:error.sqlMessage};throw error;}
  }
  try{
    const [identity]=await conn.query('SELECT @@version AS version,CURRENT_USER() AS user');evidence.identity=identity[0];if(identity[0].version!=='8.4.9')throw Error('UNEXPECTED_MYSQL_VERSION');
    const viewer=fs.readFileSync('E:/mysql/viewer/server.js');evidence.viewerSourceSha256=sha(viewer);
    if(evidence.viewerSourceSha256!=='29d64edd9b8f1c4c45462db81ebcba552959fdead5efa62f665ff34e35539203')throw Error('VIEWER_SOURCE_CHANGED_REVIEW_REQUIRED');
    const [clients]=await conn.query("SELECT ID,USER,HOST,DB,COMMAND,TIME,INFO FROM information_schema.PROCESSLIST WHERE HOST LIKE '%:49172'");evidence.viewerConnection=clients;
    if(clients.some(c=>c.INFO&&!/^\s*(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN)\b/i.test(c.INFO)))throw Error('VIEWER_POSSIBLY_WRITING_STOP');
    evidence.before=await schema();
    fs.mkdirSync(directory,{recursive:true});
    const acl=spawnSync('icacls.exe',[directory,'/inheritance:r','/grant:r',process.env.USERDOMAIN+'\\'+process.env.USERNAME+':(OI)(CI)F'],{windowsHide:true,encoding:'utf8'});if(acl.status!==0)throw Error('BACKUP_ACL_FAILED');
    const dump=path.join(directory,'naoshang-before-fast-drill.sql'),args=['--host=127.0.0.1','--port=3307','--user='+user,'--single-transaction','--quick','--no-tablespaces','--set-gtid-purged=OFF','--result-file='+dump,'naoshang'];
    const backup=spawnSync('E:/mysql/server/bin/mysqldump.exe',args,{windowsHide:true,env:{...process.env,MYSQL_PWD:password},encoding:'utf8'});
    if(backup.status!==0)throw Error('MYSQLDUMP_FAILED_STOP');const bytes=fs.readFileSync(dump);if(!bytes.toString('utf8').includes('-- Dump completed on'))throw Error('DUMP_INCOMPLETE_STOP');
    evidence.backup={path:dump,bytes:bytes.length,sha256:sha(bytes),executable:'E:/mysql/server/bin/mysqldump.exe',args,completedAt:new Date().toISOString(),restoreTest:'not-requested'};
    evidence.batches.A='running';
    for(const [index,table]of tables.entries())await fileSql('A_'+table+'.up.sql','A-forward-'+String(index+1).padStart(3,'0'));
    evidence.afterFirstForward=await schema();
    for(const table of tables){const before=evidence.before[table],after=evidence.afterFirstForward[table];for(const old of before.columns)if(JSON.stringify(after.columns.find(c=>c.COLUMN_NAME===old.COLUMN_NAME))!==JSON.stringify(old))throw Error('LEGACY_COLUMN_CHANGED: '+table);const [filled]=await conn.query('SELECT COUNT(*) AS n FROM `'+table+'` WHERE currency IS NOT NULL');if(Number(filled[0].n)!==0)throw Error('CURRENCY_NOT_NULL: '+table);if(after.count!==before.count)throw Error('ROW_COUNT_CHANGED: '+table);}
    // Deliberately rerun the unmodified SQL as requested, not an idempotency wrapper.
    // Duplicate-column SQL failure is evidence of non-idempotency and a hard stop.
    for(const table of tables)await fileSql('A_'+table+'.up.sql','A-raw-idempotency-rerun');
    for(const table of [...tables].reverse())await fileSql('A_'+table+'.down.sql','A-rollback');
    evidence.afterRollback=await schema();
    for(const table of tables)await fileSql('A_'+table+'.up.sql','A-restore-forward');
    evidence.batches.A='passed';
  }catch(error){evidence.failure={code:error.code||error.message,errno:error.errno||null,message:error.sqlMessage||error.message};if(evidence.batches.A==='running')evidence.batches.A='failed-stopped-preserved';process.exitCode=1;}
  finally{evidence.finishedAt=new Date().toISOString();const file=path.join(root,'docs/api-standardization',run+'.json');fs.writeFileSync(file,JSON.stringify(evidence,null,2)+'\n');if(evidence.backup)fs.writeFileSync(path.join(directory,'drill-evidence.json'),JSON.stringify(evidence,null,2)+'\n');await conn.end();console.log(JSON.stringify({report:file,backup:evidence.backup,batches:evidence.batches,failure:evidence.failure,events:evidence.events.map(({phase,file,status,error})=>({phase,file,status,error}))}));}
}
main().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
