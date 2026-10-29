/**
 * 脑商AI合伙人 · 总部后台 · HQ-17 提现（Withdrawals）
 *
 * 契约：《总部后台API需求文档.md》§19
 *
 * 库表对照：db.withdrawals（既有、托管）
 * 金额单位：元。手续费 0.6%、最低 1 元（与既有实现口径一致）。
 * 敏感：银行卡号/收款账号列表脱敏。
 */

const L = require('../lib');

const MODULE = 'withdrawals';
const CODE = 'HQ-17';
const TITLE = '提现';

const WITHDRAW_STATUS = ['PENDING', 'APPROVED', 'REJECTED', 'PAID', 'FAILED'];

/** 状态映射（库里可能是 pending/approved/rejected/paid/failed） */
function toEnumStatus(w) {
  const s = String(w.status || 'pending').toLowerCase();
  const map = {
    pending: 'PENDING', applying: 'PENDING', submitted: 'PENDING',
    approved: 'APPROVED', pass: 'APPROVED',
    rejected: 'REJECTED', refuse: 'REJECTED',
    paid: 'PAID', done: 'PAID',
    failed: 'FAILED',
  };
  return map[s] || 'PENDING';
}

function withdrawalDto(w, opts) {
  const mask = !(opts && opts.reveal);
  const status = toEnumStatus(w);
  const amount = L.money(w.amount || 0);
  const fee = L.money(w.fee != null ? w.fee : Math.max(1, amount * 0.006));
  return {
    withdrawalId: w.id,
    accountId: w.userId || w.accountId || null,
    amount,
    fee,
    actualAmount: L.money(amount - fee),
    status,
    channel: w.channel || 'bank',
    bankAccountMask: mask
      ? L.maskTail(w.account || w.bankAccount || w.payeeAccount)
      : (w.account || w.bankAccount || w.payeeAccount || null),
    accountName: w.accountName || w.name || null,
    rejectReason: w.rejectReason || w.reason || null,
    createdAt: L.toIso(w.createdAt || w.created_at),
    paidAt: L.toIso(w.paidAt),
    version: Number(w.version || 1),
    allowedActions:
      status === 'PENDING' ? ['approve', 'reject']
        : (status === 'APPROVED' ? ['mark-paid', 'mark-failed'] : []),
  };
}

const routes = [
  // ── 提现单分页 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/withdrawals',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const status = ctx.query.get('status') || '';
      const accountId = ctx.query.get('accountId') || '';
      let list = (ctx.db.withdrawals || []).slice();
      if (keyword) list = list.filter((w) => L.matchKeyword(keyword, w.id, w.userId, w.accountName));
      if (status) list = list.filter((w) => toEnumStatus(w) === status);
      if (accountId) list = list.filter((w) => (w.userId || w.accountId) === accountId);
      list.sort((a, b) => new Date(b.createdAt || b.created_at || 0) - new Date(a.createdAt || a.created_at || 0));
      const all = ctx.db.withdrawals || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map((w) => withdrawalDto(w));
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        pending: all.filter((w) => toEnumStatus(w) === 'PENDING').length,
        pendingAmount: L.money(all.filter((w) => toEnumStatus(w) === 'PENDING')
          .reduce((a, w) => a + Number(w.amount || 0), 0)),
      });
    },
  },

  // ── 状态目录与汇总 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/withdrawals/catalog',
    async handler(ctx) {
      const all = ctx.db.withdrawals || [];
      const byStatus = {};
      for (const w of all) {
        const s = toEnumStatus(w);
        byStatus[s] = (byStatus[s] || 0) + 1;
      }
      return {
        statuses: WITHDRAW_STATUS.map((s) => ({ value: s, label: s, count: byStatus[s] || 0 })),
        channels: [
          { value: 'bank', label: '银行卡' },
          { value: 'wechat', label: '微信' },
          { value: 'alipay', label: '支付宝' },
        ],
        summary: {
          total: all.length,
          totalAmount: L.money(all.reduce((a, w) => a + Number(w.amount || 0), 0)),
        },
      };
    },
  },

  // ── 详情 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/withdrawals/:withdrawalId',
    async handler(ctx) {
      const w = (ctx.db.withdrawals || []).find((x) => x.id === ctx.params.withdrawalId);
      if (!w) throw L.err(L.ERR.NOT_FOUND, '提现单不存在：' + ctx.params.withdrawalId);
      const audit = (ctx.db.hqAuditLogs || []).filter((a) => a.module === MODULE && a.targetId === w.id).slice(0, 20);
      return { withdrawal: withdrawalDto(w, { reveal: true }), audit };
    },
  },

  // ── 审核通过 / 拒绝 / 打款回执 ──
  {
    module: MODULE,
    method: 'POST',
    path: '/withdrawals/:withdrawalId/mutate',
    async handler(ctx) {
      const { action, version } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['approve', 'reject', 'mark-paid', 'mark-failed'], 'action');
      const w = (ctx.db.withdrawals || []).find((x) => x.id === ctx.params.withdrawalId);
      if (!w) throw L.err(L.ERR.NOT_FOUND, '提现单不存在：' + ctx.params.withdrawalId);
      L.checkVersion(ctx, w, version, '提现单');
      const before = { status: toEnumStatus(w) };

      return L.withIdempotency(ctx, () => {
        const status = toEnumStatus(w);
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'approve') {
          if (status !== 'PENDING') throw L.err(L.ERR.INVALID_STATE, '仅待审核的提现单可通过');
          w.status = 'approved';
          w.approvedAt = L.nowIso();
          w.approvedBy = ctx.operator ? ctx.operator.adminId : 'admin';
        } else if (action === 'reject') {
          if (status !== 'PENDING') throw L.err(L.ERR.INVALID_STATE, '仅待审核的提现单可拒绝');
          L.requireFields(ctx.body, ['rejectionReason']);
          w.status = 'rejected';
          w.rejectReason = String(ctx.body.rejectionReason);
          w.reviewReason = reason;
          w.reviewedAt = L.nowIso();
          w.reviewedBy = ctx.operator ? ctx.operator.adminId : 'admin';
        } else if (action === 'mark-paid') {
          if (status !== 'APPROVED') throw L.err(L.ERR.INVALID_STATE, '仅已通过的提现单可标记打款');
          w.status = 'paid';
          w.paidAt = L.nowIso();
          w.transactionId = ctx.body.transactionId || w.transactionId || null;
        } else if (action === 'mark-failed') {
          if (status !== 'APPROVED') throw L.err(L.ERR.INVALID_STATE, '仅已通过的提现单可标记失败');
          w.status = 'failed';
          w.failedAt = L.nowIso();
          w.failReason = reason;
        }
        L.bumpVersion(w);
        L.audit(ctx.db, {
          module: MODULE, action, targetId: w.id, operator: ctx.operator, reason,
          before, after: { status: toEnumStatus(w) }, requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { withdrawal: withdrawalDto(w), operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, withdrawalDto };
