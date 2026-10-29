/**
 * 脑商AI合伙人 · 总部后台 · HQ-09 软件卡（Software Cards）
 *
 * 契约：《总部后台API需求文档.md》§11
 *
 * 库表对照：db.hqSoftwareCards + db.hqSoftwareCardBatches（总部后台专属）
 * 安全：卡密（code）属敏感字段 —— 列表默认脱敏，详情/导出按需明文且强审计。
 */

const L = require('../lib');

const MODULE = 'softwareCards';
const CODE = 'HQ-09';
const TITLE = '软件卡';

const CARD_STATUS = ['UNUSED', 'USED', 'VOID', 'EXPIRED'];

function maskCard(code) {
  const s = String(code || '');
  if (s.length <= 8) return s.slice(0, 2) + '****';
  return s.slice(0, 4) + '****' + s.slice(-4);
}

function toEnumStatus(c) {
  if (c.status === 'void') return 'VOID';
  if (c.status === 'used' || c.boundAccountId) return 'USED';
  if (c.expiresAt && new Date(c.expiresAt).getTime() < Date.now()) return 'EXPIRED';
  return 'UNUSED';
}

function cardDto(c, opts) {
  return {
    cardId: c.id,
    code: opts && opts.reveal ? c.code : maskCard(c.code),
    status: toEnumStatus(c),
    boundAccountId: c.boundAccountId || null,
    boundAt: L.toIso(c.boundAt),
    batchId: c.batchId || null,
    expiresAt: L.toIso(c.expiresAt),
    note: c.note || '',
    version: Number(c.version || 1),
    allowedActions: toEnumStatus(c) === 'UNUSED' ? ['void', 'update-note'] : ['update-note'],
  };
}

function batchDto(b, cards) {
  const list = cards || [];
  return {
    batchId: b.id,
    productId: b.productId || null,
    quantity: Number(b.quantity || 0),
    expiresAt: L.toIso(b.expiresAt),
    status: b.status || 'ACTIVE',
    createdAt: L.toIso(b.createdAt),
    version: Number(b.version || 1),
    stats: {
      total: Number(b.quantity || 0),
      unused: list.filter((c) => toEnumStatus(c) === 'UNUSED').length,
      used: list.filter((c) => toEnumStatus(c) === 'USED').length,
      void: list.filter((c) => toEnumStatus(c) === 'VOID').length,
      expired: list.filter((c) => toEnumStatus(c) === 'EXPIRED').length,
    },
  };
}

const routes = [
  // ── 卡密分页 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/software-cards',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const batchId = ctx.query.get('batchId') || '';
      const status = ctx.query.get('status') || '';
      const keyword = ctx.query.get('keyword') || '';
      const reveal = ctx.query.get('reveal') === '1';

      let list = (ctx.db.hqSoftwareCards || []).slice();
      if (batchId) list = list.filter((c) => c.batchId === batchId);
      if (status) list = list.filter((c) => toEnumStatus(c) === status);
      if (keyword) list = list.filter((c) => L.matchKeyword(keyword, c.code, c.boundAccountId));
      list.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const all = ctx.db.hqSoftwareCards || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map((c) => cardDto(c, { reveal }));
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        unused: all.filter((c) => toEnumStatus(c) === 'UNUSED').length,
        used: all.filter((c) => toEnumStatus(c) === 'USED').length,
      });
    },
  },

  // ── 批次列表 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/software-cards/batches',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const list = (ctx.db.hqSoftwareCardBatches || []).slice().reverse();
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map((b) => {
        const cards = (ctx.db.hqSoftwareCards || []).filter((c) => c.batchId === b.id);
        return batchDto(b, cards);
      });
      return L.listData(items, list.length, paging.page, paging.pageSize, { total: list.length });
    },
  },

  // ── 目录 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/software-cards/catalog',
    async handler(ctx) {
      const products = [];
      for (const s of ctx.db.skus || []) {
        if (!products.find((p) => p.productId === s.productId)) {
          products.push({ productId: s.productId, title: s.productId });
        }
      }
      return {
        products,
        statuses: CARD_STATUS.map((s) => ({ value: s, label: s })),
        summary: { total: (ctx.db.hqSoftwareCards || []).length },
      };
    },
  },

  // ── 生成批次 ──
  {
    module: MODULE,
    method: 'POST',
    path: '/software-cards/batches',
    async handler(ctx) {
      const b = ctx.body || {};
      L.requireFields(b, ['quantity']);
      const reason = L.requireReason(b, ctx.headerReason);
      const qty = Number(b.quantity);
      if (!Number.isInteger(qty) || qty <= 0) throw L.err(L.ERR.INVALID_INPUT, 'quantity 必须是正整数');
      if (qty > 5000) throw L.err(L.ERR.INVALID_INPUT, '单批次最多生成 5000 张卡');
      L.ensureCollections(ctx.db);

      return L.withIdempotency(ctx, () => {
        const batchId = L.nextId(ctx.db, 'hqscb');
        const stamp = Date.now().toString(36).toUpperCase().slice(-6);
        const cards = [];
        for (let i = 1; i <= qty; i++) {
          const rec = {
            id: L.nextId(ctx.db, 'hqsc'),
            code: `SC-${stamp}-${String(i).padStart(4, '0')}`,
            status: 'unused',
            boundAccountId: null,
            boundAt: null,
            batchId,
            productId: b.productId || null,
            expiresAt: b.expiresAt || null,
            note: '',
            version: 1,
            createdAt: L.nowIso(),
          };
          ctx.db.hqSoftwareCards.push(rec);
          cards.push(rec);
        }
        const batch = {
          id: batchId,
          productId: b.productId || null,
          quantity: qty,
          expiresAt: b.expiresAt || null,
          status: 'ACTIVE',
          createdAt: L.nowIso(),
          version: 1,
        };
        ctx.db.hqSoftwareCardBatches.push(batch);
        const operationId = L.nextId(ctx.db, 'hqop');
        L.audit(ctx.db, {
          module: MODULE, action: 'create-batch', targetId: batchId, operator: ctx.operator, reason,
          before: null, after: { batchId, quantity: qty }, requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return {
          batch: batchDto(batch, cards),
          cards: cards.map((c) => cardDto(c, { reveal: true })),
          operationId,
        };
      });
    },
  },

  // ── 作废 / 备注 ──
  {
    module: MODULE,
    method: 'POST',
    path: '/software-cards/mutate',
    async handler(ctx) {
      const { action } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['void', 'update-note'], 'action');

      return L.withIdempotency(ctx, () => {
        L.requireFields(ctx.body, ['cardId']);
        const rec = (ctx.db.hqSoftwareCards || []).find((c) => c.id === ctx.body.cardId);
        if (!rec) throw L.err(L.ERR.NOT_FOUND, '软件卡不存在：' + ctx.body.cardId);
        const before = { status: rec.status, note: rec.note || '' };
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'void') {
          if (rec.status === 'void') throw L.err(L.ERR.INVALID_STATE, '该卡已作废');
          if (toEnumStatus(rec) === 'USED') throw L.err(L.ERR.INVALID_STATE, '已绑定的卡不可作废');
          rec.status = 'void';
          rec.voidReason = reason;
          rec.voidedAt = L.nowIso();
        } else if (action === 'update-note') {
          L.requireFields(ctx.body, ['note']);
          rec.note = String(ctx.body.note);
        }
        L.bumpVersion(rec);
        L.audit(ctx.db, {
          module: MODULE, action, targetId: rec.id, operator: ctx.operator, reason,
          before, after: { status: rec.status, note: rec.note || '' },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { card: cardDto(rec), operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, cardDto };
