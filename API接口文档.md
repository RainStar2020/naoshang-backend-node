# 脑商AI — 注册模块 API 接口文档

> 版本：v2.0.0（仅保留「两页式注册」相关接口，公告/管理端接口已全部移除）
> 后端：Node.js 22 + Express + SQLite（`node:sqlite`）
> Base URL：`http://localhost:3000`（线上替换为已备案 https 域名）

---

## 1. 通用约定

### 请求
- 所有接口（`/api/health` 除外）请求体为 JSON，`Content-Type: application/json`。
- 需要登录态的接口在 Header 带：`Authorization: Bearer <token>`。

### 响应
成功：
```json
{ "ok": true, "message": "提示", "...": {} }
```
失败（HTTP 状态码随错误类型变化，业务码见 `code`）：
```json
{ "ok": false, "code": "错误码", "message": "中文提示" }
```

### 错误码一览
| code | HTTP | 含义 |
|---|---|---|
| `INVALID_PHONE` | 400 | 手机号格式不正确 |
| `TOO_FREQUENT` | 429 | 验证码发送太频繁（60 秒内只能发一次） |
| `CODE_NOT_FOUND` | 400 | 请先获取验证码 |
| `CODE_EXPIRED` | 400 | 验证码已过期（5 分钟有效） |
| `CODE_WRONG` | 400 | 验证码错误 |
| `WEAK_PASSWORD` | 400 | 密码需 8–20 位且同时含字母和数字 |
| `PWD_MISMATCH` | 400 | 两次输入的密码不一致 |
| `PHONE_EXISTS` | 409 | 该手机号已注册 |
| `INVALID_INVITE` | 400 | 邀请码格式不正确（6–10 位字母数字，可空） |
| `INVALID_GENDER` | 400 | 性别只能是 `male` / `female` |
| `INVALID_AVATAR` | 400 | 头像不存在或与性别不匹配 |
| `INVALID_OUTFIT` | 400 | 装扮不存在或与性别不匹配 |
| `INVALID_GRADE` | 400 | 年级不在可选列表内 |
| `INVALID_NICKNAME` | 400 | 昵称最长 20 字 |

---

## 2. 接口清单

### 2.1 健康检查
`GET /api/health`
```json
{ "ok": true, "service": "naoshang-ai", "time": 1700000000000 }
```

### 2.2 发送短信验证码
`POST /api/sms/send`

请求：
```json
{ "phone": "13800138000" }
```
响应：
```json
{ "ok": true, "message": "验证码已发送", "ttl": 300000, "devCode": "123456" }
```
> `devCode` 仅开发模式返回，方便联调；**生产环境务必删除该字段**（见 `src/utils/sms.js`）。

### 2.3 校验验证码（不消耗）
`POST /api/auth/sms/verify`

用于注册第一页「输入验证码解锁密码框」：只校验是否正确，**不标记为已使用**（防止输错密码导致验证码作废）。
请求：
```json
{ "phone": "13800138000", "smsCode": "123456" }
```
响应：
```json
{ "ok": true, "message": "验证码正确" }
```
或错误：`CODE_WRONG` / `CODE_EXPIRED` / `CODE_NOT_FOUND`。

### 2.4 获取随机昵称
`GET /api/auth/nickname/random`
```json
{ "ok": true, "nickname": "摘星的鱼" }
```

### 2.5 注册并登录（两页式流程最后一环）
`POST /api/auth/register`

请求：
```json
{
  "phone": "13800138000",
  "smsCode": "123456",
  "password": "abc12345",
  "confirmPassword": "abc12345",
  "inviteCode": "",            // 可选
  "province": "", "city": "",  // 可选（选填）
  "nickname": "",              // 可选，留空则后端自动生成「xxx鱼」
  "gender": "female",          // 必填：male / female
  "avatar": "girl-sport",      // 可选，必须是对应性别库里的 key
  "outfit": "f-dress",         // 可选，必须是对应性别库里的 key
  "grade": "三年级"            // 可选，必须是年级列表里的值（默认三年级）
}
```
响应：
```json
{
  "ok": true,
  "message": "注册成功",
  "token": "<jwt风格token>",
  "expiresIn": 604800000,
  "user": {
    "id": 1, "phone": "13800138000", "nickname": "摘星的鱼",
    "gender": "female", "avatar": "girl-sport", "outfit": "f-dress", "grade": "三年级"
  }
}
```
> 校验顺序（前端可逐步提示）：手机号 → 验证码 → 密码强度 → 两次一致 → 性别/头像/装扮/年级合法性 → 是否已注册。
> 头像/装扮与性别强绑定：女只能用女装扮（`INVALID_OUTFIT`），男同理。

### 2.6 登录（手机号 + 密码）
`POST /api/auth/login`

请求：
```json
{ "phone": "13800138000", "password": "abc12345" }
```
响应：
```json
{
  "ok": true,
  "token": "<token>",
  "expiresIn": 604800000,
  "user": { "id": 1, "phone": "13800138000", "nickname": "摘星的鱼" }
}
```

### 2.7 获取当前用户信息
`GET /api/auth/me`  Header：`Authorization: Bearer <token>`

响应：
```json
{
  "ok": true,
  "user": {
    "id": 1, "phone": "13800138000", "nickname": "摘星的鱼",
    "gender": "female", "avatar": "girl-sport", "outfit": "f-dress", "grade": "三年级",
    "invite_code": "", "province": "", "city": "", "created_at": "2026-10-21 12:00:00"
  }
}
```

### 2.8 注册第二页可选项配置
`GET /api/profile/options`

返回头像库、装扮库（按性别分组）、年级列表及默认年级。
```json
{
  "ok": true,
  "grades": ["一年级","二年级","三年级","四年级","五年级","六年级","初一","初二","初三","高一","高二","高三"],
  "defaultGrade": "三年级",
  "avatars": {
    "male":   [ { "key":"boy-sport",  "label":"运动少年", "emoji":"👦" }, ... ],
    "female": [ { "key":"girl-sport", "label":"元气少女", "emoji":"👧" }, ... ]
  },
  "outfits": {
    "male":   [ { "key":"m-sport",  "label":"篮球达人", "emoji":"🏀" }, ... ],
    "female": [ { "key":"f-dress",  "label":"甜美裙装", "emoji":"👗" }, ... ]
  }
}
```
> `emoji` 为占位，接入 3D 形象/第三方素材后替换为真实图片 URL，前端按 `key` 取值即可。

---

## 3. 前端调用示例（小程序）

```js
// utils/request.js
const baseUrl = 'http://localhost:3000';
function request(path, method, data, token) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: baseUrl + path, method, data,
      header: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      success: (res) => {
        const body = res.data;
        if (body && body.ok) resolve(body);
        else reject(body || { ok: false, message: '网络错误' });
      },
      fail: () => reject({ ok: false, message: '网络错误' }),
    });
  });
}

// 第一页：发码
await request('/api/sms/send', 'POST', { phone });
// 第一页：校验验证码解锁密码
await request('/api/auth/sms/verify', 'POST', { phone, smsCode });
// 第二页：拉取可选项
const opt = await request('/api/profile/options', 'GET');
// 第二页：注册并登录
const r = await request('/api/auth/register', 'POST', { phone, smsCode, password, confirmPassword, gender, avatar, outfit, grade, nickname });
wx.setStorageSync('token', r.token);
```

---

## 4. 上线前必做（生产清单）
- [ ] `src/utils/sms.js` 替换为真实短信通道（腾讯云/阿里云 SMS），删除响应中的 `devCode`
- [ ] 设置环境变量 `AUTH_SECRET`（token 签名密钥），不要用默认值
- [ ] 后端部署到**已备案的 https 域名**，并更新 `miniprogram/app.js` 里的 `baseUrl`；在微信公众平台配置 request 合法域名
- [ ] HTTPS 证书 + Nginx 反向代理
- [ ] 如需邀请码奖励机制，补一张 invites 关联表（当前仅存储用户的邀请码字符串）
