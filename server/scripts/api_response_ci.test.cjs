const test=require('node:test'),assert=require('node:assert/strict'),C=require('./check_api_response.cjs');
const old="method: 'POST', path: '/old'";
test('new read in integrated module is automatically factory-covered',()=>assert.deepEqual(C.checkModule('staff',[{module:'staff',method:'GET',path:'/new'}],'',old),[]));
test('new writes and exception reads require explicit factory metadata',()=>{for(const [name,method]of [['staff','POST'],['payments','GET']]){assert.ok(C.checkModule(name,[{module:name,method,path:'/new'}],'',old).length);assert.deepEqual(C.checkModule(name,[{module:name,method,path:'/new',apiStandard:true}],'',old),[]);}});
test('legacy write unchanged is exempt; direct response bypass is rejected',()=>{assert.deepEqual(C.checkModule('staff',[{module:'staff',method:'POST',path:'/old'}],'',old),[]);assert.ok(C.checkModule('staff',[],'ctx.res.json({ok:true})',old).length);assert.ok(C.checkModule('staff',[],"res.status(200).json({ok:true})",old).length);});
test('new modules need factory registration and correct module identity',()=>{assert.ok(C.checkModule('brandNew',[{module:'brandNew',method:'GET',path:'/'}],'').length);assert.deepEqual(C.checkModule('brandNew',[{module:'brandNew',method:'GET',path:'/',apiStandard:true}],'',''),[]);assert.ok(C.checkModule('staff',[{method:'GET',path:'/'}],'','').length);});
test('legacy routing check captures multiline conditions and action aliases',()=>{
  const conditions=C.legacyConditions("if (\n p === '/new' &&\n m === 'GET'\n) {}\nconst ROUTE_ALIASES = {'/short':'/long'};");
  assert.ok([...conditions].some(c=>c.includes("p === '/new'")));assert.ok(conditions.has('alias:/short=/long'));
});
