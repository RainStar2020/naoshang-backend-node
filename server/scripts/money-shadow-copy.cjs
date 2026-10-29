'use strict';
// In-memory rehearsal helpers only: never persist a production snapshot.
const S=require('../src/common/api-standard/money-shadow');
function find(db,patch){const spec=S.SPEC[patch.kind];const rows=(db[spec.collection]||[]).filter(r=>String(r[spec.key])===patch.id);if(rows.length!==1)throw new Error('AMBIGUOUS_RECORD');return rows[0];}
function applyToCopy(db,plan){
  if(plan.blocking)throw new Error('BLOCKING_DIFFERENCES');
  const copy=structuredClone(db),rollback=[];
  for(const patch of plan.patches){const record=find(copy,patch);if(S.fingerprint(record)!==patch.fingerprint)throw new Error('FINGERPRINT_CONFLICT');
    const paths=[...Object.keys(patch.fields),'moneyShadow'];
    const before=paths.map(path=>({path,exists:S.get(record,path)!==undefined,value:S.get(record,path)??null}));
    for(const [path,value]of Object.entries(patch.fields))S.put(record,path,value);
    record.moneyShadow={kind:patch.kind,fields:Object.fromEntries(Object.entries(patch.fields).filter(([k])=>k!=='currency'))};
    rollback.push({kind:patch.kind,id:patch.id,fingerprint:S.fingerprint(record),before});
  }
  return {copy,rollback};
}
function rollbackCopy(db,patches){const copy=structuredClone(db);for(const patch of patches){const record=find(copy,patch);if(S.fingerprint(record)!==patch.fingerprint)throw new Error('FINGERPRINT_CONFLICT');for(const old of patch.before){if(old.exists)S.put(record,old.path,old.value);else{const keys=old.path.split('.'),at=keys.slice(0,-1).reduce((v,k)=>v?.[k],record);if(at)delete at[keys.at(-1)];}}}return copy;}
module.exports={applyToCopy,rollbackCopy};
