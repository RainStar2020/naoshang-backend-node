# 按模块统一API返回：交付报告

## 完成范围与覆盖率
按确认的14个模块接入所有现有GET处理器，不再维护逐端点白名单或新增端点迁移登记。覆盖率改为已接入只读模块数/应接入只读模块数：14/14=100%。这是已接入能力，不是开关开启率，也不代表全部26模块/全部API已迁移。
现有写入口、12个例外模块、H5/h5biz旧捕获链、主入口混合管理及CSV/健康/OPTIONS协议例外不动。没有数据库连接、SQL执行、回填、金额计算修改或旧catch重写；前轮SQL问题不在本次任务范围，未继续处理。
每个模块的变更文件、三项测试名称、开关、兼容及关闭回滚命令见module-response-rollout.json（仅模块清单，不含端点登记）。

## 模块与开关（全部默认OFF）
users：API_STANDARD_USERS_PILOT
course：API_STANDARD_COURSE_PILOT
announcements：API_STANDARD_ANNOUNCEMENTS_PILOT
materials：API_STANDARD_MATERIALS_PILOT
softwareCards：API_STANDARD_SOFTWARE_CARDS_PILOT
quotas：API_STANDARD_QUOTAS_PILOT
delivery：API_STANDARD_DELIVERY_PILOT
staff：API_STANDARD_STAFF_PILOT
stores：API_STANDARD_STORES_PILOT
training：API_STANDARD_TRAINING_PILOT
invitations：API_STANDARD_INVITATIONS_PILOT
transfers：API_STANDARD_TRANSFERS_PILOT
support：API_STANDARD_SUPPORT_PILOT
trace：API_STANDARD_TRACE_PILOT

每个模块仅在开关为字符串1且X-API-Version:2时返回新信封；无请求头、开关未设置或为0仍返回旧HQ信封。API_STANDARD_V2=0继续关闭存量新版适配。本轮未在运行服务中设置任何开关。
兼容说明：users/support前期试点曾只凭header2默认启用，现在纳入同样的默认OFF模块门控；已有显式设为1的部署不受影响，未配置开关的header2客户端需先配置后再启用。这不改变无header2的默认旧契约。
users/support既有已验收的DTO、分页、脱敏及support详情RESOURCE_NOT_FOUND行为保留于统一模块门控之后，其余只读部分共享通用工厂。没有把它们替换回旧DTO。
其他模块原业务返回值不变，仅从data迁移到response；不顺手改内部分页、字段、敏感信息策略或业务筛选。课时/名额是非货币整数，不走金额工具。

## 新旧响应
旧成功：{code:0,message:"ok",data:结果或null}；旧失败：{code:数值旧码,message:提示,data:null}。
新版成功：{status:1,response:结果或null}，无顶层message；新版失败：{status:0,code:字符串码,message:提示,response:null}，校验错误带errors。
公共旧码映射保留；未知异常固定公开文案，校验缺少字段元数据时使用request而非解析message猜字段。没有改旧catch，默认旧错误文案/状态保持。

## 例外模块
金额相关：products、orders、coupons、payments、revenue、withdrawals、partners、costore。
读时隐式状态变更：auth、columns、activationCodes、members。
上述模块和所有存量非GET接口不由本次只读适配器处理。原有全局传输层行为保持，不把既有包壳当作完成模块迁移。

## 新增接口与CI，不单独登记
现有14模块中新增GET自动进入该模块的工厂出口，不需要新增迁移清单或逐路由白名单。
新增写接口、例外模块的新接口、全新模块接口必须在正常路由对象上声明apiStandard:true；这不是额外端点登记。编译器保留该标记，统一handleNew在调用一次业务handler后通过工厂返回。新增接口无历史格式，标记为factory-only的路由默认走新工厂；存量路由不自动补标记。
这些标记不会迁移任何现有写接口。需要旧HQ复杂幂等/审计上下文的新写业务仍应先设计其业务接线，不能因为工厂检查通过就认为写业务已实现或获准执行。

CI检查：scripts/check_api_response.cjs，从Git base与当前注册模块比较，禁止新增接口绕过工厂；拒绝模块直接访问res/response或sendJSON出口；拒绝向旧main/H5分发器增加路由条件/动作别名。分析临时比较路由键，不输出或维护端点登记文件。
已有写接口和例外按基线保留，不因未来新增接口而自动扩张豁免。注册模块身份必须正确，以免落到错误策略。
本地默认base=HEAD，CI使用PR base SHA或push before SHA；初始推送无有效before时使用HEAD，无法用不存在的历史版本检查新增差异。静态检查是仓库约定校验，不是能证明任意动态JavaScript都不绕过的安全分析器。

GitHub Actions：.github/workflows/api-response-contract.yml，Node24、完整Git历史，忽略依赖生命周期脚本且不生成lockfile，然后运行检查与纯内存测试。未在GitHub远端触发，本轮仅验证同等本地命令。

## 每模块只验证三件事
scripts/api_module_policy.test.cjs以模块遍历生成三项契约测试：
1. 工厂输出正确，业务结果与旧data一致。
2. 默认旧契约不变（包括模块未启用时header2回退）。
3. header2与模块开关共同生效，单模块可关闭。
共14×3=42项模块检查；另有通用工厂、例外/新接口边界与CI规则单测，不再为扩大模块范围新增端点逐项登记或逐项测试要求。
已有试点测试保留作历史兼容回归，本轮额外运行过，但新的CI入口不要求扩展这些旧端点制品。历史端点覆盖率文档保持原样，不再作为现行覆盖率。

## 命令和实际结果
```powershell
npm run check:api-response --prefix server
npm run test:api-response --prefix server
```
结果：Git基线检查通过（14只读模块、12例外模块）；CI本地入口65/65测试通过，其中42项是模块三件事。
另已额外执行之前的users/support/readonly-batch兼容回归，合计92/92通过；这是一次兼容核查，不改变新推进方式。
本轮新增/改动JS/CJS执行node --check，git diff --check通过（最终结果见交付消息）。实际Nodev24.22.0。
未运行：GitHub远端CI、真实HTTP、服务启动、数据库/SQL/回填、真实部署环境与浏览器联调。模块probe使用真实只读handler、提取的HQ分发器和内存夹具，持久化回调一旦调用即失败；不加载server初始化。

## 变更文件
新增：
- src/common/api-standard/module-policy.js：14模块策略和模块/分发层例外。
- scripts/api_module_policy.test.cjs：模块三项契约。
- scripts/check_api_response.cjs、api_response_ci.test.cjs：新接口与出口CI检查及测试。
- .github/workflows/api-response-contract.yml。
- 本报告及module-response-rollout.json。
修改：
- src/common/api-standard/readonly-batch.js：模块级GET选择、统一门控、保留users/support已验收适配、factory-only新接口出口。
- src/routes/hq/index.js：集中调用统一出口、保留新路由factory元数据；旧catch原样。
- server/package.json：新增CI检查与测试命令，不运行本地安装，不改lockfile。
- 旧试点测试脚本：为显式开关适配夹具；历史9接口测试固定其原模块范围，避免把历史覆盖率制品当现行登记。
- generate_readonly_batch_artifacts.cjs：固定历史批次的三个模块，避免运行后误把新14模块写入旧制品；本轮未运行该历史制品生成器。
全部14个业务模块handler文件未修改；金额/数据库脚本未修改。阶段0/1/2/2b/3已交付文档、路由证据、根package-lock.json和db.json.bak-*未动。

## 按模块回滚
每个模块对应独立环境变量，设为0即可关闭，例如：
```powershell
$env:API_STANDARD_STAFF_PILOT = '0'
```
其余13个模块不受影响。每个模块具体关闭命令都列于module-response-rollout.json。shell设置作用于相关进程配置，不会改变已经运行的进程；本轮没有重启或修改任何运行进程。
全局回退存量新契约仍可使用API_STANDARD_V2=0。factory-only的新接口无旧格式，不应依赖这个开关生成不存在的旧契约。
若撤回本次代码，应只撤本次集中门控/新接口接线及policy、测试、CI命令/工作流，恢复此前USERS/SUPPORT/三模块接线；不要整文件git restore覆盖前阶段成果。不需要任何SQL或数据回滚。

## 完成边界
14/14为已批准只读模块接入完成。写入口、金额模块、隐式写GET及H5旧链路仍是例外；全项目响应、分页或脱敏并未因此全部完成。没有扩张到数据库或旧catch改造。
