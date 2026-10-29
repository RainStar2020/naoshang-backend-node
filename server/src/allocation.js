/**
 * 脑商AI合伙人 · 分配意愿自选（P0-9，2026-10-26 拍板）
 *
 * ════════════════════════════════════════════════════════════════
 * 用户拍板口径（对齐原型屏 82/84/85 + 分成表）
 * ════════════════════════════════════════════════════════════════
 *   特色产品分成里有两块「可自行分配」的钱：
 *     · 巡查 5%（区县 10% 中的巡查部分）→ 分配权交**县区代**
 *     · 销售 5%（单店 65% 中的销售部分）→ 分给**单店代理（门店店长）**
 *   这两块**可自行分配**（本人 / 上级代理 / 合作代理 / 总部，百分比自填，合计 100%）。
 *
 *   要求「做成活的」：
 *     · 默认归属、比例、是否允许自行分配、最多拆几份 → 全部进 settings.productAllocation
 *     · 修改权限在**总部后台**（settings.productAllocation.editableBy = 'HQ'）
 *     · 总部既能改「默认规则」，也能对某一笔明细直接指派
 *
 * 账务模型：
 *   分配 = 指定（designation），**不改父记录金额**；到下一结算周期由 settle() 按方案拆成子佣金，
 *   父记录打 withhold（不可提现），保证「不重复计发、不丢账」。
 */
const { round2 } = require('./commission');
const S = require('./store');

const nowMs = () => Date.now();
/** 内部 kind（与 settings.productAllocation 的键一致） */
const KINDS = ['inspect', 'sales'];
/**
 * 对外 allocationKind（前端契约口径：inspection / sales）
 * ⚠️ 历史文档与前端 mock 混用过 inspect / inspection 两种写法，
 *    此处统一对外输出 inspection，内部仍用 inspect（settings 键不变），避免存量配置失效。
 */
const PUBLIC_KIND = { inspect: 'inspection', sales: 'sales' };
const INTERNAL_KIND = { inspection: 'inspect', inspect: 'inspect', sales: 'sales' };
/** 内部 kind → 对外 allocationKind */
function publicKind(kind) { return kind ? (PUBLIC_KIND[kind] || kind) : null; }
/** 对外 allocationKind（或历史 inspect）→ 内部 kind；无法识别返回 null */
function internalKind(kind) { return kind ? (INTERNAL_KIND[kind] || null) : null; }
const KIND_CN = { inspect: '巡查 5%', sales: '销售 5%' };
const TARGET_KINDS = {
  self: { key: 'self', label: '本人' },
  upline_agent: { key: 'upline_agent', label: '上级代理' },
  peer_agent: { key: 'peer_agent', label: '合作代理' },
  hq: { key: 'hq', label: '总部' },
};

/**
 * ────────────────────────────────────────────────────────────────
 * 原型弹窗的**语义角色**（用户 2026-10-27 截图确认）
 * ────────────────────────────────────────────────────────────────
 * 「分配巡查提点」（区县负责人操作）：本人 / 上级市代 / 上级省代 / 总部 / 其他代理
 * 「分配销售提点」（门店店长操作）  ：本店 / 上级区代 / 上级市代 / 上级省代 / 总部 / 其他代理
 *
 * 前端只提交这些**角色键**（self / city / province / county / hq / other），
 * 由本模块按受益人所在代理链解析成**真实收款人 id**（其他代理走手填 ID）。
 * 这样前后端不依赖「动态候选列表」，弹窗选项固定、与原型一致。
 */
const SEMANTIC_TARGETS = {
  inspect: [
    { key: 'self', label: '本人', agentLevel: null },
    { key: 'city', label: '上级市代', agentLevel: 'city' },
    { key: 'province', label: '上级省代', agentLevel: 'province' },
    { key: 'hq', label: '总部', agentLevel: null, hq: true },
    { key: 'other', label: '其他代理', agentLevel: null, needsId: true },
  ],
  sales: [
    { key: 'self', label: '本店', agentLevel: null },
    { key: 'county', label: '上级区代', agentLevel: 'district' },
    { key: 'city', label: '上级市代', agentLevel: 'city' },
    { key: 'province', label: '上级省代', agentLevel: 'province' },
    { key: 'hq', label: '总部', agentLevel: null, hq: true },
    { key: 'other', label: '其他代理', agentLevel: null, needsId: true },
  ],
};

/** 该 kind 的语义角色清单（前端弹窗据此渲染选项） */
function semanticTargets(kind) {
  const k = KINDS.includes(kind) ? kind : 'inspect';
  return SEMANTIC_TARGETS[k].map((t) => ({ ...t }));
}

/** 语义角色键集合（校验用） */
const SEMANTIC_TARGET_KEYS = {
  inspect: SEMANTIC_TARGETS.inspect.map((t) => t.key),
  sales: SEMANTIC_TARGETS.sales.map((t) => t.key),
};
const AGENT_UP = { store: 'district', district: 'city', city: 'province', province: null };

function ensure(db) {
  if (!Array.isArray(db.allocations)) db.allocations = [];
  if (!Array.isArray(db.allocationQuotes)) db.allocationQuotes = [];
}

/** 当前规则（总部可改，读时合并默认值） */
function scheme(db) {
  const s = S.getSettings(db);
  const cfg = s.productAllocation || {};
  // P1-5：固定 / 自选 两种模式（总部后台可切）
  const mode = cfg.mode === 'fixed' ? 'fixed' : 'self_assign';
  return {
    editableBy: cfg.editableBy || 'HQ',
    mode,
    modeLabel: mode === 'fixed' ? '固定分配（两块 5% 均归默认受益人，不可自选）' : '自选分配（两块 5% 可自行指定受益人）',
    kinds: KINDS.map((k) => ({
      key: k,
      label: KIND_CN[k],
      rate: cfg[k] ? cfg[k].rate : 0.05,
      defaultRecipient: cfg[k] ? cfg[k].defaultRecipient : (k === 'inspect' ? 'district' : 'store'),
      defaultRecipientLabel: (cfg[k] ? cfg[k].defaultRecipient : (k === 'inspect' ? 'district' : 'store')) === 'district'
        ? '县区代' : (cfg[k] && cfg[k].defaultRecipient === 'hq' ? '总部' : '单店代理（门店店长）'),
      ownerAssignable: mode === 'fixed' ? false : (cfg[k] ? !!cfg[k].ownerAssignable : true),
      maxTargets: (cfg[k] && cfg[k].maxTargets) || 4,
    })),
    targetKinds: Object.values(TARGET_KINDS),
    note: mode === 'fixed'
      ? '当前为「固定分配」模式：巡查 5% 固定归县区代、销售 5% 固定归单店代理，不可自选'
      : '巡查 5% 默认归县区代、销售 5% 默认归单店代理；两块均可自行分配，默认规则与单笔指派权限均在总部后台',
  };
}

/** 总部改默认规则（仅 settings.productAllocation 白名单键） */
function updateScheme(db, patch = {}) {
  const cur = S.getSettings(db).productAllocation;
  const next = {};
  for (const k of KINDS) {
    const base = cur[k] || {};
    const p = patch[k] || {};
    next[k] = {
      rate: p.rate != null ? Number(p.rate) : base.rate,
      defaultRecipient: p.defaultRecipient != null ? p.defaultRecipient : base.defaultRecipient,
      ownerAssignable: p.ownerAssignable != null ? !!p.ownerAssignable : base.ownerAssignable,
      maxTargets: p.maxTargets != null ? Math.max(1, Math.floor(Number(p.maxTargets))) : base.maxTargets,
    };
  }
  next.editableBy = 'HQ';
  // P1-5：总部可切换「固定 / 自选」模式
  if (patch.mode === 'fixed' || patch.mode === 'self_assign') next.mode = patch.mode;
  else next.mode = cur.mode || 'self_assign';
  S.updateSettings(db, { productAllocation: next });
  return scheme(db);
}

/** 该佣金明细属于哪一类可分配池 */
function kindOf(commission) {
  const sub = (commission && commission.subtype) || '';
  if (sub === 'featured_district_inspect') return 'inspect';
  if (sub === 'featured_store_sales') return 'sales';
  return null;
}

/** 是否可发起分配 */
function allocatable(db, entry) {
  const kind = kindOf(entry);
  if (!kind) return { ok: false, kind: null, reason: '该笔收益不属于可分配池（仅巡查 5% / 销售 5% 可分配）' };
  const sc = scheme(db).kinds.find((k) => k.key === kind);
  if (!sc.ownerAssignable) return { ok: false, kind, reason: '总部已关闭该类收益的自行分配' };
  if (entry.allocationStatus === 'SETTLED') return { ok: false, kind, reason: '该笔已分配结算，不可再改' };
  if (entry.withhold) return { ok: false, kind, reason: '该笔已进入分配结算，不可再改' };
  return { ok: true, kind, scheme: sc };
}

/**
 * 受益人所在代理记录（一个用户可能兼任多个区域身份，取与该分配池匹配的那个）
 */
function ownerAgentOf(db, entry, kind) {
  const mine = db.regionalAgents.filter((a) => a.partner_id === entry.owner_id);
  if (!mine.length) return null;
  // 巡查池归区县负责人（区县级身份）；销售池归门店店长（单店级身份）
  const prefer = kind === 'inspect' ? 'district' : 'store';
  return mine.find((a) => a.region_type === prefer) || mine[0];
}

/**
 * 按**区域层级前缀**找某级别的上级代理
 * （门店 region_code 通常是区县级：110101 → 区县 110101 / 市 1101 / 省 11）
 */
function findAgentByLevel(db, regionCode, level) {
  if (!regionCode || !level) return null;
  const len = { district: 6, city: 4, province: 2 }[level];
  if (!len) return null;
  const prefix = String(regionCode).slice(0, len);
  return db.regionalAgents.find((a) => a.region_type === level && String(a.region_code || '').slice(0, len) === prefix) || null;
}

/**
 * 把「原型弹窗的语义角色」解析成**实际收款人**
 * @param {object} db
 * @param {object} entry 佣金明细
 * @param {string} kind 'inspect' | 'sales'
 * @param {string} targetKey 语义键（self/city/province/county/hq/other）
 * @param {string} agentId 「其他代理」时手填的代理/用户 ID
 * @returns {{ok:boolean, targetId?:string, name?:string, reason?:string}}
 */
function resolveSemanticTarget(db, entry, kind, targetKey, agentId) {
  const keys = SEMANTIC_TARGET_KEYS[kind] || [];
  if (!keys.includes(targetKey)) return { ok: false, reason: `非法收益方：${targetKey}（可选 ${keys.join('/')}）` };
  const spec = SEMANTIC_TARGETS[kind].find((t) => t.key === targetKey);
  const owner = db.users[entry.owner_id] || null;
  const ag = ownerAgentOf(db, entry, kind);

  if (targetKey === 'self') {
    return { ok: true, targetId: entry.owner_id, name: owner ? owner.name : entry.owner_id, roleLabel: kind === 'sales' ? '本店' : '本人' };
  }
  if (targetKey === 'hq') {
    return { ok: true, targetId: 'HQ', name: '总部', roleLabel: '总部' };
  }
  if (targetKey === 'other') {
    const raw = String(agentId || '').trim();
    if (!raw) return { ok: false, reason: kind === 'inspect' ? '请输入巡查方ID' : '请输入销售方ID' };
    // 手填 ID 可为用户 ID 或区域代理 ID
    let uid = null;
    if (db.users[raw]) uid = raw;
    else {
      const a = db.regionalAgents.find((x) => x.id === raw || x.partner_id === raw);
      if (a) uid = a.partner_id;
    }
    if (!uid) return { ok: false, reason: `受益人不存在：${raw}` };
    const u = db.users[uid];
    return { ok: true, targetId: uid, name: u ? u.name : uid, roleLabel: '其他代理' };
  }
  // 上级代理（city / province / county）：按持有人的区域链向上找
  if (!ag) return { ok: false, reason: '当前受益人没有区域代理身份，无法分配给上级代理' };
  const up = findAgentByLevel(db, ag.region_code, spec.agentLevel);
  if (!up) return { ok: false, reason: `未找到对应的上级代理（${spec.label}）` };
  const u = db.users[up.partner_id];
  return { ok: true, targetId: up.partner_id, name: u ? u.name : up.partner_id, roleLabel: spec.label };
}

/**
 * 解析一批分配目标：语义键 → 实际收款人；也兼容直接传用户 ID（老契约）
 * @returns {{ok:boolean, rows:Array, errors:Array}}
 */
function resolveTargets(db, entry, kind, targets = []) {
  const errors = [];
  const rows = targets.map((t) => {
    const percent = Number(t.percent);
    const rawKey = String(t.targetId || '');
    const key = rawKey;
    // 语义键命中 → 解析
    if ((SEMANTIC_TARGET_KEYS[kind] || []).includes(key)) {
      const r = resolveSemanticTarget(db, entry, kind, key, t.agentId);
      if (!r.ok) { errors.push(r.reason); return null; }
      return {
        targetId: r.targetId, name: r.name, kind: key, percent: round2(percent || 0),
        amount: round2(((entry.amount || 0) * (Number(percent) || 0)) / 100),
        roleLabel: r.roleLabel, agentId: t.agentId || null,
      };
    }
    // 老契约：直接传用户 ID / 'HQ'
    const isHq = rawKey === 'HQ';
    if (!isHq && !db.users[rawKey]) { errors.push(`受益人不存在：${rawKey}`); return null; }
    const name = isHq ? '总部' : (db.users[rawKey] ? db.users[rawKey].name : rawKey);
    return {
      targetId: rawKey, name, kind: t.kind || (isHq ? 'hq' : 'other'), percent: round2(percent || 0),
      amount: round2(((entry.amount || 0) * (Number(percent) || 0)) / 100),
      roleLabel: isHq ? '总部' : '', agentId: t.agentId || null,
    };
  }).filter(Boolean);
  return { ok: errors.length === 0, rows, errors };
}

/** 候选分配对象（原型弹窗语义角色 + 实际受益人） */
function candidates(db, entry) {
  const kind = kindOf(entry);
  const owner = db.users[entry.owner_id] || null;
  const base = [{ targetId: entry.owner_id, name: owner ? owner.name : entry.owner_id, kind: 'self', roleLabel: (owner && owner.tier) || '' }];
  if (!kind) return base;
  return semanticTargets(kind).map((t) => {
    if (t.key === 'self') {
      return {
        targetId: 'self', value: 'self', label: t.label, name: owner ? owner.name : entry.owner_id,
        kind: 'self', roleLabel: t.label, needsId: !!t.needsId, available: true,
      };
    }
    if (t.key === 'hq') {
      return { targetId: 'hq', value: 'hq', label: t.label, name: '总部', kind: 'hq', roleLabel: t.label, needsId: !!t.needsId, available: true };
    }
    if (t.key === 'other') {
      return { targetId: 'other', value: 'other', label: t.label, name: '', kind: 'other', roleLabel: t.label, needsId: true, available: true };
    }
    // 上级代理：解析出真实受益人，不存在则不可选
    const r = resolveSemanticTarget(db, entry, kind, t.key, null);
    return {
      targetId: t.key, value: t.key, label: t.label, name: r.ok ? r.name : '',
      kind: 'upline_agent', roleLabel: t.label, needsId: false, available: !!r.ok,
      unavailableReason: r.ok ? null : r.reason,
    };
  });
}

/**
 * 分配报价/校验（不落库）。
 *
 * targets 支持两种写法：
 *   ① 原型弹窗语义键：{ targetId:'self'|'city'|'province'|'county'|'hq'|'other', percent, agentId? }
 *      —— 语义键由 resolveTargets 解析成实际收款人；「其他代理」需带 agentId（手填 ID）
 *   ② 老契约：直接传用户 ID / 'HQ'（保持向后兼容）
 *
 * @param {object} opt { kind, targets:[{targetId, percent, kind?, agentId?}] }
 */
function quote(db, entry, { targets = [], kind = null } = {}) {
  const a = allocatable(db, entry);
  if (!a.ok) return { valid: false, errors: [a.reason], kind: a.kind || kind, rows: [], totalPercent: 0, amount: 0 };
  const useKind = internalKind(kind) || a.kind;
  const errors = [];
  const list = Array.isArray(targets) ? targets : [];
  if (!list.length) errors.push('至少指定 1 个分配对象');
  if (list.length > a.scheme.maxTargets) errors.push(`最多拆 ${a.scheme.maxTargets} 份`);
  const resolved = resolveTargets(db, entry, useKind, list);
  for (const e of resolved.errors) errors.push(e);
  const seen = new Set();
  let pct = 0;
  const rows = resolved.rows.map((r) => {
    const percent = Number(r.percent);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) errors.push(`比例需在 0–100 之间：${r.targetId}`);
    if (seen.has(r.targetId)) errors.push(`同一对象重复：${r.targetId}`);
    seen.add(r.targetId);
    pct += Number.isFinite(percent) ? percent : 0;
    return r;
  });
  if (Math.abs(pct - 100) > 0.01) errors.push(`分配比例合计须为 100%（当前 ${round2(pct)}%）`);
  return {
    kind: useKind,
    kindLabel: KIND_CN[useKind],
    entryId: entry.id,
    entryAmount: round2(entry.amount || 0),
    rows,
    totalPercent: round2(pct),
    totalAmount: round2(rows.reduce((s, r) => s + r.amount, 0)),
    valid: errors.length === 0,
    errors,
    maxTargets: a.scheme.maxTargets,
    settlementNote: '分配方案下个结算周期生效，生效前可撤销',
  };
}

/**
 * 报价单存取（前端提交时只带 quoteId，服务端据此还原分配方案）
 * · 报价单 TTL 10 分钟（与 allocation-quotes 出参 expiresAt 一致）
 * · 报价单只保存「方案」，不落账；真正分配仍在 submit 时校验并落库
 */
const QUOTE_TTL = 10 * 60 * 1000;

/** 保存报价单（返回 quoteId） */
function saveQuote(db, { id, entryId, userId, kind, targets, entryAmount, rows, totalPercent, totalAmount }) {
  ensure(db);
  const now = nowMs();
  // 清理过期报价单
  db.allocationQuotes = db.allocationQuotes.filter((q) => q.expiresAt > now);
  const quoteId = id || 'aq_' + (db.seq++);
  db.allocationQuotes.push({
    id: quoteId, entryId, userId, kind, targets, entryAmount, rows,
    totalPercent, totalAmount, expiresAt: now + QUOTE_TTL, createdAt: now,
  });
  return quoteId;
}

/** 读取报价单（过期返回 null） */
function getQuote(db, quoteId) {
  ensure(db);
  const q = db.allocationQuotes.find((x) => x.id === quoteId);
  if (!q) return null;
  if (q.expiresAt <= nowMs()) return null;
  return q;
}

/**
 * 提交分配方案（落库，状态 PENDING_SETTLEMENT）。
 * @param {object} db
 * @param {object} entry
 * @param {object} opt { targets, kind, idempotencyKey, operatorId, byAdmin }
 */
function submit(db, entry, { targets = [], kind = null, idempotencyKey = null, operatorId = null, byAdmin = false, quoteId = null } = {}) {
  ensure(db);
  if (idempotencyKey) {
    const dup = db.allocations.find((x) => x.idempotencyKey === idempotencyKey);
    if (dup) return { status: dup.status, allocationId: dup.id, duplicated: true, rows: dup.rows };
  }
  // 前端提交时可能只带 quoteId → 凭报价单还原分配方案
  let useTargets = targets;
  let useKind = kind;
  if ((!Array.isArray(useTargets) || !useTargets.length) && quoteId) {
    const q0 = getQuote(db, quoteId);
    if (!q0) throw new Error('报价已失效，请重新生成');
    if (q0.entryId !== entry.id) throw new Error('报价与收益记录不匹配');
    useTargets = q0.targets;
    useKind = useKind || q0.kind;
  }
  const q = quote(db, entry, { targets: useTargets, kind: useKind });
  if (!q.valid) throw new Error(q.errors.join('；'));
  const rec = {
    id: 'alc_' + (db.seq++),
    entryId: entry.id,
    userId: entry.owner_id,
    kind: q.kind,
    kindLabel: q.kindLabel,
    entryAmount: q.entryAmount,
    rows: q.rows,
    totalPercent: q.totalPercent,
    totalAmount: q.totalAmount,
    status: 'PENDING_SETTLEMENT',
    byAdmin: !!byAdmin,
    operatorId: operatorId || null,
    idempotencyKey: idempotencyKey || null,
    createdAt: nowMs(),
    settledAt: null,
  };
  db.allocations.push(rec);
  entry.allocationStatus = 'PENDING';
  entry.allocationId = rec.id;
  entry.allocationKind = rec.kind;
  entry.allocationRows = rec.rows;
  return { status: rec.status, allocationId: rec.id, rows: rec.rows, duplicated: false };
}

/** 撤销（结算前） */
function revoke(db, allocationId, { operatorId = null } = {}) {
  ensure(db);
  const rec = db.allocations.find((x) => x.id === allocationId);
  if (!rec) throw new Error('分配记录不存在');
  if (rec.status !== 'PENDING_SETTLEMENT') throw new Error('已结算的分配不可撤销');
  rec.status = 'REVOKED';
  rec.revokedAt = nowMs();
  rec.revokedBy = operatorId || null;
  const entry = db.commissions.find((c) => c.id === rec.entryId);
  if (entry) { entry.allocationStatus = 'NONE'; entry.allocationId = null; entry.allocationRows = null; }
  return rec;
}

/** 某笔明细的分配状态 */
function ofEntry(db, entryId) {
  ensure(db);
  return db.allocations.filter((x) => x.entryId === entryId).sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 结算：把 PENDING_SETTLEMENT 的分配方案拆成子佣金（幂等），父记录打 withhold。
 * @returns {{settled:number, commissions:Array}}
 */
function settle(db, { period = null } = {}) {
  ensure(db);
  const commissions = [];
  let settled = 0;
  for (const rec of db.allocations) {
    if (rec.status !== 'PENDING_SETTLEMENT') continue;
    const parent = db.commissions.find((c) => c.id === rec.entryId);
    if (!parent) continue;
    if (period && parent.period !== period) continue;
    for (const row of rec.rows) {
      const c = {
        id: `alc-${rec.id}-${row.targetId}`,
        owner_id: row.targetId,
        type: parent.type,
        subtype: `${parent.subtype || parent.type}_alloc`,
        period: parent.period,
        base_amount: rec.entryAmount,
        rate: row.percent / 100,
        amount: row.amount,
        ref_order_id: parent.ref_order_id || null,
        status: 'pending',
        note: `分配 ${rec.kindLabel}（${row.percent}% → ${row.name}）来自 ${parent.id}`,
        allocationFrom: parent.id,
        // 分配角色标记：结算后仍可追溯这笔钱是「巡查 5%」还是「销售 5%」分出去的
        allocationKind: rec.kind,
        allocationRoleLabel: row.roleLabel || '',
      };
      S.upsertCommission(db, c);
      commissions.push(c);
    }
    parent.withhold = true;              // 父记录不再计入可提现，改由子佣金承接
    parent.withdrawable = false;
    parent.allocationStatus = 'SETTLED';
    rec.status = 'SETTLED';
    rec.settledAt = nowMs();
    settled++;
  }
  return { settled, commissions };
}

module.exports = {
  KINDS, KIND_CN, TARGET_KINDS, SEMANTIC_TARGETS, SEMANTIC_TARGET_KEYS,
  ensure, scheme, updateScheme, kindOf, allocatable, candidates, quote, submit, revoke, ofEntry, settle,
  semanticTargets, resolveSemanticTarget, resolveTargets, findAgentByLevel,
  publicKind, internalKind, PUBLIC_KIND, INTERNAL_KIND,
  saveQuote, getQuote, QUOTE_TTL,
};
