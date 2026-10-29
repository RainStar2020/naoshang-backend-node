'use strict';
const A=require('./index');
const {session}=require('./users-pilot');
const USERS=require('./users-pilot'),SUPPORT=require('./support-pilot');
const {READ_MODULES:MODULES}=require('./module-policy');
function validationErrors(error){
  const errors=error.errors || error.extra?.errors;
  if(Array.isArray(errors)&&errors.length&&errors.every(e=>typeof e.field==='string'&&typeof e.message==='string'))return errors.map(({field,message})=>({field,message}));
  // Legacy errors often carry no field metadata. Do not infer a field from prose.
  return [{field:'request',message:error.message || '参数不合法'}];
}
function mapped(error){
  const code=A.LEGACY_CODES[error?.code] || error?.code;
  if(typeof error?.code==='number'&&A.LEGACY_CODES[error.code])return A.mapException(new A.ApiError(error.code,error.message,code==='VALIDATION_ERROR'?validationErrors(error):undefined));
  if(error instanceof A.ApiError&&code==='VALIDATION_ERROR')return A.mapException(new A.ApiError(code,error.message,validationErrors(error)));
  return A.mapException(error);
}
async function handle(route,db,req,res,url,params,ctx){
  const config=MODULES[route.module],context=A.storage.getStore();
  if(route.method!=='GET'||!config||context?.version!==2)return false;
  // Module defaults are configurable; an explicit environment 0 still rolls back.
  const enabled=process.env[config.flag] ?? (config.defaultEnabled?'1':'0');
  if(enabled!=='1'){context.version=1;return false;}
  // Preserve already accepted DTO/pagination contracts behind the same module gate.
  if(route.module==='users'&&await USERS.handle(route,db,req,res,url,params,ctx))return true;
  if(route.module==='support'&&await SUPPORT.handle(route,db,req,res,url,params,ctx))return true;
  try{
    const sess=route.perm==='public'?null:session(req,url,ctx.sessions);
    const result=await route.handler({db,req,res,url,params,query:url.searchParams,sess});
    ctx.sendJSON(res,200,A.success(result));
  }catch(error){const result=mapped(error);A.logEvent('readonly.batch.failure');ctx.sendJSON(res,result.httpStatus,result.body);}
  return true;
}
// New routes explicitly opt into the factory once at registration, not in every handler.
// They have no legacy contract; existing write/exception routes are never selected here.
async function handleNew(route,db,req,res,url,params,ctx){
  if(route.apiStandard!==true)return false;
  // A newly registered factory-only route has no legacy representation.
  const context=A.storage.getStore();if(context)context.version=2;
  try{
    const sess=route.perm==='public'?null:session(req,url,ctx.sessions);
    const body=['GET','HEAD','OPTIONS'].includes(req.method)?{}:await ctx.readBody(req);
    const result=await route.handler({db,req,res,url,params,query:url.searchParams,sess,body,save:ctx.persist,persist:ctx.persist,__sessions:ctx.sessions});
    ctx.sendJSON(res,route.successStatus===201?201:200,A.success(result));
  }catch(error){const result=mapped(error);ctx.sendJSON(res,result.httpStatus,result.body);}
  return true;
}
module.exports={MODULES,handle,handleNew,mapped};
