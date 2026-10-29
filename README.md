# 脑商AI — 小程序注册 & 忘记密码模块

微信小程序「新用户注册」+「忘记密码」完整实现：原生小程序前端 + Node.js/Express 后端 + SQLite 数据库。

## 技术选型（推荐结论）

| 层 | 选型 | 理由 |
|---|---|---|
| 前端 | 原生微信小程序 | 只上微信端，无需 uni-app/Taro，调试直连最简单 |
| 后端 | Node.js 22 + Express | 轻量、生态成熟、与前端同为 JS 技术栈 |
| 数据库 | SQLite（`node:sqlite` 内置模块） | 零安装零配置，量大了只改数据层即可换 MySQL/PG |
| 短信 | 内置 Mock（`src/utils/sms.js`） | 开发期直接返回验证码；上线替换成腾讯云/阿里云 SMS |

> 若不想自己买服务器 + 备案域名，可改用**微信云开发**（云函数 + 云数据库），本项目的接口设计可直接映射过去。

## 目录结构

```
脑商ai/
├── miniprogram/                # 微信小程序前端
│   ├── app.js / app.json / app.wxss
│   ├── pages/register/         # 注册页（两页式：手机号/验证码/密码 → 昵称/性别/头像/装扮/年级）
│   ├── pages/login/            # 登录页（占位 stub，承载「忘记密码」入口，待完善）
│   ├── pages/reset/            # 忘记密码（两页式：验证账号 → 设置新密码）
│   └── utils/request.js        # 请求封装（自动带 token、统一报错）
└── server/                     # 后端服务
    ├── src/index.js            # 入口（端口 3000）
    ├── src/db.js               # SQLite 建表（users / sms_codes，含 scene 场景隔离列）
    ├── src/routes/auth.js      # 发码 / 校验验证码 / 注册 / 重置密码 / 登录 / 我的信息
    ├── src/routes/options.js   # 注册第二页可选项（头像/装扮/年级）
    ├── src/utils/              # sms / token / validate / nickname
    └── data/naoshang.db        # SQLite 数据文件（自动生成）
```

## 快速开始

### 1. 启动后端（需要 Node.js ≥ 22.5）

```bash
cd E:\脑商ai\server
npm install
npm start
```

看到 `✅ 脑商AI 后端已启动: http://localhost:3000` 即成功。

### 2. 运行小程序

1. 用**微信开发者工具**导入 `E:\脑商ai\miniprogram` 目录（测试号或自己的 AppID 均可）
2. 详情 → 本地设置 → 勾选**「不校验合法域名」**（开发期后端是 http://127.0.0.1）
3. 编译后即看到注册页；开发模式下后端响应里带 `devCode`，控制台会打印验证码

## API 接口

| 方法 | 路径 | 说明 | 参数 |
|---|---|---|---|
| POST | `/api/sms/send` | 发送短信验证码（60s 限频，5 分钟有效） | `{ phone, scene? }`，`scene`: `register`（默认）｜`reset` |
| POST | `/api/auth/sms/verify` | 校验验证码是否正确（不消耗，用于解锁密码框） | `{ phone, smsCode, scene? }` |
| GET | `/api/auth/nickname/random` | 随机生成昵称（格式 xxx鱼） | - |
| GET | `/api/profile/options` | 注册第二页可选项（头像/装扮/年级） | - |
| POST | `/api/auth/register` | 注册并登录，返回 token | `{ phone, smsCode, password, confirmPassword, gender, nickname?, avatar?, outfit?, grade? }` |
| POST | `/api/auth/password/reset` | 忘记密码：校验后重置密码（不返回 token） | `{ phone, smsCode, password, confirmPassword }` |
| POST | `/api/auth/login` | 手机号 + 密码登录 | `{ phone, password }` |
| GET | `/api/auth/me` | 当前用户信息（Header: `Authorization: Bearer <token>`） | - |
| GET | `/api/health` | 健康检查 | - |

错误响应统一为 `{ ok: false, code: "错误码", message: "提示" }`。
完整接口契约与错误码：
- 注册模块：[`API接口文档.md`](./API接口文档.md)
- 忘记密码模块：[`忘记密码API文档.md`](./忘记密码API文档.md)（规约见 [`忘记密码模块规约.md`](./忘记密码模块规约.md)）

## 安全设计

- 密码：`scrypt` 加盐哈希存储，登录比较用 `timingSafeEqual` 防时序攻击
- 验证码：6 位随机数、一次性使用、5 分钟过期、60 秒发送限频、按 `scene` 场景隔离（注册码与重置码互不可混用）
- 重置密码：服务端完整重校验（不信任前端），验证码一次性消耗，成功后不返回 token
- 注入防护：所有 SQL 均参数化绑定
- Token：HMAC-SHA256 签名，7 天有效

## 上线前必做（生产清单）

- [ ] `src/utils/sms.js` 替换为真实短信通道（腾讯云 SMS），并删除响应中的 `devCode`
- [ ] 设置环境变量 `AUTH_SECRET`（token 签名密钥），不要用默认值
- [ ] 后端部署到**已备案的 https 域名**，并更新 `miniprogram/app.js` 里的 `baseUrl`；在微信公众平台配置 request 合法域名
- [ ] HTTPS 证书 + Nginx 反向代理
- [ ] 如需邀请码奖励机制，补一张 invites 关联表（当前仅存储用户的邀请码字符串）
