# 阶段3影子迁移交付报告

## 结论与边界
本轮仅生成代码、脚本、SQL文件，并运行纯内存/临时数据测试及隔离loopback HTTP冒烟。没有执行任何SQL，没有数据库连接，没有生产进程启动，没有历史回填，没有替换金额计算，没有改变默认旧契约。全部金额开关保持默认关闭；第一轮只验证影子写入，分字段读取未启用。
商品价格未全部迁移。hqProducts[].skus[].price/listPrice仍待确认，未猜表或建表。支付落账、订单实付/结算、分润、区域代理、产品分成、合店和月结不在范围内。
阶段0/1/2/2b文档及route-register证据不变。根package-lock.json及原有db.json.bak-*未动。

## 字段映射
- skus[].listPrice（元） -> listPriceCents（分） -> skus.list_price_cents。
- activityPrices[].amount（元） -> activityPriceCents（分） -> activity_prices.activity_price_cents。
- columns[].price（元） -> priceCents（分） -> columns.price_cents。
- quotes[].amount，仅checkout -> payableAmountCents -> quotes.payable_amount_cents。
- checkout breakdown.goodsAmount -> breakdown.goodsAmountCents -> quotes.goods_amount_cents。
- checkout breakdown.discountAmount -> breakdown.discountAmountCents -> quotes.discount_amount_cents。
- checkout breakdown.listAmount -> breakdown.listAmountCents -> quotes.list_amount_cents。
每条记录currency影子写入/回填时明确CNY。SQL批次A currency可空且不带DEFAULT，不把NULL判为CURRENCY_MISMATCH。非NULL非CNY才为币种冲突。
保留所有旧元字段/旧列。JSON金额分值使用安全整数number（最大9007199254740991分）；超限报错，不切换字符串协议，不直接序列化BigInt。moneyShadow为内部版本标记，JSON持久化保留，默认API输出移除。
非货币字段（比例/折扣率/积分/次数/库存/名额）完全不进入此换算。

## 写入和读取接线
server.js：单SKU价格更新、专栏集合替换、活动价新记录；stock.syncSkuRecords：新增SKU；server/h5biz默认专栏新建：只处理新建默认记录，绝不扫描已加载历史记录回填；quoteStore.issueQuote：只处理新checkout报价。HQ专栏发布未改价格，不插入额外金额逻辑。
旧业务先按既有算法得到并写入元值，影子工具严格检查该值再生成分值，绝不回写旧金额。原round2/Math.round/折扣及报价重算规则未改。历史计算已丢失的信息无法恢复，例如旧算法已将1.005舍入为其他值，只能核对其实际存储值。
影子失败不抛到业务流程；记录错误/计数/告警，默认零失败率阈值，停止该批影子写入但旧记录仍照常保存。已有未知来源冲突不覆盖。受内部版本标记证明的正常改价可以推进影子版本，并记录SHADOW_VERSION_ADVANCED事件；手改/腐坏影子值不一致时失败。
旧API原始对象输出在sendJSON前移除影子元数据及新增分字段，防止原始SKU/专栏/快照响应无意改变。无影子内容时保留对象；未改response工厂旧默认行为。readDto受v2和分字段读取开关双重约束；本轮未切换既有商城价格展示/计算到新字段。

## SQL文件清单（只生成，未执行）
目录：server/sql/money-shadow-stage3，共28个文件。
- A_{skus,activity_prices,columns,quotes}.up.sql / .down.sql：4表分别增加/撤回新增可空BIGINT分列与无DEFAULT的可空currency；down仅涉及新增列。已有影子数据时必须先归档，优先关开关而不是删列。
- B_shadow_writers.up.sql / .down.sql：仅说明代码/配置步骤，无SQL数据写入。
- C_{skus,activity_prices,columns,quotes}.up.template.sql / .down.template.sql：逐记录参数化回填/前镜像回滚模板。含金额相关列指纹、记录ID、checkout条件与ROW_COUNT=1核查，默认以ROLLBACK结束。不是已批准的可直接生产执行文件。
- D_{skus,activity_prices,columns}.up.sql / .down.sql：经回填后零阻止差异验证后，新增非空、CNY默认值及非负/安全上限CHECK；down移除约束并恢复新增列可空，不清空数据。须确认实际MySQL版本和CHECK强制执行能力。
- D_quotes.up.BLOCKED.sql / .down.BLOCKED.sql：全文注释的阻塞草案，不可执行，原因见下节。
- 000_backup_before_A.template.sql / 000_backup_before_C.template.sql：每个目标表独立CREATE TABLE LIKE+INSERT SELECT快照模板；RUNID必须替换为批准批次，禁止覆盖旧备份。备份期间需暂停相关写入/同步并核验数量/哈希。
DDL会隐式提交，不可通过事务ROLLBACK恢复。A/C执行前必须有验证过的目标表备份或快照。生产回填前必须在隔离数据库副本演练；本轮尚未执行真实DB演练，不能用内存演练替代该门槛。
C模板的MySQL指纹基于同一SQL中的SHA2(JSON_ARRAY(相关列字符值))，需由冻结MySQL快照读取。JSON计划使用整记录SHA256，两者不同，禁止互换。C模板变量绑定、审批后的渲染及提交仍需下一轮批准，不在本轮执行。

## 报价批次D范围冲突（必须保留阻塞）
本轮只迁移checkout，非checkout currency继续NULL。对quotes整表执行NOT NULL DEFAULT CNY会要求修改范围外记录。未擅自回填其他场景，也未生成可执行的整表非空DDL。当前仅提供全文注释的checkout条件CHECK候选。
执行报价D之前必须另行确认：批准扩展非checkout的币种元数据迁移，或明确允许checkout条件约束代替整表NOT NULL。未确认前此批禁止执行。其他三个产品表的D仍按NOT NULL DEFAULT CNY计划生成，但都未执行。

## 影子核对与脚本
money-shadow-dry-run.cjs：必须显式--input，无默认生产路径；只读输入、stdout输出统计/差异/补丁计划，退出码0无阻止差异、2有阻止差异、1参数/读取错误。--apply明确拒绝，无DB驱动或应用逻辑。
```powershell
node server/scripts/money-shadow-dry-run.cjs --input <隔离JSON快照>
node server/scripts/money-shadow-dry-run.cjs --input <隔离JSON快照> --after
node server/scripts/money-shadow-dry-run.cjs --input <隔离JSON快照> --diagnostic-half-up
```
这些示例未对历史数据执行。本轮CLI只对测试创建的临时合成文件运行，并比对输入哈希/内容不变。
money-shadow-copy.cjs：仅内存副本apply/rollback演练函数，校验记录唯一性和整记录指纹，保留字段前镜像，回滚指纹不符则拒绝；没有落盘入口。
回填前阻止项：VALUE_MISMATCH、INVALID_LEGACY_AMOUNT、PRECISION_EXCEEDED、OUT_OF_RANGE、CURRENCY_MISMATCH、REVERSE_CONVERSION_MISMATCH。MISSING_SHADOW仅为待补候选，不阻止规划。
回填后（--after）MISSING_SHADOW也为阻止项。差异阈值为零，无静默覆盖、无自动精度修正。报价可选breakdown项原来不存在时保持不存在；若旧明细缺失而新值存在，则报VALUE_MISMATCH。

## HALF_UP调用边界
显式独立导出money-migration-diagnostic.fromYuanHalfUpMigration，使用整数/BigInt实现HALF_UP。允许调用方仅：money-shadow-dry-run.cjs的--diagnostic-half-up分支及money_shadow.test.cjs；测试扫描src禁止业务代码导入诊断模块。
业务影子写入只调用严格元分转换；超过两位小数拒绝，不调用诊断舍入。诊断结果不进入patches、不清除PRECISION_EXCEEDED，必须人工处理并另行确认。原money.js未改。

## 同步预检方案
mapping.js明确增加7个分值字段和currency；JSON source与SQL映射一起调整，非checkout输出新列NULL。
同步器在DELETE之前检查目标列/类型、来源字段差异、主键重复、已声明非空列的缺值。失败记录[MONEY_SYNC_TABLE_SKIPPED]并return 0，其他表继续，不执行该表DELETE。
目标表已有完整影子列时，还会只读读取目标ID/影子列，防止过期JSON快照将已有MySQL分值或currency降级成NULL；发现降级或读取失败跳过该表。正常完整的新版本改价不属于降级。
默认开关关闭且没有影子列/数据时沿用旧同步。若已施加D的NOT NULL，即使回滚了写开关，预检也会阻止NULL重建，避免DELETE后因INSERT约束失败丢表数据。
上述行为用模拟连接验证，未实际连接MySQL。同步器现有全量DELETE+INSERT仍非整体事务化；本轮没有重构这一机制。预检后其他故障导致的原有同步风险仍存在。

## 影子核对统计和差异清单
证据：phase-3-fixture-audit.json，仅合成夹具，不是历史数据或数据库核对。
- 4条在范围内记录，1条upgrade报价跳过。
- 回填前：11个MISSING_SHADOW，0个阻止差异，4条候选patch。
- 内存副本应用后：0缺失、0阻止差异；前镜像回滚还原通过。
- 冲突夹具：1个VALUE_MISMATCH（skus/conflict，预期1990分、实际1分），未覆盖。
其余币种/高精度/上限/负数/指纹冲突等通过专项测试验证拒绝，不汇总冒充生产差异。
真实JSON历史统计、真实MySQL统计与差异：未运行。

## 隔离HTTP冒烟
命令：node server/scripts/money-isolated-http-smoke.cjs。
结果：7/7断言通过；临时127.0.0.1端口，实际Node HTTP listener、生产HTTP回调/JSON工具源码和真实HQ分发器，只读内存users夹具。
验证OPTIONS204无体、允许X-API-Version、暴露X-Trace-Id、Origin策略不变、v2 GET统一响应、trace透传及401鉴权。
不import server.js的初始化过程；阻止pg/mysql/sqlite驱动导入及文件写入API；不启动同步器、不读真实db.json、不创建会话文件。临时listener已关闭。
这是隔离HTTP冒烟通过，不是完整服务启动/生产环境/浏览器联调/数据库集成通过；部署初始化仍需后续环境验证。A仍须批准、备份、实际结构预检等门槛，不能凭此直接执行SQL。

## 测试命令与结果
node --test --test-reporter=dot server/scripts/api_standard.test.cjs server/scripts/users_pilot.test.cjs server/scripts/support_pilot.test.cjs server/scripts/money_shadow.test.cjs：49/49通过。
专项16项，既有33项。包括严格换算、诊断HALF_UP、负数/精度/上限/币种/BigInt、影子双写、失败计数告警/批停、冲突不覆盖、默认旧读取、真实SKU/quote函数内存调用、JSON/SQL映射、模拟同步连接的DELETE前拦截、临时文件dry-run不变、内存指纹演练/回滚、SQL模板静态检查、诊断导入边界及D后/旧快照降级保护。
node --check对本轮改动/新增JS/CJS执行；git diff --check通过，最终结果以交付消息为准。
当前v20.20.2运行，项目要求≥22.5，需合规CI复跑。
未运行：SQL语法/执行的数据库验证、真实表版本和约束、A/C备份、历史核对/回填、真实MySQL同步、隔离DB副本演练、完整服务初始化和浏览器测试。不得视为通过。

## 变更文件
新增公共模块：money-shadow.js、money-migration-diagnostic.js、money-sync-preflight.js。
新增脚本：money-shadow-dry-run.cjs、money-shadow-copy.cjs、generate_money_shadow_sql.cjs、money-isolated-http-smoke.cjs、money_shadow.test.cjs。
修改：server.js、src/stock.js、src/quoteStore.js、src/routes/h5biz.js、src/common/api-standard/index.js、scripts/mapping.js、scripts/sync_to_mysql.js。
新增28个SQL文件；新增本报告、phase-3-environment.md、phase-3-fixture-audit.json。未改前阶段文档和路由证据。

## 回滚步骤（未执行）
1. 先将MONEY_CENTS_READ_PRODUCTS/MONEY_CENTS_READ_CHECKOUT_QUOTES设为0；本轮本来为0，不改变旧读取。
2. 将MONEY_SHADOW_WRITE_PRODUCTS/MONEY_SHADOW_WRITE_CHECKOUT_QUOTES设为0，停止后续影子写入。保留全部旧列、影子数据、JSON快照及日志。
3. 若未来已施加D，先审批执行对应D.down恢复兼容；在此之前同步预检会跳过缺影子数据的表，不能为赶进度绕过预检。
4. 已应用C的数据只能按前镜像+后指纹校验恢复，或在停写窗口从已验证表级备份/JSON快照恢复；禁止根据当前元值重新算分再覆盖回滚，禁止无指纹整表覆盖活跃数据。
5. A.down仅在新增数据已归档且确认无依赖后执行；常规回滚无需删除新列。MySQL DDL不能事务回滚，备份恢复必须在隔离副本演练。
6. 代码撤回只撤本阶段接点及模块，保留API标准/只读试点和CORS。不得git restore整文件覆盖前阶段工作。无任何SQL已执行，本轮无需实际数据回滚。

## 已知限制与后续确认
商品价格未全部迁移：hqProducts嵌套价格、代码计价目录未纳入；不动金额业务算法。
开关默认关闭，未启用新计算或新分字段读取；readDto只是受控投影能力，并非全部商城接口已经使用它。手工编辑JSON不属于接线写入，需核对脚本发现差异。
影子计数/批次事件为进程内及日志，无外部监控落库。单记录批次失败只停本批，后续新请求可开启新批，不是永久全局熔断。
报价D阻塞、数据库演练未完成、未验证部署数据库版本/结构、当前Node版本差异，均是执行前门槛。
等待用户确认后才能安排任何SQL或历史回填，本轮不执行。
