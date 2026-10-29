# 本地逻辑备份、恢复验证与PID4532排查报告

日期：2026-10-29。仅原库只读备份/查询及本机只读排查。用户补充确认允许仅对naoshang_restore_check建库、导入、删库；原库naoshang保持只读。
结论：逻辑备份已生成并校验文件哈希；恢复验证未通过（当前账号无临时库权限），批次A继续暂停。没有停止任何进程，没有KILL连接，没有执行批次A/B/C/D。

## 1. 原库与备份
连接目标：127.0.0.1:3307/naoshang，MySQL8.4.9，CURRENT_USER=naoshang@127.0.0.1。没有非本地/生产目标连接。
备份开始：2026-10-29T06:27:34.463Z（北京时间14:27:34）；备份文件完成：2026-10-29T06:27:35.015Z（北京时间14:27:35）。

实际命令（密码通过子进程MYSQL_PWD环境传递，未放命令行、文件或报告）：
```powershell
& 'E:\mysql\server\bin\mysqldump.exe' --host=127.0.0.1 --port=3307 --user=naoshang --single-transaction --quick --no-tablespaces --set-gtid-purged=OFF --result-file='E:\mysql\stage3-backups\backup-restore-20261029T062639155Z\naoshang-full.sql' naoshang
```
这是单库全表结构/数据逻辑导出，包含mysqldump默认的触发器；未额外请求存储例程/事件。不是--databases模式，导出未包含CREATE DATABASE/USE切换，也未检测到`naoshang`.显式跨库引用。未执行导出中的SQL。

全库备份：
- 路径：E:\mysql\stage3-backups\backup-restore-20261029T062639155Z\naoshang-full.sql
- 大小：134829字节。
- SHA256：2b531fe8cee50de4d8179be6ea13ddf2ec5ebe30679c70b5bd21e77abdd81357。
- 已验证非空、存在Dump completed结束标记；另用PowerShell Get-FileHash独立核对，结果一致。

四目标表结构备份：
- 路径：E:\mysql\stage3-backups\backup-restore-20261029T062639155Z\four-target-tables.schema.sql
- 大小：5070字节。
- SHA256：3786e6c1a12cec93dceb95a9c22538aa94cd691e26e3806166eb76ff73bf688b。
- 内容：实际SHOW CREATE TABLE的四条可执行CREATE TABLE，未指定USE库名；仅可在明确选定的隔离库执行。本轮未执行。

备份目录已取消继承，仅PC-202545454\Administrator具有F权限；备份含业务数据，存于仓库外，不打印数据或凭证。
校验记录：同目录verification.json；项目证据副本为docs/api-standardization/phase-3-backup-restore-evidence.json。

## 2. 原库快照核对与恢复失败
备份前/后对四表DDL、列类型/可空性/默认值、行数、按主键排序前5行的SHA256进行比对，完全一致：
- skus：14行，抽样5行。
- activity_prices：6行，抽样5行。
- columns：2行，抽样2行。
- quotes：8行，抽样5行。
抽样仅保存哈希，不公开原始行。该结果只证明备份前后观测到的原库状态稳定，不等同恢复验证通过，也不能证明全实例没有其他写入。

恢复目标：同实例naoshang_restore_check。只读检查确认该库不存在后，实际尝试：
```sql
CREATE DATABASE `naoshang_restore_check` CHARACTER SET utf8mb4;
```
结果：ER_DBACCESS_DENIED_ERROR，SQLSTATE42000。当前账号仅有naoshang.*权限，不能创建这个不同名schema。
失败后立即停止后续DDL/导入，未切换账号、未尝试提升权限、未授予权限。
- 临时库创建：失败，未创建。
- 导入备份：未运行。
- 恢复库四表行数/类型/抽样验证：未运行。
- 删除临时库：未运行（本轮根本未创建临时库，无本轮恢复库需要清理）。
- 原库DDL/DML：未执行。
因此文件完整性核对通过，但备份可恢复性尚未验证，不得作为批次A放行依据。

后续恢复命令（仅供审阅，未执行；须先有临时库权限及单独确认）：
```powershell
& 'E:\mysql\server\bin\mysql.exe' --host=127.0.0.1 --port=3307 --user=<具备临时恢复库权限的本地账号> --password --database=naoshang_restore_check --execute='SOURCE E:/mysql/stage3-backups/backup-restore-20261029T062639155Z/naoshang-full.sql'
```
--password在人工终端交互输入；不要把密码写进命令或报告。该命令只准用于临时恢复库，不得改成原库naoshang。成功后应核对四表行数、列类型/默认值和抽样哈希，全部一致才能删除本轮拥有的临时库。若临时库已存在，应先确认归属，不能直接覆盖或删除。

## 3. PID4532的Windows证据
- tasklist：node.exe，PID4532，Console会话。
- 完整命令行：D:\nvm\v20.20.2\node.exe server.js。
- 可执行文件：D:\nvm\v20.20.2\node.exe。
- 工作目录：E:\mysql\viewer\。使用只读OpenProcess/ReadProcessMemory读取64位PEB的CurrentDirectory，仅读取目录字段，无注入、无进程修改。
- 启动时间：2026-10-29 11:40:21.642326 +08:00。
- 父PID17208，命令："D:\.nodejs\node.exe" server.js；启动时间11:40:21.58654 +08:00。
- 监听端口7789，连接本机127.0.0.1:3307，客户端端口49172。
- 项目package名naoshang-local-viewer，实际入口E:\mysql\viewer\server.js。
- 入口源码SHA256：29d64edd9b8f1c4c45462db81ebcba552959fdead5efa62f665ff34e35539203。
用途判断：本地数据库查看器，不是sync_to_mysql，不是本轮机器人创建的隔离冒烟进程，也不是当前backend项目的API入口。

## 4. MySQL连接及写入可能性
匹配客户端端口49172的连接：ID24，用户naoshang，DB=naoshang，HOST=localhost:49172。
在2026-10-29T06:27:34Z附近观测：COMMAND=Sleep，TIME=100秒，INFO=NULL。此时无当前执行SQL。TIME是当前Sleep状态持续秒数，不是总连接时长，不能据此声称连接只建立100秒。
performance_schema.session_connect_attrs读取被拒（ER_TABLEACCESS_DENIED_ERROR）；未取得可靠连接创建时间。进程启动时间不能代替连接建立时间。

只读源码检查：
- assertSelectOnly（第34行）只允许首关键字SELECT/SHOW/DESCRIBE/DESC/EXPLAIN，并拒绝多语句。
- /api/query（第209行）经此检查后执行pool.query。
- 常规元数据/表格路由使用SELECT/SHOW，未发现DELETE+INSERT镜像、定时同步器或修改目标表的正常写接口。
- 使用的是具备naoshang.*全部权限的账号，没有数据库层只读账号/只读事务强制约束。首关键字检查是应用约束，不是完整SQL权限隔离，不能保证任意输入、后续代码变化或其他使用该凭证的程序绝不会写。
判断：不是同步器，正常用途为只读查看，未发现当前正在写目标表；但仍是活跃数据库客户端，不能把它当作已隔离或数据库级严格只读。
未请求它执行查询接口、未测试任何绕过方法、未停止进程、未KILL连接。
建议：后续DDL窗口前，单独确认暂时关闭查看器/其连接，或切换至只读账号/独立库；本轮不执行这些动作。

## 5. Node版本说明
同一台Windows主机PC-202545454，多版本并存，不是换到了其他服务器。
本轮脚本实际运行：v24.22.0，process.execPath=D:\nvm\v24.22.0\node.exe；命令解析入口D:\.nodejs\node.exe。
D:\.nodejs是指向D:\.shim的Junction，其中node.exe为764200字节的分派程序，和真正的v24二进制（93882184字节）不同。
PID4532显式运行v20.20.2，且其既有进程不会随当前shell解析结果改变。此前阶段的v20报告是当时实际观测，不应追溯改成v24。
可证实的差异原因是多个安装版本及shim/显式路径选择不同；未取得shim历史选择日志或变更操作者证据，不能确认何时、由谁改变了默认选择，也不能声称是本轮改造导致升级。
本轮新增脚本语法检查使用v24.22.0，满足项目≥22.5；完整金额/API回归本轮未重跑，后续CI仍须注明实际运行版本。

## 6. 放行结论与下一步
批次A继续暂停。直接阻塞项：恢复库创建权限不足，备份恢复验证未通过。
需要由有权限的本地管理员提供仅用于临时恢复库的建库/恢复/清理权限或明确预建并授权该库；不需要扩大原库业务权限。任何授权/账号切换和重试仍等待用户确认。
查看器用途已明确，不属于DELETE+INSERT同步器；但DDL窗口前建议经用户确认隔离其连接。当前未停止任何服务，不影响现有本地使用。
不执行A/B/C/D；历史回填未运行；金额开关未启用；默认旧契约未改。

## 7. 本轮新增文件及验证
新增server/scripts/money-backup-restore-check.cjs、本报告、phase-3-backup-restore-evidence.json；备份目录下两个SQL备份和verification.json。
node --check server/scripts/money-backup-restore-check.cjs：通过。
备份/恢复脚本退出码1：恢复建库被拒，符合失败即停，不算恢复通过。
PowerShell Get-FileHash、icacls只读复核：通过。
阶段0/1/2/2b/3既有文档、路由证据、SQL计划、原有package-lock.json和db.json.bak-*未修改。没有更改业务代码或环境变量配置。
