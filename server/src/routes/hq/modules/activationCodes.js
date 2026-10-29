/**
 * 脑商AI合伙人 · 总部后台 · HQ-08 激活码（Activation Codes）
 *
 * 契约：《总部后台API需求文档.md》§10
 *
 * 库表对照：db.activationCodes（业务集合）
 *   code    ↔ activationCodes[].code
 *   targetType / targetId ↔ 同名
 *   status  ↔ active / used / void / expired
 *
 * 批次：当前库无批次表，批次信息由 db.hqActivationBatches 承载（本模块按需自建）。
 * 安全：列表默认脱敏码面（仅前 3 后 2），导出需 reason + 审计。
 */

const L = require('../lib');

const MODULE = 'activationCodes';
const CODE = 'HQ-08';
const TITLE = '激活码';

const CODE_STATUS = ['UNUSED', 'USED', 'VOID', 'EXPIRED'];

/** 业务 status → 契约枚举 */
function toEnumStatus(a) {
  if (a.status === 'void') return 'VOID';
  if (a.status === 'used' || (a.maxUses && a.uses >= a.maxUses)) return 'USED';
  if (a.expiresAt && new Date(a.expiresAt).getTime() < Date.now()) return 'EXPIRED';
  return 'UNUSED';
}

/** 码面脱敏 */
function maskCode(code) {
  const s = String(code || '');
  if (s.length <= 6) return s.slice(0, 1) + '***';
  return s.slice(0, 3) + '***' + s.slice(-2);
}

function codeDto(a, opts) {
  return {
    codeId: a.code,
    code: opts && opts.reveal ? a.code : maskCode(a.code),
    targetType: a.targetType || null,
    targetId: a.targetId || null,
    maxUses: Number(a.maxUses || 1),
    uses: Number(a.uses || 0),
    status: toEnumStatus(a),
    expiresAt: L.toIso(a.expiresAt),
    batchId: a.batchId || null,
    version: Number(a.version || 1),
  };
}

/** 确保批次集合存在 */
function ensureBatches(db) {
  if (!Array.isArray(db.hqActivationBatches)) db.hqActivationBatches = [];
  return db.hqActivationBatches;
}

function batchDto(b, codes) {
  const list = codes || [];
  return {
    batchId: b.id,
    productId: b.productId || null,
    entitlementType: b.entitlementType || b.productId || null,
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
  // ── 批次列表 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/activation-codes/batches',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const list = ensureBatches(ctx.db).slice().reverse();
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map((b) => {
        const codes = (ctx.db.activationCodes || []).filter((c) => c.batchId === b.id);
        return batchDto(b, codes);
      });
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: list.length,
      });
    },
  },

  // ── 批次详情（含码统计）──
  {
    module: MODULE,
    method: 'GET',
    path: '/activation-codes/batches/:batchId',
    async handler(ctx) {
      const b = ensureBatches(ctx.db).find((x) => x.id === ctx.params.batchId);
      if (!b) throw L.err(L.ERR.NOT_FOUND, '批次不存在：' + ctx.params.batchId);
      const codes = (ctx.db.activationCodes || []).filter((c) => c.batchId === b.id);
      const dto = batchDto(b, codes);
      dto.codes = codes.map((c) => codeDto(c));
      return { batch: dto };
    },
  },

  // ── 码分页 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/activation-codes',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const batchId = ctx.query.get('batchId') || '';
      const status = ctx.query.get('status') || '';
      const targetType = ctx.query.get('targetType') || '';
      const keyword = ctx.query.get('keyword') || '';
      const reveal = ctx.query.get('reveal') === '1';

      let list = (ctx.db.activationCodes || []).slice();
      if (batchId) list = list.filter((c) => c.batchId === batchId);
      if (status) list = list.filter((c) => toEnumStatus(c) === status);
      if (targetType) list = list.filter((c) => c.targetType === targetType);
      if (keyword) list = list.filter((c) => L.matchKeyword(keyword, c.code, c.targetId));
      list.sort((a, b) => String(a.code).localeCompare(String(b.code)));
      const all = ctx.db.activationCodes || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map((c) => codeDto(c, { reveal }));
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        unused: all.filter((c) => toEnumStatus(c) === 'UNUSED').length,
        used: all.filter((c) => toEnumStatus(c) === 'USED').length,
      });
    },
  },

  // ── 可绑权益产品目录 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/activation-codes/catalog',
    async handler(ctx) {
      const products = [];
      for (const s of ctx.db.skus || []) {
        if (!products.find((p) => p.productId === s.productId)) {
          products.push({ productId: s.productId, title: s.productId, entitlementType: s.productId });
        }
      }
      for (const p of ctx.db.hqProducts || []) {
        products.push({ productId: p.productId, title: p.title, entitlementType: p.productId });
      }
      return {
        products,
        entitlementTypes: [
          { value: 'level', label: '学习等级' },
          { value: 'column', label: '专栏' },
          { value: 'fs', label: '粉丝' },
          { value: 'jy', label: '菁英' },
          { value: 'cj', label: '超菁' },
          { value: 'xn', label: '行能' },
          { value: 'ys', label: '羿烁' },
        ],
        codeStatuses: CODE_STATUS.map((s) => ({ value: s, label: s })),
        summary: { total: (ctx.db.activationCodes || []).length },
      };
    },
  },

  // ── 创建批次并生成码 ──
  {
    module: MODULE,
    method: 'POST',
    path: '/activation-codes/batches',
    async handler(ctx) {
      const b = ctx.body || {};
      L.requireFields(b, ['quantity']);
      const reason = L.requireReason(b, ctx.headerReason);
      const qty = Number(b.quantity);
      if (!Number.isInteger(qty) || qty <= 0) throw L.err(L.ERR.INVALID_INPUT, 'quantity 必须是正整数');
      if (qty > 5000) throw L.err(L.ERR.INVALID_INPUT, '单批次最多生成 5000 个码');
      L.ensureCollections(ctx.db);
      const batches = ensureBatches(ctx.db);

      return L.withIdempotency(ctx, () => {
        const batchId = L.nextId(ctx.db, 'hqb');
        const stamp = Date.now().toString(36).toUpperCase().slice(-6);
        const codes = [];
        for (let i = 1; i <= qty; i++) {
          const seq = String(i).padStart(4, '0');
          const code = `NS-${(b.entitlementType || b.productId || 'GEN').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'GEN'}-${stamp}-${seq}`;
          const rec = {
            code,
            targetType: b.entitlementType || b.productId || null,
            targetId: b.targetId || null,
            maxUses: Number(b.maxUses || 1),
            uses: 0,
            status: 'active',
            expiresAt: b.expiresAt || null,
            batchId,
            version: 1,
          };
          ctx.db.activationCodes.push(rec);
          codes.push(rec);
        }
        const batch = {
          id: batchId,
          productId: b.productId || null,
          entitlementType: b.entitlementType || b.productId || null,
          targetId: b.targetId || null,
          quantity: qty,
          maxUses: Number(b.maxUses || 1),
          expiresAt: b.expiresAt || null,
          status: 'ACTIVE',
          createdAt: L.nowIso(),
          version: 1,
        };
        batches.push(batch);
        const operationId = L.nextId(ctx.db, 'hqop');
        L.audit(ctx.db, {
          module: MODULE, action: 'create-batch', targetId: batchId, operator: ctx.operator, reason,
          before: null, after: { batchId, quantity: qty, productId: batch.productId },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return {
          batch: batchDto(batch, codes),
          codes: codes.map((c) => codeDto(c, { reveal: true })),
          operationId,
        };
      });
    },
  },

  // ── 作废 / 导出回执 ──
  {
    module: MODULE,
    method: 'POST',
    path: '/activation-codes/mutate',
    async handler(ctx) {
      const { action } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['void', 'export'], 'action');

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'void') {
          L.requireFields(ctx.body, ['code']);
          const rec = (ctx.db.activationCodes || []).find((c) => c.code === ctx.body.code);
          if (!rec) throw L.err(L.ERR.NOT_FOUND, '激活码不存在：' + ctx.body.code);
          const before = { status: rec.status };
          if (rec.status === 'void') throw L.err(L.ERR.INVALID_STATE, '该码已作废');
          if (toEnumStatus(rec) === 'USED') throw L.err(L.ERR.INVALID_STATE, '已使用的码不可作废');
          rec.status = 'void';
          rec.voidReason = reason;
          rec.voidedAt = L.nowIso();
          L.bumpVersion(rec);
          L.audit(ctx.db, {
            module: MODULE, action: 'void', targetId: rec.code, operator: ctx.operator, reason,
            before, after: { status: rec.status }, requestId: ctx.requestId, id: operationId,
          });
          ctx.save();
          return { code: codeDto(rec), operationId };
        }

        // export：返回完整码面（导出动作强审计）
        const batchId = ctx.body.batchId || null;
        let codes = (ctx.db.activationCodes || []).slice();
        if (batchId) codes = codes.filter((c) => c.batchId === batchId);
        L.audit(ctx.db, {
          module: MODULE, action: 'export', targetId: batchId || 'ALL', operator: ctx.operator, reason,
          before: null, after: { count: codes.length }, requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return {
          operationId,
          count: codes.length,
          codes: codes.map((c) => codeDto(c, { reveal: true })),
        };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, codeDto, ensureBatches };
