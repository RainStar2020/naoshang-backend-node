'use strict';
const A = require('./index');
const MODULE_SWITCH = 'API_STANDARD_USERS_PILOT';
const SORT_FIELDS = Object.freeze(['accountId','nickname','createdAt']);
const supported = route => route.method === 'GET' && ['/users','/users/:accountId'].includes(route.path);
function id(value) {
  if (value == null) return null;
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('Unsafe source identifier');
  return String(value);
}
function phone(value) {
  const text=String(value || '');
  if (!text) return '';
  return /^\d{11}$/.test(text) ? text.slice(0,3)+'****'+text.slice(-4) : (text.includes('*') ? text : '***');
}
function label(value) {
  return String(value || '').replace(/\b\d{11}\b/g, phone)
    .replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,'$1***@$2');
}
function iso(value) { if(!value)return null; const date=new Date(value);return Number.isNaN(date.getTime())?null:date.toISOString(); }
function profile(value) {
  return {accountId:id(value.accountId),displayId:id(value.displayId),nickname:label(value.nickname),phone:phone(value.phone),
    tier:value.tier,tierLabel:value.tierLabel,isFrozen:!!value.frozen,entitlementState:value.entitlementState,
    createdAt:iso(value.createdAt),lastLoginAt:iso(value.lastLoginAt),version:value.version,allowedActions:value.allowedActions.slice()};
}
function project(route,result) {
  if(route.path==='/users') return A.page(result.items.map(profile),result.total,{pageNum:result.page,pageSize:result.pageSize});
  if(result==null)return null;
  return {profile:profile(result.profile),members:result.members.map(m=>({memberId:id(m.memberId),displayName:label(m.displayName),memberLevel:m.memberLevel,displayId:id(m.displayId),storeId:id(m.storeId)}))};
}
function session(req,url,sessions) {
  const auth=req.headers.authorization || '';
  const token=auth.startsWith('Bearer ')?auth.slice(7).trim():(url.searchParams.get('token') || '').trim();
  const sess=token?sessions[token]:null;
  if(!sess || (sess.expiresAt && (!Number.isFinite(new Date(sess.expiresAt).getTime()) || new Date(sess.expiresAt).getTime()<=Date.now()))) throw new A.ApiError('UNAUTHENTICATED','未登录或 token 已失效');
  if(!['hq_admin','admin'].includes(sess.role))throw new A.ApiError('FORBIDDEN','需要总部后台管理员权限');
  return sess;
}
async function handle(route,db,req,res,url,params,ctx) {
  const context=A.storage.getStore();
  if(!supported(route) || context?.version!==2)return false;
  if(process.env[MODULE_SWITCH]==='0'){context.version=1;return false;}
  try {
    const sess=session(req,url,ctx.sessions);
    const query=url.searchParams;
    const paging=route.path==='/users'?A.paging(query,{sortFields:SORT_FIELDS}):null;
    const apiPilot=paging?{...paging,sortBy:paging.sortBy || 'accountId'}:null;
    // Invoke the existing business handler once, then project the same result.
    const result=await route.handler({db,req,res,url,params,query,sess,apiPilot});
    ctx.sendJSON(res,200,A.success(project(route,result)));
  } catch(error) {
    let mapped;
    if(typeof error.code==='number' && A.LEGACY_CODES[error.code]) mapped=A.mapException(new A.ApiError(error.code,error.message));
    else mapped=A.mapException(error);
    A.logEvent('users.pilot.failure');
    ctx.sendJSON(res,mapped.httpStatus,mapped.body);
  }
  return true;
}
module.exports={handle,SORT_FIELDS,MODULE_SWITCH,project,session,id,label,iso};
