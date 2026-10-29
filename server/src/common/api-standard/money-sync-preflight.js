'use strict';
const S=require('./money-shadow');
function preflight(table,rows,cols,{sourceDb,after=process.env.MONEY_SHADOW_REQUIRE_COMPLETE==='1'}={}){
  const entry=Object.entries(S.SPEC).find(([,s])=>s.table===table);
  if(!entry)return {ok:true,active:false,issues:[]};
  const [kind,spec]=entry,hasShadow=rows.some(r=>r.currency!=null||spec.fields.some(f=>r[f[2]]!=null));
  const constrained=cols.some(c=>(c.Field==='currency'||spec.fields.some(f=>f[2]===c.Field))&&c.Null==='NO');
  const active=hasShadow||process.env['MONEY_SHADOW_WRITE_'+spec.group]==='1'||after||constrained;
  if(!active)return {ok:true,active:false,issues:[]};
  const issues=[];
  for(const name of [...spec.fields.map(f=>f[2]),'currency']){
    const col=cols.find(c=>c.Field===name);
    if(!col)issues.push({code:'MISSING_COLUMN',field:name});
    else if(name!=='currency'&&!/^bigint\b/i.test(col.Type||''))issues.push({code:'INVALID_COLUMN_TYPE',field:name});
    if(col?.Null==='NO'&&rows.some(r=>r[name]==null))issues.push({code:'NOT_NULL_SHADOW_MISSING',field:name});
  }
  if(!sourceDb)return {ok:false,active:true,issues:[...issues,{code:'SOURCE_SNAPSHOT_REQUIRED'}]};
  const seen=new Set();
  for(const record of sourceDb[spec.collection] || []){
    const key=record[spec.key];
    if(key==null||seen.has(String(key)))issues.push({code:'INVALID_OR_DUPLICATE_PRIMARY_KEY'});seen.add(String(key));
    issues.push(...S.inspect(kind,record,{after}).filter(x=>x.blocking).map(x=>({id:String(key),...x})));
  }
  return {ok:issues.length===0,active:true,issues};
}
function shadowColumns(table){const spec=Object.values(S.SPEC).find(s=>s.table===table);return spec?[table==='activity_prices'?'product_id':'id',...spec.fields.map(f=>f[2]),'currency']:[];}
function destinationDowngrades(table,rows,existing){
  const columns=shadowColumns(table);if(!columns.length)return [];
  const [pk,...fields]=columns,byId=new Map(rows.map(r=>[String(r[pk]),r])),issues=[];
  for(const old of existing){const next=byId.get(String(old[pk]));if(!next)continue;for(const field of fields)if(old[field]!=null&&next[field]==null)issues.push({id:String(old[pk]),field,code:'SHADOW_DOWNGRADE_WOULD_ERASE'});}
  return issues;
}
module.exports={preflight,shadowColumns,destinationDowngrades};
