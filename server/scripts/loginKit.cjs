'use strict';
/**
 * 家长登录（账号密码登录：手机号 + 密码）。
 *
 * 各 verify 脚本复用：POST /auth/sessions { phone, password, channel: 'parent' } 即得 token。
 *
 * 2026-10-28 起后端不再支持「仅凭手机号免密登录」，必须同时提供 password。
 * 为了让存量 verify 脚本（多数登录 1380000000X 等夹具账号）无需逐个改调用签名，
 * 这里允许省略 password 参数并回落到统一的测试密码 TEST_LOGIN_PASSWORD。
 *
 * @param {Function} req 签名 (method, path, { token, body }) => Promise<{ status, data }>
 * @param {string} phone
 * @param {string} [password] 不传则用 TEST_LOGIN_PASSWORD
 * @returns {Promise<{status:number,data:any}>}
 */

/**
 * 夹具账号 / 种子账号的统一测试密码。
 *
 * ⚠️ 必须与 server.js 的 SEED_USER_PASSWORD 完全一致，否则 verify 脚本会登录失败
 *    （登录已改为必须带 password，两端口令不一致 → 401/400）。
 *    server.js: SEED_USER_PASSWORD = process.env.SEED_USER_PASSWORD || 'Naoshang@2026'
 */
const TEST_LOGIN_PASSWORD = process.env.SEED_USER_PASSWORD || process.env.SEED_PASSWORD || 'Naoshang@2026';

async function parentLogin(req, phone, password) {
  return req('POST', '/auth/sessions', {
    body: {
      phone,
      password: password !== undefined && password !== null ? password : TEST_LOGIN_PASSWORD,
      channel: 'parent',
    },
  });
}

module.exports = { parentLogin, TEST_LOGIN_PASSWORD };
