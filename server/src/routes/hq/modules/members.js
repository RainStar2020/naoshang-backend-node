/**
 * 脑商AI合伙人 · 总部后台 · HQ-03 会员档案（Members）
 *
 * 契约：《总部后台API需求文档.md》§5
 *
 * 库表对照：db.members（孩子/学员档案，array）
 *   memberId   ↔ members.id
 *   accountId  ↔ members.userId
 *   displayName↔ members.name
 *   storeId    ↔ members.storeId
 *   version    ↔ members.version（库内已有，乐观锁直接用）
 */

const L = require('../lib');

const MODULE = 'members';
const CODE = 'HQ-03';
const TITLE = '会员档案';

/** 会员 DTO */
function memberDto(m) {
  return {
    memberId: m.id,
    accountId: m.userId,
    displayName: m.name || '',
    displayId: m.display_id || null,
    gender: m.genderCode || null,
    genderLabel: m.genderLabel || null,
    birthday: m.birthday || null,
    gradeCode: m.gradeCode || null,
    gradeLabel: m.gradeLabel || null,
    memberLevel: m.memberLevel || null,
    storeId: m.storeId || null,
    storeName: m.storeName || null,
    activated: m.activated !== false,
    status: m.status || (m.activated === false ? 'INACTIVE' : 'ACTIVE'),
    version: Number(m.version || 1),
    allowedActions: ['update-profile', 'bind-store', 'unbind-store', 'set-status'],
  };
}

/** 补齐门店名（从 co_stores / regional_agents 反查） */
function attachStoreNames(db, list) {
  const storeMap = new Map();
  for (const cs of db.coStores || []) {
    if (cs.store_id) storeMap.set(cs.store_id, cs.store_name || cs.store_id);
  }
  for (const ra of db.regionalAgents || []) {
    if (ra.region_type === 'store' && ra.region_code) {
      if (!storeMap.has(ra.region_code)) storeMap.set(ra.region_code, ra.region_code);
    }
  }
  for (const s of db.hqStores || []) {
    storeMap.set(s.storeId, s.name);
  }
  for (const m of list) {
    if (m.storeId && !m.storeName) m.storeName = storeMap.get(m.storeId) || null;
  }
  return list;
}

const routes = [
  // ── 会员分页列表 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/members',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const accountId = ctx.query.get('accountId') || '';
      const storeId = ctx.query.get('storeId') || '';
      const status = ctx.query.get('status') || '';

      let list = (ctx.db.members || []).slice();
      if (keyword) list = list.filter((m) => L.matchKeyword(keyword, m.id, m.name, m.display_id, m.userId));
      if (accountId) list = list.filter((m) => m.userId === accountId);
      if (storeId) list = list.filter((m) => m.storeId === storeId);
      if (status) list = list.filter((m) => (m.status || (m.activated === false ? 'INACTIVE' : 'ACTIVE')) === status);

      list.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const all = (ctx.db.members || []);
      const items = attachStoreNames(ctx.db, list.slice(paging.offset, paging.offset + paging.pageSize)).map(memberDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        unbound: all.filter((m) => !m.storeId).length,
      });
    },
  },

  // ── 门店等筛选项 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/members/catalog',
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
      const members = ctx.db.members || [];
      return {
        stores,
        statuses: [
          { value: 'ACTIVE', label: '正常' },
          { value: 'INACTIVE', label: '未激活' },
        ],
        summary: {
          total: members.length,
          bound: members.filter((m) => !!m.storeId).length,
          unbound: members.filter((m) => !m.storeId).length,
        },
      };
    },
  },

  // ── 会员详情 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/members/:memberId',
    async handler(ctx) {
      const m = (ctx.db.members || []).find((x) => x.id === ctx.params.memberId);
      if (!m) throw L.err(L.ERR.NOT_FOUND, '会员不存在：' + ctx.params.memberId);
      attachStoreNames(ctx.db, [m]);
      const entitlements = (ctx.db.hqCourseEntitlements || []).filter((e) => e.memberId === m.id);
      const training = (ctx.db.hqTrainingBalances || []).find((b) => b.memberId === m.id) || null;
      const audits = (ctx.db.hqAuditLogs || []).filter((a) => a.module === MODULE && a.targetId === m.id).slice(0, 20);
      return {
        profile: memberDto(m),
        entitlements,
        training,
        audit: audits,
      };
    },
  },

  // ── 会员写操作 ──
  {
    module: MODULE,
    method: 'POST',
    path: '/members/:memberId/mutate',
    async handler(ctx) {
      const { action, version } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      const m = (ctx.db.members || []).find((x) => x.id === ctx.params.memberId);
      if (!m) throw L.err(L.ERR.NOT_FOUND, '会员不存在：' + ctx.params.memberId);
      L.checkVersion(ctx, m, version, '会员档案');
      L.ensureEnum(action, ['update-profile', 'bind-store', 'unbind-store', 'set-status'], 'action');

      const before = {
        name: m.name, gradeCode: m.gradeCode, genderCode: m.genderCode,
        storeId: m.storeId, status: m.status || (m.activated === false ? 'INACTIVE' : 'ACTIVE'),
      };

      return L.withIdempotency(ctx, () => {
        if (action === 'update-profile') {
          const b = ctx.body;
          if (b.name !== undefined) m.name = String(b.name);
          if (b.birthday !== undefined) m.birthday = b.birthday;
          if (b.gradeCode !== undefined) m.gradeCode = b.gradeCode;
          if (b.gradeLabel !== undefined) m.gradeLabel = b.gradeLabel;
          if (b.genderCode !== undefined) m.genderCode = b.genderCode;
          if (b.genderLabel !== undefined) m.genderLabel = b.genderLabel;
        } else if (action === 'bind-store') {
          L.requireFields(ctx.body, ['storeId']);
          const storeId = String(ctx.body.storeId);
          const exists = (ctx.db.coStores || []).some((c) => c.store_id === storeId)
            || (ctx.db.hqStores || []).some((s) => s.storeId === storeId)
            || (ctx.db.regionalAgents || []).some((a) => a.region_type === 'store' && a.region_code === storeId);
          if (!exists) throw L.err(L.ERR.INVALID_INPUT, '门店不存在：' + storeId);
          m.storeId = storeId;
        } else if (action === 'unbind-store') {
          if (!m.storeId) throw L.err(L.ERR.INVALID_STATE, '该会员当前未绑定门店');
          m.storeId = null;
        } else if (action === 'set-status') {
          L.requireFields(ctx.body, ['status']);
          L.ensureEnum(ctx.body.status, ['ACTIVE', 'INACTIVE'], 'status');
          m.status = ctx.body.status;
          m.activated = ctx.body.status === 'ACTIVE';
        }
        L.bumpVersion(m);
        const operationId = L.nextId(ctx.db, 'hqop');
        L.audit(ctx.db, {
          module: MODULE, action, targetId: m.id, operator: ctx.operator, reason,
          before,
          after: { name: m.name, gradeCode: m.gradeCode, genderCode: m.genderCode, storeId: m.storeId, status: m.status },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { profile: memberDto(m), operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, memberDto };
