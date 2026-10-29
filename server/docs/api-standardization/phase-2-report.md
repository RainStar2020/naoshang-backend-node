# 阶段2：HQ账号查询小范围试点（2026-10-29）

## 范围和行为
仅GET /api/hq/users（列表）、GET /api/hq/users/:accountId（资料详情）。未新增第三个端点，未碰H5、h5biz、金额、CSV/健康/OPTIONS。阶段0/1文档及route-register证据保持不变。
默认旧契约，只有X-API-Version:2启用。API_STANDARD_V2=0全局关闭；API_STANDARD_USERS_PILOT=0仅将这两个端点退回旧契约（即使请求头为2），其他阶段1适配行为不变。
HQ分发器匹配路由后，试点适配层校验版本/权限，直接调用一次原handler，投影同一结果；不复制数据库查询或业务筛选逻辑。列表handler共享筛选与切片，新版传入经过严格校验的paging/sort上下文。旧请求仍按旧page/pageSize解析和id升序。
权限仍仅区分admin/hq_admin与非管理员，不新增权限码体系。管理员角色可查询；无会话/过期会话401；已登录其他角色403。旧HQ readSession会将非管理员视为未登录，本轮旧版仍401，不改变。

## 分页、排序及DTO
新版pageNum默认1、最大1000000；pageSize默认20、最大100。参数须为正整数文本；小数、负数、0、越界和尾随字符返回400 VALIDATION_ERROR + errors。page仅对旧版有效，新版只读pageNum。
排序白名单accountId/nickname/createdAt；方向asc/desc；默认accountId asc；账号按字符串排序、昵称按字符串排序、时间按ISO字符串排序。相同排序值沿用原数据顺序，不执行动态字段读取或SQL拼接。筛选keyword/frozen/tier复用旧逻辑，本轮未重定义其业务语义。
新版分页只包含pageNum/pageSize/total/totalPages/list；空列表[]；总数0时totalPages=0。旧summary保留在旧版，不在新版页结构中额外输出。
资料白名单：accountId、displayId、nickname、phone、tier、tierLabel、isFrozen、entitlementState、createdAt、lastLoginAt、version、allowedActions。冻结布尔从frozen映射isFrozen。时间统一ISO Z，无效时间null。ID为字符串；已被Number损失精度的ID拒绝为安全500，不能伪造修复；字符串大整数保真。
详情members显式映射memberId/displayName/memberLevel/displayId/storeId，ID字符串；无孩子[]。不输出旧内部note/audit；不输出password/token/email字段。手机号掩码；昵称/孩子名中的11位数字及邮箱样式也脱敏。没有完整身份证字段进入白名单。新资料不从原始db对象扩散字段。
新查询不存在账号返回404 NOT_FOUND，不把它改成200 null。response:null成功只验证公共工厂及空投影能力，未人为新增有该语义的业务端点。

## 新旧对照
旧列表：
```json
{"code":0,"message":"ok","data":{"items":[],"total":0,"page":1,"pageSize":20,"summary":{"total":0,"frozen":0,"active":0}}}
```
新列表（X-API-Version:2）：
```json
{"status":1,"response":{"pageNum":1,"pageSize":20,"total":0,"totalPages":0,"list":[]}}
```
旧详情：{code:0,message:"ok",data:{profile:{accountId,phone完整,frozen,note,...},members:[],audit:[]}}。
新详情：{status:1,response:{profile:{accountId:"9007199254740993",phone:"138****5678",isFrozen:false,createdAt:"2026-10-29T00:00:00.000Z",...},members:[]}}；完整示例见phase-2-users.openapi.json。
新校验失败：
```json
{"status":0,"code":"VALIDATION_ERROR","message":"分页参数不合法","response":null,"errors":[{"field":"pageSize","message":"必须为1至100的整数"}]}
```
新权限失败：HTTP403 + {status:0,code:"FORBIDDEN",message:"需要总部后台管理员权限",response:null}。
旧HQ错误：{code:数值,message:文案,data:null}，不删除旧码。

## 错误码表
40000 -> VALIDATION_ERROR / HTTP400；40100 -> UNAUTHENTICATED / HTTP401；40300 -> FORBIDDEN / HTTP403；40400 -> NOT_FOUND / HTTP404；50000 -> INTERNAL_ERROR / HTTP500。
公共40900/40901/40902/40903映射保留，但本试点只读，不制造冲突场景。
公共校验异常提供errors；未知异常固定“服务器内部错误，请稍后重试”，不输出原异常、SQL或堆栈。试点绕开旧catch重分类链路，但不改写旧catch。

## 前端拦截器约定
1. 先读取HTTP状态：401走登录失效、403权限不足、400按字段errors提示、404不存在、500通用系统错误。非JSON传输错误单独处理。
2. 仅在启用v2且响应含数字status时按统一契约解析；status=1读取response（可null），不读取message；status=0校验response===null，按code业务分支。
3. code为稳定分支依据；message只作提示，不能匹配文案决定跳转。errors用于字段展示。记录响应头X-Trace-Id用于排查，不记录token或完整业务载荷。
4. 模块关闭会退回旧HQ信封，因此迁移客户端需兼容{code:0,message,data}与旧数值错误。可以按code是否为number、是否存在data识别；不得把旧code:0当成新status。
5. 浏览器跨域预检目前仍不允许自定义版本/trace请求头，也未Expose X-Trace-Id。小程序/同源或服务端可使用；浏览器跨域试点需后续单独授权修改CORS，不宣称已可用。

## 文件变更
新增：src/common/api-standard/users-pilot.js；scripts/users_pilot.test.cjs；docs/api-standardization/phase-2-users.openapi.json；本报告。
修改：src/common/api-standard/index.js（公共工厂生成的信封用WeakSet标记，避免试点二次包裹；排序错误field准确标识sortOrder）；src/routes/hq/index.js（新增两端点版本试点委托）；src/routes/hq/modules/users.js（共享分页/排序接点）；scripts/api_standard.test.cjs（源码提取HQ测试注入新增依赖）。
server.js本轮未改。money.js本轮未改。阶段0/1文档及route-register未改，旧证据行号作为历史快照保留，勿用旧生成器覆盖它。
无迁移SQL、无表结构/ORM/业务计算变更。

## 验证
node --test server/scripts/api_standard.test.cjs server/scripts/users_pilot.test.cjs：23/23通过（最终复跑见交付消息）。
node --check server/server.js、node --check server/src/common/api-standard/users-pilot.js、node --check server/src/routes/hq/index.js、node --check server/src/routes/hq/modules/users.js：通过。
git diff --check：通过。
测试直接调用从源码提取的实际HQ分发函数与真实users handlers，使用内存req/res/session/数据夹具，不加载server入口、不监听端口，persist和readBody配置为一旦调用即报错。验证新旧并行、鉴权/权限、404、校验errors、空列表、模块及全局开关、trace响应头、DTO、金额工具既有回归。
OpenAPI验证仅包括JSON解析、本地ref解析、两个端点和排序枚举一致性；未运行完整OpenAPI规范校验器或生成客户端。
当前 v20.20.2 运行，项目要求 ≥22.5，需在合规 CI 复跑。
未运行：真实HTTP、真实浏览器/CORS、服务启动、数据库连接、SQL、磁盘业务写入、生产/全量业务回归。不得视为通过。

## 回滚（命令未执行）
按模块关闭新契约，保留全部代码和其他模块行为：
```powershell
$env:API_STANDARD_USERS_PILOT = '0'
```
全局关闭阶段1/2新版契约：
```powershell
$env:API_STANDARD_V2 = '0'
```
环境变量是目标进程配置；以上设置作用于当前PowerShell的后续子进程，不会变更已运行进程。本轮不启动或重启任何服务，部署时由运行配置应用。
重新启用模块（仍须请求头2且全局未关闭）：
```powershell
Remove-Item Env:API_STANDARD_USERS_PILOT -ErrorAction SilentlyContinue
```
代码级回滚只撤回本报告列出的阶段2差异：先删除hq/index.js的USERS_PILOT require与试点handle接线；users.js恢复L.readPaging(ctx.query)和原id排序；恢复index.js的未标记工厂及原adapt（保留阶段1全部功能）；旧测试移除USERS_PILOT注入；再删除users-pilot.js及users_pilot.test.cjs。保留本阶段文档/阶段0/1证据。禁止git restore整文件覆盖阶段1成果，不删除原有未跟踪文件。无需SQL或数据回滚。

## 已知限制及后续门槛
仅2/334个端点族做模块级DTO/分页试点（约0.60%），不能把全局适配信封等同全量DTO迁移。此次未新增/删除路由，历史分母334保持。
未引入细粒度RBAC，allowedActions沿用旧业务结果；403仅表示已登录非管理员。未测试真实会话代理/加密持久化，仅内存夹具。
HQ旧ensureCollections仍会初始化内存空集合，不涉及磁盘持久化；本轮没有业务写操作测试。
未贯穿的旧H5错误及吞JSON问题保持阶段1已知限制；本试点不经过这些链路。
未扩大试点、未进入阶段3，等待用户确认。
