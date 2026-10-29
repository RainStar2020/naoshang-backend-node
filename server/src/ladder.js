/**
 * 脑商AI · 合伙人成长阶梯 L1–L10（P1-7）
 *
 * 设计：L1（最低）→ L10（最高）共 10 级，每级给出：
 *   - name        等级名称
 *   - minScore    晋升所需「成长积分」阈值（累计，达到即升）
 *   - commissionRate 该级对应的「团队提成系数」（示例口径，后台可改）
 *   - coord       阶梯图坐标 { x, y }（x=等级序 1..10，y=minScore 归一化后的画布坐标，便于前端直接画图）
 *
 * 注：孩子会员阶梯（粉丝/菁英/超级/行能/羿烁，见 identity.js MEMBER_TIERS）是「会员维度」的阶梯，
 * 与本文件「合伙人成长维度」的 L1–L10 是两套独立体系，互不冲突。本文件对应待开发清单 P1-7 的 L1–L10 坐标。
 *
 * 默认阈值/坐标均为「合理默认」，真实坐标由产品/运营在后台 settings.ladder 覆盖。
 */

const DEFAULT_LEVELS = [
  { level: 'L1', name: '见习合伙人', minScore: 0,     commissionRate: 0.00, coord: { x: 1,  y: 10 } },
  { level: 'L2', name: '初级合伙人', minScore: 1000,  commissionRate: 0.02, coord: { x: 2,  y: 22 } },
  { level: 'L3', name: '中级合伙人', minScore: 5000,  commissionRate: 0.04, coord: { x: 3,  y: 34 } },
  { level: 'L4', name: '高级合伙人', minScore: 15000, commissionRate: 0.06, coord: { x: 4,  y: 46 } },
  { level: 'L5', name: '资深合伙人', minScore: 40000, commissionRate: 0.08, coord: { x: 5,  y: 58 } },
  { level: 'L6', name: '城市合伙人', minScore: 100000, commissionRate: 0.10, coord: { x: 6,  y: 70 } },
  { level: 'L7', name: '区域合伙人', minScore: 250000, commissionRate: 0.12, coord: { x: 7,  y: 78 } },
  { level: 'L8', name: '省级合伙人', minScore: 600000, commissionRate: 0.15, coord: { x: 8,  y: 85 } },
  { level: 'L9', name: '大区合伙人', minScore: 1500000, commissionRate: 0.18, coord: { x: 9,  y: 92 } },
  { level: 'L10', name: '全球合伙人', minScore: 4000000, commissionRate: 0.22, coord: { x: 10, y: 98 } },
];

function levelOf(score, levels = DEFAULT_LEVELS) {
  let cur = levels[0];
  for (const lv of levels) {
    if (score >= lv.minScore) cur = lv;
    else break;
  }
  return cur;
}

function nextLevel(score, levels = DEFAULT_LEVELS) {
  for (const lv of levels) {
    if (score < lv.minScore) return lv;
  }
  return null; // 已满级
}

function progress(score, levels = DEFAULT_LEVELS) {
  const cur = levelOf(score, levels);
  const nxt = nextLevel(score, levels);
  if (!nxt) return { current: cur, next: null, toNext: 0, ratio: 1 };
  const span = nxt.minScore - cur.minScore;
  const done = score - cur.minScore;
  const ratio = span > 0 ? Math.max(0, Math.min(1, done / span)) : 1;
  return { current: cur, next: nxt, toNext: nxt.minScore - score, ratio: round2(ratio) };
}

function round2(n) { return Math.round(n * 100) / 100; }

/** 前端画图用的完整阶梯图数据（坐标 + 连线 + 当前用户位置） */
function ladderChart(score = 0, overrides = null) {
  const levels = overrides && overrides.length ? overrides : DEFAULT_LEVELS;
  const prog = progress(score, levels);
  return {
    levels: levels.map((lv) => ({ ...lv })),
    currentLevel: prog.current.level,
    currentScore: score,
    nextLevel: prog.next ? prog.next.level : null,
    toNext: prog.toNext,
    ratio: prog.ratio,
    unit: '成长积分',
  };
}

module.exports = { DEFAULT_LEVELS, levelOf, nextLevel, progress, ladderChart };
