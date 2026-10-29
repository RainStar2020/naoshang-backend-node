/** 校验工具 */
const PHONE_RE = /^1[3-9]\d{9}$/;

function isValidPhone(phone) {
  return typeof phone === 'string' && PHONE_RE.test(phone);
}

/** 密码：8-20 位，须含字母和数字 */
function isValidPassword(pwd) {
  return typeof pwd === 'string' && pwd.length >= 8 && pwd.length <= 20
    && /[a-zA-Z]/.test(pwd) && /\d/.test(pwd);
}

/** 邀请码：6-10 位字母数字（可空） */
function isValidInviteCode(code) {
  if (code == null || code === '') return true;
  return typeof code === 'string' && /^[a-zA-Z0-9]{6,10}$/.test(code);
}

/** 防 XSS：存储前转义 < > & " ' */
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = { isValidPhone, isValidPassword, isValidInviteCode, escapeHtml };
