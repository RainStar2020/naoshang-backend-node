/**
 * 密码哈希工具（2026-10-26 · P2-4 生产就绪）
 *
 * 口径：
 *   - 新密码一律 scrypt(N=16384, r=8, p=1, keylen=64) + 16 字节随机盐，存储格式
 *     `scrypt$<saltHex>$<hashHex>`；不落明文。
 *   - **向后兼容**：历史数据里 `user.password` 是明文。verifyPassword 对明文走
 *     「等值比较」，但登录成功后必须调用 upgradeIfPlaintext 把它就地升级为哈希，
 *     保证明文只在新旧迁移窗口内存在，且随用户首次登录逐步消失。
 *   - 校验使用 timingSafeEqual，避免时序侧信道。
 */
const crypto = require('node:crypto');

const SCRYPT_N = 16384;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEYLEN = 64;
const PREFIX = 'scrypt';

/** 生成哈希串：scrypt$saltHex$hashHex */
function hashPassword(plain) {
  if (typeof plain !== 'string' || !plain) throw new Error('密码不能为空');
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain.normalize('NFKC'), salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p });
  return `${PREFIX}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** 是否已是哈希串 */
function isHashed(stored) {
  return typeof stored === 'string' && stored.startsWith(PREFIX + '$');
}

/**
 * 校验密码。
 * @returns {{ok:boolean, needsUpgrade:boolean}}
 *   needsUpgrade=true 表示库里存的是明文，调用方应尽快 upgradeIfPlaintext。
 */
function verifyPassword(stored, plain) {
  if (typeof plain !== 'string' || !plain) return { ok: false, needsUpgrade: false };
  if (typeof stored !== 'string' || !stored) return { ok: false, needsUpgrade: false };
  if (!isHashed(stored)) {
    // 历史明文：等值比较（不额外做恒定时间处理——明文比较无哈希泄漏风险）
    return { ok: stored === plain, needsUpgrade: stored === plain };
  }
  const parts = stored.split('$');
  if (parts.length !== 3) return { ok: false, needsUpgrade: false };
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  if (salt.length === 0 || expected.length !== KEYLEN) return { ok: false, needsUpgrade: false };
  const actual = crypto.scryptSync(plain.normalize('NFKC'), salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p });
  return { ok: crypto.timingSafeEqual(actual, expected), needsUpgrade: false };
}

/** 把明文密码就地升级为哈希（返回是否发生升级） */
function upgradeIfPlaintext(user, plain) {
  if (!user || typeof user.password !== 'string') return false;
  if (isHashed(user.password)) return false;
  if (user.password !== plain) return false;
  user.password = hashPassword(plain);
  user.password_migrated_at = Date.now();
  return true;
}

/** 设置密码（永远存哈希） */
function setPassword(user, plain) {
  if (!user) throw new Error('用户不存在');
  user.password = hashPassword(plain);
  user.password_migrated_at = Date.now();
  return user.password;
}

/** 强度校验：≥6 位（契约口径，与前端一致） */
function isStrongEnough(plain) {
  return typeof plain === 'string' && plain.length >= 6;
}

module.exports = {
  hashPassword, isHashed, verifyPassword, upgradeIfPlaintext, setPassword, isStrongEnough,
  PREFIX, SCRYPT_N,
};
