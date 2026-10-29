'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');
const STATUS = Object.freeze({ SUCCESS: 1, FAILURE: 0 });
const CODES = Object.freeze({ VALIDATION_ERROR:400, UNAUTHENTICATED:401, FORBIDDEN:403, NOT_FOUND:404, CONFLICT:409, VERSION_CONFLICT:409, IDEMPOTENCY_CONFLICT:409, QUOTA_EXCEEDED:409, RATE_LIMITED:429, INTERNAL_ERROR:500, INVALID_JSON:400 });
const LEGACY_CODES = Object.freeze({40000:'VALIDATION_ERROR',40100:'UNAUTHENTICATED',40300:'FORBIDDEN',40400:'NOT_FOUND',40900:'CONFLICT',40901:'VERSION_CONFLICT',40902:'IDEMPOTENCY_CONFLICT',40903:'QUOTA_EXCEEDED',50000:'INTERNAL_ERROR'});
const SYSTEM_MESSAGE = '服务器内部错误，请稍后重试';
const storage = new AsyncLocalStorage();
const requestContexts = new WeakMap();
const envelopes = new WeakSet();
function corsHeaders() { return {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type,Authorization,X-API-Version','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Expose-Headers':'X-Trace-Id'}; }
function prepareWire(value) { return require('./money-shadow').forWire(value,{version:storage.getStore()?.version || 1}); }
/** @typedef {{status:1,response:T|null}|{status:0,code:string,message:string,response:null,errors?:Array<{field:string,message:string}>}} ApiResponse<T> */
function assertJson(value) {
  if (typeof value === 'bigint' || typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol' || (typeof value === 'number' && !Number.isFinite(value))) throw new TypeError('Non-JSON value');
  if (value && typeof value === 'object') for (const v of Object.values(value)) assertJson(v);
  return value;
}
function success(response = null) { const result={status:STATUS.SUCCESS,response:assertJson(response)}; envelopes.add(result); return result; }
function failure(code, message, errors) {
  if (!code || typeof code !== 'string' || !message || typeof message !== 'string') throw new TypeError('code and message required');
  const result = {status:STATUS.FAILURE,code,message,response:null};
  if (errors !== undefined) result.errors = errors.map(e => {
    if (typeof e.field !== 'string' || typeof e.message !== 'string') throw new TypeError('Invalid field error');
    return {field:e.field,message:e.message};
  });
  envelopes.add(result);
  return result;
}
class ApiError extends Error {
  constructor(code, message, errors) { super(message); this.code=code; this.errors=errors; this.httpStatus=CODES[code] || (LEGACY_CODES[code] ? CODES[LEGACY_CODES[code]] : 409) || 409; }
}
function mapException(error) {
  if (error instanceof ApiError) return {httpStatus:error.httpStatus,body:failure(LEGACY_CODES[error.code] || error.code,error.httpStatus >= 500 ? SYSTEM_MESSAGE : error.message,error.errors)};
  // A generic SyntaxError can be a programming error, not necessarily invalid JSON.
  return {httpStatus:500,body:failure('INTERNAL_ERROR',SYSTEM_MESSAGE)};
}
function version(headers = {}) { return process.env.API_STANDARD_V2 !== '0' && headers['x-api-version'] === '2' ? 2 : 1; }
function parseJson(text, req) {
  try { return JSON.parse(text); }
  catch (error) {
    const ctx = (req && requestContexts.get(req)) || storage.getStore();
    if (ctx?.version === 2) ctx.invalidJson = true;
    throw error;
  }
}
function context(req, res, run) {
  const supplied = req.headers['x-trace-id'];
  const traceId = typeof supplied === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(supplied) ? supplied : randomUUID();
  res.setHeader('X-Trace-Id',traceId);
  return storage.run({traceId,version:version(req.headers),isHq:req.url.startsWith('/api/hq')}, () => {
    const requestContext = storage.getStore();
    requestContexts.set(req,requestContext);
    if (typeof res.once === 'function') res.once('finish', () => storage.run(requestContext, () => logEvent('request.complete')));
    if (requestContext.version !== 2) return run();
    return Promise.resolve().then(run).catch(error => {
      logEvent('request.exception');
      if (res.headersSent) return;
      const mapped = mapException(error);
      res.writeHead(mapped.httpStatus, {'Content-Type':'application/json; charset=utf-8',...corsHeaders()});
      res.end(JSON.stringify(mapped.body));
    });
  });
}
// No payload, headers or exception messages are logged: credentials cannot enter this logger.
function logEvent(event, logger = console.info) { logger(`[traceId=${storage.getStore()?.traceId || 'none'}] ${/^[a-zA-Z0-9._-]+$/.test(event) ? event : 'api.event'}`); }
function adapt(httpStatus, body, ctx = storage.getStore()) {
  if (!ctx || ctx.version !== 2) return {httpStatus,body};
  if (ctx.invalidJson) return {httpStatus:400,body:failure('INVALID_JSON','请求体不是合法 JSON')};
  if (body && typeof body === 'object' && envelopes.has(body)) return {httpStatus,body};
  if (httpStatus >= 400) {
    logEvent('response.failure');
    const code = LEGACY_CODES[body?.code] || Object.keys(CODES).find(k => CODES[k] === httpStatus) || 'INTERNAL_ERROR';
    return {httpStatus,body:failure(code,httpStatus >= 500 ? SYSTEM_MESSAGE : (body?.message || body?.error || '请求失败'))};
  }
  return {httpStatus:httpStatus === 204 ? 200 : httpStatus,body:success(ctx.isHq && body?.code === 0 ? body.data : body)};
}
function paging(query, {maxPageSize=100,maxPageNum=1000000,sortFields=[]}={}) {
  const get = k => typeof query.get === 'function' ? query.get(k) : query[k];
  const integer = (key, fallback, max) => {
    const raw=get(key); if(raw == null) return fallback;
    if(!/^[1-9]\d*$/.test(String(raw)) || !Number.isSafeInteger(Number(raw)) || Number(raw)>max) throw new ApiError('VALIDATION_ERROR','分页参数不合法',[{field:key,message:`必须为1至${max}的整数`}]);
    return Number(raw);
  };
  const sortBy=get('sortBy'), sortOrder=get('sortOrder') || 'asc';
  if ((sortBy && !sortFields.includes(sortBy)) || !['asc','desc'].includes(sortOrder)) throw new ApiError('VALIDATION_ERROR','排序参数不合法',[{field:sortBy && !sortFields.includes(sortBy) ? 'sortBy' : 'sortOrder',message:'排序字段或方向不允许'}]);
  return {pageNum:integer('pageNum',1,maxPageNum),pageSize:integer('pageSize',20,maxPageSize),sortBy:sortBy || null,sortOrder};
}
function page(list,total,p) { if(!Array.isArray(list)||!Number.isSafeInteger(total)||total<0) throw new TypeError('Invalid page'); return {pageNum:p.pageNum,pageSize:p.pageSize,total,totalPages:Math.ceil(total/p.pageSize),list}; }
function legacyPage(p) { return {items:p.list,total:p.total,page:p.pageNum,pageSize:p.pageSize}; }
module.exports={STATUS,CODES,LEGACY_CODES,SYSTEM_MESSAGE,ApiError,success,failure,mapException,version,context,storage,logEvent,adapt,paging,page,legacyPage,assertJson,parseJson,corsHeaders,prepareWire};
