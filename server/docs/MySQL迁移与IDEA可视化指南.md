# 脑商AI · MySQL 迁移与 IDEA 可视化指南

> 整理时间：2026-10-27
> 目的：把项目的关系库迁到 **MySQL 8.4**，方便用 **IntelliJ IDEA** 的 Database 工具直接可视化

---

## 一、连接信息（IDEA 里照填即可）

| 项 | 值 |
|---|---|
| 数据库类型 | MySQL |
| Host | `127.0.0.1` |
| Port | `3307` ⚠️ 不是默认的 3306 |
| Database | `naoshang` |
| 用户名 | `naoshang` |
| 密码 | `naoshang@2026` |
| JDBC URL | `jdbc:mysql://127.0.0.1:3307/naoshang?useUnicode=true&characterEncoding=utf8&useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=Asia/Shanghai&allowMultiQueries=true` |
| Driver | `com.mysql.cj.jdbc.Driver`（mysql-connector-j 8.4.0，已装到 IDEA drivers 目录） |

**为什么端口是 3307**：本机已有一个 MariaDB 10.5 占用 3306（无人机项目的库 `mtp_*`），
两个数据库并存，互不干扰。

---

## 二、在 IDEA 里打开（两种方式）

### 方式 A：已自动配好（推荐先试这个）

本项目 `.idea/` 下已写入 `dataSources.xml` + `dataSources.local.xml`，
数据源名为 **「MySQL - naoshang (3307)」**。

1. 用 IDEA 打开 `E:\脑商ai` 项目
2. 右侧栏点 **Database** 图标（若没显示：`View → Tool Windows → Database`）
3. 数据源应已列出 **MySQL - naoshang (3307)**
4. 双击展开，或点 **→** 展开 `naoshang` schema 看到 **45 张表**
5. 右键任意表 → **Select All** 可查看数据；右键数据源 → **Jump to Query Console** 可写 SQL

> 驱动已预装到 `%APPDATA%\JetBrains\IntelliJIdea2026.2\drivers\mysql-connector-j-8.4.0.jar`，
> 不用等 IDEA 在线下载。

### 方式 B：手工新建

1. `View → Tool Windows → Database` → 左上角 **+** → **Data Source** → **MySQL**
2. 按上表填 Host / Port / 用户名 / 密码
3. **Database** 填 `naoshang`
4. Download 驱动保持 `com.mysql.cj.jdbc.Driver`（或手动指定上面那个 jar 路径）
5. 点 **Test Connection**，成功后 **OK**

---

## 三、库里的内容

**45 张表，114 行数据**（与 SQLite 版完全一致）：

| 表 | 行数 | 表 | 行数 |
|---|---|---|---|
| `quotes` | 42 | `regional_agents` | 4 |
| `skus` | 18 | `columns` | 2 |
| `users` | 10 | `counters` | 2 |
| `activation_codes` | 9 | `allocation_quotes` | 1 |
| `commissions` | 8 | `co_store_owners` | 1 |
| `quota_ledger` | 7 | `co_stores` | 1 |
| `orders` | 4 | `quota_activity_batches` | 1 |
| `quota_transactions` | 4 | 其余 30 张表 | 0（结构已建好） |

外键 **40 个**，孤儿记录 **0**。

---

## 四、迁移是怎么做的

原库的 `sql/schema.sql` 是 **SQLite / PostgreSQL 兼容方言**，不能直接灌 MySQL。
`server/scripts/export_mysql.js` 做了方言转换：

| SQLite | MySQL | 原因 |
|---|---|---|
| `REAL` | `DECIMAL(18,2)` | 金额用定点数避免浮点误差 |
| `TEXT`（被主键/唯一键/外键引用） | `VARCHAR(191)` | MySQL 不允许 TEXT 做索引键 |
| `TEXT`（带默认值） | `VARCHAR(255)` | MySQL 不允许 TEXT/JSON 列带默认值 |
| `TEXT`（JSON 数组，超长） | `TEXT` + 去掉 DEFAULT | `rows`/`targets` 实际长度超 191 |
| `DATETIME` / `TIMESTAMP` | `VARCHAR(32)` | 原库日期粒度不统一（有 `'2026-10'` 这种月粒度值），MySQL 严格模式会拒绝 |
| `datetime('now','localtime')` | `DEFAULT '1970-01-01 00:00:00'` | SQLite 函数在 MySQL 不存在 |

转换脚本还做了全局扫描，把「被主键 / 唯一键 / 外键 / 显式索引引用」的列统一识别出来，
避免逐个报错。

---

## 五、重新生成与重导

```bash
cd E:\脑商ai\server

# 1) 从 db.json 生成带数据的 SQLite 中间库（源）
node scripts/export_view_db.js

# 2) 转成 MySQL 方言脚本
node scripts/export_mysql.js
#    可选参数：--db <源.db>  -o <输出.sql>  --name <库名>

# 3) 导入 MySQL
"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe" -P 3307 -unaoshang -p'naoshang@2026' < mysql/naoshang.sql
```

---

## 六、MySQL 实例信息

| 项 | 值 |
|---|---|
| 版本 | MySQL Community Server **8.4.9** |
| 服务名 | `MySQL8Naoshang`（开机自启） |
| 安装目录 | `C:\Program Files\MySQL\MySQL Server 8.4` |
| 数据目录 | `C:\ProgramData\MySQL\naoshang-data\data` |
| 配置文件 | `C:\ProgramData\MySQL\naoshang-data\my.ini` |
| 错误日志 | `C:\ProgramData\MySQL\naoshang-data\data\*.err` |
| root 密码 | `naoshang@2026`（root 与 naoshang 同密码） |

手动启停：

```powershell
Start-Service MySQL8Naoshang
Stop-Service  MySQL8Naoshang
```

> 注意：MariaDB 10.5（3306）和 MySQL 8.4（3307）**并存**。
> 无人机项目连的是 3306，脑商AI 连 3307，别搞混。

---

## 七、原库还在（没动）

MySQL 是**新增**，原 SQLite 库原封不动保留：

| 文件 | 说明 |
|---|---|
| `server/data/brain_biz.db` | 正式空表结构库（45 表 0 行） |
| `server/data/brain_biz_view.db` | 带数据的中间库（迁移源） |
| `server/data/db.json` | 运行时真数据（后端实际读写的） |

MySQL 目前是**只读快照**——后端仍走 SQLite/JSON，不会自动同步到 MySQL。
数据变了需要重跑第 3 步重新导入。

---

## 八、中文注释（表 / 字段说明）

MySQL 库的 **45 张表、418 个字段全部带中文注释**。在 IDEA 里把鼠标悬停在
表名或字段名上即可看到说明；DDL 面板的 `Table` / `Column` 视图也会直接显示。

| 层级 | 数量 | 示例 |
|---|---|---|
| 表注释 | 45 / 45 | `commissions` → 收益明细（佣金台账；全球奖/直推奖/复购奖/创始奖/代理奖/合店分配全类型统一落此表） |
| 字段注释 | 418 / 418 | `entitlement_state` → 权益收益费三态：never_paid=未开通 / active=生效中 / expired=已过期 |

### 注释的唯一来源

```
server/sql/comments.js          ← 中文注释字典（唯一维护入口）
        │
        ├──→ scripts/apply_comments.js    → 写入运行中的 MySQL 实例
        ├──→ scripts/export_mysql.js      → 写入 mysql/naoshang.sql 建表语句
        └──→ scripts/sync_schema_comments.js → 回写 sql/schema.sql 行内注释
```

改注释只改 `sql/comments.js`，然后依次执行：

```bash
cd E:/脑商ai/server

# 1) 校验覆盖率（不碰数据库）
node scripts/apply_comments.js --check

# 2) 应用到 MySQL 实例 + 更新 naoshang.sql
node scripts/apply_comments.js

# 3) 回写 SQLite 权威 DDL 的行内注释
node scripts/sync_schema_comments.js
```

`--check` 会输出缺口清单（缺哪些表/列的注释、字典里有没有库里不存在的表/列），
返回码非 0 表示还没覆盖完。

### 重新生成带注释的迁移脚本

```bash
node scripts/export_view_db.js    # db.json → data/brain_biz_view.db（SQLite 带数据）
node scripts/export_mysql.js      # SQLite → mysql/naoshang.sql（MySQL 方言 + 中文注释）
```

`naoshang.sql` 里每个建表语句都带 `COMMENT`，重建库时注释自动生效，无需再跑
`apply_comments.js`。

### 查看注释

```sql
-- 表注释
SELECT table_name, table_comment
FROM information_schema.tables
WHERE table_schema = 'naoshang';

-- 字段注释
SELECT table_name, column_name, column_comment
FROM information_schema.columns
WHERE table_schema = 'naoshang' AND column_comment <> '';
```

---

## 九、网页版数据库浏览器（免装客户端）

除了 IDEA，也可以用零安装的浏览器直接查看。脚本会**直连运行中的 MySQL 实例**，
所以看到的注释和 IDEA 里完全一致。

### 启动

双击 `server\scripts\启动数据库浏览器.bat`，或命令行：

```bash
cd E:/脑商ai/server
node scripts/db_viewer_mysql.js
```

启动后终端会打印地址，默认 **http://localhost:7789** 。

### 功能

| 位置 | 功能 |
|---|---|
| 左侧栏 | 45 张表按业务分组（主体与组织 / 交易与收益 / 名额与配额 / 商品与内容 / 账务与运营），支持按表名或中文说明搜索 |
| 表标题 | 表名右侧显示中文表说明 |
| 数据页 | 真实数据分页浏览，**鼠标悬停在列名上会弹出该字段的中文说明** |
| 结构与注释页 | 完整列定义：类型、PK/FK/NOT NULL 约束、外键指向，列名下方直接列出中文说明 |
| 关系页 | 本表出向外键 + 被引用入向关系 |
| SQL 查询页 | 只读 SQL 控制台（仅允许 `SELECT`），可自由查库 |

### 连接参数

脚本读取顺序：命令行参数 → 环境变量 → `server\mysql\.env.local` → 默认值。

```bash
# 覆盖任意参数
NAOSHANG_DB_PASSWORD=你的密码 node scripts/db_viewer_mysql.js -p 7790
```

| 参数 | 默认值 | 说明 |
|---|---|---|
| `-h` / `NAOSHANG_DB_HOST` | `127.0.0.1` | MySQL 主机 |
| `-P` / `NAOSHANG_DB_PORT` | `3307` | MySQL 端口 |
| `-d` / `NAOSHANG_DB_NAME` | `naoshang` | 数据库名 |
| `-u` / `NAOSHANG_DB_USER` | `naoshang` | 账号 |
| `-p` | `7789` | 浏览器端口（注意与 MySQL 端口区分） |
| `NAOSHANG_DB_PASSWORD` | 见 `.env.local` | 密码 |

> ⚠️ 当前终端环境会把命令行里的数据库密码自动替换成另一个字符串，
> 所以**不要用命令行明文传密码**，改用环境变量或 `.env.local` 文件。

---

## 十、IDEA Database 面板显示 naoshang 库（完整排查记录）

### 问题现象

IDEA 右侧 Database 面板里只有一个「演示 MySQL」节点，展开后是
`datagrip / information_schema / performance_schema` 三个系统库——
**这不是你的数据**。

打开 `database.0.log` 能看到 IDEA 实际执行的查询：

```sql
SELECT t.* FROM datagrip.actor t LIMIT 501
SELECT t.* FROM datagrip.category t LIMIT 501
```

`datagrip.actor`、`datagrip.category` 是 **JetBrains 官方演示服务器**
（`mysql.datagrip-dbs.intellij.net`）的表。这个数据源是之前点「+」时
误连的示例库，与本地 3307 实例毫无关系。

### 已完成的修复

数据源配置已按 IDEA 2026.2 的原生 XML 结构重建：

| 文件 | 作用 |
|---|---|
| `.idea/dataSources.xml` | `<component name="DataSourceManagerImpl">` —— JDBC URL、驱动引用 |
| `.idea/dataSources.local.xml` | `<component name="dataSourceStorageLocal">` —— 账号、`introspection-scope` |
| `.idea/dataSources/data_sources_history.xml` | IDEA 启动时读取的历史列表 |

当前数据源：

| 项 | 值 |
|---|---|
| 名称 | `naoshang (MySQL 8.4)` |
| UUID | `7a3c1e52-9b84-4d6f-a1c7-3e05b92d48f1` |
| JDBC URL | `jdbc:mysql://127.0.0.1:3307/naoshang?useUnicode=true&characterEncoding=utf8&useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=Asia/Shanghai&allowMultiQueries=true` |
| 账号 | `naoshang` |
| 驱动 | MySQL Connector/J 8.4.0（IDEA `drivers/` 目录） |

JetBrains 演示服务器数据源已从三处配置中全部移除。

### 为什么改配置文件后必须重启 IDEA

IDEA 运行时会用**内存中的数据源模型**覆盖磁盘上的 `.idea/dataSources*.xml`。
实测：IDEA 退出时会把演示服务器条目写回文件，我写入的 naoshang 条目被抹掉。

而且 IDEA 只在**项目打开时**读取数据源配置，运行中改文件不会触发重载。

### 你需要做的一步

IDEA 的**元数据同步（列出表）必须由用户手动触发**，这是 IDEA 的设计，
无法用脚本自动化。配置已经全部就绪，只差这一个动作：

```
Database 面板 → 选中「naoshang (MySQL 8.4)」→ 点右上角 ⟳ 刷新
```

展开后应看到 `naoshang` schema 下 45 张表。点表即可看数据；
**表名和字段名的中文注释会直接显示在树节点和 Data Editor 面板上**。

若弹出密码框（IDEA 的 Password Safe 被重置过），填 `naoshang` 的密码即可，
填一次后会永久记住。

### 自检脚本

```bash
cd E:/脑商ai/server
node scripts/check_idea_datasource.js
```

会检查：配置文件存在性、XML 结构是否符合 IDEA 2026.2、数据源定义、演示服务器
是否清除、`introspection-scope` 是否含 naoshang、**用 IDEA 自带驱动实测 JDBC
连接**（确认 45 张表 / 418 条中文注释）、3307 端口监听状态。

当前结果：**18 项全部通过**。

### 修复脚本

```bash
node scripts/fix_idea_datasource.js          # 写入配置
node scripts/fix_idea_datasource.js --verify # 只校验
```

⚠️ **必须在 IDEA 完全关闭时执行**，否则会被 IDEA 的内存状态覆盖。

### 另一个坑：IDEA 配置目录轮转

IDEA 重启时若检测到配置目录异常，会把整个配置目录轮转到
`IntelliJIdea2026.2-backup/<时间戳>/`，**连同 `drivers/` 里的驱动和
`c.kdbx` 密码库一起搬走**，导致新目录驱动为空、连接报
`Access denied ... (using password: NO)`。

恢复方法：

```bash
BK="/c/Users/Administrator/AppData/Roaming/JetBrains/IntelliJIdea2026.2-backup/<时间戳>"
DST="/c/Users/Administrator/AppData/Roaming/JetBrains/IntelliJIdea2026.2"
mkdir -p "$DST/drivers" && cp "$BK/drivers/"*.jar "$DST/drivers/"
cp -r "$BK/jdbc-drivers" "$DST/"
cp "$BK/c.kdbx" "$BK/c.pwd" "$DST/"
```
