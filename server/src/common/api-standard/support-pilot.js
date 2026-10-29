'use strict';
const A=require('./index');
const {session,id,label,iso}=require('./users-pilot');
const SORT_FIELDS=Object.freeze(['ticketId','createdAt','status']);
const PATHS=Object.freeze(['/support/profile','/support/tickets','/support/tickets/:ticketId']);
function ticket(t) {
  return {ticketId:id(t.ticketId),accountId:id(t.accountId),category:label(t.category),status:label(t.status),subject:label(t.subject),assigneeId:id(t.assigneeId),createdAt:iso(t.createdAt),updatedAt:iso(t.updatedAt),version:t.version,allowedActions:t.allowedActions.slice()};
}
function project(route,result) {
  if(result==null)return null;
  if(route.path==='/support/profile')return {adminId:id(result.adminId),displayName:label(result.displayName),phone:result.phone,email:result.email,createdAt:iso(result.createdAt),updatedAt:iso(result.updatedAt),isActive:!!result.isActive};
  if(route.path==='/support/tickets')return A.page(result.items.map(ticket),result.total,{pageNum:result.page,pageSize:result.pageSize});
  return {ticket:ticket(result.ticket),messages:result.messages.map(m=>({messageId:id(m.messageId),ticketId:id(m.ticketId),senderRole:label(m.senderRole),senderId:id(m.senderId),content:label(m.content),createdAt:iso(m.createdAt)}))};
}
async function handle(route,db,req,res,url,params,ctx) {
  const context=A.storage.getStore();
  if(route.method!=='GET'||!PATHS.includes(route.path)||context?.version!==2)return false;
  if(process.env.API_STANDARD_SUPPORT_PILOT==='0'){context.version=1;return false;}
  try {
    const sess=session(req,url,ctx.sessions),query=url.searchParams;
    const apiPilot=route.path==='/support/tickets'?A.paging(query,{sortFields:SORT_FIELDS}):null;
    if(apiPilot){apiPilot.sortBy ||= 'ticketId';if(!query.has('sortOrder'))apiPilot.sortOrder='desc';}
    const result=await route.handler({db,req,res,url,params,query,sess,apiPilot});
    ctx.sendJSON(res,200,A.success(project(route,result)));
  } catch(error) {
    // Resource code is scoped to this pilot; existing NOT_FOUND contracts stay intact.
    const typed=typeof error.code==='number'&&A.LEGACY_CODES[error.code]?new A.ApiError(error.code,error.message):error;
    const mapped=A.mapException(typed);
    if(mapped.httpStatus===404)mapped.body=A.failure('RESOURCE_NOT_FOUND','请求的资源不存在');
    A.logEvent('support.pilot.failure');ctx.sendJSON(res,mapped.httpStatus,mapped.body);
  }
  return true;
}
module.exports={handle,PATHS,SORT_FIELDS,project};
