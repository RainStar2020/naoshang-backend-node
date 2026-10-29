/**
 * 拉人免费升档触发逻辑 · 端到端验证（2026-10-26）
 *
 * 规则：上级 U 直推 N(=3) 名「被推荐时与 U 同级」的下级，且每名下级各自「从同级起步付费升档」，
 *      则 U 免费升 1 档（tier+1，principal_tier 不变）。每满 3 名触发一次，可累计，封顶联创。
 *
 * 运行：node scripts/verify_referral_free_upgrade.js
 */
const S = require('../src/store');
const R = require('../src/routes');
const C = require('../src/commission');

let passed = 0, failed = 0;
const check = (name, cond, extra) => {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 300) : ''}`); }
};
const near = (a, b) => Math.abs(a - b) < 1e-6;

function setup() {
  const db = S.createDb();
  // G：链顶联创（U 的上级，仅为让 U 能下单；不参与本测试升档判定）
  S.addUser(db, { id: 'G', name: '链顶-联创', tier: 'cofounder', principal_tier: 'cofounder', upline_id: null, entitlement_state: 'active', seq: 0 });
  // U：天使，本金=天使（29800）；principal_tier 显式；上级为 G
  const U = S.addUser(db, { id: 'U', name: '上级-天使', tier: 'angel', principal_tier: 'angel', upline_id: 'G', entitlement_state: 'active', seq: 1 });
  db.quotaLedger['U'] = 999; // 上级名额充足（仅测触发，不测名额）
  db.quotaLedger['G'] = 999; // U 下单需消耗 G 名额
  return { db, U };
}
// 造一名「与 U 同级(天使)」的下级，并让其付费升到 private（oldTier=angel → packageTier=private）
function makeSameTierDownlineAndUpgrade(db, id, uplineId, fromTier, toTier) {
  const D = S.addUser(db, { id, name: id, tier: fromTier, principal_tier: fromTier, upline_id: uplineId, entitlement_state: 'active', seq: 100 + Number(id.slice(1)) });
  // 下级付费升档：oldTier === referral_upline_tier（与上级同级起步）
  const res = R.createOrder(db, { buyerId: id, packageTier: toTier, oldTier: fromTier });
  return { D, res };
}

console.log('═══ 场景一：拉 3 名同级(天使)付费升 private → U 免费升 private ═══');
{
  const { db, U } = setup();
  const before = { tier: U.tier, principal: U.principal_tier };
  // 第 1、2 名：尚未满 3，不应触发
  makeSameTierDownlineAndUpgrade(db, 'D1', 'U', 'angel', 'private');
  makeSameTierDownlineAndUpgrade(db, 'D2', 'U', 'angel', 'private');
  check('满 2 名时 U 仍为 angel（未触发）', U.tier === 'angel', U.tier);
  check('满 2 名时 principal_tier 仍 angel', U.principal_tier === 'angel', U.principal_tier);
  // 第 3 名：触发
  makeSameTierDownlineAndUpgrade(db, 'D3', 'U', 'angel', 'private');
  check('满 3 名 → U 升为 private', U.tier === 'private', U.tier);
  check('免费升档不改变 principal_tier（仍 angel，本金 29800）', U.principal_tier === 'angel', U.principal_tier);

  // 进度
  const prog = S.referralFreeUpgradeProgress(db, 'U');
  check('进度：required=3', prog.required === 3, prog);
  check('进度：qualifying=3', prog.qualifying === 3, prog);
  check('进度：applied=1', prog.applied === 1, prog);
  check('进度：pending=0', prog.pending === 0, prog);
  check('进度：earned=1', prog.earned === 1, prog);

  // 日志
  check('freeUpgradeLog 有 1 条发放记录', db.freeUpgradeLog.length === 1, db.freeUpgradeLog);
  check('日志 fromTier=angel→toTier=private', db.freeUpgradeLog[0] && db.freeUpgradeLog[0].fromTier === 'angel' && db.freeUpgradeLog[0].toTier === 'private', db.freeUpgradeLog[0]);
  check('U 对外编号已重算（天使 TS → 私董 SD）', db.users['U'].display_id && db.users['U'].display_id.startsWith('SD'), db.users['U'].display_id);

  // 幂等：再调用一次不应重复发放
  const r2 = S.maybeGrantFreeUpgrade(db, 'U');
  check('幂等：二次调用 granted 为空', r2.granted.length === 0, r2);
  check('幂等：tier 仍为 private', U.tier === 'private', U.tier);
}

console.log('\n═══ 场景二：累计 6 名（均天使档被推荐） → U 升 2 档（angel → cofounder） ═══');
{
  const { db, U } = setup();
  // 关键：6 名下級全部在 U 仍为 angel 时被推荐（referral_upline_tier=angel），再统一付费升 private
  const ids = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'];
  ids.forEach((id) => S.addUser(db, { id, name: id, tier: 'angel', principal_tier: 'angel', upline_id: 'U', entitlement_state: 'active', seq: 100 + Number(id.slice(1)) }));
  ids.forEach((id) => R.createOrder(db, { buyerId: id, packageTier: 'private', oldTier: 'angel' }));
  check('满 6 名 → U 升 2 档到 cofounder', U.tier === 'cofounder', U.tier);
  check('累计升档 principal_tier 仍 angel（始终不动本金）', U.principal_tier === 'angel', U.principal_tier);
  check('daysSinceCofounder 已置（联创无责期）', U.daysSinceCofounder != null, U.daysSinceCofounder);
  const prog = S.referralFreeUpgradeProgress(db, 'U');
  check('进度：applied=2', prog.applied === 2, prog);
  check('进度：pending=0', prog.pending === 0, prog);
  check('进度：nextTier=null（已联创封顶）', prog.nextTier === null, prog);
}

console.log('\n═══ 场景三：不合格下级不计入（非同级 / 未付费升档） ═══');
{
  const { db, U } = setup();
  // 下级 Dx 被推荐时 U 是天使(referral_upline_tier=angel)，但 Dx 只从 vip 起步升 angel（oldTier=vip≠angel）→ 不计
  const Dx = S.addUser(db, { id: 'Dx', name: 'Dx', tier: 'vip', principal_tier: 'vip', upline_id: 'U', entitlement_state: 'active', seq: 200 });
  R.createOrder(db, { buyerId: 'Dx', packageTier: 'angel', oldTier: 'vip' }); // vip→angel，oldTier≠angel
  check('下级从 vip 升 angel 不计入（非同级起步）', S.qualifyingDownlineIds(db, 'U').length === 0, S.qualifyingDownlineIds(db, 'U'));
  check('U 未触发升档', U.tier === 'angel', U.tier);

  // 3 名合格 + 1 名不合格 → 仍只算 3，触发 1 次
  makeSameTierDownlineAndUpgrade(db, 'Da', 'U', 'angel', 'private');
  makeSameTierDownlineAndUpgrade(db, 'Db', 'U', 'angel', 'private');
  makeSameTierDownlineAndUpgrade(db, 'Dc', 'U', 'angel', 'private');
  check('3 合格 + 1 不合格 → qualifying=3', S.qualifyingDownlineIds(db, 'U').length === 3, S.qualifyingDownlineIds(db, 'U'));
  check('U 升 private（仅按合格数）', U.tier === 'private', U.tier);
}

console.log('\n═══ 场景四：price 锚点独立验证（免费升档后 principal 锚定原档） ═══');
{
  // U 入口 angel（本金 29800）→ 免费升 private → 再一口价升 cofounder 应付 = 239800 − 29800 = 210000
  const { db, U } = setup();
  makeSameTierDownlineAndUpgrade(db, 'D1', 'U', 'angel', 'private');
  makeSameTierDownlineAndUpgrade(db, 'D2', 'U', 'angel', 'private');
  makeSameTierDownlineAndUpgrade(db, 'D3', 'U', 'angel', 'private');
  check('U 已免费升 private', U.tier === 'private', U.tier);
  db.quotaLedger['U'] = 999;
  const res = R.createOrder(db, { buyerId: 'U', packageTier: 'cofounder', oldTier: U.tier }); // private→cofounder
  check('免费升档后一口价升 cofounder = 210000（239800−本金29800）', near(res.actual_paid, 210000), res.actual_paid);
  check('付费升档后 principal_tier 更新为 cofounder', U.principal_tier === 'cofounder', U.principal_tier);
}

console.log(`\n拉人免费升档触发: PASS=${passed} FAIL=${failed}`);
process.exit(failed ? 1 : 0);
