/**
 * 短信服务：开发期 Mock（验证码写库并在响应中返回 devCode）
 * 生产环境：把 send() 换成腾讯云/阿里云 SMS SDK 调用即可，其余逻辑不用动
 */
const crypto = require('node:crypto');

const CODE_TTL_MS = 5 * 60 * 1000; // 5 分钟有效

function generateCode() {
  return String(crypto.randomInt(100000, 999999));
}

async function send(phone) {
  const code = generateCode();
  // TODO 生产环境替换为真实短信通道，例如：
  // const smsClient = new SmsClient({ credential: { secretId, secretKey } });
  // await smsClient.SendSms({ PhoneNumberSet: [`+86${phone}`], TemplateID: 'xxx', ... });
  console.log(`[SMS][MOCK] 向 ${phone} 发送验证码：${code}（${CODE_TTL_MS / 60000} 分钟内有效）`);
  return { code, ttl: CODE_TTL_MS };
}

module.exports = { send, generateCode, CODE_TTL_MS };
