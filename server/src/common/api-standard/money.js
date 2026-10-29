'use strict';
const { ApiError, assertJson } = require('./index');
/** @typedef {{amountCents:number,currency:string}} Money */
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
function invalid() { throw new ApiError('VALIDATION_ERROR','金额、精度或币种不合法',[{field:'amountCents',message:'金额必须非负且不超过安全整数上限'}]); }
function output(n, max=MAX) { if(n<0n || n>max || n>MAX) invalid(); return Number(n); }
function cents(n, currency='CNY', {maxCents=Number.MAX_SAFE_INTEGER,allowedCurrencies=['CNY']}={}) {
  if(typeof n!=='number'||!Number.isSafeInteger(n)||n<0||!Number.isSafeInteger(maxCents)||maxCents<0||n>maxCents||!allowedCurrencies.includes(currency)) invalid();
  return {amountCents:n,currency};
}
function fromYuan(value,currency='CNY',options) {
  // Decimal text only: callers must not pass a previously computed floating-point value.
  if(typeof value!=='string'||!/^\d+(?:\.\d{1,2})?$/.test(value)) invalid();
  const [whole,fraction='']=value.split('.');
  return cents(output(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'))),currency,options);
}
function toYuan(m) { cents(m.amountCents,m.currency); const n=BigInt(m.amountCents); return `${n/100n}.${String(n%100n).padStart(2,'0')}`; }
function same(a,b) { cents(a.amountCents,a.currency); cents(b.amountCents,b.currency); if(a.currency!==b.currency) invalid(); }
function add(a,b) { same(a,b); return cents(output(BigInt(a.amountCents)+BigInt(b.amountCents)),a.currency); }
function subtract(a,b) { same(a,b); return cents(output(BigInt(a.amountCents)-BigInt(b.amountCents)),a.currency); }
function ratio(m,numerator,denominator) {
  cents(m.amountCents,m.currency);
  const valid=x=>typeof x==='bigint'||(typeof x==='number'&&Number.isSafeInteger(x));
  if(!valid(numerator)||!valid(denominator)) invalid();
  const n=BigInt(numerator),d=BigInt(denominator); if(n<0n||d<=0n) invalid();
  const product=BigInt(m.amountCents)*n;
  return cents(output(product/d+(product%d*2n>=d?1n:0n)),m.currency);
}
function sum(values,currency='CNY') { return values.reduce(add,cents(0,currency)); }
function split(m,count) {
  cents(m.amountCents,m.currency); if(!Number.isSafeInteger(count)||count<1||count>100000) invalid();
  const n=BigInt(m.amountCents),d=BigInt(count);
  return Array.from({length:count},(_,i)=>cents(output(n/d+(BigInt(i)<n%d?1n:0n)),m.currency));
}
function serialize(m) { cents(m.amountCents,m.currency); return JSON.stringify(assertJson(m)); }
function deserialize(text) { let m; try {m=JSON.parse(text);} catch {invalid();} if(!m||typeof m!=='object') invalid(); return cents(m.amountCents,m.currency); }
module.exports={cents,fromYuan,toYuan,add,subtract,ratio,sum,split,serialize,deserialize};
