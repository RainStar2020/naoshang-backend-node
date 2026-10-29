# 阶段3快速实库演练：失败即停报告

执行时间：2026-10-29T06:35:17Z（北京时间14:35:17）。
目标：127.0.0.1:3307/naoshang，本地假数据；MySQL8.4.9；Node实际v24.22.0。
结论：批次A四个正向SQL首轮成功；原样重跑首文件发生1060重复列错误，按用户要求停止当前批并保留现场。阶段3未完成，不把剩余文件记为通过，不执行生产迁移。

## 最小前置
PID4532命令行：D:\nvm\v20.20.2\node.exe server.js。当前入口源码E:\mysql\viewer\server.js的SHA256与前次只读审查一致：29d64edd9b8f1c4c45462db81ebcba552959fdead5efa62f665ff34e35539203。
MySQL连接ID24，naoshang用户，localhost:49172，DB=naoshang，Sleep563秒，INFO=NULL。是本地数据库查看器，正常代码路径未发现DELETE+INSERT同步或目标表写入，故按本轮授权直接继续。未停止进程、未KILL连接；数据库账号可写这一既有限制仍保留。

新备份：
E:\mysql\stage3-backups\fast-drill-2026-10-29T06-35-17-255Z\naoshang-before-fast-drill.sql
大小137342字节；SHA256：3ba18c200e6259b31fb5b00b6768d1cc61f96dd494877f8f417bf5e3bc731d71。
Node计算与PowerShell Get-FileHash独立复核一致。目录限制为当前Windows账号访问。备份完成时间2026-10-29T06:35:17.469Z。
实际备份命令（凭证仅经子进程MYSQL_PWD环境传递，省略值）：
```powershell
& 'E:\mysql\server\bin\mysqldump.exe' --host=127.0.0.1 --port=3307 --user=naoshang --single-transaction --quick --no-tablespaces --set-gtid-purged=OFF --result-file='E:\mysql\stage3-backups\fast-drill-2026-10-29T06-35-17-255Z\naoshang-before-fast-drill.sql' naoshang
```
按本轮简化指令，没有恢复验证或临时恢复库操作。

## 执行命令及原SQL
```powershell
node --check server/scripts/money-fast-drill.cjs
node server/scripts/money-fast-drill.cjs
```
语法检查通过；实库脚本退出码1，原因是下述实际SQL失败。
执行器使用mysql2.query逐份提交原文件内容，multipleStatements=false；原文件未修改，未使用列存在检查冒充原SQL幂等。

批次A首轮顺序：
001 A_skus.up.sql：成功。
002 A_activity_prices.up.sql：成功。
003 A_columns.up.sql：成功。
004 A_quotes.up.sql：成功。

原样重跑A_skus.up.sql：失败。
- code：ER_DUP_FIELDNAME。
- errno：1060。
- SQLSTATE：42S21。
- message：Duplicate column name 'list_price_cents'。
- 失败SQL为原文件ALTER TABLE skus ADD COLUMN list_price_cents BIGINT NULL, ADD COLUMN currency CHAR(3) NULL。
原SQL不幂等，重跑不能自动跳过已存在列。没有修改文件、忽略错误或自动修复重试。

## 结构及行数核对
首轮001→004完成、重跑失败之前已核对：
- skus新增list_price_cents BIGINT NULL、currency CHAR(3) NULL；18行→18行。
- activity_prices新增activity_price_cents BIGINT NULL、currency CHAR(3) NULL；6行→6行。
- columns新增price_cents BIGINT NULL、currency CHAR(3) NULL；2行→2行。
- quotes新增payable_amount_cents/goods_amount_cents/discount_amount_cents/list_amount_cents BIGINT NULL及currency CHAR(3) NULL；34行→34行。
information_schema中所有新增列IS_NULLABLE=YES、COLUMN_DEFAULT=NULL；SQL文件没有设置currency默认值，各表currency IS NOT NULL数量均为0。
所有旧列名称、类型、可空性、默认值、主键信息及EXTRA保持不变。行数与本轮备份前一致。没有执行业务DML或金额回填。
这些是本轮实际行数，与前次旧报告不同；未篡改历史证据以使其一致。

## 停止后的状态与各批结果
- A：四表新增列仍存在，保留首轮正向执行完成态。
- A幂等验证：原SQL失败，不幂等。
- A回滚SQL：未执行（失败后按要求不再继续DDL）。
- A回滚后再次正向：未执行。
- B影子写入/真实同步预检：未运行；不拿之前模拟连接单测替代真实结果。
- C dry-run/实库回填/指纹回滚：未运行。
- D checkout条件约束：未运行；不将MySQL版本支持能力或注释草案视为约束验证通过。
28文件并未全部运行，不满足“全部跑通”的完成条件。B注释配置文件、C参数模板及D报价注释草案尚未进入实库执行。

## 现场与回滚
执行明细及完整结构前后证据：fast-drill-2026-10-29T06-35-17-255Z.json；备份目录另存drill-evidence.json。
后续可选方案（本轮均未执行）：
1. 明确批准执行前检查包装：检测每个新增列是否存在且定义完全符合，符合则跳过ADD；记录为执行器可重入，不能称原SQL本身幂等。
2. 或另行批准修订版本SQL，再继续重跑验证；不能悄悄修改本轮原文件。
3. 确认后再执行A各表down及重新up，完成回滚验证，然后进入B/C/D。
若回退当前现场，可在另行确认后执行四份A.down（只删除新增列）；没有新影子数据，旧元列保留。也可保留当前新增可空列。原库备份可用于假数据整体恢复，但本轮未执行恢复。

## 限制与不变项
本轮只联系本地MySQL，不连生产；未更改金额开关、默认旧契约或业务计算；未启停现有进程。没有设置观察期，停止仅由真实SQL失败触发。
没有改阶段0/1/2/2b/3已交付文档、旧路由证据或原有未跟踪文件。仅新增本轮执行脚本、JSON证据、本报告与仓库外备份。
本轮实际Nodev24.22.0符合项目≥22.5；PID4532仍为v20.20.2。完整单测本轮未重跑；node --check、git diff --check通过不能替代SQL执行结果。
