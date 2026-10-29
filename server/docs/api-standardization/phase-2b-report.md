# 阶段2b：客服只读扩展与前端前置检查（2026-10-29）

## 范围与端点
本轮三个试点：
- GET /api/hq/support/profile：新增只读可选管理员资料，按当前session.adminId查hqAdmins；旧admin会话无adminId时使用admin。无记录成功返回null，不播种、不回退其他管理员、不持久化。
- GET /api/hq/support/tickets：已有列表只读扩展；复用keyword/status/category筛选及一次原handler结果，增加新版严格分页/排序/DTO。
- GET /api/hq/support/tickets/:ticketId：已有详情只读扩展；字符串ID、时间和文本脱敏，缺失404 RESOURCE_NOT_FOUND。
新增模块开关API_STANDARD_SUPPORT_PILOT=0。默认旧契约不变，显式X-API-Version:2才启用；API_STANDARD_V2=0仍全局关闭。
新增注册路由仅profile一个；另两个是既有路由的版本适配。历史分母334不改写，新增delta记录当前335；累计DTO试点5个。证据见phase-2b-route-delta.json。阶段0/1/2文档和旧route-register保持不变。

## CORS静态检查及最小修改
原sendJSON及OPTIONS仅允许Content-Type,Authorization；无Access-Control-Expose-Headers，跨域前端不能使用版本头或读取trace。
现公共corsHeaders统一供sendJSON、OPTIONS及v2外层异常兜底使用：
- Allow-Origin仍为*（沿用原值，未添加来源或凭证策略）。
- Allow-Methods仍为GET,POST,OPTIONS。
- Allow-Headers仅从Content-Type,Authorization增加X-API-Version。
- 新增Expose-Headers: X-Trace-Id。
未添加Allow-Credentials、未开放其他方法、未放宽Origin策略。X-Trace-Id自定义请求头不在新增允许范围；跨域前端本轮使用服务端生成traceId并读取响应头，不主动发送该请求头。
OPTIONS仍由主入口最先处理：204，无响应体、不套业务信封；新旧版本都如此。JSON的status/body不受CORS头补充影响。
CSV直接写响应不纳入本轮CORS或信封试点。

## 新旧契约示例
profile无记录：旧默认HTTP200 {code:0,message:"ok",data:null}；新版HTTP200 {status:1,response:null}。该路径是本轮新增，不存在需保持的历史资料响应。
profile有记录新版：
```json
{"status":1,"response":{"adminId":"9007199254740993","displayName":"客服管理员","phone":"138****5678","email":"s***@example.com","createdAt":"2026-10-29T00:00:00.000Z","updatedAt":null,"isActive":true}}
```
旧工单列表：{code:0,message:"ok",data:{items:[],total:0,page:1,pageSize:20,summary:{...}}}。
新版空列表：
```json
{"status":1,"response":{"pageNum":1,"pageSize":20,"total":0,"totalPages":0,"list":[]}}
```
新版详情：{status:1,response:{ticket:{ticketId:"9007199254740993",accountId:"12345678901234567",createdAt:"2026-10-29T00:00:00.000Z",...},messages:[]}}。
新版资源缺失：HTTP404 + {status:0,code:"RESOURCE_NOT_FOUND",message:"请求的资源不存在",response:null}；旧详情仍404 + {code:40400,message:原文案,data:null}。
新版校验错误：HTTP400 + {status:0,code:"VALIDATION_ERROR",message:提示,response:null,errors:[{field:"sortBy",message:"排序字段或方向不允许"}]}。

## 分页/筛选/排序和DTO
pageNum默认1、上限1000000；pageSize默认20、上限100；正整数文本严格校验，越界不截断。page是旧版参数，新版用pageNum。
排序白名单ticketId/createdAt/status，方向asc/desc；默认ticketId desc，保持旧列表默认降序。ID按字符串排序、时间按ISO字符串排序；不透传未知属性。keyword/status/category保留原筛选语义；未知筛选值可能为空列表，不新增业务枚举约束。
列表结果为pageNum/pageSize/total/totalPages/list；移除新版页结构中的旧summary，旧版继续保留。
新profile白名单adminId/displayName/phone/email/createdAt/updatedAt/isActive；无password/token/原始管理员对象。
新ticket白名单ticketId/accountId/category/status/subject/assigneeId/createdAt/updatedAt/version/allowedActions；messages白名单messageId/ticketId/senderRole/senderId/content/createdAt。ID显式字符串，时间ISO Z；11位数字手机号、邮箱样式文本脱敏。不使用对象展开输出原始业务记录。非法/已失精度的数值ID返回安全500，不伪造精度恢复。
旧列表及详情DTO/错误形状保留；同一原handler调用一次，只有经过校验的apiPilot上下文影响新分页/排序。

## 错误码映射和前端拦截器
40000 -> VALIDATION_ERROR / 400；40100 -> UNAUTHENTICATED / 401；40300 -> FORBIDDEN / 403；50000 -> INTERNAL_ERROR / 500。
40400仅在本support试点映射RESOURCE_NOT_FOUND / 404；不修改阶段2 users的NOT_FOUND，也不删除旧HQ码。
未登录/过期401；已登录非管理员403。旧版非管理员仍被HQ视为未登录401，不改变旧行为。没有新增细粒度RBAC。
字段校验提供errors；未知异常对外固定“服务器内部错误，请稍后重试”，不会返回原SQL、类名或堆栈。
拦截器顺序：先HTTP状态，再新信封status，再code业务分支；message只用于展示。status=1读取response，允许null；status=0必须response:null。errors定位表单字段；记录X-Trace-Id即可，禁止记录凭证/完整载荷。
模块关闭时两个既有端点及新profile退回旧HQ信封，迁移前端须同时识别数值code+data的旧格式；新码为字符串，不能靠message或旧code:0猜新status。

## 文件变更
新增：src/common/api-standard/support-pilot.js；scripts/support_pilot.test.cjs；docs/api-standardization/phase-2b-support.openapi.json、phase-2b-route-delta.json、本报告。
修改：server.js（仅两处CORS接点）；src/common/api-standard/index.js（公共CORS配置及外层错误CORS）；users-pilot.js（只导出现有session/id/label/iso供复用）；routes/hq/index.js（新模块委托）；routes/hq/modules/support.js（新增只读profile、共享分页排序接点）；scripts/api_standard.test.cjs和users_pilot.test.cjs（提取式测试注入新增委托依赖）。
无SQL/ORM/金额变更，money.js未改。两个指定原有未跟踪项未动。

## 验证结果
node --test --test-reporter=dot server/scripts/api_standard.test.cjs server/scripts/users_pilot.test.cjs server/scripts/support_pilot.test.cjs：33/33通过。
node --check server/server.js、src/common/api-standard/index.js、support-pilot.js、users-pilot.js、src/routes/hq/index.js、src/routes/hq/modules/support.js：通过（各路径带server/前缀）。
git diff --check：通过。
覆盖：新旧并行、空profile=null且不播种、空列表、筛选、分页边界/非法值、非法排序字段/方向errors、401/403/404/500、字符串ID、ISO、手机号邮箱脱敏、trace、独立/全局开关、support关闭不影响users、实际OPTIONS回调204/CORS配置。
测试通过源码提取实际HQ分发器、实际server sendJSON/OPTIONS回调并调用真实只读handler；req/res/session/db均内存夹具。没有加载server入口，没有listen，persist/readBody一旦被调用即测试失败。只读前后对业务集合进行快照比对。旧ensureCollections的内存空集合初始化沿用，未涉及磁盘写入。
OpenAPI已做JSON解析、本地ref解析、端点数和排序枚举一致性、null schema校验；未运行完整规范校验器或生成客户端。
当前 v20.20.2 运行，项目要求 ≥22.5，需在合规 CI 复跑。
未运行：真实HTTP、浏览器预检/读取响应头、服务启动、数据库、SQL、磁盘业务写入测试、全量生产业务回归。均不作为本轮通过依据。

## 真实HTTP后续隔离计划（未执行）
经用户另行授权后，在Node>=22.5、临时端口、独立临时数据副本、禁用MySQL/PG连接及同步器的隔离进程验证：GET默认/v2、缺档profile、401/403/404、分页错误；用指定Origin和Access-Control-Request-Headers:X-API-Version发送真实OPTIONS；断言204无体、原Origin策略、Allow-Headers及Expose-Headers；浏览器读取X-Trace-Id；关闭模块后复核旧形状。不调用写接口。该计划不能视为已验证环境隔离或已通过HTTP测试。

## 模块回滚（下列命令未执行）
```powershell
$env:API_STANDARD_SUPPORT_PILOT = '0'
```
只关闭本轮三个端点的新契约；阶段2 users试点不受影响。新profile路由仍存在，以旧HQ形状返回；不会删除档案。
全局关闭v2：
```powershell
$env:API_STANDARD_V2 = '0'
```
恢复模块（仍要求请求头2且全局未禁用）：
```powershell
Remove-Item Env:API_STANDARD_SUPPORT_PILOT -ErrorAction SilentlyContinue
```
环境变量设置作用于后续子进程，现有运行进程由部署配置应用；本轮不启动/重启服务。
CORS独立回滚：将corsHeaders的Allow-Headers恢复Content-Type,Authorization，删除Expose-Headers字段；保留原Origin/Methods和OPTIONS204。无需回滚任何业务数据。
完整代码撤回：先移除hq/index.js SUPPORT_PILOT require/handle行，再撤回support.js新增profile路由及apiPilot分页/排序差异（恢复L.readPaging及原id降序），移除新support-pilot和测试；必要时撤回CORS调用及帮助函数、复用函数导出与测试注入。保留阶段0/1/2源码成果和全部证据文档；不得git restore整文件误覆盖前阶段，不删除根package-lock.json或db.json.bak-*。
无SQL/数据回滚。

## 已知限制与停止边界
管理员角色边界沿用，无细粒度权限；真实会话持久化和生产资料可用性未验证。不存在的profile仅表示没有匹配档案，不代表自动创建或注销会话。
文本脱敏是字段投影及手机号/邮箱样式处理，不等同任意自由文本的完整敏感内容识别。
真实HTTP和浏览器CORS仍待隔离环境验证；静态CORS允许项通过不等同浏览器联调通过。
旧H5捕获链及非法JSON吞错限制保持，未扩大到这些路径；未进入阶段3金额。
