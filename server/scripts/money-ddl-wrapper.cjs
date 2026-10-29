'use strict';
const ident=s=>{if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s))throw Error('UNSAFE_IDENTIFIER');return '`'+s+'`';};
function splitOperations(text){let depth=0,quote='',escaped=false,start=0,out=[];for(let i=0;i<text.length;i++){const c=text[i];if(escaped){escaped=false;continue;}if(c==='\\'){escaped=true;continue;}if(quote){if(c===quote)quote='';continue;}if("'\"`".includes(c)){quote=c;continue;}if(c==='(')depth++;if(c===')')depth--;if(c===','&&depth===0){out.push(text.slice(start,i).trim());start=i+1;}}out.push(text.slice(start).trim());return out;}
function parse(sql){const clean=sql.replace(/--[^\n]*/g,'').trim();const match=clean.match(/^ALTER\s+TABLE\s+`?(\w+)`?\s+([\s\S]*?);?$/i);if(!match)throw Error('ONLY_ALTER_ADD_DROP_COLUMNS_SUPPORTED');return splitOperations(match[2].replace(/;\s*$/,'')).map(part=>{
  const add=part.match(/^ADD\s+COLUMN\s+`?(\w+)`?\s+([\s\S]+)$/i),drop=part.match(/^DROP\s+COLUMN\s+`?(\w+)`?$/i);
  if(drop)return {table:match[1],column:drop[1],action:'DROP',definition:null};
  if(!add)throw Error('UNSUPPORTED_ALTER_OPERATION');const definition=add[2],type=definition.match(/^([a-z]+(?:\(\d+(?:\s*,\s*\d+)?\))?(?:\s+unsigned)?)/i)?.[1];if(!type)throw Error('UNSUPPORTED_TYPE');
  const def=definition.match(/\bDEFAULT\s+(NULL|'[^']*'|-?\d+(?:\.\d+)?)/i);
  return {table:match[1],column:add[1],action:'ADD',definition,type:type.toLowerCase().replace(/\s+/g,'').replace(/,/g,','),nullable:!/\bNOT\s+NULL\b/i.test(definition),defaultValue:!def||/^null$/i.test(def[1])?null:def[1].replace(/^'|'$/g,'')};
});}
async function execute(connection,sql,log=[]){for(const operation of parse(sql)){
  const {table,column,action}=operation;ident(table);ident(column);
  const [rows]=await connection.query('SELECT COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',[table,column]);
  const current=rows[0];if(action==='ADD'&&current){const type=String(current.COLUMN_TYPE).toLowerCase().replace(/\s+/g,'');if(type!==operation.type||(current.IS_NULLABLE==='YES')!==operation.nullable||(current.COLUMN_DEFAULT==null?null:String(current.COLUMN_DEFAULT))!==operation.defaultValue){log.push({table,column,action,status:'definition-conflict',actual:current,expected:operation});throw Error('COLUMN_DEFINITION_CONFLICT: '+table+'.'+column);}log.push({table,column,action,status:'skipped-matching'});continue;}
  if(action==='DROP'&&!current){log.push({table,column,action,status:'skipped-absent'});continue;}
  const statement='ALTER TABLE '+ident(table)+' '+action+' COLUMN '+ident(column)+(action==='ADD'?' '+operation.definition:'');
  const event={table,column,action,sql:statement,status:'started'};log.push(event);try{await connection.query(statement);event.status='executed';}catch(error){event.status='failed';event.error=error.code;throw error;}
}return log;}
module.exports={parse,execute};
