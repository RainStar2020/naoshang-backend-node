/**
 * 脑商AI合伙人 · 总部后台 · HQ-23 邀请关系（Invitations）
 *
 * 契约：《总部后台API需求文档.md》§25
 *
 * 库表对照：
 *   - 关系（既有、托管）：db.users[].upline_id + db.uplineHistory
 *   - 邀请码（既有、托管）：db.inviteCodes
 *
 * 改绑需 **version（关系版本）+ graphVersion（图谱版本）** 双版本校验。
 */

const L = require('../lib');

const MODULE = 'invitations';
const CODE = 'HQ-23';
const TITLE = '邀请关系';

const BINDING = ['BOUND', 'UNBOUND'];
const SOURCES = ['REGISTRATION_INVITE', 'NO_INVITE'];

/** 关系版本：以该账号的上级绑定数量与历史条数推导（稳定可复算） */
function relationVersion(db, accountId) {
  const u = db.users[accountId];
  if (!u) return 1;
  const hist = (db.uplineHistory || []).filter((h) => h.partnerId === accountId || h.userId === accountId).length;
  return Number(u.version || 1) + hist;
}

/** 图谱版本：全库关系变更次数（用于整体图谱一致性校验） */
function graphVersion(db) {
  return Number((db.uplineHistory || []).length) + 1;
}

function accountBrief(db, id) {
  const u = id ? db.users[id] : null;
  if (!u) return null;
  return {
    accountId: u.id,
    displayId: u.display_id || u.id,
    name: u.name || '',
    phone: u.phone || '',
    frozen: !!u.frozen,
  };
}

/** 直推人数 */
function directCount(db, accountId) {
  return Object.values(db.users || {}).filter((u) => u.upline_id === accountId).length;
}

/** 团队人数（含所有层级） */
function teamCount(db, accountId) {
  let n = 0;
  const walk = (id) => {
    for (const u of Object.values(db.users || {})) {
      if (u.upline_id === id) { n++; walk(u.id); }
    }
  };
  walk(accountId);
  return n;
}

/** 祖先链（从直接上级向上） */
function ancestorChain(db, accountId) {
  const chain = [];
  let cur = db.users[accountId];
  const guard = new Set();
  while (cur && cur.upline_id && !guard.has(cur.upline_id)) {
    guard.add(cur.upline_id);
    const up = db.users[cur.upline_id];
    if (!up) break;
    chain.push(accountBrief(db, up.id));
    cur = up;
  }
  return chain;
}

/** 成环检测：target 是否为 account 的下级（含自身） */
function wouldCycle(db, accountId, targetId) {
  if (accountId === targetId) return true;
  let cur = db.users[targetId];
  const guard = new Set();
  while (cur && cur.upline_id) {
    if (cur.upline_id === accountId) return true;
    if (guard.has(cur.upline_id)) return true;
    guard.add(cur.upline_id);
    cur = db.users[cur.upline_id];
  }
  return false;
}

const routes = [
  // ── 关系分页 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/invitations',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const binding = ctx.query.get('binding') || '';
      let list = Object.values(ctx.db.users || {});
      if (keyword) list = list.filter((u) => L.matchKeyword(keyword, u.id, u.name, u.phone, u.display_id));
      if (binding === 'BOUND') list = list.filter((u) => !!u.upline_id);
      if (binding === 'UNBOUND') list = list.filter((u) => !u.upline_id);
      list.sort((a, b) => String(a.id).localeCompare(String(b.id)));

      const gv = graphVersion(ctx.db);
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map((u) => {
        const codes = (ctx.db.inviteCodes || []).filter((c) => c.ownerId === u.id);
        return {
          account: accountBrief(ctx.db, u.id),
          superior: accountBrief(ctx.db, u.upline_id),
          inviteCode: codes.length ? codes[0].code : null,
          initialBinding: {
            source: codes.length ? 'REGISTRATION_INVITE' : 'NO_INVITE',
          },
          version: relationVersion(ctx.db, u.id),
          graphVersion: gv,
          directCount: directCount(ctx.db, u.id),
          teamCount: teamCount(ctx.db, u.id),
          allowedActions: ['rebind', 'unbind'],
        };
      });
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: list.length,
        bound: Object.values(ctx.db.users || {}).filter((u) => !!u.upline_id).length,
        unbound: Object.values(ctx.db.users || {}).filter((u) => !u.upline_id).length,
      });
    },
  },

  // ── 详情（祖先链 + 历史）──
  {
    module: MODULE,
    method: 'GET',
    path: '/invitations/:accountId',
    async handler(ctx) {
      const u = ctx.db.users[ctx.params.accountId];
      if (!u) throw L.err(L.ERR.NOT_FOUND, '账号不存在：' + ctx.params.accountId);
      const codes = (ctx.db.inviteCodes || []).filter((c) => c.ownerId === u.id);
      const history = (ctx.db.uplineHistory || [])
        .filter((h) => (h.partnerId || h.userId) === u.id)
        .map((h) => ({
          at: L.toIso(h.at || h.createdAt),
          from: h.fromUplineId || h.oldUplineId || null,
          to: h.toUplineId || h.newUplineId || null,
          reason: h.reason || null,
          operator: h.operator || null,
        }));
      return {
        account: accountBrief(ctx.db, u.id),
        superior: accountBrief(ctx.db, u.upline_id),
        inviteCode: codes.length ? codes[0].code : null,
        initialBinding: { source: codes.length ? 'REGISTRATION_INVITE' : 'NO_INVITE' },
        ancestors: ancestorChain(ctx.db, u.id),
        version: relationVersion(ctx.db, u.id),
        graphVersion: graphVersion(ctx.db),
        directCount: directCount(ctx.db, u.id),
        teamCount: teamCount(ctx.db, u.id),
        history,
        allowedActions: ['rebind', 'unbind'],
      };
    },
  },

  // ── 团队列表 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/invitations/:accountId/team',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const rootId = ctx.params.accountId;
      if (!ctx.db.users[rootId]) throw L.err(L.ERR.NOT_FOUND, '账号不存在：' + rootId);
      const scope = ctx.query.get('scope') || 'DIRECT';
      L.ensureEnum(scope, ['DIRECT', 'ALL'], 'scope');
      const keyword = ctx.query.get('keyword') || '';

      let list;
      if (scope === 'DIRECT') {
        list = Object.values(ctx.db.users || {}).filter((u) => u.upline_id === rootId);
      } else {
        const ids = [];
        const walk = (id) => {
          for (const u of Object.values(ctx.db.users || {})) {
            if (u.upline_id === id) { ids.push(u.id); walk(u.id); }
          }
        };
        walk(rootId);
        list = ids.map((id) => ctx.db.users[id]).filter(Boolean);
      }
      if (keyword) list = list.filter((u) => L.matchKeyword(keyword, u.id, u.name, u.phone, u.display_id));
      list.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map((u) => ({
        account: accountBrief(ctx.db, u.id),
        superior: accountBrief(ctx.db, u.upline_id),
        directCount: directCount(ctx.db, u.id),
        teamCount: teamCount(ctx.db, u.id),
        level: 1,
      }));
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        scope,
        total: list.length,
      });
    },
  },

  // ── rebind / unbind ──
  {
    module: MODULE,
    method: 'POST',
    path: '/invitations/mutate',
    async handler(ctx) {
      const { action } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['rebind', 'unbind'], 'action');
      L.requireFields(ctx.body, ['accountId']);

      return L.withIdempotency(ctx, () => {
        const accountId = String(ctx.body.accountId);
        const u = ctx.db.users[accountId];
        if (!u) throw L.err(L.ERR.NOT_FOUND, '账号不存在：' + accountId);
        const operationId = L.nextId(ctx.db, 'hqop');

        // 双版本校验：关系版本 + 图谱版本
        const curRelVer = relationVersion(ctx.db, accountId);
        const curGraphVer = graphVersion(ctx.db);
        if (ctx.body.version !== undefined && ctx.body.version !== null && ctx.body.version !== '') {
          if (Number(ctx.body.version) !== curRelVer) {
            throw L.err(L.ERR.VERSION_CONFLICT, `关系版本已变化（当前 version=${curRelVer}）`, { currentVersion: curRelVer });
          }
        }
        if (ctx.body.graphVersion !== undefined && ctx.body.graphVersion !== null && ctx.body.graphVersion !== '') {
          if (Number(ctx.body.graphVersion) !== curGraphVer) {
            throw L.err(L.ERR.VERSION_CONFLICT, `关系图谱已变化（当前 graphVersion=${curGraphVer}）`, { currentGraphVersion: curGraphVer });
          }
        }

        const before = { superiorAccountId: u.upline_id || null };

        if (action === 'rebind') {
          L.requireFields(ctx.body, ['targetAccountId']);
          const targetId = String(ctx.body.targetAccountId);
          if (!ctx.db.users[targetId]) throw L.err(L.ERR.NOT_FOUND, '目标上级账号不存在：' + targetId);
          if (wouldCycle(ctx.db, accountId, targetId)) {
            throw L.err(L.ERR.INVALID_INPUT, '不允许把自己或自己的下级设为上级（会形成环）');
          }
          u.upline_id = targetId;
          ctx.db.uplineHistory = ctx.db.uplineHistory || [];
          ctx.db.uplineHistory.push({
            id: L.nextId(ctx.db, 'uh'),
            partnerId: accountId,
            fromUplineId: before.superiorAccountId,
            toUplineId: targetId,
            reason,
            operator: ctx.operator ? ctx.operator.adminId : 'admin',
            at: L.nowMs(),
          });
        } else {
          if (!u.upline_id) throw L.err(L.ERR.INVALID_STATE, '该账号当前没有上级，无需解绑');
          const old = u.upline_id;
          u.upline_id = null;
          ctx.db.uplineHistory = ctx.db.uplineHistory || [];
          ctx.db.uplineHistory.push({
            id: L.nextId(ctx.db, 'uh'),
            partnerId: accountId,
            fromUplineId: old,
            toUplineId: null,
            reason,
            operator: ctx.operator ? ctx.operator.adminId : 'admin',
            at: L.nowMs(),
          });
        }
        L.audit(ctx.db, {
          module: MODULE, action, targetId: accountId, operator: ctx.operator, reason,
          before, after: { superiorAccountId: u.upline_id || null },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return {
          account: accountBrief(ctx.db, accountId),
          superior: accountBrief(ctx.db, u.upline_id),
          version: relationVersion(ctx.db, accountId),
          graphVersion: graphVersion(ctx.db),
          operationId,
        };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, relationVersion, graphVersion };
