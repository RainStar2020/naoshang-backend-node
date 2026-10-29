# 本地隔离演练：零、执行前确认

日期：2026-10-29。仅执行SHOW/SELECT只读查询及本机进程/监听检查。未执行DDL/DML，未启停任何现有服务或同步器，未执行批次A/B/C/D。

## 实际连接目标与权限
- host：127.0.0.1；port：3307；database：naoshang；配置用户：naoshang。
- CURRENT_USER：naoshang@127.0.0.1；连接来源身份：naoshang@localhost。
- MySQL：8.4.9；服务端hostname：PC-202545454；@@port=3307；@@read_only=0。
- 权限：全局USAGE；naoshang.*的ALL PRIVILEGES。具备本库读写/DDL权限，不代表获得本次执行授权；没有显示全局PROCESS权限，进程清单可见性不能视为全实例审计。
- TCP监听：127.0.0.1:3307；PID34300；实际程序E:\mysql\server\bin\mysqld.exe。确认连接本机mysqld，不是SSH/Docker转发监听。
- 本次未使用任何非loopback目标；凭证不写报告或命令输出。

## SHOW CREATE TABLE与字段比对
完整实际DDL及information_schema列证据保存在phase-3-local-preflight.json。
- skus：6列，14行。list_price=DECIMAL(18,2) NOT NULL DEFAULT 0.00；尚无list_price_cents/currency。
- activity_prices：4列，6行。amount=DECIMAL(18,2) NOT NULL DEFAULT 0.00；尚无activity_price_cents/currency。
- columns：11列，2行。price=DECIMAL(18,2) NOT NULL DEFAULT 0.00；尚无price_cents/currency。
- quotes：13列，8行。amount=DECIMAL(18,2) NOT NULL DEFAULT 0.00；scene=TEXT NOT NULL；breakdown=TEXT可空。尚无payable_amount_cents/goods_amount_cents/discount_amount_cents/list_amount_cents/currency。
全部旧列名称和类型与server/mysql/naoshang.sql基线一致，未发现本次字段映射冲突或已存在的影子列。未将SHOW CREATE的格式、隐式DEFAULT NULL或自增状态变化当作金额语义差异。结构比对通过不等于数据核对、DDL执行或回滚验证通过。
仅查询行数，未读取业务行，未做历史金额核对/回填。

## 可丢弃性、独占和备份：尚未满足门槛
没有在本库发现bak_*或stage3_*备份候选表。未创建逻辑备份或表级快照；backupVerified=false。仓库已有mysql/naoshang.sql未经一致性/时效性核验，不能视作本次可恢复备份。
除本次只读连接外，观察到另一连接ID24，来源localhost:49172，用户naoshang，状态Sleep。TCP反查PID4532，node.exe，路径D:\nvm\v20.20.2\node.exe，命令分类为server.js；没有输出其完整参数或凭证。
当前只能证明本机实例，不能凭库名、localhost或用户“本地测试”描述推断该具体schema可丢弃或非共享。存在活跃本地应用连接，未获准终止，未擅自停止。
结论：专用且可丢弃未确认、无已验证备份，因此批次A门槛未通过。保留现场，等待用户确认隔离范围/备份方案。

## ORM/同步器检查
当前项目package.json/dbLayer及现有入口未发现TypeORM/Sequelize/Prisma自动同步结构配置。
sync_to_mysql.js不是ORM自动建表：使用SHOW COLUMNS、映射及DELETE/INSERT镜像；--backup路径中的CREATE TABLE为显式备份动作，不是ORM启动自动同步。
本机进程快照未发现命令行包含sync_to_mysql的Node进程；计划任务查询未发现Naoshang或直接启动sync_to_mysql的匹配项。存在数个server.js进程，无法仅由相对命令行证明所属项目或其他程序不存在DDL/同步行为。
因此“本项目静态未发现ORM自动同步”已核实；“所有运行客户端均未自动同步结构”尚无法确认。PID4532已有MySQL连接，应在DDL窗口前明确其用途并经授权隔离/暂停；本轮未操作它。

## 备份位置与恢复命令：仅拟定，未执行
建议备份目录：E:\mysql\stage3-backups\<approved-run-id>\，位于仓库外。尚未创建目录或备份文件，必须由用户确认后再执行一致性备份及校验。
备份前先确认独占窗口，暂停相关写入/同步；逻辑备份完成后核对四表DDL、行数、文件SHA256，保留快照和批次号。以下命令使用交互密码，不将密码放命令行；路径中的占位符必须替换后审阅。
```powershell
& 'E:\mysql\server\bin\mysqldump.exe' --host=127.0.0.1 --port=3307 --user=naoshang --password --single-transaction --no-tablespaces --set-gtid-purged=OFF --result-file='E:\mysql\stage3-backups\<approved-run-id>\naoshang-before-a.sql' naoshang skus activity_prices columns quotes
```
恢复命令（有破坏性，仅在停止写入、核验备份且另行批准恢复时执行；本轮未执行）：
```powershell
& 'E:\mysql\server\bin\mysql.exe' --host=127.0.0.1 --port=3307 --user=naoshang --password --database=naoshang --execute='SOURCE E:/mysql/stage3-backups/<approved-run-id>/naoshang-before-a.sql'
```
已确认mysql.exe及mysqldump.exe位于上述路径。该拟定命令不是已验证备份/恢复结果；恢复演练仍需在隔离副本执行，不得直接覆盖活跃本库数据。

## 执行命令与结果
- node --check server/scripts/money-local-preflight.cjs：通过。
- node server/scripts/money-local-preflight.cjs：成功连接上述loopback实例，仅执行SHOW GRANTS、SHOW CREATE TABLE、information_schema列/连接/备份元数据和COUNT查询。
- PowerShell Get-NetTCPConnection/Get-CimInstance：确认本机mysqld监听和已有Node客户端连接。
- Get-ScheduledTask与源码rg：未发现直接启动sync_to_mysql的匹配任务/进程，未发现本项目ORM自动同步配置；不是对任意外部程序的全面保证。
本轮实际node解析为v24.22.0（可执行文件D:\nvm\v24.22.0\node.exe），预检证据也记录v24.22.0，满足项目≥22.5。此前阶段使用v20.20.2；该旧运行时仍存在，本轮另用D:\nvm\v20.20.2\node.exe仅作新增脚本语法检查，未重复连接数据库。此前全部回归仍需合规CI复跑，本轮未重跑金额/接口全套测试。

## 变更及停止点
仅新增money-local-preflight.cjs、本报告、phase-3-local-preflight.json。未修改任何旧阶段文档、SQL计划、业务代码、路由证据、环境变量、根package-lock.json或db.json.bak-*。
批次A未开始。幂等/回滚/新列验证、B影子写入、C回填、D约束和恢复演练均未运行。
等待确认：该具体schema是否非共享且可丢弃；PID4532客户端用途及隔离安排；是否批准在独占窗口先创建并验证四表备份。未满足之前不执行任何DDL。
