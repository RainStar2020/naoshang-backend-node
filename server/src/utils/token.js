/** 令牌：HMAC-SHA256 签名的 JWT 风格 token（无第三方依赖） */
const crypto = require('node:crypto');

const SECRET = process.env.AUTH_SECRET || 'naoshang-ai-dev-secret-change-me';
const TTL_MS = 7 * 24 * 3600 * 1000; // 7 天

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(payload) {
  const body = { ...payload, exp: Date.now() + TTL_MS };
  const data = b64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verify(token) {
  if (typeof token !== 'string') return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expect = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  const a = Buffer.from(sig); const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

module.exports = { sign, verify, TTL_MS };
