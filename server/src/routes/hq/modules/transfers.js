/**
 * 脑商AI合伙人 · 总部后台 · HQ-21 转店（Transfers）
 *
 * 契约：《总部后台API需求文档.md》§23
 *
 * 库表对照：db.storeTransfers（既有、托管）+ db.hqTransfers（后台扩展字段）
 *
 * 关键口径：**双方同意 ≠ 已迁移**。
 * HQ 的 record-migration-receipt 只登记迁移回执，不在 HQ 前端执行迁移。
 */

const L = require('../lib');

const MODULE = 'transfers';
const CODE = 'HQ-21';
const TITLE = '转店';

const SIDE_APPROVAL = ['PENDING', 'APPROVED', 'REJECTED'];
const OVERALL_STATUS = ['PENDING', 'APPROVED', 'REJECTED'];
const MIGRATION_STATUS = ['NOT_STARTED', 'AWAITING_SERVER', 'RECEIPTED_SUCCESS', 'RECEIPTED_FAILED'];
const EXCEPTION_FLAG = ['NONE', 'FLAGGED'];

/** 计算综合状态：任一拒绝 → REJECTED；双同 → APPROVED；否则 PENDING */
function overallStatus(t) {
  const s = t.sourceApprovalStatus || 'PENDING';
  const g = t.targetApprovalStatus || 'PENDING';
  if (s === 'REJECTED' || g === 'REJECTED') return 'REJECTED';
  if (s === 'APPROVED' && g === 'APPROVED') return 'APPROVED';
  return 'PENDING';
}

function transferDto(t) {
  const os = t.status || overallStatus(t);
  return {
    applicationId: t.id,
    type: 'TRANSFER',
    memberId: t.memberId || null,
    memberName: t.memberName || null,
    displayId: t.displayId || null,
    applicantName: t.applicantName || null,
    reason: t.reason || null,
    sourceStoreId: t.sourceStoreId || null,
    sourceStoreName: t.sourceStoreName || null,
    targetStoreId: t.targetStoreId || null,
    targetStoreName: t.targetStoreName || null,
    sourceApprovalStatus: t.sourceApprovalStatus || 'PENDING',
    targetApprovalStatus: t.targetApprovalStatus || 'PENDING',
    status: os,
    migrationStatus: t.migrationStatus || 'NOT_STARTED',
    exceptionFlag: t.exceptionFlag || 'NONE',
    hqNote: t.hqNote || null,
    unusedTrainingLessons: Number(t.unusedTrainingLessons || 0),
    unusedSpecialLessons: Number(t.unusedSpecialLessons || 0),
    version: Number(t.version || 1),
    allowedActions: [
      ...(os === 'PENDING' ? ['force-reject'] : []),
      ...((t.exceptionFlag || 'NONE') === 'NONE' ? ['flag-exception'] : ['clear-exception']),
      'add-note',
      'record-migration-receipt',
    ],
  };
}

const routes = [
  // ── 申请分页 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/transfers',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const status = ctx.query.get('status') || '';
      const migrationStatus = ctx.query.get('migrationStatus') || '';
      let list = (ctx.db.storeTransfers || []).slice();
      if (keyword) list = list.filter((t) => L.matchKeyword(keyword, t.id, t.memberId, t.memberName, t.displayId));
      if (status) list = list.filter((t) => (t.status || overallStatus(t)) === status);
      if (migrationStatus) list = list.filter((t) => (t.migrationStatus || 'NOT_STARTED') === migrationStatus);
      list.sort((a, b) => String(b.id).localeCompare(String(a.id)));
      const all = ctx.db.storeTransfers || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(transferDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        pending: all.filter((t) => (t.status || overallStatus(t)) === 'PENDING').length,
        awaitingMigration: all.filter((t) => (t.migrationStatus || 'NOT_STARTED') === 'AWAITING_SERVER').length,
      });
    },
  },

  // ── 门店/状态/pendingPolicy 目录 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/transfers/catalog',
    async handler(ctx) {
      const stores = [];
      const seen = new Set();
      for (const cs of ctx.db.coStores || []) {
        if (cs.store_id && !seen.has(cs.store_id)) {
          seen.add(cs.store_id);
          stores.push({ storeId: cs.store_id, name: cs.store_name || cs.store_id });
        }
      }
      for (const s of ctx.db.hqStores || []) {
        if (!seen.has(s.storeId)) {
          seen.add(s.storeId);
          stores.push({ storeId: s.storeId, name: s.name });
        }
      }
      return {
        stores,
        sideApprovalStatuses: SIDE_APPROVAL.map((s) => ({ value: s, label: s })),
        overallStatuses: OVERALL_STATUS.map((s) => ({ value: s, label: s })),
        migrationStatuses: MIGRATION_STATUS.map((s) => ({ value: s, label: s })),
        exceptionFlags: EXCEPTION_FLAG.map((s) => ({ value: s, label: s })),
        pendingPolicy: {
          unusedTrainingLessons: '申请时剩余常规课时快照；仅作展示，实际结算口径以财务确认为准',
          unusedSpecialLessons: '申请时剩余专项课时快照；仅作展示，实际结算口径以财务确认为准',
          followUpOrders: '迁移后由原门店产生的后续订单归属，需双方门店在系统内二次确认',
          historicalFeedback: '历史培训反馈与课后记录随会员档案保留，不随门店迁移',
          unsettledRevenue: '未结算收益不随转店转移，仍归属原门店及其上级代理',
        },
        summary: { total: (ctx.db.storeTransfers || []).length },
      };
    },
  },

  // ── 详情 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/transfers/:applicationId',
    async handler(ctx) {
      const t = (ctx.db.storeTransfers || []).find((x) => x.id === ctx.params.applicationId);
      if (!t) throw L.err(L.ERR.NOT_FOUND, '转店申请不存在：' + ctx.params.applicationId);
      const audit = (ctx.db.hqAuditLogs || []).filter((a) => a.module === MODULE && a.targetId === t.id).slice(0, 20);
      return { transfer: transferDto(t), audit };
    },
  },

  // ── HQ 监管写操作 ──
  {
    module: MODULE,
    method: 'POST',
    path: '/transfers/:applicationId/mutate',
    async handler(ctx) {
      const { action, version } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['force-reject', 'flag-exception', 'clear-exception', 'add-note', 'record-migration-receipt'], 'action');
      const t = (ctx.db.storeTransfers || []).find((x) => x.id === ctx.params.applicationId);
      if (!t) throw L.err(L.ERR.NOT_FOUND, '转店申请不存在：' + ctx.params.applicationId);
      L.checkVersion(ctx, t, version, '转店申请');
      const before = {
        status: t.status || overallStatus(t),
        exceptionFlag: t.exceptionFlag || 'NONE',
        migrationStatus: t.migrationStatus || 'NOT_STARTED',
        hqNote: t.hqNote || null,
      };

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'force-reject') {
          if ((t.status || overallStatus(t)) === 'REJECTED') throw L.err(L.ERR.INVALID_STATE, '该申请已被拒绝');
          t.status = 'REJECTED';
          t.sourceApprovalStatus = 'REJECTED';
          t.targetApprovalStatus = 'REJECTED';
          t.forceRejectedAt = L.nowIso();
        } else if (action === 'flag-exception') {
          if ((t.exceptionFlag || 'NONE') === 'FLAGGED') throw L.err(L.ERR.INVALID_STATE, '该申请已标记异常');
          t.exceptionFlag = 'FLAGGED';
          t.exceptionReason = reason;
          t.flaggedAt = L.nowIso();
        } else if (action === 'clear-exception') {
          if ((t.exceptionFlag || 'NONE') !== 'FLAGGED') throw L.err(L.ERR.INVALID_STATE, '该申请未标记异常');
          t.exceptionFlag = 'NONE';
          t.exceptionReason = null;
          t.clearedAt = L.nowIso();
        } else if (action === 'add-note') {
          L.requireFields(ctx.body, ['note']);
          t.hqNote = String(ctx.body.note);
        } else if (action === 'record-migration-receipt') {
          L.requireFields(ctx.body, ['receipt']);
          L.ensureEnum(ctx.body.receipt, ['SUCCESS', 'FAILED'], 'receipt');
          // 双侧均同意后才允许登记迁移回执
          if ((t.status || overallStatus(t)) !== 'APPROVED') {
            throw L.err(L.ERR.INVALID_STATE, '双方同意后方可登记迁移回执');
          }
          t.migrationStatus = ctx.body.receipt === 'SUCCESS' ? 'RECEIPTED_SUCCESS' : 'RECEIPTED_FAILED';
          t.migrationReceipt = ctx.body.receipt;
          t.migrationReceiptNote = ctx.body.receiptNote || null;
          t.migrationReceiptAt = L.nowIso();
        }
        L.bumpVersion(t);
        L.audit(ctx.db, {
          module: MODULE, action, targetId: t.id, operator: ctx.operator, reason,
          before,
          after: {
            status: t.status || overallStatus(t),
            exceptionFlag: t.exceptionFlag || 'NONE',
            migrationStatus: t.migrationStatus || 'NOT_STARTED',
            hqNote: t.hqNote || null,
          },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { transfer: transferDto(t), operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, transferDto };
