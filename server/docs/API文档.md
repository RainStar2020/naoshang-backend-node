# 脑商AI合伙人 · H5 测试平台 API 文档

> 服务：`E:\脑商ai\server\server.js`　启动：`node server.js`（默认端口 3000，可用 `PORT` 环境变量覆盖）
>
> 管理员密码：`admin888`（可用 `ADMIN_PASSWORD` 环境变量覆盖）
>
> 所有接口返回 JSON（`Content-Type: application/json; charset=utf-8`）
>
> 鉴权：`Authorization: Bearer <token>`（也支持 `?token=<token>` 查询参数）
>
> 📌 **另见独立文档 [后台API.md](./后台API.md)** —— 总部后台（HQ）接口全集，
> Base Path `/api/hq`，**26 个模块 / 120 个接口**（HQ-01 ~ HQ-26）。
> 本文 0.1 节有索引。
>
> 更新记录：2026-10-23 v2.1 —— **分润口径修正**：① 售卖合伙人/VIP/私董/联创身份名额**只赚供货差价，无直推奖、无复购奖**（直推奖仅存在于产品提成与代理技术费）；② 零售整包供货差价改为 `实付(零售价) − 卖家拿货成本`；③ 合店费中省 2%/市 8%/区县 10% 结算时按 `regionCode` 落到真实区域代理（此前落到不存在的 `PROV/CITY/DIST` 幽灵账户）。
>
> 更新记录：2026-10-23 v2.0 —— 新增产品域接口（B7~B10 / C22 / D7）、后台配置（C23）、**多身份体系**（C24 / C25 / D8 / D3 身份过滤），为商城系统预留身份折扣架构。

---

## 0. 接口总览

本平台共 **48 个 API**，分五组：

| 组别                   | 数量 | 鉴权  | 说明                                                                                   |
| -------------------- | -- | --- | ------------------------------------------------------------------------------------ |
| A. 登录鉴权              | 1  | 否   | 管理员 / 用户登录，签发 token                                                                  |
| B. 算法计算器与产品域         | 11 | 否   | 纯函数直跑（验证分润算法）+ 商城产品目录/报价（**商城系统预留**）                                                 |
| C. 管理员（总部/后台）        | 27 | 管理员 | 种子数据、合伙人、下单（套餐+产品）、代理、合店、补货、关系、结算、报表、门店、区域团队、**编辑改ID**、**逐笔明细**、**代查任意用户身份/收益**、后台配置、**免费升档进度** |
| D. 用户（合伙人/区域代理/合店老板） | 9  | 用户  | 我的收益、团队树、收益明细（**分身份过滤**）、**身份列表（切换数据源）**、**合伙人总览（本金/免费升档进度）**、区域代理、合店、产品下单、区域试算         |
| E. 静态资源              | —  | 否   | `/` `/app.js` `/admin.js` `/styles.css` H5 页面                                        |

> **免登录直达**（测试便利）：`/?as=admin` 直达后台，`/?as=13800000001` 直达指定合伙人身份。

> **逐笔核对工具**：`node scripts/audit_ledger.js --scenario=A` 生成可手算的逐笔台账；详见 `docs/手算核对指南.md`。

> **多身份体系（2026-10-23）**：同一账户可同时持有 **合伙人 / 区域代理 / 合店老板** 三种身份，各身份收益严格分离。`GET /api/identities` 返回身份列表与各身份当月收益（前端身份切换栏数据源）；`GET /api/commissions?identity=` 按身份过滤流水；产品成交价按身份解析（**代理折扣 > 合伙人折扣 > 原价**，两套折扣表严格分开）。详见 D8、D3、B7 与 G6。

### 0.1 独立文档：后台API

| 文档 | Base Path | 规模 | 鉴权 | 说明 |
| --- | --- | --- | --- | --- |
| **[后台API.md](./后台API.md)** | `/api/hq` | **26 个模块 / 120 个接口**（82 GET · 38 POST） | 管理员会话 | **总部后台（HQ）接口全集**，HQ-01 ~ HQ-26 |

- 独立成篇，不占用本文档的 48 个接口编号（C 组的「管理员」接口是种子/下单等**运维工具**，
  与后台业务接口不是一回事）。
- 统一约定：响应信封 `{ code, message, data }`、错误码（40100/40300/40400/40000/40900/40901/40902/40903/50000）、
  分页（page / pageSize ≤ 100）、金额单位「元」两位小数、列表脱敏。
- 写操作统一约定：`reason` 必填 + `idempotencyKey` 幂等 + `version` 乐观锁 + 审计回执，
  且 **幂等优先于乐观锁**（重复提交返回同一业务结果）。
- 落地约束：后台写操作一律落 `db.json`（真源），由既有同步器单向镜像进 MySQL，**绝不直写 MySQL**。

---

## A. 登录鉴权

### A1. 登录

`POST /api/auth/login` — **功能：管理员与合伙人双入口登录，签发会话 token**

**入参**

| 字段         | 类型     | 必填       | 说明                           |
| ---------- | ------ | -------- | ---------------------------- |
| `role`     | string | 是        | `admin`（总部/后台） 或 `user`（合伙人） |
| `password` | string | admin 必填 | 管理员密码，默认 `admin888`          |
| `phone`    | string | user 必填  | 合伙人手机号，需已录入系统                |

**出参**

```json
{ "token": "admin-zc3743...", "role": "admin", "name": "总部/后台" }
{ "token": "user-abc12...", "role": "user", "userId": "p1", "tier": "cofounder", "name": "总部联创-甲" }
```

**错误**：`401 管理员密码错误` / `404 未找到该手机号对应的合伙人` / `400 role 必须是 admin 或 user`

> 说明：用户端 token 与 `userId` 绑定，之后所有用户接口只返回本人数据；管理员可在 URL 传 `?userId=` 代查任意用户。

---

## B. 算法计算器（无需登录，直跑纯函数）

这一组是**验证算法正确性**的核心入口，直接调用 `src/regionAgent.js` 等纯函数，不落库。

### B1. 区域奖计算

`POST /api/calc/region-vip` — **功能：计算某层级区域代理的 VIP 区域奖（每 VIP 定额）**

**入参**：`regionType`（`province`/`city`/`district`）、`vipCount`（VIP 成交数，默认 1）

**出参**：`{ region_type, perVip, vipCount, amount }`

**口径（tp123）**：省 100 / 市 200 / 区县 300（元每 VIP）。门店店长 2400 不走此接口，由门店服务费 3000 拆分（门店 2400 + 区县 300 + 市 200 + 省 100 = 3000 闭环）。

> **门店服务费只在「门店老板」身份售出时计提**（2026-10-23 16:56 用户口径）：卖方须持有 store 级区域代理任命；合伙人身份（VIP/天使/私董/联创）或合店老板身份卖出，一律走**合伙人售卖**通道，`store_fee = 0`，该 3,000 并入总部 `hq_fee`（底价 6,500 不变）。订单落 `channel` 字段（`store` / `partner`）。
>
> **区域码归集（2026-10-24）**：区域码用**结构化层级码**（省 33→市 3301→区县 330110→门店 330110-0001）；`regionalAgents` 每条带 `parent_code`（显式父级），门店渠道订单自动带 `store_code`。`runAgent` 从叶子门店码按 `parent_code` 逐级向上归集（门店 2400 / 区县 300 / 市 200 / 省 100），未覆盖级别回退旧精确匹配——**门店码≠订单区县码也不再掉总部**。随机字母数字码不推荐；二维码仅作展示层（内容=门店码/URL）。

### B2. 实物产品级差计算

`POST /api/calc/physical-diff` — **功能：按「折扣率差 × 基准价」计算实物产品的级差收益**

**入参**：`sellerLevel`（供货方档位）、`buyerLevel`（收货方档位）、`qty`（数量）、`basePrice`（基准价，默认 6980）

**出参**：`{ kind, sellerLevel, buyerLevel, sellerDiscount, buyerDiscount, basePrice, qty, unitDiff, buyPrice, sellPrice, amount, note }`

> ⚠️ **方向**：`sellerLevel` = **供货方**，`buyerLevel` = **收货方**；`amount` 是**供货方**的级差收益（正数 = 供货方赚钱）。
>
> 例：官方算例「VIP 向单店进货」→ `sellerLevel='store'`、`buyerLevel='vip'`，门店赚 **2094**。

**口径（tp123 note 00）**

- 合伙人侧折扣：VIP 8折 / 天使 7.5折 / 私董 7折 / 联创 6.5折
- 区域代理侧折扣：单店 5折 / 区县 4折 / 市 3.5折 / 省 3折
- 级差 = (买方折扣率 − 卖方折扣率) × 基准价

**官方算例复现**（平板 6980，成本 0）

| 场景                  | 结果                                |
| ------------------- | --------------------------------- |
| 天使(0.75)向市代(0.35)进货 | 买价 2443 / 卖价 5235 / 市代收益 **2792** |
| VIP(0.8)向单店(0.5)进货  | 门店赚 6980×(0.8−0.5) = **2094**     |
| 单店(0.5)向区县(0.4)进货   | 区县赚 6980×(0.5−0.4) = **698**      |

### B3. 虚拟产品分成计算

`POST /api/calc/virtual-split` — **功能：计算虚拟产品（课程/会员卡/合店费）按「剩余比例」的分成**

**入参**：`paidAmount`（合伙人实付金额 = 分配池基数）、`deliveryType`（`hq` 总部交付 / `store` 门店交付）

**出参**：`{ deliveryType, pool, hq, province, city, store, total, closure, breakdown?, storeInner? }`

**口径（tp123 note 00「二、虚拟产品」）**—— 按比例分成，**不是**折扣价差

| 交付方式 | 总部  | 省代 | 市代 | 单店  |
| ---- | --- | -- | -- | --- |
| 总部交付 | 55% | 2% | 8% | 35% |
| 门店交付 | 15% | 2% | 8% | 75% |

> 门店交付场景「总部 25%」= 省代 2% + 市代 8% + 总部 15%，即顶层等价为 总部15% + 省2% + 市8% + 单店75% = 100%。
>
> 单店 75% 内部（`storeInner`，相对分配池）：门店股东 0.5 / 推荐人 0.05~0.15 / 合店老板分红 0.1。

**官方算例复现**：私董买月卡实付 700，门店交付 → 总部 105 / 省 14 / 市 56 / 单店 525（合计 700，closure=true）。

### B4. 门店交付分配

`POST /api/calc/store-delivery` — **功能：计算门店折扣交付的分配（按代理级别提点 + 股东均分 + 复购 2%）**

**入参**：`discountAmount`（折扣金额）、`ownerCount`（门店老板人数）、`opts.regionType`（`store`/`district`/`city`/`province`，默认 `store`）

**出参**：`{ regionType, discountAmount, ownerCount, storeRate, repurchaseRate, storePool, referrerRepurchase, perOwnerGross, perOwnerRepurchaseShare, perOwnerNet, ownersNetTotal, remainderToOther }`

**口径（tp123 分成表 C 端门店交付）**

- 单店 65% / 区县代 75% / 市代 8% / 省代 10% 进入门店池，多股东按人数均分
- 推荐人复购奖 2% 由各股东均摊（从股东净额中扣除）
- `remainderToOther` = 折扣额 − 门店池 − 复购奖，归其他代理层级（按分成表层级差异）

**官方算例复现**：折扣额 1600、单店、2 股东 → 门店池 1040（每人 520）、复购 32（每人 16）、人均净 504。

### B5. 区域代理月度总账

`POST /api/calc/region` — **功能：一次性算出区域代理当月全部分润合计**

**入参**

| 字段                   | 说明                                                   |
| -------------------- | ---------------------------------------------------- |
| `regionType`         | `province`/`city`/`district`/`store`                 |
| `vipCount`           | 本月 VIP 成交数                                           |
| `goods`              | 实物明细数组 `[{sellerLevel, buyerLevel, qty, basePrice}]` |
| `signingBase`        | 直推代理奖基数（业务提点口径，实算例 40000）                            |
| `adminFeeAsDelivery` | 行政费总额（按 5%/5%/90% 拆分）                                |
| `coStoreFees`        | 合店费数组（如 `[698]`）                                     |
| `vipPartnerCount`    | 成交 VIP 合伙人数（用于本级代理的 VIP 合伙人奖）                        |

**出参**：`{ region_vip, region_goods_diff, region_signing, region_admin_delivery, region_costore, vip_partner, total, detail, adminFeeSplit }`

**口径**

- 直推代理奖 = 基数 × **15%**（tp123 取代旧「区域开发奖 8%」）
- VIP 合伙人奖：省代 200 元 / 市代 165 元 / 区县代 100 元 / 单店 无
- 行政费：总部 5% + 销售门店股东 5% + 交付方 90%

### B6. 代理分成表与门槛费

`GET /api/calc/agent-fee` — **功能：一次性取回全部代理级别的分成率、门槛费、身份映射**

**入参**（query）：`cityTier`（市代门槛档位，1/2/3，默认 1）

**出参**：`{ share, thresholdFee, tier }`

**分成表（tp123 note 01）**

| 级别  | B端业务 | B端服务      | C端门店交付    | C端总部交付    | VIP合伙人奖   | 供应链  | 身份要求   |
| --- | ---- | --------- | --------- | --------- | --------- | ---- | ------ |
| 省代  | 20%  | 10%(其中2%) | 10%(其中2%) | 10%(其中2%) | 200元(35元) | 3折   | 10 联创  |
| 市代  | 18%  | 8%        | 8%        | 8%        | 165元(65元) | 3.5折 | 联创     |
| 区县代 | 15%  | —         | 75%       | 35%       | 100元      | 4折   | 私董     |
| 单店  | 15%  | —         | 65%       | 30%       | —         | 5折   | 高级（天使） |

**门槛费**：省代 260 万 / 市代 45万·40万·35万（按规模）/ 区县代 12 万 / 单店 8 万

### B7. 产品目录与买家报价（商城系统预留）

`GET /api/products` — **功能：取回产品目录 + 分成口径常量；带 `userId`（或用户登录态）时追加该买家的身份解析与全产品报价**

**查询参数**：`userId`（可选；不传且无登录态时只返回目录与常量）

**出参**

```json
{
  "catalog": { "pad": { "key": "pad", "name": "脑商Pad", "listPrice": 6980, "kind": "physical", "fixedCost": 0, "variableCost": 6980 }, "...": "..." },
  "kind": { "physical": "实物", "software": "软件卡", "virtual": "虚拟", "featured": "特色", "admin": "行政费" },
  "featuredSplitRows": [{ "role": "hq", "label": "总部", "rate": 0.15 }, "..." ],
  "partnerProductRate": { "vip": 0.05, "angel": 0.10, "private": 0.15, "cofounder": 0.15 },
  "productCommissionMode": "tier",
  "discounts": {
    "partner": { "vip": 0.8, "angel": 0.75, "private": 0.7, "cofounder": 0.65 },
    "agent":   { "store": 0.5, "district": 0.4, "city": 0.35, "province": 0.3 }
  },
  "buyer": {
    "id": "p6", "name": "门店老板-己", "tier": "angel", "agent_region_type": "store",
    "level": "store", "discount_kind": "agent", "partner_level": "angel", "agent_level": "store"
  },
  "prices": {
    "pad": { "key": "pad", "name": "脑商Pad", "kind": "physical", "level": "store", "discount_kind": "agent",
             "unitPrice": 3490, "total": 3490, "formula": "0 + 6980×0.5 = 3490",
             "partnerUnitPrice": 5235, "agentUnitPrice": 3490 }
  }
}
```

**身份解析口径**（`resolveBuyerLevel` 单一入口，订单创建 / 用户端商城 / 后台代下单共用）：

| 优先级 | 条件      | 成交档位                | `discount_kind` |
| --- | ------- | ------------------- | --------------- |
| 1   | 买家是区域代理 | 代理级别（单店/区县/市/省）     | `agent`         |
| 2   | 买家是合伙人  | 合伙人档位（VIP/天使/私董/联创） | `partner`       |
| 3   | 都不满足    | `list` 原价           | `list`          |

> **两套折扣表严格分开、力度不同**：代理折扣（5/4/3.5/3 折）整体深于合伙人折扣（8/7.5/7/6.5 折），代理身份优先 = 买家最优价。既是合伙人又是代理的买家（如 p6 天使+单店），`prices` 同时给出 `partnerUnitPrice`（合伙人价）与 `agentUnitPrice`（代理拿货价）供前端对照展示，实际成交按 `agentUnitPrice`。
>
> 成交价公式：`固定成本 + 变动成本 × 档位折扣`（例：脑商Pad 天使价 = 0 + 6980×0.75 = 5235；特色营 VIP 价 = 8000 + 2000×0.8 = 9600；特色营 私董价 = 8000 + 2000×0.7 = 9400；特色营 原价 = 10000）。
>
> ⚠️ **特色产品例外（陪练卡 / 特色营，用户 2026-10-27 明确）**：代理买家**不享受其更深的代理折扣**，而是按「对应合伙人档位」成交（省代→联创 / 市代→私董 / 区县代→天使 / 单店→VIP）。例：特色营 省代(映射联创6.5折) = 9300、单店(映射VIP8折) = 9600，均高于其代理折扣价；分成池 = 成交价 − 固定成本 = 变动成本2000 × 合伙人折扣（盈利全部从 2000 拨比中获得）。

### B8. 产品成交价计算

`POST /api/calc/product-price` — **功能：按买家档位计算单个产品成交价（三套价格体系统一入口）**

**入参**：`key`（产品 key，见 G7）、`level`（`list`/`vip`/`angel`/`private`/`cofounder`/`store`/`district`/`city`/`province`，默认 `list`）、`qty`（默认 1）

**出参**：`{ key, name, kind, level, discount, fixedCost, variableCost, unitPrice, qty, total, formula }`

**错误**：`未知产品：X` / `未知档位：X`

### B9. 合伙人产品提成计算

`POST /api/calc/product-commission` — **功能：计算上级合伙人的产品提成（替代旧 2% 复购奖，覆盖首购+复购）**

**入参**：`paid`（实付金额）、`uplineTier`（上级合伙人档位）、`mode`（`tier` 默认 / `flat2` 回滚旧口径）

**出参**：`{ mode, uplineTier, rate, amount, formula, legacyAmount }`

**口径**：VIP 5% / 天使 10% / 私董 15% / 联创 15%（基数 = 实付 − 固定成本）；无上级合伙人返回 `amount: 0`。

### B10. 特色产品分成计算

`POST /api/calc/featured-split` — **功能：特色产品按 15/2/8/(5+5)/(30+30+5) 口径分成**

**入参**：`paid`（客户实付）、`fixedCost`（固定成本）、`deliveryType`（`store` 门店交付 / `hq` 总部交付）、`inspectionAssignee`（巡查 5% 分配对象：`self`/`upperCity`/`upperProvince`/`hq`/`other`，可选）

**出参**：`{ paid, fixedCost, pool, deliveryType, rows: [{ role, label, rate, owner, amount, note, pending? }], byRecipient, total, closure, rateClosure, pending }`


**口径（图2/图3）**

| 角色      | 比例  | 说明                                      |
| ------- | --- | --------------------------------------- |
| 总部      | 15% | —                                       |
| 省代      | 2%  | —                                       |
| 市代      | 8%  | —                                       |
| 区县代（管理） | 5%  | —                                       |
| 区县代（巡查） | 5%  | **分配权归区县负责人**（`pending_allocation`，待分配） |
| 单店（交付）  | 30% | 总部交付时收归总部                               |
| 单店（流量）  | 30% | —                                       |
| 店长（销售）  | 5%  | 固定归店长/单店负责人，不参与分配                       |

> 分成池 = 客户实付 − 固定成本（特色营 10000 → 池 2000；特色产品 1300 → 池 1300）。
>   
> 算例：特色产品 1300 门店交付 → 总部 195 / 省 26 / 市 104 / 区县管理 65 / 区县巡查 65（待分配）/ 单店交付 390 / 单店流量 390 / 店长 65，合计 1300 闭环。

---

## B′. 旧版商品级差接口（兼容保留）

`POST /api/calc/goods-diff` — **功能：旧口径商品级差（1000 基准价绝对价格表），新逻辑请用 B2**

**入参**：`kind`（`physical`/`card`/`course`）、`sellerLevel`、`buyerLevel`、`qty`、`salePrice`（默认 1000）
  
**出参**：`{ kind, sellerLevel, buyerLevel, perUnit, qty, amount }`

---

## C. 管理员接口（总部/后台）

### C1. 导出当前数据

`GET /api/seed` — **功能：导出全部种子数据（用户/订单/代理/合店），可编辑后回灌**

**出参**：`{ users[], orders[], agents[], costores[] }`

### C2. 载入种子数据

`POST /api/seed` — **功能：用提交的 JSON 重置并重建全库数据（测试场景切换）**

**入参**：同 C1 出参结构（`users`/`orders`/`agents`/`costores` 均可为部分）
  
**出参**：`{ ok: true, message: "种子数据已载入并重置", users: 7 }`
  
**说明**：载入会**清空** commissions / quotaLedger / 结算记录，等价于换一套测试场景。

### C3. 恢复默认种子

`POST /api/seed/reset` — **功能：一键恢复内置 7 人示例种子（联创/私董/天使/VIP/区县代/门店老板/合店老板）**


**出参**：`{ ok: true, message: "已恢复默认示例种子" }`

### C4. 新增合伙人
`POST /api/partner` — **功能：录入新的合伙人/用户并设置初始名额余额**

**入参**：`id`（可选，默认自动生成）、`name`、`phone`、`tier`（`vip`/`angel`/`private`/`cofounder`）、`upline_id`（推荐人）、`is_founding`（是否持创始奖）、`quota`（初始名额余额）
**出参**：`{ ok: true, user: {...}, quota: 500 }`

### C5. 下单（售出 VIP 名额）
`POST /api/order` — **功能：模拟下级向上级购买/升级产品包，产生供货差价与平级奖（身份销售无直推/复购奖）**

**入参**
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `buyerId` | string | 是 | 买家 ID |
| `packageTier` | string | 是 | 购买后的档位 `vip`/`angel`/`private`/`cofounder` |
| `oldTier` | string | 否 | 原档位（用于计算增量 VIP）；新用户整包购买须显式传 `none` 才会升档 |
| `rawQuota` | number | 否 | 原始名额数（直接指定时按「买家本档拿货价」付费 = 批发补货模式；2026-10-24 拍板：按买家档价而非名额档价） |
| `regionCode` | string | 否 | 区域码（区县级），用于区域门店费归属 |
| `storeCode` | string | 否 | 门店码（门店级）。门店渠道**自动从卖家门店代理码派生**，一般无需传；显式传入可覆盖。结算据此按父链 门店→区县→市→省 归集（2026-10-24 区域码设计） |
| `buyerIsNew` | boolean | 否 | 兼容字段，**已不影响身份订单收益**（身份销售不再有直推/复购奖） |

**收益口径（2026-10-23 规则，2026-10-24 补货级联修正）**
| 模式 | 实付 | 卖方收益 |
|---|---|---|
| 零售整包（不传 `rawQuota`） | 零售价 `RETAIL_PRICE[packageTier]` | `实付 − 卖家拿货成本`（供货差价）**＋ 上级链逐级级差**（见下） |
| 批发补货（传 `rawQuota`） | `WHOLESALE[buyer.tier] × rawQuota`（买家本档拿货价，非名额档价） | `(买家本档价 − 卖家本档价) × 名额` **＋ 上级链逐级级差到总部**；买方名额入账 `+rawQuota` |

**供货链级差级联（零售整包 + 批发补货均生效，2026-10-24 起）**：
购买流程 = 下级找上级买 → 上级找自己的上级买 → … → 直到链顶向总部买；
钱沿链向上逐层拆：终端价（零售价 / 买家本档拿货价）= 卖方差价 + Σ 上级级差 + 总部底价（6,500/VIP）。
对上级链逐级按 `(前一级档价 − 本级档价) × 名额` 落 `supply` 佣金；链顶（无上级者）向总部拿货，终端价按总部底价 6,500 计。（注：批发补货的「卖方差价」按买家本档价 − 卖家本档价计算，与买的名额档位无关——2026-10-24 拍板。）
> 例：E 向 C（天使 7,500）买私董 59,800 → C 14,800；A（联创 6,500）(7,500−6,500)×6 = 6,000；总部 6,500×6 = 39,000（C 是合伙人身份 ⇒ 合伙人渠道，门店服务费 0，39,000 全额留总部；若是门店老板卖出，则拆为 门店服务费 18,000 + 总部费 21,000）。
> 补货例：丙（天使）向乙（私董）补 3 个天使名额 22,500 → 乙 1,560 + 甲（联创）1,440 + 总部 19,500 = 22,500 ✅；丙名额 +3。

> **售卖合伙人/VIP/私董/联创名额 → 只赚差价，没有直推奖、没有复购奖。** 直推奖只存在于「产品提成」与「代理技术费」两处（见 B8/C21/D7）。

**出参**：`{ ok, order_id, actual_paid, supply_spread, store_fee, hq_fee, channel, quota_balance_after }`
**错误**：`买家不存在` / `买家未绑定上级，无法下单` / `上级名额不足...需先补货`

### C6. 任命区域代理
`POST /api/agent/appoint` — **功能：任命合伙人担任省/市/区县/门店代理，并按规则自动升档**

**入参**：`partnerId`、`regionType`（`province`/`city`/`district`/`store`）、`regionCode`、`parentCode`（父级区域码，门店码填所属区县码；结算按父链归集）
**出参**：`{ ok, agent: {...}, granted: "cofounder" }`（`granted` 为空表示未升档）
**规则**：
- 门店代理：需已达 **天使** 档及以上，否则拒绝（前置门槛，不赠身份）
- 区县代理：赠 **私董**；市/省代理：赠 **联创**
- 身份**只升不降**（`higherTier`）

### C7. 合店登记
`POST /api/costore` — **功能：登记合店关系（合店老板 + 门店老板 + 推荐人身份）**

**入参**：`owner_id`（合店老板）、`promoter_id`（本单推荐人）、`storeManagerId`（门店店长，缺省=owner_id）、`monthly_fee`（默认 698）、`ownerCount`（门店老板人数）、`owners`（`[{id, performance}]` 合店老板名单，10% 分红池用）、`regionCode`（省市区分成归属）

**分配口径（V2 三场景，`costoreDistribution`，2026-10-24 修订）**

| 归属 | 比例 | 4188（6 个月）对应金额 |
|---|---|---|
| 总部 15% / 省 2% / 市 8% / 区县 10% | 35% | 628.20 / 83.76 / 335.04 / 418.80 |
| 门店店长服务 `storeManagerId` | 40% | 1675.20 |
| 业务 13% 直推（**被推荐人的上级是合店老板→上级，否则→门店店长**，2026-10-24 起不再看推荐人） | 13% | 544.44 |
| 业务 2% 复购（被推荐人的上级；无上级→门店店长） | 2% | 83.76 |
| 月度分红池（一半人数均分 + 一半业绩） | 10% | 418.80 |

**三场景判定（2026-10-24：以「被推荐人的上级是否为合店老板」为准）**：`B` 上级是合店老板（业务 15% 全归上级）/ `C` 上级非合店老板 + 有上级（13%→门店店长、2%→上级）/ `D` 无上级（13%+2% 全归门店店长）。旧模型「场景 A（推荐人是合店老板且无上级）」已移除，无上级统一按 D。
> 省/市/区县分成在月度结算时按 `regionCode` 落到真实区域代理（`resolveRegionOwners`：区域码精确匹配 → 该级唯一代理兜底 → 否则归总部 HQ），不再落入 `PROV/CITY/DIST` 占位账户。
**出参**：`{ ok, costore: {...} }`

### C8. 名额补货
`POST /api/quota/issue` — **功能：总部/上级给下级补充 VIP 名额（提高可售库存）**

**入参**：`partnerId`、`qty`
**出参**：`{ ok, partnerId, balance_after }`

### C9. 解绑推荐关系
`POST /api/relation/unbind` — **功能：解除合伙人与上级的绑定关系（历史留痕）**

**入参**：`partnerId`
**出参**：`{ ok, user: {...} }`

### C10. 重绑推荐关系
`POST /api/relation/rebind` — **功能：更换合伙人的直接上级**

**入参**：`partnerId`、`newUplineId`
**出参**：`{ ok, user: {...} }`

### C11. 月度结算
`POST /api/settle` — **功能：跑一次完整月度结算，生成全平台所有分润记录**

**入参**：`period`（可选，默认当前月 `YYYY-MM`）
**出参**：`{ ok, summary: { period, totalVip, globalPool, byType, total, details[] } }`
**结算内容**：供货差价、平级奖、全球奖（池 = 150 × 总 VIP，半均分 + 半业绩）、创始奖（联创 17.5/VIP、私董 3.5/VIP）、门店服务费分配（省100/市200/区县300/门店2400 每 VIP，**仅门店老板售出的订单**；其余进 `summary.agentSkipped`）、区域代理 7 类收益、合店费分配。
> 身份销售不再产生直推奖/复购奖（2026-10-23 规则）；结算汇总里 `direct`/`rebuy` 仅为历史数据兼容保留。

### C12. 全量收益报表
`GET /api/report` — **功能：查看所有合伙人的累计收益与分类汇总**

**出参**：`{ users: [{ id, name, tier, phone, total, byType }], lastSettlement }`

### C13. 合伙人列表
`GET /api/users` — **功能：查看全部合伙人基础信息（用于下拉选择）**

**出参**：`{ users: [...] }`

### C14. 门店与合店列表
`GET /api/stores` — **功能：查看全部线下门店（编号/店长/合伙人/合店费）与合店记录**

**出参**：`{ stores: [{ store_no, name, owner_id, owner_name, owner_phone, region_code, partner_count, monthly_fee, granted_tier }], costores: [...] }`
**说明**：`granted_tier` 为开通代理时赠送的合伙人身份（区县代赠私董、市/省代赠联创、门店代理不赠身份）。`partner_count` 为该门店名下的合伙人数量。

### C15. 区域代理团队
`GET /api/region/team` — **功能：查看已任命的区域代理团队（按级别分组，含下级人数）**

**出参**：`{ team: [{ partner_id, name, phone, tier, region_type, region_code, granted_tier, sub_count }] }`

### C16. 修改合伙人（支持改 ID）
`POST /api/partner/update` — **功能：修改合伙人任意字段，**支持修改 ID**（自动级联更新所有关联关系）**

**入参**
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `partnerId` | string | 是 | 原合伙人 ID |
| `patch.id` | string | 否 | **新 ID**（改 ID 会级联更新全部引用） |
| `patch.name` | string | 否 | 姓名 |
| `patch.phone` | string | 否 | 手机号 |
| `patch.tier` | string | 否 | `vip`/`angel`/`private`/`cofounder`/`none` |
| `patch.upline_id` | string | 否 | 直接上级 ID（`null` = 总部） |
| `patch.is_founding` | bool | 否 | 是否持创始奖 |
| `patch.quota` | number | 否 | VIP 名额余额 |

**出参**：`{ ok: true, user: {...}, quota }`

**改 ID 的级联范围**（保证关系不丢）：
下级推荐关系 `upline_id` · 订单 `buyer_id`/`seller_id` · 已落账佣金 `owner_id` · 名额台账 `quotaLedger` · 区域代理 `partner_id` · 合店记录 `owner_id`/`promoter_id`/`owners[].id`/`partners[].id` · 关系变更历史

**错误**：`用户不存在: X` / `ID 已被占用: X`

### C17. 删除合伙人
`POST /api/partner/delete` — **功能：删除无下级、无订单、非代理的合伙人**

**入参**：`partnerId`
**出参**：`{ ok: true, id, deleted: true }`
**错误**：`该合伙人仍有下级，请先解绑/转移下级` / `该合伙人已有订单记录，不可删除（可改 ID 或改档位）` / `该合伙人是区域代理，请先撤销代理`

### C18. 修改订单
`POST /api/order/update` — **功能：修改订单字段，支持改订单 ID**

**入参**：`orderId`（原 ID）、`patch`（`id`/`buyer_id`/`seller_id`/`packageTier`/`oldTier`/`quotaCount`/`actual_paid`/`sellerCost`/`regionCode`/`vipCredit`）
**出参**：`{ ok: true, order: {...} }`

### C19. 修改区域代理
`POST /api/agent/update` — **功能：修改代理级别 / 区域码（换级别会重算赠予身份，只升不降）**

**入参**：`partnerId`、`patch`（`region_type`/`region_code`/`parent_code`）
**出参**：`{ ok: true, agent: {...} }`

### C19.1. 门店二维码内容生成
`GET /api/agent/qrcode?code=<门店region_code>` — **功能：生成门店收款二维码内容（展示层，不入库）**

**出参**：`{ store_code, qrContent, scanFlow, note }`
- `qrContent`：`https://<域名>/s?c=<门店码>`（域名请替换为实际部署域名）
- `scanFlow`：`顾客扫码 → 前端解析 store_code → 带入下单参数 storeCode → 结算按父链 门店→区县→市→省 归集`

> 二维码图片可据此文本用任意二维码库生成。区域码统一用**结构化层级码**（省 33→市 3301→区县 330110→门店 330110-S1）+ 显式 `parent_code`；随机字母数字区域码不推荐（破坏层级归集、难对账，且区域码无需保密），二维码仅作扫码入口。

### C20. 订单列表
`GET /api/orders/all` — **功能：查看全部订单明细（含买卖方姓名），供后台编辑与核对**

**出参**：`{ orders: [{ id, buyer_id, buyer_name, seller_id, seller_name, packageTier, oldTier, quotaCount, actual_paid, sellerCost, supply_spread, regionCode, ... }] }`
**说明**：产品单（`type='product'`）含 `productKey`/`kind`/`qty`/`level`/`discount_kind`/`unitPrice`/`paid`/`deliveryType` 字段；产品单**幂等不可编辑**（同 orderId 重放覆盖），套餐单可经 C18 修改。

### C21. 逐笔收益明细（人工对账核心）
`GET /api/commissions/all` — **功能：列出每一笔收益，含基数 / 比例 / 金额 / 计算公式，供逐条手算复核**

**查询参数**：`period`（如 `2026-10`）、`type`（收益类型）、`owner`（收益人 ID）
**出参**
```json
{
  "rows": [{
    "id": "supply-o_1", "period": "2026-10",
    "owner_id": "p3", "owner_name": "天使丙",
    "type": "supply", "type_cn": "供应差价",
    "base_amount": 7980, "rate": null, "amount": 480,
    "formula": "实付 7980 − 拿货成本 7500 = 差价 480",
    "ref_order_id": "o_1", "status": "pending"
  }],
  "count": 27,
  "total": 22230.64
}
```

**说明**：`formula` 字段由后端按类型自动生成（`store.pushCommission` → `buildFormula`），每笔都能直接按公式手算复核。例如：
- 供应差价：`实付 7980 − 拿货成本 7500 = 差价 480`
- 平级奖：`供货上级拿货价 × 2% × 名额`（如供货上级为天使则 7500×2%×1 = 150；为联创则 6500×2%×1 = 130）。该笔从供货上级的供货级差中扣除，非额外出账（2026-10-24 拍板）
- 区域奖：`门店 门店服务费定额 2400（3000/VIP 拆分）`
- 全球奖：`奖池 900 × 本人份额 50% = 450`
- 创始奖：`3500 × 0.5% × 6 VIP = 105`
- 产品分润（`type='product'`）：`subtype` 区分 `partner_product`（上级合伙人产品提成）/ `chain_*`（实物固定链级差）/ `card_*`（AI软件卡拿货差价）/ `featured_*`（特色分成）/ `admin_*`（行政费拆分），`subtype` 决定收益归属身份（见 G6；`virtual_*` 虚拟分成已废弃）

### C22. 产品下单（后台代下单）
`POST /api/order/product` — **功能：管理员代任意买家下产品订单，与用户端 D7 同逻辑，佣金即时落账（幂等）**

**入参**
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `buyerId` | string | 是 | 买家 ID（也可 URL 传 `?userId=`） |
| `productKey` | string | 是 | 产品 key（见 G7） |
| `qty` | number | 否 | 数量，默认 1 |
| `deliveryType` | string | 否 | `store`（默认）/ `hq`，仅特色/虚拟产品有效 |
| `regionCode` | string | 否 | 区域码，链级差/特色分成按它匹配区域代理（空位归总部） |
| `amount` | number | 否 | 行政费金额（`productKey='adminFee'` 时必填） |
| `orderId` | string | 否 | 指定订单 ID（同 ID 重放按幂等覆盖，用于回归测试） |

**出参**
```json
{
  "ok": true, "order_id": "o_15", "product": "脑商Pad", "kind": "physical",
  "buyer_id": "p6", "level": "store", "discount_kind": "agent",
  "unitPrice": 3490, "qty": 1, "paid": 3490, "fixedTotal": 0, "pool": 3490,
  "deliveryType": "store",
  "partnerCommission": { "mode": "tier", "uplineTier": "private", "rate": 0.15, "amount": 523.5, "formula": "..." },
  "rows": [{ "role": "chain_district", "owner_id": "p5", "amount": 349, "note": "固定链级差 ..." }],
  "byRecipient": { "p5": 872.5, "HQ": 2617.5 }, "total": 3490, "closure": true
}
```

**分润口径**（按产品类型）：
- **实物**：沿代理固定链（单店→区县→市→省→总部）按「下一级折扣−本级折扣」× 变动成本结算级差；链底卖方从级差中扣产品提成，溢出由总部行承担（保证 `closure=true`）
- **特色/虚拟**：先扣产品提成，剩余按 B10 / B3 口径分成；总部交付时门店交付与区县巡查收归总部
- **行政费**（`adminFee`）：总部 5% + 销售门店 5% + 上课团队 90%，**无折扣、无产品提成**，金额下单时指定

**错误**：`缺少买家 userId` / `买家不存在: X` / `未知产品：X` / `非法交付类型` / `行政费金额必须大于 0`

### C23. 后台配置（合店费参数）
`GET /api/settings` — **功能：读取后台可调配置**
`POST /api/settings` — **功能：局部更新配置（仅接受 `costore` 下已知键）**

**出参 / 入参**：`{ settings: { costore: { ... } } }`

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabledV2` | `true` | 合店费三场景（V2）新逻辑开关；`false` 回滚旧「53%+2%+10%」固定三分 |
| `monthlyFee` | 698 | 合店费月费（元/月） |
| `minMonths` | 6 | 最少起付月数（不得少于 6） |
| `graceMonths` | 1 | 无责分红月数（入股首月） |
| `softwareUnitPrice` | 100 | 软件卡/VIP 分红基数（元/月/单位） |
| `softwareToPoolRate` | 1.0 | 软件卡/VIP 销售额计入分红池比例 |


### C24. 代查用户身份列表
`GET /api/identities?userId=X` — **功能：管理员代查任意用户当前持有的身份与各身份当月收益（身份切换体系）**

**查询参数**：`userId`（必填，目标用户 ID）
**出参**：同 **D8**
**错误**：`400 缺少或无效的 userId`

### C25. 代查用户分身份收益
`GET /api/commissions?userId=X` — **功能：管理员代查任意用户的收益流水，支持身份 / 类型 / 月份过滤**

**查询参数**：`userId`（必填）、`identity`（`partner`/`agent`/`costore`）、`type`、`period`（`YYYY-MM`）
**出参**：同 **D3**
**错误**：`400 缺少或无效的 userId`

> 典型用法：`GET /api/identities?userId=p7` 看三身份概览 → `GET /api/commissions?userId=p7&identity=agent` 下钻代理身份流水。

### C26. 免费升档进度与明细（后台）
`GET /api/free-upgrade?userId=X` — **功能：查询单个合伙人的「本金」与「拉人免费升档」全景（进度计数 + 触发/发放明细）**

**查询参数**：`userId`（必填，目标用户 ID）
**出参**
```json
{
  "userId": "p3",
  "tier": "angel",
  "principalTier": "angel",
  "principalAmount": 29800,
  "referralFreeUpgrade": { "required": 3, "qualifying": 1, "applied": 0, "earned": 0, "pending": 0, "nextTier": "private" },
  "log": []
}
```

**说明**：
- `principalTier`/`principalAmount` = 本金档 / 本金金额（`RETAIL_PRICE[本金档]`）；升级自付一口价 = 目标档零售价 − 本金金额（服务端锚定本金计价，见 `合伙人收益逻辑设计.md` §4.0）
- `referralFreeUpgrade` 字段含义见 **D9**；`log` = `db.freeUpgradeLog` 中该用户相关的发放/触发明细（无则空数组）
- 空值兜底：目标用户无本金记录时回退当前档；字段缺失返回 null/0，不报错
- 团队树 `GET /api/team` 每节点也带 `principalTier`/`principal`/`referralFreeUpgrade`，可直接渲染进度徽标

---

## D. 用户接口（合伙人 / 区域代理 / 合店老板）

### D1. 我的信息
`GET /api/me` — **功能：查看本人身份卡、当月收益、名额余额、团队 VIP 业绩**

**出参**：`{ id, tier, is_founding, annual_fee_status, wholesale_per_quota, quota_balance, team_vip, month_income, month_by_type }`
**说明**：`wholesale_per_quota` 为该档位的每 VIP 拿货价（7980/7500/6980/6500）；`team_vip` 按子树订单动态统计。

### D2. 我的团队树
`GET /api/team` — **功能：查看下级团队结构与各节点团队 VIP 业绩**

**出参**：`{ id, tier, team_vip, children: [...] }`（递归）

### D3. 收益明细（支持按身份过滤）
`GET /api/commissions` — **功能：逐笔列出本人收益记录，用于逐条核对算法；多身份用户可按身份拆分查看**

**查询参数**
| 参数 | 说明 |
|---|---|
| `type` | 按类型过滤（如 `supply`/`parity`/`global`/`founding`/`agent`/`costore`/`product`；`direct`/`rebuy` 仅历史数据） |
| `identity` | 按身份过滤：`partner`（合伙人）/ `agent`（区域代理）/ `costore`（合店老板）；缺省返回全部 |
| `period` | 月份 `YYYY-MM`，默认当月 |

**出参**：`{ list: [{ id, type, subtype, base_amount, rate, amount, period, status, note }], total, byType }`


**身份归属口径**（`commissionIdentity`，保证三身份流水之和 = 全量、不重不漏）：

| 身份 | 名下佣金类型 |
|---|---|
| `partner` 合伙人 | `supply` 供货差价/级差 / `parity` 平级奖 / `global` 全球奖 / `founding` 创始奖 / 产品分润中 `subtype='partner_product'`；代理被赠联创/私董后参与的全球奖、创始奖也归这一栏；`direct`/`rebuy` 仅历史数据 |
| `agent` 区域代理 | `agent` 门店服务费 / `region_vip` 区域奖 / `region_goods_diff` 商品级差 / `region_signing` 直推代理奖 / `region_admin_delivery` 行政费 / `region_costore` 合店提成 / 产品分润其余 subtype（`chain_*`/`card_*`/`featured_*`/`admin_*`；`virtual_*` 已废弃） |
| `costore` 合店老板 | `costore` 合店费 |

### D4. 区域代理收益
`GET /api/agent` — **功能：查看本人作为区域代理的身份与本月区域收益**

**出参**：`{ agent: { region_type, region_code, granted_tier }, month_income, by_region, breakdown[] }`
**说明**：无代理身份时返回 `{ message: "该用户无区域代理身份" }`。

### D5. 合店收益
`GET /api/costore` — **功能：查看本人合店关系下的分润（门店提点、推荐人所得、分红池）**

**出参**：`{ owner_id, promoter_id, monthly_fee, ownerCount, split: { hq, province, city, district, hqSystem, storeOwner, referrerRebate, dividend, closure }, owner, profit, partnerBonus, allocation: { tipRate, tipRatePerOwner, storeOwner: { total, perOwner, perOwnerRemainder }, referrerAmount, dividend: { partners[] } }, dividend }`

### D6. 区域代理月度试算
`POST /api/region/month` — **功能：以本人身份跑一次区域代理月度收益试算（可自定义参数，验证算法）**

**入参**：同 B5
**出参**：同 B5

### D7. 产品下单（用户端商城）
`POST /api/order/product` — **功能：用户购买产品：实物按身份折扣计价 + 固定链级差，虚拟/特色按比例分成，佣金即时落账（幂等）**

**入参**
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `productKey` | string | 是 | 产品 key（见 G7） |
| `qty` | number | 否 | 数量，默认 1 |
| `deliveryType` | string | 否 | `store`（默认）/ `hq`，仅特色/虚拟产品有效 |
| `regionCode` | string | 否 | 区域码，链级差/特色分成归属 |
| `amount` | number | 否 | 行政费金额（`productKey='adminFee'` 时必填） |
| `orderId` | string | 否 | 指定订单 ID（同 ID 重放覆盖） |

**出参**：同 **C22**（含 `discount_kind` 买家折扣口径与逐项 `rows` 分润明细）
**说明**：成交档位按买家身份解析（**代理 > 合伙人 > 原价**，见 B7）；身份切换不改变账户，只改变查看收益的维度与下单折扣口径。

### D8. 我的身份列表（身份切换数据源）
`GET /api/identities` — **功能：返回本人当前持有的全部身份 + 各身份当月收益（前端身份切换栏数据源）**

**出参**
```json
{
  "identities": [
    { "key": "partner", "name": "合伙人", "detail": "天使合伙人", "tier": "angel", "is_founding": "none",
      "month_income": 480, "by_type": { "supply": 480 } },
    { "key": "agent", "name": "区域代理", "detail": "单店代理 · D2",
      "region_type": "store", "region_code": "D2", "granted_tier": null,
      "month_income": 2400, "by_type": { "agent": 2400 } },
    { "key": "costore", "name": "合店老板", "detail": "合店老板 · 门店 D1-S1",
      "store_id": "D1-S1", "storeManagerId": "p6",
      "month_income": 418.8, "by_type": { "costore": 418.8 } }
  ],
  "total_month_income": 3298.8
}
```

**说明**：
- 身份键：`partner`（合伙人，账户基础身份始终显示）/ `agent`（区域代理，有代理记录才出现）/ `costore`（合店老板，有合店记录才出现）
- 各身份收益**严格分离**：`month_income` 只统计该身份名下的佣金（归属口径见 D3）；`total_month_income` = 各身份之和 = 全量收益
- 三种身份可同时持有（如 p7：天使合伙人 + D2 单店代理 + 合店老板），前端切换身份只看对应收益
- 管理员代查任意用户身份：`GET /api/identities?userId=X`（见 C24）

**冒烟验证**：`node scripts/smoke_identities_http.js`（28 项断言：双折扣下单 / 代查 / 三身份收益分离 / 登录态自查 / 身份×折扣联动）。

### D9. 合伙人总览（本金 + 拉人免费升档进度）
`GET /partner/overview` — **功能：合伙人身份首页数据源：档位/名额/当月收益 + 本金 + 免费升档进度**

**鉴权**：用户 token（`Authorization: Bearer <token>`），未登录返回 401
**查询参数**：`contextId=partner:<userId>`
**出参（p3 天使示例）**
```json
{
  "accountId": "p3",
  "contextId": "partner:p3",
  "displayId": "TS0003",
  "levelName": "天使合伙人",
  "partnerStatus": "active",
  "annualRemainingDays": null,
  "rankDescription": "",
  "experience": 0,
  "experienceTarget": 0,
  "benefits": [],
  "quotaBalance": 97,
  "monthIncome": 1855.06,
  "monthByType": { "supply": 480, "parity": 418.8, "product": 872.5, "costore": 83.76 },
  "teamVip": 4,
  "principalTier": "angel",
  "principal": 29800,
  "referralFreeUpgrade": { "required": 3, "qualifying": 0, "applied": 0, "earned": 0, "pending": 0, "nextTier": "private" }
}
```

**新增字段说明（2026-10-26）**：
- `principalTier` / `principal`：**本金档 / 本金金额**（= 实际付过钱的最高档一口价 `RETAIL_PRICE[principalTier]`）。免费升档只改档位、**不动本金**；升级自付一口价 = `目标档零售价 − principal`（服务端锚定，客户端传的旧档仅作校验）
- `referralFreeUpgrade` 拉人免费升档进度：
  | 字段 | 含义 |
  |---|---|
  | `required` | 每档触发门槛（3 名合格下级） |
  | `qualifying` | 当前合格下级数（直推 + 被推荐时与上级同级 + 各自从同级起步付费升档） |
  | `applied` | 已发放的免费升档次数 |
  | `earned` | 按合格数应得次数（= floor(qualifying/3)） |
  | `pending` | 待补发次数（= earned − applied，下次触发钩子时补足） |
  | `nextTier` | 下一免费档位；已到联创（封顶）为 `null` |
- 前端渲染建议：进度条 `qualifying/required`，徽标文案"再拉 `{required×(earned+1)−qualifying}` 名同级付费升档可免费升 1 档（下一档：`nextTier`）"
- 管理员侧全景/明细：`GET /api/free-upgrade?userId=X`（见 C26）

---

## E. 静态资源

| 路径 | 功能 |
|---|---|
| `GET /` | H5 主页面（管理员/用户双入口 + 免登录直达参数） |
| `GET /app.js` | 用户端逻辑（个人中心/收益/代理门店/算法验证） |
| `GET /admin.js` | 总部后台逻辑（看板/合伙人/订单/代理审核/门店/结算/种子/算法验证） |
| `GET /styles.css` | 样式表 |

**免登录直达（测试便利）**
| URL | 效果 |
|---|---|
| `/?as=admin` | 直接进入总部后台 |
| `/?as=13800000001` | 直接进入该手机号对应的合伙人身份 |

---

## F. 错误码

| 状态码 | 场景 |
|---|---|
| 400 | 参数缺失 / 角色非法 / 资格校验失败（如 VIP 开门店代理）/ 非法交付类型 / 未知档位 |
| 401 | 未登录或 token 失效、密码错误 |
| 404 | 用户不存在 / 接口不存在 |
| 500 | 服务器内部错误（响应体含 `error` 字段） |

所有错误响应统一为 `{ "error": "错误描述" }`。

---

## G. 类型与常量速查

**档位 tier**：`vip` → `angel` → `private` → `cofounder`（`none` = 无身份）

| 档位 | 零售价 | VIP 名额 | 每 VIP 拿货价 | 产品提成比例 |
|---|---|---|---|---|
| VIP | 9980 | 1 | 7980 | 5% |
| 天使 | 29800 | 3 | 7500 | 10% |
| 私董 | 59800 | 6 | 6980 | 15% |
| 联创 | 239800 | 24 | 6500 | 15% |

> **身份名额售卖收益 = 供货差价（实付 − 卖家拿货成本），无直推奖、无复购奖。** 上表最后一列为「产品提成」比例，仅适用于商城产品订单（B8/D7），不适用于售卖身份。

### G1. 合伙人侧折扣表（`PARTNER_DISCOUNT`，商城预留）
VIP 8折 / 天使 7.5折 / 私董 7折 / 联创 6.5折

### G2. 区域代理侧折扣表（`AGENT_DISCOUNT`，仅实物，商城预留）
单店 5折 / 区县代 4折 / 市代 3.5折 / 省代 3折

> **两套折扣表严格分开维护、力度不同，严禁混用**（2026-10-23 用户要求）：代理折扣整体深于合伙人折扣；买家档位解析优先级 **代理身份 > 合伙人档位 > 原价(list)**（`resolveBuyerLevel` 单一入口），订单落 `discount_kind` 字段。既是合伙人又是代理的买家按代理拿货价成交，前端可同时展示两套价格对照（见 B7）。

### G3. 区域代理分成表
| 级别 | B端业务 | B端服务 | C端门店交付 | C端总部交付 | VIP合伙人奖 | 供应链 |
|---|---|---|---|---|---|---|
| 省代 | 20% | 10%(其中2%) | 10%(其中2%) | 10%(其中2%) | 200元(35元) | 3折 |
| 市代 | 18% | 8% | 8% | 8% | 165元(65元) | 3.5折 |
| 区县代 | 15% | — | 75% | 35% | 100元 | 4折 |
| 单店 | 15% | — | 65% | 30% | — | 5折 |

### G4. 虚拟产品分配比例
| 交付方式 | 总部 | 省代 | 市代 | 单店 |
|---|---|---|---|---|
| 总部交付 | 55% | 2% | 8% | 35% |
| 门店交付 | 15% | 2% | 8% | 75% |

### G5. 其他常量
- 复购奖 2%（仅实物上级合伙人 / 虚拟推荐人，**身份名额销售不适用**）
- 平级奖 2%
- 全球奖 150/VIP（池 = 150 × 总 VIP，半均分 + 半业绩）
- 总部产品费 3500/VIP（门店渠道）；门店服务费 3000/VIP（门店 2400 / 区县 300 / 市 200 / 省 100）**仅门店老板售出时计提**，合伙人售卖渠道该 3,000 并入总部留存（`hq_fee = 6,500×名额 − store_fee`）
- 创始奖 联创 17.5/VIP（3500×0.5%）、私董 3.5/VIP（3500×0.1%）
- **合店费（V2 三场景）**：总部 15% / 省 2% / 市 8% / 区县 10% = 35%；门店服务 40% + 业务 15%（13% 直推 + 2% 复购）+ 分红池 10% = 65%。13% 直推以「被推荐人的上级是否为合店老板」判定（2026-10-24 修订）。省/市/区县按 `regionCode` **落到真实区域代理**（无匹配且该级唯一代理时归其，否则归总部 HQ）；月费 698，最低 6 个月 = 4188。
- **合店费 = 一次性消费**（最低 6 个月起购，起步 4188），当期全额分配，**不做按月摊销**；10% 分红池**按月全平台一个池**（与全球奖/创始奖同口径，`ref_order_id = NULL`），按「一半人数 + 一半业绩」分给全体合格合店老板，全员不合格时余款归总部。
- **直推代理奖 15%**（tp123 新口径，取代旧「区域开发奖 8%」）
- 行政费 总部 5% + 销售门店股东 5% + 交付方 90%
- 代理门槛费 省代 260w / 市代 45w·40w·35w / 区县代 12w / 单店 8w
- **合伙人产品提成**（覆盖首购+复购，替代旧 2% 复购奖）：VIP 5% / 天使 10% / 私董 15% / 联创 15%，基数 = 实付 − 固定成本；回滚开关 `PRODUCT_COMMISSION_MODE='flat2'`

### G6. 身份键与收益归属映射（2026-10-23 多身份体系）

| 身份键 | 名称 | 出现条件 | 名下佣金类型 |
|---|---|---|---|
| `partner` | 合伙人 | 账户基础身份（始终显示） | `supply` 供货差价/级差 / `parity` 平级奖 / `global` 全球奖 / `founding` 创始奖 / 产品分润 `subtype=partner_product`；代理的全球奖/创始奖也计入此栏 |
| `agent` | 区域代理 | 有区域代理记录（`regionalAgents`） | `agent` 门店服务费 / `region_vip` 区域奖 / `region_goods_diff` 商品级差 / `region_signing` 直推代理奖 / `region_admin_delivery` 行政费 / `region_costore` 合店提成 / 产品分润其余 subtype（`chain_*`/`card_*`/`featured_*`/`admin_*`；`virtual_*` 已废弃） |
| `costore` | 合店老板 | 有合店记录（`coStores.owner_id`） | `costore` 合店费 |

> 产品分润（`type='product'`）按 `subtype` 细分归属：`partner_product`（上级合伙人产品提成）→ 合伙人；`chain_*`（实物固定链级差）/ `card_*`（AI软件卡拿货差价）/ `featured_*`（特色分成）/ `admin_*`（行政费拆分）→ 区域代理。`virtual_*`（虚拟分成）为历史口径，2026-10-27 起已无 virtual 商品（AI软件卡改走 `card_*` 固定拿货价、陪练卡改走 `featured_*`），仅作向后兼容保留。该映射保证「三身份流水之和 = 全量、不重不漏」。

### G7. 产品目录（商城预留，`PRODUCT_CATALOG`）

| key | 名称 | 目录价 | 固定成本 | 变动成本 | 类型 | 分成口径 |
|---|---|---|---|---|---|---|
| `pad` | 脑商Pad | 6980 | 0 | 6980 | `physical` 实物 | 固定链折扣级差 + 合伙人产品提成 |
| `memoryCard` | 记忆卡 | 998 | 0 | 998 | `software` 软件卡 | 固定拿货价（省150/市170/区县250/单店350，元/张）沿固定链拿货差价 + 合伙人产品提成（链底扣） |
| `coachCard` | 陪练卡 | 2000 | 0 | 2000 | `featured` 特色 | 15/2/8/(5+5)/(30+30+5) 分成；成交价 = 2000×合伙人折扣（私董7折=1400 / 省代映射联创6.5折=1300 / 原价2000） |
| `featured` | 特色产品 | 1300 | 0 | 1300 | `featured` 特色 | 15/2/8/(5+5)/(30+30+5) 分成（见 B10） |
| `featuredCamp` | 特色营 | 10000 | 8000 | 2000 | `featured` 特色 | 成交价 = 8000 + 2000×合伙人折扣（私董7折=9400 / 联创6.5折=9300 / 原价10000）；代理买家按对应合伙人档位映射 |
| `adminFee` | 行政费/集训营 | 下单指定 | 0 | 0 | `admin` 行政费 | 总部 5% + 销售门店 5% + 上课团队 90%；**无折扣、无产品提成** |

**成交价公式**：`固定成本 + 变动成本 × 档位折扣`（档位见 G1/G2，`list` = 1.0 原价）。
**代理固定上级链**（无跨级）：单店 → 区县 → 市代 → 省代 → 总部；实物沿链按「下一级折扣 − 本级折扣」× 变动成本结算，链底卖方赚「买方折扣 − 卖方折扣」× 变动成本，总部收省代折扣 × 变动成本。

### G8. 商城身份打折：孩子没有折扣，只按购买者本人身份（2026-10-27）

**背景（用户明确）**：家长添加孩子后，`display_id` **对外编号前缀会跟着孩子走**（identity.js `userPrefix`）：
联创家长 + 粉丝孩子 → `FS0001`（前缀取最高孩子等级，**不与家长档位比高低**）。
于是关键问题变成：**商城还能不能识别出家长真实的合伙人/代理身份？**

**结论：能。** 因为**前缀只是展示字符串**，商城计价读的是另外两个独立数据源，二者互不影响：

| 用途 | 数据源 | 加孩子后是否变化 |
|---|---|---|
| 对外展示编号 | `users.display_id`（前缀 + 序号） | ✅ **会变**（跟着孩子等级走） |
| 商城计价·合伙人档位 | `users.tier`（vip/angel/private/cofounder） | ❌ **不变**（孩子不会改写家长档位字段） |
| 商城计价·代理身份 | `regionalAgents.region_type`（store/district/city/province） | ❌ **不变** |

> ⚠️ 因此**绝不能**用 `display_id` 前缀反推身份来算价——那会在家长加孩子后把合伙人/代理价冲掉。
> 商城一律走 `productSplit.resolvePriceLevel(buyer, agentRecord)`。

**有效计价档位优先级**（`resolvePriceLevel`）：

1. **代理身份**（有 `regionalAgents` 记录）→ 单店5 / 区县4 / 市3.5 / 省3 折
2. **合伙人档位**（`users.tier`）→ VIP8 / 天使7.5 / 私董7 / 联创6.5 折
3. **原价** `list`（无任何身份）

> **孩子没有折扣**：孩子的会员等级（粉丝/菁英/超级/行能/羿烁）**只影响对外编号前缀与内容权益**，
> **完全不参与商城计价**。普通家长（既无代理身份也无合伙人档位）买任何商品都按原价，
> 不会因为孩子是超级/羿烁会员而获得折扣。`memberId` 仅作为**服务对象**记录在订单上，不参与定价。

**接口返回**：
- `GET /catalog`、`GET /products/{id}` → 每个商品附 `viewerPrice`：`{ unitAmount(分), listAmount, applied, discountLabel, identityLabel }`（未登录不返回该字段）。
  `identityLabel` 为判定出的身份（`联创合伙人` / `省代` / `无身份` …），前端可直接显示"你的价 ¥4537 · 联创合伙人 6.5折"。
- `GET /checkout/options` → `members[]` 附 `memberLevel` / `levelLabel` / `displayId`，供前端展示孩子身份（不参与计价）。
