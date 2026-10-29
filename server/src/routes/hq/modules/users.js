/**
 * 脑商AI合伙人 · 总部后台 · HQ-02 账号管理（Users）
 *
 * 契约：《总部后台API需求文档.md》§4
 *
 * 库表对照：db.users（登录账号主档，object: id → user）
 *   accountId ↔ users.id
 *   displayId ↔ users.display_id
 *   phone     ↔ users.phone
 *   frozen    ↔ users.frozen（缺省 false，本模块负责维护）
 *   note      ↔ users.note（内部备注）
 *   version   ↔ users.version（乐观锁，本模块负责维护）
 */

const L = require('../lib');

const MODULE = 'users';
const CODE = 'HQ-02';
const TITLE = '账号管理';

/** 合伙人档位中文名（与 routes.js TIER_CN 同口径） */
const TIER_CN = { none: '普通用户', vip: 'VIP合伙人', angel: '天使合伙人', private: '私董合伙人', cofounder: '联创合伙人' };

/** 账号 DTO
 *  脱敏约定（与订单/发货/提现一致）：列表默认脱敏，详情可完整。
 *  对应需求文档「phone：手机（可脱敏中间四位，详情可完整）」。
 */
function userDto(u, opts) {
  const frozen = !!u.frozen;
  const mask = !(opts && opts.reveal);
  const o = {
    accountId: u.id,
    displayId: u.display_id || u.id,
    nickname: u.name || '',
    phone: mask ? L.maskPhone(u.phone) : (u.phone || ''),
    tier: u.tier || 'none',
    tierLabel: TIER_CN[u.tier] || u.tier || 'none',
    frozen,
    entitlementState: u.entitlement_state || null,
    createdAt: L.toIso(u.created_at || u.createdAt) || null,
    lastLoginAt: L.toIso(u.last_login_at || u.lastLoginAt) || null,
    version: Number(u.version || 1),
    note: u.note || '',
    allowedActions: frozen
      ? ['unfreeze', 'update-note']
      : ['freeze', 'update-note'],
  };
  return o;
}

const routes = [
  // ── 账号分页列表 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/users',
    async handler(ctx) {
      const paging = ctx.apiPilot
        ? {page:ctx.apiPilot.pageNum,pageSize:ctx.apiPilot.pageSize,offset:(ctx.apiPilot.pageNum-1)*ctx.apiPilot.pageSize}
        : L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const frozenFilter = ctx.query.get('frozen');
      const tierFilter = ctx.query.get('tier') || '';

      let list = Object.values(ctx.db.users || {});
      if (keyword) {
        list = list.filter((u) => L.matchKeyword(keyword, u.id, u.display_id, u.name, u.phone));
      }
      if (frozenFilter === 'true' || frozenFilter === '1') list = list.filter((u) => !!u.frozen);
      if (frozenFilter === 'false' || frozenFilter === '0') list = list.filter((u) => !u.frozen);
      if (tierFilter) list = list.filter((u) => u.tier === tierFilter);

      const sortKey = ctx.apiPilot && ctx.apiPilot.sortBy;
      const direction = ctx.apiPilot && ctx.apiPilot.sortOrder === 'desc' ? -1 : 1;
      const sortValue = (u) => sortKey === 'nickname' ? String(u.name || '')
        : sortKey === 'createdAt' ? (L.toIso(u.created_at || u.createdAt) || '') : String(u.id);
      list.sort((a, b) => direction * sortValue(a).localeCompare(sortValue(b)));
      const totalAll = Object.values(ctx.db.users || {}).length;
      const frozenAll = Object.values(ctx.db.users || {}).filter((u) => !!u.frozen).length;

      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map((u) => userDto(u));
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: totalAll,
        frozen: frozenAll,
        active: totalAll - frozenAll,
      });
    },
  },

  // ── 筛选项与汇总目录 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/users/catalog',
    async handler(ctx) {
      const users = Object.values(ctx.db.users || {});
      const byTier = {};
      for (const u of users) {
        const t = u.tier || 'none';
        byTier[t] = (byTier[t] || 0) + 1;
      }
      return {
        tiers: Object.keys(byTier).map((t) => ({ tier: t, label: TIER_CN[t] || t, count: byTier[t] })),
        statuses: [
          { value: 'normal', label: '正常' },
          { value: 'frozen', label: '已冻结' },
        ],
        summary: {
          total: users.length,
          frozen: users.filter((u) => !!u.frozen).length,
          active: users.filter((u) => !u.frozen).length,
        },
      };
    },
  },

  // ── 账号详情 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/users/:accountId',
    async handler(ctx) {
      const u = ctx.db.users[ctx.params.accountId];
      if (!u) throw L.err(L.ERR.NOT_FOUND, '账号不存在：' + ctx.params.accountId);
      const members = (ctx.db.members || []).filter((m) => m.userId === u.id);
      const audits = (ctx.db.hqAuditLogs || []).filter((a) => a.module === MODULE && a.targetId === u.id).slice(0, 20);
      return {
        profile: userDto(u, { reveal: true }),
        members: members.map((m) => ({
          memberId: m.id,
          displayName: m.name,
          memberLevel: m.memberLevel || null,
          displayId: m.display_id || null,
          storeId: m.storeId || null,
        })),
        audit: audits,
      };
    },
  },

  // ── 账号写操作 ──
  {
    module: MODULE,
    method: 'POST',
    path: '/users/:accountId/mutate',
    async handler(ctx) {
      const { action, version } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      // 参数合法性先于资源存在性（400 优先于 404）
      L.ensureEnum(action, ['freeze', 'unfreeze', 'update-note'], 'action');
      const u = ctx.db.users[ctx.params.accountId];
      if (!u) throw L.err(L.ERR.NOT_FOUND, '账号不存在：' + ctx.params.accountId);
      L.checkVersion(ctx, u, version, '账号');

      const before = { frozen: !!u.frozen, note: u.note || '' };

      return L.withIdempotency(ctx, () => {
        if (action === 'freeze') {
          if (u.frozen) throw L.err(L.ERR.INVALID_STATE, '该账号已处于冻结状态');
          u.frozen = true;
          u.frozen_at = L.nowIso();
          u.frozen_reason = reason;
        } else if (action === 'unfreeze') {
          if (!u.frozen) throw L.err(L.ERR.INVALID_STATE, '该账号未被冻结');
          u.frozen = false;
          u.frozen_at = null;
          u.frozen_reason = null;
        } else if (action === 'update-note') {
          L.requireFields(ctx.body, ['note']);
          u.note = String(ctx.body.note);
        }
        L.bumpVersion(u);
        const operationId = L.nextId(ctx.db, 'hqop');
        L.audit(ctx.db, {
          module: MODULE, action, targetId: u.id, operator: ctx.operator, reason,
          before, after: { frozen: !!u.frozen, note: u.note || '' }, requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { profile: userDto(u), operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, userDto };
