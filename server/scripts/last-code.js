/**
 * 开发辅助：查看最近发送的验证码
 * 用法：npm run sms:last            → 最近 10 条
 *       npm run sms:last -- 18224516229  → 只看该手机号
 */
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = path.join(__dirname, '..', 'data', 'brain_biz.db');
const phone = process.argv[2];

const db = new DatabaseSync(dbPath, { readOnly: true });
const rows = phone
  ? db.prepare(`SELECT * FROM sms_codes WHERE phone = ? ORDER BY id DESC LIMIT 10`).all(phone)
  : db.prepare(`SELECT * FROM sms_codes ORDER BY id DESC LIMIT 10`).all();

if (!rows.length) {
  console.log('暂无验证码记录（还没有调用过 /api/sms/send）');
  process.exit(0);
}

const now = Date.now();
console.log('手机号        验证码    场景       状态        发送时间');
console.log('-'.repeat(64));
for (const r of rows) {
  const expired = now > r.expires_at;
  const status = r.used ? '已使用' : expired ? '已过期' : `有效(${Math.ceil((r.expires_at - now) / 1000)}s)`;
  console.log(
    `${String(r.phone).padEnd(13)} ${String(r.code).padEnd(9)} ${String(r.scene).padEnd(10)} ${status.padEnd(12)} ${r.created_at}`
  );
}
