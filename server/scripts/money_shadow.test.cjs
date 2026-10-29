'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),{spawnSync}=require('node:child_process');
const S=require('../src/common/api-standard/money-shadow'),M=require('../src/common/api-standard/money'),D=require('../src/common/api-standard/money-migration-diagnostic'),P=require('../src/common/api-standard/money-sync-preflight'),C=require('./money-shadow-copy.cjs');
function withEnv(env,run){const prior={};for(const [k,v]of Object.entries(env)){prior[k]=process.env[k];process.env[k]=v;}try{return run();}finally{for(const [k,v]of Object.entries(prior))if(v===undefined)delete process.env[k];else process.env[k]=v;}}
const batch=()=>S.beginBatch('test',{logger(){}});
function fixture(){return {skus:[{id:'s1',listPrice:19.9,stock:3}],activityPrices:[{productId:'p1',amount:0}],columns:[{id:'c1',price:'299.00'}],quotes:[{id:'q1',scene:'checkout',amount:19.9,breakdown:{goodsAmount:19.9,discountAmount:0,listAmount:19.9}},{id:'q2',scene:'upgrade',amount:1.005}]};}
test('strict conversion, two decimal reverse, diagnostic HALF_UP separate',()=>{
  assert.equal(S.expected(19.9),1990);assert.equal(S.expected('0.10'),10);assert.equal(M.toYuan(M.cents(S.expected('19.90'))),'19.90');
  assert.throws(()=>S.expected('1.005'),/PRECISION_EXCEEDED/);assert.throws(()=>S.expected(-1),/INVALID_LEGACY_AMOUNT/);assert.throws(()=>S.expected(NaN),/INVALID_LEGACY_AMOUNT/);assert.throws(()=>S.expected('90071992547409.92'),/OUT_OF_RANGE/);
  assert.equal(S.expected('90071992547409.91'),Number.MAX_SAFE_INTEGER);
  assert.equal(D.fromYuanHalfUpMigration('1.005').amountCents,101);assert.equal(D.fromYuanHalfUpMigration('0.004').amountCents,0);assert.throws(()=>D.fromYuanHalfUpMigration('1e3'));assert.throws(()=>M.serialize({amountCents:1n,currency:'CNY'}));
});
test('all flags off: legacy records and values are unchanged',()=>withEnv({MONEY_SHADOW_WRITE_PRODUCTS:'0',MONEY_SHADOW_WRITE_CHECKOUT_QUOTES:'0'},()=>{
  const db=fixture(),before=JSON.stringify(db);for(const [kind,spec]of Object.entries(S.SPEC))S.writeBatch(kind,db[spec.collection],batch());assert.equal(JSON.stringify(db),before);assert.equal(S.forWire(db),db);
}));
test('shadow writer targets only approved monetary fields and checkout scene',()=>withEnv({MONEY_SHADOW_WRITE_PRODUCTS:'1',MONEY_SHADOW_WRITE_CHECKOUT_QUOTES:'1'},()=>{
  const db=fixture();for(const [kind,spec]of Object.entries(S.SPEC))S.writeBatch(kind,db[spec.collection],batch());
  assert.equal(db.skus[0].listPrice,19.9);assert.equal(db.skus[0].listPriceCents,1990);assert.equal(db.skus[0].stock,3);assert.equal(db.quotes[0].breakdown.goodsAmountCents,1990);assert.ok(!('currency'in db.quotes[1]));
  assert.equal(S.plan(db,{after:true}).blocking,0);
}));
test('write failures alert/count/stop batch, without blocking legacy writes',()=>withEnv({MONEY_SHADOW_WRITE_PRODUCTS:'1'},()=>{
  const rows=[{id:'bad',listPrice:1.005},{id:'good',listPrice:2}],b=batch();S.writeBatch('skus',rows,b);
  assert.equal(b.failed,1);assert.equal(b.stopped,true);assert.equal(b.skipped,1);assert.equal(b.events[0].code,'PRECISION_EXCEEDED');assert.equal(b.events[1].type,'SHADOW_BATCH_STOPPED');assert.equal(rows.length,2);assert.equal(rows[0].listPrice,1.005);assert.ok(!('listPriceCents'in rows[1]));
}));
test('non-null currency mismatch; existing conflicts are never overwritten',()=>withEnv({MONEY_SHADOW_WRITE_PRODUCTS:'1'},()=>{
  const n={id:'n',listPrice:1,currency:null};assert.ok(!S.inspect('skus',n).some(d=>d.code==='CURRENCY_MISMATCH'));S.writeRecord('skus',n,batch());assert.equal(n.currency,'CNY');
  const wrong={id:'x',listPrice:1,listPriceCents:2,currency:'CNY'};assert.equal(S.writeRecord('skus',wrong,batch()).status,'failed');assert.equal(wrong.listPriceCents,2);
  const foreign={id:'f',listPrice:1,currency:'USD'};assert.equal(S.writeRecord('skus',foreign,batch()).code,'CURRENCY_MISMATCH');
  n.listPrice=2;assert.equal(S.writeRecord('skus',n,batch()).status,'written');assert.equal(n.listPriceCents,200);
}));
test('missing allowed before and blocking after; memory rehearsal/rollback fingerprints',()=>{
  const db=fixture(),p=S.plan(db);assert.equal(p.blocking,0);assert.equal(p.scanned,4);assert.equal(p.skipped,1);assert.equal(p.patches.length,4);assert.ok(S.plan(db,{after:true}).blocking>0);
  const rehearsal=C.applyToCopy(db,p);assert.equal(S.plan(rehearsal.copy,{after:true}).blocking,0);assert.deepEqual(C.rollbackCopy(rehearsal.copy,rehearsal.rollback),db);
  const changed=structuredClone(db);changed.skus[0].stock=9;assert.throws(()=>C.applyToCopy(changed,p),/FINGERPRINT_CONFLICT/);
  rehearsal.copy.skus[0].stock=9;assert.throws(()=>C.rollbackCopy(rehearsal.copy,rehearsal.rollback),/FINGERPRINT_CONFLICT/);
});
test('legacy raw response omits shadow storage data; reads remain disabled',()=>withEnv({MONEY_SHADOW_WRITE_PRODUCTS:'1',MONEY_CENTS_READ_PRODUCTS:'0'},()=>{
  const record={id:'s',listPrice:19.9};S.writeRecord('skus',record,batch());assert.deepEqual(S.forWire(record,{version:1}),{id:'s',listPrice:19.9});assert.deepEqual(S.readDto('skus',record,{version:2}),{});
  assert.deepEqual(S.readDto('skus',record,{version:1}),{});
}));
test('actual SKU/quote writer integration without disk; old calculations unchanged',()=>withEnv({MONEY_SHADOW_WRITE_PRODUCTS:'1',MONEY_SHADOW_WRITE_CHECKOUT_QUOTES:'1'},()=>{
  const stock=require('../src/stock'),quotes=require('../src/quoteStore'),db={};stock.syncSkuRecords(db,[{id:'s',listPrice:19.9,stock:2}]);assert.equal(db.skus[0].listPriceCents,1990);assert.equal(db.skus[0].listPrice,19.9);
  const q=quotes.issueQuote(db,{scene:'checkout',userId:'u',amount:19.9});assert.equal(q.payableAmountCents,1990);assert.equal(q.amount,19.9);
}));
test('mapping includes shadow columns, preserves old values and out-of-scope quotes',()=>{
  const {forEachInsert}=require('./mapping'),db=C.applyToCopy(fixture(),S.plan(fixture())).copy,tables={};forEachInsert(db,(table,cols,rows)=>{tables[table]={cols,rows};});
  assert.ok(tables.skus.cols.includes('list_price_cents'));assert.equal(tables.skus.rows[0].list_price,19.9);assert.equal(tables.skus.rows[0].list_price_cents,1990);assert.equal(tables.quotes.rows[1].payable_amount_cents,null);assert.equal(tables.quotes.rows[1].currency,null);
});
test('sync preflight gate before DELETE; failed table skipped, others can continue',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'sync_to_mysql.js'),'utf8'),part=source.slice(source.indexOf('async function writeTable('),source.indexOf('async function backupTables('));
  const statements=[],warnings=[],scope={preflight:P.preflight,shadowColumns:P.shadowColumns,destinationDowngrades:P.destinationDowngrades,serialize:v=>v,console:{warn:x=>warnings.push(x)}};vm.createContext(scope);vm.runInContext(part,scope);
  const conn={async query(sql){statements.push(sql);if(sql.startsWith('SHOW'))return [[{Field:'id',Type:'varchar(191)',Key:'PRI'}]];return [{}];}};
  await withEnv({MONEY_SHADOW_WRITE_PRODUCTS:'1'},()=>scope.writeTable(conn,'skus',[{id:'s',list_price_cents:100,currency:'CNY'}],{skus:[{id:'s',listPrice:1,listPriceCents:100,currency:'CNY'}]}));
  assert.ok(!statements.some(s=>s.startsWith('DELETE')));assert.equal(warnings.length,1);
  await scope.writeTable(conn,'unrelated',[{id:'other'}],{});assert.ok(statements.some(s=>s==='DELETE FROM `unrelated`'));
});
test('preflight catches currency, value and type conflicts; NULL currency not mismatch',()=>withEnv({MONEY_SHADOW_WRITE_PRODUCTS:'1'},()=>{
  const cols=[{Field:'list_price_cents',Type:'bigint'},{Field:'currency',Type:'char(3)'}];
  assert.equal(P.preflight('skus',[],cols,{sourceDb:{skus:[{id:'s',listPrice:1,currency:null}]}}).ok,true);
  assert.equal(P.preflight('skus',[],cols,{after:true,sourceDb:{skus:[{id:'s',listPrice:1,currency:null}]}}).ok,false);
  assert.equal(P.preflight('skus',[],cols,{sourceDb:{skus:[{id:'s',listPrice:1,listPriceCents:1,currency:'USD'}]}}).ok,false);
}));
test('dry-run CLI uses isolated temp fixture, preserves input hash and refuses apply',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'money-shadow-test-')),file=path.join(dir,'fixture.json');
  try{fs.writeFileSync(file,JSON.stringify(fixture()));const before=fs.readFileSync(file,'utf8');const cli=path.join(__dirname,'money-shadow-dry-run.cjs');
    const result=spawnSync(process.execPath,[cli,'--input',file],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);const parsed=JSON.parse(result.stdout);assert.equal(parsed.dryRun,true);assert.equal(parsed.scanned,4);assert.equal(parsed.blocking,0);assert.equal(fs.readFileSync(file,'utf8'),before);
    const after=spawnSync(process.execPath,[cli,'--input',file,'--after'],{encoding:'utf8'});assert.equal(after.status,2);
    const apply=spawnSync(process.execPath,[cli,'--input',file,'--apply'],{encoding:'utf8'});assert.equal(apply.status,1);assert.equal(fs.readFileSync(file,'utf8'),before);
  }finally{if(path.dirname(path.resolve(dir))!==path.resolve(os.tmpdir())||!path.basename(dir).startsWith('money-shadow-test-'))throw Error('INVALID_TEST_CLEANUP_TARGET');fs.rmSync(dir,{recursive:true,force:true});}
});
test('SQL artifacts nullable A, snapshots, guarded C rollback default; quote D blocked',()=>{
  const dir=path.join(__dirname,'../sql/money-shadow-stage3');
  for(const spec of Object.values(S.SPEC)){const a=fs.readFileSync(path.join(dir,'A_'+spec.table+'.up.sql'),'utf8');assert.match(a,/`currency` CHAR\(3\) NULL/);assert.ok(!a.includes('DEFAULT'));const c=fs.readFileSync(path.join(dir,'C_'+spec.table+'.up.template.sql'),'utf8');assert.match(c,/ROLLBACK;/);assert.match(c,/@expected_mysql_fingerprint/);assert.ok(!/ROUND\(/i.test(c));}
  const quote=fs.readFileSync(path.join(dir,'D_quotes.up.BLOCKED.sql'),'utf8');assert.ok(quote.split('\n').every(line=>!line.trim()||line.startsWith('--')));
});
test('business code cannot import diagnostic HALF_UP conversion',()=>{
  function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):e.name.endsWith('.js')?[path.join(dir,e.name)]:[]);}
  for(const file of walk(path.join(__dirname,'../src'))){if(file.endsWith('money-migration-diagnostic.js'))continue;assert.ok(!fs.readFileSync(file,'utf8').includes('money-migration-diagnostic'),file);}
});
test('post-D NOT NULL columns protect mirror even when writers are rolled back',()=>withEnv({MONEY_SHADOW_WRITE_PRODUCTS:'0',MONEY_SHADOW_REQUIRE_COMPLETE:'0'},()=>{
  const cols=[{Field:'list_price_cents',Type:'bigint',Null:'NO'},{Field:'currency',Type:'char(3)',Null:'NO'}];
  const result=P.preflight('skus',[{list_price_cents:null,currency:null}],cols,{sourceDb:{skus:[{id:'s',listPrice:1}]}});
  assert.equal(result.ok,false);assert.ok(result.issues.some(i=>i.code==='NOT_NULL_SHADOW_MISSING'));
}));
test('destination shadow values cannot be erased by a stale JSON snapshot',()=>{
  assert.equal(P.destinationDowngrades('skus',[{id:'s',list_price_cents:null,currency:null}],[{id:'s',list_price_cents:100,currency:'CNY'}]).length,2);
  assert.deepEqual(P.destinationDowngrades('skus',[{id:'s',list_price_cents:200,currency:'CNY'}],[{id:'s',list_price_cents:100,currency:'CNY'}]),[]);
});
