// Static source inspection only: never require the application or route modules.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const endpoints = [], pendingRuntimeConfirmation = [];
const location = (file, source, offset) => ({ file, line: source.slice(0, offset).split('\n').length });
function add(file, source, offset, method, pattern, extra = {}) {
  endpoints.push({ method, pathPattern: pattern, handler: location(file, source, offset), enabled: true,
    defaultResponse: file.includes('/hq/') ? '{code,message,data}' : 'raw success / {error} failure; inspect handler for legacy variants',
    exception: null, pendingMigration: true, ...extra });
}
const index = read('src/routes/hq/index.js');
for (const match of index.matchAll(/require\('\.\/modules\/([^']+)'\)/g)) {
  const file = `src/routes/hq/modules/${match[1]}.js`, source = read(file);
  for (const route of source.matchAll(/method:\s*'([^']+)'\s*,\s*path:\s*'([^']+)'/g))
    add(file, source, route.index, route[1], '/api/hq' + route[2]);
}
for (const file of ['server.js', 'src/routes/h5.js', 'src/routes/h5biz.js', 'src/routes/h5codes.js']) {
  const source = read(file);
  // Balanced parentheses, respecting strings, regex literals and character classes.
  for (const start of source.matchAll(/\bif\s*\(/g)) {
    let i = start.index + start[0].length, depth = 1, quote = '', escaped = false, cls = false;
    const begin = i;
    for (; i < source.length && depth; i++) {
      const c = source[i];
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (quote) {
        if (quote === '/' && c === '[') cls = true;
        if (quote === '/' && c === ']') cls = false;
        if (c === quote && !cls) quote = '';
        continue;
      }
      if (c === "'" || c === '"' || c === '`' || c === '/') { quote = c; continue; }
      if (c === '(') depth++;
      if (c === ')') depth--;
    }
    const condition = source.slice(begin, i - 1);
    if (!/\bp\b|url\.pathname/.test(condition)) continue;
    const methods = [...condition.matchAll(/(?:\bm|req\.method)\s*===\s*'(GET|POST|PUT|PATCH|DELETE|OPTIONS)'/g)].map(x => x[1]);
    const literals = [...condition.matchAll(/(?:\bp|url\.pathname)\s*===\s*'([^']+)'/g)].map(x => x[1]);
    const routeLike = literals.length || /\.match\(|\.test\(p\)|p\.startsWith/.test(condition);
    if (!routeLike) continue;
    if (!methods.length || (file === 'src/routes/h5.js' && condition.includes('return false'))) {
      pendingRuntimeConfirmation.push({ ...location(file, source, start.index), condition, reason: 'method or dispatch guard requires control-flow review' }); continue;
    }
    const simple = literals.length && !/\.match\(|\.test\(|startsWith/.test(condition);
    for (const method of methods) {
      for (const pattern of simple ? literals : [condition]) {
        const exception = pattern === '/health' ? 'health' : null;
        add(file, source, start.index, method, pattern, { matchKind: simple ? 'literal' : 'source predicate', exception, condition,
          enabled: file !== 'server.js' || !String(pattern).startsWith('/api/hq'),
          requiresDispatchReview: !simple });
      }
    }
  }
  if (file.endsWith('/h5.js')) {
    const aliases = source.match(/const ROUTE_ALIASES = \{([\s\S]*?)\};/)[1];
    for (const alias of aliases.matchAll(/'([^']+)':\s*'([^']+)'/g))
      add(file, source, source.indexOf(alias[0]), 'POST', alias[1], { aliasOf: alias[2], matchKind: 'alias' });
  }
}
const entry = read('server.js');
const entryLine = text => location('server.js', entry, entry.indexOf(text));
endpoints.push({ method: 'OPTIONS', pathPattern: '*', handler: entryLine("if (req.method === 'OPTIONS')"), enabled:true, defaultResponse:'204 empty', exception:'OPTIONS',pendingMigration:false });
// Keep the original candidate records as auditable evidence, not as the denominator.
const evidenceRecords = JSON.parse(JSON.stringify(endpoints));
const dispatchGuards = [], exceptions = [], aliases = [], finalEndpoints = [], unresolved = [];
for (const record of endpoints) {
  const r = { ...record, primaryHandler:record.handler, status:'active', requiresDispatchReview:false };
  if (r.condition?.includes('html|js|css')) { dispatchGuards.push({...r,status:'dispatch-guard',reason:'returns false; not an endpoint'}); continue; }
  if (r.exception) { exceptions.push(r); continue; }
  if (r.aliasOf) { aliases.push(r); continue; }
  if (r.matchKind === 'source predicate') {
    // A source predicate is the precise path language, including unanchored regexes,
    // slash-containing suffixes and negative exclusions. Do not invent :id limits.
    r.pathPredicate = r.condition;
    r.matchKind = 'exact-source-predicate';
    r.pathPattern = r.condition;
    r.dispatchNotes = 'Source order applies; H5 pre-delegate -> h5biz -> h5codes -> H5 post-delegate. Predicate may accept nested or empty suffixes.';
    const alternative = r.condition.match(/\((cancellations\|cancel|receipts\|confirm-receipt|completions\|complete)\)/);
    if (alternative) {
      r.expandedPathPredicates = alternative[1].split('|').map(v => r.condition.replace(alternative[0],v));
      r.aliasAlternativesCountedOnce = true;
    }
  }
  if (r.handler.file.includes('/hq/')) {
    r.matchKind='template';
    r.dispatchNotes='HQ strips /api/hq and trailing slashes, static segments before parameter routes; auth may terminate before handler.';
  }
  if (r.pathPattern === '/me/income-export') r.representations = ['JSON (default; included)','CSV when format=csv (excluded representation)'];
  if (r.handler.file === 'server.js') r.defaultResponse='Raw JSON success; {error} or {ok:false,error} failure (branch evidence in phase-0 register)';
  const key = r.method+' '+r.pathPattern;
  const prior = finalEndpoints.find(x => x.method+' '+x.pathPattern === key);
  if (prior) {
    // /api/agent/update is duplicated inside the same admin block; the second is unreachable.
    const shadowed = r.pathPattern === '/api/agent/update';
    (prior.otherHandlers ||= []).push({...r.handler,status:shadowed?'shadowed':'role-dependent',reason:shadowed?'Earlier identical condition in admin block returns first':'Admin and non-admin branch share endpoint'});
    (prior.evidence ||= []).push(r.handler);
    continue;
  }
  finalEndpoints.push(r);
}
for (const a of aliases) {
  const target = finalEndpoints.find(r=>r.method===a.method && r.pathPattern===a.aliasOf);
  if (!target) { unresolved.push({...a,status:'pending-runtime-confirmation',reason:'Alias target not statically registered'}); continue; }
  (target.aliases ||= []).push({method:a.method,path:a.pathPattern,evidence:a.handler});
}
const delegateLine = read('src/routes/h5.js').slice(0,read('src/routes/h5.js').indexOf('if (await B.handle')).split('\n').length;
function order(r) {
  if (r.handler.file.includes('/hq/')) return 0;
  if (r.handler.file === 'server.js') return 1;
  if (r.handler.file === 'src/routes/h5.js') return r.handler.line < delegateLine ? 2 : 5;
  if (r.handler.file === 'src/routes/h5biz.js') return 3;
  return 4;
}
for (const r of finalEndpoints) {
  r.id = `${r.method} ${r.pathPattern}`;
  r.dispatchStage = order(r);
  r.effectiveMatch = 'Own path matcher, subject to global auth/role/entitlement guards, minus earlier returning route predicates at the same dispatch stage and earlier delegates. See ordered evidence; prefix matches are not narrowed to a single segment.';
  r.earlierDispatchStages = ['OPTIONS','/health','HQ','/api','H5 pre-delegate','h5biz','h5codes'].slice(0,order(r)+2);
}
const health = {method:'* except OPTIONS',pathPattern:'/health',handler:entryLine("if (url.pathname === '/health')"),enabled:true,defaultResponse:'{ok:true,ts,service}',exception:'health',pendingMigration:false};
exceptions.push(health,{method:'* except OPTIONS',pathPattern:'/',handler:entryLine('function notApiPath'),enabled:true,defaultResponse:'service metadata JSON',exception:'service metadata',pendingMigration:false},
  {method:'GET',pathPattern:'/me/income-export?format=csv',handler:location('src/routes/h5.js',read('src/routes/h5.js'),read('src/routes/h5.js').indexOf("if (q('format') === 'csv')")),exception:'CSV representation',defaultResponse:'text/csv on success; JSON errors',enabled:true,pendingMigration:false});
const legacyCandidates = ['src/routes/auth.js','src/routes/options.js'].map(file=>({file,status:'not registered by active entry',deleted:false,reason:'Express/SQLite legacy modules; no require path from current route dispatch'}));
const report = { scope: 'static source registration, no application imports or runtime requests', dispatchOrder: ['OPTIONS','/health','/api/hq/*','/api/*','H5 before delegate','h5biz','h5codes','H5 after delegate','fallback'],
  coveragePolicy: 'Denominator = canonical active JSON handler families (method + literal/template/exact source predicate). Action aliases, regex action synonyms and role branches count once; health, OPTIONS, metadata and CSV representation excluded. Infinite dynamic paths remain exact predicates, never guessed :id templates. This measures registered handler-family coverage, not all possible URL strings.',
  denominator:finalEndpoints.length, endpoints:finalEndpoints, exceptions, dispatchGuards, legacyCandidates,
  orderedDispatchEvidence:finalEndpoints.slice().sort((a,b)=>order(a)-order(b)||a.handler.line-b.handler.line).map(r=>({id:r.id,handler:r.handler,stage:order(r)})),
  pendingRuntimeConfirmation:unresolved, evidenceRecords,
  evidenceReconciliation:{candidateRecords:endpoints.length,canonicalJson:finalEndpoints.length,aliasRecords:aliases.length,dispatchGuards:dispatchGuards.length,exceptionRecords:endpoints.filter(x=>x.exception).length,duplicateRecords:endpoints.length-finalEndpoints.length-aliases.length-dispatchGuards.length-endpoints.filter(x=>x.exception).length},
  staticLimitations:['No authentication/data-dependent success has been executed. Enabled means registered and dispatch-reachable, not guaranteed successful.', 'Fallback 404, global auth/entitlement guards are error branches, not additional endpoints.', 'HQ template parameter values and H5 prefix/regex suffixes are infinite languages, preserved rather than enumerated.'] };
const outputPath = path.join(root,'docs/api-standardization/phase-1-route-register.json');
const serialized = JSON.stringify(report,null,2)+'\n';
if (process.argv.includes('--check')) {
  if (fs.readFileSync(outputPath,'utf8') !== serialized) throw new Error('Route register is stale');
} else fs.writeFileSync(outputPath, serialized);
console.log(JSON.stringify({ denominator:report.denominator,exceptions:exceptions.length,pending:unresolved.length,reconciliation:report.evidenceReconciliation }));
