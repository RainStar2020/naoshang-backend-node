#!/usr/bin/env node
'use strict';
// Author SQL files only. No database imports/connections/execution.
const fs=require('node:fs'),path=require('node:path');
const S=require('../src/common/api-standard/money-shadow');
const dir=path.join(__dirname,'../sql/money-shadow-stage3');fs.mkdirSync(dir,{recursive:true});
const q=name=>'`'+name+'`';
const write=(name,text)=>fs.writeFileSync(path.join(dir,name),text+'\n');
const max='9007199254740991';
for(const [kind,spec]of Object.entries(S.SPEC)){
  const table=spec.table,cols=spec.fields.map(f=>f[2]),all=[...cols,'currency'];
  write('A_'+table+'.up.sql','-- DDL auto-commits. REQUIRE verified table backup/snapshot and isolated HTTP smoke PASS first.\nALTER TABLE '+q(table)+'\n  '+[...cols.map(c=>'ADD COLUMN '+q(c)+' BIGINT NULL'),'ADD COLUMN `currency` CHAR(3) NULL'].join(',\n  ')+';');
  write('A_'+table+'.down.sql','-- Archive shadow columns first. Prefer flags-off rollback; never drop old yuan columns.\n-- REQUIRE snapshot verification and explicit approval. DDL is not transactional.\nALTER TABLE '+q(table)+'\n  '+all.map(c=>'DROP COLUMN '+q(c)).join(',\n  ')+';');
  const legacy=table==='skus'?['list_price']:table==='columns'?['price']:table==='activity_prices'?['amount']:['amount','breakdown','scene'];
  const pk=table==='activity_prices'?'product_id':'id';
  const fingerprint='SHA2(CAST(JSON_ARRAY('+[pk,...legacy,...all].map(c=>'CAST('+q(c)+' AS CHAR)').join(',')+') AS CHAR),256)';
  const scope=table==='quotes'?" AND `scene`='checkout'":'';
  const intro='-- GUARDED TEMPLATE ONLY, NOT AN APPROVED APPLY SCRIPT. No literal amounts generated.\n-- REQUIRE table backup/snapshot + isolated-copy rehearsal + separately approved parameter bindings.\n-- Obtain @expected_mysql_fingerprint from this exact expression in a frozen snapshot.\n-- JSON plan fingerprint is different and must NOT be substituted for MySQL fingerprint.\nSELECT '+q(pk)+', '+fingerprint+' AS migration_fingerprint FROM '+q(table)+' WHERE 1=1'+scope+';\n';
  write('C_'+table+'.up.template.sql',intro+'START TRANSACTION;\nUPDATE '+q(table)+' SET '+all.map(c=>q(c)+'=@new_'+c).join(', ')+'\nWHERE '+q(pk)+'=@record_id AND '+fingerprint+'=@expected_mysql_fingerprint'+scope+" AND @new_currency='CNY'"+cols.map((c,i)=>spec.fields[i][3]?' AND (@new_'+c+' IS NULL OR @new_'+c+' BETWEEN 0 AND '+max+')':' AND @new_'+c+' BETWEEN 0 AND '+max).join('')+';\nSELECT ROW_COUNT() AS affected_rows; -- must be exactly 1; otherwise stop\nROLLBACK; -- rehearsal default; COMMIT requires a separately reviewed rendered batch');
  write('C_'+table+'.down.template.sql',intro+'START TRANSACTION;\nUPDATE '+q(table)+' SET '+all.map(c=>q(c)+'=@previous_'+c).join(', ')+'\nWHERE '+q(pk)+'=@record_id AND '+fingerprint+'=@expected_post_migration_fingerprint'+scope+';\nSELECT ROW_COUNT() AS affected_rows; -- must be exactly 1; otherwise stop\nROLLBACK; -- uses saved preimages, NEVER recompute from yuan values');
  const check=cols.map(c=>'('+q(c)+' BETWEEN 0 AND '+max+')').join(' AND ')+" AND `currency`='CNY'";
  const d='ALTER TABLE '+q(table)+'\n  '+[...cols.map(c=>'MODIFY COLUMN '+q(c)+' BIGINT NOT NULL'),"MODIFY COLUMN `currency` CHAR(3) NOT NULL DEFAULT 'CNY'",'ADD CONSTRAINT '+q('ck_s3_'+table)+' CHECK ('+check+')'].join(',\n  ')+';';
  const down='ALTER TABLE '+q(table)+' DROP CHECK '+q('ck_s3_'+table)+';\nALTER TABLE '+q(table)+' '+[...cols.map(c=>'MODIFY COLUMN '+q(c)+' BIGINT NULL'),'MODIFY COLUMN `currency` CHAR(3) NULL'].join(', ')+';';
  if(table==='quotes'){
    const reason='-- BLOCKED: checkout-only scope leaves non-checkout currency NULL.\n-- Whole-table NOT NULL DEFAULT CNY would broaden scope. Requires separate decision.\n-- All statements below are intentionally non-executable proposals.\n';
    const conditional='ALTER TABLE `quotes` ADD CONSTRAINT `ck_s3_quotes_checkout` CHECK (`scene`<>\'checkout\' OR (`payable_amount_cents` IS NOT NULL AND `payable_amount_cents` BETWEEN 0 AND '+max+" AND `currency` IS NOT NULL AND `currency`='CNY'"+cols.slice(1).map(c=>' AND ('+q(c)+' IS NULL OR '+q(c)+' BETWEEN 0 AND '+max+')').join('')+'));';
    write('D_'+table+'.up.BLOCKED.sql',reason+conditional.split('\n').map(l=>'-- '+l).join('\n')+"\n-- Whole-table currency NOT NULL DEFAULT 'CNY': not authorized for non-checkout rows.");
    write('D_'+table+'.down.BLOCKED.sql',reason+'-- ALTER TABLE `quotes` DROP CHECK `ck_s3_quotes_checkout`;');
  }else{
    write('D_'+table+'.up.sql','-- Only after post-backfill zero blocking differences including MISSING_SHADOW.\n-- Verify server CHECK enforcement/version; preflight require-complete and writer compatibility.\n'+d);
    write('D_'+table+'.down.sql','-- DDL auto-commits; preserve values, restore nullable columns.\n'+down);
  }
}
for(const batch of ['A','C'])write('000_backup_before_'+batch+'.template.sql','-- Table-level snapshot template; NEVER overwrite a previous backup.\n-- Pause relevant writers/synchronizer while snapshotting; DDL cannot roll back.\n-- Replace run identifier BEFORE review/execution; backup count/hash must be verified.\n'+Object.values(S.SPEC).map(s=>'CREATE TABLE '+q('stage3_'+batch.toLowerCase()+'_RUNID_'+s.table)+' LIKE '+q(s.table)+';\nINSERT INTO '+q('stage3_'+batch.toLowerCase()+'_RUNID_'+s.table)+' SELECT * FROM '+q(s.table)+';').join('\n'));
write('B_shadow_writers.up.sql','-- CODE/CONFIG STEP ONLY: no SQL writes. Deploy reviewed code with all flags OFF.\n-- Enable shadow writer group only after batch A verification and explicit approval.');
write('B_shadow_writers.down.sql','-- CODE/CONFIG STEP ONLY: set MONEY_SHADOW_WRITE_PRODUCTS=0 and MONEY_SHADOW_WRITE_CHECKOUT_QUOTES=0.\n-- Keep legacy and shadow data; no recomputation, DELETE, or UPDATE.');
console.log('Generated SQL artifacts only: '+dir);
