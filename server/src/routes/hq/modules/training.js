/**
 * 脑商AI合伙人 · 总部后台 · HQ-20 培训课时（Training）
 *
 * 契约：《总部后台API需求文档.md》§22
 *
 * 库表对照：
 *   - 课时余额（后台专属）：db.hqTrainingBalances
 *   - 既有课时（业务侧）：db.members[].training（trainingTotal/trainingUsed/specialTotal/specialUsed）
 *   - 反馈（既有、托管）：db.trainingFeedback
 *
 * 课时是**整数课时**，不是金额。
 */

const L = require('../lib');

const MODULE = 'training';
const CODE = 'HQ-20';
const TITLE = '培训课时';

const BUCKETS = ['TRAINING', 'SPECIAL'];
const FEEDBACK_KINDS = ['COURSE', 'CAMP', 'HOME', 'OTHER'];
const FEEDBACK_STATUS = ['PENDING', 'PROXIED', 'WITHDRAWN'];

function balanceDto(b) {
  return {
    memberId: b.memberId,
    accountId: b.accountId || null,
    storeId: b.storeId || null,
    storeName: b.storeName || null,
    trainingRemaining: Number(b.trainingRemaining || 0),
    specialRemaining: Number(b.specialRemaining || 0),
    trainingTotal: Number(b.trainingTotal || 0),
    trainingUsed: Number(b.trainingUsed || 0),
    specialTotal: Number(b.specialTotal || 0),
    specialUsed: Number(b.specialUsed || 0),
    version: Number(b.version || 1),
  };
}

function feedbackDto(f) {
  return {
    feedbackId: f.id,
    memberId: f.memberId || null,
    kind: f.kind || 'COURSE',
    title: f.title || '',
    body: f.body || '',
    status: f.status || 'PENDING',
    proxy: !!f.proxy,
    createdAt: L.toIso(f.createdAt),
    version: Number(f.version || 1),
  };
}

const routes = [
  // ── 会员课时余额分页 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/training/balances',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const storeId = ctx.query.get('storeId') || '';
      let list = (ctx.db.hqTrainingBalances || []).slice();
      if (keyword) list = list.filter((b) => L.matchKeyword(keyword, b.memberId, b.accountId, b.storeName));
      if (storeId) list = list.filter((b) => b.storeId === storeId);
      list.sort((a, b) => String(a.memberId).localeCompare(String(b.memberId)));
      const all = ctx.db.hqTrainingBalances || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(balanceDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        trainingRemaining: all.reduce((a, b) => a + Number(b.trainingRemaining || 0), 0),
        specialRemaining: all.reduce((a, b) => a + Number(b.specialRemaining || 0), 0),
      });
    },
  },

  // ── 反馈分页 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/training/feedback',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const status = ctx.query.get('status') || '';
      const kind = ctx.query.get('kind') || '';
      let list = (ctx.db.trainingFeedback || []).slice();
      if (status) list = list.filter((f) => (f.status || 'PENDING') === status);
      if (kind) list = list.filter((f) => (f.kind || 'COURSE') === kind);
      list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      const all = ctx.db.trainingFeedback || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(feedbackDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, { total: all.length });
    },
  },

  // ── 目录 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/training/catalog',
    async handler(ctx) {
      const stores = [];
      const seen = new Set();
      for (const m of ctx.db.members || []) {
        if (m.storeId && !seen.has(m.storeId)) {
          seen.add(m.storeId);
          stores.push({ storeId: m.storeId, name: m.storeName || m.storeId });
        }
      }
      return {
        stores,
        buckets: BUCKETS.map((b) => ({ value: b, label: b === 'TRAINING' ? '常规课时' : '专项课时' })),
        feedbackKinds: FEEDBACK_KINDS.map((k) => ({ value: k, label: k })),
        feedbackStatuses: FEEDBACK_STATUS.map((s) => ({ value: s, label: s })),
        summary: {
          balances: (ctx.db.hqTrainingBalances || []).length,
          feedback: (ctx.db.trainingFeedback || []).length,
        },
      };
    },
  },

  // ── 会员余额 + 消耗 + 反馈详情 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/training/members/:memberId',
    async handler(ctx) {
      const memberId = ctx.params.memberId;
      const member = (ctx.db.members || []).find((m) => m.id === memberId);
      if (!member) throw L.err(L.ERR.NOT_FOUND, '会员不存在：' + memberId);
      const acct = (ctx.db.hqTrainingBalances || []).find((b) => b.memberId === memberId);
      const t = (member.training || {});
      const balance = acct || {
        memberId,
        accountId: member.userId,
        storeId: member.storeId || null,
        trainingTotal: Number(t.trainingTotal || 0),
        trainingUsed: Number(t.trainingUsed || 0),
        trainingRemaining: Math.max(0, Number(t.trainingTotal || 0) - Number(t.trainingUsed || 0)),
        specialTotal: Number(t.specialTotal || 0),
        specialUsed: Number(t.specialUsed || 0),
        specialRemaining: Math.max(0, Number(t.specialTotal || 0) - Number(t.specialUsed || 0)),
        version: 1,
      };
      const feedback = (ctx.db.trainingFeedback || []).filter((f) => f.memberId === memberId);
      const progress = (ctx.db.learningProgress || []).filter((p) => p.memberId === memberId);
      return { balance: balanceDto(balance), feedback: feedback.map(feedbackDto), progress };
    },
  },

  // ── proxy-feedback / withdraw-feedback / consume-lessons ──
  {
    module: MODULE,
    method: 'POST',
    path: '/training/mutate',
    async handler(ctx) {
      const { action } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['proxy-feedback', 'withdraw-feedback', 'consume-lessons'], 'action');
      L.ensureCollections(ctx.db);

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'proxy-feedback') {
          L.requireFields(ctx.body, ['memberId', 'kind', 'title']);
          L.ensureEnum(ctx.body.kind, FEEDBACK_KINDS, 'kind');
          const member = (ctx.db.members || []).find((m) => m.id === ctx.body.memberId);
          if (!member) throw L.err(L.ERR.NOT_FOUND, '会员不存在：' + ctx.body.memberId);
          const rec = {
            id: L.nextId(ctx.db, 'tfb'),
            memberId: ctx.body.memberId,
            accountId: member.userId,
            kind: ctx.body.kind,
            title: String(ctx.body.title),
            body: ctx.body.body || '',
            status: 'PROXIED',
            proxy: true,
            proxyReason: reason,
            createdAt: L.nowIso(),
            version: 1,
          };
          ctx.db.trainingFeedback.push(rec);
          L.audit(ctx.db, {
            module: MODULE, action, targetId: rec.id, operator: ctx.operator, reason,
            before: null, after: rec, requestId: ctx.requestId, id: operationId,
          });
          ctx.save();
          return { feedback: feedbackDto(rec), operationId };
        }

        if (action === 'withdraw-feedback') {
          L.requireFields(ctx.body, ['feedbackId']);
          const f = (ctx.db.trainingFeedback || []).find((x) => x.id === ctx.body.feedbackId);
          if (!f) throw L.err(L.ERR.NOT_FOUND, '反馈不存在：' + ctx.body.feedbackId);
          L.checkVersion(ctx, f, ctx.body.version, '反馈');
          const before = { status: f.status };
          if (f.status === 'WITHDRAWN') throw L.err(L.ERR.INVALID_STATE, '该反馈已撤回');
          f.status = 'WITHDRAWN';
          f.withdrawReason = reason;
          f.withdrawnAt = L.nowIso();
          L.bumpVersion(f);
          L.audit(ctx.db, {
            module: MODULE, action, targetId: f.id, operator: ctx.operator, reason,
            before, after: { status: f.status }, requestId: ctx.requestId, id: operationId,
          });
          ctx.save();
          return { feedback: feedbackDto(f), operationId };
        }

        // consume-lessons：扣课时
        L.requireFields(ctx.body, ['memberId', 'bucket', 'quantity']);
        L.ensureEnum(ctx.body.bucket, BUCKETS, 'bucket');
        const qty = Number(ctx.body.quantity);
        if (!Number.isInteger(qty) || qty <= 0) throw L.err(L.ERR.INVALID_INPUT, 'quantity 必须是正整数');
        const member = (ctx.db.members || []).find((m) => m.id === ctx.body.memberId);
        if (!member) throw L.err(L.ERR.NOT_FOUND, '会员不存在：' + ctx.body.memberId);
        let acct = (ctx.db.hqTrainingBalances || []).find((b) => b.memberId === ctx.body.memberId);
        if (!acct) {
          const t = member.training || {};
          acct = {
            memberId: ctx.body.memberId,
            accountId: member.userId,
            storeId: member.storeId || null,
            trainingTotal: Number(t.trainingTotal || 0),
            trainingUsed: Number(t.trainingUsed || 0),
            trainingRemaining: Math.max(0, Number(t.trainingTotal || 0) - Number(t.trainingUsed || 0)),
            specialTotal: Number(t.specialTotal || 0),
            specialUsed: Number(t.specialUsed || 0),
            specialRemaining: Math.max(0, Number(t.specialTotal || 0) - Number(t.specialUsed || 0)),
            version: 1,
          };
          ctx.db.hqTrainingBalances.push(acct);
        }
        L.checkVersion(ctx, acct, ctx.body.version, '课时余额');
        const before = balanceDto(acct);
        const remainKey = ctx.body.bucket === 'TRAINING' ? 'trainingRemaining' : 'specialRemaining';
        const usedKey = ctx.body.bucket === 'TRAINING' ? 'trainingUsed' : 'specialUsed';
        const totalKey = ctx.body.bucket === 'TRAINING' ? 'trainingTotal' : 'specialTotal';
        if (Number(acct[remainKey] || 0) < qty) {
          throw L.err(L.ERR.QUOTA_EXCEEDED, `课时余额不足（剩余 ${acct[remainKey] || 0}，需扣 ${qty}）`);
        }
        acct[remainKey] = Number(acct[remainKey] || 0) - qty;
        acct[usedKey] = Number(acct[usedKey] || 0) + qty;
        acct[totalKey] = Number(acct[totalKey] || 0) + qty;
        // 同步既有业务侧课时字段
        if (!member.training) member.training = {};
        member.training[ctx.body.bucket === 'TRAINING' ? 'trainingUsed' : 'specialUsed'] = acct[usedKey];
        member.training[ctx.body.bucket === 'TRAINING' ? 'trainingTotal' : 'specialTotal'] = acct[totalKey];
        L.bumpVersion(acct);
        L.audit(ctx.db, {
          module: MODULE, action, targetId: acct.memberId, operator: ctx.operator, reason,
          before, after: balanceDto(acct), requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { balance: balanceDto(acct), operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, balanceDto, feedbackDto };
