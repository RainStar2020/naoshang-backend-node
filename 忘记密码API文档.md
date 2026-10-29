# 脑商AI · 忘记密码模块 API 接口文档

- **版本**：v1.0.0
- **状态**：已实施（对应 `忘记密码模块规约.md` v1.0 已确认）
- **Base URL（开发）**：`http://127.0.0.1:3000/api`
- **Base URL（生产）**：`https://<已备案域名>/api`（部署后替换小程序 `app.js` 中的 `baseUrl`）
- **鉴权**：本模块 3 个接口均为**公开接口**，不需要 `Authorization` 头。

> 关联文档：注册模块接口见 `API接口文档.md`；本模块为独立新文档，不改动注册那份。

---

## 1. 通用约定

**请求**：`Content-Type: application/json`，参数放 JSON body。

**成功响应**：HTTP 2xx，且 `ok === true`

```json
{ "ok": true, "message": "..." }
```

**失败响应**：HTTP 4xx，且 `ok === false`

```json
{ "ok": false, "code": "错误码", "message": "可直接展示给用户的中文提示" }
```

> 前端统一用 `message` 做 toast 提示即可，无需自己映射错误码文案。

---

## 2. 接口一览

| # | 方法 | 路径 | 说明 | 是否新增 |
|---|---|---|---|---|
| 1 | POST | `/api/sms/send` | 发送短信验证码（新增 `scene` 参数） | 复用 + 小改 |
| 2 | POST | `/api/auth/sms/verify` | 校验验证码（只校验不消耗，加 `scene`） | 复用 + 小改 |
| 3 | POST | `/api/auth/password/reset` | 重置密码（校验后一次性消耗验证码） | **新增** |

**验证码场景隔离（`scene`）**

| scene | 含义 | 发码约束 |
|---|---|---|
| `register` | 注册（默认，行为与原先一致） | 无（新号码可发） |
| `reset` | 重置密码 | 手机号**必须已注册**，否则 `PHONE_NOT_EXISTS` |

注册码与重置码**互不可混用**：拿注册时收到的码去调重置接口，会因场景不匹配返回 `CODE_NOT_FOUND`。

---

## 3. 接口详情

### 3.1 发送短信验证码

`POST /api/sms/send`

**请求参数**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `phone` | string | 是 | 11 位手机号，`^1[3-9]\d{9}$` |
| `scene` | string | 否 | `register`（默认）｜`reset` |

**请求示例**

```json
{ "phone": "13800138000", "scene": "reset" }
```

**成功响应**

```json
{ "ok": true, "message": "验证码已发送", "ttl": 300000, "devCode": "481616" }
```

- `ttl`：验证码有效期（毫秒，当前 5 分钟）
- `devCode`：**仅开发模式返回**，生产接入真实短信通道后删除该字段（见 §5 待办）

**错误码**

| HTTP | code | 说明 |
|---|---|---|
| 400 | `INVALID_PHONE` | 手机号格式不正确 |
| 400 | `INVALID_SCENE` | 验证码场景不正确 |
| 404 | `PHONE_NOT_EXISTS` | 该手机号尚未注册（仅 `scene=reset`） |
| 429 | `TOO_FREQUENT` | 发送太频繁，请 60 秒后再试 |

---

### 3.2 校验验证码（不消耗）

`POST /api/auth/sms/verify`

用于「密码框门禁」与「下一步」前的校验：**只校验、不消耗验证码**，可被多次调用。

**请求参数**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `phone` | string | 是 | 11 位手机号 |
| `smsCode` | string | 是 | 6 位验证码 |
| `scene` | string | 否 | 需与发码时一致，默认 `register`；重置流程传 `reset` |

**请求示例**

```json
{ "phone": "13800138000", "smsCode": "481616", "scene": "reset" }
```

**成功响应**

```json
{ "ok": true, "message": "验证码正确" }
```

**错误码**

| HTTP | code | 说明 |
|---|---|---|
| 400 | `INVALID_PHONE` | 手机号格式不正确 |
| 400 | `CODE_NOT_FOUND` | 请先获取验证码（含场景不匹配） |
| 400 | `CODE_EXPIRED` | 验证码已过期，请重新获取 |
| 400 | `CODE_WRONG` | 验证码错误 |

---

### 3.3 重置密码（新增）

`POST /api/auth/password/reset`

**服务端完整重校验**（不信任前端页1结果），处理顺序：
手机号格式 → 密码强度 → 两次一致 → 验证码校验（**通过后立即消耗，一次性**）→ 账号存在性 → 更新 scrypt 哈希（重新加盐）。

**成功后不返回 token**，需用新密码重新登录。

**请求参数**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `phone` | string | 是 | 11 位手机号 |
| `smsCode` | string | 是 | 6 位验证码（`scene=reset` 发出的） |
| `password` | string | 是 | 新密码，8-20 位，需同时含字母和数字 |
| `confirmPassword` | string | 是 | 再次输入的新密码，须与 `password` 一致 |

**请求示例**

```json
{
  "phone": "13800138000",
  "smsCode": "481616",
  "password": "abc12345",
  "confirmPassword": "abc12345"
}
```

**成功响应**

```json
{ "ok": true, "message": "密码修改成功" }
```

**错误码**

| HTTP | code | 说明 |
|---|---|---|
| 400 | `INVALID_PHONE` | 手机号格式不正确 |
| 400 | `WEAK_PASSWORD` | 密码需 8-20 位且同时包含字母和数字 |
| 400 | `PWD_MISMATCH` | 两次输入的密码不一致 |
| 400 | `CODE_NOT_FOUND` | 请先获取验证码（含场景不匹配） |
| 400 | `CODE_EXPIRED` | 验证码已过期，请重新获取 |
| 400 | `CODE_WRONG` | 验证码错误 |
| 404 | `PHONE_NOT_EXISTS` | 该手机号尚未注册 |

---

## 4. 错误码汇总（本模块）

| code | HTTP | 含义 | 前端建议提示 |
|---|---|---|---|
| `INVALID_PHONE` | 400 | 手机号格式不正确 | 直接展示 `message` |
| `INVALID_SCENE` | 400 | 验证码场景不正确 | 直接展示 `message` |
| `TOO_FREQUENT` | 429 | 发送太频繁（60s） | 直接展示 `message` |
| `CODE_NOT_FOUND` | 400 | 请先获取验证码 | 直接展示 `message` |
| `CODE_EXPIRED` | 400 | 验证码已过期 | 直接展示 `message` |
| `CODE_WRONG` | 400 | 验证码错误 | 直接展示 `message` |
| `WEAK_PASSWORD` | 400 | 密码强度不足 | 直接展示 `message` |
| `PWD_MISMATCH` | 400 | 两次密码不一致 | 直接展示 `message` |
| `PHONE_NOT_EXISTS` | 404 | 该手机号未注册 | 直接展示 `message` |

---

## 5. 前端调用示例（小程序）

路径已相对 `baseUrl`（`…/api`），与 `utils/request.js` 的用法一致。

```js
const { request } = require('../../utils/request');

// 1) 发送验证码（重置场景）
const s = await request('/sms/send', {
  method: 'POST',
  data: { phone: '13800138000', scene: 'reset' },
});
const code = s.devCode; // 开发期才有，生产删掉

// 2) 校验验证码（不消耗，用于门禁/下一步）
await request('/auth/sms/verify', {
  method: 'POST',
  data: { phone: '13800138000', smsCode: code, scene: 'reset' },
});

// 3) 重置密码（服务端消耗验证码）
await request('/auth/password/reset', {
  method: 'POST',
  data: {
    phone: '13800138000',
    smsCode: code,
    password: 'abc12345',
    confirmPassword: 'abc12345',
  },
});
```

---

## 6. 联调说明

1. 后端启动后确认：`GET /api/health` 返回 `{ "ok": true }`。
2. 开发期验证码从 `sms/send` 响应的 `devCode` 获取（或看后端控制台 `[SMS][MOCK]` 日志），**无需真实短信**。
3. 小程序开发者工具：详情 → 本地设置 → 勾选「不校验合法域名」。
4. 重置成功后会自动跳转登录页（当前为占位 stub，等你完善）。

**数据库迁移说明**：`sms_codes` 表新增 `scene` 列，已内置 `ensureColumn` 迁移，**旧库无需手动重建**；新库直接带该列。

---

## 7. 生产待办

- [ ] `src/utils/sms.js` 替换为真实短信通道（腾讯云 SMS），并**删除响应中的 `devCode`**
- [ ] 设置环境变量 `AUTH_SECRET`（token 签名密钥），不要用默认值
- [ ] 后端部署到**已备案 https 域名**，并更新小程序 `app.js` 的 `baseUrl`，在微信公众平台配置 request 合法域名
- [ ] 若后续要求更严格的重置流程（页1 通过即签发短期 `resetToken`、页2 凭 token 提交），需再调整（当前方案：前端携带 phone+smsCode，服务端重校验并一次性消耗）
