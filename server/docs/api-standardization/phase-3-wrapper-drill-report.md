# 阶段3执行器与实库演练收尾报告（2026-10-29）

目标127.0.0.1:3307/naoshang，本地假数据；MySQL8.4.9，实际Nodev24.22.0。本轮在C遇到实际SQL失败后停止，未修改原SQL、数据库/列collation或会话collation。阶段3尚未完成，不进入API推广或金额L1/L2收口。

## 新增执行器与幂等口径
scripts/money-ddl-wrapper.cjs解析ALTER TABLE中的ADD COLUMN、DROP COLUMN，按括号/引号分割多列操作。
每列先查INFORMATION_SCHEMA.COLUMNS：ADD缺列则执行；已存在且类型、可空性、默认值语义相同则跳过；定义不一致立即报错且不发该列DDL。DROP存在则执行，不存在跳过。原文件作为只读输入，拆成单列ALTER执行以处理部分完成态。
可空列的省略默认值与MySQL元数据DEFAULT NULL视为等价；不声称可以从information_schema区分原DDL是否显式写过DEFAULT NULL。
SQL本身仍不幂等；手动直跑已完成的A_skus.up.sql仍会1060。上轮真实失败证据保留在fast-drill-2026-10-29T06-35-17-255Z.json。本轮只证明执行器可重入，未把原文件改成IF NOT EXISTS。

执行器单测6/6通过：ADD缺列执行、已存在一致跳过、类型/可空/默认冲突停止、DROP缺列跳过、DROP存在执行、多操作解析/拒绝其他DDL。

## 命令与备份
```powershell
node --test --test-reporter=spec server/scripts/money_ddl_wrapper.test.cjs
node --check server/scripts/money-db-drill.cjs
node server/scripts/money-db-drill.cjs
```
实库执行器退出码1，失败阶段C。原28个SQL文件执行前后SHA256完全一致。
本轮先重新单库备份：
E:\mysql\stage3-backups\wrapper-drill-2026-10-29T06-45-19-628Z\before-wrapper-drill.sql
大小140697字节，SHA256：1d0c541025890928303daf5bce6315c2a20aad0b0a2405c72683c0e91cf3c38c。独立Get-FileHash复核一致。
mysqldump参数：--host=127.0.0.1 --port=3307 --user=naoshang --single-transaction --quick --no-tablespaces --set-gtid-purged=OFF --result-file=<上述文件> naoshang；密码仅经子进程环境传递，未输出。目录限制为当前Windows用户访问。按最新指令不做恢复验证。
PID4532查看器源码哈希仍与前次一致，连接未发现正在写入；未停止它。

## 批次A：通过
1. wrapper重跑四表正向文件：11个已存在且定义一致的新增列全部跳过。
2. wrapper执行四表down：11列删除成功。
3. 对照本轮开始时旧列集合：名称/类型/可空/默认/额外属性及行数不变。
4. 再次执行down：11个不存在列跳过，验证DROP可重入。
5. 再次正向：11列重新建立成功，恢复A完成态。
这里是四张表共11列，不是仅4列；quotes包含4个分值列和currency。
完整SHOW FULL COLUMNS前后及逐列执行/跳过记录保存在wrapper-drill-2026-10-29T06-45-19-628Z.json的A字段。
A原始首轮001→004成功及原样重跑1060的旧证据保持不动。本轮未重复制造1060。

## 批次B：已验证范围通过，事务恢复
只在演练子进程临时启用两个影子写入开关，分字段读取始终关闭，不改变服务或持久化环境配置。
真实商品双写样例：sku-adminFee-1，旧list_price='19.90'、新list_price_cents='1990'、currency='CNY'，金额来自统一影子工具。
构造CURRENCY_MISMATCH：计数failed=1、stopped=true，有SHADOW_WRITE_FAILED与SHADOW_BATCH_STOPPED告警；旧元金额UPDATE仍成功，未由影子错误阻断。
构造同步预检PRECISION_EXCEEDED：实际调用从sync_to_mysql.js提取的原writeTable，并注入真实MySQL连接。该表仅执行SHOW COLUMNS FROM skus，返回0，明确未执行DELETE。
后续activity_prices实际执行SHOW COLUMNS、目标影子读取、DELETE及INSERT，证明其他表能继续。所有B测试DML位于事务，验证后ROLLBACK，逐行对比与B前快照相同。
关闭开关后writeRecord返回disabled，旧元金额仍可UPDATE。
覆盖限制：本轮真实双写样例只验证商品SKU。报价写开关虽在子进程临时启用，但未单独执行真实报价双写；不能因此声称报价实库双写已验证。

## 批次C：dry-run通过，实库回填失败即停
读取实际四表映射成JSON金额视图，并用公共S.plan核对：scanned=65，skipped=0，MISSING_SHADOW=247，阻止差异=0。差异明细保存在本轮JSON证据，未修改旧报告中的历史统计。
开始事务、为原C模板绑定record_id、新分值和MySQL指纹后，执行UPDATE发生：
- ER_CANT_AGGREGATE_2COLLATIONS；errno1267。
- Illegal mix of collations (utf8mb4_general_ci,IMPLICIT) and (utf8mb4_unicode_ci,IMPLICIT) for operation '='。
不自动更改SQL、会话参数或列定义；停止C及后续D。
连接关闭时未提交事务回滚。随后仅只读核对：四表所有新增分值列和currency的非NULL计数均为0，没有留下部分已提交回填。A新增列仍保留。
C回填后MISSING_SHADOW归零：未完成；基于前镜像的实库指纹回滚及冲突验证：未运行。不能拿内存单测代替这些实库结果。

## 只读排序规则诊断
证据wrapper-collation-diagnosis-20261029.json：
- 当前连接collation=utf8mb4_unicode_ci。
- database默认collation=utf8mb4_unicode_ci。
- 四表id/product_id/currency字符列collation=utf8mb4_general_ci。
这些差异与原模板字符列、用户变量和指纹比较的1267错误一致。未通过额外失败SQL探测具体表达式，也未修改任何排序规则。
建议下一轮最小修复：只在本地演练执行器连接上明确对齐utf8mb4_general_ci，并先验证会话/变量collation；不改原SQL、表/列或数据库默认值。该修复及重试尚未执行，等待确认。

## 批次D：未运行
未添加CHECK、未做拒绝/通过测试、未删除CHECK。原D_quotes阻塞注释文件未改。
后续若C完成，可按本轮授权提取注释中的checkout条件CHECK作为执行器派生语句进行演练，并独立记录来源；不能称原注释文件直接执行了DDL。
本轮读取的报价全部属于checkout，后续验证非checkout不受约束时需要明确的假数据夹具；当前没有据此伪造通过结果。

## 28文件口径
原SQL文件共28个，全部哈希保持不变。A up/down已通过wrapper执行；C模板已绑定并尝试执行，但失败；D、其他未覆盖文件不计为通过。B配置注释、备份模板及D注释草案不能因可被读取或解析就记成可执行SQL验证通过。
因此“SQL全部跑通”的目标尚未达到，不能认定阶段3演练完成，也不安排生产迁移。

## 单测/语法与变更
完整纯内存回归命令：
```powershell
node --test --test-reporter=dot server/scripts/api_standard.test.cjs server/scripts/users_pilot.test.cjs server/scripts/support_pilot.test.cjs server/scripts/money_shadow.test.cjs server/scripts/money_ddl_wrapper.test.cjs
```
55/55通过（含新增6个wrapper测试）；node --check和git diff --check通过。这不改变C实库失败结论。
新增代码：money-ddl-wrapper.cjs、money_ddl_wrapper.test.cjs、money-db-drill.cjs。
新增证据：本报告、wrapper-drill-2026-10-29T06-45-19-628Z.json、wrapper-collation-diagnosis-20261029.json，以及仓库外备份。未修改已交付阶段文档、路由证据、原SQL、原有未跟踪文件或业务计算。
金额开关仅在子进程B短暂启用，最终恢复；未启用分字段读取或改变默认旧契约。当前现场为A完成态、无已提交影子数据。遇错后只做只读诊断，没有继续DDL/DML。
