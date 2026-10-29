/**
 * 脑商AI合伙人 · 总部后台 · HQ-10 配额（Quotas）
 *
 * 契约：《总部后台API需求文档.md》§12
 *
 * 库表对照：
 *   - 名额台账（既有）：db.quotaLedger（partnerId → { standard, activity[] }）
 *   - 名额流水（既有）：db.quota_transactions
 *   - 配额账户（后台专属）：db.hqQuotaAccounts（余额视图 + 冻结态）
 *
 * 配额调整会同步写入既有 quotaLedger / quota_transactions，
 * 由既有同步器镜像进 MySQL（quota_ledger / quota_transactions 是托管表）。
 */

const L = require('../lib');

const MODULE = 'quotas';
const CODE = 'HQ-10';
const TITLE = '配额';

/** 读取某主体的配额账户视图 */
function readAccount(db, quotaId) {
  const acct = (db.hqQuotaAccounts || []).find((q) => q.quotaId === quotaId);
  if (acct) return acct;
  // 兜底：从既有 quotaLedger 构造只读视图
  const ledger = (db.quotaLedger || {})[quotaId];
  if (!ledger) return null;
  const standard = Number(ledger.standard || 0);
  const activity = Array.isArray(ledger.activity) ? ledger.activity : [];
  return {
    quotaId,
    ownerId: quotaId,
    ownerType: 'partner',
    standard,
    activityTotal: activity.reduce((a, x) => a + Number(x.qty || 0), 0),
    frozen: 0,
    status: 'ACTIVE',
    version: 1,
    createdAt: null,
  };
}

function accountDto(a) {
  const total = Number(a.standard || 0) + Number(a.activityTotal || 0);
  return {
    quotaId: a.quotaId,
    ownerId: a.ownerId || a.quotaId,
    ownerType: a.ownerType || 'partner',
    standard: Number(a.standard || 0),
    activityTotal: Number(a.activityTotal || 0),
    total,
    frozen: Number(a.frozen || 0),
    available: total - Number(a.frozen || 0),
    status: a.status || 'ACTIVE',
    version: Number(a.version || 1),
    allowedActions: a.status === 'FROZEN' ? ['unfreeze', 'adjust'] : ['freeze', 'adjust'],
  };
}

const routes = [
  // ── 配额账户列表 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/quotas',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const status = ctx.query.get('status') || '';

      // 汇总：hqQuotaAccounts 优先，缺失的用 quotaLedger 补
      const ids = new Set();
      for (const q of ctx.db.hqQuotaAccounts || []) ids.add(q.quotaId);
      for (const k of Object.keys(ctx.db.quotaLedger || {})) ids.add(k);

      let list = [...ids].map((id) => readAccount(ctx.db, id)).filter(Boolean);
      if (keyword) list = list.filter((a) => L.matchKeyword(keyword, a.quotaId, a.ownerId));
      if (status) list = list.filter((a) => (a.status || 'ACTIVE') === status);
      list.sort((a, b) => String(a.quotaId).localeCompare(String(b.quotaId)));

      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(accountDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: list.length,
        totalQuota: list.reduce((a, x) => a + Number(x.standard || 0) + Number(x.activityTotal || 0), 0),
        frozenQuota: list.reduce((a, x) => a + Number(x.frozen || 0), 0),
      });
    },
  },

  // ── 目录 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/quotas/catalog',
    async handler(ctx) {
      return {
        ownerTypes: [
          { value: 'partner', label: '合伙人' },
          { value: 'store', label: '门店' },
          { value: 'agent', label: '区域代理' },
        ],
        actions: [
          { value: 'adjust', label: '调增/调减' },
          { value: 'freeze', label: '冻结' },
          { value: 'unfreeze', label: '解冻' },
        ],
        summary: { total: Object.keys(ctx.db.quotaLedger || {}).length },
      };
    },
  },

  // ── 详情 + 流水 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/quotas/:quotaId',
    async handler(ctx) {
      const a = readAccount(ctx.db, ctx.params.quotaId);
      if (!a) throw L.err(L.ERR.NOT_FOUND, '配额账户不存在：' + ctx.params.quotaId);
      const transactions = (ctx.db.quota_transactions || []).filter((t) => t.partnerId === ctx.params.quotaId);
      const ledger = (ctx.db.quotaLedger || {})[ctx.params.quotaId] || null;
      return { account: accountDto(a), ledger, transactions };
    },
  },

  // ── 调增/调减/冻结 ──
  {
    module: MODULE,
    method: 'POST',
    path: '/quotas/:quotaId/mutate',
    async handler(ctx) {
      const { action, delta, version } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['adjust', 'freeze', 'unfreeze'], 'action');
      const quotaId = ctx.params.quotaId;

      // 确保有后台账户记录（否则从 quotaLedger 派生）
      L.ensureCollections(ctx.db);
      let acct = (ctx.db.hqQuotaAccounts || []).find((q) => q.quotaId === quotaId);
      if (!acct) {
        const derived = readAccount(ctx.db, quotaId);
        if (!derived) throw L.err(L.ERR.NOT_FOUND, '配额账户不存在：' + quotaId);
        acct = {
          quotaId,
          ownerId: derived.ownerId || quotaId,
          ownerType: derived.ownerType || 'partner',
          standard: Number(derived.standard || 0),
          activityTotal: Number(derived.activityTotal || 0),
          frozen: 0,
          status: 'ACTIVE',
          version: 1,
          createdAt: L.nowIso(),
        };
        ctx.db.hqQuotaAccounts.push(acct);
      }
      L.checkVersion(ctx, acct, version, '配额账户');
      const before = { standard: acct.standard, activityTotal: acct.activityTotal, frozen: acct.frozen, status: acct.status };

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'adjust') {
          if (delta === undefined || delta === null) throw L.err(L.ERR.INVALID_INPUT, 'adjust 需要 delta（可为负）');
          const d = Number(delta);
          if (!Number.isFinite(d) || d === 0) throw L.err(L.ERR.INVALID_INPUT, 'delta 必须是非零数字');
          if (d < 0) {
            const pool = Number(acct.standard || 0) + Number(acct.activityTotal || 0);
            if (-d > pool) throw L.err(L.ERR.QUOTA_EXCEEDED, '配额余额不足，无法调减');
          }
          // 调增/调减统一作用在标准桶；活动桶不参与后台直接调整
          acct.standard = Number(acct.standard || 0) + d;          // 同步写入既有名额台账与流水（经同步器进 MySQL）
          const ledger = ctx.db.quotaLedger[quotaId] || (ctx.db.quotaLedger[quotaId] = { standard: 0, activity: [] });
          ledger.standard = Number(acct.standard || 0);
          ctx.db.quota_transactions = ctx.db.quota_transactions || [];
          ctx.db.quota_transactions.push({
            id: L.nextId(ctx.db, 'qt'),
            type: d > 0 ? 'grant' : 'consume',
            partnerId: quotaId,
            kind: 'hq_adjust',
            qty: Math.abs(d),
            operatorId: ctx.operator ? ctx.operator.adminId : 'admin',
            ref: operationId,
            at: L.nowMs(),
          });
        } else if (action === 'freeze') {
          if (acct.status === 'FROZEN') throw L.err(L.ERR.INVALID_STATE, '该配额账户已冻结');
          L.requireFields(ctx.body, ['frozenAmount']);
          const fa = Number(ctx.body.frozenAmount);
          if (!Number.isFinite(fa) || fa <= 0) throw L.err(L.ERR.INVALID_INPUT, 'frozenAmount 必须是正数');
          const pool = Number(acct.standard || 0) + Number(acct.activityTotal || 0);
          if (fa > pool) throw L.err(L.ERR.QUOTA_EXCEEDED, '冻结数量超过可用配额');
          acct.frozen = Number(acct.frozen || 0) + fa;
          acct.status = 'FROZEN';
        } else if (action === 'unfreeze') {
          if (acct.status !== 'FROZEN') throw L.err(L.ERR.INVALID_STATE, '该配额账户未冻结');
          const fa = ctx.body.frozenAmount == null ? acct.frozen : Number(ctx.body.frozenAmount);
          if (!Number.isFinite(fa) || fa < 0) throw L.err(L.ERR.INVALID_INPUT, 'frozenAmount 必须是非负数');
          acct.frozen = Math.max(0, Number(acct.frozen || 0) - fa);
          if (acct.frozen === 0) acct.status = 'ACTIVE';
        }
        L.bumpVersion(acct);
        L.audit(ctx.db, {
          module: MODULE, action, targetId: quotaId, operator: ctx.operator, reason,
          before, after: { standard: acct.standard, activityTotal: acct.activityTotal, frozen: acct.frozen, status: acct.status },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { account: accountDto(acct), operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, accountDto };
