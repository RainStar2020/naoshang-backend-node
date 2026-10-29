/**
 * 脑商AI合伙人 · API 路由逻辑（服务端动作编排，非前端）
 * 每个 handler 接收 (db, input) 返回纯结果对象；上线时包装为 HTTP 路由即可。
 * 所有金额/名额由 commission.js / quotaLedger.js / settlement.js 计算，前端只展示。
 *
 * 对应 设计文档 §4 接口契约：order/create, me, team, commissions, quota/issue,
 * relation/unbind, relation/rebind, settlement/run, costore, 以及 agent。
 */

const C = require('./commission');
const Q = require('./quotaLedger');
const S = require('./store');
const IZ = require('./identity');
const CP = require('./costorePlan');
const PS = require('./productSplit');
const RA = require('./regionAgent');
const EXP = require('./experience');
const OL = require('./orderLifecycle');
const STK = require('./stock');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const SET = require('./settlement');
const TIER_CN = { none: '普通用户', vip: 'VIP合伙人', angel: '天使合伙人', private: '私董合伙人', cofounder: '联创合伙人' };

function periodOf(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 从合店记录 joinDate（'YYYY-MM' / 'YYYY-MM-DD' / 时间戳 / 缺省）解析入股月份，用于「一次性入池」的月份匹配 */
function joinMonthOf(joinDate) {
  if (joinDate == null) return null;
  if (typeof joinDate === 'number' || (typeof joinDate === 'string' && /^\d+$/.test(joinDate))) {
    const d = new Date(Number(joinDate));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  const m = /^(\d{4}-\d{2})/.exec(String(joinDate));
  return m ? m[1] : null;
}

/** 从 seller 向上收集上级链（不含 buyer）[{id,tier}] */
function buildUplineChain(db, sellerId) {
  const chain = [];
  let cur = db.users[sellerId];
  while (cur && cur.upline_id) {
    const up = db.users[cur.upline_id];
    if (!up) break;
    chain.push({ id: up.id, tier: up.tier });
    cur = up;
  }
  return chain;
}

// ───────────── POST /api/order/create（电梯路由：seller = buyer.upline_id） ─────────────
function createOrder(db, input) {
  const { buyerId, packageTier, oldTier, rawQuota, buyerIsNew = true, regionCode, storeCode } = input;
  const buyer = S.getUser(db, buyerId);
  if (!buyer) throw new Error('买家不存在: ' + buyerId);
  const sellerId = buyer.upline_id;
  if (!sellerId) throw new Error('买家未绑定上级，无法下单（需先绑定推荐人）');
  const seller = S.getUser(db, sellerId);

  const need = rawQuota != null ? rawQuota : C.vipCredit(oldTier, packageTier);   // 消耗名额
  if (Q.getBalance(db.quotaLedger, sellerId) < need) {
    throw new Error(`上级名额不足: seller=${sellerId} 余额=${Q.getBalance(db.quotaLedger, sellerId)} 需=${need}（需先补货）`);
  }

  // 升级判定（用户 2026-10-24 拍板）：rawQuota 为空 且 已持有「已付费档位」(vip/天使/私董/联创) 且 目标档名额数 > 原档
  //   → 走「升级差价」计费：买家只付「目标档一口价 − 已付原档一口价」的差价（如 VIP→天使 29,800−9,980=19,820），
  //   不为已有名额重复付费；升级流程同补货级联（上级逐级向总部买增量名额，上级消耗增量名额给买方升档）。
  //   ⚠️ oldTier='none'（新用户首购）不算升级，仍走新人整包全价。
  const isUpgrade = rawQuota == null
    && oldTier && oldTier !== 'none'
    && C.TIER_VIP[oldTier] != null
    && C.TIER_VIP[oldTier] < (C.TIER_VIP[packageTier] ?? 0);
  // 计价基准（2026-10-24 拍板）：
  //   · 批发补货：按下级（买家）本档拿货价付费，与买的名额档位无关；
  //   · 升级：只付目标档−原档的差价（UPGRADE_DIFF）；
  //   · 新人整包：按名额档零售价（身份交易，非单纯名额买卖）。
  const buyTier = buyer.tier;
  // 计价基准（2026-10-26 本金锚点）：升级价以「本金档 principal_tier」为减数，
  // 而非客户端传入的 oldTier / 当前档——避免免费升档抬高当前档后被少算。
  // 直接按 RETAIL_PRICE 相减（而非 UPGRADE_DIFF 查表），可兼容「本金档与目标档不相邻」的跨度。
  // 旧记录无 principal_tier 时回退 oldTier，保证向后兼容；差值兜底为 0（本金≥目标时不倒贴）。
  const upgradeBase = buyer.principal_tier || oldTier;
  // 本金档为 none（普通用户首购）时没有「已付一口价」，减数按 0 计 → 付目标档全价。
  // 用 RETAIL_PRICE 直接查表（retailPrice() 对 'none' 会抛错），保证「普通用户升合伙人」这条路可走通。
  const basePaidPrice = C.RETAIL_PRICE[upgradeBase] || 0;
  const actual_paid = rawQuota != null
    ? C.WHOLESALE_PER_QUOTA[buyTier] * rawQuota                          // 批发补货：下级本档拿货价
    : isUpgrade
      ? Math.max(0, C.retailPrice(packageTier) - basePaidPrice)          // 升级：目标档−本金档差价
      : C.retailPrice(packageTier);                                      // 新人整包：零售价
  // 拿货成本口径：批发补货 / 升级 都按「实际消耗名额数(增量) × 卖家档价」（升级只补增量名额，不按整包 3 名额计）；
  //   仅新人整包按整包成本（TIER_VIP[pkg] × 卖家档价）。
  const sellerCost = (rawQuota != null || isUpgrade)
    ? C.round2(C.WHOLESALE_PER_QUOTA[seller.tier] * need)
    : C.wholesaleCost(seller.tier, packageTier);
  // 供货差价口径（两种模式单位不同，不能统一成一个算式）：
  //   · 批发补货(rawQuota)：差价=(WHOLESALE[buyTier]−WHOLESALE[seller])×need（买家本档价−卖家本档价）
  //   · 升级/新人整包：差价=实付−拿货成本(sellerCost=need×卖家档价 或 整包成本)。
  const spread = rawQuota != null
    ? C.supplySpread(seller.tier, buyTier, need)
    : C.round2(actual_paid - sellerCost);
  // ── 渠道判定（用户 2026-10-23 16:56 明确）──
  //   只有「门店老板」身份（持有 store 级区域代理任命）卖出，才算「门店售出」并计提门店服务费；
  //   只是「合伙人」身份或「合店老板」身份卖出，一律走「合伙人售卖」通道 → 门店服务费为 0。
  //   底价恒等式不变：store_fee + hq_fee = 6,500 × 名额
  //     门店渠道  ：3,000（给门店体系）+ 3,500（总部产品费）
  //     合伙人渠道：0 + 6,500（总部全额留存，那 3,000 不作门店服务费支出）
  const storeOwner = S.isStoreOwner(db, sellerId);
  const channel = storeOwner && input.channel !== 'partner' ? 'store' : 'partner';
  // 门店渠道：把「卖家(门店老板)对应的门店代理码」带到订单上（2026-10-24 区域码设计）。
  //   结算 runAgent 据此按父链 门店→区县→市→省 归集，门店码≠订单区县码也不再掉总部。
  //   优先用调用方显式传入的 storeCode，否则从卖家的 store 级区域代理记录派生。
  let resolvedStoreCode = storeCode || null;
  if (channel === 'store' && !resolvedStoreCode) {
    const sa = db.regionalAgents.find((a) => a.partner_id === sellerId && a.region_type === 'store');
    if (sa && sa.region_code) resolvedStoreCode = sa.region_code;
  }
  const storeFeePerVip = C.STORE_FEE.v1.subtotal;                 // 3,000 / 名额
  const storeFee = channel === 'store' ? C.round2(storeFeePerVip * need) : 0;
  const hqFee = C.round2(C.hqProductFee(need) + (storeFeePerVip * need - storeFee));

  const orderId = S.nextId(db, 'o');
  // P0-3/P0-4 后台可调配置（settings.quota）：服务费单价、活动名额有效期、升级是否认活动名额
  const qCfg = Q.resolveConfig((S.getSettings(db) || {}).quota || {});
  // 扣上级名额（P0-3 双余额）。drawn 给出本单动用的标准/活动名额数。
  //   · 升级通道（rawQuota==null）：活动名额先扣（先过期先扣）→ 活动名额用于升级要收服务费（P0-4）；
  //   · 批发补货（rawQuota!=null）：标准名额先扣 → 活动名额不被无价消耗（活动名额只在升级通道兑现服务费）。
  const preferActivity = (rawQuota == null);
  const drawn = Q.consumeQuota(db.quotaLedger, sellerId, need, {
    tx: db.quota_transactions, ref: orderId, prefer: preferActivity ? 'activity' : 'standard',
    activityValidityDays: qCfg.activityValidityDays, serviceFeePerActivity: qCfg.serviceFeePerActivity,
    activityValidForUpgrade: qCfg.activityValidForUpgrade,
  });
  // P0-4 升级服务费：仅「付费升级」(rawQuota==null && isUpgrade) 触发；
  //   上级每动用 1 个活动名额加收服务费，与合伙人费(actual_paid)分离收款（归总部）。
  const serviceFee = (rawQuota == null && isUpgrade) ? qCfg.serviceFeePerActivity * drawn.usedActivity : 0;
  // 名额发放流（用户 2026-10-24 口述）：总部 → 链顶 → … → 买方的上级 → 作用于买方。
  //   · 批发补货（rawQuota）：名额最终到买方手里（可转售）→ 买方入账 +need；
  //   · 升级整包：买方的上级消耗自己购买的名额给买方升级 → 买方不入账（仅升档）。
  if (rawQuota != null) Q.issueQuota(db.quotaLedger, buyerId, need);

  const order = {
    id: orderId, buyer_id: buyerId, seller_id: sellerId,
    packageTier, oldTier, quotaCount: need, vipCredit: need,
    actual_paid, sellerCost, supply_spread: spread,
    service_fee: serviceFee, quota_used_standard: drawn.usedStandard, quota_used_activity: drawn.usedActivity,
    // 买方本单应付合计 = 合伙人费(差价) + 升级服务费（P0-4 分离收款）
    total_payable: C.round2(actual_paid + serviceFee),
    store_fee: storeFee, hq_fee: hqFee, regionCode, store_code: resolvedStoreCode, channel,
    status: 'paid', created_at: Date.now(),
  };
  S.addOrder(db, order);

  const period = periodOf();
  // 供应差价（即时）：卖方按自身档位拿货价进货，按买家档位零售/批发价卖出
  if (spread > 0) {
    S.pushCommission(db, {
      owner_id: sellerId, type: 'supply', period,
      base_amount: actual_paid, rate: null, amount: spread, ref_order_id: order.id, status: 'pending',
      formula: `实付 ${round2(actual_paid)} − 拿货成本 ${round2(sellerCost)} = 差价 ${round2(spread)}`,
      seller_cost: round2(sellerCost), actual_paid: round2(actual_paid),
    });
  }
  // ⚠️ 身份 / 合伙人 / VIP 名额销售：仅赚「供货差价」（supply）。  //    · 没有直推奖、没有复购奖（用户 2026-10-23 规则：售卖合伙人/VIP 名额不算直推奖，只赚差价）。
  //    · 直推奖仅存在于：① 产品（createProductOrder 的「合伙人产品提成」5/10/15/15%）；
  //      ② 代理技术费（regionAgent.agentDirectReferralBonus，推荐人直推一人成为代理）。
  //    · 平级奖（parity）由同级上级领取，属「供货链上转手方」的奖励，与卖方差价分离，保留。
  //   （原 direct/rebuy 即时落账逻辑已于 2026-10-23 删除。）
  // ── 供货链级差级联 + 平级奖（用户 2026-10-24 拍板：平级奖从供货上级级差中扣）──
  //   供货链：卖家 → 卖家上级 → … → 链顶向总部买（终端价 = 总部底价 6500/名额）。
  //   每个上级按（下级档价 − 自己档价）× 名额 吃级差；链顶向总部拿货。
  //   平级奖（2026-10-24 拍板）：沿「买家→卖家→卖家上级链」逐跳，若某转手方与其下级同级
  //   （拿货价相同、本跳吃不到差价）→ 该转手方拿平级奖，金额 = 其供货上级拿货价 × 2% × 名额，
  //   并【从其供货上级的级差中扣除】（不再额外出账/总部吸收）。
  const chain = buildUplineChain(db, sellerId);                 // 卖家上级链（不含总部）
  const checkSeller = rawQuota != null;                         // 仅批发补货时卖家本级可能平级
  const parityLevels = [{ id: buyerId, tier: buyer.tier }, { id: sellerId, tier: seller.tier }, ...chain];
  const pb = C.parityPlan({ levels: parityLevels, quotaCount: need, checkSeller });
  {
    const supplyChain = chain;
    let prevUnit = C.WHOLESALE_PER_QUOTA[seller.tier];
    for (let i = 0; i < supplyChain.length; i++) {
      const u = supplyChain[i];
      const isChainTop = i === supplyChain.length - 1;          // 链顶：向总部拿货 → 终端价 = 总部底价
      const upUnit = isChainTop ? C.HQ_PRICE_PER_VIP : C.WHOLESALE_PER_QUOTA[u.tier];
      if (upUnit == null || prevUnit == null) break;
      const gross = C.round2((prevUnit - upUnit) * need);
      const deduct = pb.deductions[u.id] || 0;                  // 平级奖从该供货上级级差中扣除
      const net = C.round2(gross - deduct);
      if (net > 0) {
        S.pushCommission(db, {
          owner_id: u.id, type: 'supply', period, base_amount: actual_paid, rate: null,
          amount: net, ref_order_id: order.id, status: 'pending',
          formula: `供货链级差 (${prevUnit} − ${upUnit}) × ${need} 名额${deduct > 0 ? ` − 平级奖 ${deduct}` : ''} = ${net}`,
        });
      }
      prevUnit = upUnit;
    }
  }
  // 平级奖发放（给同级转手方；金额已从供货上级级差中扣除，非额外出账）
  pb.awards.forEach((a) => S.pushCommission(db, {
    owner_id: a.recipientId, type: 'parity', period,
    base_amount: a.basePrice, rate: C.PARITY_RATE, amount: a.amount,
    ref_order_id: order.id, status: 'pending',
    formula: `平级奖 供货上级(${a.supplierTier})拿货价 ${a.basePrice} × 2% × ${need} 名额 = ${a.amount}（已从 ${a.supplierId} 级差扣）`,
  }));

  // 非批发补货（升级 / 新人整包）都会给买家定档/升档 → 同步维护「本金档 principal_tier」
  // （本金 = 实际付过钱的最高档一口价；免费升档走 updatePartner，不改 principal_tier）
  if (rawQuota == null) {
    buyer.tier = packageTier;
    buyer.principal_tier = packageTier;
    // 新购入联创同样进入 90 天无责期（全球奖资格口径）
    if (packageTier === 'cofounder' && buyer.daysSinceCofounder == null) buyer.daysSinceCofounder = 0;
    // 档位变化 → 重算对外编号（YH0005 升 VIP → VIP0005；与 updatePartner 同口径，2026-10-24 补）
    IZ.recomputeDisplayId(db, buyerId);
    // ── 经验值 + 晋升任务（P0-1 / P0-2，2026-10-26）──
    //   经验值口径：标价多少加多少（= actual_paid）。
    //   名额口径：普通用户（none）升 VIP 合伙人**只消耗 1 个名额**（TIER_VIP.vip = 1，不按整包 2 个计）。
    EXP.record(db, {
      userId: buyerId,
      event: 'upgrade',
      price: actual_paid,
      title: oldTier && oldTier !== 'none'
        ? `升为 ${TIER_CN[packageTier] || packageTier}`
        : `开通 ${TIER_CN[packageTier] || packageTier}`,
      refId: order.id,
      meta: {
        fromTier: oldTier || 'none',
        fromTierLabel: TIER_CN[oldTier || 'none'] || (oldTier || 'none'),
        toTier: packageTier,
        toTierLabel: TIER_CN[packageTier] || packageTier,
        quotaCount: need,
        quotaText: `消耗 VIP 名额 ${need} 个`,
        principalTier: buyer.principal_tier,
      },
    });
    EXP.ensureTask(db, buyerId);
  }

  // ── 拉人免费升档触发（2026-10-26）：下级付费升档后，检查其上级是否「拉满 N 名同级付费升档」→ 免费升 1 档
  //   仅付费升档（rawQuota==null && isUpgrade）触发；免费授级（updatePartner/grant-only）不触发，避免级联。
  if (rawQuota == null && isUpgrade && buyer.upline_id) {
    S.maybeGrantFreeUpgrade(db, buyer.upline_id);
  }

  return {
    order_id: order.id, actual_paid: actual_paid, supply_spread: spread,
    service_fee: serviceFee, service_fee_per_activity: qCfg.serviceFeePerActivity,
    total_payable: C.round2(actual_paid + serviceFee),
    quota_used_standard: drawn.usedStandard, quota_used_activity: drawn.usedActivity,
    store_fee: storeFee, hq_fee: hqFee, channel,
    quota_balance_after: Q.getBalance(db.quotaLedger, sellerId),
  };
}

// ───────────── POST /api/order/product（产品购买：成交价 + 固定链级差/特色分成 + 产品提成） ─────────────
/**
 * 产品订单（2026-10-23 新规格，productSplit.js）
 *
 * 成交价 = 固定成本 + 变动成本 × 买方档位折扣（非合伙人档位按原价）。
 * 可分池 = 成交价 − 固定成本（fixedCost=0 时等于实付，与旧「实付×比例」口径一致）。
 * 按产品类型落账（佣金 id 确定性 `po-{orderId}-{role}`，重复提交同 orderId 不双发）：
 *
 *  ① physical 实物（脑商Pad）：代理固定上级链（无跨级）级差 + 上级合伙人产品提成
 *     （从链底卖方级差中扣，溢出部分由总部承担——87.png「销售方承担推荐人奖励」口径）
 *     + 固定成本回收（归总部）。
 *  ② featured 特色（特色产品/特色营）：特色分成 15/2/8/(5+5)/(30+30+5)（门店/总部两交付模式），
 *     产品提成先从池中扣（netPool = 池 − 提成），巡查 5% 落「待区县负责人分配」。
 *  ③ software（记忆卡）：拿货差价（固定拿货价 150/170/250/350，沿固定链结算），合伙人提成从链底扣。
 *  ④ featured（陪练卡/特色产品/特色营）：比例分成 15/2/8/(5+5)/(30+30+5)。
 *  ⑤ admin 行政费/集训营：5/5/90（总部/销售门店/上课团队），无产品提成，金额下单时指定。
 *
 * 合伙人产品提成：下级购买产品 → 直接上级按身份 VIP5%/天使10%/私董15%/联创15%（基数=可分池）。
 */

function createProductOrder(db, input) {
  const { productKey, deliveryType = 'store', regionCode, orderId, amount: adminAmount } = input;
  // ⚠️ 数量字段两个名字都认：前端/契约层传 `quantity`，历史调用方传 `qty`。
  //    曾经只读 qty，导致"报价按 2 件、下单按 1 件"（少收钱且数量对不上）。
  const qty = Math.max(1, Math.trunc(Number(input.qty != null ? input.qty : input.quantity) || 1));
  const buyerId = input.buyerId;
  const buyer = S.getUser(db, buyerId);
  if (!buyer) throw new Error('买家不存在: ' + buyerId);
  const p = PS.getProduct(productKey);
  const period = periodOf();
  const oid = orderId || S.nextId(db, 'o');

  // ── SKU（2026-10-27 库存台账）：校验规格 + 库存，命中则按该规格计价并扣减库存 ──
  const sku = input.skuId ? STK.skuById(db, input.skuId) : null;
  if (input.skuId && !sku) throw new Error('规格不存在: ' + input.skuId);
  if (sku && sku.productId && sku.productId !== productKey) throw new Error('规格与商品不匹配');
  if (sku) STK.assertStock(db, sku.id, qty);

  // 买方档位：商城单一价格入口（代理身份 > 合伙人档位 > 原价；与孩子的会员等级无关）
  // ⚠️ 家长加孩子后 display_id 前缀会跟着孩子走，但 users.tier / 代理记录都不变 → 身份不会丢
  const agentRec = db.regionalAgents.find((a) => a.partner_id === buyerId);
  const { level: buyerLevel, discountKind } = PS.resolvePriceLevel(buyer, agentRec);
  // 特色产品（陪练卡 / 特色营）：代理按「对应合伙人档位」计价（用户 2026-10-27），其余商品按买家档位
  const priceLevel = p.kind === 'featured' ? PS.featuredLevelFor(buyer, agentRec) : buyerLevel;
  const price = sku ? PS.skuPrice(productKey, sku, priceLevel, qty) : PS.productPrice(productKey, priceLevel, qty);
  // 实付金额：统一走 PS.payableAmountFor（与 /checkout/quotes 报价同口径，2026-10-28）
  //   · admin 商品：金额由管理员录入
  //   · software 商品 + 代理本人：按固定拿货价进货（省150/市170/区县250/单店350），不按折扣
  //   · 其余：按买家档位折扣成交
  let paid;
  if (p.kind === 'admin') {
    paid = round2(adminAmount != null ? adminAmount : p.listPrice);
  } else {
    paid = PS.payableAmountFor(p, agentRec, price.unitPrice, qty).amount;
  }

  // 区域代理（按 region_code 匹配，缺失档位视为空位归总部）
  // 2026-10-27 拍板：收银台选中的门店优先驱动分润归属——门店即「单店」，获单店份额；
  //   其 region_code 对应的省/市/区县代理获各自份额；门店老板同时兼任区域代理时，
  //   省/市/区县份额仍记入该代理账户（区域代理模块），与门店收益分开设、不合并。
  //
  // ⚠️ 门店 region_code 可能带门店序号后缀（如 `330110-S1`），层级匹配前必须剥离成
  //    区县级码（`330110`），否则省/市/区县代理按前缀匹配不到，分成会全部落到总部。
  const stripStoreSuffix = (code) => String(code || '').split('-')[0];
  let splitRegionCode = regionCode ? stripStoreSuffix(regionCode) : null;
  let splitStoreAgent = null;
  if (input.storeId) {
    const sa = db.regionalAgents.find((a) => a.id === input.storeId && a.region_type === 'store')
            || db.regionalAgents.find((a) => a.partner_id === input.storeId && a.region_type === 'store')
            || db.regionalAgents.find((a) => a.region_code === input.storeId && a.region_type === 'store');
    if (sa && sa.region_code) {
      splitStoreAgent = sa;
      splitRegionCode = stripStoreSuffix(sa.region_code);
    }
  }
  const agentsByLevel = {};
  if (splitRegionCode) {
    for (const a of db.regionalAgents) {
      if (!a.region_code) continue;
      const code = stripStoreSuffix(a.region_code);
      // 省/市/区县按区域层级前缀匹配（门店 region_code 通常为区县级，省/市代理用更短前缀）
      const pre = a.region_type === 'province' ? splitRegionCode.slice(0, 2)
                 : a.region_type === 'city' ? splitRegionCode.slice(0, 4)
                 : a.region_type === 'district' ? splitRegionCode.slice(0, 6)
                 : splitRegionCode; // 单店：精确匹配
      if (code === pre || (pre && code.startsWith(pre))) agentsByLevel[a.region_type] = a;
    }
    // 单店级：优先精确命中选中的门店记录（门店 region_code 带后缀时前缀匹配会误命中同区其他门店）
    if (splitStoreAgent) agentsByLevel.store = splitStoreAgent;
  }
  const agentOwner = (level) => (agentsByLevel[level] ? agentsByLevel[level].partner_id : 'HQ');

  // 上级合伙人产品提成（基数=可分池；行政费无此项）
  const fixedTotal = round2(p.fixedCost * qty);
  const pool = round2(paid - fixedTotal);
  const upline = buyer.upline_id ? S.getUser(db, buyer.upline_id) : null;
  const commission = p.kind === 'admin' || !upline
    ? null
    : PS.partnerProductCommission({ paid: pool, uplineTier: upline.tier, kind: p.kind, directBonusCfg: (S.getSettings(db) || {}).directBonus || null });
  const commAmt = commission ? commission.amount : 0;

  const rows = [];
  const push = (role, owner_id, amt, note) => rows.push({ role, owner_id, amount: round2(amt), note });

  if (p.kind === 'admin') {
    // 行政费：总部 5% + 销售门店 5% + 上课团队 90%
    const af = PS.adminFeeSplitDetail(paid);
    for (const r of af.rows) {
      const owner = r.role === 'ownStore' ? agentOwner('store') : 'HQ';
      push(`admin_${r.role}`, owner, r.amount, `行政费 ${r.label} ${Math.round(r.rate * 100)}%${r.role === 'delivery' ? '（上课团队，交付方待内部结算）' : ''}`);
    }
  } else if (p.kind === 'physical') {
    // 固定链卖方档位：合伙人买家→单店；代理买家→其在固定链的上级；省代买家→总部直供
    let sellerLevel = 'store';
    if (agentRec) {
      const up = PS.AGENT_UPLINE[agentRec.region_type];
      sellerLevel = up && up !== 'hq' ? up : null;
    }
    if (sellerLevel) {
      const chain = PS.agentChainTierDiff({ buyerLevel, sellerLevel, basePrice: p.variableCost, qty });
      // 产品提成从链底卖方级差中扣，溢出部分由总部行承担（保证闭环）
      let rest = commAmt;
      const adjusted = chain.rows.map((r, i) => {
        let amt = r.amount;
        if (i === 0 && rest > 0) {
          const cut = Math.min(amt, rest);
          amt = round2(amt - cut);
          rest = round2(rest - cut);
        }
        return { ...r, amount: amt };
      });
      if (rest > 0) {
        const hqRow = adjusted.find((r) => r.level === 'hq');
        if (hqRow) hqRow.amount = round2(hqRow.amount - rest);
      }
      for (const r of adjusted) {
        const owner = r.level === 'hq' ? 'HQ' : agentOwner(r.level);
        const cutNote = r.amount !== (chain.rows.find((x) => x.level === r.level) || {}).amount ? '（扣产品提成）' : '';
        push(`chain_${r.level}`, owner, r.amount, `固定链级差 ${r.label} (${r.buyDiscount}−${r.sellDiscount})×${p.variableCost}${cutNote}`);
      }
    } else {
      push('chain_hq_direct', 'HQ', round2(pool - commAmt), '总部直供（无上级代理）');
    }
    if (fixedTotal > 0) push('fixed_cost', 'HQ', fixedTotal, '固定成本回收（归总部）');
    if (commAmt > 0) push('partner_product', upline.id, commAmt, `产品提成 | ${commission.formula}`);
  } else if (p.kind === 'featured') {
    // 特色产品：比例分成 15/2/8/(5+5)/(30+30+5)
    const netPool = round2(pool - commAmt);
    const split = PS.featuredSplit(netPool + fixedTotal, { fixedCost: fixedTotal, deliveryType });
    for (const r of split.rows) {
      let owner;
      if (r.owner === 'hq') owner = 'HQ';
      else if (r.role === 'province' || r.role === 'city') owner = agentOwner(r.role);
      else if (r.role === 'district_mgmt' || r.role === 'district_inspect') owner = agentOwner('district');
      else owner = agentOwner('store');
      const status = r.role === 'district_inspect' && r.owner !== 'hq' ? '（待区县负责人分配）' : '';
      push(`featured_${r.role}`, owner, r.amount, `特色分成 ${r.note}${status}`);
    }
    if (fixedTotal > 0) push('fixed_cost', 'HQ', fixedTotal, '固定成本回收（归总部）');
    if (commAmt > 0) push('partner_product', upline.id, commAmt, `产品提成 | ${commission.formula}`);
  } else if (p.kind === 'software') {
    // AI软件卡（记忆卡）：拿货差价（固定拿货价 150/170/250/350，沿固定链结算），合伙人提成从链底扣
    // 固定链卖方档位：合伙人/普通买家→单店；代理买家→其在固定链的上级；省代买家→总部直供
    let sellerLevel = 'store';
    if (agentRec) {
      const up = PS.AGENT_UPLINE[agentRec.region_type];
      sellerLevel = up && up !== 'hq' ? up : null;
    }
    const card = PS.cardTierDiff({ paid, buyerLevel, sellerLevel, listPrice: p.variableCost, qty });
    // 合伙人产品提成从链底（单店）级差中扣，溢出部分由总部行承担（保证闭环）
    let rest = commAmt;
    const adjusted = card.rows.map((r, i) => {
      let amt = r.amount;
      if (i === 0 && rest > 0) {
        const cut = Math.min(amt, rest);
        amt = round2(amt - cut);
        rest = round2(rest - cut);
      }
      return { ...r, amount: amt };
    });
    if (rest > 0) {
      const hqRow = adjusted.find((r) => r.level === 'hq');
      if (hqRow) hqRow.amount = round2(hqRow.amount - rest);
    }
    for (const r of adjusted) {
      const owner = r.level === 'hq' ? 'HQ' : agentOwner(r.level);
      const cutNote = r.amount !== (card.rows.find((x) => x.level === r.level) || {}).amount ? '（扣产品提成）' : '';
      push(`card_${r.level}`, owner, r.amount, `AI软件卡拿货差价 ${r.label}${cutNote}`);
    }
    if (commAmt > 0) push('partner_product', upline.id, commAmt, `产品提成 | ${commission.formula}`);
  } else {
    // 兼容兜底（当前无 virtual 产品）：虚拟分成
    const netPool = round2(pool - commAmt);
    const vs = RA.virtualDeliverySplit(netPool, deliveryType);
    push('virtual_hq', 'HQ', vs.hq, `虚拟分成 总部 ${Math.round(vs.hq / (netPool || 1) * 100)}%`);
    push('virtual_province', agentOwner('province'), vs.province, '虚拟分成 省代 2%');
    push('virtual_city', agentOwner('city'), vs.city, '虚拟分成 市代 8%');
    push('virtual_store', agentOwner('store'), vs.store, `虚拟分成 门店 ${deliveryType === 'hq' ? '35%' : '75%'}（内部：股东50%+推荐人5~15%+合店分红10%）`);
    if (commAmt > 0) push('partner_product', upline.id, commAmt, `产品提成 | ${commission.formula}`);
  }

  // 落账（幂等）：同 orderId 重放 → 订单与佣金都按 id 覆盖
  db.orders = db.orders.filter((o) => o.id !== oid);
  const payLater = !!input.payLater;
  const order = {
    id: oid, type: 'product', productKey, productName: p.name, kind: p.kind, buyer_id: buyerId,
    qty, level: buyerLevel, discount_kind: discountKind,
    member_id: input.memberId || null,   // 服务对象（孩子）——仅记录，不参与计价
    unitPrice: price.unitPrice, paid, deliveryType,
    // regionCode = 区县级码（供区域结算按省/市/区县归属）
    // store_code = 门店自身码（含 -S1 门店序号后缀，供交付/核销定位到具体门店）
    regionCode: splitRegionCode,
    store_code: input.storeCode || (splitStoreAgent && splitStoreAgent.region_code) || splitRegionCode || null,
    // 下单门店（前端收银台选择）：**参与分润归属**——门店即「单店」，获单店份额
    storeId: input.storeId || (splitStoreAgent ? splitStoreAgent.region_code : null),
    storeAgentId: splitStoreAgent ? splitStoreAgent.id : null,
    commissionAmount: commAmt,
    // SKU（2026-10-27）：记录规格与扣减数量，取消时据此回补库存
    skuId: sku ? sku.id : null, skuLabel: sku ? (sku.label || null) : null, skuQty: sku ? qty : null,
    status: payLater ? 'PENDING_PAYMENT' : 'paid',
    created_at: Date.now(),
  };
  // 交付模式 / 核销码（P0-6）：特色产品·行政费 → 到店使用；软件卡·虚拟 → 到店取激活码；实物 → 快递
  OL.attachDelivery(order, p.kind, { storeCode: input.storeCode || regionCode || null });
  S.addOrder(db, order);
  // 扣减库存（校验已通过，此处不会失败）并记流水
  if (sku) STK.adjustStock(db, sku.id, -qty, { reason: 'ORDER_CREATE', orderId: oid });
  const commissions = rows.map((r) => ({
    id: `po-${oid}-${r.role}`, owner_id: r.owner_id, type: 'product', subtype: r.role, period,
    base_amount: paid, rate: paid ? round2(r.amount / paid) : null, amount: r.amount,
    ref_order_id: oid,
    // 巡查 5% 仅「权归区县负责人」时为待分配；总部交付时该行已收归总部，按普通待发放处理
    status: r.role === 'featured_district_inspect' && r.owner_id !== 'HQ' ? 'pending_allocation' : 'pending',
    note: r.note,
  }));
  if (payLater) {
    // 待支付：先挂起分润，支付成功后再落账（避免未付款就先计发）
    OL.markPending(db, order);
    order.commission_rows = commissions;
  } else {
    for (const c of commissions) S.upsertCommission(db, c);
  }

  // 经验值（购买产品 Tab，标价多少加多少）
  EXP.record(db, {
    userId: buyerId, event: 'product', price: paid,
    title: `${p.name}${qty > 1 ? ' ×' + qty : ''}`,
    refId: oid,
    meta: { productKey, kind: p.kind, kindLabel: PS.PRODUCT_KIND[p.kind] || p.kind, qty, deliveryMode: order.delivery_mode },
  });

  const byRecipient = {};
  for (const r of rows) byRecipient[r.owner_id] = round2((byRecipient[r.owner_id] || 0) + r.amount);
  const total = round2(rows.reduce((s, r) => s + r.amount, 0));
  return {
    // 问题2：补 id —— 前端后续要用 id 查订单详情、发起支付、轮询支付单
    id: oid, order_id: oid, orderNo: order.order_no || null,
    product: p.name, kind: p.kind, buyer_id: buyerId, level: buyerLevel,
    discount_kind: discountKind, member_id: input.memberId || null, status: order.status,
    payExpireAt: order.pay_expire_at || null,
    remainSeconds: OL.remainSeconds(order),
    deliveryMode: order.delivery_mode, tipText: order.tip_text, verifyCode: order.verify_code,
    unitPrice: price.unitPrice, qty, paid, fixedTotal, pool, deliveryType,
    // SKU（2026-10-27）：回显规格，便于前端订单详情展示"买的哪个规格"
    skuId: sku ? sku.id : null, skuLabel: sku ? (sku.label || null) : null,
    partnerCommission: commission, rows, byRecipient, total,
    closure: Math.abs(total - paid) < 0.01,
  };
}

/** 待支付订单的佣金放行（支付成功后调用；幂等） */
function releaseProductCommissions(db, order) {
  if (!order || !Array.isArray(order.commission_rows)) return [];
  const out = [];
  for (const c of order.commission_rows) { S.upsertCommission(db, c); out.push(c); }
  delete order.commission_rows;
  return out;
}

// ───────────── GET /api/me ─────────────
function getMe(db, userId) {
  const u = S.getUser(db, userId);
  if (!u) throw new Error('用户不存在: ' + userId);
  const period = periodOf();
  const month = S.commissionSummary(db, userId, { period });
  return {
    id: u.id, tier: u.tier, is_founding: u.is_founding || 'none',
    annual_fee_status: u.annual_fee_paid ? 'paid' : 'unpaid',
    wholesale_per_quota: C.WHOLESALE_PER_QUOTA[u.tier],
    quota_balance: Q.getBalance(db.quotaLedger, userId),
    team_vip: S.subtreeVip(db, userId),
    month_income: month.total, month_by_type: month.byType,
  };
}

// ───────────── GET /api/team ─────────────
function getTeam(db, userId) { return S.tree(db, userId); }

// ───────────── 身份体系（2026-10-23：合伙人/代理/合店老板可同时持有，收益分离） ─────────────
const IDENTITY_NAMES = { partner: '合伙人', agent: '区域代理', costore: '合店老板' };
/** 各身份名下的佣金类型（product 类型按下级 subtype 细分，见 commissionIdentity） */
const IDENTITY_TYPES = {
  partner: ['supply', 'parity', 'global', 'founding'],
  agent: ['agent', 'region_vip', 'region_goods_diff', 'region_signing', 'region_admin_delivery', 'region_costore'],
  costore: ['costore'],
};
/** 单笔佣金归属身份：product 类型中 partner_product 归合伙人，链级差/特色/虚拟/行政归代理 */
function commissionIdentity(c) {
  if (c.type === 'product') return c.subtype === 'partner_product' ? 'partner' : 'agent';
  // 合店费中只分给省/市/区县/总部的部分，本质是区域代理收益
  if (c.type === 'costore' && c.subtype === 'region_costore') return 'agent';
  // 合店费中「上级业务奖」（13% 直推 / 2% 复购，收款人为真实上级）→ 归合伙人身份
  // （上级奖励本质是上级合伙人的发展奖励，非合店老板/店长自身收益；无上级时兜底给店长则归入合店店长）
  if (c.type === 'costore' && (c.subtype === 'costore_upline_direct' || c.subtype === 'costore_upline_repurchase')) return 'partner';
  for (const [key, types] of Object.entries(IDENTITY_TYPES)) {
    if (types.includes(c.type)) return key;
  }
  return 'partner';
}

/** 某用户当前持有的身份列表 + 各身份当月收益（身份切换页数据源） */
function getIdentities(db, userId) {
  const u = S.getUser(db, userId);
  if (!u) throw new Error('用户不存在: ' + userId);
  const period = periodOf();
  const agent = db.regionalAgents.find((a) => a.partner_id === userId) || null;
  const costore = db.coStores.find((c) => c.owner_id === userId) || null;
  const list = [];
  // 合伙人身份：账户基础身份（普通用户也显示，档位即详情）
  const partnerSum = S.commissionSummary(db, userId, { period });
  const partnerByType = {};
  let partnerTotal = 0;
  for (const c of partnerSum.list) {
    if (commissionIdentity(c) !== 'partner') continue;
    partnerByType[c.type] = round2((partnerByType[c.type] || 0) + c.amount);
    partnerTotal += c.amount;
  }
  list.push({
    key: 'partner', name: IDENTITY_NAMES.partner,
    detail: u.tier === 'none' ? '普通用户' : (u.tier === 'cofounder' ? '联创合伙人' : u.tier === 'private' ? '私董合伙人' : u.tier === 'angel' ? '天使合伙人' : 'VIP合伙人'),
    tier: u.tier, is_founding: u.is_founding || 'none',
    month_income: round2(partnerTotal), by_type: partnerByType,
  });
  if (agent) {
    const sum = S.commissionSummary(db, userId, { period });
    const byType = {}; let total = 0;
    for (const c of sum.list) {
      if (commissionIdentity(c) !== 'agent') continue;
      byType[c.type] = round2((byType[c.type] || 0) + c.amount);
      total += c.amount;
    }
    list.push({
      key: 'agent', name: IDENTITY_NAMES.agent,
      detail: `${({ store: '单店代理', district: '区县代', city: '市代', province: '省代' })[agent.region_type] || agent.region_type} · ${agent.region_code || ''}`,
      region_type: agent.region_type, region_code: agent.region_code, granted_tier: agent.granted_tier || null,
      month_income: round2(total), by_type: byType,
    });
  }
  if (costore) {
    const sum = S.commissionSummary(db, userId, { period, type: 'costore' });
    list.push({
      key: 'costore', name: IDENTITY_NAMES.costore,
      detail: `合店老板 · 门店 ${costore.store_id || costore.storeManagerId || '—'}`,
      store_id: costore.store_id || null, storeManagerId: costore.storeManagerId || null,
      month_income: sum.total, by_type: sum.byType,
    });
  }
  return { identities: list, total_month_income: round2(list.reduce((s, x) => s + x.month_income, 0)) };
}

// ───────────── GET /api/commissions ─────────────
function getCommissions(db, userId, { period, type, identity } = {}) {
  const all = S.commissionSummary(db, userId, { period, type }).list;
  const list = identity ? all.filter((c) => commissionIdentity(c) === identity) : all;
  const byType = {};
  let total = 0;
  for (const c of list) { byType[c.type] = round2((byType[c.type] || 0) + c.amount); total += c.amount; }
  return { list, total: round2(total), byType };
}

// ───────────── POST /api/quota/issue（总部/上级补货） ─────────────
function issueQuota(db, { partnerId, qty, kind = 'standard', operatorId }) {
  // P0-3：kind 支持 'standard' | 'activity'（活动名额带有效期，时长后台可配）
  const qCfg = Q.resolveConfig((S.getSettings(db) || {}).quota || {});
  const after = Q.issueQuota(db.quotaLedger, partnerId, qty, kind, {
    tx: db.quota_transactions, operatorId, ref: 'issue',
    activityValidityDays: qCfg.activityValidityDays,
  });
  S.addOrder(db, { id: S.nextId(db, 'o'), type: 'issue', partnerId, qty, kind, created_at: Date.now() });
  return {
    partnerId, qty, kind, balance_after: after,
    standard: Q.getStandard(db.quotaLedger, partnerId),
    activity: Q.getActivity(db.quotaLedger, partnerId),
    activityValidityDays: qCfg.activityValidityDays,
  };
}

// ───────────── POST /api/relation/unbind ─────────────
function unbind(db, { partnerId }) { return S.unbind(db, partnerId); }

// ───────────── POST /api/relation/rebind ─────────────
function rebind(db, { partnerId, newUplineId }) { return S.rebind(db, partnerId, newUplineId); }

// ───────────── POST /api/settlement/run（月度结算） ─────────────
function runSettlement(db, { period = periodOf() } = {}) {
  const cofounderIds = Object.values(db.users).filter((u) => u.tier === 'cofounder').map((u) => u.id);
  const cofounders = S.annotateCofounders(db, cofounderIds);
  // 创始奖发放名单（用户 2026-10-22 15:18 修正）：
  //   - 联创：仅持有创始奖(is_founding)者 → 17.5/VIP
  //   - 私董：全员 → 3.5/VIP
  // 创始奖发放名单（用户 2026-10-24 最终口径）：联创全员（含省/市代理被赠予的联创）17.5/VIP；私董全员 3.5/VIP。
  //   凡 tier=cofounder 即发，不再要求 is_founding 真值（runFoundingBonus 已按 tier 直接发放）。
  const founders = Object.values(db.users)
    .filter((u) => u.tier === 'cofounder' || u.tier === 'private')
    .map((u) => ({ id: u.id, tier: u.tier, foundingBonus: u.tier === 'cofounder' }));
  const orders = db.orders.filter((o) => o.packageTier);   // 仅产品订单参与代理/门店拆分
  const costoreOwners = new Set(db.coStores.map((x) => x.owner_id));
  const settings = S.getSettings(db);
  const minMonths = (settings.costore && settings.costore.minMonths) || 6;
  // 合店费月度口径（2026-10-24 拍板·一次性入池）：
  //   入伙当月按「全额 = 月费 × 最少起付月数（默认 6 → 4188）」整笔分发一次，
  //   不逐月摊销 698/月；后续月份该合店记录不再参与分发（已一次性结清）。
  //   仅取 joinDate 月份 == 结算月份 的合店记录，避免同一笔合店费在 6 个月里被反复分发。
  const costoreFees = db.coStores
    .filter((cs) => joinMonthOf(cs.joinDate) === period)
    .map((cs) => ({
      id: cs.id, owner_id: cs.owner_id,
      storeManagerId: cs.storeManagerId || cs.owner_id,
      promoter_id: cs.promoter_id || null,
      uplineId: cs.upline_id || (db.users[cs.owner_id] && db.users[cs.owner_id].upline_id) || null,
      fee: round2((cs.monthly_fee != null ? cs.monthly_fee : settings.costore.monthlyFee) * minMonths),
      store_id: cs.store_id,
      joinDate: cs.joinDate, ownerCount: cs.ownerCount || 1,
      // 区域码：合店自身 → 合店老板 → 门店店长，逐级回退；用于结算时把省市区分成落到真实代理
      regionCode: cs.region_code || (db.users[cs.owner_id] && db.users[cs.owner_id].region_code)
        || (db.users[cs.storeManagerId] && db.users[cs.storeManagerId].region_code) || null,
      owners: cs.owners || cs.partners || [],
    }));
  const agents = db.regionalAgents;

  const res = SET.settleAll({ period, orders, cofounders, founders, costoreFees, agents, settings, costoreOwners });
  // 落账（幂等）：结算产出的 commission 都带确定性 id（如 cs-hq-cs_11 / gb-p1 / fb-...），
  // 重复执行同月结算时按 id 覆盖而非追加，避免「每点一次结算金额就翻倍」。
  // 注意合店费：四场景(enabledV2=true)与旧固定三分(false)两套佣金 id 规则不同，
  // 若只按 id upsert，切换开关后重跑会让新旧两套并存 → 重复计发。
  // 故先清除本月既有合店费落账，再用本次结果覆盖写入。
  db.commissions = db.commissions.filter((c) => !(c.type === 'costore' && c.period === period));
  for (const c of res.commissions) S.upsertCommission(db, c);
  const settledCount = res.commissions.length;

  // 分红业绩门槛（P0-7）：给分红类记录打「当月有/无分红权」标记 —— 金额照记，无分红权者 withhold（不可提现）
  const dividendGate = require('./dividendGate').applyToCommissions(db, period);

  // 全量口径：合并「下单即时落账」与「本次结算新增」的收益，否则后台「分润合计」会漏算。
  //   即时落账：身份销售 = 供应差价 + 平级奖；产品 = 产品提成；代理任命 = 直推代理奖 + 业务提成。
  const periodRows = db.commissions.filter((c) => c.period === period);
  const allByType = {};
  let allTotal = 0;
  for (const c of periodRows) { allByType[c.type] = round2((allByType[c.type] || 0) + c.amount); allTotal += c.amount; }
  const settleOnlyTotal = round2(res.summary.total);

  return {
    ...res.summary,
    period,
    // 本次结算新增
    settleTotal: settleOnlyTotal,
    settleByType: res.summary.byType,
    // 当月全量（含下单即时收益）
    allTotal: round2(allTotal),
    allByType,
    allCount: periodRows.length,
    settleCount: settledCount,
    // 分红权门禁结果（无分红权笔数占比，便于后台核对）
    dividendGate,
  };
}

// ───────────── GET /api/costore ─────────────
function getCostore(db, ownerId, opts) {
  const contractId = (opts && opts.contractId) || null;
  // 按合同 id 精确选择（一个用户可能持有多家合店）；未指定时取第一家
  const cs = contractId
    ? db.coStores.find((x) => x.id === contractId && (x.owner_id === ownerId || (x.owners || []).some((o) => o.id === ownerId)))
    : db.coStores.find((x) => x.owner_id === ownerId);
  if (!cs) return null;
  const settings = S.getSettings(db);
  const cfg = CP.buildConfig(settings.costore);
  const costoreOwners = new Set(db.coStores.map((x) => x.owner_id));
  const storeManagerId = cs.storeManagerId || cs.owner_id;
  const referrer = cs.promoter_id ? { id: cs.promoter_id, isCostoreOwner: costoreOwners.has(cs.promoter_id) } : null;
  const uplineId = cs.upline_id || (db.users[cs.owner_id] && db.users[cs.owner_id].upline_id) || null;
  // 一次性入池（2026-10-24 拍板）：预览按「全额 = 月费 × 起付月数」展示实际一次性分配，而非单月 698 等价
  const fullFee = round2((cs.monthly_fee != null ? cs.monthly_fee : settings.costore.monthlyFee) * (settings.costore.minMonths || 6));
  const plan = CP.costoreDistribution({
    fee: fullFee, config: cfg,
    storeManagerId, referrer, upline: uplineId ? { id: uplineId } : null,
    uplineIsCostoreOwner: !!(costoreOwners && uplineId && costoreOwners.has(uplineId)),
  });
  return {
    owner_id: cs.owner_id, monthly_fee: cs.monthly_fee, period: cs.period,
    promoter_id: cs.promoter_id || null, storeManagerId, uplineId,
    scenario: plan.scenario, byRecipient: plan.byRecipient, dividendPool: plan.dividendPool,
    // 兼容旧字段（前端旧卡片仍可读取）—— 同样按一次性全额口径
    split: C.coStoreSplit(fullFee),
    owner: C.coStoreOwnerDetail(fullFee),
    profit: C.coStoreProfitBreakdown(fullFee),
    partnerBonus: C.coStorePartnerBonus(fullFee),
    allocation: C.coStoreFeeAllocation(fullFee, {
      ownerCount: cs.ownerCount || 1,
      owners: cs.owners || cs.partners || [],
    }),
    dividend: C.coStorePartnerDividend(fullFee, cs.partners || []),
  };
}

// ───────────── GET /api/agent（区域代理分红） ─────────────
function getAgent(db, agentId, opts) {
  const assignmentId = (opts && opts.assignmentId) || null;
  // 按任命记录 id 精确选择（同一用户可能同时是省代 + 市代）；未指定时取第一条。
  // 兼容旧口径：assignmentId 传的是用户 id 时等价于「该用户的第一条代理身份」。
  // ⚠️ 回退只在**同一用户内**进行，避免用别人的 id 越权读取他人代理收益。
  const ag = assignmentId
    ? (db.regionalAgents.find((a) => a.id === assignmentId && a.partner_id === agentId)
      || (assignmentId === agentId ? db.regionalAgents.find((a) => a.partner_id === agentId) : null))
    : db.regionalAgents.find((a) => a.partner_id === agentId);
  if (!ag) return null;
  const period = periodOf();
  const sum = S.commissionSummary(db, agentId, { period, type: 'agent' });
  return { agent: ag, month_income: sum.total, by_region: sum.byType };
}

module.exports = {
  periodOf, buildUplineChain,
  createOrder, createProductOrder, releaseProductCommissions, getMe, getTeam, getCommissions, getIdentities, issueQuota, unbind, rebind,
  runSettlement, getCostore, getAgent,
  IDENTITY_NAMES, IDENTITY_TYPES, commissionIdentity, TIER_CN,
};
