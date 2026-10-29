/**
 * 脑商AI合伙人 · 总部后台 · HQ-18 员工与角色（Staff）
 *
 * 契约：《总部后台API需求文档.md》§20
 *
 * 库表对照：db.hqStaff（后台专属门店员工）
 * 说明：HQ 管理员仍在 hqAdmins；本模块管的是**门店侧员工**。
 * 健脑官（coaches）是既有独立登录账号，可作为员工来源参考。
 */

const L = require('../lib');

const MODULE = 'staff';
const CODE = 'HQ-18';
const TITLE = '员工与角色';

const STAFF_STATUS = ['ACTIVE', 'DISABLED'];

const ROLE_OPTIONS = [
  { value: 'STORE_MANAGER', label: '店长' },
  { value: 'COACH', label: '健脑官' },
  { value: 'CONSULTANT', label: '咨询师' },
  { value: 'CASHIER', label: '收银' },
];

function staffDto(s) {
  return {
    staffId: s.id,
    accountId: s.accountId || null,
    name: s.name || '',
    phone: s.phone || '',
    storeId: s.storeId || null,
    storeName: s.storeName || null,
    roles: Array.isArray(s.roles) ? s.roles : [],
    status: s.status || 'ACTIVE',
    version: Number(s.version || 1),
    allowedActions: (s.status || 'ACTIVE') === 'ACTIVE' ? ['update-role', 'disable'] : ['update-role', 'enable'],
  };
}

const routes = [
  // ── 员工分页 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/staff',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const storeId = ctx.query.get('storeId') || '';
      const status = ctx.query.get('status') || '';
      let list = (ctx.db.hqStaff || []).slice();
      if (keyword) list = list.filter((s) => L.matchKeyword(keyword, s.id, s.name, s.phone));
      if (storeId) list = list.filter((s) => s.storeId === storeId);
      if (status) list = list.filter((s) => (s.status || 'ACTIVE') === status);
      list.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const all = ctx.db.hqStaff || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(staffDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        active: all.filter((s) => (s.status || 'ACTIVE') === 'ACTIVE').length,
      });
    },
  },

  // ── 角色/门店目录 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/staff/catalog',
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
        roles: ROLE_OPTIONS,
        stores,
        statuses: STAFF_STATUS.map((s) => ({ value: s, label: s })),
        actions: [
          { value: 'create', label: '新增员工' },
          { value: 'update-role', label: '改角色' },
          { value: 'disable', label: '停用' },
          { value: 'enable', label: '启用' },
        ],
        summary: { total: (ctx.db.hqStaff || []).length },
      };
    },
  },

  // ── 详情 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/staff/:staffId',
    async handler(ctx) {
      const s = (ctx.db.hqStaff || []).find((x) => x.id === ctx.params.staffId);
      if (!s) throw L.err(L.ERR.NOT_FOUND, '员工不存在：' + ctx.params.staffId);
      return { staff: staffDto(s) };
    },
  },

  // ── 创建 / 改角色 / 停用 ──
  {
    module: MODULE,
    method: 'POST',
    path: '/staff/mutate',
    async handler(ctx) {
      const { action } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['create', 'update-role', 'disable', 'enable'], 'action');
      L.ensureCollections(ctx.db);

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'create') {
          L.requireFields(ctx.body, ['name', 'storeId']);
          const rec = {
            id: L.nextId(ctx.db, 'hqst'),
            accountId: ctx.body.accountId || null,
            name: String(ctx.body.name),
            phone: ctx.body.phone || '',
            storeId: String(ctx.body.storeId),
            roles: Array.isArray(ctx.body.roles) ? ctx.body.roles : [],
            status: 'ACTIVE',
            version: 1,
            createdAt: L.nowIso(),
          };
          ctx.db.hqStaff.push(rec);
          L.audit(ctx.db, {
            module: MODULE, action: 'create', targetId: rec.id, operator: ctx.operator, reason,
            before: null, after: rec, requestId: ctx.requestId, id: operationId,
          });
          ctx.save();
          return { staff: staffDto(rec), operationId };
        }

        L.requireFields(ctx.body, ['staffId']);
        const rec = ctx.db.hqStaff.find((x) => x.id === ctx.body.staffId);
        if (!rec) throw L.err(L.ERR.NOT_FOUND, '员工不存在：' + ctx.body.staffId);
        L.checkVersion(ctx, rec, ctx.body.version, '员工');
        const before = { roles: (rec.roles || []).slice(), status: rec.status };

        if (action === 'update-role') {
          L.requireFields(ctx.body, ['roles']);
          if (!Array.isArray(ctx.body.roles)) throw L.err(L.ERR.INVALID_INPUT, 'roles 必须是数组');
          for (const r of ctx.body.roles) {
            if (!ROLE_OPTIONS.find((o) => o.value === r)) throw L.err(L.ERR.INVALID_INPUT, '角色码非法：' + r);
          }
          rec.roles = ctx.body.roles;
        } else if (action === 'disable') {
          if (rec.status === 'DISABLED') throw L.err(L.ERR.INVALID_STATE, '该员工已停用');
          rec.status = 'DISABLED';
          rec.disabledAt = L.nowIso();
        } else if (action === 'enable') {
          if (rec.status !== 'DISABLED') throw L.err(L.ERR.INVALID_STATE, '该员工未停用');
          rec.status = 'ACTIVE';
        }
        L.bumpVersion(rec);
        L.audit(ctx.db, {
          module: MODULE, action, targetId: rec.id, operator: ctx.operator, reason,
          before, after: { roles: (rec.roles || []).slice(), status: rec.status },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { staff: staffDto(rec), operationId };
      });
    },
  },

  // ── 针对单人 mutate ──
  {
    module: MODULE,
    method: 'POST',
    path: '/staff/:staffId/mutate',
    async handler(ctx) {
      const { action, version } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['update-role', 'disable', 'enable'], 'action');
      const rec = (ctx.db.hqStaff || []).find((x) => x.id === ctx.params.staffId);
      if (!rec) throw L.err(L.ERR.NOT_FOUND, '员工不存在：' + ctx.params.staffId);
      L.checkVersion(ctx, rec, version, '员工');
      const before = { roles: (rec.roles || []).slice(), status: rec.status };

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');
        if (action === 'update-role') {
          L.requireFields(ctx.body, ['roles']);
          if (!Array.isArray(ctx.body.roles)) throw L.err(L.ERR.INVALID_INPUT, 'roles 必须是数组');
          for (const r of ctx.body.roles) {
            if (!ROLE_OPTIONS.find((o) => o.value === r)) throw L.err(L.ERR.INVALID_INPUT, '角色码非法：' + r);
          }
          rec.roles = ctx.body.roles;
        } else if (action === 'disable') {
          if (rec.status === 'DISABLED') throw L.err(L.ERR.INVALID_STATE, '该员工已停用');
          rec.status = 'DISABLED';
        } else if (action === 'enable') {
          if (rec.status !== 'DISABLED') throw L.err(L.ERR.INVALID_STATE, '该员工未停用');
          rec.status = 'ACTIVE';
        }
        L.bumpVersion(rec);
        L.audit(ctx.db, {
          module: MODULE, action, targetId: rec.id, operator: ctx.operator, reason,
          before, after: { roles: (rec.roles || []).slice(), status: rec.status },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { staff: staffDto(rec), operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, staffDto };
