'use strict';
const M=require('./money');
const crypto=require('node:crypto');
const SPEC=Object.freeze({
  skus:{collection:'skus',table:'skus',key:'id',group:'PRODUCTS',fields:[['listPrice','listPriceCents','list_price_cents']]},
  activityPrices:{collection:'activityPrices',table:'activity_prices',key:'productId',group:'PRODUCTS',fields:[['amount','activityPriceCents','activity_price_cents']]},
  columns:{collection:'columns',table:'columns',key:'id',group:'PRODUCTS',fields:[['price','priceCents','price_cents']]},
  quotes:{collection:'quotes',table:'quotes',key:'id',group:'CHECKOUT_QUOTES',fields:[['amount','payableAmountCents','payable_amount_cents'],['breakdown.goodsAmount','breakdown.goodsAmountCents','goods_amount_cents',true],['breakdown.discountAmount','breakdown.discountAmountCents','discount_amount_cents',true],['breakdown.listAmount','breakdown.listAmountCents','list_amount_cents',true]]}
});
const get=(o,p)=>p.split('.').reduce((v,k)=>v?.[k],o);
function put(o,p,v){const parts=p.split('.');let at=o;for(const k of parts.slice(0,-1))at=at[k] ||= {};at[parts.at(-1)]=v;}
function canonical(value){
  if(typeof value==='number'&&(!Number.isFinite(value)||value<0))throw new Error('INVALID_LEGACY_AMOUNT');
  if(!['string','number'].includes(typeof value))throw new Error('INVALID_LEGACY_AMOUNT');
  const text=String(value);
  if(!/^\d+(?:\.\d+)?$/.test(text))throw new Error('INVALID_LEGACY_AMOUNT');
  const [whole,fraction='']=text.split('.');
  if(fraction.length>2)throw new Error('PRECISION_EXCEEDED');
  return BigInt(whole).toString()+'.'+fraction.padEnd(2,'0');
}
function expected(value){const text=canonical(value);let result;try{result=M.fromYuan(text);}catch{throw new Error('OUT_OF_RANGE');}if(M.toYuan(result)!==text)throw new Error('REVERSE_CONVERSION_MISMATCH');return result.amountCents;}
function inScope(kind,record){return kind!=='quotes'||record.scene==='checkout';}
function inspect(kind,record,{after=false}={}){
  const spec=SPEC[kind],differences=[];
  if(!inScope(kind,record))return differences;
  if(record.currency!=null&&record.currency!=='CNY')differences.push({field:'currency',code:'CURRENCY_MISMATCH'});
  for(const [old,next,,optional] of spec.fields){
    const legacy=get(record,old),actual=get(record,next);
    if(optional&&legacy==null){if(actual!=null)differences.push({field:next,code:'VALUE_MISMATCH'});continue;}
    try{const want=expected(legacy);if(actual==null)differences.push({field:next,code:'MISSING_SHADOW',expected:want});
      else if(typeof actual!=='number'||!Number.isSafeInteger(actual)||actual!==want)differences.push({field:next,code:'VALUE_MISMATCH',expected:want,actual:typeof actual==='number'&&Number.isFinite(actual)?actual:String(actual)});
    }catch(e){differences.push({field:old,code:e.message});}
  }
  if(record.currency==null)differences.push({field:'currency',code:'MISSING_SHADOW',expected:'CNY'});
  return differences.map(d=>({...d,blocking:after||d.code!=='MISSING_SHADOW'}));
}
function fingerprint(record){return crypto.createHash('sha256').update(JSON.stringify(record)).digest('hex');}
function plan(db,{after=false}={}){
  const differences=[],patches=[];let scanned=0,skipped=0;
  for(const [kind,spec] of Object.entries(SPEC))for(const record of db[spec.collection] || []){
    if(!inScope(kind,record)){skipped++;continue;}scanned++;
    const id=String(record[spec.key]);const issues=inspect(kind,record,{after});
    differences.push(...issues.map(x=>({...x,kind,id})));
    if(!issues.some(x=>x.blocking)&&issues.some(x=>x.code==='MISSING_SHADOW')){
      const fields={};for(const [old,next,,optional] of spec.fields){if(optional&&get(record,old)==null)continue;fields[next]=expected(get(record,old));}fields.currency='CNY';
      patches.push({kind,id,fingerprint:fingerprint(record),fields});
    }
  }
  return {scanned,skipped,blocking:differences.filter(d=>d.blocking).length,differences,patches};
}
function beginBatch(id='single-record',{logger=entry=>console.warn('[MONEY_SHADOW] '+JSON.stringify(entry)),maxFailureRate=0}={}){
  return {id,logger,maxFailureRate,attempted:0,failed:0,written:0,skipped:0,stopped:false,events:[]};
}
const totals={attempted:0,failed:0,written:0,stopped:0};
function emit(batch,event){batch.events.push(event);try{batch.logger({...event,batchId:batch.id});}catch{console.warn('[MONEY_SHADOW] LOG_SINK_FAILURE batch='+batch.id);}}
function writeRecord(kind,record,batch=beginBatch(),{force=false}={}){
  const spec=SPEC[kind];
  if(!force&&process.env['MONEY_SHADOW_WRITE_'+spec.group]!=='1')return {status:'disabled'};
  if(!inScope(kind,record))return {status:'out-of-scope'};
  if(batch.stopped){batch.skipped++;return {status:'batch-stopped'};}
  batch.attempted++;totals.attempted++;
  try{
    if(!Number.isFinite(batch.maxFailureRate)||batch.maxFailureRate<0||batch.maxFailureRate>1)throw new Error('INVALID_FAILURE_THRESHOLD');
    if(record.currency!=null&&record.currency!=='CNY')throw new Error('CURRENCY_MISMATCH');
    const values={},prior=record.moneyShadow,advanced=[];
    for(const [old,next,,optional] of spec.fields){
      if(optional&&get(record,old)==null){if(get(record,next)!=null)throw new Error('VALUE_MISMATCH');continue;}
      const want=expected(get(record,old)),actual=get(record,next);
      if(actual!=null&&actual!==want&&!(prior?.kind===kind&&prior.fields?.[next]===actual))throw new Error('VALUE_MISMATCH');
      if(actual!=null&&actual!==want)advanced.push(next);
      values[next]=want;
    }
    for(const [key,value] of Object.entries(values))put(record,key,value);
    record.currency='CNY';record.moneyShadow={kind,fields:values};
    if(advanced.length)emit(batch,{type:'SHADOW_VERSION_ADVANCED',kind,id:String(record[spec.key]),fields:advanced});
    batch.written++;totals.written++;return {status:'written'};
  }catch(error){
    batch.failed++;totals.failed++;
    emit(batch,{type:'SHADOW_WRITE_FAILED',kind,id:String(record?.[spec.key]),code:error.message});
    if(!Number.isFinite(batch.maxFailureRate)||batch.maxFailureRate<0||batch.maxFailureRate>1||batch.failed/batch.attempted>batch.maxFailureRate){batch.stopped=true;totals.stopped++;emit(batch,{type:'SHADOW_BATCH_STOPPED',kind,attempted:batch.attempted,failed:batch.failed});}
    return {status:'failed',code:error.message};
  }
}
function writeBatch(kind,records,batch=beginBatch(kind)){for(const record of records)writeRecord(kind,record,batch);return batch;}
function mapped(kind,record){const spec=SPEC[kind];if(!inScope(kind,record))return Object.fromEntries([...spec.fields.map(f=>[f[2],null]),['currency',null]]);return Object.fromEntries([...spec.fields.map(([,next,col])=>[col,get(record,next)??null]),['currency',record.currency??null]]);}
function readDto(kind,record,{version=1}={}){
  if(version!==2||process.env['MONEY_CENTS_READ_'+SPEC[kind].group]!=='1'||!inScope(kind,record))return {};
  if(inspect(kind,record,{after:true}).some(x=>x.blocking))throw new Error('INVALID_MONEY_SHADOW');
  return Object.fromEntries([...SPEC[kind].fields.filter(([old])=>get(record,old)!=null).map(([,next])=>[next.split('.').at(-1),get(record,next)]),['currency',record.currency]]);
}
// Strip shadow-only data from raw legacy responses; storage and calculations are untouched.
function forWire(value,{version=1}={}){
  if(Array.isArray(value)){const items=value.map(v=>forWire(v,{version}));return items.some((v,i)=>v!==value[i])?items:value;}
  if(!value||typeof value!=='object')return value;
  if(value instanceof Date)return value;
  const out={};const kind=value.moneyShadow?.kind;const hidden=new Set(['moneyShadow']);
  if(kind&&SPEC[kind]){hidden.add('currency');for(const [,next]of SPEC[kind].fields)if(!next.includes('.'))hidden.add(next);}
  let changed=false;
  for(const [key,v] of Object.entries(value)){if(hidden.has(key)){changed=true;continue;}out[key]=forWire(v,{version});if(out[key]!==v)changed=true;}
  if(kind&&SPEC[kind]){
    if(out.breakdown){out.breakdown={...out.breakdown};for(const [,next]of SPEC[kind].fields)if(next.startsWith('breakdown.'))delete out.breakdown[next.split('.')[1]];}
    Object.assign(out,readDto(kind,value,{version}));
  }
  return kind&&SPEC[kind]||changed?out:value;
}
module.exports={SPEC,get,put,canonical,expected,inspect,plan,fingerprint,beginBatch,writeRecord,writeBatch,mapped,readDto,forWire,totals};
