/**
 * 脑商AI合伙人 · 总部后台 · HQ-16 收益（Revenue）
 *
 * 契约：《总部后台API需求文档.md》§18
 *
 * 库表对照：
 *   - 收益账户（后台专属）：db.hqRevenueAccounts
 *   - 收益流水（既有、托管）：db.commissions（权威收益台账）
 *
 * 设计：账户余额从 db.commissions 实时汇总（佣金台账是唯一真源），
 *      调账动作写入一条 commissions 记录（type='hq_adjust'），保证流水与余额自洽。
 * 金额单位：元。
 */

const L = require('../lib');

const MODULE = 'revenue';
const CODE = 'HQ-16';
const TITLE = '收益';

const BIZ_TYPES = ['supply', 'parity', 'global', 'founding', 'agent', 'costore', 'product', 'hq_adjust'];

/** 从佣金台账汇总某主体的收益 */
function summarizeByOwner(db, ownerId) {
  const rows = (db.commissions || []).filter((c) => c.owner_id === ownerId);
  let available = 0;
  let frozen = 0;
  let totalEarned = 0;
  for (const c of rows) {
    const amt = Number(c.amount || 0);
    totalEarned += amt;
    if (c.status === 'frozen' || c.status === 'pending') frozen += amt;
    else available += amt;
  }
  return { available: L.money(available), frozen: L.money(frozen), totalEarned: L.money(totalEarned), rows };
}

function accountDto(db, a) {
  const s = summarizeByOwner(db, a.ownerId || a.accountId);
  // 后台显式冻结额优先；未设置过时回落到台账中 pending/frozen 的金额
  const manualFrozen = a.frozenBalance == null ? null : L.money(a.frozenBalance);
  const frozenBalance = manualFrozen == null ? s.frozen : manualFrozen;
  const availableBalance = manualFrozen == null ? s.available : L.money(s.available - manualFrozen);
  return {
    revenueAccountId: a.id,
    ownerAccountId: a.ownerId || a.accountId,
    availableBalance,
    frozenBalance,
    totalEarned: s.totalEarned,
    version: Number(a.version || 1),
  };
}

function ledgerDto(c) {
  return {
    ledgerId: c.id,
    ownerAccountId: c.owner_id,
    amount: L.money(c.amount || 0),
    bizType: c.type || (c.subtype ? 'product' : 'unknown'),
    subtype: c.subtype || null,
    orderId: c.ref_order_id || null,
    period: c.period || null,
    status: c.status || 'pending',
    formula: c.formula || null,
    occurredAt: L.toIso(c.at || c.createdAt),
  };
}

const routes = [
  // ── 收益账户分页 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/revenue/accounts',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      // 账户集合优先；没有则从佣金台账反推有收益的主体
      let accounts = (ctx.db.hqRevenueAccounts || []).slice();
      if (!accounts.length) {
        const ids = new Set((ctx.db.commissions || []).map((c) => c.owner_id).filter(Boolean));
        accounts = [...ids].map((id) => ({ id: `hqra_${id}`, ownerId: id, frozenBalance: 0, version: 1 }));
      }
      if (keyword) accounts = accounts.filter((a) => L.matchKeyword(keyword, a.id, a.ownerId));
      accounts.sort((a, b) => String(a.ownerId).localeCompare(String(b.ownerId)));
      const items = accounts.slice(paging.offset, paging.offset + paging.pageSize).map((a) => accountDto(ctx.db, a));
      return L.listData(items, accounts.length, paging.page, paging.pageSize, {
        total: accounts.length,
        totalEarned: L.money(items.reduce((a, x) => a + x.totalEarned, 0)),
      });
    },
  },

  // ── 目录 / 汇总 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/revenue/catalog',
    async handler(ctx) {
      const byType = {};
      for (const c of ctx.db.commissions || []) {
        const t = c.type || 'unknown';
        byType[t] = L.money((byType[t] || 0) + Number(c.amount || 0));
      }
      return {
        bizTypes: BIZ_TYPES.map((t) => ({ value: t, label: t })),
        byType,
        summary: {
          total: (ctx.db.commissions || []).length,
          totalAmount: L.money((ctx.db.commissions || []).reduce((a, c) => a + Number(c.amount || 0), 0)),
        },
      };
    },
  },

  // ── 全量流水分页 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/revenue/ledgers',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const ownerId = ctx.query.get('ownerId') || '';
      const bizType = ctx.query.get('bizType') || '';
      const period = ctx.query.get('period') || '';
      const from = ctx.query.get('from') || '';
      const to = ctx.query.get('to') || '';

      let list = (ctx.db.commissions || []).slice();
      if (ownerId) list = list.filter((c) => c.owner_id === ownerId);
      if (bizType) list = list.filter((c) => (c.type || (c.subtype ? 'product' : 'unknown')) === bizType);
      if (period) list = list.filter((c) => c.period === period);
      if (from) list = list.filter((c) => new Date(c.at || c.createdAt || 0).getTime() >= new Date(from).getTime());
      if (to) list = list.filter((c) => new Date(c.at || c.createdAt || 0).getTime() <= new Date(to).getTime());
      list.sort((a, b) => new Date(b.at || b.createdAt || 0) - new Date(a.at || a.createdAt || 0));

      const all = ctx.db.commissions || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(ledgerDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        totalAmount: L.money(all.reduce((a, c) => a + Number(c.amount || 0), 0)),
      });
    },
  },

  // ── 账户详情 + 流水 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/revenue/accounts/:accountId',
    async handler(ctx) {
      const ownerId = ctx.params.accountId;
      const acct = (ctx.db.hqRevenueAccounts || []).find((a) => a.ownerId === ownerId || a.id === ownerId);
      const base = acct || { id: `hqra_${ownerId}`, ownerId, frozenBalance: 0, version: 1 };
      const rows = (ctx.db.commissions || []).filter((c) => c.owner_id === ownerId);
      return {
        account: accountDto(ctx.db, base),
        ledgers: rows.map(ledgerDto),
      };
    },
  },

  // ── 调账 / 冻结 ──
  {
    module: MODULE,
    method: 'POST',
    path: '/revenue/mutate',
    async handler(ctx) {
      const { action } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['adjust', 'freeze', 'unfreeze'], 'action');
      L.ensureCollections(ctx.db);

      return L.withIdempotency(ctx, () => {
        L.requireFields(ctx.body, ['ownerId']);
        const ownerId = String(ctx.body.ownerId);
        if (!ctx.db.users[ownerId]) throw L.err(L.ERR.NOT_FOUND, '主体不存在：' + ownerId);
        let acct = (ctx.db.hqRevenueAccounts || []).find((a) => a.ownerId === ownerId);
        if (!acct) {
          acct = { id: L.nextId(ctx.db, 'hqra'), ownerId, frozenBalance: 0, version: 1, createdAt: L.nowIso() };
          ctx.db.hqRevenueAccounts.push(acct);
        }
        L.checkVersion(ctx, acct, ctx.body.version, '收益账户');
        const before = { frozenBalance: L.money(acct.frozenBalance || 0) };
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'adjust') {
          L.requireFields(ctx.body, ['delta']);
          const delta = L.money(ctx.body.delta);
          if (delta === 0) throw L.err(L.ERR.INVALID_INPUT, 'delta 不能为 0');
          // 调账写一条佣金台账记录，保证「流水 = 余额」自洽
          ctx.db.commissions = ctx.db.commissions || [];
          ctx.db.commissions.push({
            id: L.nextId(ctx.db, 'c'),
            owner_id: ownerId,
            type: 'hq_adjust',
            subtype: 'manual_adjust',
            base_amount: Math.abs(delta),
            rate: null,
            amount: delta,
            period: L.nowIso().slice(0, 7),
            status: 'settled',
            formula: `总部调账 ${delta > 0 ? '+' : ''}${delta}（${reason}）`,
            ref_order_id: null,
            at: L.nowMs(),
          });
        } else if (action === 'freeze') {
          L.requireFields(ctx.body, ['amount']);
          const amt = L.money(ctx.body.amount);
          if (amt <= 0) throw L.err(L.ERR.INVALID_INPUT, '冻结金额必须大于 0');
          acct.frozenBalance = L.money(Number(acct.frozenBalance || 0) + amt);
        } else if (action === 'unfreeze') {
          L.requireFields(ctx.body, ['amount']);
          const amt = L.money(ctx.body.amount);
          if (amt <= 0) throw L.err(L.ERR.INVALID_INPUT, '解冻金额必须大于 0');
          acct.frozenBalance = L.money(Math.max(0, Number(acct.frozenBalance || 0) - amt));
        }
        L.bumpVersion(acct);
        L.audit(ctx.db, {
          module: MODULE, action, targetId: acct.id, operator: ctx.operator, reason,
          before, after: { frozenBalance: L.money(acct.frozenBalance || 0) },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { account: accountDto(ctx.db, acct), operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, accountDto, ledgerDto };
