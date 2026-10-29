/**
 * 脑商AI合伙人 · 总部后台 · HQ-15 支付对账（Payments）
 *
 * 契约：《总部后台API需求文档.md》§17
 *
 * 库表对照：
 *   - 支付单（既有、托管）：db.payments
 *   - 渠道配置（后台专属）：db.hqPaymentsChannels
 *   - 异步任务（后台专属）：db.hqPaymentJobs
 *   - 对账差异（后台专属）：db.hqReconciliation
 *
 * 金额单位：元。
 * 敏感：渠道商户密钥不落库、不回传；配置仅保存开关与元数据。
 */

const L = require('../lib');

const MODULE = 'payments';
const CODE = 'HQ-15';
const TITLE = '支付对账';

const PLATFORMS = ['MINI_PROGRAM', 'H5'];
const BUSINESSES = ['MALL', 'MEMBERSHIP', 'BUSINESS'];
const CHANNELS = ['WECHAT', 'ALIPAY'];
const PAY_STATUS = ['WAITING', 'SUCCESS', 'CLOSED'];
const DIFF_REASON = ['CHANNEL_ONLY', 'LOCAL_ONLY', 'AMOUNT_MISMATCH', 'STATUS_MISMATCH', 'TRADE_NO_MISMATCH'];

/** 支付单 status → 契约枚举 */
function toEnumStatus(p) {
  if (p.status === 'paid' || p.status === 'success' || p.status === 'SUCCESS') return 'SUCCESS';
  if (p.status === 'closed' || p.status === 'cancelled' || p.status === 'CLOSED') return 'CLOSED';
  return 'WAITING';
}

function channelDto(c) {
  return {
    configId: c.id,
    platform: c.platform || 'MINI_PROGRAM',
    business: c.business || 'MALL',
    channel: c.channel || 'WECHAT',
    enabled: c.enabled !== false,
    version: Number(c.version || 1),
  };
}

function paymentDto(p) {
  const meta = p.meta || {};
  return {
    paymentId: p.id,
    orderId: p.bizId || null,
    orderNo: p.bizId || null,
    accountId: p.userId || null,
    channel: meta.channel || p.channel || 'WECHAT',
    platform: meta.platform || 'MINI_PROGRAM',
    business: p.bizType || 'MALL',
    status: toEnumStatus(p),
    amount: L.money(p.amount || 0),
    paidAt: L.toIso(p.paidAt),
    channelTradeNo: p.transactionId || null,
    statementDate: meta.statementDate || (p.paidAt ? String(p.paidAt).slice(0, 10) : null),
    verification: meta.verification || null,
    subject: p.subject || null,
    version: Number(p.version || 1),
  };
}

/** 简单 CSV 解析（对账文件用） */
function parseCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return [];
  const head = lines[0].split(',').map((s) => s.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((s) => s.trim());
    const o = {};
    head.forEach((h, i) => { o[h] = cells[i]; });
    return o;
  });
}

const routes = [
  // ── 渠道配置 + 最近任务 + 审计 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/payments/catalog',
    async handler(ctx) {
      return {
        channels: (ctx.db.hqPaymentsChannels || []).map(channelDto),
        platforms: PLATFORMS.map((s) => ({ value: s, label: s })),
        businesses: BUSINESSES.map((s) => ({ value: s, label: s })),
        paymentChannels: CHANNELS.map((s) => ({ value: s, label: s })),
        statuses: PAY_STATUS.map((s) => ({ value: s, label: s })),
        recentJobs: (ctx.db.hqPaymentJobs || []).slice(-10).reverse(),
        audit: (ctx.db.hqAuditLogs || []).filter((a) => a.module === MODULE).slice(0, 30),
        summary: { total: (ctx.db.payments || []).length },
      };
    },
  },

  // ── 支付单分页 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/payments',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const status = ctx.query.get('status') || '';
      const channel = ctx.query.get('channel') || '';
      const business = ctx.query.get('business') || '';
      let list = (ctx.db.payments || []).slice();
      if (keyword) list = list.filter((p) => L.matchKeyword(keyword, p.id, p.bizId, p.userId, p.transactionId));
      if (status) list = list.filter((p) => toEnumStatus(p) === status);
      if (channel) list = list.filter((p) => (p.meta && p.meta.channel ? p.meta.channel : p.channel) === channel);
      if (business) list = list.filter((p) => (p.bizType || 'MALL') === business);
      list.sort((a, b) => String(b.id).localeCompare(String(a.id)));
      const all = ctx.db.payments || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(paymentDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        success: all.filter((p) => toEnumStatus(p) === 'SUCCESS').length,
        totalAmount: L.money(all.filter((p) => toEnumStatus(p) === 'SUCCESS').reduce((a, p) => a + Number(p.amount || 0), 0)),
      });
    },
  },

  // ── 支付详情 + attempts ──
  {
    module: MODULE,
    method: 'GET',
    path: '/payments/:paymentId',
    async handler(ctx) {
      const p = (ctx.db.payments || []).find((x) => x.id === ctx.params.paymentId);
      if (!p) throw L.err(L.ERR.NOT_FOUND, '支付单不存在：' + ctx.params.paymentId);
      const attempts = (ctx.db.hqPaymentJobs || []).filter((j) => j.paymentId === p.id);
      return { payment: paymentDto(p), attempts };
    },
  },

  // ── 异步任务结果 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/payments/jobs/:jobId',
    async handler(ctx) {
      const j = (ctx.db.hqPaymentJobs || []).find((x) => x.id === ctx.params.jobId);
      if (!j) throw L.err(L.ERR.NOT_FOUND, '支付任务不存在：' + ctx.params.jobId);
      return { job: j };
    },
  },

  // ── 导出对账/流水 CSV 元数据 ──
  {
    module: MODULE,
    method: 'GET',
    path: '/payments/export',
    async handler(ctx) {
      const reason = ctx.query.get('reason') || '对账导出';
      const statementDate = ctx.query.get('statementDate') || null;
      const channel = ctx.query.get('channel') || null;
      let list = (ctx.db.payments || []).filter((p) => toEnumStatus(p) === 'SUCCESS');
      if (channel) list = list.filter((p) => (p.meta && p.meta.channel ? p.meta.channel : p.channel) === channel);
      const rows = list.map((p) => [
        p.id, p.bizId || '', p.userId || '', p.channel || 'WECHAT',
        p.bizType || 'MALL', toEnumStatus(p), L.money(p.amount || 0),
        p.transactionId || '', p.paidAt ? L.toIso(p.paidAt) : '', statementDate || '',
      ].join(','));
      const csv = ['paymentId,orderId,accountId,channel,business,status,amount,channelTradeNo,paidAt,statementDate']
        .concat(rows).join('\n');
      L.audit(ctx.db, {
        module: MODULE, action: 'export', targetId: statementDate || 'ALL', operator: ctx.operator,
        reason, before: null, after: { count: rows.length, channel, statementDate }, requestId: ctx.requestId,
      });
      ctx.save();
      return {
        fileName: `payments_${statementDate || 'all'}.csv`,
        contentType: 'text/csv; charset=utf-8',
        rowCount: rows.length,
        csv,
      };
    },
  },

  // ── save-channel / query / compensate / reconcile ──
  {
    module: MODULE,
    method: 'POST',
    path: '/payments/mutate',
    async handler(ctx) {
      const { action } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['save-channel', 'query', 'compensate', 'reconcile'], 'action');
      L.ensureCollections(ctx.db);

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'save-channel') {
          L.requireFields(ctx.body, ['platform', 'business', 'channel']);
          L.ensureEnum(ctx.body.platform, PLATFORMS, 'platform');
          L.ensureEnum(ctx.body.business, BUSINESSES, 'business');
          L.ensureEnum(ctx.body.channel, CHANNELS, 'channel');
          let cfg = null;
          if (ctx.body.configId) {
            cfg = ctx.db.hqPaymentsChannels.find((c) => c.id === ctx.body.configId);
            if (!cfg) throw L.err(L.ERR.NOT_FOUND, '渠道配置不存在：' + ctx.body.configId);
            L.checkVersion(ctx, cfg, ctx.body.version, '渠道配置');
          } else {
            cfg = { id: L.nextId(ctx.db, 'hqpc'), version: 1 };
            ctx.db.hqPaymentsChannels.push(cfg);
          }
          const before = { enabled: cfg.enabled };
          cfg.platform = ctx.body.platform;
          cfg.business = ctx.body.business;
          cfg.channel = ctx.body.channel;
          cfg.enabled = ctx.body.enabled === undefined ? cfg.enabled !== false : !!ctx.body.enabled;
          L.bumpVersion(cfg);
          L.audit(ctx.db, {
            module: MODULE, action: 'save-channel', targetId: cfg.id, operator: ctx.operator, reason,
            before, after: { enabled: cfg.enabled }, requestId: ctx.requestId, id: operationId,
          });
          ctx.save();
          return { configId: cfg.id, config: channelDto(cfg), operationId };
        }

        if (action === 'query' || action === 'compensate') {
          L.requireFields(ctx.body, ['paymentId']);
          const p = (ctx.db.payments || []).find((x) => x.id === ctx.body.paymentId);
          if (!p) throw L.err(L.ERR.NOT_FOUND, '支付单不存在：' + ctx.body.paymentId);
          const job = {
            id: L.nextId(ctx.db, 'hqjob'),
            type: action,
            paymentId: p.id,
            status: 'succeeded',
            message: action === 'query' ? '查单完成（沙箱直通）' : '补偿完成（沙箱直通）',
            result: { paymentId: p.id, status: toEnumStatus(p), amount: L.money(p.amount || 0) },
            createdAt: L.nowIso(),
          };
          ctx.db.hqPaymentJobs.push(job);
          L.audit(ctx.db, {
            module: MODULE, action, targetId: p.id, operator: ctx.operator, reason,
            before: null, after: { jobId: job.id }, requestId: ctx.requestId, id: operationId,
          });
          ctx.save();
          return { jobId: job.id, paymentId: p.id, operationId };
        }

        // reconcile：对账
        L.requireFields(ctx.body, ['csv']);
        const rows = parseCsv(ctx.body.csv);
        const local = (ctx.db.payments || []).filter((p) => toEnumStatus(p) === 'SUCCESS');
        const diffs = [];
        for (const r of rows) {
          const tradeNo = r.channelTradeNo || r.tradeNo || '';
          const amount = L.money(r.amount || 0);
          const hit = local.find((p) => p.transactionId === tradeNo);
          if (!hit) {
            diffs.push({ tradeNo, channelAmount: amount, localAmount: null, reason: 'CHANNEL_ONLY' });
            continue;
          }
          const localAmount = L.money(hit.amount || 0);
          if (Math.abs(localAmount - amount) > 0.001) {
            diffs.push({ tradeNo, channelAmount: amount, localAmount, reason: 'AMOUNT_MISMATCH' });
          } else if (toEnumStatus(hit) !== (r.status || 'SUCCESS').toUpperCase()) {
            diffs.push({ tradeNo, channelAmount: amount, localAmount, reason: 'STATUS_MISMATCH' });
          }
        }
        const channelTrades = new Set(rows.map((r) => r.channelTradeNo || r.tradeNo || ''));
        for (const p of local) {
          if (!channelTrades.has(p.transactionId)) {
            diffs.push({
              tradeNo: p.transactionId, channelAmount: null, localAmount: L.money(p.amount || 0),
              reason: 'LOCAL_ONLY',
            });
          }
        }
        const job = {
          id: L.nextId(ctx.db, 'hqjob'),
          type: 'reconcile',
          status: 'succeeded',
          statementDate: ctx.body.statementDate || null,
          channel: ctx.body.channel || null,
          fileName: ctx.body.fileName || null,
          totalRows: rows.length,
          differenceCount: diffs.length,
          differences: diffs,
          createdAt: L.nowIso(),
        };
        ctx.db.hqPaymentJobs.push(job);
        ctx.db.hqReconciliation = ctx.db.hqReconciliation || [];
        ctx.db.hqReconciliation.push({
          id: job.id, statementDate: job.statementDate, channel: job.channel,
          totalRows: job.totalRows, differences: diffs, createdAt: job.createdAt,
        });
        L.audit(ctx.db, {
          module: MODULE, action: 'reconcile', targetId: job.id, operator: ctx.operator, reason,
          before: null, after: { totalRows: rows.length, differenceCount: diffs.length },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { jobId: job.id, operationId, differenceCount: diffs.length, differences: diffs };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, paymentDto, channelDto };
