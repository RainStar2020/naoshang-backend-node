# 脑商AI合伙人 · 前端对接 API 文档（H5 契约层）

> 服务：`E:\脑商ai\server\server.js`　启动：`node server.js`（默认端口 `3000`，可用 `PORT` 覆盖）
> 管理员密码：`admin888`（`ADMIN_PASSWORD` 环境变量覆盖）
> 本文档面向**前端开发**，只覆盖前端要连的 **H5 契约层**（`/auth`、`/me`、`/partner`、`/orders`、`/wallet`…）。
> 管理端 `/api/*`（总部后台）见 `docs/API文档.md`，前端 App 不需要连。
>
> **2026-10-26 更新（v3.0）**：P0-1 ~ P0-9 全部落地，本轮新增
> ① 名额**双余额**（标准/活动）② **升级服务费**（活动名额 × 2000）③ 经验值与晋升任务
> ④ 订单支付超时 ⑤ 线下核销 ⑥ 分红门槛可配 ⑦ 收益业务类型多态 ⑧ 分配意愿自选
> ⑨ 代理申请费用明细/门店合店老板数 ⑩ 密码哈希化与支付沙箱收敛。

---

## 0. 联调须知（务必先读）

| 项 | 约定 |
|---|---|
| **BaseURL** | `http://<后端地址>:3000`。小程序真机调试**不能用 127.0.0.1**，须用手机可访问的局域网 IP 或正式域名 |
| **鉴权** | `Authorization: Bearer <token>`（也支持 `?token=<token>` 查询参数）。协议正文 `/agreements/` 例外：免登录可读 |
| **登录入口** | `POST /auth/sessions`（**不是** `/api/auth/login`） |
| **返回格式** | 全部 JSON；错误统一 `{ "error": "中文错误信息" }`，HTTP 状态码 400/401/403/404/409 |
| **contextId** | 经营类接口必传，形如 `partner:<userId>` / `costore:<userId>` / `agency:<userId>`。**GET 用 query、POST 用 body** |
| **金额单位** | **元**（两位小数）。后端内部按元计算，前端直接展示，**不要**自行乘 100 |
| **幂等** | 所有"提交"类接口接受 `idempotencyKey`（字符串），重复提交返回同一结果 |
| **三段式** | 经营操作统一 `options`（拉选项）→ `quotes`（试算）→ `xxx`（提交） |
| **分页** | 列表统一返回 `{ items, hasMore, nextCursor }`，当前多为 `hasMore:false` |
| **支付模式** | 响应里的 `paymentMode`：`sandbox`（免支付直通，联调用）/ `live`（需调起渠道）。生产必须 `live` |
| **验证码** | 响应**不再回传**验证码（生产安全）。联调需验证码时，服务端设 `EXPOSE_DEV_CODE=1` 启动，此时响应带 `devCode` |
| **时间戳** | 部分字段是毫秒时间戳（`createdAt`），部分是 ISO 字符串，字段级说明以各接口为准 |

**种子账号**（`POST /api/seed/reset` 可重置）：`13800000001`（联创）… `13800000007`（合店老板）。

---

## 1. 认证与身份（§3）

### 1.1 登录 `POST /auth/sessions`

**入参**：`{ channel: "parent" | "admin" | "coach", phone?, password?, loginAccount? }`

**出参**
```json
{
  "token": "user-abc12...",
  "user": { "id": "p1", "name": "总部联创-甲", "role": "user", "displayId": "LC0001" },
  "entitlement": { "state": "active", "amount": 200 },
  "accountType": "parent",
  "expiresAt": null
}
```
- `channel: "parent"` → 需 `phone`；`"admin"` → 需 `password`；`"coach"` → 需 `loginAccount`（健脑官）。
- `entitlement.state`：`never_paid`（未开通）/`active`（已开通）/`expired`（已过期）。**未开通时收益照算但不可见不可提**，前端要按此态提示。

### 1.2 注册 `POST /auth/registrations`
入参 `{ phone, password, name?, inviteCode? }` → 出参同登录（含 token，自动登录）。

### 1.3 短信验证码 `POST /auth/sms-challenges`
入参 `{ phone, purpose: "register" | "reset-password" }` → 出参 `{ retryAfter: 60, expiresAt }`。
> ⚠️ 默认**不回传** `devCode`。本地联调请服务端设 `EXPOSE_DEV_CODE=1`，此时出参多 `devCode` 字段。

### 1.4 密码重置 `POST /auth/password-reset-verifications` → `POST /auth/password-resets`
前者入参 `{ phone, code }` → `{ resetTicket }`；后者入参 `{ resetTicket, password }` → `{ success: true }`。

### 1.5 修改密码 `POST /me/password-changes`
入参 `{ oldPassword, newPassword }`（≥6 位）→ `{ changed: true }`；原密码错返回 `400 原密码错误`。
> 密码已在服务端存为 scrypt 哈希，明文不出库。

### 1.6 首页上下文 `GET /me/bootstrap`（**前端启动必调**）
出参关键字段：
```json
{
  "user": { "id": "p1", "name": "...", "displayId": "LC0001" },
  "entitlement": { "state": "active", "amount": 200 },
  "businessContexts": [
    { "id": "partner:p1", "accountId": "p1", "module": "partner", "label": "合伙人" },
    { "id": "agency:p1",   "accountId": "p1", "module": "agency",   "label": "区域代理" }
  ]
}
```
> `businessContexts[].id` 就是后续接口要传的 `contextId`，前端身份切换栏直接用它。

### 1.7 登出 `DELETE /auth/sessions/current`

---

## 2. 名额双余额与升级服务费（🆕 P0-3 / P0-4 · 前端重点）

原型屏 35/36/43 的数据源。**核心规则**：
- 名额分**标准名额**（无限期、可划拨）和**活动名额**（1 年有效期、先过期先扣）。
- 升级时上级每动用 1 个**活动名额**，向买方加收 **¥2000 服务费**；**标准名额不计服务费**。
- 服务费与合伙人费**分开付**：`totalPayable = 合伙人差价 + 服务费`。

### 2.1 名额台账 `GET /partner/quota-ledger?contextId=partner:<userId>`
```json
{ "standardRemaining": 10, "activityRemaining": 4, "items": [] }
```

### 2.2 升级选项（升级页首屏） `GET /partner/upgrade-options?contextId=partner:<userId>`
```json
{
  "principalTier": "vip",
  "principal": 3500,
  "currentTier": "vip",
  "standardRemaining": 10,
  "activityRemaining": 4,
  "quotaBalances": { "standard": 10, "activity": 4 },
  "serviceFeeRule": {
    "perActivityQuota": 2000,
    "standardQuotaFree": true,
    "activityValidityDays": 365
  },
  "sellerBalances": { "standard": 30, "activity": 6 },
  "pricingNote": "升级实付 = 目标档一口价 − 本金档一口价（非当前档）；名额按增量消耗",
  "upgradePlans": [
    {
      "from": "vip", "to": "angel",
      "amount": 12000,                 // 合伙人差价（不含服务费）
      "quotaCount": 2,                 // 本次消耗名额增量
      "currentTierQuota": 1, "targetTierQuota": 3,
      "principalDeducted": 3500,
      "usedActivityQuota": 2,          // ★ 实际动用活动名额数
      "usedStandardQuota": 0,          // ★ 实际动用标准名额数
      "serviceFee": 4000,              // ★ 服务费 = usedActivityQuota × 2000
      "serviceFeePerActivity": 2000,
      "totalPayable": 16000,           // ★ 应付合计 = amount + serviceFee
      "label": "VIP合伙人 → 天使合伙人"
    }
  ]
}
```
> 前端渲染：按钮文案 `支付¥{totalPayable}立即升级`；费用明细行 `服务费计价规则 ¥2000.00/个活动名额`、`本次升级消耗 {usedActivityQuota}个活动名额，{usedStandardQuota}个标准名额`、`本次升级需缴纳服务费 ¥{serviceFee}`。

### 2.3 升级试算 `POST /partner/upgrade-quotes`
**入参**（body）：`{ contextId: "partner:p1", targetLevel: "angel", targetAccountId?: "p1" }`
**出参**
```json
{
  "id": "quote_xxx", "contextId": "partner:p1",
  "targetLevel": "angel", "targetAccountId": "p1",
  "amount": 12000, "quotaCount": 2,
  "principalTier": "vip", "principal": 3500,
  "serviceFeePerActivity": 2000,
  "serviceFeeEstimate": 4000,
  "usedActivityQuota": 2, "usedStandardQuota": 0,
  "totalPayable": 16000,
  "label": "VIP合伙人 → 天使合伙人",
  "expiresAt": 1756000000000, "serverTime": 1756000000000
}
```

### 2.4 提交升级 `POST /partner/upgrades`
**入参**：`{ contextId: "partner:p1", targetLevel: "angel", targetAccountId?: "p1", idempotencyKey?: "..." }`
**出参**
```json
{
  "status": "SUCCEEDED",
  "operationId": "op_xxx",
  "orderId": "o_18",
  "balances": { "standardRemaining": 10, "activityRemaining": 2 },
  "settlement": {
    "mode": "upgrade",
    "oldTier": "vip", "targetLevel": "angel",
    "quotaCount": 2,
    "actual_paid": 12000,        // 合伙人差价
    "supplySpread": 3000,        // 供货链级差（归上级）
    "serviceFee": 4000,          // ★ 服务费（归总部）
    "serviceFeePerActivity": 2000,
    "totalPayable": 16000,
    "quotaUsedStandard": 0, "quotaUsedActivity": 2,
    "storeFee": 0, "hqFee": 4000, "channel": "partner",
    "items": [ { "owner_id": "p1", "type": "supply", "amount": 3000, "formula": "…" } ]
  }
}
```

### 2.5 名额进货（联创向总部买） `GET /partner/quota-purchase-options` / `POST /partner/quota-purchase-quotes` / `POST /partner/quota-orders`
- options：`{ unitAmount: 6500, purchaseMode: "PAYMENT", pricingLabel, allowedPaymentChannelIds: ["unionpay"], standardRemaining, activityRemaining, paymentMode }`
- quotes 入参 `{ contextId, quantity }` → `{ unitAmount, quantity, amount, expiresAt }`
- orders 入参 `{ contextId, quantity, channel: "unionpay", idempotencyKey? }` → sandbox 返回 `{ status:"SUCCEEDED", balances }`；live 返回 `{ status:"CREATED", payParams }`。
> 进货**只增加标准名额**，活动名额只能由总部后台发放。

### 2.6 名额划拨 `GET /partner/quota-transfer-options` / `POST /partner/quota-transfer-quotes` / `POST /partner/quota-transfers`
> ⚠️ 划拨**只动标准名额**，活动名额不可划转（`senderActivityRemaining` / `receiverActivityRemaining` 仅作展示）。

### 2.7 名额明细 `GET /partner/quotas`（占位，返回空 items）

---

## 3. 经营看板与收益（§9）

### 3.1 合伙人总览 `GET /partner/overview?contextId=partner:<userId>`
```json
{
  "accountId": "p1", "contextId": "partner:p1", "displayId": "LC0001",
  "levelName": "联创合伙人", "partnerStatus": "active",
  "experience": 19960,
  "experienceDetail": { "promotion": 9980, "product": 9980 },
  "experienceTarget": 0,
  "quotaBalance": 104,              // 总名额余额（标准+活动）
  "monthIncome": 4800,
  "monthByType": { "supply": 3000, "parity": 1200 },
  "teamVip": 3,
  "principalTier": "cofounder",     // ★ 本金档（升级价以此为减数）
  "principal": 180000,              // ★ 本金（已付过的最高档一口价）
  "referralFreeUpgrade": { … },     // 拉人免费升档进度
  "promotionTask": { … },           // 晋升任务（同 /partner/promotion-tasks 的 task 段）
  "dividendPrompt": "您每月需要业绩达标 2900 元才能享有分红权益，当前业绩 0/2900"
}
```
> `principalTier` / `principal` 是**本金锚点**（实际付过钱的最高档），前端做"补差价"文案时用它，不要用当前档。

### 3.2 我的收益 `GET /partner/income?contextId=partner:<userId>`
按月/类型的收益汇总（`items` 列表 + `total`）。

### 3.3 团队树 `GET /partner/team?contextId=partner:<userId>`
树形结构（`children` 递归），用于层级图。

### 3.4 收益明细列表 `GET /income/entries?contextId=partner:<userId>&identity=partner|agent|costore`
出参 `{ metrics: [{ label:"收益合计", kind:"money", value }], items: [...], hasMore, nextCursor }`，每条明细：
```json
{
  "id": "c_xx",
  "title": "供应差价", "category": "supply",   // 收益类型中文名 + 原始类型
  "amount": 3000, "rate": 0.05, "baseAmount": 60000,
  "createdAt": 1756000000000,
  "status": "SETTLED",
  "allocationStatus": "NONE",                  // ★ NONE / PENDING / SETTLED
  "allocationKind": null,                     // ★ 可分配池类型（inspect / sales / null）
  "settlementStatus": "SETTLED",
  "sourceOrder": "o_18",
  "bizType": "supply_chain",                  // ★ 业务类型（14 类）
  "bizTypeLabel": "供应链费",                  // ★
  "bizDetail": { … },                         // ★ 业务详情（随 bizType 变化）
  "rateLabel": "供货差价",                     // ★ 业务提点文案
  "recommendedBy": { "id": "p1", "name": "…" },   // ★ 推荐人
  "purchaser": { "id": "p4", "name": "…" },       // ★ 购买人
  "deliveryStore": { "id": "p6", "name": "…" }    // ★ 交付门店
}
```
> 列表接口**不返回** `allowedActions`；要点「分配」按钮请调详情接口或 `allocation-options`。
**bizType 枚举（14 类，实际值）**：`agent_fee`（代理费）/`service_fee`（服务费）/`staff_fee`（店员费）/`supply_chain`（供应链费）/`software_fee`（软件卡抽成费）/`featured`（特色产品）/`column`（专栏课）/`quota`（合伙人名额）/`product_commission`（产品提成）/`admin_fee`（行政费）/`costore`（合店费）/`global`（全球奖）/`founding`（创始奖）/`other`（其他收益）。

### 3.5 收益明细详情 `GET /income/entries/{id}?contextId=partner:<userId>`
```json
{
  "id": "c_xx", "title": "巡查服务费", "category": "region_vip",
  "channel": "H5", "paymentTypeLabel": "微信支付",
  "identityLabel": "合伙人/区域代理",
  "baseAmount": 10000, "rateBps": 500,
  "amount": 500, "createdAt": 1756000000000,
  "allocationKind": "inspect",
  "allocationStatus": "NONE", "settlementStatus": "SETTLED",
  "beneficiaryName": "门店老板-己",
  "recommended": false,
  "buyer": { "id": "p4", "name": "…" },
  "store": { "id": "330110", "name": "门店 330110" },
  "sourceOrder": "o_18",
  "allowedActions": ["allocate"],   // ★ 只有可分配池明细才含 allocate
  "version": 1, "formula": "…", "note": null,
  "bizType": "service_fee", "bizTypeLabel": "服务费", "bizDetail": { … }, "rateLabel": "定额"
}
```
> `allowedActions` 为 `[]` 时不显示「分配」按钮；`allocationKind` 为 `null` 表示不在可分配池。
> 可分配池为 `inspect`（巡查 5%）与 `sales`（销售 5%）。非池明细 `allowedActions` 为 `[]`、`allocationKind` 为 `null`。

### 3.6 分红权益 `GET /partner/dividend-rights?contextId=partner:<userId>&months=6&kind=memberCard|promotion`
```json
{
  "prompt": "您每月需要业绩达标 2900 元才能享有分红权益，当前业绩 0/2900",
  "metrics": [
    { "label": "分红合计", "kind": "money", "value": 4188 },
    { "label": "可提现分红", "kind": "money", "value": 4188 },
    { "label": "无分红权（暂不可提现）", "kind": "money", "value": 0 }
  ],
  "threshold": { "memberCardThreshold": 2900, "promotionThreshold": 2900 },
  "items": [
    { "period": "2026-10", "eligibility": "当月有分红权", "amount": 2094, "withdrawable": true }
  ],
  "summary": { "totalAmount": 4188, "withdrawableAmount": 4188, "withheldAmount": 0 }
}
```
> `threshold` 门槛**后台可配**（默认 2900），前端不要写死。`kind=memberCard`（会员卡分红）/ `kind=promotion`（推广分红）各自独立门槛。

### 3.7 分红明细 `GET /costore/card-dividends` / `GET /costore/promotion-dividends`
逐月记录，`eligibility` 取值 `当月有分红权` / `当月无分红权`；无分红权月份**金额照记但不可提现**。

### 3.8 全球奖 `GET /partner/global-awards?contextId=partner:<userId>`
奖池、你的全球奖、加权/业绩拆分。

### 3.9 创始奖 `GET /founder-awards?contextId=partner:<userId>`

---

## 3.5 门店收益规则表（拨比表口径） `GET /income/store-income-rules?contextId=partner:<userId>`

> 🆕 **2026-10-27** 按用户拨比表落地：**门店收益随商品类型不同，各不相同**；
> 且**门店收益 ≠ 合店老板收益**，两者分属两条独立账。

### 3.5.1 各类商品的门店收益规则（拨比表口径）

| 商品类型 | 示例 | 收益模式 | 门店拿多少 | 可再分配提点 |
|---|---|---|---|---|
| 实物产品 | 脑商Pad 6980 | 拿货差价 | 卖价 − 拿货价（区县拿货 40% → 2792；天使价 5235 → 利润 2443） | 无 |
| AI软件卡 | 记忆卡 998 | 拿货差价（固定拿货价） | 卖价 − 固定拿货价（省150/市170/区县250/单店350 元/张；单店 350；折扣价仍按合伙人/代理折扣表，如私董价 698.6） | 无 |
| **特色产品** | 陪练卡 2000（私董7折=1400 / 省代映射联创6.5折=1300）/ 特色营 10000（固定成本 8000，拨比价 2000；私董7折=9400 / 联创6.5折=9300 / 原价10000） | **比例分成池** | **单店 65% = 交付 30% + 流量 30% + 销售 5%** | **区县 5% 巡查** + **单店 5% 销售** |
| ↳ 特色产品·代理计价 | 代理买家按「对应合伙人档位」计价（省代→联创/市代→私董/区县代→天使/单店→VIP），不享受代理折扣；分成池 = 成交价 − 固定成本 = 变动成本2000 × 合伙人折扣 | — | — | — |
| 行政费用 | 集训营行政费 2000 | 5/5/90 | 销售门店 5%（总部 5% + 上课团队 90%） | 无 |

**特色产品分成池明细**（拨比表，合计 100%）：
总部 系统 15% · 省代 管理 2% · 市代 管理 8% · 区县代 管理 5% + **巡查 5%** · 单店 交付 30% + 流量 30% + **销售 5%**
> 算例（池 1300）：195 / 26 / 104 / 65 / 65 / 390 / 390 / 65 = 1300 ✓
> 算例（特色营 池 2000）：300 / 40 / 160 / 100 / 100 / 600 / 600 / 100 = 2000 ✓

### 3.5.3 商城身份打折：孩子没有折扣，商城只认购买者本人的身份（2026-10-27）

**前端如何"识别"家长身份**：会话里带的是**购买者自己的 userId**（`sess.userId`），后端据此查两样东西：
① `users.tier`（合伙人档位）② `regionalAgents`（代理身份）。**前端不需要做任何身份判定**，也不需要传任何身份参数。

> ⚠️ **绝对不要用 `displayId` 前缀判身份**。家长加孩子后对外编号前缀会跟着孩子走
> （联创家长 + 粉丝孩子 → `FS0001`），但 `users.tier` 与代理记录**都不变**，
> 所以商城仍按家长真实的合伙人/代理身份给价。计价优先级：
> **代理身份 > 合伙人档位 > 原价**。
> **孩子没有折扣**——孩子的会员等级只影响编号前缀与内容权益，不参与计价；
> `memberId` 仅作为**服务对象**记录在订单上。

**前端改动点**：
| 接口 | 字段 | 用途 |
|---|---|---|
| `GET /catalog`、`GET /products/{id}` | `viewerPrice: { unitAmount(分), listAmount, applied, discountLabel, identityLabel }` | 商品页显示"你的价 ¥4537 · 联创合伙人 6.5折"；未登录不返回该字段 |
| `GET /checkout/options` | `members[]` 增加 `memberLevel` / `levelLabel` / `displayId` | 孩子选择器显示孩子身份（仅展示，不影响价格） |
| `POST /orders` | 请求体可带 `memberId` | 记录服务对象（哪个孩子），**不影响价格** |

### 3.5.2 门店收益 ≠ 合店老板收益（两条独立账）

| | 门店收益 | 合店老板收益 |
|---|---|---|
| 来源 | 门店**卖货**获得的分润 | 合店老板**交合店费入股**获得的分配 |
| 计算规则 | 随商品类型按上表（拿货差价 / 比例分成池 / 5-5-90） | 门店服务 40% + 直推 13% + 复购 2% + 分红池 10% |
| 台账 type | `product` | `costore` |
| bizType | `featured` / `supply_chain` / `software_fee` … | `costore` |
| 身份栏 | 区域代理 | 合店老板 |
| 接口字段 | `incomeChannel: "storeIncome"` | `incomeChannel: "costoreOwnerIncome"` |

> 收益列表 / 收益详情每条都带 `incomeChannel` 与 `incomeChannelLabel`。
> 同一人同时是门店与合店老板时，两条线**分别展示、不可合并统计**。

**出参**：
```json
{
  "rules": [
    { "kind": "physical", "label": "实物产品", "mode": "tierDiff", "storeBenefit": "卖价 − 拿货价（拿货差价）", "assignablePools": [], ... },
    { "kind": "featured", "label": "特色产品", "mode": "poolRatio", "storeBenefit": "单店 65% = 交付 30% + 流量 30% + 销售 5%",
      "poolRatio": { "hq": { "rate": 0.15, "label": "总部", "sub": "系统" }, "districtInspect": { "rate": 0.05, "label": "区县代", "sub": "巡查", "allocatable": true, "allocationKind": "inspection" }, ... },
      "assignablePools": [
        { "kind": "inspection", "label": "巡查 5%", "owner": "区县代" },
        { "kind": "sales", "label": "销售 5%", "owner": "单店（店长）" }
      ], ... }
  ],
  "incomeChannels": [
    { "key": "storeIncome", "label": "门店收益", "desc": "门店卖货获得的分润，随商品类型按拨比表规则计算" },
    { "key": "costoreOwnerIncome", "label": "合店老板收益", "desc": "合店老板入股合店费获得的分配（服务40%/直推13%/复购2%/分红池10%）" }
  ],
  "note": "门店收益随商品类型按拨比表规则计算；合店老板收益与门店卖货收益分属两条独立账，不可合并统计"
}
```

## 4. 分配意愿自选（P0-9 · 巡查 5% / 销售 5%）

> 🆕 **2026-10-27 按原型重做**：收益方改为**固定语义键**（不再是动态候选列表），
> 弹窗选项与原型截图一一对应；「其他代理」需**手填代理 ID**；
> 提交分配**只需 quoteId**（服务端凭报价单还原方案）。
> ⚠️ `allocationKind` 对外取值统一为 **`inspection` / `sales`**（历史文档写的 `inspect` 已废弃）。

### 4.1 可分配对象 `GET /income/entries/{id}/allocation-options?contextId=partner:<userId>`

**弹窗选项 = `fields[0].options`**（`key=targetId`），前端直接渲染成按钮组：

| 分配池 | 弹窗标题 | options（value / label） |
|---|---|---|
| 巡查 5%（区县负责人操作） | 分配巡查提点 | `self`/本人 · `city`/上级市代 · `province`/上级省代 · `hq`/总部 · `other`/其他代理 |
| 销售 5%（门店店长操作） | 分配销售提点 | `self`/本店 · `county`/上级区代 · `city`/上级市代 · `province`/上级省代 · `hq`/总部 · `other`/其他代理 |

```json
{
  "entryId": "po-o_21-featured_store_sales",
  "allocationKind": "sales",
  "allocationStatus": "NONE",
  "fields": [{
    "key": "targetId",
    "label": "销售方",
    "type": "enum",
    "options": [
      { "value": "self",     "label": "本店",     "name": "李志远", "needsId": false, "available": true },
      { "value": "county",   "label": "上级区代", "name": "王好梦", "needsId": false, "available": true },
      { "value": "city",     "label": "上级市代", "name": "",      "needsId": false, "available": false, "unavailableReason": "未找到对应的上级代理（上级市代）" },
      { "value": "province", "label": "上级省代", "name": "张总",   "needsId": false, "available": true },
      { "value": "hq",       "label": "总部",     "name": "总部",   "needsId": false, "available": true },
      { "value": "other",    "label": "其他代理", "name": "",      "needsId": true,  "available": true }
    ]
  }],
  "scheme": { "editableBy": "HQ", "mode": "self_assign", "kinds": [ ... ] },
  "candidates": [ ... ],
  "balances": { "available": 1200, "entryAmount": 500 },
  "allowedActions": ["quote", "submit"]
}
```
> · `needsId=true` 的选项（仅 `other`）**必须额外输入 ID**：巡查侧显示「巡查方ID」，销售侧显示「销售方ID」。
> · `available=false` 表示该上级代理在当前区域链上不存在，前端应置灰不可选。
> · 语义键由**服务端解析成真实收款人**，前端无需也不应自己拼 agentId（`other` 除外）。

### 4.2 分配试算 `POST /income/entries/{id}/allocation-quotes`

**入参（原型单选路径，推荐）**：
```json
{ "contextId": "partner:p6", "targetId": "county", "percent": 100, "allocationKind": "sales" }
```
选「其他代理」时额外带 `agentId`：
```json
{ "contextId": "partner:p6", "targetId": "other", "percent": 100, "allocationKind": "sales", "agentId": "p5" }
```
> 也兼容多目标写法 `targets: [ { targetId, percent, agentId? } ]`（各 percent 合计须 100）。
> `targetId` 可传**语义键**（上表）或**真实用户 ID / `"HQ"`**（老契约，仍可用）。
> 不合法返回 HTTP 200 + `{ valid: false, errors: [...] }`（前端要处理这个分支，不是异常）。

**出参（合法时）**：
```json
{
  "valid": true, "id": "aq_12", "quoteId": "aq_12", "entryId": "po-o_21-featured_store_sales",
  "kind": "sales", "internalKind": "sales", "kindLabel": "销售 5%",
  "entryAmount": 500,
  "rows": [ { "targetId": "p5", "name": "王好梦", "kind": "county", "percent": 100, "amount": 500, "roleLabel": "上级区代" } ],
  "totalPercent": 100, "totalAmount": 500,
  "settlementNote": "分配方案下个结算周期生效，生效前可撤销",
  "expiresAt": 1756000000000, "serverTime": 1756000000000
}
```
> ⚠️ `rows[].targetId` 是**解析后的真实收款人 ID**（不是语义键）。

### 4.3 提交分配 `POST /income/entries/{id}/allocations`
**入参**：`{ contextId, quoteId: "必填", idempotencyKey: "必填" }`
> 原型单选路径**不需要再传 targets**——服务端凭 `quoteId` 从报价单还原分配方案（报价单 TTL 10 分钟）。
> 也可显式传 `targets: [...]` 覆盖。

**出参**：`{ status: "PENDING_SETTLEMENT", allocationId, operationId, rows }`

### 4.4 撤销分配 `POST /income/entries/{id}/allocations/{allocationId}/revoke`
**入参**：`{ contextId }` → `{ status, allocationId }`


## 5. 经验值与晋升任务（🆕 P0-1 / P0-2）

### 5.1 经验值明细 `GET /partner/experience-ledger?contextId=partner:<userId>&tab=promotion|product`
```json
{
  "promotionExperience": 9980,
  "productExperience": 9980,
  "total": 19960,
  "tabs": [
    { "key": "promotion", "label": "业务推广", "points": 9980 },
    { "key": "product",   "label": "购买产品", "points": 9980 }
  ],
  "metrics": [
    { "label": "累计业务推广", "kind": "points", "value": 9980 },
    { "label": "累计购买产品", "kind": "points", "value": 9980 }
  ],
  "items": [
    {
      "id": "e_xx",
      "tab": "promotion", "tabLabel": "业务推广",
      "event": "partner_upgrade", "eventLabel": "合伙人：升为 VIP 合伙人",
      "title": "升为 VIP 合伙人",
      "points": 9980,                    // ★ 经验值 = 标价多少加多少（1 元 = 1 经验）
      "price": 9980,                     // 该笔业务标价（元）
      "refId": "o_18",
      "meta": { "fromTier": "普通用户", "toTier": "VIP合伙人", "quotaUsed": 1 },
      "occurredAt": 1756000000000,
      "occurredAtText": "2026-08-26T07:00:00.000Z"
    }
  ],
  "hasMore": false, "nextCursor": null
}
```
> `meta` 里带**归因人**信息（推荐人/购买人的 id、姓名、脱敏手机号），原型屏 46/47 的明细表直接渲染 `meta` 即可。
> 经验值**纯记账，不参与任何分账**，前端不要用它算钱。普通用户升 VIP 合伙人消耗 **1** 个名额。

### 5.2 经验值汇总 `GET /partner/experience/summary?contextId=partner:<userId>`
`{ promotionExperience, productExperience, total, count, rule: "标价多少加多少（1 元 = 1 经验值）" }`

### 5.3 晋升任务 `GET /partner/promotion-tasks?contextId=partner:<userId>`
```json
{
  "items": [
    { "key": "private", "label": "直推私董合伙人", "required": 3, "current": 1,
      "reached": false, "progressText": "1/3", "percent": 33.33 },
    { "key": "vip", "label": "直推VIP合伙人", "required": 18, "current": 6,
      "reached": false, "progressText": "6/18", "percent": 33.33 }
  ],
  "promotion": {
    "beforeName": "VIP合伙人", "afterName": "天使合伙人",
    "beforeQuota": 1, "afterQuota": 3,
    "paidAmount": 3500, "standardAmount": 12000, "differenceAmount": 8500,
    "taskDescription": "直推 3 位私董合伙人 或 直推 18 位VIP合伙人 即可免费晋升（12 个月内）",
    "progress": 33.33, "target": 3,
    "statusLabel": "进行中",
    "validUntil": 1787000000000, "daysLeft": 340,
    "rule": "达标免费升 1 档（封顶联创）"
  },
  "task": {
    "enabled": true,
    "taskId": "task_xx",
    "status": "ONGOING",          // ONGOING / ACHIEVED / EXPIRED / CLAIMED
    "statusLabel": "进行中",       // 进行中 / 已达标（待领取）/ 已过期 / 已晋升
    "achieved": false,
    "items": [ /* 同上 items */ ],
    "daysLeft": 340,
    "validUntil": 1787000000000,
    "startTier": "vip",
    "grantRule": "达标免费升 1 档（封顶联创）",
    "deadlineText": "任务有效期 12 个月，将于 340 天后截止",
    "text": "直推 3 位私董合伙人 或 直推 18 位VIP合伙人 即可免费晋升（12 个月内）"
  }
}
```
> 任务**未开通**时 `task.enabled = false`、`statusLabel = "未开启"`、`items` 为空数组。
> `promotion` 是"补差价直接晋升"那一栏的数据（原型屏 22 双 Tab 的另一个 Tab）。

---

## 6. 商城 · 下单 · 支付（§7 / §8）

### 6.1 目录 `GET /catalog`
→ `{ categories:[{id,label}], items:[ 商品展示对象 ] }`

> 🆕 **2026-10-27 展示层改造**：`items` 由「计价目录」升级为**前端商城展示结构**（见 `src/catalogDisplay.js`）。
> 每次商品含：`id / categoryId / categoryLabel / title / summary / coverUrl / fulfillmentType / requiresMember /
> pricePresentation / standardAmount / activityAmount / memberPrices[] / rolePrices[] / specGroups[] / skus[] /
> checkoutNotice / content / prices{list,member,channel}`。
> - **金额单位是「分」**（`standardAmount` = 标价 × 100），前端 `money()` 按分渲染；`prices` 三套价仍是「元」。
> - `memberPrices` = 各合伙人档位价（VIP/天使/私董/联创），`rolePrices` = 各代理档位价（单店/区县/地市/省代）。
> - `activityAmount` 后端商品模型**无活动价口径**，故为 `null`（前端显示 '—'），不臆造数值。
> - `id` = 原计价 `key`（`pad` / `memoryCard` / `coachCard` / `featured` / `featuredCamp` / `adminFee`），
>   **专栏商品也在目录里**：`col_1` / `col_2`，`categoryId='column'`。
> - `skus[]` 每项 `{id,label,specs,amount,stock}`，`amount` 为分；`specGroups[]` 为 `{id,label,options[]}`。
> - `content` 为富文本节点（`{version:1,format:'nodes',nodes:[{name:'p'|'h2',children:[{type:'text',text}]}]}`）。

### 6.2 商品详情 `GET /products/{id}`
入参：路径 `id` 取商品 `id`（如 `pad` / `memoryCard` / `featured` / `featuredCamp` / `coachCard` / `adminFee` / `col_1`）
→ 与目录项同构的商品详情（含 `skus[]`、`content`）；不存在 404。
> 专栏 `col_1` / `col_2` **同时是商品与专栏**，故 `/products/col_1` 与 `/columns/col_1` 数据同源（专栏详情页「购买激活码」跳转到商品详情）。

### 6.2.1 专栏 `GET /columns` / `GET /columns/{id}`
- `GET /columns` → `{ items:[{id,title,summary,coverUrl,price,unlocked,chapterCount}], hasMore, nextCursor }`
- `GET /columns/{id}` → `{ product:{ 商品展示对象 }, unlocked, chapters:[{id,title,type}] }`
> 专栏定义存 `data/db.json` 的 `columns` 集合（**业务可直接改数据**，不必改代码）；集合为空时回落到 `src/columns.js` 的默认种子。
> 专栏 id 与激活码种子 `NS-COL-0001`、商城目录商品 id **三处必须同名**。

### 6.3 结算选项 `GET /checkout/options`（门店、会员、地址、优惠券）
→ `{ stores:[{id,name,number,address,managerName,phone,coverUrl,regionCode}], defaultStoreId, deliveryLocked, members, addresses, coupons }`
> 🆕 **2026-10-27**：`stores` 之前恒为**空数组**，而前端收银台**必选门店**才允许结算 → 商城流程根本走不完。
> 现从区域代理（`region_type='store'`）取真实门店，并给 `defaultStoreId`（前端可直接默认选中）。
> ⚠️ 下单时传的 `storeId` 目前**仅作记录**，**不参与分润归属**（门店归属口径待业务确认，故不擅自改 regionCode）。
### 6.4 结算试算 `POST /checkout/quotes`
入参 `{ productKey, quantity, memberId?, level?, skuId? }` →
`{ goodsAmount, discountAmount, payableAmount, dualDiscountEnabled, product:{ key,name,unitPrice,qty, listUnitPrice,memberUnitPrice,channelUnitPrice, appliedPriceKind }, expiresAt }`

> 🆕 **2026-10-27 SKU 库存台账**：传 `skuId` 即按该规格计价（规格单价 × 档位折扣），并**校验库存**（不足返回 400）。
> 响应回显 `skuId`；报价与下单的 `skuId` 必须一致，否则报「商品/名额组合与报价不一致」。

> 🆕 **P1-9 双折扣**：
> - `appliedPriceKind` = `list` / `member` / `channel`，即本次成交取的是哪一套价。
> - 默认 `dualDiscountEnabled=false`，成交价按「买家档位」折扣（代理价 > 合伙人价 > 标价），三套价仅供展示。⚠️ **特色产品例外**：代理买家按对应合伙人档位计价（不享受代理折扣），故特色的「代理价」等于其映射合伙人价（如省代买特色营=9300，等于联创价）。
> - 后台开启 `settings.pricing.dualDiscountEnabled` 后：**代理取渠道价、会员取会员价、其余取标价**。
> - `discountAmount` = 标价金额 − 应付金额（此前恒为 0）。
> - 显式传 `level` 时按该档位成交（兼容旧行为）。
### 6.5 下单 `POST /orders`
入参 `{ productKey, quantity, memberId?, addressId?, couponId?, deliveryType?, payableAmount?, quoteId?, skuId?, payLater? }` → `{ ok: true, order }`
> 🆕 **2026-10-27 SKU**：
> - 传 `skuId` → 校验规格与商品匹配、校验并**扣减库存**（记 `db.stockLedger` 流水）；订单回显 `skuId` / `skuLabel`。
> - 传 `payLater: true` → 订单挂 `PENDING_PAYMENT`（带支付倒计时），**取消时自动回补库存**；支付超时被扫描取消时同样回补（幂等，不会重复回补）。
> - 不传 `payLater` → 订单直接 `paid`（历史行为），此时取消**不回补**库存（货已售出）。
> - ⚠️ 数量字段 `quantity` / `qty` 都认，**下单数量必须与报价一致**（此前只读 `qty`，会造成「报价 2 件、按 1 件成交」）。
> - 库存不足 → 400，**不落订单**。
> 🆕 **P0-5**：待支付单会带 `payExpireAt` 与 `remainSeconds`（默认下单 +30 分钟，后台 `settings.order.payTimeoutMinutes` 可配）。超时自动取消（`status: CANCELLED`, `cancel_reason: PAY_TIMEOUT`）。

### 6.6 订单列表 `GET /orders` / 详情 `GET /orders/{id}`
每条订单附：
```json
{
  "id": "o_18", "status": "PENDING_PAYMENT",
  "statusLabel": "待支付",
  "remainSeconds": 2100,
  "delivery": {
    "deliveryMode": "ONLINE_STORE",        // ONLINE_STORE（到店）/ ACTIVATION（到店取激活码）/ EXPRESS（快递）
    "deliveryModeLabel": "到店使用",
    "activationMode": null,
    "tipText": "该单为线下支付产品，请前往门店使用",
    "deliveryStore": "p6",
    "verifyCode": "381204",                // 6 位核销码
    "verified": false,
    "verifiedAt": null,
    "activationCode": null,
    "cancellation": null,                  // 已取消时才有：{ reason, reasonLabel, cancelledAt }
    "pay": {
      "status": "PENDING_PAYMENT",
      "statusLabel": "待支付",
      "payExpireAt": 1756002000000,
      "remainSeconds": 2100,
      "remainText": "剩余支付时间 00:35:00",
      "timeoutMinutes": 30
    }
  }
}
```
> 已取消订单：`status = "CANCELLED"`，`statusLabel = "已取消（支付超时，订单自动取消）"`，`delivery.cancellation = { reason: "PAY_TIMEOUT", reasonLabel: "支付超时，订单自动取消", cancelledAt }`。主动取消 `reason = "USER_CANCEL"`。
> 🆕 **P0-6**：门店核销码在订单详情里，门店端用 `POST /stores/{storeId}/orders/{orderNo}/verify` 校验。

### 6.7 发起支付 `POST /payments/attempts`（🆕 已收敛）
入参 `{ orderId, channel: "wechat" | "alipay" | "bank_card", idempotencyKey? }`
- **sandbox**（默认，联调用）：返回 `{ status: "SUCCEEDED", releasedCommissions: n, delivery }` 并**自动放行分润**。
- **live**：返回 `{ status: "CREATED", payParams: {…} }`，前端调起渠道后由渠道回调 `POST /payments/notify/{channel}` 入账。

### 6.8 支付单查询 `GET /payments/attempts/{id}`
`{ id, orderId, status, channel, channelName, amount, paymentMode, paidAt, delivery }`

### 6.9 订单支付 / 取消 / 收货
- `POST /orders/{id}/payment` → `{ orderId, status: "paid", releasedCommissions, delivery }`
- `POST /orders/{id}/cancellations` → `{ order }`
- `POST /orders/{id}/receipts` → `{ order }`
- `GET /orders/{id}/payment-channels` → `{ items: [{ id, label, kind }], orderId, paymentMode }`

---

## 7. 申请类（合店 / 代理 / 转店）

### 7.1 合店申请
- `GET /costore/application-options` → `{ stores, durations: [{id:"12",months:12},{id:"24",months:24}], benefits, agreement: { version, content } }`
- `POST /costore/application-quotes` 入参 `{ storeId, durationId }` → `{ payableAmount }`（698 × 月数）
- `POST /applications/costore` 入参 `{ storeId, durationId, idempotencyKey? }` → `{ application, costore }`

### 7.2 代理申请（🆕 费用明细与预填）
**`GET /agency/application-options?agencyType=store&tierIndex=0&promotionCode=`**
```json
{
  "agencyType": "store",
  "agencyTypeLabel": "单店",
  "feeBreakdown": {
    "brandFee": 40000, "extraFee": 0, "deviceFee": 20000, "depositFee": 20000,
    "total": 80000,
    "label": "¥80,000.00",
    "note": "品牌费4w+设备费2w+保证金2w；技术费=品牌费4w"
  },
  "priceTiers": [ { "range": "全部", "total": 80000, "techFee": 40000, "note": "…" } ],
  "techFee": 40000,
  "techFeeNote": "直推代理奖按「技术费」计，不按合计",
  "promotionCode": "promo-p1",
  "referredBy": { "id": "p1", "name": "…" },
  "referredTier": "cofounder",
  "grantedTier": "cofounder",
  "requiredUploads": [ { "key": "storefrontPhoto", "label": "门头照", "type": "image", "maxCount": 3 } ],
  "requiredAgreements": [ { "key": "agencyAgreement", "label": "代理协议", "version": "v1" } ],
  "allowedActions": ["submit"]
}
```
**`POST /agency/applications`**（🆕 必填校验已加）
```json
{
  "contextId": "partner:p1",
  "agencyType": "store",
  "regionCode": "330110-S1",
  "tierIndex": 0,
  "agreements": [ { "key": "agencyAgreement", "accepted": true } ],
  "uploads": [ { "key": "storefrontPhoto", "fileId": "asset_xxx" } ],
  "idempotencyKey": "..."
}
```
- 缺协议 → `400 请先阅读并勾选代理协议`
- 缺门头照 → `400 请上传门头照`
- 成功 → `{ application: { ..., payableAmount: 80000, feeBreakdown: {...} }, agent }`
> 门头照先走 `POST /assets/upload-intents` 上传，把返回的 `fileId` 填进 `uploads`。

### 7.3 转店 `GET /store-transfer/options` / `POST /store-transfer/applications`
### 7.4 申请列表 `GET /applications?contextId=partner:<userId>`

---

## 8. 门店 / 健脑官（§13）

### 8.1 门店列表 `GET /stores`（🆕 合店老板数与合店费）
```json
{
  "items": [
    {
      "id": "p6", "name": "脑商线下店…店",
      "address": "", "contact": "13800000006",
      "regionCode": "330110-S1",
      "costoreOwnerCount": 1,        // ★ 当前已有合店老板数
      "costoreOwnerLimit": 1,
      "costoreMonthlyFee": 698,      // ★ 合店费
      "costoreMonthlyFeeLabel": "¥698/月"
    }
  ]
}
```
### 8.2 门店核销 `POST /stores/{storeId}/orders/{orderNo}/verify`
入参 `{ verifyCode: "381204" }` → 校验通过订单置 `COMPLETED`；激活码类订单同步绑定激活码。

### 8.3 健脑官 `POST /auth/sessions`（`channel:"coach"`）→ `GET /coach/workspace`
### 8.4 门店工作台 `GET /agency/store-workspace?contextId=agency:<userId>`

---

## 9. 个人中心 / 家庭会员 / 学习（§4~§6）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/me` | GET / PATCH | 个人信息 / 昵称、头像 |
| `/addresses`、`/addresses/{id}`、`/addresses/default` | GET/POST/PATCH/PUT/DELETE | 收货地址（默认地址唯一） |
| `/coupons?status=` | GET | 优惠券三态（available/used/expired） |
| `/support/config`、`/support/feedback` | GET / POST | 客服配置 / 反馈 |
| `/members`、`/members/options`、`/members/{id}` | GET/POST/PATCH | 家庭会员（孩子六级阶梯） |
| `/members/{id}/levels`、`/members/{id}/learning-progress` | GET / PUT | 学习解锁进度 |
| `/activations/preview`、`/activations` | POST | 激活码三通道（总部/门店/上级赠码） |
| `/learning/levels`、`/learning/levels/{id}`、`/lessons/` | GET | 课程与章节 |
| `/columns`、`/columns/{id}` | GET | 专栏列表 / 专栏详情：`{product:{商品展示对象},unlocked,chapters:[{id,title,type}]}`；`/lessons/{chapterId}?columnId={id}` 取专栏章节正文 |
| `/columns/{id}/learning-progress` | PUT | 专栏学习进度（账号级，无孩子维度）：`{chapterId,positionSeconds,durationSeconds,completed}` |
| `/announcements`、`/announcements/{id}` | GET | 公告 |
| `/agreements/` | GET | 协议正文（`user` / `privacy`）。🆕 **免登录可读**（法律文档，注册页也要能看） |

> ⚠️ **富文本节点格式（2026-10-27 修正）**
> 后端所有正文（协议 / 课程 / 商品 / 专栏）统一返回：
> `{ version:1, format:'nodes', nodes:[ { name:'p'|'h2'|'li'|…, children:[ { type:'text', text } ] } ] }`
> 前端 `normalizeContent` 只接受 `{name,children}` 或 `{type:'text'}` 两种节点，
> 此前的 `{type:'paragraph',text}` 会因 `name` 不在白名单被**整段丢弃**（页面显示空白）。
> 新增富文本请走 `src/richContent.js` 的 `nodes()/para()/heading()/list()`。

### 9.1 管理端（`/api/*`，需 admin 登录）—— 业务改数据不用改代码
| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/skus` | GET | SKU 库存台账（含每条库存流水） |
| `/api/skus/{id}` | PUT | 改规格名称 / 单规格单价 |
| `/api/skus/{id}/stock` | POST | 改库存：`{stock:25}` 直接设定 或 `{delta:-3}` 增减 |
| `/api/columns` | GET / PUT | 专栏定义读写（整表替换：`{columns:[...]}`） |
| `/api/activity-prices` | GET / POST | 商品活动价：`{productId, amount(元)}`；传 `{productId}` 不带 amount 即清除 |

> ⚠️ **不要在服务运行期间手改 `data/db.json`**：服务启动时把文件读进内存，之后每次写库都会用内存内容**整份覆盖**该文件，
> 手改的内容会被冲掉。改业务数据请走上面的管理端接口（内存与文件同步落盘）。

---

## 10. 钱包与提现（§11）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/wallet/withdrawal-options` | GET | `{ balance, minAmount:100, maxAmount:50000, feeRate:0.006, feeMin, feeNote, accountTypes:["PERSONAL","COMPANY"], payees }` |
| `/wallet/payees` | POST | 新增收款账户（银行卡 16–19 位） |
| `/wallet/withdrawal-quotes` | POST | 提现试算（含手续费） |
| `/wallet/withdrawals` | POST / GET | 提交提现 / 我的提现记录 |

---

## 11. 素材库与上传（§14）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/assets/upload-intents` | POST | 申请上传凭证 → 回填 `fileId`（门头照/头像走这里） |
| `/assets/{id}/completions` | POST | 上传完成回调 |
| `/materials/categories`、`/materials`、`/materials/{id}` | GET | 素材库 |
| `/materials/{id}/renders` | POST | 合成海报任务 |
| `/jobs/{id}` | GET | 合成任务状态 |

---

## 12. 上级绑定与邀请码

| 端点 | 方法 | 说明 |
|---|---|---|
| `GET /partner/superior` | GET | 我的上级 |
| `POST /partner/superior-bindings` | POST | 绑定上级（入参 `{ contextId, inviteCode }`） |
| `GET /promotion/share-code` | GET | 合伙人分享码（`inviteCode` / `qrUrl` / `posterUrl` / `shareUrl`） |
| `GET /promotion/agency-code` | GET | 代理推广码 |
| `GET /promotion/invitations/` | GET | 邀请记录 |

---

## 13. 身份切换（多身份体系）

同一账号可同时持有 **合伙人 / 区域代理 / 合店老板** 三种身份，收益**严格分离**。
- `GET /me/bootstrap` → `businessContexts`（切换栏数据源）
- `GET /partner/overview` / `GET /agency/overview` / `GET /costore/overview`（各自的 `contextId`）
- `GET /income/entries?identity=partner|agent|costore` 按身份过滤

---

## 14. 错误码与状态枚举

**HTTP 状态**：`400` 参数/业务校验失败 · `401` 未登录或 token 失效 · `403` 身份不允许 · `404` 资源不存在 · `409` 冲突（如手机号已注册）· `500` 服务端异常。
错误体统一：`{ "error": "中文提示" }`（前端直接 toast）。

**关键枚举**
| 枚举 | 取值 |
|---|---|
| 订单状态 | `PENDING_PAYMENT` / `PAID` / `CANCELLED` / `COMPLETED` |
| 取消原因 | `USER_CANCEL` / `PAY_TIMEOUT` |
| 交付模式 | `ONLINE_STORE` / `ACTIVATION` / `EXPRESS` |
| 档位 | `none` / `vip` / `angel` / `private` / `cofounder` |
| 分配对象 | `self`（本人）/ `upline_agent`（上级代理）/ `peer_agent`（合作代理）/ `hq`（总部） |
| 分配状态 | `NONE`（未分配）/ `PENDING`（已提交待结算）/ `SETTLED`（已结算）；撤销记录 `status: REVOKED` |
| 分红权 | `当月有分红权` / `当月无分红权` |
| 权益状态 | `never_paid` / `active` / `expired` |

---

## 15. 本轮改动点速查（前端必看 ⚠️）

| # | 改动 | 影响 |
|---|---|---|
| 1 | **名额双余额** `standardRemaining` / `activityRemaining` | 名额相关页面全部改用双余额，不要再读单一 `quota` 字段 |
| 2 | **升级服务费** `serviceFee` / `usedActivityQuota` / `totalPayable` | 升级按钮金额用 `totalPayable`，费用明细新增一行服务费 |
| 3 | **支付沙箱收敛** `/payments/attempts` 走真实支付模块 | sandbox 返回 `SUCCEEDED`；live 返回 `CREATED` + `payParams`，前端需分支处理 |
| 4 | **验证码不再回传** | 联调需验证码 → 让后端设 `EXPOSE_DEV_CODE=1` |
| 5 | **订单超时** `remainSeconds` / `statusLabel` | 订单列表与详情要显示倒计时 |
| 6 | **线下核销** `delivery.verifyCode` | 订单详情展示 6 位核销码 |
| 7 | **分配意愿** `targets[]` + `percent` 合计 100% | 原「单 target 100%」的写法要改成多目标比例 |
| 8 | **收益多态** `bizType` / `bizDetail` | 收益详情按 `bizType` 渲染不同字段 |
| 9 | **代理申请校验** 门头照 + 协议必填 | 提交前先调 `/agency/application-options` 拿 `requiredUploads` / `requiredAgreements` |
| 10 | **门店合店老板数** `costoreOwnerCount` | 门店列表显示「当前已有 N 位合店老板」 |
| 11 | **商城目录 items 改为数组** + 每项 `prices` | `/catalog` 之前返回的是对象不是数组，请勿再按 key 直取；商品列表用 `items[]` |
| 12 | **商品详情按 key 查** | `GET /products/{id}` 的 `id` 传商品 key（如 `pad`），此前实现会直接崩溃 |
| 13 | **报价新增三套价 + appliedPriceKind** | 结算页可同时展示「会员价 / 渠道价 / 应付」；`discountAmount` 不再恒为 0 |
| 14 | **两套邀请码** `R…` / `A…` | 拉新用 `register` 码、申请代理用 `agent` 码；旧的手机号/uid 邀请码仍兼容 |
| 15 | **邀请码可失效/限次/吊销** | 绑定前会校验有效期与限次；吊销后立即失效 |
| 16 | **成长阶梯图** `GET /partner/ladder` | 新增 L1–L10 阶梯，返回 `levels[].coord` 可直接画图 |
| 17 | **分配模式开关** `scheme.mode` | `self_assign`（可自选）/ `fixed`（两块 5% 固定归默认受益人，分配入口要隐藏） |
| 18 | **免费升档两套规则** `referralFreeUpgrade.rules` | 规则A（人数 3 人/档）与规则B（团队业绩）并行，取进度高者；`activeRule` 指明当前生效规则 |
| 19 | **直推提点分档**（直推代理奖） | 默认仍是固定 15%（金额不变）；后台 `settings.agentDirectBonus` 配置后按「直推数量」或「代理级别」分档 |
| 20 | **微信登录可配** | 配了 `WECHAT_APPID/WECHAT_SECRET` 走真实授权与 code 换 openid；未配置走 mock（响应带 `mode`） |
| 21 | **直推提点双口径**（合伙人产品提成） | `settings.directBonus.mode` = `byUplineTier`（默认，5/10/15/15%，金额不变）/ `byBizType`（供应链·合店费复购·升级奖 2%；软件卡·代理费·权益费 5%）；明细多回 `basis` 与 `bizType` |

---

## 16. 联调自检清单

- [ ] `POST /auth/sessions` 拿到 token，`Authorization: Bearer` 已挂上
- [ ] `GET /me/bootstrap` 拿到 `businessContexts`，切换身份时用对应 `contextId`
- [ ] 升级页：`GET /partner/upgrade-options` → 显示服务费明细 → `POST /partner/upgrade-quotes` → `POST /partner/upgrades`
- [ ] 收益明细：`GET /income/entries` → 可分配池才显示「分配」按钮 → `allocation-options` → `allocation-quotes` → `allocations`
- [ ] 下单：`POST /orders` → 订单详情显示 `remainSeconds` 与 `delivery.verifyCode`
- [ ] 支付：`POST /payments/attempts` 按 `paymentMode` 分支（`sandbox` 免调起、`live` 用 `payParams`）
- [ ] 代理申请：先 `GET /agency/application-options` 拿费用明细与必填项 → 上传门头照 → 提交
- [ ] 提现：`GET /wallet/withdrawal-options` 拿 min/max/手续费 → `withdrawal-quotes` → `withdrawals`

---

## 17. 🆕 2026-10-26 补齐功能（本次新增接口）

### 17.1 两套邀请码（P1-8）

| 接口 | 说明 |
|---|---|
| `GET /me/invite-codes?contextId=partner:<userId>&type=register\|agent` | 我的邀请码列表 |
| `POST /me/invite-codes?contextId=partner:<userId>` | 生成邀请码，body `{ type:'register'\|'agent', maxUse?, ttlDays? }` → 201 `{ inviteCode:{...}, shareUrl }` |

- 编码规则：`register` → `R` 开头，`agent` → `A` 开头，后接 8 位 base36；**不区分大小写**。
- 有效期默认 30 天（`settings.inviteCode.ttlDays`），限次默认不限（`settings.inviteCode.defaultMaxUse`）。
- **`register` 码**：注册时传入 → 自动把码主设为注册者的上级（`upline`）；也可事后用 `POST /partner/superior-bindings` 绑定。
- **`agent` 码**：用在代理申请（`GET /agency/application-options?promotionCode=<码>`）→ 自动带入 `referredBy` 与可授予等级。
- 旧的「手机号 / uid 当邀请码」写法**仍然有效**（向后兼容），新代码建议统一用类型化邀请码。

`POST /me/invite-codes` 返回体：
```json
{ "inviteCode": { "code": "R7K2M9XQ", "type": "register", "typeLabel": "注册邀请码",
    "ownerId": "p1", "createdAt": 1793004108658, "expiresAt": 1795596108658,
    "maxUse": 0, "usedCount": 0, "status": "active" }, "shareUrl": "https://.../?invite=R7K2M9XQ" }
```

### 17.2 成长阶梯 L1–L10（P1-7）

`GET /partner/ladder?contextId=partner:<userId>` →
```json
{ "levels": [ { "level":"L1","name":"见习合伙人","minScore":0,"commissionRate":0,
                "coord": { "x":1, "y":10 } } ],
  "currentLevel":"L1", "currentScore":0, "nextLevel":"L2", "toNext":1000, "ratio":0,
  "unit":"成长积分", "scoreSource":"累计经验值（1 元 = 1 积分）" }
```
- `coord.x` = 等级序（1..10），`coord.y` = 画布纵坐标，直接拿来画阶梯图即可。
- 分数来源 = 累计经验值；阶梯阈值/名称/坐标可由后台 `settings.ladder.levels` 覆盖。

### 17.3 分配模式（P1-5）

`GET /partner/allocation-scheme?contextId=partner:<userId>` 新增：
- `mode`：`self_assign`（默认，可自选）/ `fixed`（固定归默认受益人）
- `modeLabel`：可展示给用户的中文说明
- `fixed` 模式下 `kinds[].ownerAssignable` 全部为 `false` —— **前端应隐藏「分配」入口**。

### 17.4 免费升档两套规则（P1-1）

`GET /partner/overview`（及团队树节点）中的 `referralFreeUpgrade` 新增 `rules`：
- `rules.count`：规则A（人数）—— 每 `required` 名合格下级升 1 档
- `rules.performance`：规则B（业绩）—— 直属下级付费升档实付累计达 `required` 元升 1 档
- `activeRule`：当前按哪条规则计（`count` / `performance`）
> 默认只启用规则A（规则B 开关默认关闭），**金额行为与此前一致**。

### 17.5 直推提点双口径（P1-3）★ 口径开关，前端一般无需改动

后端把"直推提点"的两套口径**都实现了**，通过后台 `settings.directBonus.mode` 切换，**默认口径不变（既有金额完全不变）**：

| 模式 | 比例来源 | 举例 |
|---|---|---|
| `byUplineTier`（默认） | 按**推荐人档位**：VIP 5% / 天使 10% / 私董 15% / 联创 15% | 下级买平板实付 10000，上级天使 → 1000 |
| `byBizType` | 按**业务类型**：供应链 / 合店费复购 / 升级奖 2%；软件卡 / 代理费 / 权益费 5% | 下级买平板实付 2500 → 50；代理费 100000 → 5000 |

- 影响的是**收益明细里"产品提成 / 直推奖"的金额**，前端仍按同一套字段渲染，无需改结构。
- 收益明细会多回 `basis`（`uplineTier` / `bizType`）与 `bizType`，可在详情里显示"按业务类型计提"。
- 直推代理奖（区域代理任命）另按 `settings.agentDirectBonus` 分档（按直推数量 / 推荐人代理级别），默认固定 15%。

### 17.6 微信登录（P2-2）

- `POST /auth/wechat/authorizations` body `{ redirectUri }` → `{ url, state, mode }`
- `POST /auth/wechat/exchanges` body `{ code }` → `{ registrationTicket, expiresAt, mode }`
- `mode` = `live`（已配 `WECHAT_APPID`/`WECHAT_SECRET`）或 `mock`（未配，本地联调）。
- 注册时可带 `wechatTicket`，注册成功后自动绑定 `openid`。

---

---

## 18. 🆕 前端 8 问逐条答复（2026-10-26 · 已全部落地并通过回归）

> 本节是前端 2026-10-26 反馈的 8 个问题的**逐条正式答复**。每条都给出：结论 → 依据 → 前端怎么用。
> 对应回归脚本 `scripts/verify_frontend_questions_20261026.js`（**113 项断言全部通过**）。

### 18.1 报价是否绑定提交（问题 1）

**结论：已绑定，且是强校验的。** 所有"要花钱"的提交接口都支持 `quoteId`；**只要传了，就必须通过校验**，否则 HTTP 400。

> **前端建议一律传 `quoteId`**（推荐做法，也是本轮新增能力的主要目的）。
> 为兼容旧调用，**不传 `quoteId` 也允许提交**——此时服务端**不采信任何前端传来的金额**，一律用服务端规则重算应付额。所以"不传 quoteId"不会造成价格被篡改，但会**失去"用户确认过这个价"这层保护**（例如期间活动价变了，用户按旧价下单也会按新价成交）。
>
> | 情况 | 服务端行为 |
> |---|---|
> | **传了 `quoteId`（推荐）** | 校验**五要素 + 金额 + 组合**全部通过才放行；业务成功后消费报价（一次性） |
> | **没传 `quoteId`（兼容旧调用）** | 跳过报价校验，**金额一律服务端重算**，不采信前端金额 |
> | **传了但校验不过** | HTTP 400，附带明确原因（报价不存在/不属于你/场景不匹配/已过期/已使用/价格已变化/组合不一致） |

**五要素**（任一不满足 → HTTP 400，附带明确原因）：

| 要素 | 规则 |
|---|---|
| 存在性 | `quoteId` 必须在本报价表中存在 |
| 归属 | 报价的 `userId` 必须等于当前登录身份的用户 |
| 场景 | 报价的 `scene` 必须与该端点的场景一致（防止拿升级报价去买名额） |
| 有效期 | 超过 `expiresAt`（默认 **10 分钟**）即失效 |
| 未消费 | 报价**一次性**，成功提交后被标记 `consumed`；重复使用会被拒 |

**外加两项实质校验**（防止前端算错或篡改）：

- **金额比对**：服务端用当前规则**重新计算**应付金额，与报价金额逐分比对；不一致 → `价格已变化（报价 ¥x → 当前 ¥y），请重新报价`。
- **组合比对**：商品名额/商品组合（`items`）必须与报价时一致；不一致 → `商品/名额组合与报价不一致，请重新报价`。

**消费时机**：顺序是 **先校验 → 执行业务 → 业务成功后消费报价**。
即业务失败（如名额不足、余额不足）时**报价不会被作废**，用户改完参数还能用原报价重试（除非已超 10 分钟）。
> 8 个提交端点**全部**是这个顺序（包括 `POST /orders`）。`POST /orders` 的响应里带 `quoteConsumed: true/false`，可用于确认报价是否已被消费。

**已支持的报价端点（8 个）**：

| 报价端点 | 场景 scene | 对应提交端点 |
|---|---|---|
| `POST /checkout/quotes` | `checkout` | `POST /orders` |
| `POST /partner/entitlement-quotes` | `entitlement` | `POST /me/entitlement-orders` |
| `POST /partner/quota-purchase-quotes` | `quota_purchase` | `POST /partner/quota-orders` |
| `POST /partner/upgrade-quotes` | `upgrade` | `POST /partner/upgrades` |
| `POST /partner/store-binding-quotes` | `store_binding` | `POST /partner/store-bindings` |
| `POST /partner/quota-transfer-quotes` | `quota_transfer` | `POST /partner/quota-transfers` |
| `POST /costore/application-quotes` | `costore_application` | `POST /applications/costore` |
| `POST /agency/application-quotes` | `agency_application` | `POST /agency/applications` |

> **传参提示**：这 8 个报价端点里，带 `/partner/` 的 5 个**需要 `contextId`**（如 `partner:p1`）。
> `contextId` **放 body 或 query 都行**（`POST /partner/upgrade-quotes?contextId=partner:p1` 或 body 里带 `contextId` 均可），前端按现有习惯传即可。
> 报价端点与提交端点的 `contextId` 需指向**同一个身份**。

**统一响应格式**（8 个报价端点完全一致）：

```json
{ "id": "qt_xxxxxxxx", "expiresAt": "2026-10-26T10:15:00.000Z", "ruleVersion": 1,
  "amount": 1980, "breakdown": { ... }, "items": [ ... ] }
```

- `id` 即 `quoteId`，提交时原样回传。
- `expiresAt` 是 ISO 时间串，前端应据此做**倒计时**（10 分钟）。
- `ruleVersion` 是报价所用的规则版本，用于将来规则升级后提示"需重新报价"。

> ⚠️ 提交时**不要**自己算金额塞回请求，服务端不信任前端金额。请求里带上 `quoteId` 即可。

### 18.2 支付返回缺少关键字段（问题 2）

**结论：已补齐，且支付相关端点语义已统一。**

#### 18.2.1 订单/支付单现在都返回 `id` 与 `paymentId`

`POST /payments/attempts`、`POST /orders/{id}/payment` 现在**同时**返回：

```json
{ "id": "pay_xxxxx", "paymentId": "pay_xxxxx", "orderId": "o_20", "status": "SUCCEEDED",
  "channel": "wechat", "channelName": "微信支付", "amount": 1980, "paymentMode": "sandbox",
  "releasedCommissions": 0, "delivery": { ... }, "payParams": { ... } }
```

`id` 与 `paymentId` **同值**，只是为了兼容前端两种叫法；后续轮询统一用 `GET /payments/attempts/{id}`。

#### 18.2.2 `payParams` 改为渠道级结构

之前 `payParams` 是平铺的一堆字段，现在改为**带渠道元信息**的结构：

```json
{
  "sandbox": true,
  "channel": "wechat",
  "channelName": "微信支付",
  "mode": "sandbox",
  "autoPay": true,
  "note": "沙箱模式：服务端已自动完成支付，前端无需调起渠道 SDK",
  "invoke": { "autoPay": true, "note": "沙箱模式：服务端已自动完成支付，前端无需调起渠道 SDK" },
  "payUrl": "...", "tradeNo": "...", "prepayId": "...", "sign": "..."
}
```

- **前端统一读 `payParams.channel`** 判断用哪个 SDK 调起。
- **统一读 `payParams.invoke`** 取渠道调起参数（`payUrl` / `prepayId` / `sign` 等）。
- 顶层平铺字段（`payUrl`/`tradeNo`/…）**保留**，向后兼容旧前端。
- `sandbox: true` 表示沙箱直通（服务端已自动付，前端**不要**再调起渠道）；`sandbox: false` 表示 live，需要前端用 `invoke` 调起真实渠道。
- **沙箱模式下也始终返回 `payParams`**（之前沙箱不返回，导致前端结构分叉）—— 沙箱时用 `invoke.autoPay === true` 判定即可。

#### 18.2.3 新增 `GET /orders/{id}/payment-channels`

前端不再需要硬编码渠道列表：

```json
{ "orderId": "o_20", "amount": 1980, "paymentMode": "sandbox",
  "items": [ { "id": "wechat", "label": "微信支付", "kind": "WECHAT" },
             { "id": "alipay", "label": "支付宝", "kind": "ALIPAY" },
             { "id": "bank_card", "label": "银行卡", "kind": "BANK_CARD" } ],
  "note": "沙箱模式：任意渠道均直通成功" }
```

#### 18.2.4 `/orders/{id}/payment` 是不是只给沙箱/内部用？

**不是。** 该端点现在是**正式对外的"发起支付"入口**，`sandbox` / `live` 都用：

- **sandbox**：直接返回 `status: "SUCCEEDED"`（已自动付），同时放行挂起的分润台账。
- **live**：创建支付单，返回 `status: "CREATED"` + `payParams`，前端用 `invoke` 调起渠道；支付结果以渠道异步通知 `POST /payments/notify/{channel}` 为准，前端可轮询 `GET /payments/attempts/{id}`。

**旧契约字段全部保留**：`orderId` / `status` / `releasedCommissions` / `delivery` 均未删除，旧前端无需改造。

> 🐛 **本轮顺带修掉一个既有 bug**：产品订单的实际金额落在 `paid` 字段，而旧代码读的是 `amount`/`paid_amount`/`total`，导致 `/payments/attempts` 与 `/orders/{id}/payment` 报「订单金额无效」。现已统一走 `orderAmount()` 兜底所有历史字段名。

### 18.3 升级费用支付流程不清（问题 3）

**结论：live 模式下是「一张支付单」，且支付成功后才扣名额、授等级。**

| 环节 | sandbox | live |
|---|---|---|
| 报价 | `POST /partner/upgrade-quotes` → `id`/`expiresAt`/`breakdown`（差价 + 服务费） | 同左 |
| 提交 | `POST /partner/upgrades`（带 `quoteId`） | 同左 |
| 支付 | 无需支付，直通 | **创建 1 张支付单**，金额 = 差价 + 服务费（合并为 `totalPayable`） |
| 扣名额 / 授等级 | 提交后**立即**执行 | **支付成功回调后**才执行 |

**live 模式 `POST /partner/upgrades` 响应**：

```json
{ "status": "CREATED", "operationId": "pay_xxx", "paymentId": "pay_xxx",
  "channel": "wechat", "channelName": "微信支付", "amount": 5300,
  "breakdown": { "partnerFee": 5000, "serviceFee": 300 },
  "targetLevel": "angel", "targetAccountId": "p1",
  "payParams": { ... },
  "pendingEffects": ["扣减上级增量名额", "授予目标账号等级", "落供货链级差与平级奖台账"],
  "note": "请完成支付；支付成功后系统自动扣减名额并授予等级" }
```

- `breakdown.partnerFee` = 差价（目标档位标价 − 当前本金档位标价，下限 0）。
- `breakdown.serviceFee` = 服务费估算（**与报价完全同源**，报价与落账共用 `src/upgradeService.js`，不会出现"报价一个数、实收另一个数"）。
- `pendingEffects` 明确告诉前端"哪些动作还没发生"，用于提示用户"支付中…"。
- 前端应据此把按钮置为"去支付"，支付完成后刷新合伙人信息。

**关键时点**：**名额扣减与等级授予都在支付成功之后**，不会出现"未付先扣名额"。

### 18.4 上传链路仍不完整（问题 4）

**结论：`fileId` 与 `assetId` 是同一个 id；完整链路是三步，缺一不可。**

#### 18.4.1 `fileId` vs `assetId`

`POST /assets/upload-intents` 现在**同时返回两个同值字段**：

```json
{ "assetId": "ast_xxxx", "fileId": "ast_xxxx", "mode": "multipart",
  "uploadUrl": "https://upload.naoshang.example.com/ast_xxxx",
  "fileField": "file", "headers": {}, "fields": {},
  "limits": { "maxSize": 10485760 },
  "status": "PENDING",
  "nextStep": "把文件上传到 uploadUrl（字段名 file），然后调用 POST /assets/ast_xxxx/completions 确认" }
```

> `fileId === assetId`，前端**任选其一**都能提交申请，新版用 `fileId`、旧版用 `assetId` 都行。

#### 18.4.2 完整链路（三步，不能跳）

```
① POST /assets/upload-intents          → 拿 uploadUrl + fileId（此时 status = PENDING）
② 把文件 PUT/POST 到 uploadUrl（字段名 fileField="file"）  ← 这一步必须前端真的做
③ POST /assets/{fileId}/completions    → 服务端置 status = READY
④ 提交申请（带 fileId）                 ← 只有 READY 的资源才会被接受
```

- **不能拿凭证 ID 直接提交申请**：服务端会校验资源存在 + `status === 'READY'` + 归属当前账号，任一不满足 → 400，提示"资源未完成上传/资源不存在/无权使用该资源"。
- 第③步之后 `GET /assets/{id}` 可查到 `status: "READY"`。
- `nextStep` 字段是给前端的**明确指引文案**，可直接展示或做流程控制。

### 18.5 权益规则没有闭合（问题 5）

**结论：两套规则已统一为「三态」，旧版 `locked: true` 响应完全保留。**

| 状态 | 含义 | 收益计算 | 收益可见 | 功能入口 | `frozen` | `canExportBills` |
|---|---|---|---|---|---|---|
| `never_paid` | **从未开通** | ✅ **照算**（后台正常入账） | ❌ 不可见 | ❌ 无（只留开通入口） | `false` | `false` |
| `active` | 已开通且在有效期内 | ✅ 正常 | ✅ | ✅ 全开 | — | — |
| `expired` | 已开通但已过期 | ❌ **停算** | ❌ 不可见 | ❌ 无 | `true` | `true` |

**门禁载荷**（`GET /me/bootstrap` 等接口返回 `gate` 字段）：

```json
{ "locked": true, "entitlementState": "expired", "entitlementAmount": 200,
  "frozen": true, "canExportBills": true,
  "message": "权益已过期，收益已停止计算；可导出历史账单，续费后恢复" }
```

- `never_paid` 时 `message` 为：`开通 200 元权益收益费后即可查看收益与使用全部功能（未开通期间收益照常计算）`。
- **`locked: true` 是老版就有的字段，本轮未做任何改动**，老前端"按 locked 隐藏入口"的逻辑继续有效。
- `active` 状态下 `gate` 为 `null`（没有门禁）。
- **过期规则已在新版重申**：新版说"未开通收益照算"，旧版说"过期后收益停算"——这两句**不矛盾**，分别对应 `never_paid` 和 `expired` 两个不同状态。

### 18.6 收益多态缺少字段定义（问题 6）

**结论：14 类 `bizType` 的 `bizDetail` 结构已全部定义，并新增 `GET /income/biz-types` 字典接口。**

#### 18.6.1 `bizType`（业务类型，14 类）与 `allocationKind`（分配角色，2 类）是两套概念

- **`bizType`** = 这笔收益是**什么业务**产生的（产品提成 / 合店费 / 全球奖…）。
- **`allocationKind`** = 这笔收益**分给谁**（`inspect` 巡查 / `sales` 销售），是分配接口（`allocation-options` / `allocations`）用的**分配角色**。

> ⚠️ 旧版分配接口把 `inspect` / `sales` 塞进 `bizType`，容易与业务类型混淆。**已明确区分**：前端在**收益列表/详情**里用 `bizType`，在**分配弹窗**里用 `allocationKind`，两者不要混用。`GET /income/biz-types` 返回的 `note` 字段也写明了这一点。

#### 18.6.2 `GET /income/biz-types` 响应

```json
{
  "bizTypes": [
    { "key": "product_commission", "label": "产品提成",
      "detailFormat": "{商品类型}：{商品名} × {数量}（实付 {金额} 元）",
      "detailFields": ["productKind", "productName", "qty", "paid"] },
    { "key": "quota", "label": "合伙人名额",
      "detailFormat": "{档位A} → {档位B}（名额 {n} 个）｜ 平级奖 · 名额 {n} 个",
      "detailFields": ["fromTier", "toTier", "quotaCount"] },
    ...共 14 条
  ],
  "bizDetailSchema": {
    "product_commission": { "label": "产品提成", "detailFormat": "...", "detailFields": [...], "source": "关联订单（kind / productName / qty / paid）" },
    ...
  },
  "allocationKinds": [
    { "key": "inspect", "label": "巡查", "note": "区县负责人巡查分配（默认 5%）" },
    { "key": "sales",   "label": "销售", "note": "销售门店分配（默认 5%）" }
  ],
  "note": "bizType 是业务类型（14 类）；allocationKind 是分配角色（inspect/sales），两者不要混用"
}
```

#### 18.6.3 14 类 `bizDetail` 结构对照表

| bizType key | label | detailFormat | detailFields |
|---|---|---|---|
| `product_commission` | 产品提成 | `{商品类型}：{商品名} × {数量}（实付 {金额} 元）` | `productKind, productName, qty, paid` |
| `supply_chain` | 供应链费 | 同上 | `productKind, productName, qty, paid` |
| `software_fee` | 软件卡抽成费 | 同上 | `productKind, productName, qty, paid` |
| `featured` | 特色产品 | 同上 | `productKind, productName, qty, paid` |
| `column` | 专栏课 | 同上 | `productKind, productName, qty, paid` |
| `admin_fee` | 行政费 | 同上 | `productKind, productName, qty, paid` |
| `quota` | 合伙人名额 | `{档位A} → {档位B}（名额 {n} 个）｜ 平级奖 · 名额 {n} 个` | `fromTier, toTier, quotaCount` |
| `agent_fee` | 代理费 | `开通{代理级别} · {区域码}（技术费 {金额} 元）` | `agentLevel, regionCode, techFee` |
| `costore_fee` | 合店费 | `合店费 {金额} 元{ · 子类}` | `amount, subType` |
| `service_fee` | 门店服务费 | `{区域} 门店服务费 · 名额 {n} 个` | `regionType, quotaCount, amount` |
| `staff_fee` | 店员费 | `店员费 {金额} 元` | `amount, baseAmount` |
| `global_bonus` | 全球奖 | `全球奖 · {期数} 奖池` | `period, pool` |
| `founder_bonus` | 创始奖 | `创始奖 · {期数}` | `period` |
| `other` | 其他收益 | `{等级} · {备注/公式}` | `tier, remark` |

- 每条 `bizDetail` 的实际返回值就是 `detailFields` 里那些 key 的键值对。
- **前端可直接用 `detailFormat` 做模板渲染**：把 `{商品类型}` 这类占位符按 `detailFields` 顺序回填即可，不必自己拼文案。
- `source` 字段标明该字段的数据来源表/字段，仅供后端排查，前端可忽略。

**收益明细接口**（`GET /income/entries?contextId=partner:<userId>`）现在每条都带 `bizType` / `bizTypeLabel` / `bizDetail`；收益详情额外带 `allocationKind`（有分配时）。

> ⚠️ `GET /income/entries` **必须带 `contextId`**（如 `partner:p3`），否则返回空列表。

### 18.7 晋升领取接口仍未给出（问题 7）

**结论：已新增 `GET/POST /partner/promotion-claims`。**

#### GET — 查看状态

`GET /partner/promotion-claims?contextId=partner:<userId>`

```json
{ "taskId": "pt_xxx", "status": "ACHIEVED", "statusLabel": "已达标，待领取",
  "achieved": true, "claimable": true, "claimed": false,
  "grantedTier": "angel", "grantedTierLabel": "天使合伙人",
  "achievedAt": 1793004108658, "claimedAt": null,
  "currentTier": "vip", "currentTierLabel": "VIP 合伙人",
  "items": [ ... ], "validUntil": "2026-11-26T...", "daysLeft": 30,
  "grantRule": { ... } }
```

`status` 取值：`ONGOING`（进行中）/ `ACHIEVED`（已达标可领取）/ `CLAIMED`（已领取）/ `EXPIRED`（已过期）/ `NONE`（无任务）。

**前端判定逻辑**：`status === 'ACHIEVED'` → 显示「立即领取」按钮；`status === 'CLAIMED'` → 显示「已领取 + 授予档位」。

#### POST — 领取

`POST /partner/promotion-claims`（`contextId` 可放 **body** 或 **query**，两种都支持）

```json
{ "status": "CLAIMED", "granted": true, "alreadyClaimed": false,
  "fromTier": "vip", "toTier": "angel", "taskId": "pt_xxx",
  "message": "晋升成功：VIP 合伙人 → 天使合伙人" }
```

- **幂等**：重复领取返回 `alreadyClaimed: true` + `granted: false`，**不会重复授级**。
- 未达标 → 400 `尚未达标，暂不可领取`；未开通合伙人 → 400 `尚未开通合伙人，无晋升任务`；任务未开启 → 400 `晋升任务未开启`。

### 18.8 核销与幂等边界未说明（问题 8）

#### 18.8.1 核销规则

| 边界 | 规则 |
|---|---|
| **谁可以核销** | 门店账号（`contextId` 为门店身份）才能核销本店订单；非本店/非门店身份 → 403/400 拒绝 |
| **未付款能否核销** | **不能**。订单必须处于可核销态（已支付），未付款 → 拒绝 |
| **重复核销** | 订单核销后状态变更，**再次核销同一订单会被拒绝**（幂等保护，不会重复放行分润） |
| **失败次数上限** | 核销码错误或门店不匹配 → 累计 `verify_fail_count`；**累计 5 次**后订单置 `verify_locked = true`，**锁定核销**，需联系总部解锁 |
| **成功清零** | 一次成功核销会把 `verify_fail_count` 归零、`verify_locked` 置回 `false` |
| **错误响应** | 失败响应带 `verifyFailCount`（当前失败次数）与 `verifyLocked`（是否已锁定），前端可提示"还剩 N 次机会" |

#### 18.8.2 幂等边界（统一规则，已全端点接入）

**统一约定**：

- 请求体带 `idempotencyKey`（字符串）。
- **同 key + 同业务参数** → **幂等命中**，返回第一次的结果（同一个 `id`），**不会重复扣款/重复落账**。
- **同 key + 不同业务参数** → **HTTP 409 冲突**，错误信息形如：
  `同一 idempotencyKey 已用于不同的请求参数（差异字段：amount），请更换幂等键`
- **不传 `idempotencyKey`** → 不做幂等保护，每次都是新记录（前端请务必传）。

**已接入幂等保护的端点（8 个）**：

| 端点 | 计入判定的业务参数 |
|---|---|
| `POST /support/feedback` | `content, imageAssetIds` |
| `POST /members` | `name, gradeCode, genderCode, avatarAssetId` |
| `POST /wallet/withdrawals` | `payeeToken, amount` |
| `POST /coaches` | `storeId, name, loginAccount` |
| `POST /training/feedback` | `memberId, title, text, imageAssetIds, attachmentAssetIds` |
| `POST /store-transfers` | `memberId, targetStoreId, reason` |
| `POST /material-renders` | `materialId, qrAssetId` |
| `POST /payments/attempts` 等支付发起 | `bizType, bizId, userId, amount` |

> **支付幂等的特别说明**：`channel`（渠道）**不计入**冲突判定。
> 因为网络重试时前端可能带上不同的默认渠道，这属于**同一笔支付的正常重试**，应幂等返回原支付单且**渠道保持原样**（前端会拿到原渠道，直接用它调起即可）。
> 只有 `bizType` / `bizId` / `userId` / `amount` 变化才算"同 key 不同参数" → 409。

**实现说明**：`src/utils/idempotency.js` 统一处理。指纹为 **sha256 前 32 位**，字段顺序无关、数字与字符串归一（`200` 与 `"200"` 视为相同）。历史存量记录没有指纹字段时**放行**（不误伤老数据）。

### 18.9 本轮改动文件清单

| 文件 | 改动 |
|---|---|
| `src/quoteStore.js` | 拆出 `checkQuote`（校验不消费）/ `markConsumed`（成功后消费） |
| `src/upgradeService.js` | **新建**：升级报价与落账同源（`quoteUpgrade` / `applyUpgrade`） |
| `src/utils/idempotency.js` | **新建**：统一幂等层（`fingerprint` / `check` / `stamp`） |
| `src/payment.js` | 新增 `upgrade` 业务类型；`payParams` 改渠道级结构；幂等改用 `IDEM.check` |
| `src/orderLifecycle.js` | 新增核销 5 次失败上限与锁定、成功清零；新增 `orderAmount()` 兜底金额字段 |
| `src/bizType.js` | 新增 `BIZ_DETAIL_SCHEMA`（14 类）与 `ALLOCATION_KINDS`；新增 `fullDictionary()` |
| `src/identity.js` | 权益三态门禁载荷（`never_paid` / `active` / `expired`）——本轮仅补充文档化，代码逻辑未变 |
| `src/routes/h5.js` | 8 个报价端点落库 + 7 个提交端点接校验；升级 live/sandbox 双模式；支付端点补字段；新增 3 个端点 |
| `src/routes/h5biz.js` | 上传凭证返回 `fileId`/`status`/`nextStep`；8 个端点接入幂等层 |
| `scripts/verify_frontend_questions_20261026.js` | **新建**：8 问回归脚本（117 项断言） |

### 18.10 实机复验后补修的 3 处（同日第二轮）

首轮交付后，用**真实 HTTP 请求**逐条复验 8 问（起真实服务 + curl 抓包），发现 3 处问题并已修复：

| # | 问题 | 性质 | 修复 |
|---|---|---|---|
| 1 | `POST /orders` 用的是 `consumeQuote`（**先消费**），而其它 7 个提交端点用 `checkQuote` + `markConsumed`（成功后消费）。若下单失败，报价会被白白消耗——正是本轮设计要避免的 | **代码不一致** | 统一为 `checkQuote` → 执行业务 → `markConsumed`。现在 **8 个提交端点全部**是「先校验 → 成功后消费」 |
| 2 | `opCtx()` 只从 **body** 读 `contextId`，而 `needCtx()` 读 **query**。前端把 `contextId` 放 query 时，10 个端点直接报「contextId 必填」 | **接口易用性缺陷** | `opCtx()` 改为 `body.contextId || query.contextId`，**两种传法都支持**（涉及 entitlement / quota-purchase / upgrade / store-binding / quota-transfer 等 10 个端点） |
| 3 | 文档写「提交接口**必须**带 `quoteId`」，但实现是「**传了才强校验，不传也允许**」（为兼容旧调用） | **文档与实现不一致** | 见 §18.1 已改为准确表述：推荐传、传了就强校验、不传则服务端全额重算金额 |

**复验结论**：8 问的真实 HTTP 冒烟 **27/27 全绿**（新增临时脚本 `scripts/_smoke8.js`，验证完已删除）。重点确认：
- 同 key 仅换渠道 → 返回**同一支付单**、渠道保持原样（实机抓包：`paysyo90cxj` → `paysyo90cxj`，channel 仍 `wechat`）
- 同 key 改订单 → **409**「差异字段：bizId」
- 假 quoteId → 400「报价不存在或已失效，请重新报价」
- 未 READY 的上传资源提交申请 → 被拒（「请上传门头照」）

**回归**：`verify_frontend_questions_20261026.js` 113 → **117 项断言全部通过**（新增 4 条：下单失败不消耗报价 / 失败后原报价仍可用 / contextId 放 query 报价端点 / contextId 放 query entitlement 端点）；全量 27 个验证脚本零失败。

> ⚠️ **给前端的提醒**：如果你们的代码里有「提交时把 `contextId` 放 query」或「提交时不带 `quoteId`」的写法，现在都能正常工作；但**建议统一带上 `quoteId`**，以获得「用户确认过这个价」的价格保护。



---

## 附：相关文档

| 文档 | 用途 |
|---|---|
| `docs/API文档.md` | 管理端 `/api/*`（总部后台）全量接口 |
| `docs/后端待开发清单.md` | P0/P1/P2 现状与待拍板项（**P1 已全部落地，逐条标注了实现方式**） |
| `docs/合伙人收益逻辑设计.md` | 合伙人侧收益算法与口径 |
| `docs/区域代理与产品分成设计.md` | 代理侧分成与价格表 |
| `docs/合店老板收益逻辑设计.md` | 合店四场景与分红池 |
| `docs/数据库设计.md` / `sql/schema.sql` | 数据结构（PG 迁移稿） |
