/**
 * 脑商AI合伙人 · 总部后台 · HQ-19 门店（Stores）
 *
 * 契约：《总部后台API需求文档.md》§21
 *
 * 库表对照：
 *   - 后台门店主档：db.hqStores
 *   - 既有合店/门店（托管）：db.coStores（store_id / store_name）
 *   - 区域代理中的门店级：db.regionalAgents（region_type='store'）
 *
 * 合并视图：hqStores 为主，合店与门店代理作为补充来源。
 */

const L = require('../lib');

const MODULE = 'stores';
const CODE = 'HQ-19';
const TITLE = '门店';

/** 合并所有来源的门店视图 */
function collectStores(db) {
  const map = new Map();
  for (const s of db.hqStores || []) {
    map.set(s.storeId, {
      storeId: s.storeId, name: s.name, code: s.code || null, address: s.address || null,
      managerName: s.managerName || null, managerPhone: s.managerPhone || null,
      ownerAccountId: s.ownerAccountId || null, active: s.active !== false,
      version: Number(s.version || 1), source: 'hq',
    });
  }
  for (const cs of db.coStores || []) {
    if (!cs.store_id || map.has(cs.store_id)) continue;
    const owner = db.users[cs.owner_id];
    map.set(cs.store_id, {
      storeId: cs.store_id, name: cs.store_name || cs.store_id, code: null, address: null,
      managerName: owner ? owner.name : null, managerPhone: owner ? owner.phone : null,
      ownerAccountId: cs.owner_id || null, active: true, version: 1, source: 'costore',
    });
  }
  for (const ra of db.regionalAgents || []) {
    if (ra.region_type !== 'store' || !ra.region_code || map.has(ra.region_code)) continue;
    const owner = db.users[ra.partner_id];
    map.set(ra.region_code, {
      storeId: ra.region_code, name: ra.region_code, code: null, address: null,
      managerName: owner ? owner.name : null, managerPhone: owner ? owner.phone : null,
      ownerAccountId: ra.partner_id || null, active: true, version: 1, source: 'agent',
    });
  }
  return [...map.values()];
}

function storeDto(s) {
  return {
    storeId: s.storeId,
    name: s.name || s.storeId,
    code: s.code || null,
    address: s.address || null,
    managerName: s.managerName || null,
    managerPhone: s.managerPhone || null,
    ownerAccountId: s.ownerAccountId || null,
    active: s.active !== false,
    version: Number(s.version || 1),
    allowedActions: ['update', s.active !== false ? 'disable' : 'enable', 'change-owner'],
  };
}

const routes = [
  // ── 门店分页 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/stores',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const active = ctx.query.get('active');
      let list = collectStores(ctx.db);
      if (keyword) list = list.filter((s) => L.matchKeyword(keyword, s.storeId, s.name, s.code, s.managerName));
      if (active === 'true' || active === '1') list = list.filter((s) => s.active !== false);
      if (active === 'false' || active === '0') list = list.filter((s) => s.active === false);
      list.sort((a, b) => String(a.storeId).localeCompare(String(b.storeId)));
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(storeDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: list.length,
        active: list.filter((s) => s.active !== false).length,
      });
    },
  },

  // ── 筛选项 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/stores/catalog',
    async handler(ctx) {
      const list = collectStores(ctx.db);
      return {
        stores: list.map((s) => ({ storeId: s.storeId, name: s.name || s.storeId })),
        summary: { total: list.length, active: list.filter((s) => s.active !== false).length },
      };
    },
  },

  // ── 详情 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/stores/:storeId',
    async handler(ctx) {
      const s = collectStores(ctx.db).find((x) => x.storeId === ctx.params.storeId);
      if (!s) throw L.err(L.ERR.NOT_FOUND, '门店不存在：' + ctx.params.storeId);
      const members = (ctx.db.members || []).filter((m) => m.storeId === s.storeId);
      const staff = (ctx.db.hqStaff || []).filter((x) => x.storeId === s.storeId);
      return {
        store: storeDto(s),
        memberCount: members.length,
        staff: staff.map((x) => ({ staffId: x.id, name: x.name, roles: x.roles || [], status: x.status })),
      };
    },
  },

  // ── 创建 ──
  {
    module: MODULE,
    method: 'POST',
    path: '/stores/mutate',
    async handler(ctx) {
      const { action } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['create'], 'action');
      L.ensureCollections(ctx.db);

      return L.withIdempotency(ctx, () => {
        L.requireFields(ctx.body, ['name']);
        const storeId = ctx.body.storeId || L.nextId(ctx.db, 'st');
        const rec = {
          storeId,
          name: String(ctx.body.name),
          code: ctx.body.code || null,
          address: ctx.body.address || null,
          managerName: ctx.body.managerName || null,
          managerPhone: ctx.body.managerPhone || null,
          ownerAccountId: ctx.body.ownerAccountId || null,
          active: true,
          version: 1,
          createdAt: L.nowIso(),
        };
        ctx.db.hqStores.push(rec);
        const operationId = L.nextId(ctx.db, 'hqop');
        L.audit(ctx.db, {
          module: MODULE, action: 'create', targetId: storeId, operator: ctx.operator, reason,
          before: null, after: rec, requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { store: storeDto(rec), operationId };
      });
    },
  },

  // ── 更新 / 停用 / 改负责人 ──
  {
    module: MODULE,
    method: 'POST',
    path: '/stores/:storeId/mutate',
    async handler(ctx) {
      const { action, version } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['update', 'disable', 'enable', 'change-owner'], 'action');
      const rec = (ctx.db.hqStores || []).find((x) => x.storeId === ctx.params.storeId);
      if (!rec) throw L.err(L.ERR.NOT_FOUND, '门店不存在（仅支持后台创建的门店改写）：' + ctx.params.storeId);
      L.checkVersion(ctx, rec, version, '门店');
      const before = { name: rec.name, active: rec.active, ownerAccountId: rec.ownerAccountId };

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');
        if (action === 'update') {
          if (ctx.body.name !== undefined) rec.name = String(ctx.body.name);
          if (ctx.body.code !== undefined) rec.code = ctx.body.code;
          if (ctx.body.address !== undefined) rec.address = ctx.body.address;
          if (ctx.body.managerName !== undefined) rec.managerName = ctx.body.managerName;
          if (ctx.body.managerPhone !== undefined) rec.managerPhone = ctx.body.managerPhone;
        } else if (action === 'disable') {
          if (rec.active === false) throw L.err(L.ERR.INVALID_STATE, '该门店已停用');
          rec.active = false;
        } else if (action === 'enable') {
          if (rec.active !== false) throw L.err(L.ERR.INVALID_STATE, '该门店未停用');
          rec.active = true;
        } else if (action === 'change-owner') {
          L.requireFields(ctx.body, ['ownerAccountId']);
          const ownerId = String(ctx.body.ownerAccountId);
          if (!ctx.db.users[ownerId]) throw L.err(L.ERR.NOT_FOUND, '店主账号不存在：' + ownerId);
          rec.ownerAccountId = ownerId;
        }
        L.bumpVersion(rec);
        L.audit(ctx.db, {
          module: MODULE, action, targetId: rec.storeId, operator: ctx.operator, reason,
          before, after: { name: rec.name, active: rec.active, ownerAccountId: rec.ownerAccountId },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { store: storeDto(rec), operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, storeDto, collectStores };
