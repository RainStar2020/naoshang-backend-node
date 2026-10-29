# API只读返回统一：批次01交付报告

本轮仅接入顶层响应工厂及错误映射，不处理前轮金额/SQL问题。不连接数据库、不执行SQL、不回填、不启动服务、不改金额计算或旧catch。默认旧契约保持；三个新模块必须同时显式开关=1和X-API-Version:2才启用。

## 端点清单与定位
全部method=GET，来自原phase-1-route-register.json的334个JSON端点族：
- /api/hq/materials — server/src/routes/hq/modules/materials.js:39。
- /api/hq/materials/catalog — 同文件:62。
- /api/hq/materials/:materialId — 同文件:85。
- /api/hq/announcements — server/src/routes/hq/modules/announcements.js:39。
- /api/hq/announcements/catalog — 同文件:61。
- /api/hq/announcements/:announcementId — 同文件:75。
- /api/hq/course/entitlements — server/src/routes/hq/modules/course.js:43。
- /api/hq/course/catalog — 同文件:73。
- /api/hq/course/entitlements/:entitlementId — 同文件:95。
行号指实际async handler；完整绝对路径、旧/新形态和模块开关登记在batch-readonly-01-register.json。

全部旧形态：成功{code:0,message:"ok",data:结果}；失败{code:数值旧码,message:提示,data:null}，已有extra照旧。
全部新形态：成功{status:1,response:结果或null}，顶层无message；失败{status:0,code:稳定字符串,message:提示,response:null}；校验失败附errors数组。
业务handler只调用一次，返回值直接交给ApiResponse；没有复制查询/筛选/计价逻辑。本批不统一业务DTO内部命名、排序或分页：items/total/page/pageSize/summary仍原样置于response，避免扩大到分页改造。

## 示例（完整9组见batch-readonly-01-examples.json）
成功：
```json
{"code":0,"message":"ok","data":{"items":[],"total":0,"page":1,"pageSize":20,"summary":{"total":0,"online":0}}}
```
```json
{"status":1,"response":{"items":[],"total":0,"page":1,"pageSize":20,"summary":{"total":0,"online":0}}}
```
失败（未登录HTTP401）：
```json
{"code":40100,"message":"未登录或 token 已失效","data":null}
```
```json
{"status":0,"code":"UNAUTHENTICATED","message":"未登录或 token 已失效","response":null}
```
校验失败（HTTP400，受控异常夹具示例，不是新增keyword规则）：
```json
{"code":40000,"message":"参数不合法","data":null,"errors":[{"field":"keyword","message":"格式不正确"}]}
```
```json
{"status":0,"code":"VALIDATION_ERROR","message":"参数不合法","response":null,"errors":[{"field":"keyword","message":"格式不正确"}]}
```
旧异常没有字段元数据时，只使用全局field=request，绝不解析message猜字段。上述GET现有参数策略不变；测试没有为了制造400而增加参数限制。
成功空结果null/undefined通过工厂归一为response:null的夹具验证；实际详情不存在仍404，不改成200 null。真实空列表保持items:[]。

## 错误码及权限
40000 -> VALIDATION_ERROR / HTTP400，errors来自明确元数据，缺失时field=request。
40100 -> UNAUTHENTICATED / HTTP401。
40300 -> FORBIDDEN / HTTP403。
40400 -> NOT_FOUND / HTTP404。
40900/40901/40902/40903 -> CONFLICT/VERSION_CONFLICT/IDEMPOTENCY_CONFLICT/QUOTA_EXCEEDED，公共映射保留，本批不制造写冲突场景。
50000和未知异常 -> INTERNAL_ERROR / HTTP500，固定公开文案，不回传stack、SQL或内部异常消息。
旧码未删除。权限沿用admin/hq_admin角色边界；新契约区分已登录非管理员403，默认旧HQ仍将该会话视为40100。未新增细粒度RBAC。

## 开关、前端和回滚
默认未设置即OFF：
- API_STANDARD_MATERIALS_PILOT。
- API_STANDARD_ANNOUNCEMENTS_PILOT。
- API_STANDARD_COURSE_PILOT。
必须值为字符串1且X-API-Version:2才启用；任意0/未设置均不启用。API_STANDARD_V2=0仍全局关闭。
本批没有修改既有USERS/SUPPORT模块开关的默认策略，也没有在运行服务中开启任何开关。
兼容细节：阶段1通用传输适配曾能为这些接口的header2请求包壳；本批注册为默认关闭模块后，header2但未开模块开关会返回旧HQ形态。这是本批要求的模块回退策略，前端必须识别双格式；无header2的默认契约始终不变。
前端拦截器顺序：先HTTP状态，再数字status，再字符串code分支；message仅展示。status=1读response且允许null；status=0要求response:null，errors用于字段展示；X-Trace-Id用于定位，不记录凭证。模块关闭则按旧数值code/data处理，不能把旧code:0当成status。
按模块关闭（仅示例，本轮未应用到任何服务）：
```powershell
$env:API_STANDARD_MATERIALS_PILOT = '0'
$env:API_STANDARD_ANNOUNCEMENTS_PILOT = '0'
$env:API_STANDARD_COURSE_PILOT = '0'
```
单独关闭其中一个不会影响另两个。环境变量仅作用于相应进程配置，当前shell赋值不代表改变了已运行服务；本轮不启动/重启。
代码回滚：仅撤hq/index.js的READONLY_BATCH require/handle两行，保留USERS/SUPPORT接线；再移除本轮新helper、测试/生成器，并恢复三份旧测试的新增依赖注入。保留本批证据文档。不要整文件git restore覆盖前阶段成果。无SQL或数据回滚。

## 覆盖率与未迁移清单
固定分母334。以前接入且属于该基线的4个端点：users列表/详情、support/tickets列表/详情。
本批新增9个，累计13/334=3.89%。这些是已接入模块能力，包含当前默认关闭的9个，不能将其称为默认已开启或生产已验证。全局transport包壳不能算完整模块迁移。
GET /api/hq/support/profile为阶段2b新增，不在原334内，明确不计入此分母。
剩余321个逐项清单及原因见batch-readonly-01-coverage.json：包括写/动作端点、本批排除的主入口/H5捕获链、需独立核查的金额/订单相关查询，以及尚待审查的其他只读端点。未把跳过项记为通过。
原路由证据SHA256另存于覆盖率文件；测试核对原文件未改变。未新增/删除任何路由。

## 下一批拟迁移7个（只提案，未改）
GET /api/hq/staff
GET /api/hq/staff/catalog
GET /api/hq/staff/:staffId
GET /api/hq/training/balances
GET /api/hq/training/feedback
GET /api/hq/training/catalog
GET /api/hq/training/members/:memberId
下一批仍需先核查敏感字段、读写边界与课时整数语义；不把课时当金额，不自动推进。

## 文件与验证
新增代码：src/common/api-standard/readonly-batch.js；scripts/readonly_batch.test.cjs；scripts/generate_readonly_batch_artifacts.cjs。
修改：src/routes/hq/index.js仅增加新模块接线；scripts/api_standard.test.cjs、users_pilot.test.cjs、support_pilot.test.cjs仅为源码提取测试注入新依赖。三个业务模块文件、旧catch、金额代码、数据库脚本未改。
新增制品：本报告及batch-readonly-01-register/examples/errors/coverage/openapi.json。
阶段0/1/2/2b/3已交付文档和路由证据、根package-lock.json及db.json.bak-*未动。

实际执行：
```powershell
node --test --test-reporter=spec server/scripts/readonly_batch.test.cjs server/scripts/api_standard.test.cjs server/scripts/users_pilot.test.cjs server/scripts/support_pilot.test.cjs
node --check server/src/common/api-standard/readonly-batch.js
node --check server/src/routes/hq/index.js
node --check server/scripts/readonly_batch.test.cjs
node --check server/scripts/generate_readonly_batch_artifacts.cjs
git diff --check
```
结果：42/42通过（本批9项、既有33项）；所有上述语法检查及diff检查通过。Node实际v24.22.0。
测试直接调用真实只读handler与提取的HQ分发器，内存req/res/session/db，验证一次handler调用、旧data与新response相等、默认关闭/单模块回退/全局关闭、401/403/404、受控校验异常、未知异常固定文案、空列表、空结果工厂、traceId、业务夹具未变、覆盖率及本地OpenAPI引用/示例一致性。新测试确认未加载mysql2/pg/ORM模块。
未运行：真实HTTP/服务启动、数据库、SQL、回填、真实数据DTO审计、完整OpenAPI规范校验器、前端实际联调。以上均不视为通过。
本批只统一信封；现有业务DTO/审计字段没有顺手重写或全局脱敏。旧分页宽松解析/默认值继续沿用，不宣称已完成全项目分页或敏感字段规范。
