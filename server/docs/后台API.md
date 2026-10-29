# 后台API

> 服务：`E:\脑商ai\server\server.js`　启动：`node server.js`（默认端口 3000，可用 `PORT` 环境变量覆盖）
>
> Base Path：**`/api/hq`**　　鉴权：`Authorization: Bearer <token>`（也支持 `?token=<token>`）
>
> 契约来源：《总部后台API需求文档.md》v1.0（HQ-01 ~ HQ-26）
>
> 规模：**26 个模块 / 120 个接口**（82 个 GET · 38 个 POST）
>
> 更新记录：2026-10-28 v1.0 —— 首版落地。26 个模块全部实现并通过端到端验证（25/25 项全绿），
> 既有 696 项回归测试全绿，未破坏原有 C 端逻辑。

---

## 目录

- [0. 设计约束与落地说明](#0-设计约束与落地说明)
- [1. 通用约定](#1-通用约定)
- [2. 写操作统一约定](#2-写操作统一约定)
- [3. 接口清单（26 模块 / 120 接口）](#3-接口清单26-模块--120-接口)
- [4. 数据落库与 MySQL 同步](#4-数据落库与-mysql-同步)
- [附录 A：模块 → 数据表对照](#附录-a模块--数据表对照)
- [附录 B：落地待定项清单](#附录-b落地待定项清单)
- [附录 C：HQ 集合进 MySQL 的补表与同步映射方案](#附录-chq-集合进-mysql-的补表与同步映射方案)
- [附录 D：验证与回归](#附录-d验证与回归)

---

## 0. 设计约束与落地说明

### 0.1 真源与镜像关系（**最重要的一条**）

```
db.json  ←── 唯一真源，所有后台写操作落这里
   │
   │  scripts/sync_to_mysql.js（单向镜像）
   ▼
MySQL (192.168.0.44:3307)
```

- **后台写操作一律写 `db.json`，绝不直写 MySQL。**
- 原因：同步器对「托管表」执行 `DELETE FROM` + 整表重建。任何直写 MySQL 的数据，
  会在下一次同步时**秒级丢失**。
- 哪些表属于托管表，由 `scripts/managed_tables.js` 静态声明（唯一口径来源）。
  托管表在浏览器端 MySQL 可视化工具中**禁止直写**。

### 0.2 缺表模块的落地策略

需求文档中部分模块（商品、公告、软件卡、优惠券模板等）在当前库中**没有对应的业务表**。
本次实现为这些模块新建了独立的 `hq*` 集合（见 [附录 A](#附录-a模块--数据表对照)），
接口真实可跑通、数据真实可写。

- 这些 `hq*` 集合**不参与**既有同步器的映射表，因此**目前只在 `db.json` 中，不在 MySQL 中**。
- 补 MySQL 表与同步映射的完整方案见 [附录 C](#附录-chq-集合进-mysql-的补表与同步映射方案)。
- 各模块的具体待定项标注在 [附录 B](#附录-b落地待定项清单)。

### 0.3 目录结构

```
server/src/routes/hq/
├── index.js              路由分发器：路径匹配 / 鉴权 / 信封 / 幂等作用域与指纹
├── lib.js                公共层：错误码 / 信封 / 分页 / 鉴权 / 审计 / 幂等 / 乐观锁
└── modules/              26 个模块，每个导出 { name, code, title, routes }
```

---

## 1. 通用约定

### 1.1 Base Path 与鉴权

| 项 | 值 |
| --- | --- |
| Base Path | `/api/hq` |
| 鉴权方式 | `Authorization: Bearer <token>`（或 `?token=<token>`） |
| 免鉴权接口 | 仅 `POST /api/hq/auth/login` |
| 权限模型 | 当前仅 `admin` 会话；`hqPermissions` 为后续扩展，**非当前硬门槛** |

登录后 token 由服务端登记在会话表中，`role = 'hq_admin'`，登出即失效。

> 管理员账号：`admin`，默认口令 `admin888`。
> 口令取值优先级：`HQ_ADMIN_PASSWORD` → `ADMIN_PASSWORD` → `admin888`。
> 口令以 **scrypt** 哈希存储（`scrypt$salt$hash`），比对走 `timingSafeEqual`（防时序攻击）。
> 首次登录时若检测到历史明文口令，会自动升级为 scrypt 哈希。

```bash
curl -X POST http://127.0.0.1:3000/api/hq/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin888"}'
```

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "token": "hq-admin-xxxxxxxxxxxx",
    "admin": { "adminId": "admin", "username": "admin", "displayName": "总部/后台", "role": "admin" },
    "expiresAt": "2026-10-29T04:00:00.000Z"
  }
}
```

### 1.2 统一响应信封

**所有**接口（含错误）都返回同一形态：

```json
{ "code": 0, "message": "ok", "data": { } }
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `code` | number | `0` 表示成功；非 0 为业务错误码（见 1.3） |
| `message` | string | 面向人的错误描述，成功时为 `ok` |
| `data` | any | 业务数据；失败时为 `null`，错误补充字段（如 `currentVersion`）平铺在信封顶层 |

### 1.3 错误码

| code | HTTP | 含义 | 标识 |
| --- | --- | --- | --- |
| `0` | 200 | 成功 | OK |
| `40100` | 401 | 未登录 / token 失效 | UNAUTHORIZED |
| `40300` | 403 | 权限不足 | FORBIDDEN |
| `40400` | 404 | 资源不存在 | NOT_FOUND |
| `40000` | 400 | 参数非法 / 缺少必填 / 枚举越界 | INVALID_INPUT |
| `40900` | 409 | 状态冲突（如重复冻结、状态不允许） | INVALID_STATE |
| `40901` | 409 | 乐观锁冲突（资源已被他人修改） | VERSION_CONFLICT |
| `40902` | 409 | 幂等键冲突（同键不同载荷） | IDEMPOTENCY_CONFLICT |
| `40903` | 409 | 配额不足 | QUOTA_EXCEEDED |
| `50000` | 500 | 服务器内部错误 | SERVER_ERROR |

**错误优先级**：参数合法性（40000）先于资源存在性（40400）。
例：`POST /api/hq/users/{不存在的账号}/mutate` 且 `action` 非法 → 返回 40000 而非 40400。

### 1.4 分页

列表接口统一支持：

| Query | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `page` | number | `1` | 页码，从 1 起 |
| `pageSize` | number | `20` | 每页条数，**上限 100**（超出自动截断） |

列表型 `data` 统一形态：

```json
{
  "items": [ ],
  "total": 128,
  "page": 1,
  "pageSize": 20,
  "summary": { }        // 可选：模块级汇总计数
}
```

### 1.5 金额单位

- 金额统一用 **「元」**，JSON `number` 类型，**保留两位小数**。
- **禁止**用「分」的整数表示；落库建议 `DECIMAL(18,2)`。
- 课时、次数、数量等**非金额**字段是整数，不做两位小数处理。

### 1.6 敏感字段脱敏

| 字段 | 规则 |
| --- | --- |
| 手机号 `phone` | 列表默认脱敏 `138****0001`；**详情接口返回完整值** |
| 收件手机 `receiverPhone` | 同上 |
| 买家手机 `buyerPhone` | 同上 |
| 银行卡/账号 | 列表脱敏 `6222****1234` |
| 卡密 `code` | 列表脱敏，详情按需返回完整值 |

> 约定：**列表脱敏、详情完整**。详情接口需携带 admin 会话。

---

## 2. 写操作统一约定

所有 POST 写接口遵循同一套约定，对齐前端 mutate 习惯。

### 2.1 公共请求字段

| 字段 | 位置 | 必填 | 说明 |
| --- | --- | --- | --- |
| `action` | body | 是 | 操作类型，取值见各模块说明 |
| `reason` | body 或 Header `X-Reason` | **是** | 操作原因（审计必填），缺失 → 40000 |
| `idempotencyKey` | body 或 Header `Idempotency-Key` | 建议必填 | 幂等键；**两者同时存在以 Header 为准** |
| `version` | body | 按模块 | 乐观锁版本号，不匹配 → 40901 |

### 2.2 幂等（`idempotencyKey`）

| 场景 | 行为 |
| --- | --- |
| 首次提交 | 正常执行，登记 `键 → 结果` |
| 相同键 + 相同载荷 | **直接返回上次结果**（不重复执行、不重复审计） |
| 相同键 + 不同载荷 | 40902 `IDEMPOTENCY_CONFLICT` |

**键空间与指纹口径**（由分发器统一计算）：

- **键空间** = `模块 + 方法 + 路由模板`，例如 `users POST /users/:accountId/mutate`。
  同一端点的所有 `action` 共用一个键空间 —— 因此「同键 + 不同 action」会被正确判定为 40902。
- **指纹** = `hash(路径参数 + 请求体去掉 idempotencyKey 本身)`。
  刻意**不掺入任何服务端可变状态**（如记录当前 `version`）——
  否则首次提交后状态一变，重试时指纹就变了，缓存永远命中不了，幂等形同虚设。

### 2.3 乐观锁（`version`）

- `version` 是资源的版本号，从 `1` 起，每次成功写操作 `+1`。
- 客户端提交时带上自己读到的 `version`；服务端比对，不一致 → 40901 `VERSION_CONFLICT`，
  响应中带 `currentVersion` 告知服务端当前值。
- 不传 `version` 则**跳过**乐观锁校验（部分纯创建类操作不需要）。

### 2.4 幂等优先于乐观锁（**关键语义**）

典型场景：前端拿到操作结果后**重发同一请求**（携带的仍是**旧 version**）。

| 语义 | 行为 |
| --- | --- |
| ✅ 正确 | 命中幂等 → 直接返回**同一业务结果**（含同一 `operationId`），不报版本冲突 |
| ❌ 错误 | 先校验 version → 抛 40901，幂等形同虚设 |

本实现的做法：版本校验被**延后**到「确认不是重复提交」之后才真正执行。

1. `checkVersion()` 在业务执行前只**登记**校验，不立即抛错；
2. `withIdempotency()` 命中幂等 → **丢弃登记**，返回缓存结果；
3. 未命中 → 先执行登记的校验（此时 version 冲突会如实报出 40901），再执行业务。

### 2.5 审计回执

每个成功写操作都会在 `hqAuditLogs` 落一条审计记录，并返回 `operationId` 回执。

审计字段：`id` / `module` / `action` / `targetId` / `operatorId` / `operatorName` /
`reason` / `before` / `after` / `occurredAt` / `requestId`。

`GET /api/hq/trace` 可按模块、动作、操作人、时间检索（见 HQ-26）。

### 2.6 写操作通用响应

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "profile": { },          // 或该模块的主对象
    "operationId": "hqop_1024"
  }
}
```

---

## 3. 接口清单（26 模块 / 120 接口）

> 每个模块标注 **数据来源** 与 **落地状态**。「复用既有表」表示直接读写 C 端业务表；
> 「新建 hq\* 集合」表示当前库无对应业务表，已新建独立集合实现，**补 MySQL 表见附录 C**。
> 每张表为接口逐一标注 **功能**（做什么）与 **作用**（业务价值 / 在总部运营中的定位）。

---
### HQ-01 登录与会话（4 个接口）

| 方法 | 路径 | 功能 | 作用 |
| --- | --- | --- | --- |
| POST | `/auth/login` | 管理员登录，校验口令并签发 `hq-admin-` 会话 token | 总部后台唯一的入口与身份闸门；token 是其余 119 个接口调用的前提 |
| POST | `/auth/logout` | 注销当前会话，使 token 立即失效 | 支持管理员主动下线，降低口令泄露后的横向风险 |
| GET | `/auth/me` | 返回当前管理员资料与 token 过期时间 | 前端据此渲染后台导航、判断会话是否有效并驱动自动续登/跳登录 |
| POST | `/auth/password` | 修改当前管理员口令（校验原口令；改密后强制重登） | 定期轮换口令的安全闭环；改密即失效旧 token 防止遗留会话 |

**数据来源**：新建 `hqAdmins`（scrypt 哈希存储，`scrypt$salt$hash`，`timingSafeEqual` 比对）

---

### HQ-02 账号管理（4 个接口）

| 方法 | 路径 | 功能 | 作用 |
| --- | --- | --- | --- |
| GET | `/users` | 账号分页列表，支持 `keyword` / `frozen` / `tier` 过滤 | 后台检索任意 C 端用户、按状态/档位定位风险或目标账号 |
| GET | `/users/catalog` | 筛选项与汇总（总数/冻结数/活跃数） | 为列表页提供过滤维度与运营概览数字 |
| GET | `/users/:accountId` | 账号详情：profile + 关联会员 + 审计摘要（手机号完整） | 进入单个用户视角的入口，支撑后续冻结/备注等处置 |
| POST | `/users/:accountId/mutate` | 账号写操作：冻结/解冻/备注（reason + version + 幂等） | 风控处置的统一落点；冻结即限制该账号 C 端能力，备注留痕供追溯 |

**action 枚举**：`freeze` / `unfreeze` / `update-note`（`update-note` 需 `note`）

**数据来源**：复用既有表 `users`；`frozen` / `note` / `version` 由本模块维护

---

### HQ-03 会员档案（4 个接口）

| 方法 | 路径 | 功能 | 作用 |
| --- | --- | --- | --- |
| GET | `/members` | 会员分页列表 | 后台浏览会员资产与归属，定位需干预的会员 |
| GET | `/members/catalog` | 筛选项与汇总 | 为会员列表提供过滤维度与概览 |
| GET | `/members/:memberId` | 会员详情（含归属门店名） | 查看会员完整档案与课时/资产，判断归属是否准确 |
| POST | `/members/:memberId/mutate` | 会员写操作：改资料/绑定或解绑门店/设状态 | 修正会员归属与状态，支撑合店/区域代理等跨身份关系维护 |

**action 枚举**：`update-profile` / `bind-store` / `unbind-store` / `set-status`

**数据来源**：复用既有表 `members`，附 `coStores` / `regionalAgents` / `hqStores` 反查门店名

---

### HQ-04 课程权益（5 个接口）

| 方法 | 路径 | 功能 | 作用 |
| --- | --- | --- | --- |
| GET | `/course/entitlements` | 课程权益分页列表 | 查看已发放的课程/训练营权益及其归属 |
| GET | `/course/catalog` | 筛选项与汇总 | 权益列表的过滤维度与概览 |
| GET | `/course/entitlements/:entitlementId` | 单条权益详情 | 查看某权益的发放对象、有效期与状态 |
| POST | `/course/entitlements/:entitlementId/mutate` | 权益写操作：发放/撤回/延期/改属性 | 运营按需纠正权益（如补偿延期、误发撤回） |
| POST | `/course/entitlements` | 新建课程权益发放记录 | 向指定用户授予课程访问权，是内容付费履约的后台动作 |

**action 枚举**：`grant` / `revoke` / `extend` / `update`

**数据来源**：新建 `hqCourseEntitlements`；只读引用 `hqProducts` / `skus`

---

### HQ-05 专栏内容（5 个接口）

| 方法 | 路径 | 功能 | 作用 |
| --- | --- | --- | --- |
| GET | `/columns/catalog` | 专栏筛选项与汇总 | 内容运营的过滤维度 |
| GET | `/columns/:columnId` | 专栏详情（含已发布章节） | 审核专栏内容与发布状态 |
| GET | `/columns/:columnId/records` | 专栏下的学习/购买记录 | 衡量专栏热度与转化，辅助内容决策 |
| POST | `/columns/:columnId/mutate` | 专栏写操作：发布/下架/更新/归档 | 控制专栏对 C 端的可见性，是内容上下架的统一闸门 |
| POST | `/columns/assets` | 上传/关联专栏素材资源 | 为专栏挂载音视频/图文资源，沉淀内容资产 |

**action 枚举**：`publish` / `unpublish` / `update` / `archive`

**数据来源**：复用既有表 `columns`（发布后同步 C 端）；草稿态存 `hqColumns` 视图；只读 `assets` / `learningProgress` / `members` / `orders` / `skus`

---

### HQ-06 公告（5 个接口）

| 方法 | 路径 | 功能 | 作用 |
| --- | --- | --- | --- |
| GET | `/announcements` | 公告分页列表 | 后台查看所有公告及发布状态 |
| GET | `/announcements/catalog` | 筛选项与汇总 | 公告列表的过滤维度 |
| GET | `/announcements/:announcementId` | 公告详情 | 查看单条公告全文与受众范围 |
| POST | `/announcements/mutate` | 新建公告 | 向全部或指定范围用户推送总部通知 |
| POST | `/announcements/:announcementId/mutate` | 公告写操作：发布/撤回/更新/删除 | 控制公告生命周期，紧急通知可即时撤回 |

**action 枚举**：`publish` / `unpublish` / `update` / `delete`

**数据来源**：新建 `hqAnnouncements`（当前库无对应业务表，落地待定）

---

### HQ-07 资料中心（5 个接口）

| 方法 | 路径 | 功能 | 作用 |
| --- | --- | --- | --- |
| GET | `/materials` | 资料分页列表 | 浏览总部下发的培训/营销资料 |
| GET | `/materials/catalog` | 筛选项与汇总 | 资料列表的过滤维度 |
| GET | `/materials/:materialId` | 资料详情与下载信息 | 查看资料元信息与访问链接 |
| POST | `/materials/mutate` | 新建资料 | 上传/登记一份可分发资料 |
| POST | `/materials/assets` | 上传资料素材文件 | 沉淀资料中心的文件资产 |

**action 枚举**：`publish` / `unpublish` / `update` / `delete`

**数据来源**：新建 `hqMaterials`（当前库无对应业务表，落地待定）；素材文件存 `assets`

---

### HQ-08 激活码（6 个接口）

| 方法 | 路径 | 功能 | 作用 |
| --- | --- | --- | --- |
| GET | `/activation-codes/batches` | 激活码批次列表 | 按批次追溯码量、已用/未用 |
| GET | `/activation-codes/batches/:batchId` | 批次详情与统计 | 查看某批次的发放与消耗情况 |
| GET | `/activation-codes` | 激活码分页列表（码面脱敏） | 检索具体激活码状态而不泄露完整码 |
| GET | `/activation-codes/catalog` | 筛选项与汇总 | 激活码列表的过滤维度 |
| POST | `/activation-codes/batches` | 新建激活码批次（生成 N 个码） | 批量制码用于渠道分发/活动投放 |
| POST | `/activation-codes/mutate` | 激活码写操作：启用/停用/作废/改归属 | 管控码的生命周期，防止失效码被滥用 |

**action 枚举**：`activate` / `deactivate` / `revoke` / `reassign`

**数据来源**：复用既有表 `activationCodes`；批次统计新建 `hqActivationBatches` 视图；只读 `hqProducts` / `skus`

---

### HQ-09 软件卡（5 个接口）

| 方法 | 路径 | 功能 | 作用 |
| --- | --- | --- | --- |
| GET | `/software-cards` | 软件卡分页列表 | 浏览已制软件卡及其绑定用户 |
| GET | `/software-cards/batches` | 软件卡批次列表 | 按批次追溯制卡与发放 |
| GET | `/software-cards/catalog` | 筛选项与汇总 | 软件卡列表的过滤维度 |
| POST | `/software-cards/batches` | 新建软件卡批次 | 批量制卡用于软件权益分发 |
| POST | `/software-cards/mutate` | 软件卡写操作：激活/停用/作废/绑定用户 | 管控软件卡使用权限，绑定即开通对应软件权益 |

**action 枚举**：`activate` / `deactivate` / `revoke` / `bind`

**数据来源**：新建 `hqSoftwareCards` / `hqSoftwareCardBatches`（当前库无对应业务表，落地待定）

---

### HQ-10 配额（4 个接口）

| 方法 | 路径 | 功能 | 作用 |
| --- | --- | --- | --- |
| GET | `/quotas` | 配额账户分页列表 | 查看各账号的剩余配额与阈值 |
| GET | `/quotas/catalog` | 筛选项与汇总 | 配额列表的过滤维度 |
| GET | `/quotas/:quotaId` | 配额账户详情与流水 | 追溯某账号配额的增减明细 |
| POST | `/quotas/:quotaId/mutate` | 配额写操作：调整/冻结/解冻/重置 | 运营干预配额（补偿发放、违规冻结），所有变动进 `quota_transactions` 留痕 |

**action 枚举**：`adjust` / `freeze` / `unfreeze` / `reset`

**数据来源**：复用既有表 `quotaLedger` / `quota_transactions`；账户态新建 `hqQuotaAccounts`

---

### HQ-11 商品（5 个接口）

| 方法 | 路径 | 功能 | 作用 |
| --- | --- | --- | --- |
| GET | `/products` | 商品分页列表 | 浏览总部商品目录 |
| GET | `/products/catalog` | 筛选项与汇总 | 商品列表的过滤维度 |
| GET | `/products/:productId` | 商品详情（含 SKU 与价格，两位小数） | 审核商品信息与定价 |
| POST | `/products/mutate` | 新建商品（含 SKU） | 上架一个新商品，是商城供给的后台源头 |
| POST | `/products/:productId/mutate` | 商品写操作：改资料/上下架/改价 | 维护商品生命周期与价格，改价经乐观锁防并发覆盖 |

**action 枚举**：`create` / `update` / `on-shelf` / `off-shelf` / `update-price`

**数据来源**：新建 `hqProducts` / `hqSkus`（当前库无对应业务表，落地待定）；金额两位小数强校验

---

### HQ-12 履约发货（5 个接口）

| 方法 | 路径 | 功能 | 作用 |
| --- | --- | --- | --- |
| GET | `/delivery/shipments` | 发货单分页列表 | 跟踪待发/已发/异常的履约单 |
| GET | `/delivery/catalog` | 筛选项与汇总 | 履约列表的过滤维度 |
| GET | `/delivery/shipments/:shipmentId` | 发货单详情 | 查看某单的收货人与物流状态 |
| POST | `/delivery/shipments/:shipmentId/mutate` | 发货单写操作：发货/妥投/取消/更新物流 | 推进履约状态，驱动 C 端订单物流更新 |
| POST | `/delivery/shipments` | 新建发货单 | 为订单登记发货，是实物履约的落点 |

**action 枚举**：`ship` / `deliver` / `cancel` / `update-tracking`

**数据来源**：新建 `hqShipments`（当前库无对应业务表，落地待定）；只读引用 `orders`

---

### HQ-13 订单（4 个接口）

| 方法 | 路径 | 功能 | 作用 |
| --- | --- | --- | --- |
| GET | `/orders` | 订单分页列表 | 后台检索全部订单及支付/履约状态 |
| GET | `/orders/catalog` | 筛选项与汇总 | 订单列表的过滤维度 |
| GET | `/orders/:orderId` | 订单详情（支付+履约双状态映射） | 核查单笔订单的全链路状态 |
| POST | `/orders/:orderId/mutate` | 订单写操作：标记已付/退款/取消/完结 | 人工干预订单（如线下收款标记、异常退款），双状态独立可追溯 |

**action 枚举**：`mark-paid` / `refund` / `cancel` / `complete`

**数据来源**：复用既有表 `orders`；只读引用 `coupons` / `payments` / `skus` / `stockLedger` / `users` / `hqShipments`

---

### HQ-14 优惠券（4 个接口）

| 方法 | 路径 | 功能 | 作用 |
| --- | --- | --- | --- |
| GET | `/coupons/catalog` | 筛选项与汇总 | 优惠券列表的过滤维度 |
| GET | `/coupons/templates` | 优惠券模板列表 | 管理可发放的券模板 |
| GET | `/coupons` | 已发放优惠券分页列表 | 查看用户持有的券及状态 |
| POST | `/coupons/mutate` | 优惠券写操作：建模板/改模板/发放/撤回 | 运营配置营销券并向用户发放或紧急撤回 |

**action 枚举**：`create-template` / `update-template` / `issue` / `revoke`

**数据来源**：新建 `hqCouponTemplates` / `hqUserCoupons`（当前库无对应业务表，落地待定）

---

### HQ-15 支付对账（6 个接口）

| 方法 | 路径 | 功能 | 作用 |
| --- | --- | --- | --- |
| GET | `/payments/catalog` | 筛选项与汇总 | 支付列表的过滤维度 |
| GET | `/payments` | 支付流水分页列表 | 核对渠道收款与系统内订单 |
| GET | `/payments/:paymentId` | 单笔支付详情 | 查看某笔支付的渠道回执 |
| GET | `/payments/jobs/:jobId` | 对账任务详情 | 查看一次对账作业的差异分类结果 |
| GET | `/payments/export` | 导出对账 CSV | 离线核对与财务归档 |
| POST | `/payments/mutate` | 支付写操作：触发对账/标记已结算/标异常/忽略 | 闭环资金核对，差异分类驱动财务跟进 |

**action 枚举**：`reconcile` / `mark-settled` / `flag-exception` / `ignore`

**数据来源**：新建 `hqPaymentsChannels` / `hqPaymentJobs` / `hqReconciliation`；只读引用 `payments`

---

### HQ-16 收益（5 个接口）

| 方法 | 路径 | 功能 | 作用 |
| --- | --- | --- | --- |
| GET | `/revenue/accounts` | 收益账户分页列表 | 查看各账号的可提现/冻结收益 |
| GET | `/revenue/catalog` | 筛选项与汇总 | 收益列表的过滤维度 |
| GET | `/revenue/ledgers` | 收益明细流水 | 逐笔追溯分润来源 |
| GET | `/revenue/accounts/:accountId` | 单账户收益详情 | 核查某账号收益构成 |
| POST | `/revenue/mutate` | 收益写操作：调整/冻结/解冻/结算 | 运营干预收益（纠错、风控冻结），结算联动提现 |

**action 枚举**：`adjust` / `freeze` / `unfreeze` / `settle`

**数据来源**：余额从既有表 `commissions` 实时汇总；账户态新建 `hqRevenueAccounts`

---

### HQ-17 提现（4 个接口）

| 方法 | 路径 | 功能 | 作用 |
| --- | --- | --- | --- |
| GET | `/withdrawals` | 提现申请分页列表 | 财务审核提现队列 |
| GET | `/withdrawals/catalog` | 筛选项与汇总 | 提现列表的过滤维度 |
| GET | `/withdrawals/:withdrawalId` | 提现详情（含手续费） | 核对提现金额与到账额 |
| POST | `/withdrawals/:withdrawalId/mutate` | 提现写操作：通过/驳回/已打款/冲正 | 财务结算闭环，打款后联动收益账户扣减 |

**action 枚举**：`approve` / `reject` / `paid` / `reverse`

**数据来源**：复用既有表 `withdrawals`；手续费 0.6% 最低 1 元

---

### HQ-18 员工与角色（5 个接口）

| 方法 | 路径 | 功能 | 作用 |
| --- | --- | --- | --- |
| GET | `/staff` | 员工分页列表 | 管理总部/门店员工 |
| GET | `/staff/catalog` | 筛选项与汇总 | 员工列表的过滤维度 |
| GET | `/staff/:staffId` | 员工详情与归属门店 | 查看员工档案与岗位 |
| POST | `/staff/mutate` | 新建员工 | 录入一名员工并分配角色 |
| POST | `/staff/:staffId/mutate` | 员工写操作：改资料/停用/分配门店 | 维护员工生命周期与门店归属 |

**action 枚举**：`create` / `update` / `disable` / `assign-store`

**数据来源**：新建 `hqStaff`（当前库无对应业务表，落地待定）；关联 `coStores` / `hqStores`

---

### HQ-19 门店（5 个接口）

| 方法 | 路径 | 功能 | 作用 |
| --- | --- | --- | --- |
| GET | `/stores` | 门店分页列表（合并视图） | 统一查看直营/合店/区域门店 |
| GET | `/stores/catalog` | 筛选项与汇总 | 门店列表的过滤维度 |
| GET | `/stores/:storeId` | 门店详情与负责人 | 查看门店经营与归属 |
| POST | `/stores/mutate` | 新建门店 | 开业登记一家新门店 |
| POST | `/stores/:storeId/mutate` | 门店写操作：改资料/停用/分配店主 | 维护门店生命周期与权属 |

**action 枚举**：`create` / `update` / `disable` / `assign-owner`

**数据来源**：多来源合并视图：复用 `users` / `members` + 新建 `hqStores` / `hqStaff`

---

### HQ-20 培训课时（5 个接口）

| 方法 | 路径 | 功能 | 作用 |
| --- | --- | --- | --- |
| GET | `/training/balances` | 课时余额分页列表 | 查看各会员剩余课时 |
| GET | `/training/feedback` | 培训反馈列表 | 收集课程评价改进内容 |
| GET | `/training/catalog` | 筛选项与汇总 | 课时列表的过滤维度 |
| GET | `/training/members/:memberId` | 单会员课时明细 | 追溯某会员课时增减 |
| POST | `/training/mutate` | 课时写操作：发放/扣减/冻结/重置 | 运营校正课时（补偿、误扣回补），整数防精度问题 |

**action 枚举**：`grant` / `deduct` / `freeze` / `reset`

**数据来源**：新建 `hqTrainingBalances`（课时为整数，非金额）；只读 `trainingFeedback` / `learningProgress` / `members`

---

### HQ-21 转店（4 个接口）

| 方法 | 路径 | 功能 | 作用 |
| --- | --- | --- | --- |
| GET | `/transfers` | 转店申请分页列表 | 审核门店转让流程 |
| GET | `/transfers/catalog` | 筛选项与汇总 | 转店列表的过滤维度 |
| GET | `/transfers/:applicationId` | 转店申请详情（含双方同意态） | 查看转让条件与双方确认状态 |
| POST | `/transfers/:applicationId/mutate` | 转店写操作：通过/驳回/完成/取消 | 闭环门店权属转移；**双方同意≠已迁移**，需本接口完成才生效 |

**action 枚举**：`approve` / `reject` / `complete` / `cancel`

**数据来源**：复用既有表 `coStores` / `storeTransfers`；视图新建 `hqStores`；只读 `hqAuditLogs`

---

### HQ-22 合伙人（4 个接口）

| 方法 | 路径 | 功能 | 作用 |
| --- | --- | --- | --- |
| GET | `/partners` | 合伙人分页列表 | 浏览合伙人及其等级 |
| GET | `/partners/catalog` | 筛选项与汇总 | 合伙人列表的过滤维度 |
| GET | `/partners/:contextId` | 合伙人档案详情（含权益，手机号脱敏） | 查看合伙人本金、权益与升级进度 |
| POST | `/partners/mutate` | 合伙人写操作：存档案/存权益/升级/降级 | 维护合伙人等级与权益；**等级只升不降**，降级需特殊审批 |

**action 枚举**：`save-context` / `save-benefits` / `promote` / `demote`

**数据来源**：新建 `hqPartnerContexts` / `hqPartnerBenefits`；只读 `users`

---

### HQ-23 邀请关系（4 个接口）

| 方法 | 路径 | 功能 | 作用 |
| --- | --- | --- | --- |
| GET | `/invitations` | 邀请关系分页列表 | 查看邀请绑定与上级链 |
| GET | `/invitations/:accountId` | 单账号邀请关系 | 查看某账号的邀请人与被邀人 |
| GET | `/invitations/:accountId/team` | 团队树（含 `graphVersion`） | 渲染某账号的下级团队结构 |
| POST | `/invitations/mutate` | 邀请写操作：绑定/解绑/重建/纠错 | 维护邀请图谱；`version`+`graphVersion` 双版本防并发成环 |

**action 枚举**：`bind` / `unbind` / `rebuild` / `correct`

**数据来源**：复用既有表 `inviteCodes` / `uplineHistory`；只读 `users`

---

### HQ-24 共创店（4 个接口）

| 方法 | 路径 | 功能 | 作用 |
| --- | --- | --- | --- |
| GET | `/costore/applications` | 共创店申请分页列表 | 审核共创店入驻 |
| GET | `/costore/catalog` | 筛选项与汇总 | 共创店列表的过滤维度 |
| GET | `/costore/applications/:applicationId` | 申请详情与方案 | 查看入驻方案与分成条款 |
| POST | `/costore/mutate` | 共创店写操作：通过/驳回/激活/终止 | 管控共创店生命周期与分成协议生效 |

**action 枚举**：`approve` / `reject` / `activate` / `terminate`

**数据来源**：新建 `hqCostorePlans` / `hqCostoreApplications`；只读 `coStores` / `hqStores`

---

### HQ-25 客服工单（5 个接口）

| 方法 | 路径 | 功能 | 作用 |
| --- | --- | --- | --- |
| GET | `/support/tickets` | 工单分页列表 | 客服后台处理用户问题 |
| GET | `/support/catalog` | 筛选项与汇总 | 工单列表的过滤维度 |
| GET | `/support/tickets/:ticketId` | 工单详情与对话 | 查看问题全貌与处理历史 |
| POST | `/support/tickets/:ticketId/mutate` | 工单写操作：回复/关闭/重开/分派/升级 | 推进工单处理闭环，SLA 与升级可追溯 |
| POST | `/support/tickets` | 新建工单 | 代用户建单或内部登记问题 |

**action 枚举**：`reply` / `close` / `reopen` / `assign` / `escalate`

**数据来源**：新建 `hqSupportTickets` / `hqSupportMessages`（当前库无对应业务表，落地待定）

---

### HQ-26 追踪溯源（4 个接口）

| 方法 | 路径 | 功能 | 作用 |
| --- | --- | --- | --- |
| GET | `/trace` | 全量审计轨迹分页（只读） | 安全与合规审计的总入口 |
| GET | `/trace/catalog` | 筛选项与汇总 | 审计列表的过滤维度 |
| GET | `/trace/:traceId` | 单条审计详情 | 查看一次操作的完整前后像 |
| GET | `/trace/by-request/:requestId` | 按请求 ID 追溯 | 通过 `X-Request-Id` 串联一次请求的全部副作用 |

**数据来源**：只读 `hqAuditLogs`（审计轨迹）；不参与写

---

## 4. 数据落库与 MySQL 同步

### 4.1 写操作落库路径

```
HTTP POST /api/hq/xxx/mutate
        │
        ▼
  分发器：鉴权 → 读 body → 计算幂等作用域/指纹
        │
        ▼
  模块 handler：校验 → 乐观锁 → 业务写入 db.json → 审计 → ctx.save()
        │
        ▼
  db.json（真源）
        │
        │ sync_to_mysql.js（单向镜像，DELETE FROM + 重建托管表）
        ▼
  MySQL 192.168.0.44:3307
```

### 4.2 幂等存储的持久化

幂等记录存于 `db.hqIdempotency`（**键值映射**，非数组）。
每次请求都会调用 `ensureCollections(db)`，该函数**只补齐缺失集合，绝不重置已有集合**——
这一点至关重要：若幂等存储被重置，重复提交将永远命中不了缓存。

### 4.3 托管表禁写

- 判定口径：`scripts/managed_tables.js`（静态扫描 `mapping.js` 的 `insert(...)` 字面量 + `GENERIC` 补充声明）。
- 托管表在浏览器端 MySQL 可视化工具中**禁止直接写入**。
- **绝不要直写 MySQL** —— 同步器会整表重建，数据秒级丢失。

---

## 附录 A：模块 → 数据表对照

| 模块 | 复用既有表 | 新建 hq* 集合 | MySQL 状态 |
| --- | --- | --- | --- |
| HQ-01 登录与会话 | — | `hqAdmins` | 待补（附录 C） |
| HQ-02 账号管理 | `users` `members` | `hqAuditLogs` | 账号表已在 MySQL |
| HQ-03 会员档案 | `members` `coStores` `regionalAgents` | `hqStores` `hqAuditLogs` `hqTrainingBalances` `hqCourseEntitlements` | 会员表已在 MySQL |
| HQ-04 课程权益 | `skus` | `hqCourseEntitlements` `hqProducts` `hqAuditLogs` | 待补 |
| HQ-05 专栏内容 | `columns` `assets` `members` `orders` `learningProgress` | `hqColumns` `hqProducts` `hqAuditLogs` | 专栏表已在 MySQL |
| HQ-06 公告 | — | `hqAnnouncements` `hqAuditLogs` | 待补 |
| HQ-07 资料中心 | `assets` | `hqMaterials` `hqAuditLogs` | 待补 |
| HQ-08 激活码 | `activationCodes` `skus` | `hqProducts` `hqActivationBatches` | 激活码表已在 MySQL |
| HQ-09 软件卡 | `skus` | `hqSoftwareCards` `hqSoftwareCardBatches` | 待补 |
| HQ-10 配额 | `quotaLedger` `quota_transactions` | `hqQuotaAccounts` `hqAuditLogs` | 配额表已在 MySQL |
| HQ-11 商品 | `skus` | `hqProducts` `hqSkus` | 待补 |
| HQ-12 履约发货 | `orders` | `hqShipments` | 待补 |
| HQ-13 订单 | `orders` `payments` `stockLedger` `coupons` `users` `skus` | `hqShipments` `hqAuditLogs` | 订单表已在 MySQL |
| HQ-14 优惠券 | — | `hqCouponTemplates` `hqUserCoupons` | 待补 |
| HQ-15 支付对账 | `payments` | `hqPaymentsChannels` `hqPaymentJobs` `hqReconciliation` `hqAuditLogs` | 支付表已在 MySQL |
| HQ-16 收益 | `commissions` `users` | `hqRevenueAccounts` `hqRevenueLedgers` | 待补 |
| HQ-17 提现 | `withdrawals` | `hqAuditLogs` | 提现表已在 MySQL |
| HQ-18 员工与角色 | `coStores` | `hqStaff` `hqStores` | 待补 |
| HQ-19 门店 | `users` `members` `coStores` | `hqStores` `hqStaff` | 待补 |
| HQ-20 培训课时 | `members` `learningProgress` `trainingFeedback` | `hqTrainingBalances` `hqTrainingFeedback` | 待补 |
| HQ-21 转店 | `storeTransfers` `coStores` | `hqTransfers` `hqStores` `hqAuditLogs` | 转店表已在 MySQL |
| HQ-22 合伙人 | `users` | `hqPartnerContexts` `hqPartnerBenefits` `hqAuditLogs` | 待补 |
| HQ-23 邀请关系 | `users` `inviteCodes` `uplineHistory` | — | 已在 MySQL |
| HQ-24 共创店 | `coStores` | `hqCostorePlans` `hqCostoreApplications` `hqStores` `hqAuditLogs` | 待补 |
| HQ-25 客服工单 | — | `hqSupportTickets` `hqSupportMessages` | 待补 |
| HQ-26 追踪溯源 | — | `hqAuditLogs` | 待补 |

---

## 附录 B：落地待定项清单

以下模块**当前库无对应业务表**，本次以独立 `hq*` 集合实现，接口真实可跑通，
但 **MySQL 侧尚未建表、尚未纳入同步映射**。补表方案见附录 C。

| 编号 | 模块 | 涉及集合 | 影响面 | 优先级 |
| --- | --- | --- | --- | --- |
| B-01 | HQ-06 公告 | `hqAnnouncements` | 公告仅在 db.json，运营侧需查 MySQL 时不可见 | 中 |
| B-02 | HQ-09 软件卡 | `hqSoftwareCards` `hqSoftwareCardBatches` | 卡密数据仅在 db.json | 中 |
| B-03 | HQ-11 商品 | `hqProducts` `hqSkus` | 商品台账仅在 db.json | **高**（商品是核心域） |
| B-04 | HQ-14 优惠券 | `hqCouponTemplates` `hqUserCoupons` | 券台账仅在 db.json | **高**（涉及资金） |
| B-05 | HQ-25 客服工单 | `hqSupportTickets` `hqSupportMessages` | 工单仅在 db.json | 低 |

> 另：`hqAuditLogs`（审计日志）、`hqAdmins`（管理员）、`hqStaff` / `hqStores`（员工/门店）、
> `hqRevenueAccounts` / `hqRevenueLedgers`（收益）、`hqTrainingBalances`（课时）、
> `hqPaymentsChannels` / `hqPaymentJobs` / `hqReconciliation`（支付对账）、
> `hqPartnerContexts` / `hqPartnerBenefits`（合伙）、`hqCostorePlans` / `hqCostoreApplications`（共创）、
> `hqQuotaAccounts`（配额账户）、`hqShipments`（发货单）、`hqCourseEntitlements`（课程权益）、
> `hqMaterials`（资料）、`hqColumns`（专栏草稿）同理，均为待补状态。

---

## 附录 C：HQ 集合进 MySQL 的补表与同步映射方案

### C.1 现状

当前 `db.json` 共 **69** 个集合，其中被同步器托管（禁写）**15** 个、可写 **54** 个。
**全部 `hq*` 集合目前都落在「可写」一侧** —— 因为 `scripts/mapping.js` 尚未声明它们，
同步器既不会创建也不会刷新这些表。

> ⚠️ **这里有一个陷阱**：若同事此刻在浏览器端 MySQL 工具里直接写 `hqproducts` 等表，
> 界面是放行的；等我们后续把映射加进 `mapping.js`，同步器就会
> `DELETE FROM` + 整表重建 → **同事写入的数据被静默抹掉**。

### C.2 补表步骤（**顺序不可颠倒**）

对每个需要补的 `hq*` 集合，按以下顺序执行：

**① 建 MySQL 表**（建议 `utf8mb4` + `InnoDB`）

```sql
-- 示例：hq_audit_logs（审计日志）
CREATE TABLE IF NOT EXISTS `hq_audit_logs` (
  `id`           VARCHAR(64)  NOT NULL COMMENT '审计 ID',
  `module`       VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '模块',
  `action`       VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '动作',
  `target_id`    VARCHAR(64)  DEFAULT NULL COMMENT '目标 ID',
  `operator_id`  VARCHAR(64)  NOT NULL DEFAULT 'admin' COMMENT '操作人 ID',
  `operator_name` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '操作人名称',
  `reason`       VARCHAR(512) DEFAULT NULL COMMENT '操作原因',
  `before_json`  JSON DEFAULT NULL COMMENT '变更前',
  `after_json`   JSON DEFAULT NULL COMMENT '变更后',
  `occurred_at`  VARCHAR(40) DEFAULT NULL COMMENT '发生时间(ISO)',
  `request_id`   VARCHAR(64) DEFAULT NULL COMMENT '请求 ID',
  PRIMARY KEY (`id`),
  KEY `idx_hq_audit_logs_module` (`module`),
  KEY `idx_hq_audit_logs_target` (`target_id`),
  KEY `idx_hq_audit_logs_time` (`occurred_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='总部后台审计日志';
```

**② 加进 `scripts/mapping.js`**（`forEachInsert` 中声明）

```js
// hqAuditLogs → hq_audit_logs
forEachInsert(db.hqAuditLogs, 'hq_audit_logs', [
  ['id', 'id'], ['module', 'module'], ['action', 'action'],
  ['targetId', 'target_id'], ['operatorId', 'operator_id'],
  ['operatorName', 'operator_name'], ['reason', 'reason'],
  ['before', 'before_json'], ['after', 'after_json'],
  ['occurredAt', 'occurred_at'], ['requestId', 'request_id'],
]);
```

> 加进 `mapping.js` **之后**，`scripts/managed_tables.js` 会通过静态扫描
> `insert('表名', ...)` 字面量自动把它纳入托管集合 →
> **浏览器端立即禁写**，杜绝「界面放行、同步器照样覆盖」的静默丢失。
> 这就是「先加映射、再放开数据」的顺序。

**③ 补 `scripts/managed_tables.js` 的 `GENERIC`**（仅当 db.json 集合名与 MySQL 表名不一致时）

```js
const GENERIC = [
  // ...
  ['hqAuditLogs', 'hq_audit_logs'],
  ['hqProducts', 'hq_products'],
  ['hqUserCoupons', 'hq_user_coupons'],
];
```

**④ 验证**

```bash
node -e "
const m=require('./scripts/managed_tables');
const fs=require('fs');
const db=JSON.parse(fs.readFileSync('data/db.json','utf8'));
const all=Object.keys(db).filter(k=>Array.isArray(db[k]));
const r=m.classifyTables(db, all);
console.log('托管(禁写):', r.managed.length, '可写:', r.safe.length);
console.log('hq* 是否已全部纳入托管:',
  all.filter(k=>k.startsWith('hq')).every(k=>r.managed.includes(k.toLowerCase())));
"
```

### C.3 命名约定

| db.json 集合 | MySQL 表名 |
| --- | --- |
| `hqAuditLogs` | `hq_audit_logs` |
| `hqProducts` | `hq_products` |
| `hqUserCoupons` | `hq_user_coupons` |
| `hqSoftwareCards` | `hq_software_cards` |
| `hqCouponTemplates` | `hq_coupon_templates` |
| `hqSupportTickets` | `hq_support_tickets` |
| …其余同理（驼峰 → 下划线） | |

### C.4 金额字段

所有金额字段在 MySQL 侧统一 `DECIMAL(18,2)`（单位：元）。
**不要用 `INT` 存分** —— 这与 db.json 的 JSON `number` 口径会不一致。

---

## 附录 D：验证与回归

### D.1 HQ API 端到端验证

```bash
node scripts/verify_hq_api.js            # 默认 http://127.0.0.1:3000
node scripts/verify_hq_api.js http://127.0.0.1:3001
```

覆盖 10 组共 **25 项**断言：

| 组 | 内容 |
| --- | --- |
| 1 | 鉴权拦截（未登录 / 错误口令 / 伪造 token → 40100） |
| 2 | 登录 → token → `/auth/me` |
| 3 | **全部 82 个 GET 接口路由命中**（26 模块） |
| 4 | 分页（`pageSize` 上限截断为 100） |
| 5 | 写操作闭环（reason 必填 / 乐观锁 / 幂等 / 幂等冲突 / 审计） |
| 6 | 错误码语义（40400 / 40000） |
| 7 | 审计与追踪溯源（HQ-26） |
| 8 | 金额单位为元、两位小数 |
| 9 | 敏感字段脱敏 |
| 10 | 登出后 token 失效 |

### D.2 既有回归测试（696 项全绿）

```bash
node scripts/smoke_connect.js          # 94 项
node scripts/verify_pay_and_codes.js   # 55 项
node scripts/verify_biz_loop.js        # 47 项
node scripts/verify_product_order.js   # 163 项
node scripts/verify_product_split.js   # 140 项
node scripts/verify_h5_contract.js     # 129 项
node scripts/verify_member_tiers.js    # 68 项
```

### D.3 服务托管

Windows 计划任务 `WorkBuddyNaoshangApi`（SYSTEM 账户，开机自启，崩溃 1 分钟重启），
日志重定向至 `C:\ProgramData\NaoshangAI\api.out.log`。
相关任务：`Sync`（MySQL 同步）、`Viewer`（数据库可视化）。

---

## 相关文档

- [API文档.md](./API文档.md) —— 平台总览（C 端 / 管理端接口索引）
- [前端对接API文档.md](./前端对接API文档.md) —— 前端对接说明
- [数据库设计.md](./数据库设计.md) —— 表结构与编号规则
- [用户身份与ID编号设计.md](./用户身份与ID编号设计.md) —— 身份与编号口径
