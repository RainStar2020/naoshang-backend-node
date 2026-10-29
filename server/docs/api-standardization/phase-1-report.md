# 阶段 1 收口报告（2026-10-29）

## 范围与结论
只新增公共设施和最小入口接线；未改业务算法、旧 catch、默认版本、SQL、ORM或数据库。未启动服务、未连接数据库、未执行写入测试。阶段1静态登记与纯内存验证已收口，保留以下已知限制；不宣称所有真实HTTP入口异常已贯穿，也不进入阶段2。等待用户验收。

## 最终路由清单与分母
完整清单：phase-1-route-register.json。每条含 method、字面路径/模板/精确源码谓词、handler/primaryHandler 文件行号、enabled、defaultResponse、exception、pendingMigration。evidenceRecords 保留348条候选的逐条证据，orderedDispatchEvidence 保留分发顺序。

348条对账：334个规范化JSON处理端点族 + 8个归并动作别名 + 4个重复候选 + 1个H5静态资源分发排除条件 + 1个OPTIONS例外 = 348。
334分布：HQ 120、server.js 62、H5 84、h5biz 60、h5codes 8。
独立例外4项：OPTIONS任意路径204、/health健康JSON、/服务元信息JSON、GET /me/income-export?format=csv 的CSV表示。income-export的默认JSON表示仍计入334，CSV表示不重复计数。健康检查和服务信息不属于业务响应分母。

分母固定口径：334个已注册且静态可达的规范化JSON处理端点族。不是无限URL字符串总数，不是全部用户角色/数据状态下的成功请求数。动作别名和正则动作同义词按一个主处理族计数；角色分支按一个method+path计数，otherHandlers记录条件分支；例外和遗留不计入。后续新增/删除路由必须重新生成清单及解释分母差异。
动态路径保留精确源码谓词（包括未锚定正则、startsWith、endsWith和排除条件），不擅自把后缀改为单段:id。正则动作选择另列expandedPathPredicates，并标同义分支不重复计数。
H5分发先处理认证/支付等前段，再委托h5biz，随后h5codes，再H5后段。动态模式的有效域须减去较早返回的模式；清单记录此规则和有序证据。/api/hq优先于其他/api，HQ模块不会被server管理接口重复统计。
POST /api/agent/update第二段被同admin分支更早返回覆盖，列otherHandlers.status=shadowed。/api/order/product、/api/identities、/api/commissions按角色分支归并，不删除源码。
8个POST动作别名均定位到已有认证主处理函数，aliases保留别名定义行号。
原2条待确认条件已静态解析：根路径服务信息及/health未限制method，均受OPTIONS优先拦截，列独立例外而非猜为GET。
本次登记未遗留无法解析的路径条件（pendingRuntimeConfirmation为空）。真实角色/数据状态、成功可用性仍为未运行验证；不把静态可达等同运行通过。
遗留候选：src/routes/auth.js、src/routes/options.js，未由当前入口注册，独立legacyCandidates记录，不删除。

## 异常贯穿核查
1. server.js readBody：旧catch把JSON SyntaxError改成普通Error，原样保留。仅将JSON.parse替换为公共parseJson，透传相同解析值/异常；新版本解析失败时在请求上下文记录标记。旧版本不记录，不改原错误形状。
2. server.js全局catch：仍记录e.message并返回旧{error:e.message}。新版本经sendJSON适配，HTTP500对外固定INTERNAL_ERROR和固定文案；旧版本仍原形状原文案。
3. HQ鉴权：requireAdmin -> HqError -> 数值码及HTTP状态 -> 新版本映射字符串码。旧数值码保留。
4. HQ读body：旧catch将解析错误归40000。新版本上下文中的非法JSON标记优先输出400 INVALID_JSON，旧版仍40000。
5. HQ业务handler：已知数值异常维持旧码再适配；未知异常经旧catch转50000/500，新版固定文案。旧日志仍可能记录stack/message，未按本轮范围改写。
6. H5 fail/failErr：{error}和HTTP码被适配为新信封；401/403映射鉴权码，400按VALIDATION_ERROR归类。原e.message的来源在旧catch里丢失，不能恢复精细业务码。
7. h5biz readBodyOnce：catch后回退{}，原样保留。新版parseJson标记使最终sendJSON即便原本成功，也转换为400 INVALID_JSON；不会伪装为参数必填或成功。注意这不是业务提前中断机制。
8. 外层context：仅v2增加拒绝兜底，ApiError按类型映射，未知异常固定500；普通SyntaxError视为程序错误500，只有实际JSON解析标记/显式INVALID_JSON业务异常才认定非法JSON。
9. traceId：校验后透传或生成，X-Trace-Id写响应头；完成/失败/外层异常新增事件日志记录traceId，不写载荷和凭证。finish日志绑定原请求上下文，避免异步上下文丢失。

## 已知限制（未验收为贯穿通过）
- 旧H5/管理catch将未知异常重分类为400并返回e.message时，边界无法区分业务提示与内部异常，仍可能输出内部消息；需未来模块显式类型化，不能凭文案猜。该项未解决。
- 非法JSON标记仅保证最终JSON响应；吞错后可能继续执行的业务流程未中止，不能保证无副作用。SQL/持久化路径未测试。
- errors字段仅对公共校验异常/工厂已有覆盖；旧模块未提供字段信息的400无法自动生成errors。
- 现有旧错误日志仍可能含message/stack，新增安全日志不会净化旧日志；未宣称全局日志脱敏完成。
- 普通DTO脱敏、所有时间/ID/金额字段迁移尚未进行；金额工具不接管旧计算。
- CORS旧Allow-Headers未增加X-API-Version/X-Trace-Id，因此浏览器跨域新版本请求需后续单独补齐预检契约；本轮未改变旧OPTIONS头。
- CSV直接写响应，不走JSON适配；响应头trace仍存在。CSV分支实际下载及错误分支未运行。
- 公开健康检查/元信息默认保持；v2可适配其JSON但不纳入业务覆盖率。

## 版本策略与阶段5前提
A方案：默认旧版，仅X-API-Version:2启用，API_STANDARD_V2=0强制关闭。未切默认。
阶段5切默认须另行确认：334清单随代码更新且全部目标业务接口契约通过；字符串码/DTO/分页/金额和脱敏迁移完成；CORS及客户端拦截器、OpenAPI同步；合规Node CI及真实HTTP回归完成；客户端至少两个发布周期迁移并有使用率证据；差异和已知限制清零或明确获准接受。切换须提供独立默认版本开关，不能复用当前仅关闭v2的开关声称可切默认。
切默认后的回滚方案：使用届时独立开关恢复旧默认，保留显式v2能力；本轮可用API_STANDARD_V2=0全部退回旧信封。

## 变更文件
阶段1累计：server/server.js；src/common/api-standard/index.js、money.js；scripts/api_standard.test.cjs、register_api_routes.cjs；本报告及phase-1-route-register.json。
本轮改动：index.js、server.js的parseJson接点、两份脚本、路由登记和本报告。money.js本轮未改。阶段0文件及两个原有未跟踪项未改。
无迁移SQL，无数据库或业务计算变更。

## 测试命令与结果
node --test server/scripts/api_standard.test.cjs：15/15通过（最终运行）。
node --check server/server.js：通过。
node server/scripts/register_api_routes.cjs：生成登记，334分母、4例外、0静态待确认。
node server/scripts/register_api_routes.cjs --check：通过，只读取文件并比较，无写入。
新增测试从源码提取实际sendJSON、readBody和HTTP回调，用惰性http.createServer替身捕获回调，从不调用listen；提取实际HQ handle，以内存路由夹具和真实HqError公共层验证鉴权/校验/未知异常。H5形状适配用夹具模拟，不等同所有H5业务handler回归。非法JSON包括模拟跨异步事件及吞错回退。
首次新增非法JSON测试失败（事件发射上下文与监听注册上下文不同）；已用请求WeakMap关联上下文修复，最终15项全通过。
当前 v20.20.2 运行，项目要求 ≥22.5，需在合规 CI 复跑。
未运行：真实HTTP、服务启动、数据库连接、SQL、磁盘业务写入测试、完整业务回归、真实CSV下载。不得视为通过。

## 可执行回滚（下列命令仅供审阅，未执行）
快速关闭v2（PowerShell，作用于后续由该环境启动的进程，本轮不启动）：
```powershell
$env:API_STANDARD_V2 = '0'
```
完整撤回接线，保留其他业务源码（在项目根执行）：
```powershell
$entryPath = 'E:\project\nodejs\backend\server\server.js'
$entryText = [IO.File]::ReadAllText($entryPath)
$entryText = $entryText.Replace("const API_STANDARD = require('./src/common/api-standard');", '')
$entryText = $entryText.Replace('  const adapted = API_STANDARD.adapt(code, obj);', '')
$entryText = $entryText.Replace('  code = adapted.httpStatus;', '')
$entryText = $entryText.Replace('  obj = adapted.body;', '')
$entryText = $entryText.Replace('API_STANDARD.parseJson(d, req)', 'JSON.parse(d)')
$entryText = $entryText.Replace('const server = http.createServer((req, res) => API_STANDARD.context(req, res, async () => {', 'const server = http.createServer(async (req, res) => {')
$entryText = [regex]::Replace($entryText, '\}\)\);(\r?\n\r?\n// 启动前预检：端口)', '});$1')
if ($entryText.Contains('API_STANDARD')) { throw '入口仍有API_STANDARD引用，请先核查，不删除工具' }
[IO.File]::WriteAllText($entryPath, $entryText, [Text.UTF8Encoding]::new($false))
node --check server/server.js
# 语法通过后，逐个删除明确新增的代码文件，不递归删除目录：
Remove-Item -LiteralPath @('server/src/common/api-standard/index.js','server/src/common/api-standard/money.js','server/scripts/api_standard.test.cjs','server/scripts/register_api_routes.cjs')
```
回滚保留：全部阶段0文档、phase-1-route-register.json（包括348条证据）、本报告。保留根package-lock.json和server/data/db.json.bak-*。无SQL回滚或数据回滚动作。
