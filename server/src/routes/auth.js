const express = require('express');
const crypto = require('node:crypto');
const db = require('../db');
const sms = require('../utils/sms');
const token = require('../utils/token');
const { isValidPhone, isValidPassword, isValidInviteCode } = require('../utils/validate');
const { randomNickname } = require('../utils/nickname');
const { GRADES, AVATARS, OUTFITS } = require('./options');

const router = express.Router();

/** 发送频率限制：同一手机号 60 秒内只能发一次 */
function tooFrequent(phone) {
  const row = db.prepare(
    `SELECT created_at FROM sms_codes WHERE phone = ? ORDER BY id DESC LIMIT 1`
  ).get(phone);
  if (!row) return false;
  return Date.now() - new Date(row.created_at.replace(' ', 'T')).getTime() < 60 * 1000;
}

/**
 * POST /api/sms/send  发送短信验证码
 * body: { phone, scene? }   scene: register（默认，注册）/ reset（重置密码）
 */
router.post('/sms/send', async (req, res) => {
  const { phone, scene = 'register' } = req.body || {};
  if (!isValidPhone(phone)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PHONE', message: '手机号格式不正确' });
  }
  if (scene !== 'register' && scene !== 'reset') {
    return res.status(400).json({ ok: false, code: 'INVALID_SCENE', message: '验证码场景不正确' });
  }
  // 重置密码场景：仅已注册手机号可发码
  if (scene === 'reset' && !db.prepare(`SELECT id FROM users WHERE phone = ?`).get(phone)) {
    return res.status(404).json({ ok: false, code: 'PHONE_NOT_EXISTS', message: '该手机号尚未注册' });
  }
  if (tooFrequent(phone)) {
    return res.status(429).json({ ok: false, code: 'TOO_FREQUENT', message: '发送太频繁，请 60 秒后再试' });
  }
  const { code, ttl } = await sms.send(phone);
  db.prepare(`INSERT INTO sms_codes (phone, code, expires_at, scene) VALUES (?, ?, ?, ?)`)
    .run(phone, code, Date.now() + ttl, scene);
  // devCode 仅开发模式返回，生产环境删除该字段
  res.json({ ok: true, message: '验证码已发送', ttl, devCode: code });
});

/**
 * 校验验证码（不消耗）：返回 { record } 或 { error }
 * scene 用于场景隔离：register 的码不能用于 reset，反之亦然
 */
function checkCode(phone, smsCode, scene = 'register') {
  const record = db.prepare(
    `SELECT * FROM sms_codes WHERE phone = ? AND used = 0 AND scene = ? ORDER BY id DESC LIMIT 1`
  ).get(phone, scene);
  if (!record) return { error: { status: 400, code: 'CODE_NOT_FOUND', message: '请先获取验证码' } };
  if (Date.now() > record.expires_at) return { error: { status: 400, code: 'CODE_EXPIRED', message: '验证码已过期，请重新获取' } };
  if (String(smsCode) !== record.code) return { error: { status: 400, code: 'CODE_WRONG', message: '验证码错误' } };
  return { record };
}

/**
 * POST /api/auth/sms/verify  校验验证码是否正确（不消耗验证码，供"密码解锁"用）
 * body: { phone, smsCode, scene? }   scene 需与发码时一致（默认 register）
 */
router.post('/auth/sms/verify', (req, res) => {
  const { phone, smsCode, scene = 'register' } = req.body || {};
  if (!isValidPhone(phone)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PHONE', message: '手机号格式不正确' });
  }
  const { error } = checkCode(phone, smsCode, scene);
  if (error) return res.status(error.status).json({ ok: false, code: error.code, message: error.message });
  res.json({ ok: true, message: '验证码正确' });
});

/**
 * GET /api/auth/nickname/random  随机生成昵称（固定格式 xxx鱼）
 */
router.get('/auth/nickname/random', (req, res) => {
  res.json({ ok: true, nickname: randomNickname() });
});

/**
 * POST /api/auth/register  注册并登录（两页流程：第一页手机号/验证码/密码，第二页形象信息）
 * body: { phone, smsCode, password, confirmPassword,
 *         inviteCode?, province?, city?,
 *         nickname?, gender, avatar?, outfit?, grade? }
 */
router.post('/auth/register', (req, res) => {
  const {
    phone, smsCode, password, confirmPassword,
    inviteCode = '', province = '', city = '',
    nickname = '', gender = '', avatar = '', outfit = '', grade = '',
  } = req.body || {};

  if (!isValidPhone(phone))   return res.status(400).json({ ok: false, code: 'INVALID_PHONE', message: '手机号格式不正确' });
  if (!isValidInviteCode(inviteCode)) return res.status(400).json({ ok: false, code: 'INVALID_INVITE', message: '邀请码格式不正确' });
  if (!isValidPassword(password)) return res.status(400).json({ ok: false, code: 'WEAK_PASSWORD', message: '密码需 8-20 位且同时包含字母和数字' });
  if (password !== confirmPassword) return res.status(400).json({ ok: false, code: 'PWD_MISMATCH', message: '两次输入的密码不一致' });

  const { error, record } = checkCode(phone, smsCode);
  if (error) return res.status(error.status).json({ ok: false, code: error.code, message: error.message });

  // 形象信息校验：性别必填；头像/装扮必须属于对应性别的库；年级须在列表内
  if (!['male', 'female'].includes(gender)) {
    return res.status(400).json({ ok: false, code: 'INVALID_GENDER', message: '请选择性别' });
  }
  if (avatar && !AVATARS[gender].some((a) => a.key === avatar)) {
    return res.status(400).json({ ok: false, code: 'INVALID_AVATAR', message: '头像不存在或与性别不匹配' });
  }
  if (outfit && !OUTFITS[gender].some((o) => o.key === outfit)) {
    return res.status(400).json({ ok: false, code: 'INVALID_OUTFIT', message: '装扮不存在或与性别不匹配' });
  }
  if (grade && !GRADES.includes(grade)) {
    return res.status(400).json({ ok: false, code: 'INVALID_GRADE', message: '年级不正确' });
  }
  const finalNickname = String(nickname).trim() || randomNickname();
  if (finalNickname.length > 20) {
    return res.status(400).json({ ok: false, code: 'INVALID_NICKNAME', message: '昵称最长 20 字' });
  }

  if (db.prepare(`SELECT id FROM users WHERE phone = ?`).get(phone)) {
    return res.status(409).json({ ok: false, code: 'PHONE_EXISTS', message: '该手机号已注册，请直接登录' });
  }

  // scrypt 加盐哈希存储密码
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = crypto.scryptSync(password, salt, 64).toString('hex');

  const info = db.prepare(
    `INSERT INTO users (phone, password_hash, salt, invite_code, province, city,
                        nickname, gender, avatar, outfit, grade)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(phone, passwordHash, salt, inviteCode.toUpperCase(), province, city,
        finalNickname, gender, avatar, outfit, grade);

  // 验证码置为已使用
  db.prepare(`UPDATE sms_codes SET used = 1 WHERE id = ?`).run(record.id);

  const user = {
    id: Number(info.lastInsertRowid), phone,
    nickname: finalNickname, gender, avatar, outfit, grade,
  };
  res.json({
    ok: true,
    message: '注册成功',
    token: token.sign({ uid: user.id, phone }),
    expiresIn: token.TTL_MS,
    user,
  });
});

/**
 * POST /api/auth/login  手机号 + 密码登录（供后续使用）
 */
router.post('/auth/login', (req, res) => {
  const { phone, password } = req.body || {};
  if (!isValidPhone(phone) || !password) {
    return res.status(400).json({ ok: false, message: '参数错误' });
  }
  const user = db.prepare(`SELECT * FROM users WHERE phone = ?`).get(phone);
  if (!user) return res.status(401).json({ ok: false, message: '账号或密码错误' });
  const hash = crypto.scryptSync(password, user.salt, 64).toString('hex');
  const ok = crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(user.password_hash));
  if (!ok) return res.status(401).json({ ok: false, message: '账号或密码错误' });
  res.json({
    ok: true,
    token: token.sign({ uid: user.id, phone: user.phone }),
    expiresIn: token.TTL_MS,
    user: { id: user.id, phone: user.phone, nickname: user.nickname },
  });
});

/** 简单鉴权中间件：需要登录的接口挂上 */
function authRequired(req, res, next) {
  const raw = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const payload = token.verify(raw);
  if (!payload) return res.status(401).json({ ok: false, message: '登录已过期，请重新登录' });
  req.user = payload;
  next();
}

/**
 * GET /api/auth/me  获取当前登录用户信息
 */
router.get('/auth/me', authRequired, (req, res) => {
  const user = db.prepare(
    `SELECT id, phone, nickname, gender, avatar, outfit, grade, invite_code, province, city, created_at
     FROM users WHERE id = ?`
  ).get(req.user.uid);
  if (!user) return res.status(404).json({ ok: false, message: '用户不存在' });
  res.json({ ok: true, user });
});

/**
 * POST /api/auth/password/reset  忘记密码：校验验证码后重置密码
 * body: { phone, smsCode, password, confirmPassword }
 *
 * 服务端完整重校验（不信任前端）：
 *   1. 手机号格式      → INVALID_PHONE
 *   2. 密码强度        → WEAK_PASSWORD
 *   3. 两次密码一致    → PWD_MISMATCH
 *   4. 验证码（scene=reset）校验 → CODE_NOT_FOUND / CODE_EXPIRED / CODE_WRONG
 *   5. 账号存在性      → PHONE_NOT_EXISTS
 * 成功后：验证码立即置为已使用（一次性），更新 scrypt 哈希，不返回 token
 */
router.post('/auth/password/reset', (req, res) => {
  const { phone, smsCode, password, confirmPassword } = req.body || {};

  if (!isValidPhone(phone)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PHONE', message: '手机号格式不正确' });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ ok: false, code: 'WEAK_PASSWORD', message: '密码需 8-20 位且同时包含字母和数字' });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ ok: false, code: 'PWD_MISMATCH', message: '两次输入的密码不一致' });
  }

  const { error, record } = checkCode(phone, smsCode, 'reset');
  if (error) return res.status(error.status).json({ ok: false, code: error.code, message: error.message });

  const user = db.prepare(`SELECT id, salt FROM users WHERE phone = ?`).get(phone);
  if (!user) return res.status(404).json({ ok: false, code: 'PHONE_NOT_EXISTS', message: '该手机号尚未注册' });

  // 生成新盐 + 新哈希
  const newSalt = crypto.randomBytes(16).toString('hex');
  const newHash = crypto.scryptSync(password, newSalt, 64).toString('hex');
  db.prepare(`UPDATE users SET password_hash = ?, salt = ? WHERE id = ?`).run(newHash, newSalt, user.id);

  // 验证码一次性消耗
  db.prepare(`UPDATE sms_codes SET used = 1 WHERE id = ?`).run(record.id);

  res.json({ ok: true, message: '密码修改成功' });
});

module.exports = router;
