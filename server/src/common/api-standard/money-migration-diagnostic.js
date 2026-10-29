'use strict';
// Allowed callers: migration diagnostics CLI and migration unit tests only.
// Never import this module from business writers, readers or sync mappings.
const M=require('./money');
function fromYuanHalfUpMigration(text,currency='CNY') {
  if(typeof text!=='string'||!/^\d+(?:\.\d+)?$/.test(text))throw new Error('INVALID_LEGACY_AMOUNT');
  const [whole,fraction='']=text.split('.');
  let n=BigInt(whole)*100n+BigInt(fraction.slice(0,2).padEnd(2,'0'));
  if(fraction.length>2&&fraction[2]>='5')n+=1n;
  if(n>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('OUT_OF_RANGE');
  return M.cents(Number(n),currency);
}
module.exports={fromYuanHalfUpMigration};
