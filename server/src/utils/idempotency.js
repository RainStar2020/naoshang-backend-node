/**
 * 脑商AI · 幂等键统一处理（前端反馈问题 8：同幂等键不同参数的处理未说明）
 *
 * ════════════════════════════════════════════════════════════════
 * 一、口径（此前各端点各写各的，行为不一致）
 * ════════════════════════════════════════════════════════════════
 *   旧行为：端点里 `find(x => x.idempotencyKey === key)`，命中就直接返回原结果，
 *          **完全不看参数是否一致**。
 *          → 后果：前端用同一个幂等键，但改了金额/受益人/比例，服务端会静默返回**旧的那条**结果，
 *            用户以为改成功了，实际没改（典型「静默丢单」）。
 *
 * 二、新口径
 * ════════════════════════════════════════════════════════════════
 *   同一个幂等键 + **相同**参数 → 视为重试，返回原结果（HTTP 200，幂等成功）
 *   同一个幂等键 + **不同**参数 → 视为参数冲突，拒绝（HTTP 409），错误信息明确指出冲突字段
 *
 * 三、参数指纹怎么算
 * ════════════════════════════════════════════════════════════════
 *   · 只对**业务语义字段**取指纹（金额、数量、对象、比例等），不含幂等键本身、时间戳等。
 *   · 字段顺序无关：统一按 key 排序后序列化。
 *   · 字段值做归一：undefined/null 视为等价；数字按字符串比较（避免 100 与 '100' 误判冲突）。
 */

const crypto = require('crypto');

/** 归一化一个值：undefined/null → null；数字 → 去尾零的字符串；对象/数组 → 稳定序列化 */
function normalize(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') return stableStringify(v);
  return String(v);
}

/** 稳定序列化（key 排序） */
function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(normalize(obj));
  if (Array.isArray(obj)) return '[' + obj.map((x) => stableStringify(x)).join(',') + ']';
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

/**
 * 计算参数指纹
 * @param {object} payload 业务参数字段（平铺或嵌套均可）
 * @returns {string} 形如 sha256:xxxxxxxx（32 位十六进制）
 */
function fingerprint(payload = {}) {
  const norm = {};
  for (const k of Object.keys(payload).sort()) norm[k] = normalize(payload[k]);
  const s = stableStringify(norm);
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);
}

/**
 * 找出幂等键对应的既有记录
 * @param {Array} list 集合
 * @param {string} key idempotencyKey
 * @param {string} [field='idempotencyKey'] 幂等键字段名
 */
function findByKey(list, key, field = 'idempotencyKey') {
  if (!key || !Array.isArray(list)) return null;
  return list.find((x) => x && x[field] === key) || null;
}

/**
 * 统一的幂等判定
 *
 * @param {object} opt {
 *   list: Array,             // 集合
 *   key: string,             // idempotencyKey
 *   payload: object,         // 业务语义参数（用于指纹比较）
 *   field?: string,          // 幂等键字段名，默认 idempotencyKey
 *   fpField?: string,        // 指纹存储字段名，默认 idempotencyFingerprint
 * }
 * @returns {{duplicated:boolean, record:object|null, conflict:boolean, conflictReason:string|null, fingerprint:string}}
 */
function check(opt) {
  const { list, key, payload = {} } = opt;
  const field = opt.field || 'idempotencyKey';
  const fpField = opt.fpField || 'idempotencyFingerprint';
  const fp = fingerprint(payload);
  if (!key) return { duplicated: false, record: null, conflict: false, conflictReason: null, fingerprint: fp };
  const rec = findByKey(list, key, field);
  if (!rec) return { duplicated: false, record: null, conflict: false, conflictReason: null, fingerprint: fp };
  // 旧记录没有指纹（历史数据）→ 视为一致，放行（不因历史数据把正常重试拒掉）
  const oldFp = rec[fpField];
  if (!oldFp) return { duplicated: true, record: rec, conflict: false, conflictReason: null, fingerprint: fp };
  if (oldFp !== fp) {
    const diff = diffFields(payload, rec.__idempotencyPayload || null);
    const err = new Error(`同一 idempotencyKey 已用于不同的请求参数${diff ? `（差异字段：${diff}）` : ''}，请更换幂等键`);
    err.code = 'IDEMPOTENCY_CONFLICT';
    err.status = 409;
    return {
      duplicated: true, record: rec, conflict: true,
      conflictReason: err.message,
      error: err,
      fingerprint: fp,
    };
  }
  return { duplicated: true, record: rec, conflict: false, conflictReason: null, fingerprint: fp };
}

/** 找出两个 payload 的差异字段名（尽力而为：需要双方原始 payload 才有意义） */
function diffFields(a, b) {
  if (!a || !b) return null;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const diff = [...keys].filter((k) => stableStringify(a[k]) !== stableStringify(b[k]));
  return diff.length ? diff.join('、') : null;
}

/**
 * 在新记录上打上幂等指纹（创建时调用）
 * 若记录里带了临时字段 __idemPayload，则以它为语义参数计算指纹，并移除临时字段。
 */
function stamp(rec, payload = null, fpField = 'idempotencyFingerprint') {
  if (!rec) return rec;
  const p = payload || rec.__idemPayload || {};
  rec[fpField] = fingerprint(p);
  if (rec.__idempotencyPayload === undefined) {
    try { rec.__idempotencyPayload = JSON.parse(JSON.stringify(p)); } catch (e) { rec.__idempotencyPayload = null; }
  }
  delete rec.__idemPayload;
  return rec;
}

module.exports = { fingerprint, findByKey, check, stamp, diffFields, stableStringify, normalize };
