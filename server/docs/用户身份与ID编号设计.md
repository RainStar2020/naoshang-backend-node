# 用户身份与 ID 编号设计（v1.3 · 已实现）

> 2026-10-24 · 状态：**已落地**（v1.0 草案的三项决策已于当日拍板并实现）
> 本文定义"所有人都是用户"的统一身份模型、对外 ID 编号规则、200 权益收益费门禁，以及算法分发依据。

---

## 0. 结论速览（TL;DR）

| 问题 | 结论 |
|---|---|
| 总表还是关联表 | **一张用户主表 `users` + 多张身份关联表**（agents / costores / quota_ledger / commissions…） |
| ID 前缀怎么编 | 前缀只编码一条主线：**权益状态 + 合伙人等级**（QZ/YH/VIP/TS/SD/LC） |
| 编号宽度 | **四位起步**（0001），超过四位自然变宽（第 10000 名 = 前缀+10000，不截断） |
| 省代怎么表示 | ID 走 **LC**（联创）前缀，界面用**「省代」徽章**区分——ID 相同是正常的，徽章不同 |
| 合店老板 | **徽章制**（不占前缀，保留本人等级前缀 + 合店徽章） |
| 200 权益收益费 | 周期制（默认 12 个月）：未开通 → QZ + 全功能门禁（收益照算、不可见、不可提）；**过期 → 全球奖/直推奖/复购奖/创始奖全部停算，但历史账单可导出** |

---

## 1. 核心原则

1. **所有人都是用户**：联创、私董、天使、VIP、普通用户、合店老板、代理——共用一张 `users` 主表，只有"身份维度"不同。
2. **身份是多维叠加的**：等级（主线）× 代理任命 × 合店 × 权益状态，互不排斥，可同时成立。
3. **ID 只编码一条主线**：前缀 = 当前合伙人等级；代理/合店身份用徽章表达，不进前缀（原因见 §4.1 碰撞分析）。
4. **内部 uid 不可变，对外编号可派生**：外键永远引用内部 uid（p1..p7 等）；展示编号 = `前缀 + 全局序号`，随状态重算，永不漂移。
5. **算法分发用结构化字段**：机器判定不看编号字符串，看 `tier` / `agents.region_type` / `costores` / `entitlement_state`。

---

## 2. 身份模型（两层）

### 2.1 第一层：等级主线（进 ID 前缀）

| 等级 | 前缀 | 编号示例 | 获得方式 |
|---|---|---|---|
| 权益未开通/已过期（**覆盖一切等级**） | `QZ` | QZ0003 | 未付 200 权益收益费，或开通后过期 |
| 普通用户 | `YH` | YH0001 | 注册即得（已开通权益） |
| VIP | `VIP` | VIP0004 | 购买 VIP 名额 |
| 天使合伙人 | `TS` | TS0001 | 购买/升级天使（门店代理需天使，不升档） |
| 私董合伙人 | `SD` | SD0002 | 购买/升级私董，或被任命为**区县代** |
| 联创 | `LC` | LC0003 | 购买/升级联创，或被任命为**省代/市代** |

> 代理任命与等级的关系（沿用已落地逻辑）：省代/市代 → 升 `cofounder`（联创）；区县代 → 升 `private`（私董）；门店代理不升档（需已是天使）。

### 2.2 第二层：身份徽章（不进 ID，界面展示）

| 徽章 | 存储 | 与等级主线的关系 |
|---|---|---|
| 省代 / 市代 | `agents` 表 region_type=province/city | 等级已是联创 → 前缀 LC |
| 区县代 | `agents` 表 region_type=district | 等级已是私董 → 前缀 SD |
| 门店代理 | `agents` 表 region_type=store | 需已是天使 → 前缀 TS |
| 合店老板 | `costores` 表 owner_id | 需已是 VIP+ → 前缀取本人等级（**徽章制，不占前缀**） |

界面展示形态：`LC0003 · 联创 / 省代 / 合店老板`（编号 + 等级 + 全部徽章）。

### 2.3 叠加示例

```
YH0003  付清 200、开通省代
  → agents 表新增一行（region_type=province），tier 升为 cofounder
  → display_id 重算为 LC0003
  → 界面显示：LC0003 · 联创 / 省代
  → 若再开通合店：costores 表新增一行，界面追加「合店老板」徽章，编号不变
```

---

## 3. 数据库设计：主表 + 关联表

### 3.1 `users` 主表（唯一权威）

| 字段 | 说明 |
|---|---|
| `id` | **内部 uid，永不变**（现有 p1..p7 继续沿用，不外露） |
| `seq` | **全局注册序号**（1,2,3…，不可变；编号的数字部分） |
| `display_id` | 对外编号（派生缓存：前缀+补零 seq，状态变化时重算） |
| `phone` / `name` / `password` / `avatar` | 账号基础信息 |
| `tier` | 当前等级：none / vip / angel / private / cofounder |
| `tier_source` | `natural`（自然升级）或 `granted`（代理任命赠级） |
| `granted_tier` | 任命时赠送的等级（撤销代理时回退依据） |
| `entitlement_state` | `never_paid` / `active` / `expired`（200 权益收益费） |
| `entitlement_paid_at` / `entitlement_expires_at` | 开通时间 / 到期时间（惰性过期判定依据） |
| `upline_id` / `invite_code` / `is_founding` | 关系与创始奖资格 |
| `annual_fee_paid` / `annual_paid_at` | 年度权益（与 200 权益收益费是两回事，互不影响） |
| `unlocked_columns[]` | 已解锁专栏 |
| `status` | active / disabled |

> 顶层计数器 `userSeq`：全局注册序号分配器（与 `seq`——内部 id 生成器——相互独立，均随快照持久化）。

### 3.2 关联表（按需挂载，可增删）

| 表 | 挂载点 | 内容 |
|---|---|---|
| `agents`（现有 regionalAgents） | user_id | region_type / region_code / store_name / appointed_at / granted_tier |
| `costores`（现有 coStores） | owner_id | monthly_fee / joinDate / owners[] / promoter_id |
| `quota_ledger` | user_id | 可发放名额余额 |
| `commissions` / `orders` / `withdrawals` / `addresses` / `members` / … | user_id | 业务流水 |

### 3.3 为什么**不**做总表

1. **多身份并存**：联创 + 省代 + 合店老板同时成立，一行放不下三套字段；
2. **大量永久 NULL**：90% 的用户没有代理字段/合店字段；
3. **撤销即清列**：代理撤销要 UPDATE 清空十几个字段，关联表删一行即可；
4. **扩展即改表**：每加一种代理类型都要改主表 schema。

### 3.4 为什么**不**做纯关联拆分

1. 登录鉴权、权益门禁、全局序号必须只有一个真相源；
2. 绝大多数查询都带用户基础信息，主表直出最省。

---

## 4. ID 编号规则

### 4.1 为什么代理不能进前缀（碰撞分析）

| 首字母 | 候选身份 |
|---|---|
| `SD` | 私董 / **市代** / **省代** ← 三撞 |
| `LC` | 联创 / 省代 |

且代理是**可撤销的任命**：撤销后前缀该回退到什么？等级前缀天然稳定，任命只改徽章。**所以：前缀 = 等级主线，徽章 = 代理/合店。**

### 4.2 派生公式

```
display_id = prefix(entitlement_state, tier) + pad(seq, 4)

prefix =
  权益状态 != active（未开通/已过期）  → "QZ"   // 覆盖一切等级
  tier == none                         → "YH"
  tier == vip                          → "VIP"
  tier == angel                        → "TS"
  tier == private                      → "SD"
  tier == cofounder                    → "LC"

pad(seq, 4)：四位起步；超过四位自然变宽，不截断
  第 1 名    → 0001        第 9999 名 → 9999
  第 10000 名 → 10000（五位，前缀+10000）
```

### 4.3 演变示例

| 事件 | display_id 变化 |
|---|---|
| 第 1 人注册（未付 200） | → QZ0001 |
| 第 1 人付清 200 | QZ0001 → **YH0001** |
| 第 1 人升级天使 | YH0001 → **TS0001** |
| 第 2 人注册即付 200、升级私董 | → **SD0002** |
| 第 3 人注册付 200（普通） | → **YH0003** |
| 第 3 人开通省代（升联创） | YH0003 → **LC0003**（徽章：省代） |
| 第 3 人再开通合店 | LC0003 不变（徽章追加：合店老板） |
| 第 3 人权益到期未续费 | LC0003 → **QZ0003**（收益停算，账单可导出） |
| 第 3 人续费 | QZ0003 → **LC0003** |

### 4.4 旧编号解析策略

升级/过期后旧编号不再指向任何人。展示永远以当前编号为准；历史追溯走 `uplineHistory` 与订单快照，不做别名解析。

---

## 5. 200 权益收益费门禁（周期制，默认 12 个月）

### 5.1 三态

```
never_paid ──支付 200──▶ active ──12 个月后未续费──▶ expired ──续费──▶ active
（从未开通）              （正常）                    （过期）            （恢复正常）
```

### 5.2 各状态行为

| 维度 | never_paid | active | expired |
|---|---|---|---|
| 编号 | QZ+seq | 等级前缀+seq | QZ+seq |
| 收益计算 | **照算**（挂着，开通后一次性可见） | 照算 | **全部停算**（全球奖/直推奖/复购奖/创始奖/代理奖/合店分配） |
| 查看收益/经营报表 | 锁定（200 + locked 标志） | 正常 | 锁定（附 frozen 标志） |
| 提现 | 拒绝 | 正常 | 拒绝 |
| 功能入口 | 无任何入口（前端只渲染开通页） | 全部 | 无任何入口（只留开通/续费 + 导出） |
| 历史账单导出 | 不可（无账单） | 可（JSON/CSV） | **可（JSON/CSV）** |

> 过期判定为**惰性**：读取时按 `entitlement_expires_at < now` 判定，不依赖定时任务。
> 停算实现在佣金收口 `pushCommission`/`upsertCommission`：过期用户的佣金一律不入账；**过期前已入账的记录保留**（即可导出的历史账单）。

### 5.3 接口影响（前端配合点）

- `GET /me/bootstrap`：返回 `displayId` + `entitlement: { state, amount, expiresAt, frozen, canExportBills }`，前端据此隐藏全部功能入口；
- 权益不正常时，所有业务接口统一返回 `200 + { locked: true, entitlementState, entitlementAmount: 200, frozen, canExportBills, message }`（不用 403，方便前端统一渲染开通页）；
- `POST /me/entitlement-orders`：开通/续费（幂等，支持 idempotencyKey；当前免支付占位）；
- `GET /me/income-export?format=json|csv`：导出历史账单（never_paid 返回 403，active/expired 可用）。

---

## 6. 算法分发（按 ID/身份走不同算法）

| 判定字段 | 影响的算法 |
|---|---|
| `tier` | 全球奖/创始奖基数与领取资格、底价分账 |
| `agents.region_type` | 代理管理奖、代理价目、合店 13% 归属（upline 口径） |
| `costores`（是否合店老板） | 合店费 15% 总部留存、门店分账 |
| `entitlement_state` | 仅影响可见性/提现/是否停算，**不改变任何计算公式** |

> 现有引擎的 `getIdentities()` 已是结构化分发，无需改动；不解析编号字符串。

---

## 7. 孩子会员等级体系与家长编号派生（2026-10-24 产品截图规则 · 已实现）

### 7.1 六级会员等级阶梯

| 会员等级 | 前缀 | 获取方式 | 权益（课程板块） |
|---|---|---|---|
| 普通会员（游客） | QZ | 家长添加孩子后默认 | 无权益，全部板块未解锁，只能查看介绍 |
| 粉丝会员 | FS | 线下门店缴费 19.9，门店给激活码激活 | 解锁「粉丝会员」板块课程 |
| 1阶菁英会员 | JY | 线下门店缴费 3990，门店给激活码激活 | 解锁粉丝 + 1阶菁英板块 |
| 1阶超级会员 | CJ | 家长开通 9980 VIP 合伙人，上级赠送激活码 | 解锁粉丝 + 菁英 + 1阶超级板块 |
| 2阶行能会员 | XN | 家长开通 29800 天使合伙人，上级赠送激活码 | 解锁粉丝 + 菁英 + 超级 + 2阶行能板块 |
| 3阶羿烁会员 | YS | 家长开通 69800 天使合伙人，上级赠送激活码 | 解锁全部板块 |

板块与学习等级映射：L1 脑商启蒙→粉丝板块、L2 脑商进阶→1阶菁英板块、L3 脑商高手→1阶超级板块、L4 脑商大师→2阶行能板块、L5 脑商宗师→3阶羿烁板块。

### 7.2 编号规则（家长 + 孩子两条线）

- **孩子编号**：`等级前缀 + memberSeq`（按添加时间排序的**全平台全局序号**——第几个添加的、在后台孩子列表中排第几，编号就是第几；四位起步变宽；例：FS3000 = 全平台第 3000 个添加的孩子）。
  **升级只变前缀、编号不变**：FS3000 升级 1阶超级 → CJ3000。
- **家长编号**：家长仍走 `users` 主表（§3），seq 不变；前缀按以下优先级派生：
  1. 权益未开通/过期 → **QZ**（门禁绝对优先，即使孩子是羿烁）；
  2. 权益正常且**有孩子已激活会员等级**（fs..ys）→ 一律取最高孩子等级前缀——**家长跟着孩子走，不在于身份的高低**（联创家长+粉丝孩子 → FS；同分也不保留家长前缀）；
  3. 无孩子或孩子全是普通会员（游客）→ 沿用家长档位前缀（YH/VIP/TS/SD/LC）。
- 孩子之间取最高等级；两套分数仅用于孩子内部排序（普通0 < 粉丝1 < 菁英2 < 超级3 < 行能4 < 羿烁5），**不与家长档位比高低**。

### 7.3 激活码与家长档位门槛

- 激活码 `targetType` 扩展为 `fs/jy/cj/xn/ys`（会员等级码，`targetId` 可空）；历史 `level/column` 码不变；
  旧 `member` 类型兼容为 `fs`。
- 激活时校验家长档位：**CJ 需家长 ≥ VIP 合伙人；XN/YS 需家长 ≥ 天使合伙人**（截图规则的发放侧门槛，激活侧同步把关）；
  FS/JY 为门店码无档位要求。
- **只升不降**：低等级码激活高等级孩子不生效、不消耗；引擎层（`applyMemberLevel`）与接口层双重防线。

### 7.4 权益门禁与孩子功能的关系

未支付 200 权益费的家长处于全功能锁（§5）：添加孩子、激活孩子等级均被拦截（返回 `locked`），
需先开通权益——与"不开通什么功能都不给"的拍板一致。

### 7.5 数据与接口变化

- `members` 新增字段：`memberLevel`（六级）、`memberSeq`（孩子全局序号）、`display_id`（孩子编号）；
  `db.memberSeq` 计数器随快照持久化，启动时按 `createdAt` 顺序为存量孩子补编号。
- 接口：`POST /members` 返回孩子编号；`GET /members` 输出 `displayId/memberLevel/memberLevelName`；
  `POST /activations`（`targetType=fs/jy/cj/xn/ys`）激活会员等级并级联重算家长编号；
  `GET /learning/levels`、`GET /learning/levels/{id}`、`GET /members/{id}/levels`、`GET /lessons/{id}`、
  `PUT /members/{id}/learning-progress` 均按板块权益判定解锁。
- 测试：`scripts/verify_member_tiers.js`（新增 61 断言）。

### 7.6 代理撤销后的编号（2026-10-24 用户拍板）

- 撤销代理（`POST /api/agent/revoke`，admin）：摘除 `regionalAgents` 记录，用户打标 `agent_revoked_at`；
- **对外编号 seq 不变，前缀改 QZ**（回到普通用户；用户原话"编号不变、前缀改变为普通用户的 QZ 前缀"）；
- 已赠予的合伙人档位**保留不降档**（撤销只摘代理身份；如业务后续要降档再议）；
- 派生优先级：**权益门禁 QZ > 孩子会员等级 > 撤销 QZ > 家长档位**（撤销家长若有已激活孩子，仍跟着孩子走）；
- 历史提成/订单不清算。测试：`scripts/verify_agent_revoke.js`（28 断言）。

---

## 8. 支付模块与激活码发放（2026-10-24 用户拍板 · 已实现）

### 8.1 支付渠道与业务映射（`src/payment.js`）

| 业务 | 金额 | 可用渠道 |
|---|---|---|
| 权益收益费开通/续费（entitlement） | 200 元/周期 | 微信支付 / 支付宝 / 银行卡 |
| 合伙人年度权益（annual_fee） | 1980 元（暂行值） | 微信支付 / 支付宝 / 银行卡 |
| 联创向总部购买 VIP 名额（quota_purchase） | 批发价 × 数量 | **仅银联支付**（用户指定） |

- **双模式**：`PAYMENT_MODE=sandbox`（默认）免支付直通、下单即入账，供开发联调与回归；`live` 对接渠道 SDK（`buildPayParams` 为集成点，商户号/密钥走 env），前端调起支付后由**渠道异步通知** `POST /payments/notify/{channel}` 验签入账（HMAC-SHA256 占位验签，live 必须配 `*_NOTIFY_SECRET`）。
- **幂等**：`idempotencyKey` 去重（重复下单返回原单、不换渠道）；通知重复不二次入账（`newlyPaid` 守卫业务效果）。
- **接口**：`POST /me/entitlement-orders`（body 带 `channel`）、`GET /me/payments`、`GET /me/payments/{id}`、`POST /me/payments/{id}/sandbox-confirm`（live 联调模拟通知）、`POST /payments/notify/{channel}`；`/partner/entitlement-orders`、`/partner/quota-orders` 同样接入（后者默认 unionpay）。`/partner/quota-purchase-options` 的 `allowedPaymentChannelIds` 现返回 `['unionpay']`。
- 测试：`scripts/verify_pay_and_codes.js`（live 进程内单测 + HTTP 端到端，共 55 断言）。

### 8.2 激活码发放与核销（`src/routes/h5codes.js`）

| 渠道 | 接口 | 权限 | 可发类型 | 说明 |
|---|---|---|---|---|
| 总部 | `POST /admin/activation-codes` | admin | 全部 | 批量发码（≤100/批），可绑门店/绑家长 |
| 总部 | `GET /admin/activation-codes` | admin | — | 列表 + 统计（total/active/used/void/expired） |
| 总部 | `POST /admin/activation-codes/{code}/void` | admin | — | 作废（已核销不可作废） |
| 门店 | `POST /agency/activation-codes` | 区域代理（agency ctx） | 仅 fs/jy | 线下收款 19.9/3990 场景，码归属门店区域码 |
| 门店 | `GET /agency/activation-codes` | 区域代理 | — | 本店已发码 |
| 上级 | `POST /partner/gift-codes` | 家长本人（partner ctx） | 仅 cj/xn/ys | 给**直属下级**家长赠码，码绑定该家长 |
| 上级 | `GET /partner/gift-codes` | 家长本人 | — | 我的赠码记录 |
| 家长 | `GET /me/activation-codes` | 本人 | — | 绑定我的码（含核销状态） |

- **绑定码仅被绑家长可激活**：`/activations` 与 `/activations/preview` 双校验（`issuedTo`），他人用返回 403；
- **档位门槛**：赠码时校验受赠家长档位（cj→VIP、xn/ys→天使），激活侧同步把关（已有）；
- **核销台账**：`usedBy` 记录 `{memberId, at, channel, issuedBy}`；
- 码格式：`NS-<TYPE>-<6位随机>`（如 `NS-FS-K3M9QP`），与历史序号码（NS-FS-0001）共存。

---

## 9. 实现清单（2026-10-24 已落地）

| 组件 | 文件 | 内容 |
|---|---|---|
| 编号与权益服务 | `src/identity.js`（新增） | prefixOf / displayIdOf / assignSeq / recomputeDisplayId / entitlementState（惰性过期）/ gatePayload / grantEntitlement |
| 主表字段与门禁 | `src/store.js` | `userSeq` 计数器；addUser 自动分配 seq+编号；**pushCommission/upsertCommission 权益门禁收口**；updatePartner/appointAgent 后重算编号 |
| 迁移与持久化 | `server.js` | loadDb 启动迁移（存量补 seq/权益/编号）；saveDb 携带 seq/userSeq 计数器；loadSeed 重置 userSeq |
| 接口层 | `src/routes/h5.js` | 注册即 never_paid；bootstrap 下发 displayId+entitlement；**全局权益门禁**（豁免：开通/导出/改密码/登出/bootstrap）；`POST /me/entitlement-orders`；`GET /me/income-export`（JSON/CSV） |
| 测试 | `scripts/verify_identity_gate.js`（新增 33 断言）+ `verify_h5_contract.js`（+13 断言） | 编号派生/惰性过期/收口门禁/过期停算/升级重算/开通续费/门禁锁定/导出 |

**存量迁移结果**（内部 uid 不变）：p1→LC0001、p2→SD0002、p3→TS0003、p4→VIP0004、p5→SD0005、p6→TS0006、p7→TS0007（p7 为天使档合店老板，前缀随等级，合店走徽章）。

**回归**：14 个 verify + 6 个审计脚本共 20/20 通过；旧版 db.json（无编号字段）启动时自动迁移补齐。

---

## 10. 待业务后续确认（不阻塞实现）

| # | 事项 | 当前实现 |
|---|---|---|
| 10.1 | 权益周期时长 | **已拍板（2026-10-24）：365 天**（`identity.js` `ENTITLEMENT_PERIOD_DAYS=365`，到期停算需续费） |
| 10.2 | 过期用户历史余额能否提现 | **已拍板（2026-10-24，后端定）：禁止提现、仅可导出账单**（与“过期什么都不给”一致，提现门禁已实现） |
| 10.3 | 代理撤销后等级回退策略 | **已拍板（2026-10-24）：编号不变、前缀改 QZ；已赠档位保留不降档**（`/api/agent/revoke` 已实现，见 §7.6） |
| 10.4 | 开通/续费接正式收银台 | **已拍板（2026-10-24）：权益=微信/支付宝/银行卡；联创向总部购买=银联**。sandbox 直通占位已换为支付模块（`src/payment.js`，双模式），live 仅剩渠道 SDK 商户参数配置 |
| 10.5 | ~~家长前缀与孩子等级冲突时「取高不降级」策略~~ **已拍板（2026-10-24）：家长跟着孩子走，不在于身份高低**——只要有已激活孩子，家长前缀即最高孩子等级前缀（联创+粉丝孩子→FS）；无已激活孩子才保留家长档位 | 已按拍板实现 |
| 10.6 | 会员等级码的发放渠道与库存 | **已实现（2026-10-24）：门店收款发码（agency）/ 上级赠码（upline，绑直属下级）/ 总部批量发码与作废 / 核销台账**，见 §8.2 |

---

*相关文档：《合伙人收益逻辑设计.md》《区域代理与产品分成设计.md》《合店老板收益逻辑设计.md》《前端API接口清单（功能标注）.md》*
