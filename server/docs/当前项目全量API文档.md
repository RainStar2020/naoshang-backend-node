# 当前项目全量 API 文档
生成日期：2026-10-29。来源为当前服务入口及实际挂载路由，未挂载的 Express 旧模块不计入。
本地 Base URL：`http://localhost:3000`（本机 3000 端口正在监听；未配置反向代理前缀）。HQ base path 为 `/api/hq`，旧管理接口为 `/api`，H5 直接挂载根路径。
Security：服务使用服务端会话 token，并非 JWT。Header 为 `Authorization: Bearer <token>`（Bearer 大小写敏感）；代码也接受 Query `token`。HQ 除登录外要求 admin 会话。旧 `/api/auth/login` 的 user 分支按手机号取用户后发会话，不验证密码；H5 parent 登录验证手机号和密码。不要混用登录入口。
请求体为 JSON。参数表按处理器静态提取；“条件/未显式声明”表示由业务分支或下游函数决定，不应视为确定可选。示例用于展示结构，业务 ID、枚举及版本须替换为有效数据。动态路由附原始匹配条件。
参数类型未由代码约束时标为 JSON，不擅自断言类型。每节附处理器源码及实现摘录，涵盖分支校验、默认值及嵌套结构。

## 1. 登录
`POST http://localhost:3000/api/hq/auth/login`

Security：公开，无需 token。
源码：`src/routes/hq/modules/auth.js:89`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|username|JSON|是|读取及校验规则见下方实现|示例值|
|password|JSON|是|读取及校验规则见下方实现|Example123|

### 请求 JSON 示例
```json
{
  "username": "示例值",
  "password": "Example123"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/auth/login',
    perm: 'public',
    async handler(ctx) {
      const { username, password } = ctx.body || {};
      L.requireFields(ctx.body, ['username', 'password']);
      const list = ensureAdmins(ctx.db);
      const admin = list.find((a) => a.username === username) || list.find((a) => a.adminId === username);
      // 用户名/密码错误不区分文案，避免账号枚举
      if (!admin) throw L.err(L.ERR.UNAUTHORIZED, '用户名或密码错误');
      if (admin.status && admin.status !== 'ACTIVE') throw L.err(L.ERR.FORBIDDEN, '该管理员账号已停用');
      const v = PWD.verifyPassword(admin.password, password);
      if (!v.ok) throw L.err(L.ERR.UNAUTHORIZED, '用户名或密码错误');
      if (v.needsUpgrade) {
        PWD.upgradeIfPlaintext(admin, password);
        ctx.save();
      }
      const { token, expiresAt } = issueToken(ctx, admin);
      L.audit(ctx.db, {
        module: MODULE, action: 'login', targetId: admin.adminId,
        operator: { adminId: admin.adminId, displayName: admin.displayName },
        reason: '后台登录', requestId: ctx.requestId,
      });
      ctx.save();
      return { token, admin: adminDto(admin), expiresAt };
    },
  },

  // ── 登出 ──
  {
    module: MODULE,
```
</details>

## 2. 登出
`POST http://localhost:3000/api/hq/auth/logout`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/auth.js:120`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### 请求 JSON 示例
```json
{}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/auth/logout',
    async handler(ctx) {
      const sessions = ctx.__sessions;
      const auth = ctx.req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      if (token && sessions[token]) delete sessions[token];
      L.audit(ctx.db, {
        module: MODULE, action: 'logout', targetId: ctx.operator && ctx.operator.adminId,
        operator: ctx.operator, reason: '后台登出', requestId: ctx.requestId,
      });
      ctx.save();
      return { ok: true };
    },
  },

  // ── 当前会话 ──
  {
    module: MODULE,
```
</details>

## 3. 当前会话
`GET http://localhost:3000/api/hq/auth/me`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/auth.js:139`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/auth/me',
    async handler(ctx) {
      const admin = currentAdmin(ctx);
      return {
        ...adminDto(admin),
        tokenExpiresAt: ctx.sess && ctx.sess.expiresAt ? new Date(ctx.sess.expiresAt).toISOString() : null,
      };
    },
  },

  // ── 修改当前管理员密码 ──
  {
    module: MODULE,
```
</details>

## 4. 修改当前管理员密码
`POST http://localhost:3000/api/hq/auth/password`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/auth.js:153`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|oldPassword|JSON|是|读取及校验规则见下方实现|Example123|
|newPassword|JSON|是|读取及校验规则见下方实现|Example123|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "oldPassword": "Example123",
  "newPassword": "Example123",
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/auth/password',
    async handler(ctx) {
      const { oldPassword, newPassword } = ctx.body || {};
      L.requireFields(ctx.body, ['oldPassword', 'newPassword']);
      const admin = currentAdmin(ctx);
      const v = PWD.verifyPassword(admin.password, oldPassword);
      if (!v.ok) throw L.err(L.ERR.INVALID_INPUT, '原密码不正确');
      if (!PWD.isStrongEnough(newPassword)) throw L.err(L.ERR.INVALID_INPUT, '新密码长度不足（至少 6 位）');
      if (oldPassword === newPassword) throw L.err(L.ERR.INVALID_INPUT, '新密码不能与原密码相同');
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      const before = { password: '***' };
      PWD.setPassword(admin, newPassword);
      admin.password_changed_at = L.nowIso();
      L.audit(ctx.db, {
        module: MODULE, action: 'change-password', targetId: admin.adminId,
        operator: ctx.operator, reason, before, after: { password: '***' }, requestId: ctx.requestId,
      });
      ctx.save();
      // 改密后强制重新登录：清掉当前 token
      const sessions = ctx.__sessions;
      const auth = ctx.req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      if (token && sessions[token]) delete sessions[token];
      return { ok: true, relogin: true };
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, ensureAdmins, adminDto };

```
</details>

## 5. 账号分页列表
`GET http://localhost:3000/api/hq/users`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/users.js:55`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|keyword|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|frozen|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|tier|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|page|number|条件/未显式声明|读取及校验规则见下方实现|1|
|pageSize|number|条件/未显式声明|读取及校验规则见下方实现|1|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/users',
    async handler(ctx) {
      const paging = ctx.apiPilot
        ? {page:ctx.apiPilot.pageNum,pageSize:ctx.apiPilot.pageSize,offset:(ctx.apiPilot.pageNum-1)*ctx.apiPilot.pageSize}
        : L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const frozenFilter = ctx.query.get('frozen');
      const tierFilter = ctx.query.get('tier') || '';

      let list = Object.values(ctx.db.users || {});
      if (keyword) {
        list = list.filter((u) => L.matchKeyword(keyword, u.id, u.display_id, u.name, u.phone));
      }
      if (frozenFilter === 'true' || frozenFilter === '1') list = list.filter((u) => !!u.frozen);
      if (frozenFilter === 'false' || frozenFilter === '0') list = list.filter((u) => !u.frozen);
      if (tierFilter) list = list.filter((u) => u.tier === tierFilter);

      const sortKey = ctx.apiPilot && ctx.apiPilot.sortBy;
      const direction = ctx.apiPilot && ctx.apiPilot.sortOrder === 'desc' ? -1 : 1;
      const sortValue = (u) => sortKey === 'nickname' ? String(u.name || '')
        : sortKey === 'createdAt' ? (L.toIso(u.created_at || u.createdAt) || '') : String(u.id);
      list.sort((a, b) => direction * sortValue(a).localeCompare(sortValue(b)));
      const totalAll = Object.values(ctx.db.users || {}).length;
      const frozenAll = Object.values(ctx.db.users || {}).filter((u) => !!u.frozen).length;

      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map((u) => userDto(u));
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: totalAll,
        frozen: frozenAll,
        active: totalAll - frozenAll,
      });
    },
  },

  // ── 筛选项与汇总目录 ──
  {
    module: MODULE,
```
</details>

## 6. 筛选项与汇总目录
`GET http://localhost:3000/api/hq/users/catalog`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/users.js:93`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/users/catalog',
    async handler(ctx) {
      const users = Object.values(ctx.db.users || {});
      const byTier = {};
      for (const u of users) {
        const t = u.tier || 'none';
        byTier[t] = (byTier[t] || 0) + 1;
      }
      return {
        tiers: Object.keys(byTier).map((t) => ({ tier: t, label: TIER_CN[t] || t, count: byTier[t] })),
        statuses: [
          { value: 'normal', label: '正常' },
          { value: 'frozen', label: '已冻结' },
        ],
        summary: {
          total: users.length,
          frozen: users.filter((u) => !!u.frozen).length,
          active: users.filter((u) => !u.frozen).length,
        },
      };
    },
  },

  // ── 账号详情 ──
  {
    module: MODULE,
```
</details>

## 7. 账号详情
`GET http://localhost:3000/api/hq/users/:accountId`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/users.js:120`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|accountId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/users/:accountId',
    async handler(ctx) {
      const u = ctx.db.users[ctx.params.accountId];
      if (!u) throw L.err(L.ERR.NOT_FOUND, '账号不存在：' + ctx.params.accountId);
      const members = (ctx.db.members || []).filter((m) => m.userId === u.id);
      const audits = (ctx.db.hqAuditLogs || []).filter((a) => a.module === MODULE && a.targetId === u.id).slice(0, 20);
      return {
        profile: userDto(u, { reveal: true }),
        members: members.map((m) => ({
          memberId: m.id,
          displayName: m.name,
          memberLevel: m.memberLevel || null,
          displayId: m.display_id || null,
          storeId: m.storeId || null,
        })),
        audit: audits,
      };
    },
  },

  // ── 账号写操作 ──
  {
    module: MODULE,
```
</details>

## 8. 账号写操作
`POST http://localhost:3000/api/hq/users/:accountId/mutate`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/users.js:144`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|accountId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|note|JSON|是|读取及校验规则见下方实现|示例值|
|action|JSON|是|读取及校验规则见下方实现|示例值|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "note": "示例值",
  "action": "示例值",
  "version": 1,
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/users/:accountId/mutate',
    async handler(ctx) {
      const { action, version } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      // 参数合法性先于资源存在性（400 优先于 404）
      L.ensureEnum(action, ['freeze', 'unfreeze', 'update-note'], 'action');
      const u = ctx.db.users[ctx.params.accountId];
      if (!u) throw L.err(L.ERR.NOT_FOUND, '账号不存在：' + ctx.params.accountId);
      L.checkVersion(ctx, u, version, '账号');

      const before = { frozen: !!u.frozen, note: u.note || '' };

      return L.withIdempotency(ctx, () => {
        if (action === 'freeze') {
          if (u.frozen) throw L.err(L.ERR.INVALID_STATE, '该账号已处于冻结状态');
          u.frozen = true;
          u.frozen_at = L.nowIso();
          u.frozen_reason = reason;
        } else if (action === 'unfreeze') {
          if (!u.frozen) throw L.err(L.ERR.INVALID_STATE, '该账号未被冻结');
          u.frozen = false;
          u.frozen_at = null;
          u.frozen_reason = null;
        } else if (action === 'update-note') {
          L.requireFields(ctx.body, ['note']);
          u.note = String(ctx.body.note);
        }
        L.bumpVersion(u);
        const operationId = L.nextId(ctx.db, 'hqop');
        L.audit(ctx.db, {
          module: MODULE, action, targetId: u.id, operator: ctx.operator, reason,
          before, after: { frozen: !!u.frozen, note: u.note || '' }, requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { profile: userDto(u), operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, userDto };

```
</details>

## 9. 会员分页列表
`GET http://localhost:3000/api/hq/members`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/members.js:66`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|keyword|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|accountId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|storeId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|status|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|page|number|条件/未显式声明|读取及校验规则见下方实现|1|
|pageSize|number|条件/未显式声明|读取及校验规则见下方实现|1|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|id|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/members',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const accountId = ctx.query.get('accountId') || '';
      const storeId = ctx.query.get('storeId') || '';
      const status = ctx.query.get('status') || '';

      let list = (ctx.db.members || []).slice();
      if (keyword) list = list.filter((m) => L.matchKeyword(keyword, m.id, m.name, m.display_id, m.userId));
      if (accountId) list = list.filter((m) => m.userId === accountId);
      if (storeId) list = list.filter((m) => m.storeId === storeId);
      if (status) list = list.filter((m) => (m.status || (m.activated === false ? 'INACTIVE' : 'ACTIVE')) === status);

      list.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const all = (ctx.db.members || []);
      const items = attachStoreNames(ctx.db, list.slice(paging.offset, paging.offset + paging.pageSize)).map(memberDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        unbound: all.filter((m) => !m.storeId).length,
      });
    },
  },

  // ── 门店等筛选项 ──
  {
    module: MODULE,
```
</details>

## 10. 门店等筛选项
`GET http://localhost:3000/api/hq/members/catalog`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/members.js:94`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/members/catalog',
    async handler(ctx) {
      const stores = [];
      const seen = new Set();
      for (const cs of ctx.db.coStores || []) {
        if (cs.store_id && !seen.has(cs.store_id)) {
          seen.add(cs.store_id);
          stores.push({ storeId: cs.store_id, name: cs.store_name || cs.store_id });
        }
      }
      for (const s of ctx.db.hqStores || []) {
        if (!seen.has(s.storeId)) {
          seen.add(s.storeId);
          stores.push({ storeId: s.storeId, name: s.name });
        }
      }
      const members = ctx.db.members || [];
      return {
        stores,
        statuses: [
          { value: 'ACTIVE', label: '正常' },
          { value: 'INACTIVE', label: '未激活' },
        ],
        summary: {
          total: members.length,
          bound: members.filter((m) => !!m.storeId).length,
          unbound: members.filter((m) => !m.storeId).length,
        },
      };
    },
  },

  // ── 会员详情 ──
  {
    module: MODULE,
```
</details>

## 11. 会员详情
`GET http://localhost:3000/api/hq/members/:memberId`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/members.js:130`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|memberId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|memberId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/members/:memberId',
    async handler(ctx) {
      const m = (ctx.db.members || []).find((x) => x.id === ctx.params.memberId);
      if (!m) throw L.err(L.ERR.NOT_FOUND, '会员不存在：' + ctx.params.memberId);
      attachStoreNames(ctx.db, [m]);
      const entitlements = (ctx.db.hqCourseEntitlements || []).filter((e) => e.memberId === m.id);
      const training = (ctx.db.hqTrainingBalances || []).find((b) => b.memberId === m.id) || null;
      const audits = (ctx.db.hqAuditLogs || []).filter((a) => a.module === MODULE && a.targetId === m.id).slice(0, 20);
      return {
        profile: memberDto(m),
        entitlements,
        training,
        audit: audits,
      };
    },
  },

  // ── 会员写操作 ──
  {
    module: MODULE,
```
</details>

## 12. 会员写操作
`POST http://localhost:3000/api/hq/members/:memberId/mutate`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/members.js:151`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|memberId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|name|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|birthday|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|gradeCode|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|gradeLabel|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|genderCode|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|genderLabel|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|storeId|JSON|是|读取及校验规则见下方实现|有效资源ID|
|status|JSON|是|读取及校验规则见下方实现|示例值|
|action|JSON|是|读取及校验规则见下方实现|示例值|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "name": "示例值",
  "birthday": "示例值",
  "gradeCode": "示例值",
  "gradeLabel": "示例值",
  "genderCode": "示例值",
  "genderLabel": "示例值",
  "storeId": "有效资源ID",
  "status": "示例值",
  "action": "示例值",
  "version": 1,
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/members/:memberId/mutate',
    async handler(ctx) {
      const { action, version } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      const m = (ctx.db.members || []).find((x) => x.id === ctx.params.memberId);
      if (!m) throw L.err(L.ERR.NOT_FOUND, '会员不存在：' + ctx.params.memberId);
      L.checkVersion(ctx, m, version, '会员档案');
      L.ensureEnum(action, ['update-profile', 'bind-store', 'unbind-store', 'set-status'], 'action');

      const before = {
        name: m.name, gradeCode: m.gradeCode, genderCode: m.genderCode,
        storeId: m.storeId, status: m.status || (m.activated === false ? 'INACTIVE' : 'ACTIVE'),
      };

      return L.withIdempotency(ctx, () => {
        if (action === 'update-profile') {
          const b = ctx.body;
          if (b.name !== undefined) m.name = String(b.name);
          if (b.birthday !== undefined) m.birthday = b.birthday;
          if (b.gradeCode !== undefined) m.gradeCode = b.gradeCode;
          if (b.gradeLabel !== undefined) m.gradeLabel = b.gradeLabel;
          if (b.genderCode !== undefined) m.genderCode = b.genderCode;
          if (b.genderLabel !== undefined) m.genderLabel = b.genderLabel;
        } else if (action === 'bind-store') {
          L.requireFields(ctx.body, ['storeId']);
          const storeId = String(ctx.body.storeId);
          const exists = (ctx.db.coStores || []).some((c) => c.store_id === storeId)
            || (ctx.db.hqStores || []).some((s) => s.storeId === storeId)
            || (ctx.db.regionalAgents || []).some((a) => a.region_type === 'store' && a.region_code === storeId);
          if (!exists) throw L.err(L.ERR.INVALID_INPUT, '门店不存在：' + storeId);
          m.storeId = storeId;
        } else if (action === 'unbind-store') {
          if (!m.storeId) throw L.err(L.ERR.INVALID_STATE, '该会员当前未绑定门店');
          m.storeId = null;
        } else if (action === 'set-status') {
          L.requireFields(ctx.body, ['status']);
          L.ensureEnum(ctx.body.status, ['ACTIVE', 'INACTIVE'], 'status');
          m.status = ctx.body.status;
          m.activated = ctx.body.status === 'ACTIVE';
        }
        L.bumpVersion(m);
        const operationId = L.nextId(ctx.db, 'hqop');
        L.audit(ctx.db, {
          module: MODULE, action, targetId: m.id, operator: ctx.operator, reason,
          before,
          after: { name: m.name, gradeCode: m.gradeCode, genderCode: m.genderCode, storeId: m.storeId, status: m.status },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { profile: memberDto(m), operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, memberDto };

```
</details>

## 13. 课程查询接口
`GET http://localhost:3000/api/hq/course/entitlements`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/course.js:41`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|keyword|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|accountId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|memberId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|status|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|productId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|page|number|条件/未显式声明|读取及校验规则见下方实现|1|
|pageSize|number|条件/未显式声明|读取及校验规则见下方实现|1|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|id|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/course/entitlements',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const accountId = ctx.query.get('accountId') || '';
      const memberId = ctx.query.get('memberId') || '';
      const status = ctx.query.get('status') || '';
      const productId = ctx.query.get('productId') || '';

      let list = (ctx.db.hqCourseEntitlements || []).slice();
      if (keyword) list = list.filter((e) => L.matchKeyword(keyword, e.id, e.title, e.productId, e.accountId));
      if (accountId) list = list.filter((e) => e.accountId === accountId);
      if (memberId) list = list.filter((e) => e.memberId === memberId);
      if (productId) list = list.filter((e) => e.productId === productId);
      if (status) list = list.filter((e) => entitlementDto(e).status === status);

      list.sort((a, b) => String(b.id).localeCompare(String(a.id)));
      const all = ctx.db.hqCourseEntitlements || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(entitlementDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        active: all.filter((e) => entitlementDto(e).status === 'ACTIVE').length,
        expired: all.filter((e) => entitlementDto(e).status === 'EXPIRED').length,
      });
    },
  },

  {
    module: MODULE,
```
</details>

## 14. 课程查询接口
`GET http://localhost:3000/api/hq/course/catalog`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/course.js:71`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/course/catalog',
    async handler(ctx) {
      const products = [];
      for (const s of ctx.db.skus || []) {
        if (!products.find((p) => p.productId === s.productId)) {
          products.push({ productId: s.productId, title: s.productId, skuCount: 0 });
        }
      }
      for (const p of ctx.db.hqProducts || []) {
        products.push({ productId: p.productId, title: p.title, skuCount: (p.skus || []).length });
      }
      return {
        products,
        statuses: STATUS.map((s) => ({ value: s, label: s })),
        summary: { total: (ctx.db.hqCourseEntitlements || []).length },
      };
    },
  },

  {
    module: MODULE,
```
</details>

## 15. 课程查询接口
`GET http://localhost:3000/api/hq/course/entitlements/:entitlementId`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/course.js:93`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|entitlementId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/course/entitlements/:entitlementId',
    async handler(ctx) {
      const e = (ctx.db.hqCourseEntitlements || []).find((x) => x.id === ctx.params.entitlementId);
      if (!e) throw L.err(L.ERR.NOT_FOUND, '课程权益不存在：' + ctx.params.entitlementId);
      const audits = (ctx.db.hqAuditLogs || []).filter((a) => a.module === MODULE && a.targetId === e.id).slice(0, 20);
      return { entitlement: entitlementDto(e), audit: audits };
    },
  },

  {
    module: MODULE,
```
</details>

## 16. 课程操作接口
`POST http://localhost:3000/api/hq/course/entitlements/:entitlementId/mutate`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/course.js:105`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|entitlementId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|validUntil|JSON|是|读取及校验规则见下方实现|示例值|
|action|JSON|是|读取及校验规则见下方实现|示例值|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "validUntil": "示例值",
  "action": "示例值",
  "version": 1,
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/course/entitlements/:entitlementId/mutate',
    async handler(ctx) {
      const { action, version } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      const e = (ctx.db.hqCourseEntitlements || []).find((x) => x.id === ctx.params.entitlementId);
      if (!e) throw L.err(L.ERR.NOT_FOUND, '课程权益不存在：' + ctx.params.entitlementId);
      L.checkVersion(ctx, e, version, '课程权益');
      L.ensureEnum(action, ['extend', 'freeze', 'unfreeze', 'revoke'], 'action');

      const before = { status: e.status, validUntil: L.toIso(e.validUntil) };

      return L.withIdempotency(ctx, () => {
        if (action === 'extend') {
          L.requireFields(ctx.body, ['validUntil']);
          const next = new Date(ctx.body.validUntil).getTime();
          const cur = e.validUntil ? new Date(e.validUntil).getTime() : 0;
          if (!Number.isFinite(next)) throw L.err(L.ERR.INVALID_INPUT, 'validUntil 不是合法时间');
          if (next <= cur) throw L.err(L.ERR.INVALID_STATE, '延期后的到期时间必须晚于当前有效期');
          e.validUntil = ctx.body.validUntil;
        } else if (action === 'freeze') {
          if (e.status === 'FROZEN') throw L.err(L.ERR.INVALID_STATE, '该权益已处于冻结状态');
          e.status = 'FROZEN';
        } else if (action === 'unfreeze') {
          if (e.status !== 'FROZEN') throw L.err(L.ERR.INVALID_STATE, '该权益不处于冻结状态');
          e.status = 'ACTIVE';
        } else if (action === 'revoke') {
          if (e.status === 'REVOKED') throw L.err(L.ERR.INVALID_STATE, '该权益已撤销，不可重复操作');
          e.status = 'REVOKED';
          e.revokedAt = L.nowIso();
          e.revokeReason = reason;
        }
        L.bumpVersion(e);
        const operationId = L.nextId(ctx.db, 'hqop');
        L.audit(ctx.db, {
          module: MODULE, action, targetId: e.id, operator: ctx.operator, reason,
          before, after: { status: e.status, validUntil: L.toIso(e.validUntil) },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { entitlement: entitlementDto(e), operationId };
      });
    },
  },

  // ── 创建课程权益（便于后台开通；契约未列，附加能力）──
  {
    module: MODULE,
```
</details>

## 17. 创建课程权益（便于后台开通；契约未列，附加能力）
`POST http://localhost:3000/api/hq/course/entitlements`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/course.js:154`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|accountId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|memberId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|productId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|title|JSON|是|读取及校验规则见下方实现|示例值|
|validFrom|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|validUntil|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "accountId": "有效资源ID",
  "memberId": "有效资源ID",
  "productId": "有效资源ID",
  "title": "示例值",
  "validFrom": "示例值",
  "validUntil": "示例值",
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/course/entitlements',
    async handler(ctx) {
      const b = ctx.body || {};
      L.requireFields(b, ['title']);
      const reason = L.requireReason(b, ctx.headerReason);
      L.ensureCollections(ctx.db);
      const rec = {
        id: L.nextId(ctx.db, 'hqe'),
        accountId: b.accountId || null,
        memberId: b.memberId || null,
        productId: b.productId || null,
        title: String(b.title),
        status: 'ACTIVE',
        validFrom: b.validFrom || L.nowIso(),
        validUntil: b.validUntil || null,
        version: 1,
        createdAt: L.nowIso(),
      };
      ctx.db.hqCourseEntitlements.push(rec);
      const operationId = L.nextId(ctx.db, 'hqop');
      L.audit(ctx.db, {
        module: MODULE, action: 'create', targetId: rec.id, operator: ctx.operator, reason,
        before: null, after: rec, requestId: ctx.requestId, id: operationId,
      });
      ctx.save();
      return { entitlement: entitlementDto(rec), operationId };
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, entitlementDto };

```
</details>

## 18. 专栏目录 + 可绑商品 + 审计
`GET http://localhost:3000/api/hq/columns/catalog`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/columns.js:88`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/columns/catalog',
    async handler(ctx) {
      const list = ensureHqColumns(ctx.db);
      const products = [];
      for (const s of ctx.db.skus || []) {
        if (!products.find((p) => p.productId === s.productId)) {
          products.push({ productId: s.productId, title: s.productId, fulfillmentType: 'COLUMN_ACCESS' });
        }
      }
      for (const p of ctx.db.hqProducts || []) {
        products.push({ productId: p.productId, title: p.title, fulfillmentType: p.fulfillmentType || 'COLUMN_ACCESS' });
      }
      const audit = (ctx.db.hqAuditLogs || []).filter((a) => a.module === MODULE).slice(0, 30);
      return {
        columns: list.map((c) => ({
          draft: {
            columnId: c.columnId, productId: c.productId, title: c.title, summary: c.summary,
            coverUrl: c.coverUrl, content: c.content, chapters: c.chapters,
          },
          version: Number(c.version || 1),
          status: c.status || 'draft',
          publication: { publishedAt: L.toIso(c.publishedAt), offlineAt: L.toIso(c.offlineAt) },
        })),
        products,
        audit,
      };
    },
  },

  // ── 单专栏（草稿 + 发布态）──
  {
    module: MODULE,
```
</details>

## 19. 单专栏（草稿 + 发布态）
`GET http://localhost:3000/api/hq/columns/:columnId`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/columns.js:121`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|columnId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/columns/:columnId',
    async handler(ctx) {
      const list = ensureHqColumns(ctx.db);
      const c = list.find((x) => x.columnId === ctx.params.columnId);
      if (!c) throw L.err(L.ERR.NOT_FOUND, '专栏不存在：' + ctx.params.columnId);
      return { column: columnDto(c) };
    },
  },

  // ── 购买/授权/学习进度 ──
  {
    module: MODULE,
```
</details>

## 20. 购买/授权/学习进度
`GET http://localhost:3000/api/hq/columns/:columnId/records`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/columns.js:134`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|columnId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/columns/:columnId/records',
    async handler(ctx) {
      const c = ensureHqColumns(ctx.db).find((x) => x.columnId === ctx.params.columnId);
      if (!c) throw L.err(L.ERR.NOT_FOUND, '专栏不存在：' + ctx.params.columnId);
      const orders = (ctx.db.orders || []).filter((o) => o.productKey === c.columnId || o.columnId === c.columnId);
      const progress = (ctx.db.learningProgress || []).filter((p) => p.levelId === c.columnId || p.chapterId === c.columnId);
      const unlocks = (ctx.db.members || [])
        .filter((m) => Array.isArray(m.unlockedColumns) && m.unlockedColumns.includes(c.columnId))
        .map((m) => ({ memberId: m.id, accountId: m.userId, displayName: m.name }));
      return { orders, progress, unlocks };
    },
  },

  // ── 专栏写操作：save / publish / offline ──
  {
    module: MODULE,
```
</details>

## 21. 专栏写操作：save / publish / offline
`POST http://localhost:3000/api/hq/columns/:columnId/mutate`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/columns.js:151`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|columnId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|action|JSON|是|读取及校验规则见下方实现|示例值|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|value|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "action": "示例值",
  "version": 1,
  "value": "示例值",
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/columns/:columnId/mutate',
    async handler(ctx) {
      const { action, version, value } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['save', 'publish', 'offline'], 'action');
      const list = ensureHqColumns(ctx.db);
      let c = list.find((x) => x.columnId === ctx.params.columnId);
      if (!c) {
        if (action !== 'save') throw L.err(L.ERR.NOT_FOUND, '专栏不存在：' + ctx.params.columnId);
        c = { columnId: ctx.params.columnId, status: 'draft', version: 1, chapters: [], content: null };
        list.push(c);
      }
      L.checkVersion(ctx, c, version, '专栏');
      const before = { title: c.title, status: c.status, version: Number(c.version || 1) };

      return L.withIdempotency(ctx, () => {
        if (action === 'save') {
          if (!value || typeof value !== 'object') throw L.err(L.ERR.INVALID_INPUT, 'save 需要 value（ColumnDraft）');
          if (value.title !== undefined) c.title = String(value.title);
          if (value.summary !== undefined) c.summary = String(value.summary);
          if (value.coverUrl !== undefined) c.coverUrl = value.coverUrl;
          if (value.content !== undefined) c.content = value.content;
          if (value.chapters !== undefined) c.chapters = Array.isArray(value.chapters) ? value.chapters : [];
          if (value.productId !== undefined) c.productId = value.productId;
        } else if (action === 'publish') {
          if (!c.title) throw L.err(L.ERR.INVALID_STATE, '专栏缺少标题，不可发布');
          c.status = 'published';
          c.publishedAt = L.nowIso();
          c.offlineAt = null;
          publishToBusiness(ctx.db, c);
        } else if (action === 'offline') {
          if (c.status !== 'published') throw L.err(L.ERR.INVALID_STATE, '仅已发布的专栏可下架');
          c.status = 'offline';
          c.offlineAt = L.nowIso();
          const biz = (ctx.db.columns || []).find((x) => x.id === c.columnId);
          if (biz) biz.offline = true;
        }
        L.bumpVersion(c);
        const operationId = L.nextId(ctx.db, 'hqop');
        L.audit(ctx.db, {
          module: MODULE, action, targetId: c.columnId, operator: ctx.operator, reason,
          before, after: { title: c.title, status: c.status, version: Number(c.version || 1) },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { column: columnDto(c), operationId };
      });
    },
  },

  // ── 上传素材（返回 CmsAsset）──
  {
    module: MODULE,
```
</details>

## 22. 上传素材（返回 CmsAsset）
`POST http://localhost:3000/api/hq/columns/assets`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/columns.js:206`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|fileName|JSON|是|读取及校验规则见下方实现|示例值|
|url|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|mimeType|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|size|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|purpose|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "fileName": "示例值",
  "url": "示例值",
  "mimeType": "示例值",
  "size": "示例值",
  "purpose": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/columns/assets',
    async handler(ctx) {
      const b = ctx.body || {};
      L.requireFields(b, ['fileName']);
      L.ensureCollections(ctx.db);
      const rec = {
        id: L.nextId(ctx.db, 'hqas'),
        fileName: String(b.fileName),
        url: b.url || null,
        mimeType: b.mimeType || 'application/octet-stream',
        size: Number(b.size || 0),
        purpose: b.purpose || 'column',
        userId: ctx.operator ? ctx.operator.adminId : 'admin',
        createdAt: L.nowIso(),
      };
      ctx.db.assets.push(rec);
      ctx.save();
      return {
        assetId: rec.id,
        url: rec.url,
        mimeType: rec.mimeType,
        size: rec.size,
        fileName: rec.fileName,
      };
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, ensureHqColumns, columnDto };

```
</details>

## 23. 公告查询接口
`GET http://localhost:3000/api/hq/announcements`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/announcements.js:37`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|keyword|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|status|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|page|number|条件/未显式声明|读取及校验规则见下方实现|1|
|pageSize|number|条件/未显式声明|读取及校验规则见下方实现|1|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|id|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/announcements',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const status = ctx.query.get('status') || '';
      let list = (ctx.db.hqAnnouncements || []).slice();
      if (keyword) list = list.filter((a) => L.matchKeyword(keyword, a.id, a.title, a.summary));
      if (status) list = list.filter((a) => (a.status || 'draft') === status);
      list.sort((a, b) => String(b.id).localeCompare(String(a.id)));
      const all = ctx.db.hqAnnouncements || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(announcementDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        published: all.filter((a) => a.status === 'published').length,
        draft: all.filter((a) => (a.status || 'draft') === 'draft').length,
      });
    },
  },

  {
    module: MODULE,
```
</details>

## 24. 公告查询接口
`GET http://localhost:3000/api/hq/announcements/catalog`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/announcements.js:59`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/announcements/catalog',
    async handler(ctx) {
      const audit = (ctx.db.hqAuditLogs || []).filter((a) => a.module === MODULE).slice(0, 30);
      return {
        statuses: STATUS.map((s) => ({ value: s, label: s })),
        audit,
        summary: { total: (ctx.db.hqAnnouncements || []).length },
      };
    },
  },

  {
    module: MODULE,
```
</details>

## 25. 公告查询接口
`GET http://localhost:3000/api/hq/announcements/:announcementId`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/announcements.js:73`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|announcementId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/announcements/:announcementId',
    async handler(ctx) {
      const a = (ctx.db.hqAnnouncements || []).find((x) => x.id === ctx.params.announcementId);
      if (!a) throw L.err(L.ERR.NOT_FOUND, '公告不存在：' + ctx.params.announcementId);
      return { announcement: announcementDto(a) };
    },
  },

  // ── 无 id 的 mutate：create / save ──
  {
    module: MODULE,
```
</details>

## 26. 无 id 的 mutate：create / save
`POST http://localhost:3000/api/hq/announcements/mutate`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/announcements.js:85`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|title|JSON|是|读取及校验规则见下方实现|示例值|
|summary|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|content|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|audience|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|announcementId|JSON|是|读取及校验规则见下方实现|有效资源ID|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|action|JSON|是|读取及校验规则见下方实现|示例值|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "title": "示例值",
  "summary": "示例值",
  "content": "示例值",
  "audience": "示例值",
  "announcementId": "有效资源ID",
  "version": 1,
  "action": "示例值",
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/announcements/mutate',
    async handler(ctx) {
      const { action } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['create', 'save'], 'action');
      L.ensureCollections(ctx.db);

      return L.withIdempotency(ctx, () => {
        if (action === 'create') {
          L.requireFields(ctx.body, ['title']);
          const rec = {
            id: L.nextId(ctx.db, 'hqan'),
            title: String(ctx.body.title),
            summary: ctx.body.summary || '',
            content: ctx.body.content || null,
            status: 'draft',
            publishedAt: null,
            audience: ctx.body.audience || null,
            version: 1,
            createdAt: L.nowIso(),
          };
          ctx.db.hqAnnouncements.push(rec);
          const operationId = L.nextId(ctx.db, 'hqop');
          L.audit(ctx.db, {
            module: MODULE, action: 'create', targetId: rec.id, operator: ctx.operator, reason,
            before: null, after: rec, requestId: ctx.requestId, id: operationId,
          });
          ctx.save();
          return { announcement: announcementDto(rec), operationId };
        }
        // save：需带 announcementId
        L.requireFields(ctx.body, ['announcementId']);
        const rec = ctx.db.hqAnnouncements.find((x) => x.id === ctx.body.announcementId);
        if (!rec) throw L.err(L.ERR.NOT_FOUND, '公告不存在：' + ctx.body.announcementId);
        L.checkVersion(ctx, rec, ctx.body.version, '公告');
        const before = { title: rec.title, summary: rec.summary, status: rec.status };
        if (ctx.body.title !== undefined) rec.title = String(ctx.body.title);
        if (ctx.body.summary !== undefined) rec.summary = String(ctx.body.summary);
        if (ctx.body.content !== undefined) rec.content = ctx.body.content;
        if (ctx.body.audience !== undefined) rec.audience = ctx.body.audience;
        L.bumpVersion(rec);
        const operationId = L.nextId(ctx.db, 'hqop');
        L.audit(ctx.db, {
          module: MODULE, action: 'save', targetId: rec.id, operator: ctx.operator, reason,
          before, after: { title: rec.title, summary: rec.summary, status: rec.status },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { announcement: announcementDto(rec), operationId };
      });
    },
  },

  // ── 有 id 的 mutate：save / publish / offline ──
  {
    module: MODULE,
```
</details>

## 27. 有 id 的 mutate：save / publish / offline
`POST http://localhost:3000/api/hq/announcements/:announcementId/mutate`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/announcements.js:143`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|announcementId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|title|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|summary|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|content|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|audience|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|action|JSON|是|读取及校验规则见下方实现|示例值|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "title": "示例值",
  "summary": "示例值",
  "content": "示例值",
  "audience": "示例值",
  "action": "示例值",
  "version": 1,
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/announcements/:announcementId/mutate',
    async handler(ctx) {
      const { action, version } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['save', 'publish', 'offline'], 'action');
      const rec = (ctx.db.hqAnnouncements || []).find((x) => x.id === ctx.params.announcementId);
      if (!rec) throw L.err(L.ERR.NOT_FOUND, '公告不存在：' + ctx.params.announcementId);
      L.checkVersion(ctx, rec, version, '公告');
      const before = { title: rec.title, status: rec.status, version: Number(rec.version || 1) };

      return L.withIdempotency(ctx, () => {
        if (action === 'save') {
          if (ctx.body.title !== undefined) rec.title = String(ctx.body.title);
          if (ctx.body.summary !== undefined) rec.summary = String(ctx.body.summary);
          if (ctx.body.content !== undefined) rec.content = ctx.body.content;
          if (ctx.body.audience !== undefined) rec.audience = ctx.body.audience;
        } else if (action === 'publish') {
          if (!rec.title) throw L.err(L.ERR.INVALID_STATE, '公告缺少标题，不可发布');
          if (rec.status === 'published') throw L.err(L.ERR.INVALID_STATE, '该公告已发布');
          rec.status = 'published';
          rec.publishedAt = L.nowIso();
        } else if (action === 'offline') {
          if (rec.status !== 'published') throw L.err(L.ERR.INVALID_STATE, '仅已发布的公告可下线');
          rec.status = 'offline';
          rec.offlineAt = L.nowIso();
        }
        L.bumpVersion(rec);
        const operationId = L.nextId(ctx.db, 'hqop');
        L.audit(ctx.db, {
          module: MODULE, action, targetId: rec.id, operator: ctx.operator, reason,
          before, after: { title: rec.title, status: rec.status, version: Number(rec.version || 1) },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { announcement: announcementDto(rec), operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, announcementDto };

```
</details>

## 28. 素材查询接口
`GET http://localhost:3000/api/hq/materials`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/materials.js:37`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|keyword|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|category|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|status|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|page|number|条件/未显式声明|读取及校验规则见下方实现|1|
|pageSize|number|条件/未显式声明|读取及校验规则见下方实现|1|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|id|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/materials',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const category = ctx.query.get('category') || '';
      const status = ctx.query.get('status') || '';
      let list = (ctx.db.hqMaterials || []).slice();
      if (keyword) list = list.filter((m) => L.matchKeyword(keyword, m.id, m.title, m.category));
      if (category) list = list.filter((m) => m.category === category);
      if (status) list = list.filter((m) => (m.status || 'offline') === status);
      list.sort((a, b) => String(b.id).localeCompare(String(a.id)));
      const all = ctx.db.hqMaterials || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(materialDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        online: all.filter((m) => m.status === 'online').length,
      });
    },
  },

  {
    module: MODULE,
```
</details>

## 29. 素材查询接口
`GET http://localhost:3000/api/hq/materials/catalog`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/materials.js:60`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/materials/catalog',
    async handler(ctx) {
      const all = ctx.db.hqMaterials || [];
      const cats = {};
      for (const m of all) {
        const c = m.category || 'general';
        cats[c] = (cats[c] || 0) + 1;
      }
      return {
        categories: Object.keys(cats).map((c) => ({ value: c, label: c, count: cats[c] })),
        statuses: [
          { value: 'online', label: '已上架' },
          { value: 'offline', label: '已下架' },
        ],
        audit: (ctx.db.hqAuditLogs || []).filter((a) => a.module === MODULE).slice(0, 30),
        summary: { total: all.length },
      };
    },
  },

  {
    module: MODULE,
```
</details>

## 30. 素材查询接口
`GET http://localhost:3000/api/hq/materials/:materialId`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/materials.js:83`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|materialId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/materials/:materialId',
    async handler(ctx) {
      const m = (ctx.db.hqMaterials || []).find((x) => x.id === ctx.params.materialId);
      if (!m) throw L.err(L.ERR.NOT_FOUND, '资料不存在：' + ctx.params.materialId);
      return { material: materialDto(m) };
    },
  },

  {
    module: MODULE,
```
</details>

## 31. 素材操作接口
`POST http://localhost:3000/api/hq/materials/mutate`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/materials.js:94`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|title|JSON|是|读取及校验规则见下方实现|示例值|
|category|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|fileUrl|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|assetId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|size|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|mimeType|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|materialId|JSON|是|读取及校验规则见下方实现|有效资源ID|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|action|JSON|是|读取及校验规则见下方实现|示例值|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "title": "示例值",
  "category": "示例值",
  "fileUrl": "示例值",
  "assetId": "有效资源ID",
  "size": "示例值",
  "mimeType": "示例值",
  "materialId": "有效资源ID",
  "version": 1,
  "action": "示例值",
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/materials/mutate',
    async handler(ctx) {
      const { action } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['create', 'save', 'online', 'offline', 'delete'], 'action');
      L.ensureCollections(ctx.db);

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'create') {
          L.requireFields(ctx.body, ['title']);
          const rec = {
            id: L.nextId(ctx.db, 'hqm'),
            title: String(ctx.body.title),
            category: ctx.body.category || 'general',
            fileUrl: ctx.body.fileUrl || null,
            assetId: ctx.body.assetId || null,
            status: 'offline',
            size: Number(ctx.body.size || 0),
            mimeType: ctx.body.mimeType || null,
            version: 1,
            createdAt: L.nowIso(),
          };
          ctx.db.hqMaterials.push(rec);
          L.audit(ctx.db, {
            module: MODULE, action: 'create', targetId: rec.id, operator: ctx.operator, reason,
            before: null, after: rec, requestId: ctx.requestId, id: operationId,
          });
          ctx.save();
          return { material: materialDto(rec), operationId };
        }

        L.requireFields(ctx.body, ['materialId']);
        const rec = ctx.db.hqMaterials.find((x) => x.id === ctx.body.materialId);
        if (!rec) throw L.err(L.ERR.NOT_FOUND, '资料不存在：' + ctx.body.materialId);
        L.checkVersion(ctx, rec, ctx.body.version, '资料');
        const before = { title: rec.title, status: rec.status, category: rec.category };

        if (action === 'save') {
          if (ctx.body.title !== undefined) rec.title = String(ctx.body.title);
          if (ctx.body.category !== undefined) rec.category = ctx.body.category;
          if (ctx.body.fileUrl !== undefined) rec.fileUrl = ctx.body.fileUrl;
          if (ctx.body.assetId !== undefined) rec.assetId = ctx.body.assetId;
        } else if (action === 'online') {
          if (rec.status === 'online') throw L.err(L.ERR.INVALID_STATE, '该资料已上架');
          rec.status = 'online';
        } else if (action === 'offline') {
          if (rec.status !== 'online') throw L.err(L.ERR.INVALID_STATE, '该资料未上架');
          rec.status = 'offline';
        } else if (action === 'delete') {
          const idx = ctx.db.hqMaterials.indexOf(rec);
          ctx.db.hqMaterials.splice(idx, 1);
          L.audit(ctx.db, {
            module: MODULE, action: 'delete', targetId: rec.id, operator: ctx.operator, reason,
            before, after: null, requestId: ctx.requestId, id: operationId,
          });
          ctx.save();
          return { deleted: true, materialId: rec.id, operationId };
        }
        L.bumpVersion(rec);
        L.audit(ctx.db, {
          module: MODULE, action, targetId: rec.id, operator: ctx.operator, reason,
          before, after: { title: rec.title, status: rec.status, category: rec.category },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { material: materialDto(rec), operationId };
      });
    },
  },

  // ── 上传文件 ──
  {
    module: MODULE,
```
</details>

## 32. 上传文件
`POST http://localhost:3000/api/hq/materials/assets`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/materials.js:171`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|purpose|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|fileName|JSON|是|读取及校验规则见下方实现|示例值|
|mimeType|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|size|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|url|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|previewUrl|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "purpose": "示例值",
  "fileName": "示例值",
  "mimeType": "示例值",
  "size": "示例值",
  "url": "示例值",
  "previewUrl": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/materials/assets',
    async handler(ctx) {
      const b = ctx.body || {};
      L.requireFields(b, ['fileName']);
      L.ensureCollections(ctx.db);
      const rec = {
        id: L.nextId(ctx.db, 'hqas'),
        userId: ctx.operator ? ctx.operator.adminId : 'admin',
        purpose: b.purpose || 'material',
        fileName: String(b.fileName),
        mimeType: b.mimeType || 'application/octet-stream',
        size: Number(b.size || 0),
        status: 'READY',
        createdAt: L.nowIso(),
        previewUrl: b.url || b.previewUrl || null,
      };
      ctx.db.assets.push(rec);
      ctx.save();
      return {
        assetId: rec.id,
        url: rec.previewUrl,
        mimeType: rec.mimeType,
        size: rec.size,
        fileName: rec.fileName,
      };
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, materialDto };

```
</details>

## 33. 批次列表
`GET http://localhost:3000/api/hq/activation-codes/batches`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/activationCodes.js:84`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|page|number|条件/未显式声明|读取及校验规则见下方实现|1|
|pageSize|number|条件/未显式声明|读取及校验规则见下方实现|1|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|id|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/activation-codes/batches',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const list = ensureBatches(ctx.db).slice().reverse();
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map((b) => {
        const codes = (ctx.db.activationCodes || []).filter((c) => c.batchId === b.id);
        return batchDto(b, codes);
      });
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: list.length,
      });
    },
  },

  // ── 批次详情（含码统计）──
  {
    module: MODULE,
```
</details>

## 34. 批次详情（含码统计）
`GET http://localhost:3000/api/hq/activation-codes/batches/:batchId`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/activationCodes.js:102`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|batchId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|id|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/activation-codes/batches/:batchId',
    async handler(ctx) {
      const b = ensureBatches(ctx.db).find((x) => x.id === ctx.params.batchId);
      if (!b) throw L.err(L.ERR.NOT_FOUND, '批次不存在：' + ctx.params.batchId);
      const codes = (ctx.db.activationCodes || []).filter((c) => c.batchId === b.id);
      const dto = batchDto(b, codes);
      dto.codes = codes.map((c) => codeDto(c));
      return { batch: dto };
    },
  },

  // ── 码分页 ──
  {
    module: MODULE,
```
</details>

## 35. 码分页
`GET http://localhost:3000/api/hq/activation-codes`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/activationCodes.js:117`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|batchId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|status|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|targetType|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|keyword|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|reveal|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|page|number|条件/未显式声明|读取及校验规则见下方实现|1|
|pageSize|number|条件/未显式声明|读取及校验规则见下方实现|1|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|code|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/activation-codes',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const batchId = ctx.query.get('batchId') || '';
      const status = ctx.query.get('status') || '';
      const targetType = ctx.query.get('targetType') || '';
      const keyword = ctx.query.get('keyword') || '';
      const reveal = ctx.query.get('reveal') === '1';

      let list = (ctx.db.activationCodes || []).slice();
      if (batchId) list = list.filter((c) => c.batchId === batchId);
      if (status) list = list.filter((c) => toEnumStatus(c) === status);
      if (targetType) list = list.filter((c) => c.targetType === targetType);
      if (keyword) list = list.filter((c) => L.matchKeyword(keyword, c.code, c.targetId));
      list.sort((a, b) => String(a.code).localeCompare(String(b.code)));
      const all = ctx.db.activationCodes || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map((c) => codeDto(c, { reveal }));
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        unused: all.filter((c) => toEnumStatus(c) === 'UNUSED').length,
        used: all.filter((c) => toEnumStatus(c) === 'USED').length,
      });
    },
  },

  // ── 可绑权益产品目录 ──
  {
    module: MODULE,
```
</details>

## 36. 可绑权益产品目录
`GET http://localhost:3000/api/hq/activation-codes/catalog`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/activationCodes.js:146`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/activation-codes/catalog',
    async handler(ctx) {
      const products = [];
      for (const s of ctx.db.skus || []) {
        if (!products.find((p) => p.productId === s.productId)) {
          products.push({ productId: s.productId, title: s.productId, entitlementType: s.productId });
        }
      }
      for (const p of ctx.db.hqProducts || []) {
        products.push({ productId: p.productId, title: p.title, entitlementType: p.productId });
      }
      return {
        products,
        entitlementTypes: [
          { value: 'level', label: '学习等级' },
          { value: 'column', label: '专栏' },
          { value: 'fs', label: '粉丝' },
          { value: 'jy', label: '菁英' },
          { value: 'cj', label: '超菁' },
          { value: 'xn', label: '行能' },
          { value: 'ys', label: '羿烁' },
        ],
        codeStatuses: CODE_STATUS.map((s) => ({ value: s, label: s })),
        summary: { total: (ctx.db.activationCodes || []).length },
      };
    },
  },

  // ── 创建批次并生成码 ──
  {
    module: MODULE,
```
</details>

## 37. 创建批次并生成码
`POST http://localhost:3000/api/hq/activation-codes/batches`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/activationCodes.js:178`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|quantity|number|是|读取及校验规则见下方实现|1|
|entitlementType|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|productId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|targetId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|maxUses|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|expiresAt|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "quantity": 1,
  "entitlementType": "示例值",
  "productId": "有效资源ID",
  "targetId": "有效资源ID",
  "maxUses": "示例值",
  "expiresAt": "示例值",
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/activation-codes/batches',
    async handler(ctx) {
      const b = ctx.body || {};
      L.requireFields(b, ['quantity']);
      const reason = L.requireReason(b, ctx.headerReason);
      const qty = Number(b.quantity);
      if (!Number.isInteger(qty) || qty <= 0) throw L.err(L.ERR.INVALID_INPUT, 'quantity 必须是正整数');
      if (qty > 5000) throw L.err(L.ERR.INVALID_INPUT, '单批次最多生成 5000 个码');
      L.ensureCollections(ctx.db);
      const batches = ensureBatches(ctx.db);

      return L.withIdempotency(ctx, () => {
        const batchId = L.nextId(ctx.db, 'hqb');
        const stamp = Date.now().toString(36).toUpperCase().slice(-6);
        const codes = [];
        for (let i = 1; i <= qty; i++) {
          const seq = String(i).padStart(4, '0');
          const code = `NS-${(b.entitlementType || b.productId || 'GEN').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'GEN'}-${stamp}-${seq}`;
          const rec = {
            code,
            targetType: b.entitlementType || b.productId || null,
            targetId: b.targetId || null,
            maxUses: Number(b.maxUses || 1),
            uses: 0,
            status: 'active',
            expiresAt: b.expiresAt || null,
            batchId,
            version: 1,
          };
          ctx.db.activationCodes.push(rec);
          codes.push(rec);
        }
        const batch = {
          id: batchId,
          productId: b.productId || null,
          entitlementType: b.entitlementType || b.productId || null,
          targetId: b.targetId || null,
          quantity: qty,
          maxUses: Number(b.maxUses || 1),
          expiresAt: b.expiresAt || null,
          status: 'ACTIVE',
          createdAt: L.nowIso(),
          version: 1,
        };
        batches.push(batch);
        const operationId = L.nextId(ctx.db, 'hqop');
        L.audit(ctx.db, {
          module: MODULE, action: 'create-batch', targetId: batchId, operator: ctx.operator, reason,
          before: null, after: { batchId, quantity: qty, productId: batch.productId },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return {
          batch: batchDto(batch, codes),
          codes: codes.map((c) => codeDto(c, { reveal: true })),
          operationId,
        };
      });
    },
  },

  // ── 作废 / 导出回执 ──
  {
    module: MODULE,
```
</details>

## 38. 作废 / 导出回执
`POST http://localhost:3000/api/hq/activation-codes/mutate`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/activationCodes.js:243`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|code|JSON|是|读取及校验规则见下方实现|示例值|
|batchId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|action|JSON|是|读取及校验规则见下方实现|示例值|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "code": "示例值",
  "batchId": "有效资源ID",
  "action": "示例值",
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/activation-codes/mutate',
    async handler(ctx) {
      const { action } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['void', 'export'], 'action');

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'void') {
          L.requireFields(ctx.body, ['code']);
          const rec = (ctx.db.activationCodes || []).find((c) => c.code === ctx.body.code);
          if (!rec) throw L.err(L.ERR.NOT_FOUND, '激活码不存在：' + ctx.body.code);
          const before = { status: rec.status };
          if (rec.status === 'void') throw L.err(L.ERR.INVALID_STATE, '该码已作废');
          if (toEnumStatus(rec) === 'USED') throw L.err(L.ERR.INVALID_STATE, '已使用的码不可作废');
          rec.status = 'void';
          rec.voidReason = reason;
          rec.voidedAt = L.nowIso();
          L.bumpVersion(rec);
          L.audit(ctx.db, {
            module: MODULE, action: 'void', targetId: rec.code, operator: ctx.operator, reason,
            before, after: { status: rec.status }, requestId: ctx.requestId, id: operationId,
          });
          ctx.save();
          return { code: codeDto(rec), operationId };
        }

        // export：返回完整码面（导出动作强审计）
        const batchId = ctx.body.batchId || null;
        let codes = (ctx.db.activationCodes || []).slice();
        if (batchId) codes = codes.filter((c) => c.batchId === batchId);
        L.audit(ctx.db, {
          module: MODULE, action: 'export', targetId: batchId || 'ALL', operator: ctx.operator, reason,
          before: null, after: { count: codes.length }, requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return {
          operationId,
          count: codes.length,
          codes: codes.map((c) => codeDto(c, { reveal: true })),
        };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, codeDto, ensureBatches };

```
</details>

## 39. 卡密分页
`GET http://localhost:3000/api/hq/software-cards`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/softwareCards.js:70`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|batchId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|status|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|keyword|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|reveal|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|page|number|条件/未显式声明|读取及校验规则见下方实现|1|
|pageSize|number|条件/未显式声明|读取及校验规则见下方实现|1|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|id|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/software-cards',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const batchId = ctx.query.get('batchId') || '';
      const status = ctx.query.get('status') || '';
      const keyword = ctx.query.get('keyword') || '';
      const reveal = ctx.query.get('reveal') === '1';

      let list = (ctx.db.hqSoftwareCards || []).slice();
      if (batchId) list = list.filter((c) => c.batchId === batchId);
      if (status) list = list.filter((c) => toEnumStatus(c) === status);
      if (keyword) list = list.filter((c) => L.matchKeyword(keyword, c.code, c.boundAccountId));
      list.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const all = ctx.db.hqSoftwareCards || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map((c) => cardDto(c, { reveal }));
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        unused: all.filter((c) => toEnumStatus(c) === 'UNUSED').length,
        used: all.filter((c) => toEnumStatus(c) === 'USED').length,
      });
    },
  },

  // ── 批次列表 ──
  {
    module: MODULE,
```
</details>

## 40. 批次列表
`GET http://localhost:3000/api/hq/software-cards/batches`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/softwareCards.js:97`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|page|number|条件/未显式声明|读取及校验规则见下方实现|1|
|pageSize|number|条件/未显式声明|读取及校验规则见下方实现|1|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|id|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/software-cards/batches',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const list = (ctx.db.hqSoftwareCardBatches || []).slice().reverse();
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map((b) => {
        const cards = (ctx.db.hqSoftwareCards || []).filter((c) => c.batchId === b.id);
        return batchDto(b, cards);
      });
      return L.listData(items, list.length, paging.page, paging.pageSize, { total: list.length });
    },
  },

  // ── 目录 ──
  {
    module: MODULE,
```
</details>

## 41. 目录
`GET http://localhost:3000/api/hq/software-cards/catalog`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/softwareCards.js:113`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/software-cards/catalog',
    async handler(ctx) {
      const products = [];
      for (const s of ctx.db.skus || []) {
        if (!products.find((p) => p.productId === s.productId)) {
          products.push({ productId: s.productId, title: s.productId });
        }
      }
      return {
        products,
        statuses: CARD_STATUS.map((s) => ({ value: s, label: s })),
        summary: { total: (ctx.db.hqSoftwareCards || []).length },
      };
    },
  },

  // ── 生成批次 ──
  {
    module: MODULE,
```
</details>

## 42. 生成批次
`POST http://localhost:3000/api/hq/software-cards/batches`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/softwareCards.js:133`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|quantity|number|是|读取及校验规则见下方实现|1|
|productId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|expiresAt|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "quantity": 1,
  "productId": "有效资源ID",
  "expiresAt": "示例值",
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/software-cards/batches',
    async handler(ctx) {
      const b = ctx.body || {};
      L.requireFields(b, ['quantity']);
      const reason = L.requireReason(b, ctx.headerReason);
      const qty = Number(b.quantity);
      if (!Number.isInteger(qty) || qty <= 0) throw L.err(L.ERR.INVALID_INPUT, 'quantity 必须是正整数');
      if (qty > 5000) throw L.err(L.ERR.INVALID_INPUT, '单批次最多生成 5000 张卡');
      L.ensureCollections(ctx.db);

      return L.withIdempotency(ctx, () => {
        const batchId = L.nextId(ctx.db, 'hqscb');
        const stamp = Date.now().toString(36).toUpperCase().slice(-6);
        const cards = [];
        for (let i = 1; i <= qty; i++) {
          const rec = {
            id: L.nextId(ctx.db, 'hqsc'),
            code: `SC-${stamp}-${String(i).padStart(4, '0')}`,
            status: 'unused',
            boundAccountId: null,
            boundAt: null,
            batchId,
            productId: b.productId || null,
            expiresAt: b.expiresAt || null,
            note: '',
            version: 1,
            createdAt: L.nowIso(),
          };
          ctx.db.hqSoftwareCards.push(rec);
          cards.push(rec);
        }
        const batch = {
          id: batchId,
          productId: b.productId || null,
          quantity: qty,
          expiresAt: b.expiresAt || null,
          status: 'ACTIVE',
          createdAt: L.nowIso(),
          version: 1,
        };
        ctx.db.hqSoftwareCardBatches.push(batch);
        const operationId = L.nextId(ctx.db, 'hqop');
        L.audit(ctx.db, {
          module: MODULE, action: 'create-batch', targetId: batchId, operator: ctx.operator, reason,
          before: null, after: { batchId, quantity: qty }, requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return {
          batch: batchDto(batch, cards),
          cards: cards.map((c) => cardDto(c, { reveal: true })),
          operationId,
        };
      });
    },
  },

  // ── 作废 / 备注 ──
  {
    module: MODULE,
```
</details>

## 43. 作废 / 备注
`POST http://localhost:3000/api/hq/software-cards/mutate`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/softwareCards.js:193`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|cardId|JSON|是|读取及校验规则见下方实现|有效资源ID|
|note|JSON|是|读取及校验规则见下方实现|示例值|
|action|JSON|是|读取及校验规则见下方实现|示例值|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "cardId": "有效资源ID",
  "note": "示例值",
  "action": "示例值",
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/software-cards/mutate',
    async handler(ctx) {
      const { action } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['void', 'update-note'], 'action');

      return L.withIdempotency(ctx, () => {
        L.requireFields(ctx.body, ['cardId']);
        const rec = (ctx.db.hqSoftwareCards || []).find((c) => c.id === ctx.body.cardId);
        if (!rec) throw L.err(L.ERR.NOT_FOUND, '软件卡不存在：' + ctx.body.cardId);
        const before = { status: rec.status, note: rec.note || '' };
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'void') {
          if (rec.status === 'void') throw L.err(L.ERR.INVALID_STATE, '该卡已作废');
          if (toEnumStatus(rec) === 'USED') throw L.err(L.ERR.INVALID_STATE, '已绑定的卡不可作废');
          rec.status = 'void';
          rec.voidReason = reason;
          rec.voidedAt = L.nowIso();
        } else if (action === 'update-note') {
          L.requireFields(ctx.body, ['note']);
          rec.note = String(ctx.body.note);
        }
        L.bumpVersion(rec);
        L.audit(ctx.db, {
          module: MODULE, action, targetId: rec.id, operator: ctx.operator, reason,
          before, after: { status: rec.status, note: rec.note || '' },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { card: cardDto(rec), operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, cardDto };

```
</details>

## 44. 配额账户列表
`GET http://localhost:3000/api/hq/quotas`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/quotas.js:64`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|keyword|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|status|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|page|number|条件/未显式声明|读取及校验规则见下方实现|1|
|pageSize|number|条件/未显式声明|读取及校验规则见下方实现|1|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|quotaId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/quotas',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const status = ctx.query.get('status') || '';

      // 汇总：hqQuotaAccounts 优先，缺失的用 quotaLedger 补
      const ids = new Set();
      for (const q of ctx.db.hqQuotaAccounts || []) ids.add(q.quotaId);
      for (const k of Object.keys(ctx.db.quotaLedger || {})) ids.add(k);

      let list = [...ids].map((id) => readAccount(ctx.db, id)).filter(Boolean);
      if (keyword) list = list.filter((a) => L.matchKeyword(keyword, a.quotaId, a.ownerId));
      if (status) list = list.filter((a) => (a.status || 'ACTIVE') === status);
      list.sort((a, b) => String(a.quotaId).localeCompare(String(b.quotaId)));

      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(accountDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: list.length,
        totalQuota: list.reduce((a, x) => a + Number(x.standard || 0) + Number(x.activityTotal || 0), 0),
        frozenQuota: list.reduce((a, x) => a + Number(x.frozen || 0), 0),
      });
    },
  },

  // ── 目录 ──
  {
    module: MODULE,
```
</details>

## 45. 目录
`GET http://localhost:3000/api/hq/quotas/catalog`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/quotas.js:93`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/quotas/catalog',
    async handler(ctx) {
      return {
        ownerTypes: [
          { value: 'partner', label: '合伙人' },
          { value: 'store', label: '门店' },
          { value: 'agent', label: '区域代理' },
        ],
        actions: [
          { value: 'adjust', label: '调增/调减' },
          { value: 'freeze', label: '冻结' },
          { value: 'unfreeze', label: '解冻' },
        ],
        summary: { total: Object.keys(ctx.db.quotaLedger || {}).length },
      };
    },
  },

  // ── 详情 + 流水 ──
  {
    module: MODULE,
```
</details>

## 46. 详情 + 流水
`GET http://localhost:3000/api/hq/quotas/:quotaId`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/quotas.js:115`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|quotaId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/quotas/:quotaId',
    async handler(ctx) {
      const a = readAccount(ctx.db, ctx.params.quotaId);
      if (!a) throw L.err(L.ERR.NOT_FOUND, '配额账户不存在：' + ctx.params.quotaId);
      const transactions = (ctx.db.quota_transactions || []).filter((t) => t.partnerId === ctx.params.quotaId);
      const ledger = (ctx.db.quotaLedger || {})[ctx.params.quotaId] || null;
      return { account: accountDto(a), ledger, transactions };
    },
  },

  // ── 调增/调减/冻结 ──
  {
    module: MODULE,
```
</details>

## 47. 调增/调减/冻结
`POST http://localhost:3000/api/hq/quotas/:quotaId/mutate`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/quotas.js:129`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|quotaId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|frozenAmount|JSON|是|读取及校验规则见下方实现|示例值|
|action|JSON|是|读取及校验规则见下方实现|示例值|
|delta|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "frozenAmount": "示例值",
  "action": "示例值",
  "delta": "示例值",
  "version": 1,
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/quotas/:quotaId/mutate',
    async handler(ctx) {
      const { action, delta, version } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['adjust', 'freeze', 'unfreeze'], 'action');
      const quotaId = ctx.params.quotaId;

      // 确保有后台账户记录（否则从 quotaLedger 派生）
      L.ensureCollections(ctx.db);
      let acct = (ctx.db.hqQuotaAccounts || []).find((q) => q.quotaId === quotaId);
      if (!acct) {
        const derived = readAccount(ctx.db, quotaId);
        if (!derived) throw L.err(L.ERR.NOT_FOUND, '配额账户不存在：' + quotaId);
        acct = {
          quotaId,
          ownerId: derived.ownerId || quotaId,
          ownerType: derived.ownerType || 'partner',
          standard: Number(derived.standard || 0),
          activityTotal: Number(derived.activityTotal || 0),
          frozen: 0,
          status: 'ACTIVE',
          version: 1,
          createdAt: L.nowIso(),
        };
        ctx.db.hqQuotaAccounts.push(acct);
      }
      L.checkVersion(ctx, acct, version, '配额账户');
      const before = { standard: acct.standard, activityTotal: acct.activityTotal, frozen: acct.frozen, status: acct.status };

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'adjust') {
          if (delta === undefined || delta === null) throw L.err(L.ERR.INVALID_INPUT, 'adjust 需要 delta（可为负）');
          const d = Number(delta);
          if (!Number.isFinite(d) || d === 0) throw L.err(L.ERR.INVALID_INPUT, 'delta 必须是非零数字');
          if (d < 0) {
            const pool = Number(acct.standard || 0) + Number(acct.activityTotal || 0);
            if (-d > pool) throw L.err(L.ERR.QUOTA_EXCEEDED, '配额余额不足，无法调减');
          }
          // 调增/调减统一作用在标准桶；活动桶不参与后台直接调整
          acct.standard = Number(acct.standard || 0) + d;          // 同步写入既有名额台账与流水（经同步器进 MySQL）
          const ledger = ctx.db.quotaLedger[quotaId] || (ctx.db.quotaLedger[quotaId] = { standard: 0, activity: [] });
          ledger.standard = Number(acct.standard || 0);
          ctx.db.quota_transactions = ctx.db.quota_transactions || [];
          ctx.db.quota_transactions.push({
            id: L.nextId(ctx.db, 'qt'),
            type: d > 0 ? 'grant' : 'consume',
            partnerId: quotaId,
            kind: 'hq_adjust',
            qty: Math.abs(d),
            operatorId: ctx.operator ? ctx.operator.adminId : 'admin',
            ref: operationId,
            at: L.nowMs(),
          });
        } else if (action === 'freeze') {
          if (acct.status === 'FROZEN') throw L.err(L.ERR.INVALID_STATE, '该配额账户已冻结');
          L.requireFields(ctx.body, ['frozenAmount']);
          const fa = Number(ctx.body.frozenAmount);
          if (!Number.isFinite(fa) || fa <= 0) throw L.err(L.ERR.INVALID_INPUT, 'frozenAmount 必须是正数');
          const pool = Number(acct.standard || 0) + Number(acct.activityTotal || 0);
          if (fa > pool) throw L.err(L.ERR.QUOTA_EXCEEDED, '冻结数量超过可用配额');
          acct.frozen = Number(acct.frozen || 0) + fa;
          acct.status = 'FROZEN';
        } else if (action === 'unfreeze') {
          if (acct.status !== 'FROZEN') throw L.err(L.ERR.INVALID_STATE, '该配额账户未冻结');
          const fa = ctx.body.frozenAmount == null ? acct.frozen : Number(ctx.body.frozenAmount);
          if (!Number.isFinite(fa) || fa < 0) throw L.err(L.ERR.INVALID_INPUT, 'frozenAmount 必须是非负数');
          acct.frozen = Math.max(0, Number(acct.frozen || 0) - fa);
          if (acct.frozen === 0) acct.status = 'ACTIVE';
        }
        L.bumpVersion(acct);
        L.audit(ctx.db, {
          module: MODULE, action, targetId: quotaId, operator: ctx.operator, reason,
          before, after: { standard: acct.standard, activityTotal: acct.activityTotal, frozen: acct.frozen, status: acct.status },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { account: accountDto(acct), operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, accountDto };

```
</details>

## 48. 商品分页
`GET http://localhost:3000/api/hq/products`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/products.js:80`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|keyword|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|status|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|fulfillmentType|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|page|number|条件/未显式声明|读取及校验规则见下方实现|1|
|pageSize|number|条件/未显式声明|读取及校验规则见下方实现|1|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|productId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|id|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/products',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const status = ctx.query.get('status') || '';
      const fulfillmentType = ctx.query.get('fulfillmentType') || '';

      let list = (ctx.db.hqProducts || []).slice();
      if (!list.length) {
        // 兜底：以商城 SKU 目录合成只读商品视图
        const seen = new Set();
        for (const s of ctx.db.skus || []) {
          if (seen.has(s.productId)) continue;
          seen.add(s.productId);
          list.push({
            productId: s.productId, title: s.productId, subtitle: null, coverUrl: null,
            fulfillmentType: 'PHYSICAL', status: 'on_sale', skus: [], version: 1,
          });
        }
      }
      if (keyword) list = list.filter((p) => L.matchKeyword(keyword, p.productId, p.title, p.subtitle));
      if (status) list = list.filter((p) => (p.status || 'draft') === status);
      if (fulfillmentType) list = list.filter((p) => (p.fulfillmentType || 'PHYSICAL') === fulfillmentType);
      list.sort((a, b) => String(a.productId || a.id).localeCompare(String(b.productId || b.id)));

      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map((p) => {
        const dto = productDto(p);
        dto.skus = mergeSkus(ctx.db, p);
        return dto;
      });
      return L.listData(items, list.length, paging.page, paging.pageSize, { total: list.length });
    },
  },

  // ── 类目/履约类型目录 ──
  {
    module: MODULE,
```
</details>

## 49. 类目/履约类型目录
`GET http://localhost:3000/api/hq/products/catalog`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/products.js:118`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/products/catalog',
    async handler(ctx) {
      const categories = [];
      const seen = new Set();
      for (const s of ctx.db.skus || []) {
        if (seen.has(s.productId)) continue;
        seen.add(s.productId);
        categories.push({ productId: s.productId, title: s.productId });
      }
      return {
        categories,
        fulfillmentTypes: FULFILLMENT.map((f) => ({ value: f, label: f })),
        statuses: STATUS.map((s) => ({ value: s, label: s })),
        summary: { total: (ctx.db.hqProducts || []).length },
      };
    },
  },

  // ── 商品详情（含 SKU）──
  {
    module: MODULE,
```
</details>

## 50. 商品详情（含 SKU）
`GET http://localhost:3000/api/hq/products/:productId`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/products.js:140`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|productId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/products/:productId',
    async handler(ctx) {
      const p = (ctx.db.hqProducts || []).find((x) => (x.productId || x.id) === ctx.params.productId);
      if (!p) throw L.err(L.ERR.NOT_FOUND, '商品不存在：' + ctx.params.productId);
      const dto = productDto(p);
      dto.skus = mergeSkus(ctx.db, p);
      return { product: dto };
    },
  },

  // ── 创建 / 保存 ──
  {
    module: MODULE,
```
</details>

## 51. 创建 / 保存
`POST http://localhost:3000/api/hq/products/mutate`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/products.js:154`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|productId|JSON|是|读取及校验规则见下方实现|有效资源ID|
|title|JSON|是|读取及校验规则见下方实现|示例值|
|subtitle|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|coverUrl|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|fulfillmentType|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|skus|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|action|JSON|是|读取及校验规则见下方实现|示例值|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "productId": "有效资源ID",
  "title": "示例值",
  "subtitle": "示例值",
  "coverUrl": "示例值",
  "fulfillmentType": "示例值",
  "version": 1,
  "skus": "示例值",
  "action": "示例值",
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/products/mutate',
    async handler(ctx) {
      const { action } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['create', 'save'], 'action');
      L.ensureCollections(ctx.db);

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'create') {
          L.requireFields(ctx.body, ['title']);
          const productId = ctx.body.productId || L.nextId(ctx.db, 'hqpd');
          const rec = {
            productId,
            title: String(ctx.body.title),
            subtitle: ctx.body.subtitle || null,
            coverUrl: ctx.body.coverUrl || null,
            fulfillmentType: ctx.body.fulfillmentType || 'PHYSICAL',
            status: 'draft',
            skus: [],
            version: 1,
            createdAt: L.nowIso(),
          };
          ctx.db.hqProducts.push(rec);
          L.audit(ctx.db, {
            module: MODULE, action: 'create', targetId: productId, operator: ctx.operator, reason,
            before: null, after: rec, requestId: ctx.requestId, id: operationId,
          });
          ctx.save();
          return { product: productDto(rec), operationId };
        }

        L.requireFields(ctx.body, ['productId']);
        const rec = ctx.db.hqProducts.find((x) => (x.productId || x.id) === ctx.body.productId);
        if (!rec) throw L.err(L.ERR.NOT_FOUND, '商品不存在：' + ctx.body.productId);
        L.checkVersion(ctx, rec, ctx.body.version, '商品');
        const before = { title: rec.title, status: rec.status, fulfillmentType: rec.fulfillmentType };

        if (ctx.body.title !== undefined) rec.title = String(ctx.body.title);
        if (ctx.body.subtitle !== undefined) rec.subtitle = ctx.body.subtitle;
        if (ctx.body.coverUrl !== undefined) rec.coverUrl = ctx.body.coverUrl;
        if (ctx.body.fulfillmentType !== undefined) {
          L.ensureEnum(ctx.body.fulfillmentType, FULFILLMENT, 'fulfillmentType');
          rec.fulfillmentType = ctx.body.fulfillmentType;
        }
        if (ctx.body.skus !== undefined) {
          if (!Array.isArray(ctx.body.skus)) throw L.err(L.ERR.INVALID_INPUT, 'skus 必须是数组');
          rec.skus = ctx.body.skus.map((s, i) => ({
            skuId: s.skuId || s.id || `${rec.productId}-sku-${i + 1}`,
            title: s.title || s.label || '',
            price: assertMoney(s.price != null ? s.price : s.listPrice, `SKU[${i}] 价格`),
            listPrice: s.listPrice == null ? null : assertMoney(s.listPrice, `SKU[${i}] 划线价`),
            stock: s.stock === null || s.stock === undefined ? null : Number(s.stock),
          }));
        }
        L.bumpVersion(rec);
        L.audit(ctx.db, {
          module: MODULE, action: 'save', targetId: rec.productId, operator: ctx.operator, reason,
          before, after: { title: rec.title, status: rec.status, fulfillmentType: rec.fulfillmentType },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        const dto = productDto(rec);
        dto.skus = mergeSkus(ctx.db, rec);
        return { product: dto, operationId };
      });
    },
  },

  // ── 上架 / 下架 / 改价 / 改 SKU ──
  {
    module: MODULE,
```
</details>

## 52. 上架 / 下架 / 改价 / 改 SKU
`POST http://localhost:3000/api/hq/products/:productId/mutate`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/products.js:229`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|productId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|title|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|subtitle|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|coverUrl|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|fulfillmentType|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|skus|JSON|是|读取及校验规则见下方实现|示例值|
|price|JSON|是|读取及校验规则见下方实现|示例值|
|skuId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|action|JSON|是|读取及校验规则见下方实现|示例值|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "title": "示例值",
  "subtitle": "示例值",
  "coverUrl": "示例值",
  "fulfillmentType": "示例值",
  "skus": "示例值",
  "price": "示例值",
  "skuId": "有效资源ID",
  "action": "示例值",
  "version": 1,
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/products/:productId/mutate',
    async handler(ctx) {
      const { action, version } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['publish', 'offline', 'save', 'update-sku', 'update-price'], 'action');
      const rec = (ctx.db.hqProducts || []).find((x) => (x.productId || x.id) === ctx.params.productId);
      if (!rec) throw L.err(L.ERR.NOT_FOUND, '商品不存在：' + ctx.params.productId);
      L.checkVersion(ctx, rec, version, '商品');
      const before = { title: rec.title, status: rec.status, skus: (rec.skus || []).length };

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'publish') {
          const skus = mergeSkus(ctx.db, rec);
          if (!skus.length) throw L.err(L.ERR.INVALID_STATE, '商品至少需要一个 SKU 才可上架');
          if (rec.status === 'on_sale') throw L.err(L.ERR.INVALID_STATE, '该商品已上架');
          rec.status = 'on_sale';
          rec.publishedAt = L.nowIso();
        } else if (action === 'offline') {
          if (rec.status !== 'on_sale') throw L.err(L.ERR.INVALID_STATE, '仅已上架商品可下架');
          rec.status = 'offline';
          rec.offlineAt = L.nowIso();
        } else if (action === 'save') {
          if (ctx.body.title !== undefined) rec.title = String(ctx.body.title);
          if (ctx.body.subtitle !== undefined) rec.subtitle = ctx.body.subtitle;
          if (ctx.body.coverUrl !== undefined) rec.coverUrl = ctx.body.coverUrl;
          if (ctx.body.fulfillmentType !== undefined) {
            L.ensureEnum(ctx.body.fulfillmentType, FULFILLMENT, 'fulfillmentType');
            rec.fulfillmentType = ctx.body.fulfillmentType;
          }
        } else if (action === 'update-sku') {
          L.requireFields(ctx.body, ['skus']);
          if (!Array.isArray(ctx.body.skus)) throw L.err(L.ERR.INVALID_INPUT, 'skus 必须是数组');
          rec.skus = ctx.body.skus.map((s, i) => ({
            skuId: s.skuId || s.id || `${rec.productId}-sku-${i + 1}`,
            title: s.title || s.label || '',
            price: assertMoney(s.price != null ? s.price : s.listPrice, `SKU[${i}] 价格`),
            listPrice: s.listPrice == null ? null : assertMoney(s.listPrice, `SKU[${i}] 划线价`),
            stock: s.stock === null || s.stock === undefined ? null : Number(s.stock),
          }));
        } else if (action === 'update-price') {
          L.requireFields(ctx.body, ['price']);
          const price = assertMoney(ctx.body.price, '价格');
          if (ctx.body.skuId) {
            const sku = (rec.skus || []).find((s) => (s.skuId || s.id) === ctx.body.skuId);
            if (!sku) throw L.err(L.ERR.NOT_FOUND, 'SKU 不存在：' + ctx.body.skuId);
            sku.price = price;
          } else {
            for (const s of rec.skus || []) s.price = price;
          }
        }
        L.bumpVersion(rec);
        L.audit(ctx.db, {
          module: MODULE, action, targetId: rec.productId, operator: ctx.operator, reason,
          before, after: { title: rec.title, status: rec.status, skus: (rec.skus || []).length },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        const dto = productDto(rec);
        dto.skus = mergeSkus(ctx.db, rec);
        return { product: dto, operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, productDto };

```
</details>

## 53. 发货单分页
`GET http://localhost:3000/api/hq/delivery/shipments`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/delivery.js:46`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|keyword|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|status|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|page|number|条件/未显式声明|读取及校验规则见下方实现|1|
|pageSize|number|条件/未显式声明|读取及校验规则见下方实现|1|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|id|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/delivery/shipments',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const status = ctx.query.get('status') || '';
      let list = (ctx.db.hqShipments || []).slice();
      if (keyword) list = list.filter((s) => L.matchKeyword(keyword, s.id, s.orderId, s.orderNo, s.trackingNo));
      if (status) list = list.filter((s) => (s.status || 'PENDING') === status);
      list.sort((a, b) => String(b.id).localeCompare(String(a.id)));
      const all = ctx.db.hqShipments || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map((s) => shipmentDto(s));
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        pending: all.filter((s) => (s.status || 'PENDING') === 'PENDING').length,
        exception: all.filter((s) => s.status === 'EXCEPTION').length,
      });
    },
  },

  // ── 快递公司目录 ──
  {
    module: MODULE,
```
</details>

## 54. 快递公司目录
`GET http://localhost:3000/api/hq/delivery/catalog`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/delivery.js:69`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/delivery/catalog',
    async handler(ctx) {
      return {
        carriers: [
          { value: 'SF', label: '顺丰速运' },
          { value: 'JD', label: '京东物流' },
          { value: 'YTO', label: '圆通速递' },
          { value: 'ZTO', label: '中通快递' },
          { value: 'YUNDA', label: '韵达快递' },
          { value: 'EMS', label: '中国邮政EMS' },
        ],
        statuses: SHIPMENT_STATUS.map((s) => ({ value: s, label: s })),
        summary: { total: (ctx.db.hqShipments || []).length },
      };
    },
  },

  // ── 发货单详情 ──
  {
    module: MODULE,
```
</details>

## 55. 发货单详情
`GET http://localhost:3000/api/hq/delivery/shipments/:shipmentId`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/delivery.js:90`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|shipmentId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/delivery/shipments/:shipmentId',
    async handler(ctx) {
      const s = (ctx.db.hqShipments || []).find((x) => x.id === ctx.params.shipmentId);
      if (!s) throw L.err(L.ERR.NOT_FOUND, '发货单不存在：' + ctx.params.shipmentId);
      const order = s.orderId ? (ctx.db.orders || []).find((o) => o.id === s.orderId) : null;
      return { shipment: shipmentDto(s, { reveal: true }), order };
    },
  },

  // ── 填写运单 / 发货 / 异常 ──
  {
    module: MODULE,
```
</details>

## 56. 填写运单 / 发货 / 异常
`POST http://localhost:3000/api/hq/delivery/shipments/:shipmentId/mutate`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/delivery.js:103`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|shipmentId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|carrier|JSON|是|读取及校验规则见下方实现|示例值|
|trackingNo|JSON|是|读取及校验规则见下方实现|示例值|
|exceptionReason|JSON|是|读取及校验规则见下方实现|示例值|
|note|JSON|是|读取及校验规则见下方实现|示例值|
|action|JSON|是|读取及校验规则见下方实现|示例值|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "carrier": "示例值",
  "trackingNo": "示例值",
  "exceptionReason": "示例值",
  "note": "示例值",
  "action": "示例值",
  "version": 1,
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/delivery/shipments/:shipmentId/mutate',
    async handler(ctx) {
      const { action, version } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['ship', 'mark-delivered', 'flag-exception', 'update-note'], 'action');
      const s = (ctx.db.hqShipments || []).find((x) => x.id === ctx.params.shipmentId);
      if (!s) throw L.err(L.ERR.NOT_FOUND, '发货单不存在：' + ctx.params.shipmentId);
      L.checkVersion(ctx, s, version, '发货单');
      const before = { status: s.status, carrier: s.carrier, trackingNo: s.trackingNo };

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'ship') {
          if (s.status && s.status !== 'PENDING') throw L.err(L.ERR.INVALID_STATE, '该发货单已发货或已关闭');
          L.requireFields(ctx.body, ['carrier', 'trackingNo']);
          s.carrier = String(ctx.body.carrier);
          s.trackingNo = String(ctx.body.trackingNo);
          s.status = 'SHIPPED';
          s.shippedAt = L.nowIso();
        } else if (action === 'mark-delivered') {
          if (s.status !== 'SHIPPED') throw L.err(L.ERR.INVALID_STATE, '仅已发货的单据可标记送达');
          s.status = 'DELIVERED';
          s.deliveredAt = L.nowIso();
        } else if (action === 'flag-exception') {
          L.requireFields(ctx.body, ['exceptionReason']);
          s.status = 'EXCEPTION';
          s.exceptionReason = String(ctx.body.exceptionReason);
        } else if (action === 'update-note') {
          L.requireFields(ctx.body, ['note']);
          s.note = String(ctx.body.note);
        }
        L.bumpVersion(s);
        L.audit(ctx.db, {
          module: MODULE, action, targetId: s.id, operator: ctx.operator, reason,
          before, after: { status: s.status, carrier: s.carrier, trackingNo: s.trackingNo },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { shipment: shipmentDto(s), operationId };
      });
    },
  },

  // ── 从订单创建发货单（附加能力）──
  {
    module: MODULE,
```
</details>

## 57. 从订单创建发货单（附加能力）
`POST http://localhost:3000/api/hq/delivery/shipments`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/delivery.js:152`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|orderId|JSON|是|读取及校验规则见下方实现|有效资源ID|
|receiverName|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|receiverPhone|JSON|条件/未显式声明|读取及校验规则见下方实现|13800138000|
|address|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "orderId": "有效资源ID",
  "receiverName": "示例值",
  "receiverPhone": "13800138000",
  "address": "示例值",
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/delivery/shipments',
    async handler(ctx) {
      const b = ctx.body || {};
      L.requireFields(b, ['orderId']);
      const reason = L.requireReason(b, ctx.headerReason);
      const order = (ctx.db.orders || []).find((o) => o.id === b.orderId);
      if (!order) throw L.err(L.ERR.NOT_FOUND, '订单不存在：' + b.orderId);
      L.ensureCollections(ctx.db);

      return L.withIdempotency(ctx, () => {
        const rec = {
          id: L.nextId(ctx.db, 'hqsh'),
          orderId: order.id,
          orderNo: order.id,
          status: 'PENDING',
          carrier: null,
          trackingNo: null,
          receiverName: b.receiverName || null,
          receiverPhone: b.receiverPhone || null,
          address: b.address || null,
          version: 1,
          createdAt: L.nowIso(),
        };
        ctx.db.hqShipments.push(rec);
        const operationId = L.nextId(ctx.db, 'hqop');
        L.audit(ctx.db, {
          module: MODULE, action: 'create', targetId: rec.id, operator: ctx.operator, reason,
          before: null, after: rec, requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { shipment: shipmentDto(rec), operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, shipmentDto };

```
</details>

## 58. 订单分页
`GET http://localhost:3000/api/hq/orders`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/orders.js:94`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|keyword|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|paymentStatus|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|fulfillmentStatus|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|business|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|accountId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|from|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|to|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|page|number|条件/未显式声明|读取及校验规则见下方实现|1|
|pageSize|number|条件/未显式声明|读取及校验规则见下方实现|1|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|created_at|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/orders',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const paymentStatus = ctx.query.get('paymentStatus') || '';
      const fulfillmentStatus = ctx.query.get('fulfillmentStatus') || '';
      const business = ctx.query.get('business') || '';
      const accountId = ctx.query.get('accountId') || '';
      const from = ctx.query.get('from') || '';
      const to = ctx.query.get('to') || '';

      let list = (ctx.db.orders || []).slice();
      if (keyword) {
        list = list.filter((o) => {
          const u = ctx.db.users[o.buyer_id];
          return L.matchKeyword(keyword, o.id, o.productName, o.skuLabel, o.buyer_id, u && u.phone, u && u.name);
        });
      }
      if (paymentStatus) list = list.filter((o) => paymentStatusOf(o) === paymentStatus);
      if (fulfillmentStatus) list = list.filter((o) => fulfillmentStatusOf(o) === fulfillmentStatus);
      if (business) list = list.filter((o) => businessOf(o) === business);
      if (accountId) list = list.filter((o) => o.buyer_id === accountId);
      if (from) {
        const t = new Date(from).getTime();
        list = list.filter((o) => new Date(o.created_at).getTime() >= t);
      }
      if (to) {
        const t = new Date(to).getTime();
        list = list.filter((o) => new Date(o.created_at).getTime() <= t);
      }
      list.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

      const all = ctx.db.orders || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map((o) => orderDto(o));
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        paid: all.filter((o) => paymentStatusOf(o) === 'PAID').length,
        pending: all.filter((o) => paymentStatusOf(o) === 'PENDING_PAYMENT').length,
        gmv: L.money(all.filter((o) => paymentStatusOf(o) === 'PAID')
          .reduce((a, o) => a + (Number(o.paid != null ? o.paid : o.actual_paid) || 0), 0)),
      });
    },
  },

  // ── 状态/业务类型目录 ──
  {
    module: MODULE,
```
</details>

## 59. 状态/业务类型目录
`GET http://localhost:3000/api/hq/orders/catalog`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/orders.js:142`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/orders/catalog',
    async handler(ctx) {
      const all = ctx.db.orders || [];
      return {
        paymentStatuses: PAYMENT_STATUS.map((s) => ({ value: s, label: s })),
        fulfillmentStatuses: FULFILLMENT_STATUS.map((s) => ({ value: s, label: s })),
        businesses: [
          { value: 'MALL', label: '商城' },
          { value: 'MEMBERSHIP', label: '会员' },
          { value: 'BUSINESS', label: '业务' },
        ],
        actions: [
          { value: 'cancel', label: '取消' },
          { value: 'add-note', label: '加备注' },
          { value: 'close', label: '关闭' },
          { value: 'mark-fulfilled', label: '标记履约完成' },
        ],
        summary: {
          total: all.length,
          paid: all.filter((o) => paymentStatusOf(o) === 'PAID').length,
          pending: all.filter((o) => paymentStatusOf(o) === 'PENDING_PAYMENT').length,
        },
      };
    },
  },

  // ── 订单详情 ──
  {
    module: MODULE,
```
</details>

## 60. 订单详情
`GET http://localhost:3000/api/hq/orders/:orderId`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/orders.js:172`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|orderId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/orders/:orderId',
    async handler(ctx) {
      const o = (ctx.db.orders || []).find((x) => x.id === ctx.params.orderId);
      if (!o) throw L.err(L.ERR.NOT_FOUND, '订单不存在：' + ctx.params.orderId);
      const u = ctx.db.users[o.buyer_id];
      const items = [{
        productId: o.productKey || o.packageTier || null,
        skuId: o.skuId || null,
        title: o.productName || o.packageTier || '',
        quantity: Number(o.qty != null ? o.qty : o.quotaCount || 1),
        price: L.money(o.unitPrice != null ? o.unitPrice : o.actual_paid),
        lineAmount: L.money(o.paid != null ? o.paid : o.actual_paid),
      }];
      const payment = (ctx.db.payments || []).find((p) => p.bizId === o.id) || null;
      const shipment = (ctx.db.hqShipments || []).find((s) => s.orderId === o.id) || null;
      const coupons = (ctx.db.coupons || []).filter((c) => c.usedOrderId === o.id);
      const audit = (ctx.db.hqAuditLogs || []).filter((a) => a.module === MODULE && a.targetId === o.id).slice(0, 20);
      return {
        order: orderDto(o, { reveal: true }),
        buyer: u ? { accountId: u.id, name: u.name, phone: u.phone, tier: u.tier } : null,
        items,
        payment,
        shipment,
        coupons,
        audit,
      };
    },
  },

  // ── 订单写操作 ──
  {
    module: MODULE,
```
</details>

## 61. 订单写操作
`POST http://localhost:3000/api/hq/orders/:orderId/mutate`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/orders.js:205`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|orderId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|note|JSON|是|读取及校验规则见下方实现|示例值|
|action|JSON|是|读取及校验规则见下方实现|示例值|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "note": "示例值",
  "action": "示例值",
  "version": 1,
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/orders/:orderId/mutate',
    async handler(ctx) {
      const { action, version } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['cancel', 'add-note', 'close', 'mark-fulfilled'], 'action');
      const o = (ctx.db.orders || []).find((x) => x.id === ctx.params.orderId);
      if (!o) throw L.err(L.ERR.NOT_FOUND, '订单不存在：' + ctx.params.orderId);
      L.checkVersion(ctx, o, version, '订单');
      const before = { status: o.status, note: o.note || null };

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'cancel') {
          if (paymentStatusOf(o) === 'PAID') throw L.err(L.ERR.INVALID_STATE, '已支付订单不可直接取消，请走退款流程');
          if (o.status === 'cancelled') throw L.err(L.ERR.INVALID_STATE, '该订单已取消');
          o.status = 'cancelled';
          o.cancelled_at = L.nowMs();
          o.cancelled_by = ctx.operator ? ctx.operator.adminId : 'admin';
          o.cancel_reason = reason;
          // 回补库存（产品单）
          if (o.type === 'product' && o.skuId && !o.stock_restored) {
            const sku = (ctx.db.skus || []).find((s) => s.id === o.skuId);
            if (sku) {
              const qty = Number(o.skuQty || o.qty || 1);
              sku.stock = Number(sku.stock || 0) + qty;
              sku.updatedAt = L.nowMs();
              o.stock_restored = true;
              ctx.db.stockLedger = ctx.db.stockLedger || [];
              ctx.db.stockLedger.push({
                id: L.nextId(ctx.db, 'sl'), skuId: sku.id, delta: qty, reason: '订单取消回补',
                orderId: o.id, operatorId: ctx.operator ? ctx.operator.adminId : 'admin',
                at: L.nowMs(), balanceAfter: sku.stock,
              });
            }
          }
        } else if (action === 'add-note') {
          L.requireFields(ctx.body, ['note']);
          o.note = String(ctx.body.note);
        } else if (action === 'close') {
          if (o.status === 'closed') throw L.err(L.ERR.INVALID_STATE, '该订单已关闭');
          o.status = 'closed';
          o.closed_at = L.nowMs();
        } else if (action === 'mark-fulfilled') {
          if (paymentStatusOf(o) !== 'PAID') throw L.err(L.ERR.INVALID_STATE, '未支付订单不可标记履约');
          if (o.verified) throw L.err(L.ERR.INVALID_STATE, '该订单已履约');
          o.verified = true;
          o.verified_at = L.nowMs();
          o.verified_by = ctx.operator ? ctx.operator.adminId : 'admin';
        }
        L.bumpVersion(o);
        L.audit(ctx.db, {
          module: MODULE, action, targetId: o.id, operator: ctx.operator, reason,
          before, after: { status: o.status, note: o.note || null },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { order: orderDto(o), operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, orderDto, paymentStatusOf, fulfillmentStatusOf };

```
</details>

## 62. 模板与用户券目录
`GET http://localhost:3000/api/hq/coupons/catalog`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/coupons.js:67`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/coupons/catalog',
    async handler(ctx) {
      const templates = ctx.db.hqCouponTemplates || [];
      const issued = (ctx.db.hqUserCoupons || []).length;
      return {
        templates: templates.map(templateDto),
        userCouponStatus: USER_COUPON_STATUS.map((s) => ({ value: s, label: s })),
        summary: {
          templateCount: templates.length,
          issuedCount: issued,
          usedCount: (ctx.db.hqUserCoupons || []).filter((c) => c.status === 'used').length,
        },
        audit: (ctx.db.hqAuditLogs || []).filter((a) => a.module === MODULE).slice(0, 30),
      };
    },
  },

  // ── 模板列表 ──
  {
    module: MODULE,
```
</details>

## 63. 模板列表
`GET http://localhost:3000/api/hq/coupons/templates`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/coupons.js:88`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|keyword|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|page|number|条件/未显式声明|读取及校验规则见下方实现|1|
|pageSize|number|条件/未显式声明|读取及校验规则见下方实现|1|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|id|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/coupons/templates',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      let list = (ctx.db.hqCouponTemplates || []).slice();
      if (keyword) list = list.filter((t) => L.matchKeyword(keyword, t.id, t.title));
      list.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(templateDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, { total: list.length });
    },
  },

  // ── 用户券分页 ──
  {
    module: MODULE,
```
</details>

## 64. 用户券分页
`GET http://localhost:3000/api/hq/coupons`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/coupons.js:104`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|accountId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|status|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|templateId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|page|number|条件/未显式声明|读取及校验规则见下方实现|1|
|pageSize|number|条件/未显式声明|读取及校验规则见下方实现|1|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|id|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/coupons',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const accountId = ctx.query.get('accountId') || '';
      const status = ctx.query.get('status') || '';
      const templateId = ctx.query.get('templateId') || '';
      let list = (ctx.db.hqUserCoupons || []).slice();
      if (accountId) list = list.filter((c) => c.accountId === accountId);
      if (templateId) list = list.filter((c) => c.templateId === templateId);
      if (status) list = list.filter((c) => userCouponDto(c).status === status);
      list.sort((a, b) => String(b.id).localeCompare(String(a.id)));
      const all = ctx.db.hqUserCoupons || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(userCouponDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, { total: all.length });
    },
  },

  // ── save-template / issue ──
  {
    module: MODULE,
```
</details>

## 65. 优惠券操作接口
`POST http://localhost:3000/api/hq/coupons/mutate`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/coupons.js:125`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|value|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|templateId|JSON|是|读取及校验规则见下方实现|有效资源ID|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|accountIds|JSON|是|读取及校验规则见下方实现|示例值|
|action|JSON|是|读取及校验规则见下方实现|示例值|
|title|JSON|是|读取及校验规则见下方实现|示例值|
|amount|number|是|读取及校验规则见下方实现|1|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "value": "示例值",
  "templateId": "有效资源ID",
  "version": 1,
  "accountIds": "示例值",
  "action": "示例值",
  "title": "示例值",
  "amount": 1,
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/coupons/mutate',
    async handler(ctx) {
      const { action } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['save-template', 'issue'], 'action');
      L.ensureCollections(ctx.db);

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'save-template') {
          const v = ctx.body.value || {};
          L.requireFields(v, ['title', 'amount']);
          let tpl = null;
          if (ctx.body.templateId) {
            tpl = ctx.db.hqCouponTemplates.find((t) => t.id === ctx.body.templateId);
            if (!tpl) throw L.err(L.ERR.NOT_FOUND, '优惠券模板不存在：' + ctx.body.templateId);
            L.checkVersion(ctx, tpl, ctx.body.version, '优惠券模板');
          } else {
            tpl = { id: L.nextId(ctx.db, 'hqct'), issuedQuantity: 0, version: 1 };
            ctx.db.hqCouponTemplates.push(tpl);
          }
          const before = { title: tpl.title, amount: tpl.amount, enabled: tpl.enabled };
          tpl.title = String(v.title);
          tpl.amount = assertMoney(v.amount, '面额');
          tpl.minAmount = assertMoney(v.minAmount || 0, '门槛');
          tpl.scope = v.scope || { kind: 'all', productIds: [] };
          tpl.validFrom = v.validFrom || tpl.validFrom || L.nowIso();
          tpl.expiresAt = v.expiresAt || null;
          tpl.enabled = v.enabled === undefined ? tpl.enabled !== false : !!v.enabled;
          tpl.totalQuantity = Number(v.totalQuantity || tpl.totalQuantity || 0);
          tpl.perAccountLimit = Number(v.perAccountLimit || tpl.perAccountLimit || 0);
          L.bumpVersion(tpl);
          L.audit(ctx.db, {
            module: MODULE, action: 'save-template', targetId: tpl.id, operator: ctx.operator, reason,
            before, after: { title: tpl.title, amount: tpl.amount, enabled: tpl.enabled },
            requestId: ctx.requestId, id: operationId,
          });
          ctx.save();
          return { template: templateDto(tpl), operationId };
        }

        // issue：批量发放
        L.requireFields(ctx.body, ['templateId', 'accountIds']);
        const tpl = ctx.db.hqCouponTemplates.find((t) => t.id === ctx.body.templateId);
        if (!tpl) throw L.err(L.ERR.NOT_FOUND, '优惠券模板不存在：' + ctx.body.templateId);
        L.checkVersion(ctx, tpl, ctx.body.version, '优惠券模板');
        const accountIds = ctx.body.accountIds;
        if (!Array.isArray(accountIds) || !accountIds.length) {
          throw L.err(L.ERR.INVALID_INPUT, 'accountIds 必须是非空数组');
        }
        if (tpl.totalQuantity > 0) {
          const remain = tpl.totalQuantity - Number(tpl.issuedQuantity || 0);
          if (accountIds.length > remain) {
            throw L.err(L.ERR.QUOTA_EXCEEDED, `发放数量超出剩余额度（剩余 ${remain} 张）`);
          }
        }
        if (tpl.perAccountLimit > 0) {
          for (const aid of accountIds) {
            const used = (ctx.db.hqUserCoupons || []).filter((c) => c.accountId === aid && c.templateId === tpl.id).length;
            if (used >= tpl.perAccountLimit) {
              throw L.err(L.ERR.QUOTA_EXCEEDED, `账号 ${aid} 已达每账号限领上限（${tpl.perAccountLimit} 张）`);
            }
          }
        }
        const couponIds = [];
        for (const aid of accountIds) {
          const rec = {
            id: L.nextId(ctx.db, 'hqcp'),
            templateId: tpl.id,
            templateVersion: Number(tpl.version || 1),
            accountId: aid,
            snapshot: {
              title: tpl.title, amount: tpl.amount, minAmount: tpl.minAmount,
              scope: tpl.scope, validFrom: tpl.validFrom, expiresAt: tpl.expiresAt,
            },
            status: 'available',
            reservedOrderId: null,
            usedOrderId: null,
            version: 1,
            createdAt: L.nowIso(),
          };
          ctx.db.hqUserCoupons.push(rec);
          couponIds.push(rec.id);
        }
        tpl.issuedQuantity = Number(tpl.issuedQuantity || 0) + couponIds.length;
        L.bumpVersion(tpl);
        L.audit(ctx.db, {
          module: MODULE, action: 'issue', targetId: tpl.id, operator: ctx.operator, reason,
          before: { issuedQuantity: tpl.issuedQuantity - couponIds.length },
          after: { issuedQuantity: tpl.issuedQuantity, count: couponIds.length },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { templateId: tpl.id, couponIds, operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, templateDto, userCouponDto };

```
</details>

## 66. 渠道配置 + 最近任务 + 审计
`GET http://localhost:3000/api/hq/payments/catalog`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/payments.js:84`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/payments/catalog',
    async handler(ctx) {
      return {
        channels: (ctx.db.hqPaymentsChannels || []).map(channelDto),
        platforms: PLATFORMS.map((s) => ({ value: s, label: s })),
        businesses: BUSINESSES.map((s) => ({ value: s, label: s })),
        paymentChannels: CHANNELS.map((s) => ({ value: s, label: s })),
        statuses: PAY_STATUS.map((s) => ({ value: s, label: s })),
        recentJobs: (ctx.db.hqPaymentJobs || []).slice(-10).reverse(),
        audit: (ctx.db.hqAuditLogs || []).filter((a) => a.module === MODULE).slice(0, 30),
        summary: { total: (ctx.db.payments || []).length },
      };
    },
  },

  // ── 支付单分页 ──
  {
    module: MODULE,
```
</details>

## 67. 支付单分页
`GET http://localhost:3000/api/hq/payments`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/payments.js:103`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|keyword|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|status|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|channel|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|business|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|page|number|条件/未显式声明|读取及校验规则见下方实现|1|
|pageSize|number|条件/未显式声明|读取及校验规则见下方实现|1|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|id|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/payments',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const status = ctx.query.get('status') || '';
      const channel = ctx.query.get('channel') || '';
      const business = ctx.query.get('business') || '';
      let list = (ctx.db.payments || []).slice();
      if (keyword) list = list.filter((p) => L.matchKeyword(keyword, p.id, p.bizId, p.userId, p.transactionId));
      if (status) list = list.filter((p) => toEnumStatus(p) === status);
      if (channel) list = list.filter((p) => (p.meta && p.meta.channel ? p.meta.channel : p.channel) === channel);
      if (business) list = list.filter((p) => (p.bizType || 'MALL') === business);
      list.sort((a, b) => String(b.id).localeCompare(String(a.id)));
      const all = ctx.db.payments || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(paymentDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        success: all.filter((p) => toEnumStatus(p) === 'SUCCESS').length,
        totalAmount: L.money(all.filter((p) => toEnumStatus(p) === 'SUCCESS').reduce((a, p) => a + Number(p.amount || 0), 0)),
      });
    },
  },

  // ── 支付详情 + attempts ──
  {
    module: MODULE,
```
</details>

## 68. 支付详情 + attempts
`GET http://localhost:3000/api/hq/payments/:paymentId`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/payments.js:130`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|paymentId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/payments/:paymentId',
    async handler(ctx) {
      const p = (ctx.db.payments || []).find((x) => x.id === ctx.params.paymentId);
      if (!p) throw L.err(L.ERR.NOT_FOUND, '支付单不存在：' + ctx.params.paymentId);
      const attempts = (ctx.db.hqPaymentJobs || []).filter((j) => j.paymentId === p.id);
      return { payment: paymentDto(p), attempts };
    },
  },

  // ── 异步任务结果 ──
  {
    module: MODULE,
```
</details>

## 69. 异步任务结果
`GET http://localhost:3000/api/hq/payments/jobs/:jobId`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/payments.js:143`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|jobId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/payments/jobs/:jobId',
    async handler(ctx) {
      const j = (ctx.db.hqPaymentJobs || []).find((x) => x.id === ctx.params.jobId);
      if (!j) throw L.err(L.ERR.NOT_FOUND, '支付任务不存在：' + ctx.params.jobId);
      return { job: j };
    },
  },

  // ── 导出对账/流水 CSV 元数据 ──
  {
    module: MODULE,
```
</details>

## 70. 导出对账/流水 CSV 元数据
`GET http://localhost:3000/api/hq/payments/export`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/payments.js:155`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|
|statementDate|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|channel|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/payments/export',
    async handler(ctx) {
      const reason = ctx.query.get('reason') || '对账导出';
      const statementDate = ctx.query.get('statementDate') || null;
      const channel = ctx.query.get('channel') || null;
      let list = (ctx.db.payments || []).filter((p) => toEnumStatus(p) === 'SUCCESS');
      if (channel) list = list.filter((p) => (p.meta && p.meta.channel ? p.meta.channel : p.channel) === channel);
      const rows = list.map((p) => [
        p.id, p.bizId || '', p.userId || '', p.channel || 'WECHAT',
        p.bizType || 'MALL', toEnumStatus(p), L.money(p.amount || 0),
        p.transactionId || '', p.paidAt ? L.toIso(p.paidAt) : '', statementDate || '',
      ].join(','));
      const csv = ['paymentId,orderId,accountId,channel,business,status,amount,channelTradeNo,paidAt,statementDate']
        .concat(rows).join('\n');
      L.audit(ctx.db, {
        module: MODULE, action: 'export', targetId: statementDate || 'ALL', operator: ctx.operator,
        reason, before: null, after: { count: rows.length, channel, statementDate }, requestId: ctx.requestId,
      });
      ctx.save();
      return {
        fileName: `payments_${statementDate || 'all'}.csv`,
        contentType: 'text/csv; charset=utf-8',
        rowCount: rows.length,
        csv,
      };
    },
  },

  // ── save-channel / query / compensate / reconcile ──
  {
    module: MODULE,
```
</details>

## 71. 支付操作接口
`POST http://localhost:3000/api/hq/payments/mutate`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/payments.js:187`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|platform|JSON|是|读取及校验规则见下方实现|示例值|
|business|JSON|是|读取及校验规则见下方实现|示例值|
|channel|JSON|是|读取及校验规则见下方实现|示例值|
|configId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|enabled|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|paymentId|JSON|是|读取及校验规则见下方实现|有效资源ID|
|csv|JSON|是|读取及校验规则见下方实现|示例值|
|statementDate|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|fileName|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|action|JSON|是|读取及校验规则见下方实现|示例值|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "platform": "示例值",
  "business": "示例值",
  "channel": "示例值",
  "configId": "有效资源ID",
  "version": 1,
  "enabled": "示例值",
  "paymentId": "有效资源ID",
  "csv": "示例值",
  "statementDate": "示例值",
  "fileName": "示例值",
  "action": "示例值",
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/payments/mutate',
    async handler(ctx) {
      const { action } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['save-channel', 'query', 'compensate', 'reconcile'], 'action');
      L.ensureCollections(ctx.db);

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'save-channel') {
          L.requireFields(ctx.body, ['platform', 'business', 'channel']);
          L.ensureEnum(ctx.body.platform, PLATFORMS, 'platform');
          L.ensureEnum(ctx.body.business, BUSINESSES, 'business');
          L.ensureEnum(ctx.body.channel, CHANNELS, 'channel');
          let cfg = null;
          if (ctx.body.configId) {
            cfg = ctx.db.hqPaymentsChannels.find((c) => c.id === ctx.body.configId);
            if (!cfg) throw L.err(L.ERR.NOT_FOUND, '渠道配置不存在：' + ctx.body.configId);
            L.checkVersion(ctx, cfg, ctx.body.version, '渠道配置');
          } else {
            cfg = { id: L.nextId(ctx.db, 'hqpc'), version: 1 };
            ctx.db.hqPaymentsChannels.push(cfg);
          }
          const before = { enabled: cfg.enabled };
          cfg.platform = ctx.body.platform;
          cfg.business = ctx.body.business;
          cfg.channel = ctx.body.channel;
          cfg.enabled = ctx.body.enabled === undefined ? cfg.enabled !== false : !!ctx.body.enabled;
          L.bumpVersion(cfg);
          L.audit(ctx.db, {
            module: MODULE, action: 'save-channel', targetId: cfg.id, operator: ctx.operator, reason,
            before, after: { enabled: cfg.enabled }, requestId: ctx.requestId, id: operationId,
          });
          ctx.save();
          return { configId: cfg.id, config: channelDto(cfg), operationId };
        }

        if (action === 'query' || action === 'compensate') {
          L.requireFields(ctx.body, ['paymentId']);
          const p = (ctx.db.payments || []).find((x) => x.id === ctx.body.paymentId);
          if (!p) throw L.err(L.ERR.NOT_FOUND, '支付单不存在：' + ctx.body.paymentId);
          const job = {
            id: L.nextId(ctx.db, 'hqjob'),
            type: action,
            paymentId: p.id,
            status: 'succeeded',
            message: action === 'query' ? '查单完成（沙箱直通）' : '补偿完成（沙箱直通）',
            result: { paymentId: p.id, status: toEnumStatus(p), amount: L.money(p.amount || 0) },
            createdAt: L.nowIso(),
          };
          ctx.db.hqPaymentJobs.push(job);
          L.audit(ctx.db, {
            module: MODULE, action, targetId: p.id, operator: ctx.operator, reason,
            before: null, after: { jobId: job.id }, requestId: ctx.requestId, id: operationId,
          });
          ctx.save();
          return { jobId: job.id, paymentId: p.id, operationId };
        }

        // reconcile：对账
        L.requireFields(ctx.body, ['csv']);
        const rows = parseCsv(ctx.body.csv);
        const local = (ctx.db.payments || []).filter((p) => toEnumStatus(p) === 'SUCCESS');
        const diffs = [];
        for (const r of rows) {
          const tradeNo = r.channelTradeNo || r.tradeNo || '';
          const amount = L.money(r.amount || 0);
          const hit = local.find((p) => p.transactionId === tradeNo);
          if (!hit) {
            diffs.push({ tradeNo, channelAmount: amount, localAmount: null, reason: 'CHANNEL_ONLY' });
            continue;
          }
          const localAmount = L.money(hit.amount || 0);
          if (Math.abs(localAmount - amount) > 0.001) {
            diffs.push({ tradeNo, channelAmount: amount, localAmount, reason: 'AMOUNT_MISMATCH' });
          } else if (toEnumStatus(hit) !== (r.status || 'SUCCESS').toUpperCase()) {
            diffs.push({ tradeNo, channelAmount: amount, localAmount, reason: 'STATUS_MISMATCH' });
          }
        }
        const channelTrades = new Set(rows.map((r) => r.channelTradeNo || r.tradeNo || ''));
        for (const p of local) {
          if (!channelTrades.has(p.transactionId)) {
            diffs.push({
              tradeNo: p.transactionId, channelAmount: null, localAmount: L.money(p.amount || 0),
              reason: 'LOCAL_ONLY',
            });
          }
        }
        const job = {
          id: L.nextId(ctx.db, 'hqjob'),
          type: 'reconcile',
          status: 'succeeded',
          statementDate: ctx.body.statementDate || null,
          channel: ctx.body.channel || null,
          fileName: ctx.body.fileName || null,
          totalRows: rows.length,
          differenceCount: diffs.length,
          differences: diffs,
          createdAt: L.nowIso(),
        };
        ctx.db.hqPaymentJobs.push(job);
        ctx.db.hqReconciliation = ctx.db.hqReconciliation || [];
        ctx.db.hqReconciliation.push({
          id: job.id, statementDate: job.statementDate, channel: job.channel,
          totalRows: job.totalRows, differences: diffs, createdAt: job.createdAt,
        });
        L.audit(ctx.db, {
          module: MODULE, action: 'reconcile', targetId: job.id, operator: ctx.operator, reason,
          before: null, after: { totalRows: rows.length, differenceCount: diffs.length },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { jobId: job.id, operationId, differenceCount: diffs.length, differences: diffs };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, paymentDto, channelDto };

```
</details>

## 72. 收益账户分页
`GET http://localhost:3000/api/hq/revenue/accounts`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/revenue.js:73`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|keyword|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|page|number|条件/未显式声明|读取及校验规则见下方实现|1|
|pageSize|number|条件/未显式声明|读取及校验规则见下方实现|1|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|ownerId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/revenue/accounts',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      // 账户集合优先；没有则从佣金台账反推有收益的主体
      let accounts = (ctx.db.hqRevenueAccounts || []).slice();
      if (!accounts.length) {
        const ids = new Set((ctx.db.commissions || []).map((c) => c.owner_id).filter(Boolean));
        accounts = [...ids].map((id) => ({ id: `hqra_${id}`, ownerId: id, frozenBalance: 0, version: 1 }));
      }
      if (keyword) accounts = accounts.filter((a) => L.matchKeyword(keyword, a.id, a.ownerId));
      accounts.sort((a, b) => String(a.ownerId).localeCompare(String(b.ownerId)));
      const items = accounts.slice(paging.offset, paging.offset + paging.pageSize).map((a) => accountDto(ctx.db, a));
      return L.listData(items, accounts.length, paging.page, paging.pageSize, {
        total: accounts.length,
        totalEarned: L.money(items.reduce((a, x) => a + x.totalEarned, 0)),
      });
    },
  },

  // ── 目录 / 汇总 ──
  {
    module: MODULE,
```
</details>

## 73. 目录 / 汇总
`GET http://localhost:3000/api/hq/revenue/catalog`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/revenue.js:97`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/revenue/catalog',
    async handler(ctx) {
      const byType = {};
      for (const c of ctx.db.commissions || []) {
        const t = c.type || 'unknown';
        byType[t] = L.money((byType[t] || 0) + Number(c.amount || 0));
      }
      return {
        bizTypes: BIZ_TYPES.map((t) => ({ value: t, label: t })),
        byType,
        summary: {
          total: (ctx.db.commissions || []).length,
          totalAmount: L.money((ctx.db.commissions || []).reduce((a, c) => a + Number(c.amount || 0), 0)),
        },
      };
    },
  },

  // ── 全量流水分页 ──
  {
    module: MODULE,
```
</details>

## 74. 全量流水分页
`GET http://localhost:3000/api/hq/revenue/ledgers`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/revenue.js:119`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|ownerId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|bizType|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|period|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|from|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|to|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|page|number|条件/未显式声明|读取及校验规则见下方实现|1|
|pageSize|number|条件/未显式声明|读取及校验规则见下方实现|1|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|at|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|createdAt|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/revenue/ledgers',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const ownerId = ctx.query.get('ownerId') || '';
      const bizType = ctx.query.get('bizType') || '';
      const period = ctx.query.get('period') || '';
      const from = ctx.query.get('from') || '';
      const to = ctx.query.get('to') || '';

      let list = (ctx.db.commissions || []).slice();
      if (ownerId) list = list.filter((c) => c.owner_id === ownerId);
      if (bizType) list = list.filter((c) => (c.type || (c.subtype ? 'product' : 'unknown')) === bizType);
      if (period) list = list.filter((c) => c.period === period);
      if (from) list = list.filter((c) => new Date(c.at || c.createdAt || 0).getTime() >= new Date(from).getTime());
      if (to) list = list.filter((c) => new Date(c.at || c.createdAt || 0).getTime() <= new Date(to).getTime());
      list.sort((a, b) => new Date(b.at || b.createdAt || 0) - new Date(a.at || a.createdAt || 0));

      const all = ctx.db.commissions || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(ledgerDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        totalAmount: L.money(all.reduce((a, c) => a + Number(c.amount || 0), 0)),
      });
    },
  },

  // ── 账户详情 + 流水 ──
  {
    module: MODULE,
```
</details>

## 75. 账户详情 + 流水
`GET http://localhost:3000/api/hq/revenue/accounts/:accountId`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/revenue.js:149`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|accountId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/revenue/accounts/:accountId',
    async handler(ctx) {
      const ownerId = ctx.params.accountId;
      const acct = (ctx.db.hqRevenueAccounts || []).find((a) => a.ownerId === ownerId || a.id === ownerId);
      const base = acct || { id: `hqra_${ownerId}`, ownerId, frozenBalance: 0, version: 1 };
      const rows = (ctx.db.commissions || []).filter((c) => c.owner_id === ownerId);
      return {
        account: accountDto(ctx.db, base),
        ledgers: rows.map(ledgerDto),
      };
    },
  },

  // ── 调账 / 冻结 ──
  {
    module: MODULE,
```
</details>

## 76. 调账 / 冻结
`POST http://localhost:3000/api/hq/revenue/mutate`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/revenue.js:166`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|ownerId|JSON|是|读取及校验规则见下方实现|有效资源ID|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|delta|JSON|是|读取及校验规则见下方实现|示例值|
|amount|number|是|读取及校验规则见下方实现|1|
|action|JSON|是|读取及校验规则见下方实现|示例值|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "ownerId": "有效资源ID",
  "version": 1,
  "delta": "示例值",
  "amount": 1,
  "action": "示例值",
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/revenue/mutate',
    async handler(ctx) {
      const { action } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['adjust', 'freeze', 'unfreeze'], 'action');
      L.ensureCollections(ctx.db);

      return L.withIdempotency(ctx, () => {
        L.requireFields(ctx.body, ['ownerId']);
        const ownerId = String(ctx.body.ownerId);
        if (!ctx.db.users[ownerId]) throw L.err(L.ERR.NOT_FOUND, '主体不存在：' + ownerId);
        let acct = (ctx.db.hqRevenueAccounts || []).find((a) => a.ownerId === ownerId);
        if (!acct) {
          acct = { id: L.nextId(ctx.db, 'hqra'), ownerId, frozenBalance: 0, version: 1, createdAt: L.nowIso() };
          ctx.db.hqRevenueAccounts.push(acct);
        }
        L.checkVersion(ctx, acct, ctx.body.version, '收益账户');
        const before = { frozenBalance: L.money(acct.frozenBalance || 0) };
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'adjust') {
          L.requireFields(ctx.body, ['delta']);
          const delta = L.money(ctx.body.delta);
          if (delta === 0) throw L.err(L.ERR.INVALID_INPUT, 'delta 不能为 0');
          // 调账写一条佣金台账记录，保证「流水 = 余额」自洽
          ctx.db.commissions = ctx.db.commissions || [];
          ctx.db.commissions.push({
            id: L.nextId(ctx.db, 'c'),
            owner_id: ownerId,
            type: 'hq_adjust',
            subtype: 'manual_adjust',
            base_amount: Math.abs(delta),
            rate: null,
            amount: delta,
            period: L.nowIso().slice(0, 7),
            status: 'settled',
            formula: `总部调账 ${delta > 0 ? '+' : ''}${delta}（${reason}）`,
            ref_order_id: null,
            at: L.nowMs(),
          });
        } else if (action === 'freeze') {
          L.requireFields(ctx.body, ['amount']);
          const amt = L.money(ctx.body.amount);
          if (amt <= 0) throw L.err(L.ERR.INVALID_INPUT, '冻结金额必须大于 0');
          acct.frozenBalance = L.money(Number(acct.frozenBalance || 0) + amt);
        } else if (action === 'unfreeze') {
          L.requireFields(ctx.body, ['amount']);
          const amt = L.money(ctx.body.amount);
          if (amt <= 0) throw L.err(L.ERR.INVALID_INPUT, '解冻金额必须大于 0');
          acct.frozenBalance = L.money(Math.max(0, Number(acct.frozenBalance || 0) - amt));
        }
        L.bumpVersion(acct);
        L.audit(ctx.db, {
          module: MODULE, action, targetId: acct.id, operator: ctx.operator, reason,
          before, after: { frozenBalance: L.money(acct.frozenBalance || 0) },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { account: accountDto(ctx.db, acct), operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, accountDto, ledgerDto };

```
</details>

## 77. 提现单分页
`GET http://localhost:3000/api/hq/withdrawals`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/withdrawals.js:63`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|keyword|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|status|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|accountId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|page|number|条件/未显式声明|读取及校验规则见下方实现|1|
|pageSize|number|条件/未显式声明|读取及校验规则见下方实现|1|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|createdAt|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|created_at|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/withdrawals',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const status = ctx.query.get('status') || '';
      const accountId = ctx.query.get('accountId') || '';
      let list = (ctx.db.withdrawals || []).slice();
      if (keyword) list = list.filter((w) => L.matchKeyword(keyword, w.id, w.userId, w.accountName));
      if (status) list = list.filter((w) => toEnumStatus(w) === status);
      if (accountId) list = list.filter((w) => (w.userId || w.accountId) === accountId);
      list.sort((a, b) => new Date(b.createdAt || b.created_at || 0) - new Date(a.createdAt || a.created_at || 0));
      const all = ctx.db.withdrawals || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map((w) => withdrawalDto(w));
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        pending: all.filter((w) => toEnumStatus(w) === 'PENDING').length,
        pendingAmount: L.money(all.filter((w) => toEnumStatus(w) === 'PENDING')
          .reduce((a, w) => a + Number(w.amount || 0), 0)),
      });
    },
  },

  // ── 状态目录与汇总 ──
  {
    module: MODULE,
```
</details>

## 78. 状态目录与汇总
`GET http://localhost:3000/api/hq/withdrawals/catalog`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/withdrawals.js:89`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/withdrawals/catalog',
    async handler(ctx) {
      const all = ctx.db.withdrawals || [];
      const byStatus = {};
      for (const w of all) {
        const s = toEnumStatus(w);
        byStatus[s] = (byStatus[s] || 0) + 1;
      }
      return {
        statuses: WITHDRAW_STATUS.map((s) => ({ value: s, label: s, count: byStatus[s] || 0 })),
        channels: [
          { value: 'bank', label: '银行卡' },
          { value: 'wechat', label: '微信' },
          { value: 'alipay', label: '支付宝' },
        ],
        summary: {
          total: all.length,
          totalAmount: L.money(all.reduce((a, w) => a + Number(w.amount || 0), 0)),
        },
      };
    },
  },

  // ── 详情 ──
  {
    module: MODULE,
```
</details>

## 79. 详情
`GET http://localhost:3000/api/hq/withdrawals/:withdrawalId`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/withdrawals.js:116`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|withdrawalId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/withdrawals/:withdrawalId',
    async handler(ctx) {
      const w = (ctx.db.withdrawals || []).find((x) => x.id === ctx.params.withdrawalId);
      if (!w) throw L.err(L.ERR.NOT_FOUND, '提现单不存在：' + ctx.params.withdrawalId);
      const audit = (ctx.db.hqAuditLogs || []).filter((a) => a.module === MODULE && a.targetId === w.id).slice(0, 20);
      return { withdrawal: withdrawalDto(w, { reveal: true }), audit };
    },
  },

  // ── 审核通过 / 拒绝 / 打款回执 ──
  {
    module: MODULE,
```
</details>

## 80. 审核通过 / 拒绝 / 打款回执
`POST http://localhost:3000/api/hq/withdrawals/:withdrawalId/mutate`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/withdrawals.js:129`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|withdrawalId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|rejectionReason|JSON|是|读取及校验规则见下方实现|示例值|
|transactionId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|action|JSON|是|读取及校验规则见下方实现|示例值|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "rejectionReason": "示例值",
  "transactionId": "有效资源ID",
  "action": "示例值",
  "version": 1,
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/withdrawals/:withdrawalId/mutate',
    async handler(ctx) {
      const { action, version } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['approve', 'reject', 'mark-paid', 'mark-failed'], 'action');
      const w = (ctx.db.withdrawals || []).find((x) => x.id === ctx.params.withdrawalId);
      if (!w) throw L.err(L.ERR.NOT_FOUND, '提现单不存在：' + ctx.params.withdrawalId);
      L.checkVersion(ctx, w, version, '提现单');
      const before = { status: toEnumStatus(w) };

      return L.withIdempotency(ctx, () => {
        const status = toEnumStatus(w);
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'approve') {
          if (status !== 'PENDING') throw L.err(L.ERR.INVALID_STATE, '仅待审核的提现单可通过');
          w.status = 'approved';
          w.approvedAt = L.nowIso();
          w.approvedBy = ctx.operator ? ctx.operator.adminId : 'admin';
        } else if (action === 'reject') {
          if (status !== 'PENDING') throw L.err(L.ERR.INVALID_STATE, '仅待审核的提现单可拒绝');
          L.requireFields(ctx.body, ['rejectionReason']);
          w.status = 'rejected';
          w.rejectReason = String(ctx.body.rejectionReason);
          w.reviewReason = reason;
          w.reviewedAt = L.nowIso();
          w.reviewedBy = ctx.operator ? ctx.operator.adminId : 'admin';
        } else if (action === 'mark-paid') {
          if (status !== 'APPROVED') throw L.err(L.ERR.INVALID_STATE, '仅已通过的提现单可标记打款');
          w.status = 'paid';
          w.paidAt = L.nowIso();
          w.transactionId = ctx.body.transactionId || w.transactionId || null;
        } else if (action === 'mark-failed') {
          if (status !== 'APPROVED') throw L.err(L.ERR.INVALID_STATE, '仅已通过的提现单可标记失败');
          w.status = 'failed';
          w.failedAt = L.nowIso();
          w.failReason = reason;
        }
        L.bumpVersion(w);
        L.audit(ctx.db, {
          module: MODULE, action, targetId: w.id, operator: ctx.operator, reason,
          before, after: { status: toEnumStatus(w) }, requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { withdrawal: withdrawalDto(w), operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, withdrawalDto };

```
</details>

## 81. 员工分页
`GET http://localhost:3000/api/hq/staff`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/staff.js:45`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|keyword|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|storeId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|status|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|page|number|条件/未显式声明|读取及校验规则见下方实现|1|
|pageSize|number|条件/未显式声明|读取及校验规则见下方实现|1|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|id|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/staff',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const storeId = ctx.query.get('storeId') || '';
      const status = ctx.query.get('status') || '';
      let list = (ctx.db.hqStaff || []).slice();
      if (keyword) list = list.filter((s) => L.matchKeyword(keyword, s.id, s.name, s.phone));
      if (storeId) list = list.filter((s) => s.storeId === storeId);
      if (status) list = list.filter((s) => (s.status || 'ACTIVE') === status);
      list.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const all = ctx.db.hqStaff || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(staffDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        active: all.filter((s) => (s.status || 'ACTIVE') === 'ACTIVE').length,
      });
    },
  },

  // ── 角色/门店目录 ──
  {
    module: MODULE,
```
</details>

## 82. 角色/门店目录
`GET http://localhost:3000/api/hq/staff/catalog`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/staff.js:69`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/staff/catalog',
    async handler(ctx) {
      const stores = [];
      const seen = new Set();
      for (const cs of ctx.db.coStores || []) {
        if (cs.store_id && !seen.has(cs.store_id)) {
          seen.add(cs.store_id);
          stores.push({ storeId: cs.store_id, name: cs.store_name || cs.store_id });
        }
      }
      for (const s of ctx.db.hqStores || []) {
        if (!seen.has(s.storeId)) {
          seen.add(s.storeId);
          stores.push({ storeId: s.storeId, name: s.name });
        }
      }
      return {
        roles: ROLE_OPTIONS,
        stores,
        statuses: STAFF_STATUS.map((s) => ({ value: s, label: s })),
        actions: [
          { value: 'create', label: '新增员工' },
          { value: 'update-role', label: '改角色' },
          { value: 'disable', label: '停用' },
          { value: 'enable', label: '启用' },
        ],
        summary: { total: (ctx.db.hqStaff || []).length },
      };
    },
  },

  // ── 详情 ──
  {
    module: MODULE,
```
</details>

## 83. 详情
`GET http://localhost:3000/api/hq/staff/:staffId`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/staff.js:104`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|staffId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/staff/:staffId',
    async handler(ctx) {
      const s = (ctx.db.hqStaff || []).find((x) => x.id === ctx.params.staffId);
      if (!s) throw L.err(L.ERR.NOT_FOUND, '员工不存在：' + ctx.params.staffId);
      return { staff: staffDto(s) };
    },
  },

  // ── 创建 / 改角色 / 停用 ──
  {
    module: MODULE,
```
</details>

## 84. 创建 / 改角色 / 停用
`POST http://localhost:3000/api/hq/staff/mutate`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/staff.js:116`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|accountId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|name|JSON|是|读取及校验规则见下方实现|示例值|
|phone|JSON|条件/未显式声明|读取及校验规则见下方实现|13800138000|
|storeId|JSON|是|读取及校验规则见下方实现|有效资源ID|
|roles|JSON|是|读取及校验规则见下方实现|示例值|
|staffId|JSON|是|读取及校验规则见下方实现|有效资源ID|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|action|JSON|是|读取及校验规则见下方实现|示例值|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "accountId": "有效资源ID",
  "name": "示例值",
  "phone": "13800138000",
  "storeId": "有效资源ID",
  "roles": "示例值",
  "staffId": "有效资源ID",
  "version": 1,
  "action": "示例值",
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/staff/mutate',
    async handler(ctx) {
      const { action } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['create', 'update-role', 'disable', 'enable'], 'action');
      L.ensureCollections(ctx.db);

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'create') {
          L.requireFields(ctx.body, ['name', 'storeId']);
          const rec = {
            id: L.nextId(ctx.db, 'hqst'),
            accountId: ctx.body.accountId || null,
            name: String(ctx.body.name),
            phone: ctx.body.phone || '',
            storeId: String(ctx.body.storeId),
            roles: Array.isArray(ctx.body.roles) ? ctx.body.roles : [],
            status: 'ACTIVE',
            version: 1,
            createdAt: L.nowIso(),
          };
          ctx.db.hqStaff.push(rec);
          L.audit(ctx.db, {
            module: MODULE, action: 'create', targetId: rec.id, operator: ctx.operator, reason,
            before: null, after: rec, requestId: ctx.requestId, id: operationId,
          });
          ctx.save();
          return { staff: staffDto(rec), operationId };
        }

        L.requireFields(ctx.body, ['staffId']);
        const rec = ctx.db.hqStaff.find((x) => x.id === ctx.body.staffId);
        if (!rec) throw L.err(L.ERR.NOT_FOUND, '员工不存在：' + ctx.body.staffId);
        L.checkVersion(ctx, rec, ctx.body.version, '员工');
        const before = { roles: (rec.roles || []).slice(), status: rec.status };

        if (action === 'update-role') {
          L.requireFields(ctx.body, ['roles']);
          if (!Array.isArray(ctx.body.roles)) throw L.err(L.ERR.INVALID_INPUT, 'roles 必须是数组');
          for (const r of ctx.body.roles) {
            if (!ROLE_OPTIONS.find((o) => o.value === r)) throw L.err(L.ERR.INVALID_INPUT, '角色码非法：' + r);
          }
          rec.roles = ctx.body.roles;
        } else if (action === 'disable') {
          if (rec.status === 'DISABLED') throw L.err(L.ERR.INVALID_STATE, '该员工已停用');
          rec.status = 'DISABLED';
          rec.disabledAt = L.nowIso();
        } else if (action === 'enable') {
          if (rec.status !== 'DISABLED') throw L.err(L.ERR.INVALID_STATE, '该员工未停用');
          rec.status = 'ACTIVE';
        }
        L.bumpVersion(rec);
        L.audit(ctx.db, {
          module: MODULE, action, targetId: rec.id, operator: ctx.operator, reason,
          before, after: { roles: (rec.roles || []).slice(), status: rec.status },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { staff: staffDto(rec), operationId };
      });
    },
  },

  // ── 针对单人 mutate ──
  {
    module: MODULE,
```
</details>

## 85. 针对单人 mutate
`POST http://localhost:3000/api/hq/staff/:staffId/mutate`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/staff.js:186`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|staffId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|roles|JSON|是|读取及校验规则见下方实现|示例值|
|action|JSON|是|读取及校验规则见下方实现|示例值|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "roles": "示例值",
  "action": "示例值",
  "version": 1,
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/staff/:staffId/mutate',
    async handler(ctx) {
      const { action, version } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['update-role', 'disable', 'enable'], 'action');
      const rec = (ctx.db.hqStaff || []).find((x) => x.id === ctx.params.staffId);
      if (!rec) throw L.err(L.ERR.NOT_FOUND, '员工不存在：' + ctx.params.staffId);
      L.checkVersion(ctx, rec, version, '员工');
      const before = { roles: (rec.roles || []).slice(), status: rec.status };

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');
        if (action === 'update-role') {
          L.requireFields(ctx.body, ['roles']);
          if (!Array.isArray(ctx.body.roles)) throw L.err(L.ERR.INVALID_INPUT, 'roles 必须是数组');
          for (const r of ctx.body.roles) {
            if (!ROLE_OPTIONS.find((o) => o.value === r)) throw L.err(L.ERR.INVALID_INPUT, '角色码非法：' + r);
          }
          rec.roles = ctx.body.roles;
        } else if (action === 'disable') {
          if (rec.status === 'DISABLED') throw L.err(L.ERR.INVALID_STATE, '该员工已停用');
          rec.status = 'DISABLED';
        } else if (action === 'enable') {
          if (rec.status !== 'DISABLED') throw L.err(L.ERR.INVALID_STATE, '该员工未停用');
          rec.status = 'ACTIVE';
        }
        L.bumpVersion(rec);
        L.audit(ctx.db, {
          module: MODULE, action, targetId: rec.id, operator: ctx.operator, reason,
          before, after: { roles: (rec.roles || []).slice(), status: rec.status },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { staff: staffDto(rec), operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, staffDto };

```
</details>

## 86. 门店分页
`GET http://localhost:3000/api/hq/stores`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/stores.js:71`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|keyword|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|active|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|page|number|条件/未显式声明|读取及校验规则见下方实现|1|
|pageSize|number|条件/未显式声明|读取及校验规则见下方实现|1|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|storeId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/stores',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const active = ctx.query.get('active');
      let list = collectStores(ctx.db);
      if (keyword) list = list.filter((s) => L.matchKeyword(keyword, s.storeId, s.name, s.code, s.managerName));
      if (active === 'true' || active === '1') list = list.filter((s) => s.active !== false);
      if (active === 'false' || active === '0') list = list.filter((s) => s.active === false);
      list.sort((a, b) => String(a.storeId).localeCompare(String(b.storeId)));
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(storeDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: list.length,
        active: list.filter((s) => s.active !== false).length,
      });
    },
  },

  // ── 筛选项 ──
  {
    module: MODULE,
```
</details>

## 87. 筛选项
`GET http://localhost:3000/api/hq/stores/catalog`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/stores.js:93`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/stores/catalog',
    async handler(ctx) {
      const list = collectStores(ctx.db);
      return {
        stores: list.map((s) => ({ storeId: s.storeId, name: s.name || s.storeId })),
        summary: { total: list.length, active: list.filter((s) => s.active !== false).length },
      };
    },
  },

  // ── 详情 ──
  {
    module: MODULE,
```
</details>

## 88. 详情
`GET http://localhost:3000/api/hq/stores/:storeId`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/stores.js:107`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|storeId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/stores/:storeId',
    async handler(ctx) {
      const s = collectStores(ctx.db).find((x) => x.storeId === ctx.params.storeId);
      if (!s) throw L.err(L.ERR.NOT_FOUND, '门店不存在：' + ctx.params.storeId);
      const members = (ctx.db.members || []).filter((m) => m.storeId === s.storeId);
      const staff = (ctx.db.hqStaff || []).filter((x) => x.storeId === s.storeId);
      return {
        store: storeDto(s),
        memberCount: members.length,
        staff: staff.map((x) => ({ staffId: x.id, name: x.name, roles: x.roles || [], status: x.status })),
      };
    },
  },

  // ── 创建 ──
  {
    module: MODULE,
```
</details>

## 89. 创建
`POST http://localhost:3000/api/hq/stores/mutate`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/stores.js:125`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|storeId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|name|JSON|是|读取及校验规则见下方实现|示例值|
|code|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|address|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|managerName|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|managerPhone|JSON|条件/未显式声明|读取及校验规则见下方实现|13800138000|
|ownerAccountId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|action|JSON|是|读取及校验规则见下方实现|示例值|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "storeId": "有效资源ID",
  "name": "示例值",
  "code": "示例值",
  "address": "示例值",
  "managerName": "示例值",
  "managerPhone": "13800138000",
  "ownerAccountId": "有效资源ID",
  "action": "示例值",
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/stores/mutate',
    async handler(ctx) {
      const { action } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['create'], 'action');
      L.ensureCollections(ctx.db);

      return L.withIdempotency(ctx, () => {
        L.requireFields(ctx.body, ['name']);
        const storeId = ctx.body.storeId || L.nextId(ctx.db, 'st');
        const rec = {
          storeId,
          name: String(ctx.body.name),
          code: ctx.body.code || null,
          address: ctx.body.address || null,
          managerName: ctx.body.managerName || null,
          managerPhone: ctx.body.managerPhone || null,
          ownerAccountId: ctx.body.ownerAccountId || null,
          active: true,
          version: 1,
          createdAt: L.nowIso(),
        };
        ctx.db.hqStores.push(rec);
        const operationId = L.nextId(ctx.db, 'hqop');
        L.audit(ctx.db, {
          module: MODULE, action: 'create', targetId: storeId, operator: ctx.operator, reason,
          before: null, after: rec, requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { store: storeDto(rec), operationId };
      });
    },
  },

  // ── 更新 / 停用 / 改负责人 ──
  {
    module: MODULE,
```
</details>

## 90. 更新 / 停用 / 改负责人
`POST http://localhost:3000/api/hq/stores/:storeId/mutate`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/stores.js:164`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|storeId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|name|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|code|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|address|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|managerName|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|managerPhone|JSON|条件/未显式声明|读取及校验规则见下方实现|13800138000|
|ownerAccountId|JSON|是|读取及校验规则见下方实现|有效资源ID|
|action|JSON|是|读取及校验规则见下方实现|示例值|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "name": "示例值",
  "code": "示例值",
  "address": "示例值",
  "managerName": "示例值",
  "managerPhone": "13800138000",
  "ownerAccountId": "有效资源ID",
  "action": "示例值",
  "version": 1,
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/stores/:storeId/mutate',
    async handler(ctx) {
      const { action, version } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['update', 'disable', 'enable', 'change-owner'], 'action');
      const rec = (ctx.db.hqStores || []).find((x) => x.storeId === ctx.params.storeId);
      if (!rec) throw L.err(L.ERR.NOT_FOUND, '门店不存在（仅支持后台创建的门店改写）：' + ctx.params.storeId);
      L.checkVersion(ctx, rec, version, '门店');
      const before = { name: rec.name, active: rec.active, ownerAccountId: rec.ownerAccountId };

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');
        if (action === 'update') {
          if (ctx.body.name !== undefined) rec.name = String(ctx.body.name);
          if (ctx.body.code !== undefined) rec.code = ctx.body.code;
          if (ctx.body.address !== undefined) rec.address = ctx.body.address;
          if (ctx.body.managerName !== undefined) rec.managerName = ctx.body.managerName;
          if (ctx.body.managerPhone !== undefined) rec.managerPhone = ctx.body.managerPhone;
        } else if (action === 'disable') {
          if (rec.active === false) throw L.err(L.ERR.INVALID_STATE, '该门店已停用');
          rec.active = false;
        } else if (action === 'enable') {
          if (rec.active !== false) throw L.err(L.ERR.INVALID_STATE, '该门店未停用');
          rec.active = true;
        } else if (action === 'change-owner') {
          L.requireFields(ctx.body, ['ownerAccountId']);
          const ownerId = String(ctx.body.ownerAccountId);
          if (!ctx.db.users[ownerId]) throw L.err(L.ERR.NOT_FOUND, '店主账号不存在：' + ownerId);
          rec.ownerAccountId = ownerId;
        }
        L.bumpVersion(rec);
        L.audit(ctx.db, {
          module: MODULE, action, targetId: rec.storeId, operator: ctx.operator, reason,
          before, after: { name: rec.name, active: rec.active, ownerAccountId: rec.ownerAccountId },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { store: storeDto(rec), operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, storeDto, collectStores };

```
</details>

## 91. 会员课时余额分页
`GET http://localhost:3000/api/hq/training/balances`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/training.js:58`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|keyword|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|storeId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|page|number|条件/未显式声明|读取及校验规则见下方实现|1|
|pageSize|number|条件/未显式声明|读取及校验规则见下方实现|1|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|memberId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|accountId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|storeName|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|storeId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|trainingRemaining|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|specialRemaining|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/training/balances',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const storeId = ctx.query.get('storeId') || '';
      let list = (ctx.db.hqTrainingBalances || []).slice();
      if (keyword) list = list.filter((b) => L.matchKeyword(keyword, b.memberId, b.accountId, b.storeName));
      if (storeId) list = list.filter((b) => b.storeId === storeId);
      list.sort((a, b) => String(a.memberId).localeCompare(String(b.memberId)));
      const all = ctx.db.hqTrainingBalances || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(balanceDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        trainingRemaining: all.reduce((a, b) => a + Number(b.trainingRemaining || 0), 0),
        specialRemaining: all.reduce((a, b) => a + Number(b.specialRemaining || 0), 0),
      });
    },
  },

  // ── 反馈分页 ──
  {
    module: MODULE,
```
</details>

## 92. 反馈分页
`GET http://localhost:3000/api/hq/training/feedback`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/training.js:81`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|status|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|kind|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|page|number|条件/未显式声明|读取及校验规则见下方实现|1|
|pageSize|number|条件/未显式声明|读取及校验规则见下方实现|1|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|createdAt|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/training/feedback',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const status = ctx.query.get('status') || '';
      const kind = ctx.query.get('kind') || '';
      let list = (ctx.db.trainingFeedback || []).slice();
      if (status) list = list.filter((f) => (f.status || 'PENDING') === status);
      if (kind) list = list.filter((f) => (f.kind || 'COURSE') === kind);
      list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      const all = ctx.db.trainingFeedback || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(feedbackDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, { total: all.length });
    },
  },

  // ── 目录 ──
  {
    module: MODULE,
```
</details>

## 93. 目录
`GET http://localhost:3000/api/hq/training/catalog`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/training.js:100`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/training/catalog',
    async handler(ctx) {
      const stores = [];
      const seen = new Set();
      for (const m of ctx.db.members || []) {
        if (m.storeId && !seen.has(m.storeId)) {
          seen.add(m.storeId);
          stores.push({ storeId: m.storeId, name: m.storeName || m.storeId });
        }
      }
      return {
        stores,
        buckets: BUCKETS.map((b) => ({ value: b, label: b === 'TRAINING' ? '常规课时' : '专项课时' })),
        feedbackKinds: FEEDBACK_KINDS.map((k) => ({ value: k, label: k })),
        feedbackStatuses: FEEDBACK_STATUS.map((s) => ({ value: s, label: s })),
        summary: {
          balances: (ctx.db.hqTrainingBalances || []).length,
          feedback: (ctx.db.trainingFeedback || []).length,
        },
      };
    },
  },

  // ── 会员余额 + 消耗 + 反馈详情 ──
  {
    module: MODULE,
```
</details>

## 94. 会员余额 + 消耗 + 反馈详情
`GET http://localhost:3000/api/hq/training/members/:memberId`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/training.js:127`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|memberId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|memberId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/training/members/:memberId',
    async handler(ctx) {
      const memberId = ctx.params.memberId;
      const member = (ctx.db.members || []).find((m) => m.id === memberId);
      if (!member) throw L.err(L.ERR.NOT_FOUND, '会员不存在：' + memberId);
      const acct = (ctx.db.hqTrainingBalances || []).find((b) => b.memberId === memberId);
      const t = (member.training || {});
      const balance = acct || {
        memberId,
        accountId: member.userId,
        storeId: member.storeId || null,
        trainingTotal: Number(t.trainingTotal || 0),
        trainingUsed: Number(t.trainingUsed || 0),
        trainingRemaining: Math.max(0, Number(t.trainingTotal || 0) - Number(t.trainingUsed || 0)),
        specialTotal: Number(t.specialTotal || 0),
        specialUsed: Number(t.specialUsed || 0),
        specialRemaining: Math.max(0, Number(t.specialTotal || 0) - Number(t.specialUsed || 0)),
        version: 1,
      };
      const feedback = (ctx.db.trainingFeedback || []).filter((f) => f.memberId === memberId);
      const progress = (ctx.db.learningProgress || []).filter((p) => p.memberId === memberId);
      return { balance: balanceDto(balance), feedback: feedback.map(feedbackDto), progress };
    },
  },

  // ── proxy-feedback / withdraw-feedback / consume-lessons ──
  {
    module: MODULE,
```
</details>

## 95. 训练操作接口
`POST http://localhost:3000/api/hq/training/mutate`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/training.js:156`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|kind|JSON|是|读取及校验规则见下方实现|示例值|
|memberId|JSON|是|读取及校验规则见下方实现|有效资源ID|
|title|JSON|是|读取及校验规则见下方实现|示例值|
|body|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|feedbackId|JSON|是|读取及校验规则见下方实现|有效资源ID|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|bucket|JSON|是|读取及校验规则见下方实现|示例值|
|quantity|number|是|读取及校验规则见下方实现|1|
|action|JSON|是|读取及校验规则见下方实现|示例值|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "kind": "示例值",
  "memberId": "有效资源ID",
  "title": "示例值",
  "body": "示例值",
  "feedbackId": "有效资源ID",
  "version": 1,
  "bucket": "示例值",
  "quantity": 1,
  "action": "示例值",
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/training/mutate',
    async handler(ctx) {
      const { action } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['proxy-feedback', 'withdraw-feedback', 'consume-lessons'], 'action');
      L.ensureCollections(ctx.db);

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'proxy-feedback') {
          L.requireFields(ctx.body, ['memberId', 'kind', 'title']);
          L.ensureEnum(ctx.body.kind, FEEDBACK_KINDS, 'kind');
          const member = (ctx.db.members || []).find((m) => m.id === ctx.body.memberId);
          if (!member) throw L.err(L.ERR.NOT_FOUND, '会员不存在：' + ctx.body.memberId);
          const rec = {
            id: L.nextId(ctx.db, 'tfb'),
            memberId: ctx.body.memberId,
            accountId: member.userId,
            kind: ctx.body.kind,
            title: String(ctx.body.title),
            body: ctx.body.body || '',
            status: 'PROXIED',
            proxy: true,
            proxyReason: reason,
            createdAt: L.nowIso(),
            version: 1,
          };
          ctx.db.trainingFeedback.push(rec);
          L.audit(ctx.db, {
            module: MODULE, action, targetId: rec.id, operator: ctx.operator, reason,
            before: null, after: rec, requestId: ctx.requestId, id: operationId,
          });
          ctx.save();
          return { feedback: feedbackDto(rec), operationId };
        }

        if (action === 'withdraw-feedback') {
          L.requireFields(ctx.body, ['feedbackId']);
          const f = (ctx.db.trainingFeedback || []).find((x) => x.id === ctx.body.feedbackId);
          if (!f) throw L.err(L.ERR.NOT_FOUND, '反馈不存在：' + ctx.body.feedbackId);
          L.checkVersion(ctx, f, ctx.body.version, '反馈');
          const before = { status: f.status };
          if (f.status === 'WITHDRAWN') throw L.err(L.ERR.INVALID_STATE, '该反馈已撤回');
          f.status = 'WITHDRAWN';
          f.withdrawReason = reason;
          f.withdrawnAt = L.nowIso();
          L.bumpVersion(f);
          L.audit(ctx.db, {
            module: MODULE, action, targetId: f.id, operator: ctx.operator, reason,
            before, after: { status: f.status }, requestId: ctx.requestId, id: operationId,
          });
          ctx.save();
          return { feedback: feedbackDto(f), operationId };
        }

        // consume-lessons：扣课时
        L.requireFields(ctx.body, ['memberId', 'bucket', 'quantity']);
        L.ensureEnum(ctx.body.bucket, BUCKETS, 'bucket');
        const qty = Number(ctx.body.quantity);
        if (!Number.isInteger(qty) || qty <= 0) throw L.err(L.ERR.INVALID_INPUT, 'quantity 必须是正整数');
        const member = (ctx.db.members || []).find((m) => m.id === ctx.body.memberId);
        if (!member) throw L.err(L.ERR.NOT_FOUND, '会员不存在：' + ctx.body.memberId);
        let acct = (ctx.db.hqTrainingBalances || []).find((b) => b.memberId === ctx.body.memberId);
        if (!acct) {
          const t = member.training || {};
          acct = {
            memberId: ctx.body.memberId,
            accountId: member.userId,
            storeId: member.storeId || null,
            trainingTotal: Number(t.trainingTotal || 0),
            trainingUsed: Number(t.trainingUsed || 0),
            trainingRemaining: Math.max(0, Number(t.trainingTotal || 0) - Number(t.trainingUsed || 0)),
            specialTotal: Number(t.specialTotal || 0),
            specialUsed: Number(t.specialUsed || 0),
            specialRemaining: Math.max(0, Number(t.specialTotal || 0) - Number(t.specialUsed || 0)),
            version: 1,
          };
          ctx.db.hqTrainingBalances.push(acct);
        }
        L.checkVersion(ctx, acct, ctx.body.version, '课时余额');
        const before = balanceDto(acct);
        const remainKey = ctx.body.bucket === 'TRAINING' ? 'trainingRemaining' : 'specialRemaining';
        const usedKey = ctx.body.bucket === 'TRAINING' ? 'trainingUsed' : 'specialUsed';
        const totalKey = ctx.body.bucket === 'TRAINING' ? 'trainingTotal' : 'specialTotal';
        if (Number(acct[remainKey] || 0) < qty) {
          throw L.err(L.ERR.QUOTA_EXCEEDED, `课时余额不足（剩余 ${acct[remainKey] || 0}，需扣 ${qty}）`);
        }
        acct[remainKey] = Number(acct[remainKey] || 0) - qty;
        acct[usedKey] = Number(acct[usedKey] || 0) + qty;
        acct[totalKey] = Number(acct[totalKey] || 0) + qty;
        // 同步既有业务侧课时字段
        if (!member.training) member.training = {};
        member.training[ctx.body.bucket === 'TRAINING' ? 'trainingUsed' : 'specialUsed'] = acct[usedKey];
        member.training[ctx.body.bucket === 'TRAINING' ? 'trainingTotal' : 'specialTotal'] = acct[totalKey];
        L.bumpVersion(acct);
        L.audit(ctx.db, {
          module: MODULE, action, targetId: acct.memberId, operator: ctx.operator, reason,
          before, after: balanceDto(acct), requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { balance: balanceDto(acct), operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, balanceDto, feedbackDto };

```
</details>

## 96. 申请分页
`GET http://localhost:3000/api/hq/transfers`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/transfers.js:68`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|keyword|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|status|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|migrationStatus|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|page|number|条件/未显式声明|读取及校验规则见下方实现|1|
|pageSize|number|条件/未显式声明|读取及校验规则见下方实现|1|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|id|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/transfers',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const status = ctx.query.get('status') || '';
      const migrationStatus = ctx.query.get('migrationStatus') || '';
      let list = (ctx.db.storeTransfers || []).slice();
      if (keyword) list = list.filter((t) => L.matchKeyword(keyword, t.id, t.memberId, t.memberName, t.displayId));
      if (status) list = list.filter((t) => (t.status || overallStatus(t)) === status);
      if (migrationStatus) list = list.filter((t) => (t.migrationStatus || 'NOT_STARTED') === migrationStatus);
      list.sort((a, b) => String(b.id).localeCompare(String(a.id)));
      const all = ctx.db.storeTransfers || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(transferDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        pending: all.filter((t) => (t.status || overallStatus(t)) === 'PENDING').length,
        awaitingMigration: all.filter((t) => (t.migrationStatus || 'NOT_STARTED') === 'AWAITING_SERVER').length,
      });
    },
  },

  // ── 门店/状态/pendingPolicy 目录 ──
  {
    module: MODULE,
```
</details>

## 97. 门店/状态/pendingPolicy 目录
`GET http://localhost:3000/api/hq/transfers/catalog`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/transfers.js:93`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/transfers/catalog',
    async handler(ctx) {
      const stores = [];
      const seen = new Set();
      for (const cs of ctx.db.coStores || []) {
        if (cs.store_id && !seen.has(cs.store_id)) {
          seen.add(cs.store_id);
          stores.push({ storeId: cs.store_id, name: cs.store_name || cs.store_id });
        }
      }
      for (const s of ctx.db.hqStores || []) {
        if (!seen.has(s.storeId)) {
          seen.add(s.storeId);
          stores.push({ storeId: s.storeId, name: s.name });
        }
      }
      return {
        stores,
        sideApprovalStatuses: SIDE_APPROVAL.map((s) => ({ value: s, label: s })),
        overallStatuses: OVERALL_STATUS.map((s) => ({ value: s, label: s })),
        migrationStatuses: MIGRATION_STATUS.map((s) => ({ value: s, label: s })),
        exceptionFlags: EXCEPTION_FLAG.map((s) => ({ value: s, label: s })),
        pendingPolicy: {
          unusedTrainingLessons: '申请时剩余常规课时快照；仅作展示，实际结算口径以财务确认为准',
          unusedSpecialLessons: '申请时剩余专项课时快照；仅作展示，实际结算口径以财务确认为准',
          followUpOrders: '迁移后由原门店产生的后续订单归属，需双方门店在系统内二次确认',
          historicalFeedback: '历史培训反馈与课后记录随会员档案保留，不随门店迁移',
          unsettledRevenue: '未结算收益不随转店转移，仍归属原门店及其上级代理',
        },
        summary: { total: (ctx.db.storeTransfers || []).length },
      };
    },
  },

  // ── 详情 ──
  {
    module: MODULE,
```
</details>

## 98. 详情
`GET http://localhost:3000/api/hq/transfers/:applicationId`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/transfers.js:131`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|applicationId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/transfers/:applicationId',
    async handler(ctx) {
      const t = (ctx.db.storeTransfers || []).find((x) => x.id === ctx.params.applicationId);
      if (!t) throw L.err(L.ERR.NOT_FOUND, '转店申请不存在：' + ctx.params.applicationId);
      const audit = (ctx.db.hqAuditLogs || []).filter((a) => a.module === MODULE && a.targetId === t.id).slice(0, 20);
      return { transfer: transferDto(t), audit };
    },
  },

  // ── HQ 监管写操作 ──
  {
    module: MODULE,
```
</details>

## 99. HQ 监管写操作
`POST http://localhost:3000/api/hq/transfers/:applicationId/mutate`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/transfers.js:144`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|applicationId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|note|JSON|是|读取及校验规则见下方实现|示例值|
|receipt|JSON|是|读取及校验规则见下方实现|示例值|
|receiptNote|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|action|JSON|是|读取及校验规则见下方实现|示例值|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "note": "示例值",
  "receipt": "示例值",
  "receiptNote": "示例值",
  "action": "示例值",
  "version": 1,
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/transfers/:applicationId/mutate',
    async handler(ctx) {
      const { action, version } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['force-reject', 'flag-exception', 'clear-exception', 'add-note', 'record-migration-receipt'], 'action');
      const t = (ctx.db.storeTransfers || []).find((x) => x.id === ctx.params.applicationId);
      if (!t) throw L.err(L.ERR.NOT_FOUND, '转店申请不存在：' + ctx.params.applicationId);
      L.checkVersion(ctx, t, version, '转店申请');
      const before = {
        status: t.status || overallStatus(t),
        exceptionFlag: t.exceptionFlag || 'NONE',
        migrationStatus: t.migrationStatus || 'NOT_STARTED',
        hqNote: t.hqNote || null,
      };

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'force-reject') {
          if ((t.status || overallStatus(t)) === 'REJECTED') throw L.err(L.ERR.INVALID_STATE, '该申请已被拒绝');
          t.status = 'REJECTED';
          t.sourceApprovalStatus = 'REJECTED';
          t.targetApprovalStatus = 'REJECTED';
          t.forceRejectedAt = L.nowIso();
        } else if (action === 'flag-exception') {
          if ((t.exceptionFlag || 'NONE') === 'FLAGGED') throw L.err(L.ERR.INVALID_STATE, '该申请已标记异常');
          t.exceptionFlag = 'FLAGGED';
          t.exceptionReason = reason;
          t.flaggedAt = L.nowIso();
        } else if (action === 'clear-exception') {
          if ((t.exceptionFlag || 'NONE') !== 'FLAGGED') throw L.err(L.ERR.INVALID_STATE, '该申请未标记异常');
          t.exceptionFlag = 'NONE';
          t.exceptionReason = null;
          t.clearedAt = L.nowIso();
        } else if (action === 'add-note') {
          L.requireFields(ctx.body, ['note']);
          t.hqNote = String(ctx.body.note);
        } else if (action === 'record-migration-receipt') {
          L.requireFields(ctx.body, ['receipt']);
          L.ensureEnum(ctx.body.receipt, ['SUCCESS', 'FAILED'], 'receipt');
          // 双侧均同意后才允许登记迁移回执
          if ((t.status || overallStatus(t)) !== 'APPROVED') {
            throw L.err(L.ERR.INVALID_STATE, '双方同意后方可登记迁移回执');
          }
          t.migrationStatus = ctx.body.receipt === 'SUCCESS' ? 'RECEIPTED_SUCCESS' : 'RECEIPTED_FAILED';
          t.migrationReceipt = ctx.body.receipt;
          t.migrationReceiptNote = ctx.body.receiptNote || null;
          t.migrationReceiptAt = L.nowIso();
        }
        L.bumpVersion(t);
        L.audit(ctx.db, {
          module: MODULE, action, targetId: t.id, operator: ctx.operator, reason,
          before,
          after: {
            status: t.status || overallStatus(t),
            exceptionFlag: t.exceptionFlag || 'NONE',
            migrationStatus: t.migrationStatus || 'NOT_STARTED',
            hqNote: t.hqNote || null,
          },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { transfer: transferDto(t), operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, transferDto };

```
</details>

## 100. 合伙人分页
`GET http://localhost:3000/api/hq/partners`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/partners.js:89`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|keyword|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|partnerLevel|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|partnerStatus|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|page|number|条件/未显式声明|读取及校验规则见下方实现|1|
|pageSize|number|条件/未显式声明|读取及校验规则见下方实现|1|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/partners',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const partnerLevel = ctx.query.get('partnerLevel') || '';
      const partnerStatus = ctx.query.get('partnerStatus') || '';

      let list = (ctx.db.hqPartnerContexts || []).slice();
      if (!list.length) {
        list = Object.keys(ctx.db.users || {}).map((id) => readContext(ctx.db, `partner:${id}`)).filter(Boolean);
      }
      if (keyword) list = list.filter((c) => {
        const u = ctx.db.users[c.accountId];
        return L.matchKeyword(keyword, c.contextId, c.accountId, u && u.name, u && u.phone, u && u.display_id);
      });
      if (partnerLevel) list = list.filter((c) => c.partnerLevel === partnerLevel);
      if (partnerStatus) list = list.filter((c) => (c.partnerStatus || 'ACTIVE') === partnerStatus);

      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map((c) => contextDto(ctx.db, c));
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: list.length,
        byLevel: PARTNER_LEVELS.reduce((a, lv) => {
          a[lv] = list.filter((c) => c.partnerLevel === lv).length;
          return a;
        }, {}),
      });
    },
  },

  // ── 等级权益、回执、审计目录 ──
  {
    module: MODULE,
```
</details>

## 101. 等级权益、回执、审计目录
`GET http://localhost:3000/api/hq/partners/catalog`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/partners.js:122`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|partnerLevel|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|summary|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|content|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/partners/catalog',
    async handler(ctx) {
      return {
        partnerLevels: PARTNER_LEVELS.map((l) => ({ value: l, label: l })),
        partnerStatuses: PARTNER_STATUS.map((s) => ({ value: s, label: s })),
        annualStatuses: ANNUAL_STATUS.map((s) => ({ value: s, label: s })),
        taskStatuses: TASK_STATUS.map((s) => ({ value: s, label: s })),
        benefits: (ctx.db.hqPartnerBenefits || []).map((b) => ({
          partnerLevel: b.partnerLevel,
          summary: b.summary || '',
          content: b.content || null,
          version: Number(b.version || 1),
        })),
        audit: (ctx.db.hqAuditLogs || []).filter((a) => a.module === MODULE).slice(0, 30),
        summary: { total: Object.keys(ctx.db.users || {}).length },
      };
    },
  },

  // ── 详情（档案 + 任务 + 回执 + 审计）──
  {
    module: MODULE,
```
</details>

## 102. 详情（档案 + 任务 + 回执 + 审计）
`GET http://localhost:3000/api/hq/partners/:contextId`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/partners.js:145`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|contextId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/partners/:contextId',
    async handler(ctx) {
      const c = readContext(ctx.db, ctx.params.contextId);
      if (!c) throw L.err(L.ERR.NOT_FOUND, '合伙上下文不存在：' + ctx.params.contextId);
      const receipts = (ctx.db.hqAuditLogs || [])
        .filter((a) => a.module === MODULE && a.targetId === c.contextId && a.action === 'upgrade')
        .map((a) => ({ receiptId: a.id, at: a.occurredAt, reason: a.reason, after: a.after }));
      const audit = (ctx.db.hqAuditLogs || []).filter((a) => a.module === MODULE && a.targetId === c.contextId).slice(0, 20);
      return { partner: contextDto(ctx.db, c, { reveal: true }), receipts, audit };
    },
  },

  // ── upgrade / save-benefits ──
  {
    module: MODULE,
```
</details>

## 103. 业务操作接口
`POST http://localhost:3000/api/hq/partners/mutate`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/partners.js:161`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|targetLevel|JSON|是|读取及校验规则见下方实现|示例值|
|contextId|JSON|是|读取及校验规则见下方实现|有效资源ID|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|partnerLevel|JSON|是|读取及校验规则见下方实现|示例值|
|summary|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|content|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|action|JSON|是|读取及校验规则见下方实现|示例值|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "targetLevel": "示例值",
  "contextId": "有效资源ID",
  "version": 1,
  "partnerLevel": "示例值",
  "summary": "示例值",
  "content": "示例值",
  "action": "示例值",
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/partners/mutate',
    async handler(ctx) {
      const { action } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['upgrade', 'save-benefits'], 'action');
      L.ensureCollections(ctx.db);

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'upgrade') {
          L.requireFields(ctx.body, ['contextId', 'targetLevel']);
          L.ensureEnum(ctx.body.targetLevel, PARTNER_LEVELS, 'targetLevel');
          let c = (ctx.db.hqPartnerContexts || []).find((x) => x.contextId === ctx.body.contextId);
          if (!c) {
            const derived = readContext(ctx.db, ctx.body.contextId);
            if (!derived) throw L.err(L.ERR.NOT_FOUND, '合伙上下文不存在：' + ctx.body.contextId);
            c = derived;
            ctx.db.hqPartnerContexts.push(c);
          }
          L.checkVersion(ctx, c, ctx.body.version, '合伙档案');
          const before = { partnerLevel: c.partnerLevel, frozen: !!c.frozen };
          const targetTier = LEVEL_TO_TIER[ctx.body.targetLevel];
          const u = ctx.db.users[c.accountId];
          if (!u) throw L.err(L.ERR.NOT_FOUND, '账号不存在：' + c.accountId);
          if (c.frozen) throw L.err(L.ERR.INVALID_STATE, '合伙档案已冻结，不可升档');
          const RANK = { none: 0, vip: 1, angel: 2, private: 3, cofounder: 4 };
          if (RANK[targetTier] < RANK[u.tier || 'none']) {
            throw L.err(L.ERR.INVALID_STATE, '等级只升不降，不能降档');
          }
          u.tier = targetTier;
          c.partnerLevel = ctx.body.targetLevel;
          L.bumpVersion(c);
          const receiptId = L.nextId(ctx.db, 'hqr');
          L.audit(ctx.db, {
            module: MODULE, action: 'upgrade', targetId: c.contextId, operator: ctx.operator, reason,
            before, after: { partnerLevel: c.partnerLevel }, requestId: ctx.requestId, id: receiptId,
          });
          ctx.save();
          return { receiptId, operationId, partner: contextDto(ctx.db, c) };
        }

        // save-benefits
        L.requireFields(ctx.body, ['partnerLevel']);
        L.ensureEnum(ctx.body.partnerLevel, PARTNER_LEVELS, 'partnerLevel');
        let b = (ctx.db.hqPartnerBenefits || []).find((x) => x.partnerLevel === ctx.body.partnerLevel);
        if (!b) {
          b = { partnerLevel: ctx.body.partnerLevel, version: 1 };
          ctx.db.hqPartnerBenefits.push(b);
        }
        L.checkVersion(ctx, b, ctx.body.version, '等级权益');
        const before = { summary: b.summary || '' };
        if (ctx.body.summary !== undefined) b.summary = String(ctx.body.summary);
        if (ctx.body.content !== undefined) b.content = ctx.body.content;
        L.bumpVersion(b);
        L.audit(ctx.db, {
          module: MODULE, action: 'save-benefits', targetId: b.partnerLevel, operator: ctx.operator, reason,
          before, after: { summary: b.summary }, requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { receiptId: operationId, operationId, benefits: b };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, contextDto };

```
</details>

## 104. 关系分页
`GET http://localhost:3000/api/hq/invitations`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/invitations.js:97`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|keyword|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|binding|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|page|number|条件/未显式声明|读取及校验规则见下方实现|1|
|pageSize|number|条件/未显式声明|读取及校验规则见下方实现|1|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|id|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/invitations',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const binding = ctx.query.get('binding') || '';
      let list = Object.values(ctx.db.users || {});
      if (keyword) list = list.filter((u) => L.matchKeyword(keyword, u.id, u.name, u.phone, u.display_id));
      if (binding === 'BOUND') list = list.filter((u) => !!u.upline_id);
      if (binding === 'UNBOUND') list = list.filter((u) => !u.upline_id);
      list.sort((a, b) => String(a.id).localeCompare(String(b.id)));

      const gv = graphVersion(ctx.db);
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map((u) => {
        const codes = (ctx.db.inviteCodes || []).filter((c) => c.ownerId === u.id);
        return {
          account: accountBrief(ctx.db, u.id),
          superior: accountBrief(ctx.db, u.upline_id),
          inviteCode: codes.length ? codes[0].code : null,
          initialBinding: {
            source: codes.length ? 'REGISTRATION_INVITE' : 'NO_INVITE',
          },
          version: relationVersion(ctx.db, u.id),
          graphVersion: gv,
          directCount: directCount(ctx.db, u.id),
          teamCount: teamCount(ctx.db, u.id),
          allowedActions: ['rebind', 'unbind'],
        };
      });
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: list.length,
        bound: Object.values(ctx.db.users || {}).filter((u) => !!u.upline_id).length,
        unbound: Object.values(ctx.db.users || {}).filter((u) => !u.upline_id).length,
      });
    },
  },

  // ── 详情（祖先链 + 历史）──
  {
    module: MODULE,
```
</details>

## 105. 详情（祖先链 + 历史）
`GET http://localhost:3000/api/hq/invitations/:accountId`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/invitations.js:137`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|accountId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/invitations/:accountId',
    async handler(ctx) {
      const u = ctx.db.users[ctx.params.accountId];
      if (!u) throw L.err(L.ERR.NOT_FOUND, '账号不存在：' + ctx.params.accountId);
      const codes = (ctx.db.inviteCodes || []).filter((c) => c.ownerId === u.id);
      const history = (ctx.db.uplineHistory || [])
        .filter((h) => (h.partnerId || h.userId) === u.id)
        .map((h) => ({
          at: L.toIso(h.at || h.createdAt),
          from: h.fromUplineId || h.oldUplineId || null,
          to: h.toUplineId || h.newUplineId || null,
          reason: h.reason || null,
          operator: h.operator || null,
        }));
      return {
        account: accountBrief(ctx.db, u.id),
        superior: accountBrief(ctx.db, u.upline_id),
        inviteCode: codes.length ? codes[0].code : null,
        initialBinding: { source: codes.length ? 'REGISTRATION_INVITE' : 'NO_INVITE' },
        ancestors: ancestorChain(ctx.db, u.id),
        version: relationVersion(ctx.db, u.id),
        graphVersion: graphVersion(ctx.db),
        directCount: directCount(ctx.db, u.id),
        teamCount: teamCount(ctx.db, u.id),
        history,
        allowedActions: ['rebind', 'unbind'],
      };
    },
  },

  // ── 团队列表 ──
  {
    module: MODULE,
```
</details>

## 106. 团队列表
`GET http://localhost:3000/api/hq/invitations/:accountId/team`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/invitations.js:171`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|scope|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|keyword|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|page|number|条件/未显式声明|读取及校验规则见下方实现|1|
|pageSize|number|条件/未显式声明|读取及校验规则见下方实现|1|

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|accountId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|id|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/invitations/:accountId/team',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const rootId = ctx.params.accountId;
      if (!ctx.db.users[rootId]) throw L.err(L.ERR.NOT_FOUND, '账号不存在：' + rootId);
      const scope = ctx.query.get('scope') || 'DIRECT';
      L.ensureEnum(scope, ['DIRECT', 'ALL'], 'scope');
      const keyword = ctx.query.get('keyword') || '';

      let list;
      if (scope === 'DIRECT') {
        list = Object.values(ctx.db.users || {}).filter((u) => u.upline_id === rootId);
      } else {
        const ids = [];
        const walk = (id) => {
          for (const u of Object.values(ctx.db.users || {})) {
            if (u.upline_id === id) { ids.push(u.id); walk(u.id); }
          }
        };
        walk(rootId);
        list = ids.map((id) => ctx.db.users[id]).filter(Boolean);
      }
      if (keyword) list = list.filter((u) => L.matchKeyword(keyword, u.id, u.name, u.phone, u.display_id));
      list.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map((u) => ({
        account: accountBrief(ctx.db, u.id),
        superior: accountBrief(ctx.db, u.upline_id),
        directCount: directCount(ctx.db, u.id),
        teamCount: teamCount(ctx.db, u.id),
        level: 1,
      }));
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        scope,
        total: list.length,
      });
    },
  },

  // ── rebind / unbind ──
  {
    module: MODULE,
```
</details>

## 107. 邀请操作接口
`POST http://localhost:3000/api/hq/invitations/mutate`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/invitations.js:213`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|accountId|JSON|是|读取及校验规则见下方实现|有效资源ID|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|graphVersion|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|targetAccountId|JSON|是|读取及校验规则见下方实现|有效资源ID|
|action|JSON|是|读取及校验规则见下方实现|示例值|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "accountId": "有效资源ID",
  "version": 1,
  "graphVersion": "示例值",
  "targetAccountId": "有效资源ID",
  "action": "示例值",
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/invitations/mutate',
    async handler(ctx) {
      const { action } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['rebind', 'unbind'], 'action');
      L.requireFields(ctx.body, ['accountId']);

      return L.withIdempotency(ctx, () => {
        const accountId = String(ctx.body.accountId);
        const u = ctx.db.users[accountId];
        if (!u) throw L.err(L.ERR.NOT_FOUND, '账号不存在：' + accountId);
        const operationId = L.nextId(ctx.db, 'hqop');

        // 双版本校验：关系版本 + 图谱版本
        const curRelVer = relationVersion(ctx.db, accountId);
        const curGraphVer = graphVersion(ctx.db);
        if (ctx.body.version !== undefined && ctx.body.version !== null && ctx.body.version !== '') {
          if (Number(ctx.body.version) !== curRelVer) {
            throw L.err(L.ERR.VERSION_CONFLICT, `关系版本已变化（当前 version=${curRelVer}）`, { currentVersion: curRelVer });
          }
        }
        if (ctx.body.graphVersion !== undefined && ctx.body.graphVersion !== null && ctx.body.graphVersion !== '') {
          if (Number(ctx.body.graphVersion) !== curGraphVer) {
            throw L.err(L.ERR.VERSION_CONFLICT, `关系图谱已变化（当前 graphVersion=${curGraphVer}）`, { currentGraphVersion: curGraphVer });
          }
        }

        const before = { superiorAccountId: u.upline_id || null };

        if (action === 'rebind') {
          L.requireFields(ctx.body, ['targetAccountId']);
          const targetId = String(ctx.body.targetAccountId);
          if (!ctx.db.users[targetId]) throw L.err(L.ERR.NOT_FOUND, '目标上级账号不存在：' + targetId);
          if (wouldCycle(ctx.db, accountId, targetId)) {
            throw L.err(L.ERR.INVALID_INPUT, '不允许把自己或自己的下级设为上级（会形成环）');
          }
          u.upline_id = targetId;
          ctx.db.uplineHistory = ctx.db.uplineHistory || [];
          ctx.db.uplineHistory.push({
            id: L.nextId(ctx.db, 'uh'),
            partnerId: accountId,
            fromUplineId: before.superiorAccountId,
            toUplineId: targetId,
            reason,
            operator: ctx.operator ? ctx.operator.adminId : 'admin',
            at: L.nowMs(),
          });
        } else {
          if (!u.upline_id) throw L.err(L.ERR.INVALID_STATE, '该账号当前没有上级，无需解绑');
          const old = u.upline_id;
          u.upline_id = null;
          ctx.db.uplineHistory = ctx.db.uplineHistory || [];
          ctx.db.uplineHistory.push({
            id: L.nextId(ctx.db, 'uh'),
            partnerId: accountId,
            fromUplineId: old,
            toUplineId: null,
            reason,
            operator: ctx.operator ? ctx.operator.adminId : 'admin',
            at: L.nowMs(),
          });
        }
        L.audit(ctx.db, {
          module: MODULE, action, targetId: accountId, operator: ctx.operator, reason,
          before, after: { superiorAccountId: u.upline_id || null },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return {
          account: accountBrief(ctx.db, accountId),
          superior: accountBrief(ctx.db, u.upline_id),
          version: relationVersion(ctx.db, accountId),
          graphVersion: graphVersion(ctx.db),
          operationId,
        };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, relationVersion, graphVersion };

```
</details>

## 108. 申请分页
`GET http://localhost:3000/api/hq/costore/applications`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/costore.js:79`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|keyword|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|applicationStatus|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|page|number|条件/未显式声明|读取及校验规则见下方实现|1|
|pageSize|number|条件/未显式声明|读取及校验规则见下方实现|1|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|id|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/costore/applications',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const applicationStatus = ctx.query.get('applicationStatus') || '';
      let list = (ctx.db.hqCostoreApplications || []).slice();
      if (keyword) list = list.filter((a) => L.matchKeyword(keyword, a.id, a.accountId, a.applicantName, a.storeName));
      if (applicationStatus) list = list.filter((a) => (a.applicationStatus || 'PENDING_PAYMENT') === applicationStatus);
      list.sort((a, b) => String(b.id).localeCompare(String(a.id)));
      const all = ctx.db.hqCostoreApplications || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(applicationDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        pendingReview: all.filter((a) => a.applicationStatus === 'PENDING_REVIEW').length,
      });
    },
  },

  // ── 方案 plans、门店、是否允许退款重试 ──
  {
    module: MODULE,
```
</details>

## 109. 方案 plans、门店、是否允许退款重试
`GET http://localhost:3000/api/hq/costore/catalog`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/costore.js:101`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/costore/catalog',
    async handler(ctx) {
      const stores = [];
      const seen = new Set();
      for (const cs of ctx.db.coStores || []) {
        if (cs.store_id && !seen.has(cs.store_id)) {
          seen.add(cs.store_id);
          stores.push({ storeId: cs.store_id, name: cs.store_name || cs.store_id });
        }
      }
      for (const s of ctx.db.hqStores || []) {
        if (!seen.has(s.storeId)) {
          seen.add(s.storeId);
          stores.push({ storeId: s.storeId, name: s.name });
        }
      }
      const failedRefunds = (ctx.db.hqCostoreApplications || []).filter((a) => a.refundStatus === 'FAILED').length;
      return {
        plans: (ctx.db.hqCostorePlans || []).map(planDto),
        stores,
        allowRefundRetry: failedRefunds > 0,
        applicationStatuses: APP_STATUS.map((s) => ({ value: s, label: s })),
        paymentStatuses: PAY_STATUS.map((s) => ({ value: s, label: s })),
        refundStatuses: REFUND_STATUS.map((s) => ({ value: s, label: s })),
        contractStatuses: CONTRACT_STATUS.map((s) => ({ value: s, label: s })),
        entitlementStatuses: ENTITLEMENT_STATUS.map((s) => ({ value: s, label: s })),
        summary: { total: (ctx.db.hqCostoreApplications || []).length, failedRefunds },
      };
    },
  },

  // ── 详情 + 退款 + 审计 ──
  {
    module: MODULE,
```
</details>

## 110. 详情 + 退款 + 审计
`GET http://localhost:3000/api/hq/costore/applications/:applicationId`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/costore.js:136`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|applicationId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/costore/applications/:applicationId',
    async handler(ctx) {
      const a = (ctx.db.hqCostoreApplications || []).find((x) => x.id === ctx.params.applicationId);
      if (!a) throw L.err(L.ERR.NOT_FOUND, '共创申请不存在：' + ctx.params.applicationId);
      const audit = (ctx.db.hqAuditLogs || []).filter((x) => x.module === MODULE && x.targetId === a.id).slice(0, 20);
      return { application: applicationDto(a), refund: a.refund || null, audit };
    },
  },

  // ── save-plan / retry-refund ──
  {
    module: MODULE,
```
</details>

## 111. 合店操作接口
`POST http://localhost:3000/api/hq/costore/mutate`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/costore.js:149`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|planId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|title|JSON|是|读取及校验规则见下方实现|示例值|
|durationId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|months|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|referenceMonthlyFee|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|benefits|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|agreement|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|agreementVersion|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|applicationId|JSON|是|读取及校验规则见下方实现|有效资源ID|
|action|JSON|是|读取及校验规则见下方实现|示例值|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "planId": "有效资源ID",
  "version": 1,
  "title": "示例值",
  "durationId": "有效资源ID",
  "months": "示例值",
  "referenceMonthlyFee": "示例值",
  "benefits": "示例值",
  "agreement": "示例值",
  "agreementVersion": "示例值",
  "applicationId": "有效资源ID",
  "action": "示例值",
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/costore/mutate',
    async handler(ctx) {
      const { action } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['save-plan', 'retry-refund'], 'action');
      L.ensureCollections(ctx.db);

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'save-plan') {
          L.requireFields(ctx.body, ['title']);
          let p = null;
          if (ctx.body.planId) {
            p = ctx.db.hqCostorePlans.find((x) => x.id === ctx.body.planId);
            if (!p) throw L.err(L.ERR.NOT_FOUND, '方案不存在：' + ctx.body.planId);
            L.checkVersion(ctx, p, ctx.body.version, '共创方案');
          } else {
            p = { id: L.nextId(ctx.db, 'hqcp'), version: 1 };
            ctx.db.hqCostorePlans.push(p);
          }
          const before = { title: p.title, months: p.months };
          p.title = String(ctx.body.title);
          p.durationId = ctx.body.durationId || p.durationId || null;
          p.months = Number(ctx.body.months || p.months || 0);
          if (ctx.body.referenceMonthlyFee !== undefined) {
            p.priceBoundary = { referenceMonthlyFee: assertMoney(ctx.body.referenceMonthlyFee, '参考月费') };
          }
          if (ctx.body.benefits !== undefined) p.benefits = ctx.body.benefits;
          if (ctx.body.agreement !== undefined) p.agreement = ctx.body.agreement;
          if (ctx.body.agreementVersion !== undefined) p.agreementVersion = Number(ctx.body.agreementVersion);
          L.bumpVersion(p);
          L.audit(ctx.db, {
            module: MODULE, action: 'save-plan', targetId: p.id, operator: ctx.operator, reason,
            before, after: { title: p.title, months: p.months }, requestId: ctx.requestId, id: operationId,
          });
          ctx.save();
          return { plan: planDto(p), operationId };
        }

        // retry-refund
        L.requireFields(ctx.body, ['applicationId']);
        const a = ctx.db.hqCostoreApplications.find((x) => x.id === ctx.body.applicationId);
        if (!a) throw L.err(L.ERR.NOT_FOUND, '共创申请不存在：' + ctx.body.applicationId);
        if (a.refundStatus !== 'FAILED') throw L.err(L.ERR.INVALID_STATE, '仅退款失败的申请可重试');
        const before = { refundStatus: a.refundStatus };
        a.refundStatus = 'PENDING';
        a.refund = Object.assign({}, a.refund || {}, {
          status: 'PENDING', amount: L.money((a.refund && a.refund.amount) || a.payableAmount || 0),
          retryReason: reason, retriedAt: L.nowIso(),
        });
        L.bumpVersion(a);
        L.audit(ctx.db, {
          module: MODULE, action: 'retry-refund', targetId: a.id, operator: ctx.operator, reason,
          before, after: { refundStatus: a.refundStatus }, requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { application: applicationDto(a), operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, planDto, applicationDto };

```
</details>

## 112. 客服查询接口
`GET http://localhost:3000/api/hq/support/profile`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/support.js:54`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/support/profile',
    async handler(ctx) {
      const adminId=ctx.sess && ctx.sess.adminId || 'admin';
      const admin=(ctx.db.hqAdmins || []).find(a=>a.adminId===adminId);
      if(!admin)return null;
      const email=String(admin.email || '');
      return {adminId:admin.adminId,displayName:label(admin.displayName),phone:admin.phone ? (/^\d{11}$/.test(String(admin.phone)) ? L.maskPhone(admin.phone) : '***') : '',
        email:email ? (/^[^@]+@[^@]+$/.test(email) ? email[0]+'***@'+email.split('@')[1] : '***') : '',
        createdAt:L.toIso(admin.createdAt),updatedAt:L.toIso(admin.updatedAt),isActive:(admin.status || 'ACTIVE')==='ACTIVE'};
    },
  },
  // ── 工单分页 ──
  {
    module: MODULE,
```
</details>

## 113. 工单分页
`GET http://localhost:3000/api/hq/support/tickets`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/support.js:69`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|keyword|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|status|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|category|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|page|number|条件/未显式声明|读取及校验规则见下方实现|1|
|pageSize|number|条件/未显式声明|读取及校验规则见下方实现|1|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/support/tickets',
    async handler(ctx) {
      const paging = ctx.apiPilot ? {page:ctx.apiPilot.pageNum,pageSize:ctx.apiPilot.pageSize,offset:(ctx.apiPilot.pageNum-1)*ctx.apiPilot.pageSize} : L.readPaging(ctx.query);
      const keyword = ctx.query.get('keyword') || '';
      const status = ctx.query.get('status') || '';
      const category = ctx.query.get('category') || '';
      let list = (ctx.db.hqSupportTickets || []).slice();
      if (keyword) list = list.filter((t) => L.matchKeyword(keyword, t.id, t.subject, t.accountId));
      if (status) list = list.filter((t) => (t.status || 'OPEN') === status);
      if (category) list = list.filter((t) => (t.category || 'general') === category);
      const sortKey=ctx.apiPilot && ctx.apiPilot.sortBy;
      const direction=ctx.apiPilot ? (ctx.apiPilot.sortOrder==='desc'?-1:1) : -1;
      const sortValue=t=>sortKey==='createdAt'?(L.toIso(t.createdAt)||''):sortKey==='status'?(t.status||'OPEN'):String(t.id);
      list.sort((a,b)=>direction*sortValue(a).localeCompare(sortValue(b)));
      const all = ctx.db.hqSupportTickets || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(ticketDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
        open: all.filter((t) => (t.status || 'OPEN') === 'OPEN').length,
        resolved: all.filter((t) => t.status === 'RESOLVED').length,
      });
    },
  },

  // ── 状态/分类目录 ──
  {
    module: MODULE,
```
</details>

## 114. 状态/分类目录
`GET http://localhost:3000/api/hq/support/catalog`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/support.js:97`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/support/catalog',
    async handler(ctx) {
      return {
        statuses: TICKET_STATUS.map((s) => ({ value: s, label: s })),
        categories: [
          { value: 'general', label: '一般咨询' },
          { value: 'payment', label: '支付问题' },
          { value: 'order', label: '订单问题' },
          { value: 'complaint', label: '投诉' },
          { value: 'technical', label: '技术问题' },
        ],
        actions: [
          { value: 'reply', label: '回复' },
          { value: 'change-status', label: '改状态' },
          { value: 'assign', label: '转派' },
          { value: 'close', label: '关闭' },
        ],
        summary: { total: (ctx.db.hqSupportTickets || []).length },
      };
    },
  },

  // ── 详情 + 消息流 ──
  {
    module: MODULE,
```
</details>

## 115. 详情 + 消息流
`GET http://localhost:3000/api/hq/support/tickets/:ticketId`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/support.js:123`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|ticketId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/support/tickets/:ticketId',
    async handler(ctx) {
      const t = (ctx.db.hqSupportTickets || []).find((x) => x.id === ctx.params.ticketId);
      if (!t) throw L.err(L.ERR.NOT_FOUND, '工单不存在：' + ctx.params.ticketId);
      const messages = (ctx.db.hqSupportMessages || []).filter((m) => m.ticketId === t.id);
      return { ticket: ticketDto(t), messages: messages.map(messageDto) };
    },
  },

  // ── 回复 / 改状态 / 转派 / 关闭 ──
  {
    module: MODULE,
```
</details>

## 116. 回复 / 改状态 / 转派 / 关闭
`POST http://localhost:3000/api/hq/support/tickets/:ticketId/mutate`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/support.js:136`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|ticketId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|content|JSON|是|读取及校验规则见下方实现|示例值|
|status|JSON|是|读取及校验规则见下方实现|示例值|
|assigneeId|JSON|是|读取及校验规则见下方实现|有效资源ID|
|action|JSON|是|读取及校验规则见下方实现|示例值|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "content": "示例值",
  "status": "示例值",
  "assigneeId": "有效资源ID",
  "action": "示例值",
  "version": 1,
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/support/tickets/:ticketId/mutate',
    async handler(ctx) {
      const { action, version } = ctx.body || {};
      L.requireFields(ctx.body, ['action']);
      const reason = L.requireReason(ctx.body, ctx.headerReason);
      L.ensureEnum(action, ['reply', 'change-status', 'assign', 'close'], 'action');
      const t = (ctx.db.hqSupportTickets || []).find((x) => x.id === ctx.params.ticketId);
      if (!t) throw L.err(L.ERR.NOT_FOUND, '工单不存在：' + ctx.params.ticketId);
      L.checkVersion(ctx, t, version, '工单');
      const before = { status: t.status, assigneeId: t.assigneeId || null };

      return L.withIdempotency(ctx, () => {
        const operationId = L.nextId(ctx.db, 'hqop');

        if (action === 'reply') {
          L.requireFields(ctx.body, ['content']);
          const msg = {
            id: L.nextId(ctx.db, 'hqsm'),
            ticketId: t.id,
            senderRole: 'admin',
            senderId: ctx.operator ? ctx.operator.adminId : 'admin',
            content: String(ctx.body.content),
            createdAt: L.nowIso(),
          };
          ctx.db.hqSupportMessages.push(msg);
          t.status = t.status === 'OPEN' ? 'PENDING' : t.status;
          t.updatedAt = L.nowIso();
          L.bumpVersion(t);
          L.audit(ctx.db, {
            module: MODULE, action, targetId: t.id, operator: ctx.operator, reason,
            before, after: { status: t.status }, requestId: ctx.requestId, id: operationId,
          });
          ctx.save();
          return { ticket: ticketDto(t), message: messageDto(msg), operationId };
        }

        if (action === 'change-status') {
          L.requireFields(ctx.body, ['status']);
          L.ensureEnum(ctx.body.status, TICKET_STATUS, 'status');
          if (t.status === ctx.body.status) throw L.err(L.ERR.INVALID_STATE, '工单已处于该状态');
          t.status = ctx.body.status;
          t.updatedAt = L.nowIso();
        } else if (action === 'assign') {
          L.requireFields(ctx.body, ['assigneeId']);
          t.assigneeId = String(ctx.body.assigneeId);
          t.updatedAt = L.nowIso();
        } else if (action === 'close') {
          if (t.status === 'CLOSED') throw L.err(L.ERR.INVALID_STATE, '工单已关闭');
          t.status = 'CLOSED';
          t.closedAt = L.nowIso();
          t.closeReason = reason;
          t.updatedAt = L.nowIso();
        }
        L.bumpVersion(t);
        L.audit(ctx.db, {
          module: MODULE, action, targetId: t.id, operator: ctx.operator, reason,
          before, after: { status: t.status, assigneeId: t.assigneeId || null },
          requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { ticket: ticketDto(t), operationId };
      });
    },
  },

  // ── 创建工单（附加能力）──
  {
    module: MODULE,
```
</details>

## 117. 创建工单（附加能力）
`POST http://localhost:3000/api/hq/support/tickets`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/support.js:205`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|accountId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|category|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|subject|JSON|是|读取及校验规则见下方实现|示例值|
|content|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "accountId": "有效资源ID",
  "category": "示例值",
  "subject": "示例值",
  "content": "示例值",
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'POST',
    path: '/support/tickets',
    async handler(ctx) {
      const b = ctx.body || {};
      L.requireFields(b, ['subject']);
      const reason = L.requireReason(b, ctx.headerReason);
      L.ensureCollections(ctx.db);

      return L.withIdempotency(ctx, () => {
        const rec = {
          id: L.nextId(ctx.db, 'hqtk'),
          accountId: b.accountId || null,
          category: b.category || 'general',
          status: 'OPEN',
          subject: String(b.subject),
          assigneeId: null,
          version: 1,
          createdAt: L.nowIso(),
          updatedAt: L.nowIso(),
        };
        ctx.db.hqSupportTickets.push(rec);
        if (b.content) {
          ctx.db.hqSupportMessages.push({
            id: L.nextId(ctx.db, 'hqsm'),
            ticketId: rec.id,
            senderRole: 'user',
            senderId: rec.accountId,
            content: String(b.content),
            createdAt: L.nowIso(),
          });
        }
        const operationId = L.nextId(ctx.db, 'hqop');
        L.audit(ctx.db, {
          module: MODULE, action: 'create', targetId: rec.id, operator: ctx.operator, reason,
          before: null, after: rec, requestId: ctx.requestId, id: operationId,
        });
        ctx.save();
        return { ticket: ticketDto(rec), operationId };
      });
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, ticketDto };

```
</details>

## 118. 按条件搜索追踪事件
`GET http://localhost:3000/api/hq/trace`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/trace.js:36`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|module|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|action|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|targetId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|requestId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|operatorId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|from|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|to|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|page|number|条件/未显式声明|读取及校验规则见下方实现|1|
|pageSize|number|条件/未显式声明|读取及校验规则见下方实现|1|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/trace',
    async handler(ctx) {
      const paging = L.readPaging(ctx.query);
      const module = ctx.query.get('module') || '';
      const action = ctx.query.get('action') || '';
      const targetId = ctx.query.get('targetId') || '';
      const requestId = ctx.query.get('requestId') || '';
      const operatorId = ctx.query.get('operatorId') || '';
      const from = ctx.query.get('from') || '';
      const to = ctx.query.get('to') || '';

      let list = (ctx.db.hqAuditLogs || []).slice();
      if (module) list = list.filter((t) => t.module === module);
      if (action) list = list.filter((t) => t.action === action);
      if (targetId) list = list.filter((t) => t.targetId === targetId);
      if (requestId) list = list.filter((t) => t.requestId === requestId);
      if (operatorId) list = list.filter((t) => t.operatorId === operatorId);
      if (from) list = list.filter((t) => new Date(t.occurredAt).getTime() >= new Date(from).getTime());
      if (to) list = list.filter((t) => new Date(t.occurredAt).getTime() <= new Date(to).getTime());

      const all = ctx.db.hqAuditLogs || [];
      const items = list.slice(paging.offset, paging.offset + paging.pageSize).map(traceDto);
      return L.listData(items, list.length, paging.page, paging.pageSize, {
        total: all.length,
      });
    },
  },

  // ── 模块/动作目录 ──
  {
    module: MODULE,
```
</details>

## 119. 模块/动作目录
`GET http://localhost:3000/api/hq/trace/catalog`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/trace.js:68`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/trace/catalog',
    async handler(ctx) {
      const byModule = {};
      const byAction = {};
      for (const t of ctx.db.hqAuditLogs || []) {
        byModule[t.module] = (byModule[t.module] || 0) + 1;
        byAction[`${t.module}.${t.action}`] = (byAction[`${t.module}.${t.action}`] || 0) + 1;
      }
      return {
        modules: Object.keys(byModule).sort().map((m) => ({ value: m, count: byModule[m] })),
        actions: Object.keys(byAction).sort().map((a) => {
          const [mod, act] = a.split('.');
          return { value: a, module: mod, action: act, count: byAction[a] };
        }),
        summary: { total: (ctx.db.hqAuditLogs || []).length },
      };
    },
  },

  // ── 单条详情 ──
  {
    module: MODULE,
```
</details>

## 120. 单条详情
`GET http://localhost:3000/api/hq/trace/:traceId`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/trace.js:91`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|traceId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/trace/:traceId',
    async handler(ctx) {
      const t = (ctx.db.hqAuditLogs || []).find((x) => x.id === ctx.params.traceId);
      if (!t) throw L.err(L.ERR.NOT_FOUND, '追踪记录不存在：' + ctx.params.traceId);
      return { trace: traceDto(t) };
    },
  },

  // ── 按 requestId 聚合 ──
  {
    module: MODULE,
```
</details>

## 121. 按 requestId 聚合
`GET http://localhost:3000/api/hq/trace/by-request/:requestId`

Security：Bearer 会话；role=admin。
源码：`src/routes/hq/modules/trace.js:103`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|requestId|JSON|是|读取及校验规则见下方实现|有效资源ID|

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    method: 'GET',
    path: '/trace/by-request/:requestId',
    async handler(ctx) {
      const rid = ctx.params.requestId;
      const list = (ctx.db.hqAuditLogs || []).filter((t) => t.requestId === rid);
      return {
        requestId: rid,
        events: list.map(traceDto),
        total: list.length,
      };
    },
  },
];

module.exports = { name: MODULE, code: CODE, title: TITLE, routes, traceDto };

```
</details>

## 122. 登录（无需鉴权）
`POST http://localhost:3000/api/auth/login`

Security：公开，无需 token。
源码：`server.js:397`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|role|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|password|JSON|条件/未显式声明|读取及校验规则见下方实现|Example123|
|phone|JSON|条件/未显式声明|读取及校验规则见下方实现|13800138000|

### 请求 JSON 示例
```json
{
  "role": "示例值",
  "password": "Example123",
  "phone": "13800138000"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/api/auth/login' && m === 'POST') {
    const b = await readBody(req);
    if (b.role === 'admin') {
      if (b.password !== ADMIN_PASSWORD) return sendJSON(res, 401, { error: '管理员密码错误' });
      const token = 'admin-' + Math.random().toString(36).slice(2);
      sessions[token] = { role: 'admin' };
      return sendJSON(res, 200, { token, role: 'admin', name: '总部/后台' });
    }
    if (b.role === 'user') {
      const u = S.getUserByPhone(db, b.phone);
      if (!u) return sendJSON(res, 404, { error: '未找到该手机号对应的合伙人' });
      const token = 'user-' + Math.random().toString(36).slice(2);
      sessions[token] = { role: 'user', userId: u.id };
      return sendJSON(res, 200, { token, role: 'user', userId: u.id, tier: u.tier, name: u.name });
    }
    return sendJSON(res, 400, { error: 'role 必须是 admin 或 user' });
  }

  // 计算器（纯算法验证，无需鉴权）—— 直接跑 regionAgent 等纯函数
```
</details>

## 123. 计算器（纯算法验证，无需鉴权）—— 直接跑 regionAgent 等纯函数
`POST http://localhost:3000/api/calc/region-vip`

Security：公开，无需 token。
源码：`server.js:416`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|regionType|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|vipCount|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "regionType": "示例值",
  "vipCount": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/api/calc/region-vip' && m === 'POST') {
    const b = await readBody(req);
    return sendJSON(res, 200, RA.regionVipBonus(b.regionType, b.vipCount || 1));
  }
```
</details>

## 124. 业务操作接口
`POST http://localhost:3000/api/calc/goods-diff`

Security：公开，无需 token。
源码：`server.js:420`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|kind|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|sellerLevel|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|buyerLevel|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|qty|number|条件/未显式声明|读取及校验规则见下方实现|1|
|salePrice|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "kind": "示例值",
  "sellerLevel": "示例值",
  "buyerLevel": "示例值",
  "qty": 1,
  "salePrice": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/api/calc/goods-diff' && m === 'POST') {
    const b = await readBody(req);
    return sendJSON(res, 200, RA.goodsTierDiff(b.kind || 'physical', b.sellerLevel, b.buyerLevel, b.qty || 1, b.salePrice || 1000));
  }
```
</details>

## 125. 业务操作接口
`POST http://localhost:3000/api/calc/store-delivery`

Security：公开，无需 token。
源码：`server.js:424`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|discountAmount|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|ownerCount|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|opts|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "discountAmount": "示例值",
  "ownerCount": "示例值",
  "opts": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/api/calc/store-delivery' && m === 'POST') {
    const b = await readBody(req);
    return sendJSON(res, 200, RA.storeDeliveryAllocation(b.discountAmount, b.ownerCount || 1, b.opts || {}));
  }
```
</details>

## 126. 业务操作接口
`POST http://localhost:3000/api/calc/region`

Security：公开，无需 token。
源码：`server.js:428`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### 请求 JSON 示例
```json
{}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/api/calc/region' && m === 'POST') {
    const b = await readBody(req);
    return sendJSON(res, 200, RA.monthlyRegionAgent(b));
  }
  // 门店二维码内容生成（展示层，公开，无需登录）：顾客扫码 → 前端解析 store_code → 下单携带 storeCode
```
</details>

## 127. 门店二维码内容生成（展示层，公开，无需登录）：顾客扫码 → 前端解析 store_code → 下单携带 storeCode
`GET http://localhost:3000/api/agent/qrcode`

Security：公开，无需 token。
源码：`server.js:433`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|code|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/api/agent/qrcode' && m === 'GET') {
    const code = url.searchParams.get('code') || '';
    return sendJSON(res, 200, {
      store_code: code,
      qrContent: `https://<域名>/s?c=${code}`,
      scanFlow: '顾客扫码 → 前端解析 store_code → 带入下单参数 storeCode → 结算按父链 门店→区县→市→省 归集',
      note: '域名请替换为实际部署域名；二维码图片可据此文本用任意二维码库生成',
    });
  }
```
</details>

## 128. 业务操作接口
`POST http://localhost:3000/api/calc/virtual-split`

Security：公开，无需 token。
源码：`server.js:442`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|paidAmount|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|deliveryType|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "paidAmount": "示例值",
  "deliveryType": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/api/calc/virtual-split' && m === 'POST') {
    const b = await readBody(req);
    return sendJSON(res, 200, RA.virtualDeliverySplit(b.paidAmount || 0, b.deliveryType || 'store'));
  }
```
</details>

## 129. 业务操作接口
`POST http://localhost:3000/api/calc/physical-diff`

Security：公开，无需 token。
源码：`server.js:446`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|sellerLevel|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|buyerLevel|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|qty|number|条件/未显式声明|读取及校验规则见下方实现|1|
|basePrice|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "sellerLevel": "示例值",
  "buyerLevel": "示例值",
  "qty": 1,
  "basePrice": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/api/calc/physical-diff' && m === 'POST') {
    const b = await readBody(req);
    return sendJSON(res, 200, RA.physicalTierDiff(b.sellerLevel, b.buyerLevel, b.qty || 1, b.basePrice || 6980));
  }
```
</details>

## 130. 业务查询接口
`GET http://localhost:3000/api/calc/agent-fee`

Security：公开，无需 token。
源码：`server.js:450`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|cityTier|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/api/calc/agent-fee' && m === 'GET') {
    const cityTier = Number(url.searchParams.get('cityTier') || 1);
    return sendJSON(res, 200, {
      share: RA.AGENT_SHARE,
      thresholdFee: {
        province: RA.agentThresholdFee('province'),
        city: RA.agentThresholdFee('city', cityTier),
        district: RA.agentThresholdFee('district'),
        store: RA.agentThresholdFee('store'),
      },
      tier: RA.AGENT_TIER,
      // 2026-10-23 新价格表（图1，按人数分档）+ 技术费口径
      priceTable: RA.AGENT_PRICE_TABLE,
      partnerDirectRatio: RA.PARTNER_DIRECT_RATIO,
    });
  }
  // ── 产品域计算（2026-10-23 新规格：productSplit.js） ──
```
</details>

## 131. 产品域计算（2026-10-23 新规格：productSplit.js）
`GET http://localhost:3000/api/products`

Security：公开，无需 token。
源码：`server.js:467`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|userId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/api/products' && m === 'GET') {
    // 商城系统预留：带 userId（或登录态）时返回该买家维度报价——
    // 代理折扣与合伙人折扣两套表分开，成交档位按 resolveBuyerLevel 单一入口解析
    const qUser = url.searchParams.get('userId') || (sess && sess.role === 'user' ? sess.userId : null);
    const resp = {
      catalog: PS.PRODUCT_CATALOG,
      kind: PS.PRODUCT_KIND,
      featuredSplitRows: PS.FEATURED_SPLIT_ROWS,
      partnerProductRate: PS.PARTNER_PRODUCT_RATE,
      productCommissionMode: PS.PRODUCT_COMMISSION_MODE,
      discounts: { partner: RA.PARTNER_DISCOUNT, agent: RA.AGENT_DISCOUNT },
    };
    if (qUser) {
      const buyer = db.users[qUser];
      const agentRec = db.regionalAgents.find((a) => a.partner_id === qUser) || null;
      if (buyer) {
        const bp = PS.buyerProductPrices(buyer, agentRec, 1);
        resp.buyer = {
          id: buyer.id, name: buyer.name, tier: buyer.tier,
          agent_region_type: agentRec ? agentRec.region_type : null,
          level: bp.level, discount_kind: bp.discountKind,
          partner_level: bp.partnerLevel, agent_level: bp.agentLevel,
        };
        resp.prices = bp.prices;
      }
    }
    return sendJSON(res, 200, resp);
  }
```
</details>

## 132. 业务操作接口
`POST http://localhost:3000/api/calc/product-price`

Security：公开，无需 token。
源码：`server.js:495`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|key|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|level|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|qty|number|条件/未显式声明|读取及校验规则见下方实现|1|

### 请求 JSON 示例
```json
{
  "key": "示例值",
  "level": "示例值",
  "qty": 1
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/api/calc/product-price' && m === 'POST') {
    const b = await readBody(req);
    return sendJSON(res, 200, PS.productPrice(b.key, b.level || 'list', b.qty || 1));
  }
```
</details>

## 133. 业务操作接口
`POST http://localhost:3000/api/calc/product-commission`

Security：公开，无需 token。
源码：`server.js:499`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|paid|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|uplineTier|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|mode|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "paid": "示例值",
  "uplineTier": "示例值",
  "mode": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/api/calc/product-commission' && m === 'POST') {
    const b = await readBody(req);
    return sendJSON(res, 200, PS.partnerProductCommission({ paid: b.paid || 0, uplineTier: b.uplineTier, mode: b.mode }));
  }
```
</details>

## 134. 业务操作接口
`POST http://localhost:3000/api/calc/featured-split`

Security：公开，无需 token。
源码：`server.js:503`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|paid|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|fixedCost|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|deliveryType|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|inspectionAssignee|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "paid": "示例值",
  "fixedCost": "示例值",
  "deliveryType": "示例值",
  "inspectionAssignee": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/api/calc/featured-split' && m === 'POST') {
    const b = await readBody(req);
    return sendJSON(res, 200, PS.featuredSplit(b.paid || 0, {
      fixedCost: b.fixedCost || 0, deliveryType: b.deliveryType || 'store', inspectionAssignee: b.inspectionAssignee || null,
    }));
  }

  // 以下接口需要登录
  if (!sess) return sendJSON(res, 401, { error: '未登录或 token 失效' });

  // ───── 管理员（总部/后台） ─────
  if (sess.role === 'admin') {
```
</details>

## 135. 管理员（总部/后台）
`GET http://localhost:3000/api/seed`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:515`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/seed' && m === 'GET') {
      // 导出当前数据（便于编辑后再 POST 回来）
      return sendJSON(res, 200, {
        users: Object.values(db.users).map((u) => ({ id: u.id, name: u.name, phone: u.phone, tier: u.tier, is_founding: u.is_founding === 'founding', upline_id: u.upline_id, quota: Q.getStandard(db.quotaLedger, u.id), quotaStandard: Q.getStandard(db.quotaLedger, u.id), quotaActivity: Q.getActivity(db.quotaLedger, u.id) })),
        orders: db.orders.filter((o) => o.packageTier).map((o) => ({ buyer_id: o.buyer_id, packageTier: o.packageTier, oldTier: o.oldTier, quotaCount: o.quotaCount, regionCode: o.regionCode, buyerIsNew: false })),
        agents: db.regionalAgents.map((a) => ({ partner_id: a.partner_id, region_type: a.region_type, region_code: a.region_code })),
        costores: db.coStores,
      });
    }
```
</details>

## 136. 业务操作接口
`POST http://localhost:3000/api/seed`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:524`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### 请求 JSON 示例
```json
{}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/seed' && m === 'POST') {
      const b = await readBody(req);
      loadSeed(b); saveDb();
      return sendJSON(res, 200, { ok: true, message: '种子数据已载入并重置', users: Object.keys(db.users).length });
    }
```
</details>

## 137. 业务操作接口
`POST http://localhost:3000/api/seed/reset`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:529`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### 请求 JSON 示例
```json
{}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/seed/reset' && m === 'POST') {
      loadSeed(DEFAULT_SEED); saveDb();
      return sendJSON(res, 200, { ok: true, message: '已恢复默认示例种子' });
    }
```
</details>

## 138. 合伙人操作接口
`POST http://localhost:3000/api/partner`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:533`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|id|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|name|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|phone|JSON|条件/未显式声明|读取及校验规则见下方实现|13800138000|
|tier|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|upline_id|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|is_founding|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|teamVip|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|quota|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "id": "示例值",
  "name": "示例值",
  "phone": "13800138000",
  "tier": "示例值",
  "upline_id": "示例值",
  "is_founding": "示例值",
  "teamVip": "示例值",
  "quota": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/partner' && m === 'POST') {
      const b = await readBody(req);
      const u = S.addUser(db, { id: b.id || undefined, name: b.name, phone: b.phone, tier: b.tier, upline_id: b.upline_id || null, is_founding: b.is_founding ? 'founding' : 'none', teamVip: b.teamVip || 0 });
      const e = Q.normalize(db.quotaLedger, u.id);
      e.standard = Number(b.quota) || 0;
      saveDb();
      return sendJSON(res, 200, { ok: true, user: u, quota: e.standard, quotaStandard: e.standard, quotaActivity: Q.getActivity(db.quotaLedger, u.id) });
    }
```
</details>

## 139. 业务操作接口
`POST http://localhost:3000/api/order`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:541`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### 请求 JSON 示例
```json
{}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/order' && m === 'POST') {
      const b = await readBody(req);
      const r = R.createOrder(db, b); saveDb();
      return sendJSON(res, 200, { ok: true, ...r });
    }
```
</details>

## 140. 业务操作接口
`POST http://localhost:3000/api/order/product`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:546`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|userId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|buyerId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### 请求 JSON 示例
```json
{
  "buyerId": "有效资源ID"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/order/product' && m === 'POST') {
      // 产品购买（后台代下单，2026-10-23 新规格）：与用户端同逻辑；
      // buyerId 取请求体或 ?userId= 覆盖；行政费金额走 body.amount
      const b = await readBody(req);
      const buyerId = b.buyerId || url.searchParams.get('userId');
      if (!buyerId) return sendJSON(res, 400, { error: '缺少买家 userId' });
      try {
        const r = R.createProductOrder(db, { ...b, buyerId });
        saveDb();
        return sendJSON(res, 200, { ok: true, ...r });
      } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    }
```
</details>

## 141. 业务操作接口
`POST http://localhost:3000/api/agent/appoint`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:558`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### 请求 JSON 示例
```json
{}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/agent/appoint' && m === 'POST') {
      const b = await readBody(req);
      try {
        const r = S.appointAgent(db, b); saveDb();
        return sendJSON(res, 200, { ok: true, ...r });
      } catch (e) {
        return sendJSON(res, 400, { ok: false, error: e.message });
      }
    }
    // 撤销代理（2026-10-24 拍板）：摘除代理身份；用户编号 seq 不变、前缀改 QZ（普通用户）；已赠档位保留
```
</details>

## 142. 撤销代理（2026-10-24 拍板）：摘除代理身份；用户编号 seq 不变、前缀改 QZ（普通用户）；已赠档位保留
`POST http://localhost:3000/api/agent/revoke`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:568`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### 请求 JSON 示例
```json
{}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/agent/revoke' && m === 'POST') {
      const b = await readBody(req);
      try {
        const r = S.revokeAgent(db, b); saveDb();
        return sendJSON(res, 200, { ok: true, ...r });
      } catch (e) {
        return sendJSON(res, 400, { ok: false, error: e.message });
      }
    }
    // 编辑代理（区域码层级化：可改 parent_code 父链 / region_code 层级码）
```
</details>

## 143. 编辑代理（区域码层级化：可改 parent_code 父链 / region_code 层级码）
`POST http://localhost:3000/api/agent/update`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:578`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|partnerId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|patch|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "partnerId": "有效资源ID",
  "patch": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/agent/update' && m === 'POST') {
      const b = await readBody(req);
      try {
        const r = S.updateAgent(db, b.partnerId, b.patch || b); saveDb();
        return sendJSON(res, 200, { ok: true, agent: r });
      } catch (e) {
        return sendJSON(res, 400, { ok: false, error: e.message });
      }
    }
```
</details>

## 144. 合店操作接口
`POST http://localhost:3000/api/costore`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:587`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### 请求 JSON 示例
```json
{}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/costore' && m === 'POST') {
      const b = await readBody(req);
      try {
        const r = S.addCoStore(db, b); saveDb();
        return sendJSON(res, 200, { ok: true, costore: r });
      } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    }
    // 后台可调配置（合店费月费 / 最少月数 / 无责分红月数 / 四场景开关等）
```
</details>

## 145. 后台可调配置（合店费月费 / 最少月数 / 无责分红月数 / 四场景开关等）
`GET http://localhost:3000/api/settings`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:595`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/settings' && m === 'GET') {
      return sendJSON(res, 200, { settings: S.getSettings(db) });
    }
```
</details>

## 146. 后台可调配置（合店费月费 / 最少月数 / 无责分红月数 / 四场景开关等）
`POST http://localhost:3000/api/settings`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:598`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|costore|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "costore": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/settings' && m === 'POST') {
      const b = await readBody(req);
      const s = S.updateSettings(db, b.costore || b);
      saveDb();
      return sendJSON(res, 200, { ok: true, settings: s });
    }

    // ── SKU 库存台账（2026-10-27）────────────────────────────────────────────
    // 库存与单规格单价在 db.skus；下单自动扣减，取消自动回补（见 src/stock.js）
```
</details>

## 147. 库存与单规格单价在 db.skus；下单自动扣减，取消自动回补（见 src/stock.js）
`GET http://localhost:3000/api/skus`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:607`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/skus' && m === 'GET') {
      const rows = (db.skus || []).map((s) => ({ ...s, ledger: STK.ledgerOf(db, s.id, 20) }));
      return sendJSON(res, 200, { items: rows, total: rows.length });
    }
```
</details>

## 148. 业务操作接口
`POST http://localhost:3000/{动态路径}`
原始匹配：`p.match(/^\/api\/skus\/[^/]+\/stock$/) && m === 'POST'`
Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:611`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|stock|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|delta|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "stock": "示例值",
  "delta": "示例值",
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p.match(/^\/api\/skus\/[^/]+\/stock$/) && m === 'POST') {
      const b = await readBody(req);
      const id = p.split('/')[3];
      const sku = STK.skuById(db, id);
      if (!sku) return sendJSON(res, 404, { error: '规格不存在: ' + id });
      try {
        // 两种用法：{ delta: -3 } 增减；{ stock: 20 } 直接设定
        const before = Number(sku.stock) || 0;
        if (b.stock != null) {
          const target = Math.max(0, Math.trunc(Number(b.stock) || 0));
          STK.adjustStock(db, id, target - before, { reason: 'ADMIN_SET_STOCK', operatorId: sess.role === 'admin' ? 'admin' : null });
        } else {
          STK.adjustStock(db, id, Math.trunc(Number(b.delta) || 0), { reason: b.reason || 'ADMIN_ADJUST_STOCK', operatorId: 'admin' });
        }
        saveDb();
        return sendJSON(res, 200, { ok: true, sku, ledger: STK.ledgerOf(db, id, 20) });
      } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    }
```
</details>

## 149. 业务操作接口
`PUT http://localhost:3000/{动态路径}`
原始匹配：`p.match(/^\/api\/skus\/[^/]+$/) && m === 'PUT'`
Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:629`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|label|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|listPrice|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "label": "示例值",
  "listPrice": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p.match(/^\/api\/skus\/[^/]+$/) && m === 'PUT') {
      const b = await readBody(req);
      const id = p.split('/')[3];
      const sku = STK.skuById(db, id);
      if (!sku) return sendJSON(res, 404, { error: '规格不存在: ' + id });
      if (b.label != null) sku.label = String(b.label);
      if (b.listPrice != null) sku.listPrice = Math.max(0, Number(b.listPrice) || 0);
      if (b.listPrice != null) MONEY_SHADOW.writeRecord('skus', sku);
      sku.updatedAt = Date.now();
      saveDb();
      return sendJSON(res, 200, { ok: true, sku });
    }

    // ── 专栏管理（2026-10-27）──────────────────────────────────────────────
    // 专栏定义存 db.columns；业务在后台改，不必改代码，也不必手改 db.json
    // （服务运行中手改 db.json 会被 saveDb 覆盖）
```
</details>

## 150. （服务运行中手改 db.json 会被 saveDb 覆盖）
`GET http://localhost:3000/api/columns`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:645`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/columns' && m === 'GET') {
      return sendJSON(res, 200, { items: db.columns || [] });
    }
```
</details>

## 151. （服务运行中手改 db.json 会被 saveDb 覆盖）
`PUT http://localhost:3000/api/columns`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:648`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|columns|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "columns": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/columns' && m === 'PUT') {
      const b = await readBody(req);
      if (!Array.isArray(b.columns)) return sendJSON(res, 400, { error: 'columns 必须是数组' });
      for (const c of b.columns) {
        if (!c || !c.id) return sendJSON(res, 400, { error: '每个专栏必须有 id' });
      }
      db.columns = JSON.parse(JSON.stringify(b.columns));
      MONEY_SHADOW.writeBatch('columns', db.columns);
      saveDb();
      return sendJSON(res, 200, { ok: true, items: db.columns });
    }

    // ── 商品活动价（2026-10-27）────────────────────────────────────────────
    // 后端商品模型原本没有活动价口径 → 未配置时 activityAmount 返回 null（前端显示 '—'）
```
</details>

## 152. 后端商品模型原本没有活动价口径 → 未配置时 activityAmount 返回 null（前端显示 '—'）
`GET http://localhost:3000/api/activity-prices`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:662`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/activity-prices' && m === 'GET') {
      return sendJSON(res, 200, { items: db.activityPrices || [] });
    }
```
</details>

## 153. 后端商品模型原本没有活动价口径 → 未配置时 activityAmount 返回 null（前端显示 '—'）
`POST http://localhost:3000/api/activity-prices`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:665`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|productId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|amount|number|条件/未显式声明|读取及校验规则见下方实现|1|
|note|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "productId": "有效资源ID",
  "amount": 1,
  "note": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/activity-prices' && m === 'POST') {
      const b = await readBody(req);
      if (!b.productId) return sendJSON(res, 400, { error: 'productId 必填' });
      if (!Array.isArray(db.activityPrices)) db.activityPrices = [];
      db.activityPrices = db.activityPrices.filter((r) => r.productId !== b.productId);
      if (b.amount != null) {
        const priceRecord = { productId: b.productId, amount: Math.max(0, Number(b.amount) || 0), note: b.note || null, updatedAt: Date.now() };
        MONEY_SHADOW.writeRecord('activityPrices', priceRecord);
        db.activityPrices.push(priceRecord);
      }
      saveDb();
      return sendJSON(res, 200, { ok: true, items: db.activityPrices });
    }
```
</details>

## 154. 业务操作接口
`POST http://localhost:3000/api/quota/issue`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:678`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### 请求 JSON 示例
```json
{}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/quota/issue' && m === 'POST') {
      const b = await readBody(req);
      const r = R.issueQuota(db, b); saveDb();
      return sendJSON(res, 200, { ok: true, ...r });
    }
```
</details>

## 155. 业务查询接口
`GET http://localhost:3000/api/quota/ledger`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:683`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/quota/ledger' && m === 'GET') {
      const rows = Object.keys(db.quotaLedger).map((id) => ({
        partnerId: id, name: db.users[id] ? db.users[id].name : null,
        standard: Q.getStandard(db.quotaLedger, id), activity: Q.getActivity(db.quotaLedger, id),
        activityBatches: Q.activityBatches(db.quotaLedger, id),
      }));
      return sendJSON(res, 200, { ledger: rows });
    }
```
</details>

## 156. 业务查询接口
`GET http://localhost:3000/api/quota/transactions`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:691`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|at|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/quota/transactions' && m === 'GET') {
      const rows = (db.quota_transactions || []).slice().sort((a, b) => b.at - a.at);
      return sendJSON(res, 200, { transactions: rows });
    }
```
</details>

## 157. 业务操作接口
`POST http://localhost:3000/api/relation/unbind`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:695`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### 请求 JSON 示例
```json
{}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/relation/unbind' && m === 'POST') {
      const b = await readBody(req);
      const r = R.unbind(db, b); saveDb();
      return sendJSON(res, 200, { ok: true, user: r });
    }
```
</details>

## 158. 业务操作接口
`POST http://localhost:3000/api/relation/rebind`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:700`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|newUplineId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### 请求 JSON 示例
```json
{
  "newUplineId": "有效资源ID"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/relation/rebind' && m === 'POST') {
      const b = await readBody(req);
      const r = R.rebind(db, b); saveDb();
      // 关系变更配套：返回本人与新上级的「拉人免费升档」进度，便于后台直观看到影响
      const freeUpgrade = {
        self: S.referralFreeUpgradeProgress(db, r.id),
        newUpline: b.newUplineId ? S.referralFreeUpgradeProgress(db, b.newUplineId) : null,
      };
      return sendJSON(res, 200, { ok: true, user: r, freeUpgrade });
    }
```
</details>

## 159. 业务操作接口
`POST http://localhost:3000/api/settle`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:710`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### 请求 JSON 示例
```json
{}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/settle' && m === 'POST') {
      const b = await readBody(req);
      const r = R.runSettlement(db, b); db.lastSettlement = r; saveDb();
      return sendJSON(res, 200, { ok: true, summary: r });
    }
```
</details>

## 160. 业务查询接口
`GET http://localhost:3000/api/report`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:715`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/report' && m === 'GET') {
      const users = Object.values(db.users).map((u) => {
        const sum = S.commissionSummary(db, u.id, {});
        return { id: u.id, name: u.name, tier: u.tier, phone: u.phone, total: sum.total, byType: sum.byType };
      });
      return sendJSON(res, 200, { users, lastSettlement: db.lastSettlement });
    }
```
</details>

## 161. 账号查询接口
`GET http://localhost:3000/api/users`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:722`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/users' && m === 'GET') {
      // P0-3：附带标准/活动双余额（供后台「进货明细 / 活动 VIP 明细」展示）
      const users = Object.values(db.users).map((u) => ({
        ...u,
        quota: Q.getStandard(db.quotaLedger, u.id),
        quotaStandard: Q.getStandard(db.quotaLedger, u.id),
        quotaActivity: Q.getActivity(db.quotaLedger, u.id),
      }));
      return sendJSON(res, 200, { users });
    }
    // ── 拉人免费升档「可视化详情」（团队树 / 关系变更配套） ──
    // 支持后台传 ?userId= 查看任意人；不传则回退当前登录用户（兼容普通用户上下文）。
```
</details>

## 162. 支持后台传 ?userId= 查看任意人；不传则回退当前登录用户（兼容普通用户上下文）。
`GET http://localhost:3000/api/free-upgrade`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:734`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|userId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/free-upgrade' && m === 'GET') {
      const TIER_LABEL = { none: '普通用户', vip: 'VIP合伙人', angel: '天使合伙人', private: '私董合伙人', cofounder: '联创合伙人' };
      const targetId = url.searchParams.get('userId') || currentUserId(req, url, sess);
      if (!targetId || !db.users[targetId]) return sendJSON(res, 400, { error: '缺少或无效的 userId' });
      const U = db.users[targetId];
      const prog = S.referralFreeUpgradeProgress(db, targetId);
      const qualifyingIds = S.qualifyingDownlineIds(db, targetId);
      const qualifying = qualifyingIds.map((id) => {
        const d = db.users[id];
        // 该下级「从被推荐档位起步」付费升到的目标档（取最高）
        const ups = db.orders.filter((o) => o.buyer_id === id && o.oldTier === d.referral_upline_tier);
        const toTier = ups.length ? ups.reduce((a, o) => ((S.TIER_RANK[o.packageTier] || 0) > (S.TIER_RANK[a] || 0) ? o.packageTier : a), 'none') : null;
        return {
          id, name: d.name, tier: d.tier,
          recommendedAtTier: d.referral_upline_tier,
          recommendedAtTierLabel: TIER_LABEL[d.referral_upline_tier] || d.referral_upline_tier,
          paidUpgradeFrom: d.referral_upline_tier,
          paidUpgradeTo: toTier,
        };
      });
      const freeUpgradeLog = (db.freeUpgradeLog || []).filter((x) => x.uplineId === targetId);
      return sendJSON(res, 200, {
        userId: targetId,
        tier: U.tier,
        principalTier: U.principal_tier || null,
        principalAmount: U.principal_tier ? C.retailPrice(U.principal_tier) : null,
        progress: prog,
        nextTierLabel: prog && prog.nextTier ? (TIER_LABEL[prog.nextTier] || prog.nextTier) : null,
        qualifying,
        freeUpgradeLog,
      });
    }
    // ── 编辑实体（后台「修改ID / 修改字段」） ──
```
</details>

## 163. 编辑实体（后台「修改ID / 修改字段」）
`POST http://localhost:3000/api/partner/update`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:767`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|partnerId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|patch|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "partnerId": "有效资源ID",
  "patch": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/partner/update' && m === 'POST') {
      const b = await readBody(req);
      const u = S.updatePartner(db, b.partnerId, b.patch || {});
      saveDb();
      return sendJSON(res, 200, { ok: true, user: u, quota: Q.getStandard(db.quotaLedger, u.id), quotaStandard: Q.getStandard(db.quotaLedger, u.id), quotaActivity: Q.getActivity(db.quotaLedger, u.id) });
    }
```
</details>

## 164. 合伙人操作接口
`POST http://localhost:3000/api/partner/delete`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:773`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|partnerId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### 请求 JSON 示例
```json
{
  "partnerId": "有效资源ID"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/partner/delete' && m === 'POST') {
      const b = await readBody(req);
      const r = S.deletePartner(db, b.partnerId);
      saveDb();
      return sendJSON(res, 200, { ok: true, ...r });
    }
```
</details>

## 165. 业务操作接口
`POST http://localhost:3000/api/order/update`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:779`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|orderId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|patch|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|partnerId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### 请求 JSON 示例
```json
{
  "orderId": "有效资源ID",
  "patch": "示例值",
  "partnerId": "有效资源ID"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/order/update' && m === 'POST') {
      const b = await readBody(req);
      const o = S.updateOrder(db, b.orderId, b.patch || {});
      saveDb();
      return sendJSON(res, 200, { ok: true, order: o });
    }
    if (p === '/api/agent/update' && m === 'POST') {
      const b = await readBody(req);
      try {
        const a = S.updateAgent(db, b.partnerId, b.patch || {});
        saveDb();
        return sendJSON(res, 200, { ok: true, agent: a });
      } catch (e) {
        return sendJSON(res, 400, { ok: false, error: e.message });
      }
    }
    // ── 逐笔收益明细（每一笔都列出来，供人工核对） ──
```
</details>

## 166. 逐笔收益明细（每一笔都列出来，供人工核对）
`GET http://localhost:3000/api/commissions/all`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:796`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|period|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|type|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|owner|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/commissions/all' && m === 'GET') {
      const period = url.searchParams.get('period') || '';
      const type = url.searchParams.get('type') || '';
      const owner = url.searchParams.get('owner') || '';
      let list = db.commissions;
      if (period) list = list.filter((c) => c.period === period);
      if (type) list = list.filter((c) => c.type === type);
      if (owner) list = list.filter((c) => c.owner_id === owner);
      const rows = list.map((c) => ({
        id: c.id, period: c.period, owner_id: c.owner_id,
        owner_name: c.owner_id === 'HQ' ? '总部' : (db.users[c.owner_id] ? db.users[c.owner_id].name : c.owner_id),
        type: c.type, type_cn: T_CN[c.type] || c.type,
        base_amount: c.base_amount, rate: c.rate, amount: c.amount,
        ref_order_id: c.ref_order_id || null, status: c.status,
        formula: c.formula || null, note: c.note || null,
      }));
      return sendJSON(res, 200, { rows, count: rows.length, total: round2(rows.reduce((s, r) => s + r.amount, 0)) });
    }
    // ── 代查任意用户的身份列表 / 分身份收益（身份切换体系，2026-10-23） ──
```
</details>

## 167. 代查任意用户的身份列表 / 分身份收益（身份切换体系，2026-10-23）
`GET http://localhost:3000/api/identities`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:815`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|userId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/identities' && m === 'GET') {
      const targetId = url.searchParams.get('userId');
      if (!targetId || !db.users[targetId]) return sendJSON(res, 400, { error: '缺少或无效的 userId' });
      try { return sendJSON(res, 200, R.getIdentities(db, targetId)); }
      catch (e) { return sendJSON(res, 400, { error: e.message }); }
    }
```
</details>

## 168. 业务查询接口
`GET http://localhost:3000/api/commissions`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:821`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|userId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|type|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|identity|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|period|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/commissions' && m === 'GET') {
      const targetId = url.searchParams.get('userId');
      if (!targetId || !db.users[targetId]) return sendJSON(res, 400, { error: '缺少或无效的 userId' });
      const type = url.searchParams.get('type') || undefined;
      const identity = url.searchParams.get('identity') || undefined;
      const period = url.searchParams.get('period') || undefined;
      try { return sendJSON(res, 200, R.getCommissions(db, targetId, { type, identity, period })); }
      catch (e) { return sendJSON(res, 400, { error: e.message }); }
    }
    // ── 订单列表（后台可编辑） ──
```
</details>

## 169. 订单列表（后台可编辑）
`GET http://localhost:3000/api/orders/all`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:831`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/orders/all' && m === 'GET') {
      OL.sweep(db); // P0-5 惰性扫描：归零的待支付单自动取消
      const rows = db.orders.map((o) => {
        OL.ensureAlive(db, o);
        return {
          ...o,
          buyer_name: db.users[o.buyer_id] ? db.users[o.buyer_id].name : o.buyer_id,
          seller_name: db.users[o.seller_id] ? db.users[o.seller_id].name : o.seller_id,
          statusLabel: OL.statusLabel(o),
          remainSeconds: OL.remainSeconds(o),
          delivery: OL.deliveryPayload(db, o),
        };
      });
      saveDb();
      return sendJSON(res, 200, { orders: rows });
    }
    // 门店列表（原型：门店管理 / 切换门店 / 门店会员）
```
</details>

## 170. 门店列表（原型：门店管理 / 切换门店 / 门店会员）
`GET http://localhost:3000/api/stores`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:848`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/stores' && m === 'GET') {
      const stores = db.regionalAgents
        .filter((a) => a.region_type === 'store')
        .map((a, i) => {
          const owner = db.users[a.partner_id];
          const cs = db.coStores.filter((c) => c.owners && c.owners.some((o) => o.id === a.partner_id));
          return {
            store_no: 'NO.' + String(i + 1).padStart(4, '0'),
            name: `脑商线下店${owner ? owner.name : a.partner_id}店`,
            owner_id: a.partner_id, owner_name: owner ? owner.name : '—', owner_phone: owner ? owner.phone : '—',
            region_code: a.region_code, partner_count: cs.length,
            monthly_fee: 698, granted_tier: a.granted_tier || null,
          };
        });
      return sendJSON(res, 200, { stores, costores: db.coStores });
    }
    // 区域团队（原型：区域团队 / 用户详情）
```
</details>

## 171. 区域团队（原型：区域团队 / 用户详情）
`GET http://localhost:3000/api/region/team`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:865`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/region/team' && m === 'GET') {
      const list = db.regionalAgents.map((a) => {
        const owner = db.users[a.partner_id];
        const sub = db.regionalAgents.filter((x) => x.partner_id !== a.partner_id
          && x.parent_code === a.region_code);
        return {
          partner_id: a.partner_id, name: owner ? owner.name : a.partner_id,
          phone: owner ? owner.phone : '—', tier: owner ? owner.tier : null,
          region_type: a.region_type, region_code: a.region_code, granted_tier: a.granted_tier,
          sub_count: sub.length,
        };
      });
      return sendJSON(res, 200, { team: list });
    }
    // ── P0-9 分配意愿自选：默认规则（巡查 5% / 销售 5%）读写 ──
```
</details>

## 172. P0-9 分配意愿自选：默认规则（巡查 5% / 销售 5%）读写
`GET http://localhost:3000/api/allocation/scheme`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:880`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/allocation/scheme' && m === 'GET') {
      return sendJSON(res, 200, { scheme: ALC.scheme(db) });
    }
```
</details>

## 173. P0-9 分配意愿自选：默认规则（巡查 5% / 销售 5%）读写
`POST http://localhost:3000/api/allocation/scheme`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:883`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### 请求 JSON 示例
```json
{}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/allocation/scheme' && m === 'POST') {
      const b = await readBody(req);
      try {
        const s = ALC.updateScheme(db, b || {}); saveDb();
        return sendJSON(res, 200, { ok: true, scheme: s });
      } catch (e) { return sendJSON(res, 400, { ok: false, error: e.message }); }
    }
    // P0-9 分配结算：把 PENDING_SETTLEMENT 拆成子佣金（父记录打 withhold），下个结算周期生效
```
</details>

## 174. P0-9 分配结算：把 PENDING_SETTLEMENT 拆成子佣金（父记录打 withhold），下个结算周期生效
`POST http://localhost:3000/api/allocation/settle`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:891`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|period|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "period": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/allocation/settle' && m === 'POST') {
      const b = await readBody(req);
      const r = ALC.settle(db, { period: b && b.period ? b.period : null }); saveDb();
      return sendJSON(res, 200, { ok: true, settled: r.settled, commissions: r.commissions });
    }
    // ── P0-7 分红业绩门槛（可配，不写死 2900）：权益判定 + 逐月台账 ──
```
</details>

## 175. P0-7 分红业绩门槛（可配，不写死 2900）：权益判定 + 逐月台账
`GET http://localhost:3000/api/dividend/rights`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:897`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|userId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|period|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|kind|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/dividend/rights' && m === 'GET') {
      const targetId = url.searchParams.get('userId') || currentUserId(req, url, sess);
      const period = url.searchParams.get('period') || undefined;
      const kind = url.searchParams.get('kind') || 'memberCard';
      if (!targetId || !db.users[targetId]) return sendJSON(res, 400, { error: '缺少或无效的 userId' });
      if (!period) return sendJSON(res, 400, { error: '缺少 period（YYYY-MM）' });
      return sendJSON(res, 200, DIV.rights(db, targetId, period, kind));
    }
```
</details>

## 176. 业务查询接口
`GET http://localhost:3000/api/dividend/history`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:905`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|userId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|months|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|kind|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/dividend/history' && m === 'GET') {
      const targetId = url.searchParams.get('userId') || currentUserId(req, url, sess);
      const months = Number(url.searchParams.get('months')) || 6;
      const kind = url.searchParams.get('kind') || null;
      if (!targetId || !db.users[targetId]) return sendJSON(res, 400, { error: '缺少或无效的 userId' });
      return sendJSON(res, 200, DIV.history(db, targetId, { months, kind }));
    }
    // ── P0-1 经验值 / P0-8 收益明细业务类型：台账与晋升任务进度 ──
```
</details>

## 177. P0-1 经验值 / P0-8 收益明细业务类型：台账与晋升任务进度
`GET http://localhost:3000/api/experience/ledger`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:913`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|userId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|tab|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/experience/ledger' && m === 'GET') {
      const targetId = url.searchParams.get('userId') || currentUserId(req, url, sess);
      const tab = url.searchParams.get('tab') || null;
      if (!targetId || !db.users[targetId]) return sendJSON(res, 400, { error: '缺少或无效的 userId' });
      return sendJSON(res, 200, EXP.ledger(db, targetId, { tab }));
    }
```
</details>

## 178. 业务查询接口
`GET http://localhost:3000/api/promotion-tasks`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:919`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|userId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (p === '/api/promotion-tasks' && m === 'GET') {
      const targetId = url.searchParams.get('userId') || currentUserId(req, url, sess);
      if (!targetId || !db.users[targetId]) return sendJSON(res, 400, { error: '缺少或无效的 userId' });
      return sendJSON(res, 200, EXP.progress(db, targetId));
    }
    return sendJSON(res, 404, { error: '管理员接口不存在: ' + p });
  }

  // ───── 用户（合伙人 / 区域代理 / 合店老板） ─────
  const userId = currentUserId(req, url, sess);
  if (!userId) return sendJSON(res, 400, { error: '无法确定当前用户' });

```
</details>

## 179. 用户（合伙人 / 区域代理 / 合店老板）
`GET http://localhost:3000/api/me`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:931`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/api/me' && m === 'GET') {
    try { return sendJSON(res, 200, R.getMe(db, userId)); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
  }
```
</details>

## 180. 业务查询接口
`GET http://localhost:3000/api/team`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:934`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|type|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|identity|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/api/team' && m === 'GET') {
    try { return sendJSON(res, 200, R.getTeam(db, userId)); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
  }
  if (p === '/api/commissions' && m === 'GET') {
    const type = url.searchParams.get('type') || undefined;
    const identity = url.searchParams.get('identity') || undefined;
    return sendJSON(res, 200, R.getCommissions(db, userId, { type, identity }));
  }
  if (p === '/api/identities' && m === 'GET') {
    // 身份切换（2026-10-23）：合伙人/区域代理/合店老板可同时持有，各身份收益分离
    try { return sendJSON(res, 200, R.getIdentities(db, userId)); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
  }
```
</details>

## 181. 身份切换（2026-10-23）：合伙人/区域代理/合店老板可同时持有，各身份收益分离
`GET http://localhost:3000/api/costore`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:946`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/api/costore' && m === 'GET') {
    return sendJSON(res, 200, R.getCostore(db, userId) || { message: '该用户无合店记录' });
  }
```
</details>

## 182. 业务查询接口
`GET http://localhost:3000/api/agent`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:949`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|buyerId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/api/agent' && m === 'GET') {
    return sendJSON(res, 200, R.getAgent(db, userId) || { message: '该用户无区域代理身份' });
  }
  if (p === '/api/order/product' && m === 'POST') {
    // 产品购买（2026-10-23 新规格）：成交价 + 固定链级差/特色分成 + 合伙人产品提成
    const b = await readBody(req);
    try {
      const r = R.createProductOrder(db, { ...b, buyerId: b.buyerId || userId });
      saveDb();
      return sendJSON(res, 200, { ok: true, ...r });
    } catch (e) { return sendJSON(res, 400, { error: e.message }); }
  }
```
</details>

## 183. 业务操作接口
`POST http://localhost:3000/api/region/month`

Security：Bearer 会话；管理员分支要求 admin，其他分支按身份和资源归属校验。
源码：`server.js:961`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### 请求 JSON 示例
```json
{}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/api/region/month' && m === 'POST') {
    const b = await readBody(req);
    const r = SET.runRegionAgentMonth(R.periodOf(), userId, b);
    return sendJSON(res, 200, r);
  }
  return sendJSON(res, 404, { error: '用户接口不存在: ' + p });
}

// ───────────── 非 API 路径处理（纯 API 服务：返回服务信息或 404） ─────────────
```
</details>

## 184. §3 认证、注册与身份初始化
`POST http://localhost:3000/auth/sessions`

Security：该接口位于统一鉴权前；具体登录检查见下方源码。
源码：`src/routes/h5.js:257`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|channel|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|password|JSON|条件/未显式声明|读取及校验规则见下方实现|Example123|
|loginAccount|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|phone|JSON|条件/未显式声明|读取及校验规则见下方实现|13800138000|

### 请求 JSON 示例
```json
{
  "channel": "示例值",
  "password": "Example123",
  "loginAccount": "示例值",
  "phone": "13800138000"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/auth/sessions' && m === 'POST') {
    const b = await readBody(req);
    const channel = b.channel || 'parent';
    if (channel === 'admin') {
      if (b.password !== ADMIN_PASSWORD) return fail(401, '管理员密码错误');
      const t = 'admin-' + Math.random().toString(36).slice(2);
      sessions[t] = { role: 'admin' };
      return ok(200, { token: t, user: { id: 'admin', name: '总部/后台', role: 'admin' }, accountType: 'admin', expiresAt: null });
    }
    if (channel === 'coach') {
      // 健脑官独立登录（测试平台按 loginAccount 登录；初始凭证发放方式待业务确认，不返回明文密码）
      const coach = B.findCoachByLogin(db, b.loginAccount);
      if (!coach) return fail(404, '健脑官账号不存在');
      if (coach.status !== 'ACTIVE') return fail(403, '账号已停用');
      const t = 'coach-' + Math.random().toString(36).slice(2);
      sessions[t] = { role: 'coach', coachId: coach.id, storeId: coach.storeId, name: coach.name };
      return ok(200, { token: t, user: { id: coach.id, name: coach.name, role: 'coach' }, accountType: 'coach', expiresAt: null });
    }
    // parent：手机号 + 密码 登录（账号密码登录，不再免密直接发 token）
    const phone = b.phone;
    const password = b.password;
    if (!phone) return fail(400, 'parent 登录需 phone');
    if (!password) return fail(400, 'parent 登录需 password');
    const u = S.getUserByPhone(db, phone);
    if (!u) return fail(404, '未找到该手机号对应的合伙人');
    if (!u.password) return fail(403, '该账号尚未设置密码，请先注册或重置密码');
    const v = PWD.verifyPassword(u.password, password);
    if (!v.ok) return fail(401, '手机号或密码错误');
    if (v.needsUpgrade) { PWD.upgradeIfPlaintext(u, password); save(); }
    const t = 'user-' + Math.random().toString(36).slice(2);
    sessions[t] = { role: 'user', userId: u.id };
    return ok(200, { token: t, user: { id: u.id, name: u.name, role: 'user', displayId: u.display_id }, entitlement: { state: IZ.entitlementState(u), amount: IZ.ENTITLEMENT_AMOUNT }, accountType: 'parent', expiresAt: null });
  }
```
</details>

## 185. 认证操作接口
`POST http://localhost:3000/auth/sms-challenges`

Security：该接口位于统一鉴权前；具体登录检查见下方源码。
源码：`src/routes/h5.js:290`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|phone|JSON|条件/未显式声明|读取及校验规则见下方实现|13800138000|
|purpose|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "phone": "13800138000",
  "purpose": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/auth/sms-challenges' && m === 'POST') {
    const b = await readBody(req);
    if (!b.phone || !b.purpose) return fail(400, '需 phone 与 purpose');
    if (!['register', 'reset-password', 'login'].includes(b.purpose)) return fail(400, 'purpose 为 register/reset-password/login');
    const code = String(Math.floor(100000 + Math.random() * 900000));
    db.smsChallenges = db.smsChallenges || [];
    // 同一手机号+用途：旧验证码作废，只认最新一条（防刷 + 避免旧码仍可用）
    for (const c of db.smsChallenges) {
      if (c.phone === b.phone && c.purpose === b.purpose && !c.used) c.used = true;
    }
    db.smsChallenges.push({ phone: b.phone, code, purpose: b.purpose, expiresAt: nowMs() + 300000, used: false });
    save();
    // P2-1（2026-10-26）：验证码**不回传**到响应体，避免绕过短信通道直接登录。
    //   仅当显式设置 EXPOSE_DEV_CODE=1（本地联调）时才带 devCode；生产必须走短信网关。
    //
    // 开发联调：验证码输出到**后端终端**（IDEA Console / node 进程 stdout），
    //   走终端而不是响应体 → 抓包拿不到验证码，联调安全且无需短信网关。
    const isProd = String(process.env.NODE_ENV || '') === 'production';
    const logToConsole = !isProd || String(process.env.SMS_LOG_CONSOLE || '') === '1';
    if (logToConsole) {
      const masked = String(b.phone).replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
      console.log(`[短信验证码] 手机号 ${masked} | 用途 ${b.purpose} | 验证码 ${code} | 5 分钟内有效`);
    }
    const expose = String(process.env.EXPOSE_DEV_CODE || '') === '1';
    return ok(200, expose
      ? { retryAfter: 60, expiresAt: nowMs() + 300000, devCode: code, note: '开发联调模式：EXPOSE_DEV_CODE=1，验证码直接返回' }
      : { retryAfter: 60, expiresAt: nowMs() + 300000 });
  }
```
</details>

## 186. 认证操作接口
`POST http://localhost:3000/auth/registrations`

Security：该接口位于统一鉴权前；具体登录检查见下方源码。
源码：`src/routes/h5.js:318`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|phone|JSON|条件/未显式声明|读取及校验规则见下方实现|13800138000|
|password|JSON|条件/未显式声明|读取及校验规则见下方实现|Example123|
|code|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|inviteCode|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|name|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|wechatTicket|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|regionCodes|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|regionNames|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "phone": "13800138000",
  "password": "Example123",
  "code": "示例值",
  "inviteCode": "示例值",
  "name": "示例值",
  "wechatTicket": "示例值",
  "regionCodes": "示例值",
  "regionNames": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/auth/registrations' && m === 'POST') {
    const b = await readBody(req);
    if (!b.phone || !b.password) return fail(400, '需 phone 与 password');
    if (S.getUserByPhone(db, b.phone)) return fail(409, '该手机号已注册');
    // 短信验证码校验（与密码重置同口径）：必须有「本手机号 + register 用途 + 未使用 + 未过期」的验证码
    const ch = (db.smsChallenges || []).filter((c) => c.phone === b.phone && c.purpose === 'register' && !c.used && c.expiresAt > nowMs()).pop();
    if (!ch) return fail(400, '验证码不存在或已过期，请先获取');
    if (!b.code || String(b.code).trim() !== ch.code) return fail(400, '验证码错误');
    ch.used = true;
    let upline_id = null;
    let inviteRec = null;
    if (b.inviteCode) {
      // P1-8：优先按「注册邀请码」（类型化）解析；未命中则回退旧码（手机号/uid）兼容
      const icCfg = (S.getSettings(db) || {}).inviteCode || {};
      inviteRec = IC.resolveInviteCode(db, b.inviteCode);
      if (inviteRec && inviteRec.type === 'register' && icCfg.bindOnRegister !== false) {
        upline_id = inviteRec.ownerId;
      } else {
        const inv = S.getUserByPhone(db, b.inviteCode) || db.users[b.inviteCode];
        if (inv) upline_id = inv.id;
      }
    }
    const id = 'u_' + Math.random().toString(36).slice(2, 8);
    const u = S.addUser(db, { id, name: b.name || b.phone, phone: b.phone, tier: 'vip', upline_id, is_founding: 'none', teamVip: 0 });
    if (inviteRec && inviteRec.ownerId === upline_id) inviteRec.usedBy.push({ userId: id, at: nowMs() });
    // P2-2：微信登录票据 → 绑定 openid（票据一次性使用）
    if (b.wechatTicket) {
      const tk = (db.wechatTickets || []).find((t) => t.ticket === b.wechatTicket && t.expiresAt > nowMs());
      if (tk) { u.wechat_openid = tk.openid; if (tk.unionid) u.wechat_unionid = tk.unionid; tk.usedAt = nowMs(); }
    }
    PWD.setPassword(u, b.password);
    // 地区：前端注册页强制要求 3 级地区编码，落库后 /me 可回显（否则用户所选地区丢失）
    if (Array.isArray(b.regionCodes) && b.regionCodes.length === 3) {
      u.regionCodes = b.regionCodes.slice();
      u.regionNames = Array.isArray(b.regionNames) ? b.regionNames.slice() : [];
    }
    // 新注册：权益未开通 → QZ 编号 + 全功能门禁（收益照算、付清 200 后解锁可见）
    u.entitlement_state = 'never_paid';
    IZ.recomputeDisplayId(db, id);
    db.quotaLedger[id] = { standard: 0, activity: [] };
    save();
    const t = 'user-' + Math.random().toString(36).slice(2);
    sessions[t] = { role: 'user', userId: id };
    return ok(200, { token: t, user: { id, name: u.name, role: 'user', displayId: u.display_id }, entitlement: { state: 'never_paid', amount: IZ.ENTITLEMENT_AMOUNT }, accountType: 'parent', expiresAt: null });
  }
```
</details>

## 187. 认证操作接口
`POST http://localhost:3000/auth/password-reset-verifications`

Security：该接口位于统一鉴权前；具体登录检查见下方源码。
源码：`src/routes/h5.js:363`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|phone|JSON|条件/未显式声明|读取及校验规则见下方实现|13800138000|
|code|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "phone": "13800138000",
  "code": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/auth/password-reset-verifications' && m === 'POST') {
    const b = await readBody(req);
    if (!b.phone || !b.code) return fail(400, 'phone 与 code 必填');
    const ch = (db.smsChallenges || []).find((c) => c.phone === b.phone && c.purpose === 'reset-password' && !c.used && c.expiresAt > nowMs());
    if (!ch) return fail(400, '验证码不存在或已过期，请先发送');
    if (String(b.code) !== ch.code) return fail(400, '验证码错误');
    ch.used = true;
    const ticket = 'prt_' + Math.random().toString(36).slice(2, 10);
    db.passwordResets = db.passwordResets || [];
    db.passwordResets.push({ ticket, phone: b.phone, expiresAt: nowMs() + 600000, used: false });
    save();
    return ok(200, { resetTicket: ticket, expiresAt: nowMs() + 600000 });
  }
```
</details>

## 188. 认证操作接口
`POST http://localhost:3000/auth/password-resets`

Security：该接口位于统一鉴权前；具体登录检查见下方源码。
源码：`src/routes/h5.js:376`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|resetTicket|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|password|JSON|条件/未显式声明|读取及校验规则见下方实现|Example123|

### 请求 JSON 示例
```json
{
  "resetTicket": "示例值",
  "password": "Example123"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/auth/password-resets' && m === 'POST') {
    const b = await readBody(req);
    if (!b.resetTicket) return fail(400, 'resetTicket 必填');
    const t = (db.passwordResets || []).find((x) => x.ticket === b.resetTicket && !x.used && x.expiresAt > nowMs());
    if (!t) return fail(400, '重置票据无效或已过期');
    if (!b.password || !PWD.isStrongEnough(b.password)) return fail(400, '新密码至少 6 位');
    const u = S.getUserByPhone(db, t.phone);
    if (!u) return fail(404, '账号不存在');
    PWD.setPassword(u, b.password); t.used = true; save();
    return ok(200, { success: true });
  }
```
</details>

## 189. 个人中心操作接口
`POST http://localhost:3000/me/password-changes`

Security：该接口位于统一鉴权前；具体登录检查见下方源码。
源码：`src/routes/h5.js:387`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|newPassword|JSON|条件/未显式声明|读取及校验规则见下方实现|Example123|
|oldPassword|JSON|条件/未显式声明|读取及校验规则见下方实现|Example123|

### 请求 JSON 示例
```json
{
  "newPassword": "Example123",
  "oldPassword": "Example123"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/me/password-changes' && m === 'POST') {
    if (!sess || sess.role !== 'user') return fail(401, '未登录');
    const b = await readBody(req);
    const u = db.users[sess.userId];
    if (!u) return fail(404, '用户不存在');
    if (!b.newPassword || !PWD.isStrongEnough(b.newPassword)) return fail(400, '新密码至少 6 位');
    if (u.password) {
      const v = PWD.verifyPassword(u.password, b.oldPassword || '');
      if (!v.ok) return fail(400, '原密码错误');
      if (v.needsUpgrade) PWD.upgradeIfPlaintext(u, b.oldPassword || '');
    }
    PWD.setPassword(u, b.newPassword); save();
    return ok(200, { changed: true });
  }
  // ── P2-2 微信 OAuth 登录 ──
  //   配置（WECHAT_APPID / WECHAT_SECRET）齐全 → 走真实微信授权与 code 换 openid；
  //   未配置 → 走 mock 模式（返回 mock 授权地址与 mock 注册票据），保证本地联调不阻塞。
```
</details>

## 190. 未配置 → 走 mock 模式（返回 mock 授权地址与 mock 注册票据），保证本地联调不阻塞。
`POST http://localhost:3000/auth/wechat/authorizations`

Security：该接口位于统一鉴权前；具体登录检查见下方源码。
源码：`src/routes/h5.js:404`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|redirectUri|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "redirectUri": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/auth/wechat/authorizations' && m === 'POST') {
    const b = await readBody(req);
    const state = Math.random().toString(36).slice(2);
    const appid = process.env.WECHAT_APPID || '';
    const redirectUri = b.redirectUri || '';
    if (appid) {
      const url = 'https://open.weixin.qq.com/connect/oauth2/authorize'
        + '?appid=' + encodeURIComponent(appid)
        + '&redirect_uri=' + encodeURIComponent(redirectUri)
        + '&response_type=code&scope=snsapi_base&state=' + encodeURIComponent(state)
        + '#wechat_redirect';
      return ok(200, { url, state, mode: 'live', note: '真实微信授权地址；回调时请把 code 透传到 /auth/wechat/exchanges' });
    }
    return ok(200, { url: 'https://mock.wechat.example.com/authorize?redirect_uri=' + encodeURIComponent(redirectUri) + '&state=' + state, state, mode: 'mock', note: '未配置 WECHAT_APPID，返回 mock 授权地址（仅供本地联调）' });
  }
```
</details>

## 191. mock.wechat.example.com/authorize?redirect_uri=' + encodeURIComponent(redirectUri) + '&state=' + state, state, mode: 'mock', note: '未配置 WECHAT_APPID，返回 mock 授权地址（仅供本地联调）' });
`POST http://localhost:3000/auth/wechat/exchanges`

Security：该接口位于统一鉴权前；具体登录检查见下方源码。
源码：`src/routes/h5.js:419`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|code|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "code": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/auth/wechat/exchanges' && m === 'POST') {
    const b = await readBody(req);
    const appid = process.env.WECHAT_APPID || '';
    const secret = process.env.WECHAT_SECRET || '';
    if (!appid || !secret) {
      return ok(200, { registrationTicket: 'mock-' + Math.random().toString(36).slice(2), expiresAt: nowMs() + 300000, mode: 'mock', note: '未配置 WECHAT_APPID/WECHAT_SECRET，返回 mock 注册票据' });
    }
    if (!b.code) return fail(400, 'code 必填');
    try {
      const u = 'https://api.weixin.qq.com/sns/oauth2/access_token'
        + '?appid=' + encodeURIComponent(appid)
        + '&secret=' + encodeURIComponent(secret)
        + '&code=' + encodeURIComponent(b.code)
        + '&grant_type=authorization_code';
      const r = await fetch(u);
      const j = await r.json().catch(() => ({}));
      if (j.errcode || !j.openid) return fail(400, `微信换取 openid 失败：${j.errcode || 'unknown'} ${j.errmsg || ''}`.trim());
      const ticket = 'wx-' + j.openid + '-' + Math.random().toString(36).slice(2, 8);
      db.wechatTickets = db.wechatTickets || [];
      db.wechatTickets.push({ ticket, openid: j.openid, unionid: j.unionid || null, expiresAt: nowMs() + 300000, at: nowMs() });
      save();
      return ok(200, { registrationTicket: ticket, expiresAt: nowMs() + 300000, mode: 'live', note: '凭 ticket 到 /auth/registrations 完成注册/登录' });
    } catch (e) {
      return fail(502, '调用微信接口失败：' + e.message);
    }
  }
```
</details>

## 192. 个人中心查询接口
`GET http://localhost:3000/me/bootstrap`

Security：该接口位于统一鉴权前；具体登录检查见下方源码。
源码：`src/routes/h5.js:445`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/me/bootstrap' && m === 'GET') {
    if (!sess || sess.role !== 'user') return fail(401, '未登录');
    const userId = sess.userId;
    const u = S.getUser(db, userId);
    if (!u) return fail(404, '用户不存在');
    const idRes = R.getIdentities(db, userId);
    const businessContexts = buildBusinessContexts(db, userId, idRes.identities);
    // contexts：学习身份上下文（家长本人 + 每个孩子）
    //   前端 learning.js 的 getLearningIdentities() 只认这个数组，并且按
    //   accountId + mode('parent'|'child') + memberId 过滤；
    //   之前这里写死 [] → 会员页只能显示"暂无可用身份，请联系服务人员"，
    //   等级区也永远是"暂无等级"。
    //   字段口径与前端 mock/learning.js 的 mockIdentities 保持一致。
    const contexts = [];
    contexts.push({
      id: `parent:${userId}`, accountId: userId, mode: 'parent',
      name: u.name || '家长', displayId: u.display_id || userId,
      grade: '', badge: '家长',
    });
    for (const mm of (db.members || []).filter((x) => x.userId === userId)) {
      const unlockedCount = (mm.unlockedLevels || []).length;
      contexts.push({
        id: `member:${mm.id}`, accountId: userId, mode: 'child', memberId: mm.id,
        name: mm.name, displayId: mm.display_id || mm.id,
        grade: mm.gradeLabel || '',
        badge: (mm.memberLevel && mm.memberLevel !== 'normal')
          ? IZ.memberTierName(mm.memberLevel)
          : (unlockedCount ? '已开通等级' : '未激活会员'),
      });
    }
    const ent = IZ.entitlementState(u);
    return ok(200, {
      displayId: u.display_id,
      entitlement: { state: ent, amount: IZ.ENTITLEMENT_AMOUNT, expiresAt: u.entitlement_expires_at || null, frozen: ent === 'expired', canExportBills: ent === 'expired' },
      contexts, businessContexts,
    });
  }
  // 权益收益费开通/续费（周期制；当前免支付占位，正式收银台接入后替换）
```
</details>

## 193. 权益收益费开通/续费（周期制；当前免支付占位，正式收银台接入后替换）
`POST http://localhost:3000/me/entitlement-orders`

Security：该接口位于统一鉴权前；具体登录检查见下方源码。
源码：`src/routes/h5.js:483`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|idempotencyKey|JSON|条件/未显式声明|读取及校验规则见下方实现|request-20261029-001|
|channel|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "idempotencyKey": "request-20261029-001",
  "channel": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/me/entitlement-orders' && m === 'POST') {
    if (!sess || sess.role !== 'user') return fail(401, '未登录');
    const b = await readBody(req);
    if (!b.idempotencyKey) return fail(400, 'idempotencyKey 必填');
    const u = db.users[sess.userId];
    if (!u) return fail(404, '用户不存在');
    const channel = b.channel || 'wechat';   // wechat/alipay/bank_card
    let created;
    try {
      created = PAY.createPayment(db, { bizType: 'entitlement', userId: sess.userId, amount: IZ.ENTITLEMENT_AMOUNT, channel, idempotencyKey: b.idempotencyKey });
    } catch (e) { return fail(400, e.message); }
    if (created.paid) {
      if (!created.duplicated) PAY.applyBizEffect(db, created.payment);
      save();
      const uu = db.users[sess.userId];
      return ok(200, { status: 'SUCCEEDED', operationId: created.payment.id, paymentId: created.payment.id, channel: created.payment.channel, displayId: uu.display_id, entitlement: { state: IZ.entitlementState(uu), amount: IZ.ENTITLEMENT_AMOUNT, paidAt: uu.entitlement_paid_at, expiresAt: uu.entitlement_expires_at }, note: created.payment.note });
    }
    save();
    return ok(200, { status: 'CREATED', paymentId: created.payment.id, channel: created.payment.channel, channelName: PAY.channelName(created.payment.channel), amount: IZ.ENTITLEMENT_AMOUNT, payParams: created.payParams, note: '请调起支付；支付结果以渠道异步通知为准（可轮询 GET /me/payments/{id}）' });
  }
  // ── 支付单查询（我的支付单；未开通用户亦可查权益单状态，故置于门禁之前） ──
```
</details>

## 194. 支付单查询（我的支付单；未开通用户亦可查权益单状态，故置于门禁之前）
`GET http://localhost:3000/me/payments`

Security：该接口位于统一鉴权前；具体登录检查见下方源码。
源码：`src/routes/h5.js:504`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/me/payments' && m === 'GET') {
    if (!sess || sess.role !== 'user') return fail(401, '未登录');
    return ok(200, { items: PAY.listPayments(db, sess.userId).map(PAY.publicPayment), hasMore: false, nextCursor: null, paymentMode: PAY.PAYMENT_MODE });
  }
```
</details>

## 195. 个人中心查询接口
`GET http://localhost:3000/me/payments/{动态路径}`
原始匹配：`p.startsWith('/me/payments/') && m === 'GET' && !p.endsWith('/sandbox-confirm')`
Security：该接口位于统一鉴权前；具体登录检查见下方源码。
源码：`src/routes/h5.js:508`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.startsWith('/me/payments/') && m === 'GET' && !p.endsWith('/sandbox-confirm')) {
    if (!sess || sess.role !== 'user') return fail(401, '未登录');
    const id = p.slice('/me/payments/'.length);
    const pay = PAY.getPayment(db, id);
    if (!pay || pay.userId !== sess.userId) return fail(404, '支付单不存在');
    return ok(200, { payment: PAY.publicPayment(pay), payParams: pay.status === 'CREATED' ? pay.payParams : undefined });
  }
  // 沙箱确认（live 模式联调：模拟渠道异步通知入账；sandbox 模式已自动支付）
```
</details>

## 196. 沙箱确认（live 模式联调：模拟渠道异步通知入账；sandbox 模式已自动支付）
`POST http://localhost:3000/me/payments/{动态路径}`
原始匹配：`p.startsWith('/me/payments/') && p.endsWith('/sandbox-confirm') && m === 'POST'`
Security：该接口位于统一鉴权前；具体登录检查见下方源码。
源码：`src/routes/h5.js:516`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### 请求 JSON 示例
```json
{}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.startsWith('/me/payments/') && p.endsWith('/sandbox-confirm') && m === 'POST') {
    if (!sess || sess.role !== 'user') return fail(401, '未登录');
    const id = p.slice('/me/payments/'.length, p.length - '/sandbox-confirm'.length);
    const pay = PAY.getPayment(db, id);
    if (!pay || pay.userId !== sess.userId) return fail(404, '支付单不存在');
    if (!PAY.IS_SANDBOX && pay.status !== 'PAID') {
      const r = PAY.settlePayment(db, id, { transactionId: 'sandbox_confirm' }); save();
      return ok(200, { payment: PAY.publicPayment(r.payment), effect: r.effect || null });
    }
    return ok(200, { payment: PAY.publicPayment(pay), note: PAY.IS_SANDBOX ? 'sandbox 模式已自动支付' : '该单已支付' });
  }
  // 渠道异步通知（公开端点：验签 → 入账 → 业务效果；置于登录门禁之前）
```
</details>

## 197. 渠道异步通知（公开端点：验签 → 入账 → 业务效果；置于登录门禁之前）
`POST http://localhost:3000/payments/notify/{动态路径}`
原始匹配：`p.startsWith('/payments/notify/') && m === 'POST'`
Security：该接口位于统一鉴权前；具体登录检查见下方源码。
源码：`src/routes/h5.js:528`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### 请求 JSON 示例
```json
{}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.startsWith('/payments/notify/') && m === 'POST') {
    const channel = p.slice('/payments/notify/'.length);
    const b = await readBody(req);
    const r = PAY.handleNotify(db, channel, b);
    if (!r.ok) return fail(400, r.error);
    save();
    return ok(200, { ok: true, paymentId: r.payment.id, status: r.payment.status, newlyPaid: r.newlyPaid, effect: r.effect || null });
  }
  // 历史账单导出（权益过期后仍可导出之前的收益；未开通无账单可导）
```
</details>

## 198. 历史账单导出（权益过期后仍可导出之前的收益；未开通无账单可导）
`GET http://localhost:3000/me/income-export`

Security：该接口位于统一鉴权前；具体登录检查见下方源码。
源码：`src/routes/h5.js:537`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|created_at|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/me/income-export' && m === 'GET') {
    if (!sess || sess.role !== 'user') return fail(401, '未登录');
    const u = db.users[sess.userId];
    if (!u) return fail(404, '用户不存在');
    const st = IZ.entitlementState(u);
    if (st === 'never_paid') return fail(403, '未开通权益收益费，暂无账单可导出');
    const rows = db.commissions.filter((c) => c.owner_id === sess.userId).sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
    const total = round2(rows.reduce((s, c) => s + c.amount, 0));
    const byType = {};
    for (const c of rows) byType[c.type] = round2((byType[c.type] || 0) + c.amount);
    const items = rows.map((c) => ({ id: c.id, period: c.period || null, category: c.type, title: T_CN[c.type] || c.type, amount: c.amount, baseAmount: c.base_amount, rate: c.rate, status: c.status || 'SETTLED', createdAt: c.created_at, sourceOrder: c.ref_order_id || null }));
```
</details>

## 199. 认证操作接口
`DELETE http://localhost:3000/auth/sessions/current`

Security：该接口位于统一鉴权前；具体登录检查见下方源码。
源码：`src/routes/h5.js:557`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|contextId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### 请求 JSON 示例
```json
{}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/auth/sessions/current' && m === 'DELETE') {
    if (token && sessions[token]) { delete sessions[token]; }
    return ok(200, { success: true });
  }

  // 以下需登录（user / admin / coach）
  // 例外：协议正文（用户服务协议 / 隐私政策）属公开法律文档，登录前也要能读（如注册页勾选协议）
  const isPublicDoc = m === 'GET' && p.startsWith('/agreements/');
  if (!sess && !isPublicDoc) return fail(401, '未登录或 token 失效');

  // ───────────────────────── 权益门禁（2026-10-24 用户确认） ─────────────────────────
  // 200 权益收益费未开通/已过期 → 什么功能都不给（前端隐藏全部功能入口，只留「开通权益」）。
  // 豁免：bootstrap（下发门禁状态）、开通/续费、历史账单导出（过期）、改密码、登出。
  if (sess && sess.role === 'user') {
    const me0 = db.users[sess.userId];
    const gate = IZ.gatePayload(me0);
    if (gate) {
      const EXEMPT = new Set(['/me/bootstrap', '/me/entitlement-orders', '/me/income-export', '/me/password-changes', '/auth/sessions/current']);
      if (!EXEMPT.has(p)) {
        return ok(200, {
          locked: true, entitlementState: gate.entitlementState, entitlementAmount: gate.entitlementAmount,
          frozen: gate.frozen, canExportBills: gate.canExportBills, message: gate.message,
          displayId: me0 ? me0.display_id : null,
          entitlement: { state: gate.entitlementState, amount: gate.entitlementAmount, expiresAt: me0 ? (me0.entitlement_expires_at || null) : null },
        });
      }
    }
  }

  // ───────────────────────── 业务模块层（§4/§5/§6/§11/§12遗留/§13/§14，见 h5biz.js） ─────────────────────────
  if (await B.handle(db, req, res, url, { sess, ok, fail, save, q, readBody, resolveContext })) return true;
  if (await CD.handle(db, req, res, url, { sess, ok, fail, save, q, readBody, resolveContext })) return true; // 支付/激活码发放（h5codes.js）

  // ───────────────────────── §9 经营报表（GET） ─────────────────────────
  const needCtx = (module) => {
    const cid = q('contextId');
    if (!cid) return fail(400, 'contextId 必填');
    const { userId, module: mod, scope } = resolveContext(cid);
    if (!userId || (module && mod && mod !== module)) return fail(400, 'contextId 与模块不匹配');
    if (!db.users[userId]) return fail(404, 'contextId 指向的用户不存在');
    return { userId, scope };
  };

```
</details>

## 200. 合伙人查询接口
`GET http://localhost:3000/partner/overview`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:600`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|contextId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/overview' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    const me = R.getMe(db, c.userId);
    const u = db.users[c.userId] || {};
    // 本金（2026-10-26）：实际付过钱的最高档一口价；无本金记录时回退当前档（兼容旧种子）
    const principalTier = u.principal_tier || u.tier || null;
    const principal = principalTier ? (C.RETAIL_PRICE[principalTier] || 0) : 0;
    const idr = R.getIdentities(db, c.userId).identities.find((x) => x.key === 'partner');
    // 拉人免费升档进度（2026-10-26）：直推 N 名同级付费升档 → 免费升 1 档
    const referralFreeUpgrade = S.referralFreeUpgradeProgress(db, c.userId);
    // 经验值（P0-1）与晋升任务（P0-2）
    const expSum = EXP.summary(db, c.userId);
    const task = EXP.progress(db, c.userId);
    // 分红门槛提示（P0-7）
    const dividendPrompt = DIV.currentPrompt(db, c.userId, 'memberCard');
    return ok(200, {
      accountId: c.userId, contextId: q('contextId'), displayId: u.display_id || null,
      levelName: idr ? idr.detail : me.tier, partnerStatus: 'active', annualRemainingDays: null, rankDescription: '',
      experience: expSum.promotionExperience + expSum.productExperience,
      experienceDetail: { promotion: expSum.promotionExperience, product: expSum.productExperience },
      experienceTarget: 0, benefits: [],
      quotaBalance: me.quota_balance, monthIncome: me.month_income, monthByType: me.month_by_type, teamVip: me.team_vip,
      principalTier, principal, referralFreeUpgrade,
      promotionTask: task, dividendPrompt,
    });
  }
```
</details>

## 201. 合店查询接口
`GET http://localhost:3000/costore/overview`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:626`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|contractId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|contextId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/costore/overview' && m === 'GET') {
    const c = needCtx('costore'); if (!c.userId) return c;
    const cs = R.getCostore(db, c.userId, { contractId: c.scope || q('contractId') });
    if (!cs) return fail(404, '该用户无合店记录');
    return ok(200, { accountId: c.userId, contextId: q('contextId'), storeId: cs.store_id || cs.storeManagerId, contractId: cs.id, monthlyFee: cs.monthly_fee, scenario: cs.scenario, byRecipient: cs.byRecipient, dividendPool: cs.dividendPool, benefits: [] });
  }
```
</details>

## 202. 代理查询接口
`GET http://localhost:3000/agency/overview`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:632`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|assignmentId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|contextId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/agency/overview' && m === 'GET') {
    const c = needCtx('agency'); if (!c.userId) return c;
    const ag = R.getAgent(db, c.userId, { assignmentId: c.scope || q('assignmentId') });
    if (!ag) return fail(404, '该用户无区域代理身份');
    const agencyType = AGENCY_TYPE_MAP[ag.agent.region_type] || ag.agent.region_type;
    return ok(200, { accountId: c.userId, contextId: q('contextId'), agencyType, regionCode: ag.agent.region_code, grantedTier: ag.agent.granted_tier || null, levelName: `${AGENCY_TYPE_CN[agencyType] || agencyType} · ${ag.agent.region_code || ''}`, monthIncome: ag.month_income, byRegion: ag.by_region, benefits: [] });
  }
```
</details>

## 203. 合伙人查询接口
`GET http://localhost:3000/partner/income`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:639`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/income' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    const r = R.getCommissions(db, c.userId, { identity: 'partner' });
    const items = r.list.map((x) => ({ id: x.id, title: T_CN[x.type] || x.type, category: x.type, amount: x.amount, rate: x.rate, baseAmount: x.base_amount, createdAt: x.created_at, status: x.status || 'SETTLED', sourceOrder: x.ref_order_id || null, ...BIZ.enrich(db, x) }));
    const available = round2(items.reduce((s, i) => s + i.amount, 0));
    return ok(200, { available, metrics: [{ label: '可提现金额', kind: 'money', value: available }], items });
  }
```
</details>

## 204. 合伙人查询接口
`GET http://localhost:3000/partner/team`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:646`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/team' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    const tree = R.getTeam(db, c.userId);
    const flat = flatDownline(tree);
    const items = flat.map((n) => ({ id: n.id, name: n.name, displayId: n.displayId || n.id, phone: n.phone, levelLabel: n.tier, storeName: n.storeName || null, joinedAt: n.joinedAt || null, performance: n.performance || 0 }));
    return ok(200, { items, hasMore: false, nextCursor: null });
  }
```
</details>

## 205. 业务查询接口
`GET http://localhost:3000/income/entries`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:653`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|filter|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|identity|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/income/entries' && m === 'GET') {
    const c = needCtx(); if (!c.userId) return c;
    const identity = q('filter') === 'pending' ? null : q('identity') || null;
    const r = R.getCommissions(db, c.userId, { identity });
    const items = r.list.map((x) => ({ id: x.id, title: T_CN[x.type] || x.type, category: x.type, amount: x.amount, rate: x.rate, baseAmount: x.base_amount, createdAt: x.created_at, status: x.status || 'SETTLED', allocationStatus: x.allocationStatus || 'NONE', allocationKind: ALC.publicKind(ALC.kindOf(x)), incomeChannel: SI.incomeChannelOf(x), incomeChannelLabel: (SI.INCOME_CHANNEL[SI.incomeChannelOf(x)] || {}).label || null, settlementStatus: 'SETTLED', sourceOrder: x.ref_order_id || null, ...BIZ.enrich(db, x) }));
    const metrics = [{ label: '收益合计', kind: 'money', value: r.total }];
    return ok(200, { metrics, items, hasMore: false, nextCursor: null });
  }
```
</details>

## 206. 业务查询接口
`GET http://localhost:3000/income/entries/{动态路径}`
原始匹配：`p.startsWith('/income/entries/') && m === 'GET'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:661`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.startsWith('/income/entries/') && m === 'GET') {
    const id = p.slice('/income/entries/'.length);
    const x = db.commissions.find((c) => c.id === id);
    if (!x) return fail(404, '收益不存在');
    const me = db.users[x.owner_id] || {};
    const order = x.ref_order_id ? db.orders.find((o) => o.id === x.ref_order_id) : null;
    const buyer = order && order.buyer_id ? db.users[order.buyer_id] : null;
    const idKeys = R.getIdentities(db, x.owner_id).identities.map((i) => i.name);
    const biz = BIZ.enrich(db, x);
    // P0-9：仅「巡查 5% / 销售 5%」可分配池才给 allocate 动作（与 allocation-options 的可分配判定一致）
    const alloc = ALC.allocatable(db, x);
    return ok(200, {
      id: x.id, title: T_CN[x.type] || x.type, category: x.type, channel: 'H5', paymentTypeLabel: '微信支付',
      identityLabel: idKeys.join('/'), baseAmount: x.base_amount, rateBps: Math.round((x.rate || 0) * 10000),
      amount: x.amount, createdAt: x.created_at, allocationKind: ALC.publicKind(alloc.kind), incomeChannel: SI.incomeChannelOf(x), incomeChannelLabel: (SI.INCOME_CHANNEL[SI.incomeChannelOf(x)] || {}).label || null,
      allocationStatus: x.allocationStatus || 'NONE', settlementStatus: 'SETTLED',
      beneficiaryName: me.name || null, recommended: !!x.is_direct, buyer: buyer ? { id: buyer.id, name: buyer.name } : null,
      store: order && order.regionCode ? { id: order.regionCode, name: '门店 ' + order.regionCode } : null,
      sourceOrder: x.ref_order_id || null, allowedActions: alloc.ok ? ['allocate'] : [], version: 1, formula: x.formula || null, note: x.note || null, ...biz,
    });
  }
```
</details>

## 207. 合店查询接口
`GET http://localhost:3000/costore/card-dividends`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:682`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/costore/card-dividends' && m === 'GET') {
    const c = needCtx('costore'); if (!c.userId) return c;
    const r = R.getCommissions(db, c.userId, { type: 'costore' });
    const items = r.list.map((x) => ({ id: x.id, title: '合店分红', amount: x.amount, createdAt: x.created_at, sourceOrder: x.ref_order_id || null }));
    return ok(200, { metrics: [{ label: '合店分红合计', kind: 'money', value: r.total }], items, hasMore: false, nextCursor: null });
  }
```
</details>

## 208. 合店查询接口
`GET http://localhost:3000/costore/promotion-dividends`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:688`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/costore/promotion-dividends' && m === 'GET') {
    const c = needCtx('costore'); if (!c.userId) return c;
    const r = R.getCommissions(db, c.userId, { type: 'costore' });
    const items = r.list.map((x) => ({ id: x.id, title: '推广分红', amount: x.amount, createdAt: x.createdAt || x.created_at, sourceOrder: x.ref_order_id || null }));
    return ok(200, { metrics: [{ label: '推广分红合计', kind: 'money', value: r.total }], items, hasMore: false, nextCursor: null });
  }
```
</details>

## 209. 代理查询接口
`GET http://localhost:3000/agency/team`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:694`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/agency/team' && m === 'GET') {
    const c = needCtx('agency'); if (!c.userId) return c;
    const ag = db.regionalAgents.find((a) => a.partner_id === c.userId);
    if (!ag) return fail(404, '无区域代理身份');
    const prefix = (ag.region_code || '').slice(0, 2);
    const team = db.regionalAgents
      .filter((a) => a.partner_id !== c.userId && (a.region_code || '').startsWith(prefix))
      .map((a) => { const o = db.users[a.partner_id]; return { id: a.partner_id, name: o ? o.name : a.partner_id, roleLabel: a.region_type, regionLabel: a.region_code, performance: 0 }; });
    return ok(200, { items: team, hasMore: false, nextCursor: null });
  }
```
</details>

## 210. 代理查询接口
`GET http://localhost:3000/agency/team/{动态路径}`
原始匹配：`p.startsWith('/agency/team/') && m === 'GET'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:704`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.startsWith('/agency/team/') && m === 'GET') {
    const c = needCtx('agency'); if (!c.userId) return c;
    const id = p.slice('/agency/team/'.length);
    const node = db.users[id];
    if (!node) return fail(404, '节点不存在');
    const tree = R.getTeam(db, id);
    const flat = flatDownline(tree);
    return ok(200, {
      node: { id, name: node.name, roleLabel: node.tier },
      members: flat.map((n) => ({ id: n.id, name: n.name, roleLabel: n.tier || '', performance: n.performance || 0 })),
      stores: [], hasMore: false, nextCursor: null,
    });
  }
```
</details>

## 211. 合伙人操作接口
`POST http://localhost:3000/partner/superior-bindings`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:717`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|contextId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|contextId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|inviteCode|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "contextId": "有效资源ID",
  "inviteCode": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/superior-bindings' && m === 'POST') {
    const b = await readBody(req);
    const cid = b.contextId || q('contextId');
    if (!cid) return fail(400, 'contextId 必填');
    const { userId } = resolveContext(cid);
    if (!userId || !db.users[userId]) return fail(404, 'contextId 无效');
    if (!b.inviteCode) return fail(400, 'inviteCode 必填');
    // P1-8：支持类型化「注册邀请码」；未命中再回退旧码（手机号/uid）
    const icRec = IC.resolveInviteCode(db, b.inviteCode);
    let target = null;
    if (icRec && icRec.type === 'register') {
      target = db.users[icRec.ownerId] || null;
    } else {
      target = S.getUserByPhone(db, b.inviteCode) || db.users[b.inviteCode] || null;
    }
    if (!target) return fail(404, '邀请码不存在');
    if (target.id === userId) return fail(400, '不能绑定自己为上级');
    try {
      R.rebind(db, { partnerId: userId, newUplineId: target.id });
      if (icRec && icRec.ownerId === target.id) icRec.usedBy.push({ userId, at: nowMs() });
      save();
      return ok(200, { superior: { id: target.id, name: target.name, phone: target.phone, levelLabel: target.tier } });
    } catch (e) { return fail(400, e.message); }
  }
```
</details>

## 212. 门店查询接口
`GET http://localhost:3000/stores`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:741`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|assignmentId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/stores' && m === 'GET') {
    const assignmentId = q('assignmentId');
    let stores = db.regionalAgents.filter((a) => a.region_type === 'store');
    if (assignmentId) {
      const ag = db.regionalAgents.find((a) => a.partner_id === assignmentId);
      if (ag) stores = stores.filter((a) => (a.region_code || '').startsWith((ag.region_code || '').slice(0, 2)));
    }
    const costoreFee = (S.getSettings(db) || {}).costore ? (S.getSettings(db).costore.monthlyFee || C.COSTORE_FEE_MONTHLY || 698) : (C.COSTORE_FEE_MONTHLY || 698);
    const items = stores.map((a) => {
      const o = db.users[a.partner_id];
      // P1-6：门店维度统计——当前已有合店老板数（原型屏 145「当前已有 8 位合店老板」）
      const owners = (db.coStores || []).filter((c) =>
        (c.store_id && c.store_id === a.partner_id) ||
        (c.storeManagerId && c.storeManagerId === a.partner_id) ||
        (c.owners && c.owners.some((x) => x.id === a.partner_id)));
      return {
        id: a.partner_id,
        name: `脑商线下店${o ? o.name : a.partner_id}店`,
        address: (db.stores && db.stores[a.partner_id] && db.stores[a.partner_id].address) || '',
        contact: o ? o.phone : '',
        version: 1,
        regionCode: a.region_code || '',
        // ── 新增：合店相关展示字段 ──
        costoreOwnerCount: owners.length,
        costoreOwnerLimit: RA.STORE_OWNER_COUNT,
        costoreMonthlyFee: costoreFee,
        costoreMonthlyFeeLabel: `¥${costoreFee}/月`,
      };
    });
    return ok(200, { items, hasMore: false, nextCursor: null });
  }
```
</details>

## 213. 合伙人查询接口
`GET http://localhost:3000/partner/superior`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:772`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/superior' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    const u = db.users[c.userId];
    const up = u && u.upline_id ? db.users[u.upline_id] : null;
    return ok(200, { items: [], superior: up ? { name: up.name, phone: up.phone, levelLabel: up.tier, scopeLabel: '' } : null });
  }
```
</details>

## 214. 业务查询接口
`GET http://localhost:3000/promotion/share-code`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:778`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|contextId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/promotion/share-code' && m === 'GET') {
    const c = needCtx(); if (!c.userId) return c;
    const u = db.users[c.userId];
    const inviteCode = u.phone || u.id;
    return ok(200, { accountId: c.userId, contextId: q('contextId'), promotionId: 'promo-' + c.userId, inviteCode, qrUrl: `https://h5.naoshang.example.com/qr/${inviteCode}`, posterUrl: `https://h5.naoshang.example.com/poster/${inviteCode}`, shareUrl: `https://h5.naoshang.example.com/?invite=${inviteCode}` });
  }
  // ── P1-8 两套邀请码：注册邀请码（拉新→绑推荐人）/ 代理归属码（申请代理→绑归属代理） ──
```
</details>

## 215. P1-8 两套邀请码：注册邀请码（拉新→绑推荐人）/ 代理归属码（申请代理→绑归属代理）
`GET http://localhost:3000/me/invite-codes`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:785`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|type|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/me/invite-codes' && m === 'GET') {
    const c = needCtx(); if (!c.userId) return c;
    const type = q('type') || null;
    const list = IC.listMyCodes(db, c.userId, type).map(IC.publicCode);
    return ok(200, { items: list, hasMore: false, nextCursor: null, types: IC.VALID_TYPES.map((t) => ({ id: t, label: t === 'register' ? '注册邀请码' : '代理归属码' })) });
  }
```
</details>

## 216. 个人中心操作接口
`POST http://localhost:3000/me/invite-codes`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:791`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|type|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|maxUse|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|ttlDays|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "type": "示例值",
  "maxUse": "示例值",
  "ttlDays": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/me/invite-codes' && m === 'POST') {
    const b = await readBody(req);
    const c = needCtx(); if (!c.userId) return c;
    const type = b.type || 'register';
    const cfg = (S.getSettings(db) || {}).inviteCode || {};
    if (type === 'register' && cfg.registerEnabled === false) return fail(400, '注册邀请码当前未开放');
    if (type === 'agent' && cfg.agentEnabled === false) return fail(400, '代理归属码当前未开放');
    const maxUse = b.maxUse != null ? Number(b.maxUse) : (cfg.defaultMaxUse || 0);
    const ttlDays = b.ttlDays != null ? Number(b.ttlDays) : (cfg.ttlDays || 30);
    try {
      const rec = IC.generateInviteCode(db, { ownerId: c.userId, type, maxUse, ttlDays });
      save();
      return ok(201, { inviteCode: IC.publicCode(rec), shareUrl: `https://h5.naoshang.example.com/?invite=${rec.code}` });
    } catch (e) { return fail(400, e.message); }
  }
  // ── P1-7 合伙人成长阶梯 L1–L10（阶梯图坐标 + 晋升进度） ──
```
</details>

## 217. P1-7 合伙人成长阶梯 L1–L10（阶梯图坐标 + 晋升进度）
`GET http://localhost:3000/partner/ladder`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:807`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/ladder' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    const cfg = (S.getSettings(db) || {}).ladder || {};
    const overrides = Array.isArray(cfg.levels) && cfg.levels.length ? cfg.levels : null;
    const score = EXP.summary(db, c.userId).total;
    const chart = LAD.ladderChart(score, overrides);
    return ok(200, { ...chart, unit: cfg.unit || '成长积分', scoreSource: '累计经验值（1 元 = 1 积分）' });
  }
```
</details>

## 218. 合伙人查询接口
`GET http://localhost:3000/partner/global-awards`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:815`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/global-awards' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    const u = db.users[c.userId];
    const r = R.getCommissions(db, c.userId, { type: 'global' });
    const pool = db.commissions.filter((x) => x.type === 'global').reduce((s, x) => s + x.amount, 0);
    const items = r.list.map((x) => ({ month: x.period, eligibility: 'ELIGIBLE', amount: x.amount, weightedAmount: x.amount, performanceAmount: x.amount, salesAmount: x.base_amount, shareBps: Math.round((x.rate || 0) * 10000), people: 1, poolAmount: pool }));
    return ok(200, { eligibilityLabel: u.tier === 'cofounder' ? '符合全球奖资格' : '非联创无资格', metrics: [{ label: '你的全球奖', kind: 'money', value: r.total }, { label: '奖池总额', kind: 'money', value: round2(pool) }], summary: { total: r.total, pool: round2(pool) }, columns: [], items });
  }
```
</details>

## 219. 合伙人查询接口
`GET http://localhost:3000/partner/quota-ledger`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:823`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/quota-ledger' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    return ok(200, { standardRemaining: Q.getStandard(db.quotaLedger, c.userId), activityRemaining: Q.getActivity(db.quotaLedger, c.userId), items: [] });
  }
```
</details>

## 220. 合伙人查询接口
`GET http://localhost:3000/partner/quotas`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:827`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/quotas' && m === 'GET') return ok(200, { items: [], hasMore: false, nextCursor: null });
  // ── P0-1 经验值（原型屏 46/47：业务推广 / 购买产品 两个 Tab） ──
```
</details>

## 221. P0-1 经验值（原型屏 46/47：业务推广 / 购买产品 两个 Tab）
`GET http://localhost:3000/partner/experience-ledger`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:829`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|tab|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/experience-ledger' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    const tab = q('tab') && ['promotion', 'product'].includes(q('tab')) ? q('tab') : null;
    const r = EXP.ledger(db, c.userId, { tab });
    return ok(200, {
      promotionExperience: r.promotionExperience,
      productExperience: r.productExperience,
      total: r.total,
      tabs: r.tabs,
      metrics: [
        { label: '累计业务推广', kind: 'points', value: r.promotionExperience },
        { label: '累计购买产品', kind: 'points', value: r.productExperience },
      ],
      items: r.items, hasMore: false, nextCursor: null,
    });
  }
```
</details>

## 222. 合伙人查询接口
`GET http://localhost:3000/partner/experience/summary`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:845`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/experience/summary' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    const r = EXP.summary(db, c.userId);
    return ok(200, { promotionExperience: r.promotionExperience, productExperience: r.productExperience, total: r.total, count: r.count, rule: '标价多少加多少（1 元 = 1 经验值）' });
  }
  // ── P0-2 晋升/推广任务（原型屏 21/22：补差价直接晋升 / 推广达标免费晋升） ──
```
</details>

## 223. P0-2 晋升/推广任务（原型屏 21/22：补差价直接晋升 / 推广达标免费晋升）
`GET http://localhost:3000/partner/promotion-tasks`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:851`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/promotion-tasks' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    const u = db.users[c.userId] || {};
    const prog = EXP.progress(db, c.userId);
    const nextTier = S.FREE_UPGRADE_NEXT[u.tier] || null;
    // 补差价直接晋升的报价（本金锚点：目标档一口价 − 本金一口价）
    const principalPrice = C.RETAIL_PRICE[u.principal_tier || u.tier] || 0;
    const promotion = {
      beforeName: EXP.TIER_CN[u.tier] || u.tier,
      afterName: nextTier ? (EXP.TIER_CN[nextTier] || nextTier) : (EXP.TIER_CN[u.tier] || u.tier),
      beforeQuota: C.TIER_VIP[u.tier] || 0,
      afterQuota: nextTier ? (C.TIER_VIP[nextTier] || 0) : (C.TIER_VIP[u.tier] || 0),
      paidAmount: principalPrice,
      standardAmount: nextTier ? (C.RETAIL_PRICE[nextTier] || 0) : principalPrice,
      differenceAmount: nextTier ? Math.max(0, (C.RETAIL_PRICE[nextTier] || 0) - principalPrice) : 0,
      taskDescription: prog.text || '',
      progress: prog.items && prog.items.length ? Math.max(...prog.items.map((x) => x.percent)) : 0,
      target: prog.items && prog.items.length ? prog.items[0].required : 0,
      statusLabel: prog.statusLabel,
      validUntil: prog.validUntil || null,
      daysLeft: prog.daysLeft || 0,
      rule: prog.grantRule || null,
    };
    return ok(200, { items: prog.items || [], promotion, task: prog });
  }
  // ── 问题7：晋升领取接口（前端反馈：有 ACHIEVED/CLAIMED 状态却没说怎么领取）──
  //   GET  /partner/promotion-claims → 领取状态（是否达标、可否领取、已授档位）
  //   POST /partner/promotion-claims → 领取（达标即授级，幂等：重复领取返回同一结果）
```
</details>

## 224. POST /partner/promotion-claims → 领取（达标即授级，幂等：重复领取返回同一结果）
`GET http://localhost:3000/partner/promotion-claims`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:879`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/promotion-claims' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    const prog = EXP.progress(db, c.userId);
    const task = prog.taskId ? (db.promotionTasks || []).find((x) => x.id === prog.taskId) : null;
    const u = db.users[c.userId] || {};
    return ok(200, {
      taskId: prog.taskId || null,
      status: prog.status || 'NONE',          // ONGOING | ACHIEVED | CLAIMED | EXPIRED | NONE
      statusLabel: prog.statusLabel,
      achieved: !!prog.achieved,
      claimable: prog.status === 'ACHIEVED',  // 达标未领取 → 可领取
      claimed: prog.status === 'CLAIMED',
      grantedTier: task ? task.grantedTier : null,
      grantedTierLabel: task && task.grantedTier ? (EXP.TIER_CN[task.grantedTier] || task.grantedTier) : null,
      achievedAt: task ? task.achievedAt : null,
      claimedAt: task ? task.claimedAt : null,
      currentTier: u.tier,
      currentTierLabel: EXP.TIER_CN[u.tier] || u.tier,
      items: prog.items || [],
      validUntil: prog.validUntil || null,
      daysLeft: prog.daysLeft || 0,
      grantRule: prog.grantRule || null,
    });
  }
```
</details>

## 225. 合伙人操作接口
`POST http://localhost:3000/partner/promotion-claims`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:903`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|contextId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|contextId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### 请求 JSON 示例
```json
{
  "contextId": "有效资源ID"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/promotion-claims' && m === 'POST') {
    // contextId 可放 body 或 query（两种都支持，便于前端按习惯传）
    const b = await readBody(req);
    const cid = b.contextId || q('contextId');
    if (!cid) return fail(400, 'contextId 必填');
    const { userId, module: mod } = resolveContext(cid);
    if (!userId || !db.users[userId]) return fail(404, 'contextId 无效');
    if (mod && mod !== 'partner') return fail(400, 'contextId 与模块不匹配');
    const c = { userId };
    const prog = EXP.progress(db, c.userId);
    if (!prog.enabled) return fail(400, '晋升任务未开启');
    if (!prog.taskId) return fail(400, '尚未开通合伙人，无晋升任务');
    if (prog.status === 'CLAIMED') {
      // 幂等：已领取 → 直接返回当前结果，不重复授级
      const t = (db.promotionTasks || []).find((x) => x.id === prog.taskId);
      return ok(200, {
        status: 'CLAIMED', granted: false, alreadyClaimed: true,
        fromTier: t ? t.startTier : null, toTier: t ? t.grantedTier : null,
        taskId: prog.taskId, message: '该晋升已领取',
      });
    }
    if (!prog.achieved) return fail(400, '尚未达标，暂不可领取');
    let r;
    try {
      r = EXP.applyIfAchieved(db, c.userId);
    } catch (e) { return fail(400, `领取失败：${e.message}`); }
    save();
    const u = db.users[c.userId] || {};
    return ok(200, {
      status: r.status, granted: !!r.granted, alreadyClaimed: false,
      fromTier: r.fromTier || null, toTier: r.toTier || null,
      fromTierLabel: r.fromTier ? (EXP.TIER_CN[r.fromTier] || r.fromTier) : null,
      toTierLabel: r.toTier ? (EXP.TIER_CN[r.toTier] || r.toTier) : null,
      taskId: r.taskId || prog.taskId,
      note: r.note || null,
      currentTier: u.tier,
    });
  }
  // ── P0-7 分红业绩门槛与「当月无分红权」台账（原型屏 112） ──
```
</details>

## 226. P0-7 分红业绩门槛与「当月无分红权」台账（原型屏 112）
`GET http://localhost:3000/partner/dividend-rights`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:942`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|months|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|kind|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/dividend-rights' && m === 'GET') {
    const c = needCtx(); if (!c.userId) return c;
    const months = Math.max(1, Math.min(24, parseInt(q('months'), 10) || 6));
    const kind = q('kind') && ['memberCard', 'promotion'].includes(q('kind')) ? q('kind') : null;
    const h = DIV.history(db, c.userId, { months, kind });
    return ok(200, {
      prompt: DIV.currentPrompt(db, c.userId, kind || 'memberCard'),
      metrics: [
        { label: '分红合计', kind: 'money', value: h.summary.totalAmount },
        { label: '可提现分红', kind: 'money', value: h.summary.withdrawableAmount },
        { label: '无分红权（暂不可提现）', kind: 'money', value: h.summary.withheldAmount },
      ],
      threshold: S.getSettings(db).dividend,
      items: h.items, summary: h.summary,
    });
  }
  // ── P0-9 分配意愿规则（巡查 5% / 销售 5% 默认归属；改规则权限在总部后台） ──
```
</details>

## 227. P0-9 分配意愿规则（巡查 5% / 销售 5% 默认归属；改规则权限在总部后台）
`GET http://localhost:3000/partner/allocation-scheme`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:959`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/allocation-scheme' && m === 'GET') {
    return ok(200, { ...ALC.scheme(db), note: ALC.scheme(db).note });
  }
  // ── 问题6：bizType 字典 + 各类 bizDetail 结构 + allocationKind 字典 ──
  // ── 门店收益规则表（拨比表口径：门店收益随商品类型不同）+ 收益线分离字典 ──
```
</details>

## 228. 门店收益规则表（拨比表口径：门店收益随商品类型不同）+ 收益线分离字典
`GET http://localhost:3000/income/store-income-rules`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:964`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/income/store-income-rules' && m === 'GET') {
    return ok(200, {
      rules: SI.storeIncomeRuleTable(),
      incomeChannels: Object.values(SI.INCOME_CHANNEL),
      note: '门店收益随商品类型按拨比表规则计算（实物/软件卡=拿货差价，特色产品=比例分成池，行政费=5/5/90）；合店老板收益来自合店费入股分配，与门店卖货收益分属两条独立账，不可合并统计',
    });
  }
```
</details>

## 229. 业务查询接口
`GET http://localhost:3000/income/biz-types`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:971`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/income/biz-types' && m === 'GET') {
    return ok(200, BIZ.fullDictionary());
  }

  // ───────────────────────── §7 商城目录/详情/报价、§8 订单 ─────────────────────────
```
</details>

## 230. §7 商城目录/详情/报价、§8 订单
`GET http://localhost:3000/catalog`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:976`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/catalog' && m === 'GET') {
    // 展示层：前端商城需要的 id/title/summary/coverUrl/分类/金额(分)/会员价/规格/SKU/正文 + 三套价
    // + viewerPrice：按当前登录者身份（含孩子会员等级）算出的「你的成交价」
    return ok(200, { categories: CAT.CATEGORIES, items: CAT.buildCatalogItems(db, viewerOf(db, sess)) });
  }
```
</details>

## 231. + viewerPrice：按当前登录者身份（含孩子会员等级）算出的「你的成交价」
`GET http://localhost:3000/products/{动态路径}`
原始匹配：`p.startsWith('/products/') && m === 'GET'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:981`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.startsWith('/products/') && m === 'GET') {
    const id = p.slice('/products/'.length);
    const prod = CAT.buildProductItem(db, id, viewerOf(db, sess));
    if (!prod) return fail(404, '商品不存在');
    return ok(200, prod);
  }
```
</details>

## 232. 业务查询接口
`GET http://localhost:3000/checkout/options`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:987`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/checkout/options' && m === 'GET') {
    const uid = sess.role === 'user' ? sess.userId : null;
    // 门店来自区域代理（region_type='store'），与后台 /api/stores 同一口径
    const stores = db.regionalAgents
      .filter((a) => a.region_type === 'store')
      .map((a, i) => {
        const owner = db.users[a.partner_id] || {};
        return {
          id: a.region_code, regionCode: a.region_code,
          name: `脑商线下店${owner.name || a.partner_id}店`,
          number: 'NO.' + String(i + 1).padStart(4, '0'),
          address: '', managerName: owner.name || '', phone: owner.phone || '', coverUrl: '',
        };
      });
    return ok(200, {
      stores, defaultStoreId: stores.length ? stores[0].id : null, deliveryLocked: false,
      members: uid && Array.isArray(db.members) ? db.members.filter((mm) => mm.userId === uid).map((mm) => ({
        id: mm.id, name: mm.name, memberLevel: mm.memberLevel || 'normal',
        levelLabel: IZ.memberTierName(mm.memberLevel) || '普通会员',
        displayId: mm.display_id || null, gradeLabel: mm.gradeLabel || '', genderLabel: mm.genderLabel || '',
        avatarUrl: mm.avatarUrl || null,
      })) : [],
      addresses: uid ? B.listAddresses(db, uid).map((a) => ({ id: a.id, recipient: a.recipient, phone: a.phone, detail: a.detail, isDefault: a.isDefault })) : [],
      coupons: uid ? B.listCoupons(db, uid, 'available') : [],
    });
  }
```
</details>

## 233. 业务操作接口
`POST http://localhost:3000/checkout/quotes`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1013`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|productKey|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|productId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|quantity|number|条件/未显式声明|读取及校验规则见下方实现|1|
|skuId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|level|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|memberId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|storeId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|addressId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### 请求 JSON 示例
```json
{
  "productKey": "示例值",
  "productId": "有效资源ID",
  "quantity": 1,
  "skuId": "有效资源ID",
  "level": "示例值",
  "memberId": "有效资源ID",
  "storeId": "有效资源ID",
  "addressId": "有效资源ID"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/checkout/quotes' && m === 'POST') {
    const b = await readBody(req);
    try {
      const uid = sess.role === 'user' ? sess.userId : null;
      const buyer = uid ? db.users[uid] : null;
      const agentRec = uid ? S.getRegionalAgent(db, uid) : null;
      const cfg = (S.getSettings(db) || {}).pricing || {};
      const key = b.productKey || b.productId || 'pad';
      const qty = b.quantity || 1;
      // SKU（2026-10-27 库存台账）：命中规格 → 按该规格计价 + 校验库存；报价与下单用同一套规格
      const sku = b.skuId ? STK.skuById(db, b.skuId) : null;
      if (b.skuId && !sku) return fail(400, '规格不存在：' + b.skuId);
      if (sku && sku.productId && sku.productId !== key) return fail(400, '规格与商品不匹配');
      if (sku) STK.assertStock(db, sku.id, qty);
      // P1-9：按买家身份解析最终成交价（代理身份 > 合伙人档位 > 原价；与孩子的会员等级无关）
      const fp = sku
        ? PS.finalSkuPrice(key, sku, buyer, agentRec, qty, { dualDiscountEnabled: !!cfg.dualDiscountEnabled, level: b.level || null })
        : PS.finalPrice(key, buyer, agentRec, qty, { dualDiscountEnabled: !!cfg.dualDiscountEnabled, level: b.level || null });
      const dp = sku ? { list: sku.listPrice, member: fp.member, channel: fp.channel } : PS.dualPrice(key);
      const r2 = (n) => Math.round(n * 100) / 100;
      // ⚠️ 2026-10-28 修：报价必须与下单同口径，否则前端展示金额 ≠ 实际扣款金额。
      //   代理本人购买 AI软件卡（记忆卡）时按**固定拿货价**成交（省150/市170/区县250/单店350），
      //   此前报价走折扣口径、下单走拿货价，导致「报价 598.8 / 实付 300」。
      //   现统一调用 PS.payableAmountFor（与 routes.createProductOrder 同一函数）。
      const prodDef = PS.getProduct(key);
      const payable = PS.payableAmountFor(prodDef, agentRec, fp.unitPrice, qty);
      const unitPrice = r2(payable.applied.indexOf('agent_pick_price') === 0
        ? payable.amount / qty
        : fp.unitPrice);
      const payableAmount = payable.amount;
      const listAmount = r2(dp.list * qty);
      // 问题1：报价落库 → 提交时凭 quoteId 校验「用户确认的价格 / 有效期 / 商品组合」
      const quote = QT.issueQuote(db, {
        scene: QT.QUOTE_SCENES.CHECKOUT,
        userId: uid || 'anonymous',
        amount: payableAmount,
        breakdown: {
          goodsAmount: payableAmount,
          discountAmount: r2(listAmount - payableAmount),
          listAmount,
        },
        items: quoteItems(key, qty, sku ? sku.id : null),
        meta: { productKey: fp.key, level: b.level || null, memberId: b.memberId || null, skuId: sku ? sku.id : null, storeId: b.storeId || null, addressId: b.addressId || null, quantity: qty },
      });
      save();
      return ok(200, {
        id: quote.id,
        goodsAmount: payableAmount,
        discountAmount: r2(listAmount - payableAmount),
        payableAmount,
        expiresAt: quote.expiresAt, serverTime: nowMs(), ruleVersion: quote.ruleVersion,
        store: null, memberId: b.memberId || null,
        dualDiscountEnabled: !!cfg.dualDiscountEnabled,
        skuId: sku ? sku.id : null,
        product: {
          key: fp.key, name: fp.name, unitPrice, qty,
          listUnitPrice: dp.list, memberUnitPrice: dp.member, channelUnitPrice: dp.channel,
          appliedPriceKind: fp.applied,
        },
      });
    } catch (e) { return fail(400, e.message); }
  }
```
</details>

## 234. 订单操作接口
`POST http://localhost:3000/orders`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1075`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|buyerId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|productKey|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|productId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|quantity|number|条件/未显式声明|读取及校验规则见下方实现|1|
|qty|number|条件/未显式声明|读取及校验规则见下方实现|1|
|skuId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|level|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|memberId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|storeId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|quoteId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### 请求 JSON 示例
```json
{
  "buyerId": "有效资源ID",
  "productKey": "示例值",
  "productId": "有效资源ID",
  "quantity": 1,
  "qty": 1,
  "skuId": "有效资源ID",
  "level": "示例值",
  "memberId": "有效资源ID",
  "storeId": "有效资源ID",
  "quoteId": "有效资源ID"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/orders' && m === 'POST') {
    const b = await readBody(req);
    try {
      const buyerId = b.buyerId || (sess.role === 'user' ? sess.userId : b.buyerId);
      // ── 问题1：报价绑定提交 ──
      //  · 传了 quoteId → 必须校验通过（价格 / 有效期 / 商品组合 / 归属），并消费报价（一次性）
      //  · 没传 quoteId → 允许（兼容旧调用），但**金额一律服务端重算**，绝不采信客户端传的 payableAmount
      // ⚠️ 客户端传 payableAmount 只用于与报价比对，服务端始终用 PS.productPrice 重算。
      // ⚠️ 前端 createCheckoutOrder 只传 {quoteId, idempotencyKey}；商品/规格/数量/成员/门店从报价回填，
      //    否则 quoteItems 缺 skuId → checkQuote JSON.stringify 比对失败「商品/名额组合与报价不一致」。
      let orderKey = b.productKey || b.productId || null;
      let orderQty = (b.quantity != null ? b.quantity : (b.qty != null ? b.qty : null));
      let orderSkuId = b.skuId || null;
      let orderLevel = b.level || null;
      let memberIdIn = b.memberId || null;
      let orderStoreId = b.storeId || null;
      if (b.quoteId) {
        const q0 = (db.quotes || []).find((x) => x.id === b.quoteId);
        if (q0) {
          const qi = Array.isArray(q0.items) && q0.items[0] ? q0.items[0] : null;
          const qm = q0.meta || {};
          orderKey = orderKey || qm.productKey || (qi && qi.key) || null;
          if (orderQty == null) orderQty = (qi && qi.qty != null) ? qi.qty : (qm.quantity != null ? qm.quantity : null);
          orderSkuId = orderSkuId || qm.skuId || (qi && qi.skuId) || null;
          orderLevel = orderLevel || qm.level || null;
          memberIdIn = memberIdIn || qm.memberId || null;
          orderStoreId = orderStoreId || qm.storeId || null;
        }
      }
      orderKey = orderKey || 'pad';
      orderQty = orderQty != null ? orderQty : 1;
      // SKU（2026-10-27）：规格 id 贯穿报价→下单；库存校验与扣减在 createProductOrder 内完成
      const orderSku = orderSkuId ? STK.skuById(db, orderSkuId) : null;
      if (orderSkuId && !orderSku) return fail(400, '规格不存在：' + orderSkuId);
      if (orderSku && orderSku.productId && orderSku.productId !== orderKey) return fail(400, '规格与商品不匹配');
      let quoteRec = null;
      // 服务对象（孩子）——仅记录，不参与计价；报价与下单用同一个 memberId 即可
      if (b.quoteId) {
        const buyer = db.users[buyerId];
        const agentRec = buyerId ? db.regionalAgents.find((a) => a.partner_id === buyerId) : null;
        const cfg = (S.getSettings(db) || {}).pricing || {};
        const fp = orderSku
          ? PS.finalSkuPrice(orderKey, orderSku, buyer, agentRec, orderQty, { dualDiscountEnabled: !!cfg.dualDiscountEnabled, level: orderLevel || null })
          : PS.finalPrice(orderKey, buyer, agentRec, orderQty, { dualDiscountEnabled: !!cfg.dualDiscountEnabled, level: orderLevel || null });
        // ⚠️ 2026-10-28：与报价/实付同口径（代理本人买软件卡按固定拿货价），
        //   否则 serverAmount 与报价单金额不一致 → checkQuote 必然失败。
        const serverAmount = PS.payableAmountFor(PS.getProduct(orderKey), agentRec, fp.unitPrice, orderQty).amount;
        // 问题1：与其它 7 个提交端点保持一致 —— 先校验（不消费），业务成功后再消费。
        //   下单失败时报价仍然可用，避免"一次失败报价就白费"。
        quoteRec = QT.checkQuote(db, b.quoteId, {
          scene: QT.QUOTE_SCENES.CHECKOUT,
          userId: sess.role === 'user' ? sess.userId : buyerId,
          serverAmount,
          items: quoteItems(orderKey, orderQty, orderSku ? orderSku.id : null),
        });
      }
      // qty 显式传（不用 spread 里的 quantity/qty，避免与报价数量不一致）
      // storeId = 收银台选中的门店，**参与分润归属**（门店即「单店」获单店份额；
      //   省/市/区县份额归对应区域代理，与门店收益分开记账）。2026-10-27 口径已定。
      const r = R.createProductOrder(db, { ...b, buyerId, productKey: orderKey, qty: orderQty, skuId: orderSkuId || null, storeId: orderStoreId || null, memberId: memberIdIn });
      save();
      if (quoteRec) {
        // 业务已成功 → 此时才消费报价，并回填关联单号
        QT.markConsumed(db, quoteRec.id, { ref: (r.order && r.order.id) || (r.order_id) || null });
        save();
      }
      const order = r.order || r;
      return ok(200, {
        ok: true,
        // 问题2：统一给 id（后续查详情/发起支付/轮询都要用），同时保留 order_id 兼容旧字段
        id: order.id || order.order_id || null,
        orderId: order.id || order.order_id || null,
        order,
        quoteId: quoteRec ? quoteRec.id : (b.quoteId || null),
        quoteConsumed: !!quoteRec,
      });
    } catch (e) { return fail(400, e.message); }
  }
```
</details>

## 235. 订单查询接口
`GET http://localhost:3000/orders`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1153`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/orders' && m === 'GET') {
    OL.sweep(db);          // P0-5：惰性扫描，把已过支付时限的待支付单自动取消
    const rows = db.orders.filter((o) => o.type !== 'issue').map((o) => {
      OL.ensureAlive(db, o);
      const buyer = db.users[o.buyer_id] || {};
      return {
        ...o,
        buyer_name: buyer.name || o.buyer_id,
        status: o.status || 'PAID',
        statusLabel: OL.statusLabel(o),
        remainSeconds: OL.remainSeconds(o),
        delivery: OL.deliveryPayload(db, o),   // P0-6：交付模式 / 核销码 / 倒计时
      };
    });
    save();
    return ok(200, { items: rows, hasMore: false, nextCursor: null });
  }
  // 注意：/orders/{id}/payment-channels 是更长的路径，必须在此排除（见下方端点）
```
</details>

## 236. 注意：/orders/{id}/payment-channels 是更长的路径，必须在此排除（见下方端点）
`GET http://localhost:3000/orders/{动态路径}`
原始匹配：`p.startsWith('/orders/') && m === 'GET' && !/\/payment-channels$/.test(p)`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1171`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.startsWith('/orders/') && m === 'GET' && !/\/payment-channels$/.test(p)) {
    const id = p.slice('/orders/'.length);
    const o = db.orders.find((x) => (x.id === id) || (x.orderNo === id));
    if (!o) return fail(404, '订单不存在');
    OL.ensureAlive(db, o); save();
    const buyer = db.users[o.buyer_id] || {};
    return ok(200, {
      order: {
        ...o,
        buyer_name: buyer.name || o.buyer_id,
        statusLabel: OL.statusLabel(o),
        // 2026-10-27：按订单状态返回可用动作。
        //   此前无条件返回 ['pay','cancel']，导致前端对**已支付**订单也显示「取消订单」，
        //   用户点取消后钱不退、库存不回补（已取消的订单还会出现在列表里）。
        allowedActions: OL.allowedActions(o),
        remainSeconds: OL.remainSeconds(o),
        delivery: OL.deliveryPayload(db, o),   // P0-6
      }, serverTime: nowMs(),
    });
  }
  // ── P0-5 待支付订单支付成功：放行分润（createProductOrder 挂起的 commission_rows 落账） ──
  // 问题2：统一为「发起支付」语义，并保留旧契约字段（orderId/status/releasedCommissions/delivery）：
  //   · sandbox：支付直通 → 标记订单已付 + 放行分润 → 返回 SUCCEEDED
  //   · live   ：创建支付单 → 返回 CREATED + payParams（前端调起渠道），由 /payments/notify/{channel} 回调入账
```
</details>

## 237. · live   ：创建支付单 → 返回 CREATED + payParams（前端调起渠道），由 /payments/notify/{channel} 回调入账
`POST http://localhost:3000/{动态路径}`
原始匹配：`p.match(/\/orders\/[^/]+\/payment$/) && m === 'POST'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1195`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|channel|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|paymentId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|idempotencyKey|JSON|条件/未显式声明|读取及校验规则见下方实现|request-20261029-001|

### 请求 JSON 示例
```json
{
  "channel": "示例值",
  "paymentId": "有效资源ID",
  "idempotencyKey": "request-20261029-001"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.match(/\/orders\/[^/]+\/payment$/) && m === 'POST') {
    const id = p.split('/')[2];
    const b = await readBody(req);
    const o = db.orders.find((x) => (x.id === id) || (x.orderNo === id));
    if (!o) return fail(404, '订单不存在');
    if (sess.role === 'user' && o.buyer_id && o.buyer_id !== sess.userId) return fail(403, '无权支付该订单');
    const channel = b.channel || 'wechat';
    if (!PAY.channelsFor('product_order').includes(channel)) {
      return fail(400, `该订单不支持 ${PAY.channelName(channel)}（可用：${PAY.channelsFor('product_order').map(PAY.channelName).join('、')}）`);
    }
    const amount = OL.orderAmount(o);
    if (!(amount > 0)) return fail(400, '订单金额无效，无法发起支付');

    // ── 旧路径：订单本就是「待支付」态 → 直接标记已付并放行分润（保持原行为）──
    if (OL.isPending(o) && PAY.IS_SANDBOX && !b.paymentId) {
      OL.markPaid(o);
      const released = R.releaseProductCommissions(db, o);
      save();
      return ok(200, {
        id: o.id, orderId: o.id, status: 'paid', releasedCommissions: released.length,
        delivery: OL.deliveryPayload(db, o),
        paymentMode: PAY.PAYMENT_MODE, channel, amount,
        payParams: PAY.buildPayParams(channel, o),
      });
    }

    // ── 通用路径：创建支付单（幂等键冲突 → 409）──
    let created;
    try {
      created = PAY.createPayment(db, {
        bizType: 'product_order', bizId: o.id, userId: o.buyer_id || sess.userId || 'unknown',
        amount, channel, idempotencyKey: b.idempotencyKey, meta: { orderId: o.id },
      });
    } catch (e) { return failErr(e, 400); }
    let released = 0;
    if (created.paid && !created.duplicated) {
      // sandbox：支付单直通 → 标记订单已付 + 放行分润
      if (OL.isPending(o)) { OL.markPaid(o); released = R.releaseProductCommissions(db, o).length; }
    }
    save();
    return ok(200, {
      // 问题2：必须带 id / paymentId（后续 GET /payments/attempts/{id} 轮询用）
      id: created.payment.id, paymentId: created.payment.id,
      orderId: o.id, status: created.paid ? 'SUCCEEDED' : 'CREATED',
      releasedCommissions: released,
      delivery: OL.deliveryPayload(db, o),
      // 幂等命中时回显支付单实际渠道（而非本次请求渠道）
      paymentMode: PAY.PAYMENT_MODE, channel: created.payment.channel,
      channelName: PAY.channelName(created.payment.channel), amount,
      // 问题2：payParams 始终返回（sandbox 下标明 autoPay 直通），前端结构一致
      payParams: created.payParams,
    });
  }
  // 订单动作端点。
  //   规范路径用复数名词（REST 风格）：/cancellations、/receipts。
  //   ⚠️ 同时兼容前端历史写法 /cancel、/confirm-receipt ——
  //   小程序侧 commerce.js 的 changeOrder(action) 直接把 action 拼进路径，
  //   两边命名不一致时按钮能显示（后端 allowedActions 给的）但一点就 404，
  //   属于最难自查的一类前后端没接上。两条路径都收，行为完全一致。
```
</details>

## 238. 属于最难自查的一类前后端没接上。两条路径都收，行为完全一致。
`POST http://localhost:3000/{动态路径}`
原始匹配：`p.match(/\/orders\/[^/]+\/(cancellations|cancel)$/) && m === 'POST'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1254`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### 请求 JSON 示例
```json
{}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.match(/\/orders\/[^/]+\/(cancellations|cancel)$/) && m === 'POST') {
    const id = p.split('/')[2];
    const o = db.orders.find((x) => x.id === id); if (!o) return fail(404, '订单不存在');
    // 统一走 orderLifecycle.cancel：它内置「已支付订单不可取消，请走退款」的保护。
    //   （2026-10-27 修复：本端点曾自行改 status，绕过了该保护 → 已付款订单能被
    //     取消，钱不退、库存不回补，形成资损风险。）
    // 取消前先记录原状态：cancel() 会把 status 改成 CANCELLED，之后就判断不出是否待支付了。
    const wasPending = OL.isPending(o) || ['pending', 'UNPAID', 'CREATED'].includes(o.status);
    try {
      OL.cancel(o, { reason: 'USER_CANCEL', operatorId: sess && sess.userId ? sess.userId : null });
    } catch (e) {
      return fail(400, e.message);
    }
    // 只有"未支付"的订单才回补库存（已支付的货已卖出，回补会造成超卖）
    if (wasPending) STK.restoreStockForOrder(db, o);   // SKU 库存回补（幂等）
    save();
    return ok(200, { order: o });
  }
```
</details>

## 239. SKU 库存回补（幂等）
`POST http://localhost:3000/{动态路径}`
原始匹配：`p.match(/\/orders\/[^/]+\/(receipts|confirm-receipt)$/) && m === 'POST'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1272`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### 请求 JSON 示例
```json
{}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.match(/\/orders\/[^/]+\/(receipts|confirm-receipt)$/) && m === 'POST') {
    const id = p.split('/')[2];
    const o = db.orders.find((x) => x.id === id); if (!o) return fail(404, '订单不存在');
    o.status = 'COMPLETED'; o.fulfillmentStatus = 'DELIVERED'; return ok(200, { order: o });
  }
  // P2-3（2026-10-26）：支付发起统一走支付模块 —— sandbox 直通 SUCCEEDED 并放行分润；
  //   live 返回 CREATED + payParams（前端调起渠道），由 POST /payments/notify/{channel} 回调入账。
```
</details>

## 240. live 返回 CREATED + payParams（前端调起渠道），由 POST /payments/notify/{channel} 回调入账。
`POST http://localhost:3000/payments/attempts`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1279`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|orderId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|channel|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|amount|number|条件/未显式声明|读取及校验规则见下方实现|1|
|idempotencyKey|JSON|条件/未显式声明|读取及校验规则见下方实现|request-20261029-001|

### 请求 JSON 示例
```json
{
  "orderId": "有效资源ID",
  "channel": "示例值",
  "amount": 1,
  "idempotencyKey": "request-20261029-001"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/payments/attempts' && m === 'POST') {
    const b = await readBody(req);
    const orderId = b.orderId;
    const o = db.orders.find((x) => x.id === orderId) || (db.orders.find((x) => x.orderNo === orderId) || null);
    const channel = b.channel || 'wechat';
    if (!PAY.channelsFor('product_order').includes(channel)) {
      return fail(400, `该订单不支持 ${PAY.channelName(channel)}（可用：${PAY.channelsFor('product_order').map(PAY.channelName).join('、')}）`);
    }
    const amount = o ? OL.orderAmount(o) : Number(b.amount || 0);
    if (!(amount > 0)) return fail(400, '订单金额无效，无法发起支付');
    let created;
    try {
      created = PAY.createPayment(db, {
        bizType: 'product_order', bizId: o ? o.id : null,
        userId: o ? o.buyer_id : (sess.userId || 'unknown'),
        amount, channel, idempotencyKey: b.idempotencyKey,
        meta: { orderId: o ? o.id : orderId },
      });
    } catch (e) { return failErr(e, 400); }
    if (created.paid) {
      // sandbox：支付即入账。applyBizEffect 负责标记订单已付并放行挂起的分润台账。
      const effect = created.duplicated ? null : PAY.applyBizEffect(db, created.payment);
      save();
      return ok(200, {
        id: created.payment.id, paymentId: created.payment.id, orderId: o ? o.id : orderId, status: 'SUCCEEDED',
        channel: created.payment.channel, channelName: PAY.channelName(created.payment.channel), amount, paymentMode: PAY.PAYMENT_MODE,
        releasedCommissions: effect && effect.kind === 'product_order' ? effect.releasedCommissions : 0,
        delivery: o ? OL.deliveryPayload(db, o) : null,
        // 问题2：payParams 始终返回（sandbox 下标明 autoPay 直通），前端结构一致
        payParams: created.payParams,
      });
    }
    save();
    return ok(200, {
      id: created.payment.id, paymentId: created.payment.id, orderId: o ? o.id : orderId, status: 'CREATED',
      channel: created.payment.channel, channelName: PAY.channelName(created.payment.channel), amount, paymentMode: PAY.PAYMENT_MODE,
      payParams: created.payParams,
    });
  }
```
</details>

## 241. 支付查询接口
`GET http://localhost:3000/payments/attempts/{动态路径}`
原始匹配：`p.startsWith('/payments/attempts/') && m === 'GET'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1318`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.startsWith('/payments/attempts/') && m === 'GET') {
    const id = p.slice('/payments/attempts/'.length);
    const pmt = PAY.getPayment(db, id);
    if (!pmt) return fail(404, '支付单不存在');
    const o = pmt.meta && pmt.meta.orderId ? db.orders.find((x) => x.id === pmt.meta.orderId) : null;
    return ok(200, {
      id: pmt.id, orderId: pmt.meta && pmt.meta.orderId ? pmt.meta.orderId : null,
      status: pmt.status, channel: pmt.channel, channelName: PAY.channelName(pmt.channel),
      amount: pmt.amount, paymentMode: PAY.PAYMENT_MODE,
      paidAt: pmt.paidAt ? new Date(pmt.paidAt).toISOString() : null,
      delivery: o ? OL.deliveryPayload(db, o) : null,
    });
  }
  // ── 问题2：文档里写了但代码里缺失的端点（补齐，前端按文档调用即可）──
  //   GET /orders/{id}/payment-channels → 该订单可用的支付渠道
  //   （POST /orders/{id}/payment 见上方 P0-5 端点，已统一为「发起支付」语义）
```
</details>

## 242. （POST /orders/{id}/payment 见上方 P0-5 端点，已统一为「发起支付」语义）
`GET http://localhost:3000/{动态路径}`
原始匹配：`p.match(/^\/orders\/[^/]+\/payment-channels$/) && m === 'GET'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1334`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.match(/^\/orders\/[^/]+\/payment-channels$/) && m === 'GET') {
    const orderId = p.split('/')[2];
    const o = db.orders.find((x) => x.id === orderId) || db.orders.find((x) => x.orderNo === orderId);
    if (!o) return fail(404, '订单不存在');
    const items = PAY.channelsFor('product_order').map((c) => ({
      id: c, label: PAY.channelName(c),
      kind: c === 'wechat' ? 'WECHAT' : c === 'alipay' ? 'ALIPAY' : c === 'unionpay' ? 'UNIONPAY' : 'BANK_CARD',
    }));
    return ok(200, {
      items, orderId: o.id, orderNo: o.orderNo || o.order_no || null,
      amount: OL.orderAmount(o),
      paymentMode: PAY.PAYMENT_MODE,
      note: PAY.IS_SANDBOX ? 'sandbox：支付直通，提交即入账' : 'live：提交后返回 payParams，前端调起渠道支付',
    });
  }
```
</details>

## 243. 专栏查询接口
`GET http://localhost:3000/columns`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1349`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/columns' && m === 'GET') {
    // 专栏列表（目录页用）：与商城目录、激活码种子三处同 id
    const uid = sess && sess.role === 'user' ? sess.userId : null;
    const me = uid ? db.users[uid] : null;
    const items = COLS.columnList(db).map((c) => {
      const unlocked = !!(me && (me.unlockedColumns || []).includes(c.id));
      const item = CAT.columnItem(db, c);
      return { id: c.id, title: c.title, summary: c.summary || '', coverUrl: item.coverUrl, price: item.prices ? item.prices.list : 0, unlocked, chapterCount: (c.chapters || []).length };
    });
    return ok(200, { items, hasMore: false, nextCursor: null });
  }
```
</details>

## 244. 专栏查询接口
`GET http://localhost:3000/columns/{动态路径}`
原始匹配：`p.startsWith('/columns/') && m === 'GET'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1360`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|memberId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|contextId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|contextId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.startsWith('/columns/') && m === 'GET') {
    const id = p.slice('/columns/'.length);
    const col = COLS.columnById(db, id);
    if (!col) return fail(404, '专栏不存在');
    const memberId = q('memberId');
    let unlocked = false;
    const me = sess && sess.userId ? db.users[sess.userId] : null;
    if (me && (me.unlockedColumns || []).includes(id)) unlocked = true;
    if (memberId) { const mm = db.members.find((x) => x.id === memberId); if (mm && (mm.unlockedColumns || []).includes(id)) unlocked = true; }
    return ok(200, {
      product: CAT.columnItem(db, col),
      unlocked,
      chapters: (col.chapters || []).map((c) => ({ id: c.id, title: c.title, type: c.type })),
    });
  }

  // ───────────────────────── §10 经营操作（三段式） ─────────────────────────
  const opCtx = async () => {
    const b = await readBody(req);
    // contextId 支持 body 或 query 两种传法（前端按习惯放哪个都能用）
    const cid = b.contextId || q('contextId');
    if (!cid) return { err: fail(400, 'contextId 必填') };
    const { userId, module } = resolveContext(cid);
    if (!userId || !db.users[userId]) return { err: fail(404, 'contextId 无效') };
    return { userId, b: { ...b, contextId: cid } };
  };
  // 年度权益（契约 §15：金额待业务确认，先以暂行值实现三段式）
  const ANNUAL_FEE = { amount: 1980, months: 12, note: '金额为暂行值，待业务确认后调整（见契约 §15）' };
```
</details>

## 245. 年度权益（契约 §15：金额待业务确认，先以暂行值实现三段式）
`GET http://localhost:3000/partner/entitlement-options`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1388`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/entitlement-options' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    const u = db.users[c.userId];
    return ok(200, {
      plans: [{ id: 'annual', label: '年度权益（12 个月）', amount: ANNUAL_FEE.amount, months: ANNUAL_FEE.months, note: ANNUAL_FEE.note }],
      currentPaid: !!u.annual_fee_paid,
      currentExpiresAt: u.annual_paid_at ? new Date(u.annual_paid_at + 365 * 86400000).toISOString() : null,
      allowedActions: ['quote', 'submit'],
      allowedPaymentChannelIds: PAY.channelsFor('annual_fee'), paymentMode: PAY.PAYMENT_MODE,
    });
  }
```
</details>

## 246. 合伙人操作接口
`POST http://localhost:3000/partner/entitlement-quotes`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1399`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|planId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|contextId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### 请求 JSON 示例
```json
{
  "planId": "有效资源ID",
  "contextId": "有效资源ID"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/entitlement-quotes' && m === 'POST') {
    const o = await opCtx(); if (o.err) return o.err;
    if ((o.b.planId || 'annual') !== 'annual') return fail(400, '未知套餐（当前仅 annual）');
    // 问题1：报价落库 → 提交时凭 quoteId 校验价格/有效期/套餐
    let quote;
    try {
      quote = QT.issueQuote(db, {
        scene: QT.QUOTE_SCENES.ENTITLEMENT,
        userId: o.userId,
        amount: ANNUAL_FEE.amount,
        breakdown: { months: ANNUAL_FEE.months },
        items: [{ key: 'annual', qty: 1 }],
        meta: { planId: 'annual' },
      });
    } catch (e) { return fail(400, e.message); }
    save();
    return ok(200, { id: quote.id, contextId: o.b.contextId, planId: 'annual', amount: ANNUAL_FEE.amount, months: ANNUAL_FEE.months, note: ANNUAL_FEE.note, expiresAt: quote.expiresAt, serverTime: nowMs(), ruleVersion: quote.ruleVersion });
  }
```
</details>

## 247. 合伙人操作接口
`POST http://localhost:3000/partner/entitlement-orders`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1417`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|channel|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|quoteId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|idempotencyKey|JSON|条件/未显式声明|读取及校验规则见下方实现|request-20261029-001|

### 请求 JSON 示例
```json
{
  "channel": "示例值",
  "quoteId": "有效资源ID",
  "idempotencyKey": "request-20261029-001"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/entitlement-orders' && m === 'POST') {
    const o = await opCtx(); if (o.err) return o.err;
    const channel = o.b.channel || 'wechat';
    // 问题1：提交时凭 quoteId 校验（价格服务端重算、有效期、归属、一次性）
    // 顺序：先校验 → 建支付单 → 成功后再消费报价（业务失败不浪费报价）
    let quoteRec = null;
    if (o.b.quoteId) {
      try {
        quoteRec = QT.checkQuote(db, o.b.quoteId, {
          scene: QT.QUOTE_SCENES.ENTITLEMENT, userId: o.userId,
          serverAmount: ANNUAL_FEE.amount, items: [{ key: 'annual', qty: 1 }],
        });
      } catch (e) { return fail(400, e.message); }
    }
    let created;
    try {
      created = PAY.createPayment(db, { bizType: 'annual_fee', userId: o.userId, amount: ANNUAL_FEE.amount, channel, idempotencyKey: o.b.idempotencyKey, meta: { months: ANNUAL_FEE.months } });
    } catch (e) { return fail(400, e.message); }
    if (quoteRec) { QT.markConsumed(db, quoteRec.id, { ref: created.payment.id }); }
    if (created.paid) {
      const effect = created.duplicated ? null : PAY.applyBizEffect(db, created.payment);
      save();
      const uu = db.users[o.userId];
      return ok(200, { status: 'SUCCEEDED', operationId: created.payment.id, paymentId: created.payment.id, channel: created.payment.channel, orderId: effect ? effect.orderId : null, validUntil: uu.annual_paid_at ? new Date(uu.annual_paid_at + 365 * 86400000).toISOString() : null, note: ANNUAL_FEE.note });
    }
    save();
    return ok(200, { status: 'CREATED', paymentId: created.payment.id, channel: created.payment.channel, channelName: PAY.channelName(created.payment.channel), amount: ANNUAL_FEE.amount, payParams: created.payParams });
  }
```
</details>

## 248. 合伙人查询接口
`GET http://localhost:3000/partner/quota-purchase-options`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1445`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/quota-purchase-options' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    return ok(200, { unitAmount: C.WHOLESALE_PER_QUOTA.cofounder, purchaseMode: 'PAYMENT', pricingLabel: '联创名额进货价（按联创本档价 6500 · 银联支付）', allowedPaymentChannelIds: PAY.channelsFor('quota_purchase'), allowedActions: ['quote', 'submit'], standardRemaining: Q.getStandard(db.quotaLedger, c.userId), activityRemaining: Q.getActivity(db.quotaLedger, c.userId), paymentMode: PAY.PAYMENT_MODE });
  }
```
</details>

## 249. 合伙人操作接口
`POST http://localhost:3000/partner/quota-purchase-quotes`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1449`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|userId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|quantity|number|条件/未显式声明|读取及校验规则见下方实现|1|
|contextId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### 请求 JSON 示例
```json
{
  "userId": "有效资源ID",
  "quantity": 1,
  "contextId": "有效资源ID"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/quota-purchase-quotes' && m === 'POST') {
    const o = await opCtx(); if (o.err) return o.err;
    const qty = Math.max(1, parseInt(o.b.userId || o.b.quantity, 10) || 1);
    const amount = round2(C.WHOLESALE_PER_QUOTA.cofounder * qty);
    // 问题1：报价落库（含数量组合，提交时校验数量被篡改）
    let quote;
    try {
      quote = QT.issueQuote(db, {
        scene: QT.QUOTE_SCENES.QUOTA_PURCHASE,
        userId: o.userId,
        amount,
        breakdown: { unitAmount: C.WHOLESALE_PER_QUOTA.cofounder, quantity: qty },
        items: [{ key: 'quota', qty }],
        meta: { quantity: qty },
      });
    } catch (e) { return fail(400, e.message); }
    save();
    return ok(200, { id: quote.id, contextId: o.b.contextId, unitAmount: C.WHOLESALE_PER_QUOTA.cofounder, quantity: qty, amount, expiresAt: quote.expiresAt, serverTime: nowMs(), ruleVersion: quote.ruleVersion });
  }
```
</details>

## 250. 合伙人操作接口
`POST http://localhost:3000/partner/quota-orders`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1468`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|quantity|number|条件/未显式声明|读取及校验规则见下方实现|1|
|channel|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|quoteId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|idempotencyKey|JSON|条件/未显式声明|读取及校验规则见下方实现|request-20261029-001|

### 请求 JSON 示例
```json
{
  "quantity": 1,
  "channel": "示例值",
  "quoteId": "有效资源ID",
  "idempotencyKey": "request-20261029-001"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/quota-orders' && m === 'POST') {
    const o = await opCtx(); if (o.err) return o.err;
    const qty = Math.max(1, parseInt(o.b.quantity, 10) || 1);
    const channel = o.b.channel || 'unionpay';   // 联创向总部购买名额：银联
    const amount = round2(C.WHOLESALE_PER_QUOTA.cofounder * qty);
    // 问题1：先校验报价 → 建支付单 → 成功后消费报价
    let quoteRec = null;
    if (o.b.quoteId) {
      try {
        quoteRec = QT.checkQuote(db, o.b.quoteId, {
          scene: QT.QUOTE_SCENES.QUOTA_PURCHASE, userId: o.userId,
          serverAmount: amount, items: [{ key: 'quota', qty }],
        });
      } catch (e) { return fail(400, e.message); }
    }
    let created;
    try {
      created = PAY.createPayment(db, { bizType: 'quota_purchase', userId: o.userId, amount, channel, idempotencyKey: o.b.idempotencyKey, meta: { quantity: qty } });
    } catch (e) { return fail(400, e.message); }
    if (quoteRec) { QT.markConsumed(db, quoteRec.id, { ref: created.payment.id }); }
    if (created.paid) {
      if (!created.duplicated) PAY.applyBizEffect(db, created.payment);
      save();
      return ok(200, { status: 'SUCCEEDED', operationId: created.payment.id, paymentId: created.payment.id, channel: created.payment.channel, quantity: qty, balances: { standardRemaining: Q.getStandard(db.quotaLedger, o.userId), activityRemaining: Q.getActivity(db.quotaLedger, o.userId) }, note: created.payment.note });
    }
    save();
    return ok(200, { status: 'CREATED', paymentId: created.payment.id, channel: created.payment.channel, channelName: PAY.channelName(created.payment.channel), amount, quantity: qty, payParams: created.payParams });
  }
```
</details>

## 251. 合伙人查询接口
`GET http://localhost:3000/partner/upgrade-options`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1496`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/upgrade-options' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    const u = db.users[c.userId] || {};
    const base = u.principal_tier || u.tier || 'none';   // 本金锚点：升级价以本金档为减数
    const basePrice = C.RETAIL_PRICE[base] || 0;
    const rank = S.TIER_RANK;
    // P0-3/P0-4：升级服务费单价（后台可配）+ 升级时上级可用活动名额（决定本单是否产生服务费）
    const qCfg = Q.resolveConfig((S.getSettings(db) || {}).quota || {});
    const seller = u.upline_id ? db.users[u.upline_id] : null;
    const sellerActivity = seller ? Q.getActivity(db.quotaLedger, seller.id) : 0;
    const sellerStandard = seller ? Q.getStandard(db.quotaLedger, seller.id) : 0;
    const upgradePlans = ['vip', 'angel', 'private', 'cofounder']
      .filter((t) => (rank[t] || 0) > (rank[u.tier] || 0))
      .map((t) => {
        const quotaCount = Math.max(0, (C.TIER_VIP[t] || 0) - (C.TIER_VIP[u.tier] || 0));
        // 预览：上级先扣活动名额（先过期先扣）→ 活动名额不足部分走标准
        const usedActivity = Math.min(quotaCount, qCfg.activityValidForUpgrade ? sellerActivity : 0);
        const usedStandard = quotaCount - usedActivity;
        const serviceFee = usedActivity * qCfg.serviceFeePerActivity;
        const partnerFee = Math.max(0, (C.RETAIL_PRICE[t] || 0) - basePrice);
        return {
          from: base, to: t,
          amount: partnerFee,
          // P0-1：名额消耗按「目标档名额 − 当前档名额」的**增量**计；
          //   普通用户（none=0 名额）升 VIP 合伙人只消耗 1 个名额（不按整包 2 个计）
          quotaCount,
          currentTierQuota: C.TIER_VIP[u.tier] || 0,
          targetTierQuota: C.TIER_VIP[t] || 0,
          principalDeducted: basePrice,
          // P0-4 服务费明细（原型屏 36「服务费明细」）
          usedActivityQuota: usedActivity,
          usedStandardQuota: usedStandard,
          serviceFee,
          serviceFeePerActivity: qCfg.serviceFeePerActivity,
          totalPayable: C.round2(partnerFee + serviceFee),
          label: `${EXP.TIER_CN[u.tier] || u.tier} → ${EXP.TIER_CN[t] || t}`,
        };
      });
    return ok(200, {
      members: [], upgradePlans,
      principalTier: base, principal: basePrice, currentTier: u.tier,
      standardRemaining: Q.getStandard(db.quotaLedger, c.userId), activityRemaining: Q.getActivity(db.quotaLedger, c.userId),
      // P0-3/P0-4 余额与计价规则（原型屏 35/36：活动 VIP 余额 / 标准 VIP 余额 / 服务费计价规则）
      quotaBalances: { standard: Q.getStandard(db.quotaLedger, c.userId), activity: Q.getActivity(db.quotaLedger, c.userId) },
      serviceFeeRule: { perActivityQuota: qCfg.serviceFeePerActivity, standardQuotaFree: true, activityValidityDays: qCfg.activityValidityDays },
      sellerBalances: { standard: sellerStandard, activity: sellerActivity },
      pricingNote: '升级实付 = 目标档一口价 − 本金档一口价（非当前档）；名额按增量消耗',
    });
  }
```
</details>

## 252. 合伙人操作接口
`POST http://localhost:3000/partner/upgrade-quotes`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1545`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|targetLevel|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|targetAccountId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|contextId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### 请求 JSON 示例
```json
{
  "targetLevel": "示例值",
  "targetAccountId": "有效资源ID",
  "contextId": "有效资源ID"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/upgrade-quotes' && m === 'POST') {
    const o = await opCtx(); if (o.err) return o.err;
    const targetLevel = o.b.targetLevel || 'angel';
    const targetId = o.b.targetAccountId || o.userId;
    if (!db.users[targetId]) return fail(404, '目标用户不存在');
    // 计价与落账同源（upgradeService.quoteUpgrade），保证「报价 = 实收」
    let q, quote;
    try {
      q = US.quoteUpgrade(db, { targetAccountId: targetId, targetLevel });
      quote = QT.issueQuote(db, {
        scene: QT.QUOTE_SCENES.UPGRADE,
        userId: o.userId,
        amount: q.totalPayable,
        breakdown: {
          partnerFee: q.amount,          // 合伙人费（差价）
          serviceFee: q.serviceFeeEstimate, // 升级服务费（活动名额）
        },
        items: [{ key: targetLevel, qty: q.quotaCount }],
        meta: { targetLevel, targetAccountId: targetId },
      });
    } catch (e) { return fail(400, e.message); }
    save();
    return ok(200, {
      id: quote.id, contextId: o.b.contextId, targetLevel, targetAccountId: targetId,
      amount: q.amount, quotaCount: q.quotaCount, principalTier: q.principalTier, principal: q.principal,
      serviceFeePerActivity: q.serviceFeePerActivity, serviceFeeEstimate: q.serviceFeeEstimate,
      usedActivityQuota: q.usedActivityQuota, usedStandardQuota: q.usedStandardQuota,
      totalPayable: q.totalPayable,
      label: q.label,
      // 问题3：明确「差价 + 服务费合并为一张支付单」
      paymentNote: '差价与升级服务费合并为一张支付单（totalPayable）；名额扣减与等级授予在支付成功后执行',
      expiresAt: quote.expiresAt, serverTime: nowMs(), ruleVersion: quote.ruleVersion,
    });
  }
```
</details>

## 253. 合伙人操作接口
`POST http://localhost:3000/partner/upgrades`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1579`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|targetAccountId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|targetLevel|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|quoteId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|channel|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|idempotencyKey|JSON|条件/未显式声明|读取及校验规则见下方实现|request-20261029-001|

### 请求 JSON 示例
```json
{
  "targetAccountId": "有效资源ID",
  "targetLevel": "示例值",
  "quoteId": "有效资源ID",
  "channel": "示例值",
  "idempotencyKey": "request-20261029-001"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/upgrades' && m === 'POST') {
    const o = await opCtx(); if (o.err) return o.err;
    const targetId = o.b.targetAccountId || o.userId;
    const targetLevel = o.b.targetLevel || 'angel';
    if (!db.users[targetId]) return fail(404, '目标用户不存在');
    // ── 2026-10-26 对齐：授级通道与实时下单同口径 ──
    //  · 计价/落账统一走 upgradeService（与升级报价同源）
    //  · 问题3：live 模式先创建**一张**支付单（差价+服务费合并），支付成功后才扣名额+授级
    //           sandbox 模式下单直通，行为与原来完全一致（回归脚本不受影响）
    let q, quoteRec = null;
    try {
      q = US.quoteUpgrade(db, { targetAccountId: targetId, targetLevel });
      if (o.b.quoteId) {
        quoteRec = QT.checkQuote(db, o.b.quoteId, {
          scene: QT.QUOTE_SCENES.UPGRADE, userId: o.userId,
          serverAmount: q.totalPayable,
          items: [{ key: targetLevel, qty: q.quotaCount }],
        });
      }
    } catch (e) { return fail(400, e.message); }

    // ── live 模式：创建支付单，等支付成功回调后再落账 ──
    if (!PAY.IS_SANDBOX) {
      const channel = o.b.channel || 'wechat';
      let created;
      try {
        created = PAY.createPayment(db, {
          bizType: 'upgrade', userId: o.userId, amount: q.totalPayable, channel,
          idempotencyKey: o.b.idempotencyKey,
          subject: `合伙人升档 ${EXP.TIER_CN[q.oldTier] || q.oldTier} → ${EXP.TIER_CN[targetLevel] || targetLevel}`,
          meta: { targetAccountId: targetId, targetLevel },
        });
      } catch (e) { return fail(400, e.message); }
      if (quoteRec) { QT.markConsumed(db, quoteRec.id, { ref: created.payment.id }); }
      save();
      return ok(200, {
        status: created.paid ? 'SUCCEEDED' : 'CREATED',
        operationId: created.payment.id,
        paymentId: created.payment.id,
        channel: created.payment.channel,
        channelName: PAY.channelName(created.payment.channel),
        amount: q.totalPayable,
        breakdown: { partnerFee: q.amount, serviceFee: q.serviceFeeEstimate },
        targetLevel, targetAccountId: targetId,
        payParams: created.payParams,
        // 支付成功后才发生的动作（前端可据此提示用户）
        pendingEffects: ['扣减上级增量名额', '授予目标账号等级', '落供货链级差与平级奖台账'],
        balances: { standardRemaining: Q.getStandard(db.quotaLedger, o.userId), activityRemaining: Q.getActivity(db.quotaLedger, o.userId) },
        note: '请完成支付；支付成功后系统自动扣减名额并授予等级',
      });
    }

    // ── sandbox 模式：直通落账 ──
    let r;
    try {
      r = US.applyUpgrade(db, { targetAccountId: targetId, targetLevel });
    } catch (e) {
      return fail(400, `授级失败：${e.message}`);
    }
    save();
    if (quoteRec) { QT.markConsumed(db, quoteRec.id, { ref: r.orderId }); save(); }
    return ok(200, {
      status: 'SUCCEEDED', operationId: 'op_' + Math.random().toString(36).slice(2),
      orderId: r.orderId, balances: { standardRemaining: Q.getStandard(db.quotaLedger, o.userId), activityRemaining: Q.getActivity(db.quotaLedger, o.userId) },
      settlement: r.settlement,
    });
  }
```
</details>

## 254. 合伙人查询接口
`GET http://localhost:3000/partner/store-binding-options`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1646`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/store-binding-options' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    const stores = db.regionalAgents.filter((a) => a.region_type === 'store').map((a) => ({ id: a.partner_id, name: '门店' + a.region_code, regionCode: a.region_code }));
    return ok(200, { members: [], stores, headquarters: { id: 'HQ', name: '总部' } });
  }
```
</details>

## 255. 合伙人操作接口
`POST http://localhost:3000/partner/store-binding-quotes`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1651`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|targetAccountId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|storeId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|contextId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### 请求 JSON 示例
```json
{
  "targetAccountId": "有效资源ID",
  "storeId": "有效资源ID",
  "contextId": "有效资源ID"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/store-binding-quotes' && m === 'POST') {
    const o = await opCtx(); if (o.err) return o.err;
    const targetId = o.b.targetAccountId || o.userId;
    // 问题1：门店绑定报价落库（绑定动作免费，校验的是「绑定对象组合」）
    let quote;
    try {
      quote = QT.issueQuote(db, {
        scene: QT.QUOTE_SCENES.STORE_BINDING,
        userId: o.userId,
        amount: 0,
        breakdown: { storeId: o.b.storeId, targetAccountId: targetId },
        items: [{ key: 'store', qty: 1, storeId: o.b.storeId || null }],
        meta: { storeId: o.b.storeId || null, targetAccountId: targetId },
      });
    } catch (e) { return fail(400, e.message); }
    save();
    return ok(200, { id: quote.id, contextId: o.b.contextId, targetAccountId: targetId, storeId: o.b.storeId, amount: 0, expiresAt: quote.expiresAt, serverTime: nowMs(), ruleVersion: quote.ruleVersion });
  }
```
</details>

## 256. 合伙人操作接口
`POST http://localhost:3000/partner/store-bindings`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1669`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|targetAccountId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|storeId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|quoteId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### 请求 JSON 示例
```json
{
  "targetAccountId": "有效资源ID",
  "storeId": "有效资源ID",
  "quoteId": "有效资源ID"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/store-bindings' && m === 'POST') {
    const o = await opCtx(); if (o.err) return o.err;
    const targetId = o.b.targetAccountId || o.userId;
    const store = db.regionalAgents.find((a) => a.partner_id === o.b.storeId) || db.coStores.find((x) => x.store_id === o.b.storeId);
    const regionCode = store ? (store.region_code || o.b.storeId) : o.b.storeId;
    // 问题1：提交时校验报价（绑定对象组合必须与报价一致）
    let quoteRec = null;
    if (o.b.quoteId) {
      try {
        quoteRec = QT.checkQuote(db, o.b.quoteId, {
          scene: QT.QUOTE_SCENES.STORE_BINDING, userId: o.userId,
          serverAmount: 0,
          items: [{ key: 'store', qty: 1, storeId: o.b.storeId || null }],
        });
      } catch (e) { return fail(400, e.message); }
    }
    try {
      const r = S.appointAgent(db, { partnerId: targetId, regionType: 'store', regionCode });
      save();
      return ok(200, { status: 'SUCCEEDED', operationId: 'op_' + Math.random().toString(36).slice(2), agent: r });
    } catch (e) { return fail(400, e.message); }
  }
```
</details>

## 257. 合伙人查询接口
`GET http://localhost:3000/partner/quota-transfer-options`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1691`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/quota-transfer-options' && m === 'GET') {
    const c = needCtx('partner'); if (!c.userId) return c;
    const tree = R.getTeam(db, c.userId);
    const candidates = flatDownline(tree).map((n) => ({ id: n.id, name: n.name, phone: n.phone }));
    return ok(200, { fields: [{ key: 'targetAccountId', label: '接收人' }, { key: 'quantity', label: '数量' }], balances: { standardRemaining: Q.getStandard(db.quotaLedger, c.userId), activityRemaining: Q.getActivity(db.quotaLedger, c.userId) }, allowedActions: ['quote', 'submit'], candidates });
  }
```
</details>

## 258. 合伙人操作接口
`POST http://localhost:3000/partner/quota-transfer-quotes`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1697`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|quantity|number|条件/未显式声明|读取及校验规则见下方实现|1|
|targetAccountId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|contextId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### 请求 JSON 示例
```json
{
  "quantity": 1,
  "targetAccountId": "有效资源ID",
  "contextId": "有效资源ID"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/quota-transfer-quotes' && m === 'POST') {
    const o = await opCtx(); if (o.err) return o.err;
    const qty = Math.max(1, parseInt(o.b.quantity, 10) || 1);
    // 问题1：名额划转报价落库（校验「接收人 + 数量」组合）
    let quote;
    try {
      quote = QT.issueQuote(db, {
        scene: QT.QUOTE_SCENES.QUOTA_TRANSFER,
        userId: o.userId,
        amount: 0,
        breakdown: { quantity: qty, targetAccountId: o.b.targetAccountId || null },
        items: [{ key: 'quota', qty, targetAccountId: o.b.targetAccountId || null }],
        meta: { quantity: qty, targetAccountId: o.b.targetAccountId || null },
      });
    } catch (e) { return fail(400, e.message); }
    save();
    return ok(200, { id: quote.id, contextId: o.b.contextId, targetAccountId: o.b.targetAccountId, quantity: qty, senderBalanceAfter: Q.getStandard(db.quotaLedger, o.userId) - qty, expiresAt: quote.expiresAt, serverTime: nowMs(), ruleVersion: quote.ruleVersion });
  }
```
</details>

## 259. 合伙人操作接口
`POST http://localhost:3000/partner/quota-transfers`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1715`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|quantity|number|条件/未显式声明|读取及校验规则见下方实现|1|
|targetAccountId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|quoteId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### 请求 JSON 示例
```json
{
  "quantity": 1,
  "targetAccountId": "有效资源ID",
  "quoteId": "有效资源ID"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/quota-transfers' && m === 'POST') {
    const o = await opCtx(); if (o.err) return o.err;
    const qty = Math.max(1, parseInt(o.b.quantity, 10) || 1);
    const targetId = o.b.targetAccountId;
    if (!db.users[targetId]) return fail(404, '接收人不存在');
    // 问题1：提交时校验报价（接收人 + 数量组合必须与报价一致）
    let quoteRec = null;
    if (o.b.quoteId) {
      try {
        quoteRec = QT.checkQuote(db, o.b.quoteId, {
          scene: QT.QUOTE_SCENES.QUOTA_TRANSFER, userId: o.userId,
          serverAmount: 0,
          items: [{ key: 'quota', qty, targetAccountId: targetId || null }],
        });
      } catch (e) { return fail(400, e.message); }
    }
    if (Q.getStandard(db.quotaLedger, o.userId) < qty) return fail(400, '名额不足');
    Q.consumeQuota(db.quotaLedger, o.userId, qty, { prefer: 'standard' });
    Q.issueQuota(db.quotaLedger, targetId, qty, 'standard');
    save();
    if (quoteRec) { QT.markConsumed(db, quoteRec.id, { ref: targetId }); save(); }
    return ok(200, { status: 'SUCCEEDED', operationId: 'op_' + Math.random().toString(36).slice(2), balances: { senderRemaining: Q.getStandard(db.quotaLedger, o.userId), senderActivityRemaining: Q.getActivity(db.quotaLedger, o.userId), receiverRemaining: Q.getStandard(db.quotaLedger, targetId), receiverActivityRemaining: Q.getActivity(db.quotaLedger, targetId) } });
  }

  // ───────────────────────── §12 创始奖 / 合店申请 / 代理申请 ─────────────────────────
```
</details>

## 260. §12 创始奖 / 合店申请 / 代理申请
`GET http://localhost:3000/founder-awards`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1740`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/founder-awards' && m === 'GET') {
    const c = needCtx(); if (!c.userId) return c;
    const r = R.getCommissions(db, c.userId, { type: 'founding' });
    const items = r.list.map((x) => ({ id: x.id, title: '创始奖', amount: x.amount, createdAt: x.created_at, sourceOrder: x.ref_order_id || null }));
    return ok(200, { items, hasMore: false, nextCursor: null, monthTotal: r.total });
  }
```
</details>

## 261. 合店查询接口
`GET http://localhost:3000/costore/application-options`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1746`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/costore/application-options' && m === 'GET') return ok(200, { stores: [], durations: [{ id: '12', label: '12 个月', months: 12 }, { id: '24', label: '24 个月', months: 24 }], benefits: '合店老板权益', agreement: { version: 'v1', content: '合店协议（占位）' } });
```
</details>

## 262. 合店操作接口
`POST http://localhost:3000/costore/application-quotes`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1747`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|durationId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|ownerId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|storeId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### 请求 JSON 示例
```json
{
  "durationId": "有效资源ID",
  "ownerId": "有效资源ID",
  "storeId": "有效资源ID"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/costore/application-quotes' && m === 'POST') {
    const b = await readBody(req);
    const months = parseInt(b.durationId === '24' ? 24 : 12, 10);
    const fee = C.COSTORE_FEE_MONTHLY || 698;
    const payableAmount = round2(fee * months);
    // 问题1：合店申请报价落库（校验「门店 + 期限」组合与金额）
    const ownerId = sess.role === 'user' ? sess.userId : (b.ownerId || 'anonymous');
    let quote;
    try {
      quote = QT.issueQuote(db, {
        scene: QT.QUOTE_SCENES.COSTORE_APPLICATION,
        userId: ownerId,
        amount: payableAmount,
        breakdown: { monthlyFee: fee, months, durationId: b.durationId === '24' ? '24' : '12' },
        items: [{ key: 'costore', qty: months, storeId: b.storeId || null }],
        meta: { storeId: b.storeId || null, durationId: b.durationId === '24' ? '24' : '12', months },
      });
    } catch (e) { return fail(400, e.message); }
    save();
    return ok(200, { id: quote.id, storeId: b.storeId, durationId: b.durationId, durationLabel: months + ' 个月', payableAmount, currency: 'CNY', expiresAt: quote.expiresAt, serverTime: nowMs(), ruleVersion: quote.ruleVersion });
  }
```
</details>

## 263. 业务操作接口
`POST http://localhost:3000/applications/costore`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1768`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|ownerId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|durationId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|quoteId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|storeId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|idempotencyKey|JSON|条件/未显式声明|读取及校验规则见下方实现|request-20261029-001|

### 请求 JSON 示例
```json
{
  "ownerId": "有效资源ID",
  "durationId": "有效资源ID",
  "quoteId": "有效资源ID",
  "storeId": "有效资源ID",
  "idempotencyKey": "request-20261029-001"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/applications/costore' && m === 'POST') {
    const b = await readBody(req);
    const ownerId = sess.role === 'user' ? sess.userId : b.ownerId;
    const months = parseInt(b.durationId === '24' ? 24 : 12, 10);
    const fee = C.COSTORE_FEE_MONTHLY || 698;
    const payableAmount = round2(fee * months);
    // 问题1：提交时校验报价（金额服务端重算 + 门店/期限组合）
    let quoteRec = null;
    if (b.quoteId) {
      try {
        quoteRec = QT.checkQuote(db, b.quoteId, {
          scene: QT.QUOTE_SCENES.COSTORE_APPLICATION, userId: ownerId,
          serverAmount: payableAmount,
          items: [{ key: 'costore', qty: months, storeId: b.storeId || null }],
        });
      } catch (e) { return fail(400, e.message); }
    }
    try {
      const r = S.addCoStore(db, { owner_id: ownerId, storeManagerId: b.storeId || ownerId, store_id: b.storeId, monthly_fee: fee, joinDate: periodOf(), owners: [{ id: ownerId, performance: 0 }], promoter_id: null });
      save();
      const app = B.recordApplication(db, {
        type: 'COSTORE', title: '申请合店', applicationStatus: 'PENDING_REVIEW', userId: ownerId,
        storeId: b.storeId || ownerId, storeAgentId: b.storeId || ownerId,
        payableAmount,
        store: b.storeId ? { id: b.storeId, name: '门店 ' + b.storeId } : null, idempotencyKey: b.idempotencyKey || null,
      });
      save();
      if (quoteRec) { QT.markConsumed(db, quoteRec.id, { ref: app.id }); save(); }
      return ok(200, { application: { id: app.id, title: app.title, applicationStatus: app.applicationStatus, paymentStatus: app.paymentStatus, contractStatus: app.contractStatus, entitlementStatus: app.entitlementStatus, store: app.store, agencyType: null, payableAmount: app.payableAmount, createdAt: app.createdAt }, costore: r });
    } catch (e) { return fail(400, e.message); }
  }
```
</details>

## 264. 业务查询接口
`GET http://localhost:3000/promotion/agency-code`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1799`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|agencyType|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/promotion/agency-code' && m === 'GET') {
    const agencyType = q('agencyType') || 'store';
    return ok(200, { accountId: sess.userId, agencyType, promotionId: 'promo-' + sess.userId, qrUrl: 'https://h5.naoshang.example.com/qr/agency/' + sess.userId, posterUrl: '', shareUrl: 'https://h5.naoshang.example.com/?agency=' + sess.userId });
  }
  // ── 问题1：代理申请报价（三段式补齐：报价 → 提交 → 支付）────────────────
```
</details>

## 265. 问题1：代理申请报价（三段式补齐：报价 → 提交 → 支付）
`POST http://localhost:3000/agency/application-quotes`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1804`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|agencyType|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|tierIndex|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|partnerId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|regionCodes|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|regionCode|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "agencyType": "示例值",
  "tierIndex": "示例值",
  "partnerId": "有效资源ID",
  "regionCodes": "示例值",
  "regionCode": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/agency/application-quotes' && m === 'POST') {
    const b = await readBody(req);
    const agencyType = b.agencyType || 'store';
    const tierIndex = parseInt(b.tierIndex || '0', 10) || 0;
    const fee = RA.agentThresholdFee(agencyType, tierIndex);   // 金额一律服务端算
    const payableAmount = Number(fee.total || 0);
    const partnerId = sess.role === 'user' ? sess.userId : (b.partnerId || 'anonymous');
    let quote;
    try {
      quote = QT.issueQuote(db, {
        scene: QT.QUOTE_SCENES.AGENCY_APPLICATION,
        userId: partnerId,
        amount: payableAmount,
        breakdown: { brandFee: fee.brand || 0, extraFee: fee.extra || 0, deviceFee: fee.device || 0, depositFee: fee.deposit || 0, total: payableAmount },
        items: [{ key: 'agency', qty: 1, agencyType, tierIndex }],
        meta: { agencyType, tierIndex, regionCodes: b.regionCodes || b.regionCode || null },
      });
    } catch (e) { return fail(400, e.message); }
    save();
    return ok(200, {
      id: quote.id, agencyType, tierIndex, payableAmount, currency: 'CNY',
      feeBreakdown: { brandFee: fee.brand || 0, extraFee: fee.extra || 0, deviceFee: fee.device || 0, depositFee: fee.deposit || 0, total: payableAmount },
      expiresAt: quote.expiresAt, serverTime: nowMs(), ruleVersion: quote.ruleVersion,
    });
  }
  // ── P1-6（2026-10-26）：代理申请表单预填（原型屏 148）────────────────────────
  //   费用明细 ¥80000.00（品牌费4w / 设备费2w / 保证金2w）+ 推广码带入等级 + 门头照/协议勾选项
```
</details>

## 266. 费用明细 ¥80000.00（品牌费4w / 设备费2w / 保证金2w）+ 推广码带入等级 + 门头照/协议勾选项
`GET http://localhost:3000/agency/application-options`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1831`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|agencyType|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|tierIndex|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|promotionCode|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/agency/application-options' && m === 'GET') {
    const agencyType = q('agencyType') || 'store';
    const tierIndex = parseInt(q('tierIndex') || '0', 10) || 0;
    const fee = RA.agentThresholdFee(agencyType, tierIndex);   // brand/extra/device/deposit/total
    const price = RA.agentPrice(agencyType, tierIndex);
    const promoCode = q('promotionCode') || (sess.userId ? 'promo-' + sess.userId : '');
    // 推广码带入等级：查到上级代理 → 带入其可授予档位；查不到按 default
    // P1-8：promotionCode 支持「代理归属码」（类型化 agent 码）或旧格式 promo-<userId>
    let referredTier = null, referredBy = null;
    if (promoCode) {
      const icRec = IC.resolveInviteCode(db, promoCode);
      let refAgent = null;
      if (icRec && icRec.type === 'agent') {
        refAgent = (db.regionalAgents || []).find((a) => a.partner_id === icRec.ownerId);
      } else {
        const refId = promoCode.replace(/^promo-/, '');
        refAgent = (db.regionalAgents || []).find((a) => a.partner_id === refId);
      }
      if (refAgent) {
        referredBy = { id: refAgent.partner_id, name: (db.users[refAgent.partner_id] || {}).name || refAgent.partner_id };
        referredTier = refAgent.granted_tier || null;
      }
    }
    return ok(200, {
      agencyType,
      agencyTypeLabel: (RA.LEVEL_CN && RA.LEVEL_CN[agencyType]) || agencyType,
      feeBreakdown: {
        brandFee: fee.brand || 0,
        extraFee: fee.extra || 0,
        deviceFee: fee.device || 0,
        depositFee: fee.deposit || 0,
        total: fee.total || price.total,
        label: `¥${(fee.total || price.total).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`,
        note: fee.note || price.note || '',
      },
      priceTiers: (RA.AGENT_PRICE_TABLE[agencyType] || { tiers: [] }).tiers,
      techFee: price.techFee,
      techFeeNote: '直推代理奖按「技术费」计，不按合计',
      promotionCode: promoCode,
      referredBy,
      referredTier,
      grantedTier: referredTier || (S.AGENT_GRANT_TIER && S.AGENT_GRANT_TIER[agencyType]) || null,
      // 表单项：门头照走 /assets/upload-intents 上传后回填 fileId；协议需勾选
      requiredUploads: [{ key: 'storefrontPhoto', label: '门头照', type: 'image', maxCount: 3 }],
      requiredAgreements: [{ key: 'agencyAgreement', label: '代理协议', version: 'v1' }],
      allowedActions: ['submit'],
    });
  }
```
</details>

## 267. 代理操作接口
`POST http://localhost:3000/agency/applications`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5.js:1879`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|partnerId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|agencyType|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|tierIndex|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|agreements|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|uploads|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|quoteId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|regionCodes|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|regionCode|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|referrerId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|idempotencyKey|JSON|条件/未显式声明|读取及校验规则见下方实现|request-20261029-001|

### 请求 JSON 示例
```json
{
  "partnerId": "有效资源ID",
  "agencyType": "示例值",
  "tierIndex": "示例值",
  "agreements": "示例值",
  "uploads": "示例值",
  "quoteId": "有效资源ID",
  "regionCodes": "示例值",
  "regionCode": "示例值",
  "referrerId": "有效资源ID",
  "idempotencyKey": "request-20261029-001"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/agency/applications' && m === 'POST') {
    const b = await readBody(req);
    const partnerId = sess.role === 'user' ? sess.userId : b.partnerId;
    const agencyType = b.agencyType || 'store';
    const tierIndex = parseInt(b.tierIndex || '0', 10) || 0;
    // P1-6：费用明细按后台价格表计算（不接受前端传入金额），门头照/协议为必填项
    const fee = RA.agentThresholdFee(agencyType, tierIndex);
    const payableAmount = Number(fee.total || 0);
    const agreements = Array.isArray(b.agreements) ? b.agreements : [];
    if (!agreements.some((a) => a && a.key === 'agencyAgreement' && a.accepted === true)) {
      return fail(400, '请先阅读并勾选代理协议');
    }
    // ── 问题4：上传资源校验 ──
    //   旧版只判断「有没有 fileId」，不校验资源是否真实存在、是否已上传完成（READY）、是否属于当前账号。
    //   → 凭证 ID 直接当资源用，会出现「申请里挂着一个从不存在的门头照」。
    //   统一标识：fileId 与 assetId 是**同一个 id**（upload-intents 返回二者），此处两种都接受。
    const uploads = Array.isArray(b.uploads) ? b.uploads : [];
    const photo = uploads.find((u) => u && u.key === 'storefrontPhoto' && (u.fileId || u.assetId));
    if (!photo) return fail(400, '请上传门头照');
    const photoId = photo.fileId || photo.assetId;
    const asset = (db.assets || []).find((a) => a.id === photoId);
    if (!asset) return fail(400, `门头照资源不存在（${photoId}）：请重新上传后再提交`);
    if (asset.status !== 'READY') return fail(400, `门头照尚未上传完成（当前状态 ${asset.status}）：请完成上传后再提交`);
    if (sess.role === 'user' && asset.userId && asset.userId !== sess.userId) {
      return fail(400, '门头照资源不属于当前账号');
    }
    // 问题1：提交时凭 quoteId 校验（金额服务端重算 + 代理类型/档位组合）
    let quoteRec = null;
    if (b.quoteId) {
      try {
        quoteRec = QT.checkQuote(db, b.quoteId, {
          scene: QT.QUOTE_SCENES.AGENCY_APPLICATION, userId: partnerId,
          serverAmount: payableAmount,
          items: [{ key: 'agency', qty: 1, agencyType, tierIndex }],
        });
      } catch (e) { return fail(400, e.message); }
    }
    try {
      const r = S.appointAgent(db, { partnerId, regionType: agencyType, regionCode: b.regionCodes || b.regionCode || 'D1', referrerId: b.referrerId || null });
      save();
      const app = B.recordApplication(db, {
        type: 'AGENCY', title: '代理申请', applicationStatus: 'APPROVED', userId: partnerId,
        agencyType: agencyType.toUpperCase(), payableAmount, idempotencyKey: b.idempotencyKey || null,
        feeBreakdown: { brandFee: fee.brand || 0, extraFee: fee.extra || 0, deviceFee: fee.device || 0, depositFee: fee.deposit || 0, total: payableAmount },
        uploads, agreements,
      });
      save();
      if (quoteRec) { QT.markConsumed(db, quoteRec.id, { ref: app.id }); save(); }
      return ok(200, { application: { id: app.id, title: app.title, applicationStatus: app.applicationStatus, paymentStatus: app.paymentStatus, contractStatus: app.contractStatus, entitlementStatus: app.entitlementStatus, store: null, agencyType: app.agencyType, payableAmount: app.payableAmount, feeBreakdown: app.feeBreakdown || null, createdAt: app.createdAt }, agent: r });
    } catch (e) { return fail(400, e.message); }
  }

  // ───────────────────────── 兜底 ─────────────────────────
  // 业务模块（h5biz.js）已覆盖契约全部章节；未命中路径交回 /api/*（其自身 404）。
  return false;
}

module.exports = { handle, resolveContext, resetBiz: B.resetBiz };

```
</details>

## 268. §4 个人中心 / 地址 / 优惠券 / 客服 / 协议
`GET http://localhost:3000/me`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:313`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/me' && m === 'GET') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const u = db.users[uid]; if (!u) return fail(404, '用户不存在');
    const orders = db.orders.filter((o) => o.buyer_id === uid);
    const ag = db.regionalAgents.find((a) => a.partner_id === uid);
    const cs = db.coStores.find((c) => c.owner_id === uid || (c.owners || []).some((o) => o.id === uid));
    let store = null;
    if (ag && ag.region_type === 'store') store = { id: ag.region_code, name: ag.store_name || `脑商线下店 ${ag.region_code}`, address: ag.store_address || '', contact: ag.store_contact || '' };
    else if (cs) store = { id: cs.store_id, name: `合店 ${cs.store_id}`, address: '', contact: '' };
    const idKeys = R.getIdentities(db, uid).identities.map((i) => i.key);
    return ok(200, {
      profile: { id: uid, nickname: u.name, avatarUrl: u.avatarUrl || null, phone: u.phone, regionCodes: u.regionCodes || [], regionNames: u.regionNames || [], version: u.profileVersion || 1 },
      store, orderCounts: {
        pendingPayment: orders.filter((o) => ['UNPAID', 'PENDING', 'PENDING_PAYMENT'].includes(o.status)).length,
        waitingShipment: orders.filter((o) => (o.status === 'PAID' || !o.status) && (!o.fulfillmentStatus || o.fulfillmentStatus === 'PENDING')).length,
        waitingReceipt: orders.filter((o) => o.fulfillmentStatus === 'SHIPPED').length,
        completed: orders.filter((o) => o.status === 'COMPLETED').length,
      },
      support: { phone: '400-800-1234', description: '工作日 9:00-18:00' },
      exclusiveAccess: { accountId: uid, contextId: `partner:${uid}`, capabilities: idKeys },
    });
  }
```
</details>

## 269. 个人中心操作接口
`PATCH http://localhost:3000/me`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:335`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|nickname|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|regionCodes|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|regionNames|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|avatarAssetId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### 请求 JSON 示例
```json
{
  "version": 1,
  "nickname": "示例值",
  "regionCodes": "示例值",
  "regionNames": "示例值",
  "avatarAssetId": "有效资源ID"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/me' && m === 'PATCH') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const b = await readBodyOnce();
    const u = db.users[uid]; if (!u) return fail(404, '用户不存在');
    const cur = u.profileVersion || 1;
    if (b.version == null || Number(b.version) !== cur) return fail(409, `version 不匹配（当前 ${cur}）`);
    if (b.nickname != null) {
      const nk = String(b.nickname).trim();
      if (nk.length < 1 || nk.length > 24) return fail(400, '昵称需 1–24 字');
      u.name = nk;
    }
    if (b.regionCodes != null) {
      const rcs = Array.isArray(b.regionCodes) ? b.regionCodes : [];
      if (rcs.length && rcs.length !== 3) return fail(400, '地区须为三级编码');
      u.regionCodes = rcs; u.regionNames = Array.isArray(b.regionNames) ? b.regionNames : [];
    }
    if (b.avatarAssetId != null) {
      const ast = db.assets.find((a) => a.id === b.avatarAssetId);
      if (!ast || ast.userId !== uid) return fail(400, '头像资源不存在或不属于当前账号');
      if (ast.status !== 'READY') return fail(400, '头像资源未就绪');
      u.avatarUrl = ast.previewUrl || null;
    }
    u.profileVersion = cur + 1; save();
    return ok(200, { profile: { id: uid, nickname: u.name, avatarUrl: u.avatarUrl || null, phone: u.phone, regionCodes: u.regionCodes || [], regionNames: u.regionNames || [], version: u.profileVersion } });
  }
```
</details>

## 270. 地址查询接口
`GET http://localhost:3000/addresses`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:360`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/addresses' && m === 'GET') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    return ok(200, { items: listAddresses(db, uid).map(publicAddress), hasMore: false, nextCursor: null });
  }
```
</details>

## 271. 地址操作接口
`POST http://localhost:3000/addresses`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:364`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|recipient|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|phone|JSON|条件/未显式声明|读取及校验规则见下方实现|13800138000|
|regionCodes|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|regionNames|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|detail|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|isDefault|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "recipient": "示例值",
  "phone": "13800138000",
  "regionCodes": "示例值",
  "regionNames": "示例值",
  "detail": "示例值",
  "isDefault": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/addresses' && m === 'POST') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const b = await readBodyOnce();
    const v = validateAddress(b, false); if (v) return fail(400, v);
    const list = listAddresses(db, uid);
    const first = list.length === 0;
    const rec = { id: rid('adr'), userId: uid, recipient: b.recipient.trim(), phone: b.phone.trim(), regionCodes: b.regionCodes, regionNames: b.regionNames || [], detail: b.detail.trim(), isDefault: b.isDefault === true || first, version: 1, createdAt: nowMs() };
    if (rec.isDefault) list.forEach((a) => (a.isDefault = false));
    db.addresses.push(rec); save();
    return ok(200, { address: publicAddress(rec) });
  }
```
</details>

## 272. 地址查询接口
`GET http://localhost:3000/addresses/{动态路径}`
原始匹配：`p.startsWith('/addresses/') && m === 'GET'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:375`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.startsWith('/addresses/') && m === 'GET') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const a = listAddresses(db, uid).find((x) => x.id === p.slice('/addresses/'.length));
    if (!a) return fail(404, '地址不存在');
    return ok(200, { address: publicAddress(a) });
  }
```
</details>

## 273. 地址操作接口
`PATCH http://localhost:3000/addresses/{动态路径}`
原始匹配：`p.startsWith('/addresses/') && m === 'PATCH'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:381`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|recipient|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|phone|JSON|条件/未显式声明|读取及校验规则见下方实现|13800138000|
|regionCodes|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|regionNames|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|detail|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|isDefault|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "version": 1,
  "recipient": "示例值",
  "phone": "13800138000",
  "regionCodes": "示例值",
  "regionNames": "示例值",
  "detail": "示例值",
  "isDefault": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.startsWith('/addresses/') && m === 'PATCH') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const a = listAddresses(db, uid).find((x) => x.id === p.slice('/addresses/'.length));
    if (!a) return fail(404, '地址不存在');
    const b = await readBodyOnce();
    if (b.version == null || Number(b.version) !== a.version) return fail(409, `version 不匹配（当前 ${a.version}）`);
    const v = validateAddress(b, true); if (v) return fail(400, v);
    if (b.recipient != null) a.recipient = b.recipient.trim();
    if (b.phone != null) a.phone = b.phone.trim();
    if (b.regionCodes != null) a.regionCodes = b.regionCodes;
    if (b.regionNames != null) a.regionNames = b.regionNames;
    if (b.detail != null) a.detail = b.detail.trim();
    if (b.isDefault === true) { listAddresses(db, uid).forEach((x) => (x.isDefault = false)); a.isDefault = true; }
    else if (b.isDefault === false) a.isDefault = false;
    a.version += 1; save();
    return ok(200, { address: publicAddress(a) });
  }
```
</details>

## 274. 地址操作接口
`PUT http://localhost:3000/addresses/default`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:398`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|addressId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|

### 请求 JSON 示例
```json
{
  "addressId": "有效资源ID",
  "version": 1
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/addresses/default' && m === 'PUT') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const b = await readBodyOnce();
    const a = listAddresses(db, uid).find((x) => x.id === b.addressId);
    if (!a) return fail(404, '地址不存在');
    if (b.version == null) return fail(400, 'version 必填');
    listAddresses(db, uid).forEach((x) => (x.isDefault = x.id === a.id));
    save();
    return ok(200, { defaultAddressId: a.id });
  }
```
</details>

## 275. 地址操作接口
`DELETE http://localhost:3000/addresses/{动态路径}`
原始匹配：`p.startsWith('/addresses/') && m === 'DELETE'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:408`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|

### 请求 JSON 示例
```json
{
  "version": 1
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.startsWith('/addresses/') && m === 'DELETE') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const id = p.slice('/addresses/'.length);
    const idx = db.addresses.findIndex((x) => x.id === id && x.userId === uid);
    if (idx < 0) return fail(404, '地址不存在');
    const b = await readBodyOnce();
    if (b.version == null || Number(b.version) !== db.addresses[idx].version) return fail(409, 'version 不匹配');
    const wasDefault = db.addresses[idx].isDefault;
    db.addresses.splice(idx, 1);
    if (wasDefault) { const rest = listAddresses(db, uid); if (rest.length) rest[0].isDefault = true; }
    save();
    return ok(200, { success: true });
  }
```
</details>

## 276. 优惠券查询接口
`GET http://localhost:3000/coupons`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:421`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|status|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/coupons' && m === 'GET') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const status = q('status');
    if (!['available', 'used', 'void'].includes(status || '')) return fail(400, 'status 必填且为 available/used/void');
    return ok(200, { items: listCoupons(db, uid, status), hasMore: false, nextCursor: null });
  }
```
</details>

## 277. 客服查询接口
`GET http://localhost:3000/support/config`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:427`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/support/config' && m === 'GET') {
    return ok(200, { phone: '400-800-1234', description: '工作日 9:00-18:00', feedback: { maxImages: 3 } });
  }
```
</details>

## 278. 客服操作接口
`POST http://localhost:3000/support/feedback`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:430`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|content|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|idempotencyKey|JSON|条件/未显式声明|读取及校验规则见下方实现|request-20261029-001|
|imageAssetIds|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "content": "示例值",
  "idempotencyKey": "request-20261029-001",
  "imageAssetIds": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/support/feedback' && m === 'POST') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const b = await readBodyOnce();
    if (!b.content || !b.idempotencyKey) return fail(400, 'content 与 idempotencyKey 必填');
    const content = String(b.content).trim();
    if (content.length < 1 || content.length > 500) return fail(400, '内容需 1–500 字');
    const imgs = Array.isArray(b.imageAssetIds) ? b.imageAssetIds : [];
    if (imgs.length > 3) return fail(400, '最多 3 张图片');
    const idem = IDEM.check({ list: db.supportFeedback, key: b.idempotencyKey, payload: { content, imageAssetIds: imgs } });
    if (idem.conflict) return fail(409, idem.conflictReason);
    if (idem.duplicated) return ok(200, { feedbackId: idem.record.id });
    for (const aid of imgs) { const ast = db.assets.find((a) => a.id === aid); if (!ast || ast.userId !== uid) return fail(400, `图片资源 ${aid} 不存在或不属于当前账号`); }
    const rec = IDEM.stamp({ id: rid('fbk'), userId: uid, content, imageAssetIds: imgs, createdAt: nowMs(), idempotencyKey: b.idempotencyKey }, { content, imageAssetIds: imgs });
    db.supportFeedback.push(rec); save();
    return ok(200, { feedbackId: rec.id });
  }
```
</details>

## 279. 业务查询接口
`GET http://localhost:3000/agreements/{动态路径}`
原始匹配：`p.startsWith('/agreements/') && m === 'GET'`
Security：公开协议正文。
源码：`src/routes/h5biz.js:446`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.startsWith('/agreements/') && m === 'GET') {
    const type = p.slice('/agreements/'.length);
    const ag = AGREEMENTS[type];
    if (!ag) return fail(404, '协议不存在（支持 user/privacy）');
    return ok(200, { title: ag.title, version: ag.version, content: ag.content });
  }

  // ═══════════════════ §5 家庭会员与激活 ═══════════════════
```
</details>

## 280. §5 家庭会员与激活
`GET http://localhost:3000/members/options`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:454`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/members/options' && m === 'GET') return ok(200, { grades: GRADES, genders: GENDERS });
```
</details>

## 281. §5 家庭会员与激活
`GET http://localhost:3000/members`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:455`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|scope|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/members' && m === 'GET') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    if ((q('scope') || 'family') !== 'family') return fail(400, 'scope 仅支持 family');
    const items = db.members.filter((mm) => mm.userId === uid).map(publicMember);
    return ok(200, { items, hasMore: false, nextCursor: null });
  }
```
</details>

## 282. 家庭会员操作接口
`POST http://localhost:3000/members`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:461`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|name|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|gradeCode|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|genderCode|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|idempotencyKey|JSON|条件/未显式声明|读取及校验规则见下方实现|request-20261029-001|
|avatarAssetId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### 请求 JSON 示例
```json
{
  "name": "示例值",
  "gradeCode": "示例值",
  "genderCode": "示例值",
  "idempotencyKey": "request-20261029-001",
  "avatarAssetId": "有效资源ID"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/members' && m === 'POST') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const b = await readBodyOnce();
    if (!b.name || !b.gradeCode || !b.genderCode) return fail(400, 'name、gradeCode、genderCode 必填');
    if (!b.idempotencyKey) return fail(400, 'idempotencyKey 必填');
    const idem = IDEM.check({ list: db.members, key: b.idempotencyKey, payload: { name: String(b.name).trim(), gradeCode: b.gradeCode, genderCode: b.genderCode, avatarAssetId: b.avatarAssetId || null } });
    if (idem.conflict) return fail(409, idem.conflictReason);
    if (idem.duplicated) return ok(200, { member: publicMember(idem.record) });
    const name = String(b.name).trim();
    if (name.length < 1 || name.length > 24) return fail(400, '姓名需 1–24 字');
    if (!GRADES.some((g) => g.code === b.gradeCode)) return fail(400, 'gradeCode 非法');
    if (!GENDERS.some((g) => g.code === b.genderCode)) return fail(400, 'genderCode 非法');
    if (b.avatarAssetId != null) {
      const ast = db.assets.find((a) => a.id === b.avatarAssetId);
      if (!ast || ast.userId !== uid || ast.status !== 'READY') return fail(400, '头像资源不可用');
    }
    const rec = IDEM.stamp({
      id: rid('m'), userId: uid, name, gradeCode: b.gradeCode, gradeLabel: gradeLabel(b.gradeCode),
      genderCode: b.genderCode, genderLabel: genderLabel(b.genderCode),
      avatarAssetId: b.avatarAssetId || null, avatarUrl: b.avatarAssetId ? (db.assets.find((a) => a.id === b.avatarAssetId) || {}).previewUrl || null : null,
      storeId: null, activated: false, unlockedLevels: [], unlockedColumns: [], version: 1, idempotencyKey: b.idempotencyKey, createdAt: nowMs(),
      __idemPayload: { name: String(b.name).trim(), gradeCode: b.gradeCode, genderCode: b.genderCode, avatarAssetId: b.avatarAssetId || null },
      // 孩子身份编号（2026-10-24 截图规则）：默认普通会员（游客）；序号=第几个添加；升级只变前缀
      memberLevel: 'normal', memberSeq: null, display_id: null,
      training: { trainingTotal: 0, trainingUsed: 0, specialTotal: 0, specialUsed: 0, selfStudyNote: '', campNote: '', remark: '' },
    });
    db.members.push(rec);
    IZ.assignMemberSeq(db, rec.id);
    IZ.recomputeMemberDisplayId(db, rec.id);
    IZ.recomputeDisplayId(db, uid); // 家长编号随孩子最高等级派生（普通孩子不改变，保持调用一致）
    save();
    return ok(200, { member: publicMember(rec) });
  }
  // 注意：/members/{id} 的子路径处理（orders/training-feedback/store-profile/training/levels/learning-progress）
  // 必须位于下方通用 PATCH /members/{id} 之前，否则会被父路径规则抢先匹配。
```
</details>

## 283. 必须位于下方通用 PATCH /members/{id} 之前，否则会被父路径规则抢先匹配。
`POST http://localhost:3000/activations/preview`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:496`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|code|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|memberId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### 请求 JSON 示例
```json
{
  "code": "示例值",
  "memberId": "有效资源ID"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/activations/preview' && m === 'POST') {
    const b = await readBodyOnce();
    if (!b.code || !b.memberId) return fail(400, 'code 与 memberId 必填');
    const mm = memberOf(db, b.memberId);
    if (!mm || !canManageMember(db, ctx, mm)) return fail(404, '会员不存在');
    const rec = db.activationCodes.find((c) => c.code === String(b.code).trim().toUpperCase());
    if (!rec) return fail(404, '激活码不存在');
    if (rec.issuedTo && ctx.sess.role === 'user' && rec.issuedTo !== ctx.sess.userId) return fail(403, '该激活码已绑定指定家长，仅本人可使用');
    if (rec.status !== 'active') return fail(400, '激活码已停用');
    if (rec.expiresAt && rec.expiresAt < nowMs()) return fail(400, '激活码已过期');
    const memLevel = IZ.MEMBER_ACTIVATION_TYPES[rec.targetType] || null; // 会员等级类激活码
    if (rec.uses >= rec.maxUses) {
      // 预览不消耗码：次数用尽时返回已消耗状态供前端展示（契约 §5），而非报错
      const lv2 = rec.targetType === 'level' ? levelOf(rec.targetId) : null;
      return ok(200, {
        code: rec.code, memberId: mm.id, targetType: rec.targetType, targetId: rec.targetId || null,
        levelId: lv2 ? lv2.id : undefined, levelName: lv2 ? lv2.name : undefined,
        memberLevel: memLevel || undefined, memberLevelName: memLevel ? IZ.memberTierName(memLevel) : undefined,
        alreadyActivated: rec.targetType === 'level' ? mm.unlockedLevels.includes(rec.targetId)
          : memLevel ? IZ.memberTierScore(mm.memberLevel || 'normal') >= IZ.memberTierScore(memLevel) : !!mm.activated,
        consumed: true, validUntil: rec.expiresAt ? new Date(rec.expiresAt).toISOString() : null,
        maxUses: rec.maxUses, remainingUses: 0,
      });
    }
    const targetType = rec.targetType;
    const targetId = rec.targetId || null;
    const lv = targetType === 'level' ? levelOf(targetId) : null;
    return ok(200, {
      code: rec.code, memberId: mm.id, targetType, targetId,
      levelId: lv ? lv.id : undefined, levelName: lv ? lv.name : undefined,
      memberLevel: memLevel || undefined, memberLevelName: memLevel ? IZ.memberTierName(memLevel) : undefined,
      alreadyActivated: targetType === 'level' ? mm.unlockedLevels.includes(targetId)
        : memLevel ? IZ.memberTierScore(mm.memberLevel || 'normal') >= IZ.memberTierScore(memLevel) : !!mm.activated,
      validUntil: rec.expiresAt ? new Date(rec.expiresAt).toISOString() : null,
      maxUses: rec.maxUses, remainingUses: rec.maxUses - rec.uses,
    });
  }
```
</details>

## 284. 业务操作接口
`POST http://localhost:3000/activations`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:533`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|code|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|targetType|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|idempotencyKey|JSON|条件/未显式声明|读取及校验规则见下方实现|request-20261029-001|
|targetId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|memberId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### 请求 JSON 示例
```json
{
  "code": "示例值",
  "targetType": "示例值",
  "idempotencyKey": "request-20261029-001",
  "targetId": "有效资源ID",
  "memberId": "有效资源ID"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/activations' && m === 'POST') {
    const b = await readBodyOnce();
    if (!b.code || !b.targetType) return fail(400, 'code、targetType 必填');
    if (!b.idempotencyKey) return fail(400, 'idempotencyKey 必填');
    const memLevel = IZ.MEMBER_ACTIVATION_TYPES[b.targetType] || null; // 会员等级类激活码（fs/jy/cj/xn/ys，兼容旧 member=fs）
    if (!b.targetId && !memLevel) return fail(400, 'level/column 类激活码必须传 targetId');
    const mm = memberOf(db, b.memberId || '');
    if ((b.targetType === 'level' || memLevel) && (!mm || !canManageMember(db, ctx, mm))) return fail(404, '会员不存在');
    const rec = db.activationCodes.find((c) => c.code === String(b.code).trim().toUpperCase());
    if (!rec) return fail(404, '激活码不存在');
    if (rec.issuedTo && ctx.sess.role === 'user' && rec.issuedTo !== ctx.sess.userId) return fail(403, '该激活码已绑定指定家长，仅本人可使用');
    if (rec.status !== 'active') return fail(400, '激活码已停用');
    if (rec.expiresAt && rec.expiresAt < nowMs()) return fail(400, '激活码已过期');
    if (rec.uses >= rec.maxUses) return fail(400, '激活码使用次数已用完');
    if (rec.targetType !== b.targetType || (rec.targetId && rec.targetId !== b.targetId)) return fail(400, '激活码与提交的目标不一致');
    if (b.targetType === 'level' && mm.unlockedLevels.includes(b.targetId)) return ok(200, { unlocked: true, memberId: mm.id, targetType: b.targetType, targetId: b.targetId, duplicate: true });
    rec.uses += 1; rec.usedBy = rec.usedBy || []; rec.usedBy.push({ memberId: b.memberId || null, at: nowMs(), channel: rec.channel || null, issuedBy: rec.issuedBy || null });
    if (b.targetType === 'level') { if (!mm.unlockedLevels.includes(b.targetId)) mm.unlockedLevels.push(b.targetId); }
    else if (memLevel) {
      // 会员等级激活（截图规则）：家长档位门槛（CJ←VIP合伙人；XN/YS←天使合伙人）+ 只升不降
      const parent = db.users[mm.userId];
      if (!parent) return fail(404, '家长账号不存在');
      if (!IZ.memberTierAllowedForParent(memLevel, parent.tier)) {
        rec.uses -= 1; // 档位不符不消耗激活码
        const needName = IZ.MEMBER_TIER_MIN_TIER_SCORE[memLevel] >= 2 ? '天使合伙人' : 'VIP合伙人';
        return fail(403, `激活${IZ.memberTierName(memLevel)}需家长为${needName}（当前档位不符）`);
      }
      if (IZ.memberTierScore(mm.memberLevel || 'normal') >= IZ.memberTierScore(memLevel)) {
        rec.uses -= 1; // 已达更高等级不消耗
        return ok(200, { unlocked: true, memberId: mm.id, targetType: b.targetType, targetId: b.targetId, duplicate: true });
      }
      IZ.applyMemberLevel(db, mm.id, memLevel); // 重算孩子编号（只变前缀）+ 家长编号（取高上浮）
    }
    else if (b.targetType === 'column') {
      // 专栏权益发放到账号（memberId 缺省时）或指定孩子
      const holder = mm || (ctx.sess.role === 'user' ? db.users[ctx.sess.userId] : null);
      if (holder) { holder.unlockedColumns = holder.unlockedColumns || []; if (!holder.unlockedColumns.includes(b.targetId)) holder.unlockedColumns.push(b.targetId); }
    }
    save();
    return ok(200, { unlocked: true, memberId: b.memberId || null, targetType: b.targetType, targetId: b.targetId });
  }
```
</details>

## 285. 家庭会员查询接口
`GET http://localhost:3000/members/{动态路径}`
原始匹配：`p.startsWith('/members/') && p.endsWith('/orders') && m === 'GET'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:574`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.startsWith('/members/') && p.endsWith('/orders') && m === 'GET') {
    const id = p.slice('/members/'.length, -'/orders'.length);
    const mm = memberOf(db, id);
    if (!mm || !canManageMember(db, ctx, mm)) return fail(404, '会员不存在');
    const items = db.orders.filter((o) => o.buyer_id === id).map((o) => ({ ...o, buyer_name: mm.name, status: o.status || 'PAID' }));
    return ok(200, { items, hasMore: false, nextCursor: null });
  }
```
</details>

## 286. 家庭会员查询接口
`GET http://localhost:3000/members/{动态路径}`
原始匹配：`p.startsWith('/members/') && p.endsWith('/training-feedback') && m === 'GET'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:581`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|kind|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.startsWith('/members/') && p.endsWith('/training-feedback') && m === 'GET') {
    const id = p.slice('/members/'.length, -'/training-feedback'.length);
    const mm = memberOf(db, id);
    if (!mm || !canManageMember(db, ctx, mm)) return fail(404, '会员不存在');
    const kind = q('kind');
    if (kind && !['training', 'self-study', 'camp'].includes(kind)) return fail(400, 'kind 为 training/self-study/camp');
    const items = db.trainingFeedback.filter((f) => f.memberId === id && (!kind || f.kind === kind)).map((f) => publicFeedback(f, db));
    return ok(200, { items, hasMore: false, nextCursor: null, allowedActions: canManageMember(db, ctx, mm) ? ['create'] : [] });
  }
```
</details>

## 287. 家庭会员查询接口
`GET http://localhost:3000/members/{动态路径}`
原始匹配：`p.startsWith('/members/') && p.endsWith('/store-profile') && m === 'GET'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:590`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.startsWith('/members/') && p.endsWith('/store-profile') && m === 'GET') {
    const id = p.slice('/members/'.length, -'/store-profile'.length);
    const mm = memberOf(db, id);
    if (!mm || !canManageMember(db, ctx, mm)) return fail(404, '会员不存在');
    return ok(200, { member: publicMember(mm), allowedActions: ctx.sess.role === 'coach' || ctx.sess.role === 'admin' ? ['update-training', 'create-feedback'] : [] });
  }
```
</details>

## 288. 家庭会员操作接口
`PATCH http://localhost:3000/members/{动态路径}`
原始匹配：`p.startsWith('/members/') && p.endsWith('/training') && m === 'PATCH'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:596`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|trainingTotal|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|trainingUsed|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|specialTotal|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|specialUsed|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|selfStudyNote|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|campNote|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|remark|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "version": 1,
  "trainingTotal": "示例值",
  "trainingUsed": "示例值",
  "specialTotal": "示例值",
  "specialUsed": "示例值",
  "selfStudyNote": "示例值",
  "campNote": "示例值",
  "remark": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.startsWith('/members/') && p.endsWith('/training') && m === 'PATCH') {
    const id = p.slice('/members/'.length, -'/training'.length);
    const mm = memberOf(db, id);
    if (!mm || !canManageMember(db, ctx, mm)) return fail(404, '会员不存在');
    const b = await readBodyOnce();
    if (b.version == null || Number(b.version) !== mm.version) return fail(409, `version 不匹配（当前 ${mm.version}）`);
    const t = mm.training;
    const pick = (v, cur) => (v === undefined ? cur : v);
    const nt = {
      trainingTotal: pick(b.trainingTotal, t.trainingTotal), trainingUsed: pick(b.trainingUsed, t.trainingUsed),
      specialTotal: pick(b.specialTotal, t.specialTotal), specialUsed: pick(b.specialUsed, t.specialUsed),
      selfStudyNote: pick(b.selfStudyNote, t.selfStudyNote), campNote: pick(b.campNote, t.campNote), remark: pick(b.remark, t.remark),
    };
    for (const k of ['trainingTotal', 'trainingUsed', 'specialTotal', 'specialUsed']) {
      const v = Number(nt[k]);
      if (!Number.isInteger(v) || v < 0 || v > 10000) return fail(400, `${k} 须为 0–10000 的整数`);
      nt[k] = v;
    }
    if (nt.trainingUsed > nt.trainingTotal || nt.specialUsed > nt.specialTotal) return fail(400, '已消耗课时不能超过总课时');
    for (const k of ['selfStudyNote', 'campNote', 'remark']) if (String(nt[k] || '').length > 500) return fail(400, `${k} 最多 500 字`);
    mm.training = nt; mm.version += 1; save();
    return ok(200, { member: publicMember(mm) });
  }
```
</details>

## 289. 家庭会员查询接口
`GET http://localhost:3000/members/{动态路径}`
原始匹配：`p.startsWith('/members/') && p.endsWith('/levels') && m === 'GET'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:619`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.startsWith('/members/') && p.endsWith('/levels') && m === 'GET') {
    const id = p.slice('/members/'.length, -'/levels'.length);
    const mm = memberOf(db, id);
    if (!mm || !canManageMember(db, ctx, mm)) return fail(404, '会员不存在');
    const levels = LEVELS.map((l) => {
      const unlocked = levelAccessible(mm, l);
      const done = l.chapters.filter((c) => progressOf(db, mm.id, l.id, c.id).completed).length;
      return {
        id: l.id, name: l.name, unlocked,
        section: l.section, sectionName: l.sectionName, requireMemberLevel: IZ.memberTierName(l.section),
        progress: unlocked ? { completed: done, total: l.chapters.length } : undefined,
      };
    });
    return ok(200, { levels, memberLevel: mm.memberLevel || 'normal', memberLevelName: IZ.memberTierName(mm.memberLevel || 'normal') });
  }
```
</details>

## 290. 家庭会员操作接口
`PUT http://localhost:3000/members/{动态路径}`
原始匹配：`p.startsWith('/members/') && p.endsWith('/learning-progress') && m === 'PUT'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:634`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|levelId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|chapterId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|positionSeconds|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|durationSeconds|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|completed|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|ended|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "levelId": "有效资源ID",
  "chapterId": "有效资源ID",
  "positionSeconds": "示例值",
  "durationSeconds": "示例值",
  "completed": "示例值",
  "ended": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.startsWith('/members/') && p.endsWith('/learning-progress') && m === 'PUT') {
    const id = p.slice('/members/'.length, -'/learning-progress'.length);
    const mm = memberOf(db, id);
    if (!mm || !canManageMember(db, ctx, mm)) return fail(404, '会员不存在');
    const b = await readBodyOnce();
    if (!b.levelId || !b.chapterId) return fail(400, 'levelId 与 chapterId 必填');
    const lv = levelOf(b.levelId); if (!lv) return fail(404, '等级不存在');
    const ch = lv.chapters.find((c) => c.id === b.chapterId); if (!ch) return fail(404, '章节不存在');
    if (!levelAccessible(mm, lv)) return fail(403, '该等级尚未激活（需孩子会员等级达到 ' + IZ.memberTierName(lv.section) + '）');
    const pos = Math.max(0, Number(b.positionSeconds) || 0);
    const dur = Math.max(0, Number(b.durationSeconds) || 0);
    const completed = b.completed === true || (ch.type === 'video' && b.ended === true && dur > 0 && pos >= dur * 0.98);
    const rec = { memberId: mm.id, levelId: lv.id, chapterId: ch.id, positionSeconds: pos, durationSeconds: dur, completed, updatedAt: nowMs() };
    const idx = db.learningProgress.findIndex((x) => x.memberId === mm.id && x.levelId === lv.id && x.chapterId === ch.id);
    if (idx >= 0) db.learningProgress[idx] = rec; else     db.learningProgress.push(rec);
    save();
    return ok(200, { positionSeconds: pos, durationSeconds: dur, completed });
  }
  // 专栏课程进度（账号级，无孩子维度；前端 learning.js 以 account-column 身份记录）
```
</details>

## 291. 专栏课程进度（账号级，无孩子维度；前端 learning.js 以 account-column 身份记录）
`PUT http://localhost:3000/columns/{动态路径}`
原始匹配：`p.startsWith('/columns/') && p.endsWith('/learning-progress') && m === 'PUT'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:653`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|chapterId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|positionSeconds|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|durationSeconds|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|completed|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|ended|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "chapterId": "有效资源ID",
  "positionSeconds": "示例值",
  "durationSeconds": "示例值",
  "completed": "示例值",
  "ended": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.startsWith('/columns/') && p.endsWith('/learning-progress') && m === 'PUT') {
    const id = p.slice('/columns/'.length, -'/learning-progress'.length);
    const col = columnById(db, id);
    if (!col) return fail(404, '专栏不存在');
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const b = await readBodyOnce();
    if (!b.chapterId) return fail(400, 'chapterId 必填');
    const ch = col.chapters.find((c) => c.id === b.chapterId); if (!ch) return fail(404, '章节不存在');
    const pos = Math.max(0, Number(b.positionSeconds) || 0);
    const dur = Math.max(0, Number(b.durationSeconds) || 0);
    const completed = b.completed === true || (ch.type === 'video' && b.ended === true && dur > 0 && pos >= dur * 0.98);
    const levelKey = 'column:' + col.id;
    const rec = { memberId: 'account-column', accountId: uid, levelId: levelKey, chapterId: ch.id, positionSeconds: pos, durationSeconds: dur, completed, updatedAt: nowMs() };
    const idx = db.learningProgress.findIndex((x) => x.memberId === 'account-column' && x.levelId === levelKey && x.chapterId === ch.id);
    if (idx >= 0) db.learningProgress[idx] = rec; else db.learningProgress.push(rec);
    save();
    return ok(200, { positionSeconds: pos, durationSeconds: dur, completed });
  }
  // 通用会员修改（置于全部 /members/{id}/ 子路径之后，避免抢先匹配）
```
</details>

## 292. 通用会员修改（置于全部 /members/{id}/ 子路径之后，避免抢先匹配）
`PATCH http://localhost:3000/members/{动态路径}`
原始匹配：`p.startsWith('/members/') && m === 'PATCH'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:672`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|name|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|gradeCode|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|genderCode|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|avatarAssetId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### 请求 JSON 示例
```json
{
  "version": 1,
  "name": "示例值",
  "gradeCode": "示例值",
  "genderCode": "示例值",
  "avatarAssetId": "有效资源ID"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.startsWith('/members/') && m === 'PATCH') {
    const id = p.slice('/members/'.length);
    const mm = memberOf(db, id);
    if (!mm || !canManageMember(db, ctx, mm)) return fail(404, '会员不存在');
    const b = await readBodyOnce();
    if (b.version == null || Number(b.version) !== mm.version) return fail(409, `version 不匹配（当前 ${mm.version}）`);
    if (b.name != null) { const nk = String(b.name).trim(); if (nk.length < 1 || nk.length > 24) return fail(400, '姓名需 1–24 字'); mm.name = nk; }
    if (b.gradeCode != null) { if (!GRADES.some((g) => g.code === b.gradeCode)) return fail(400, 'gradeCode 非法'); mm.gradeCode = b.gradeCode; mm.gradeLabel = gradeLabel(b.gradeCode); }
    if (b.genderCode != null) { if (!GENDERS.some((g) => g.code === b.genderCode)) return fail(400, 'genderCode 非法'); mm.genderCode = b.genderCode; mm.genderLabel = genderLabel(b.genderCode); }
    if (b.avatarAssetId != null) {
      const ast = db.assets.find((a) => a.id === b.avatarAssetId);
      if (!ast || ast.userId !== mm.userId || ast.status !== 'READY') return fail(400, '头像资源不可用');
      mm.avatarAssetId = b.avatarAssetId; mm.avatarUrl = ast.previewUrl || null;
    }
    mm.version += 1; save();
    return ok(200, { member: publicMember(mm) });
  }

  // ═══════════════════ §6 学习等级 / 公告 / 课程 ═══════════════════
```
</details>

## 293. §6 学习等级 / 公告 / 课程
`GET http://localhost:3000/learning/levels`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:691`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|memberId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/learning/levels' && m === 'GET') {
    const memberId = q('memberId');
    let mm = null;
    if (memberId) { mm = memberOf(db, memberId); if (!mm || !canManageMember(db, ctx, mm)) return fail(404, '会员不存在'); }
    return ok(200, {
      memberLevel: mm ? (mm.memberLevel || 'normal') : undefined,
      memberLevelName: mm ? IZ.memberTierName(mm.memberLevel || 'normal') : undefined,
      levels: LEVELS.map((l) => ({
        id: l.id, name: l.name, summary: l.summary,
        unlocked: mm ? levelAccessible(mm, l) : false,
        section: l.section, sectionName: l.sectionName, requireMemberLevel: IZ.memberTierName(l.section),
      })),
    });
  }
```
</details>

## 294. 业务查询接口
`GET http://localhost:3000/learning/levels/{动态路径}`
原始匹配：`p.startsWith('/learning/levels/') && m === 'GET'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:705`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|memberId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.startsWith('/learning/levels/') && m === 'GET') {
    const lv = levelOf(p.slice('/learning/levels/'.length));
    if (!lv) return fail(404, '等级不存在');
    const memberId = q('memberId');
    let mm = null;
    if (memberId) { mm = memberOf(db, memberId); if (!mm || !canManageMember(db, ctx, mm)) return fail(404, '会员不存在'); }
    const unlocked = mm ? levelAccessible(mm, lv) : false;
    return ok(200, {
      id: lv.id, name: lv.name, summary: lv.summary, covers: lv.covers, unlocked,
      section: lv.section, sectionName: lv.sectionName, requireMemberLevel: IZ.memberTierName(lv.section),
      content: unlocked || !mm ? nodes(heading(lv.name), para(lv.summary)) : null,
      chapters: lv.chapters.map((c) => ({
        id: c.id, title: c.title, type: c.type, accessible: unlocked,
        progress: mm ? progressOf(db, mm.id, lv.id, c.id) : { positionSeconds: 0, durationSeconds: 0, completed: false },
      })),
    });
  }
```
</details>

## 295. 公告查询接口
`GET http://localhost:3000/announcements`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:722`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/announcements' && m === 'GET') {
    return ok(200, { items: ANNOUNCEMENTS.map(({ content, ...rest }) => rest), hasMore: false, nextCursor: null });
  }
```
</details>

## 296. 公告操作接口
`PUT http://localhost:3000/announcements/{动态路径}`
原始匹配：`p.startsWith('/announcements/') && p.endsWith('/read') && m === 'PUT'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:725`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### 请求 JSON 示例
```json
{}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.startsWith('/announcements/') && p.endsWith('/read') && m === 'PUT') {
    // 标记已读（2026-10-28 补齐）
    //   前端 learning.js 的 markAnnouncementRead() 在非 mock 模式下调 PUT /announcements/{id}/read，
    //   但后端此前**没有这条路由** → 打开公告详情页时必 404（前端 catch 后不显示，
    //   属于静默失败，很难被察觉）。
    const id = p.slice('/announcements/'.length, -'/read'.length);
    if (!ANNOUNCEMENTS.some((x) => x.id === id)) return fail(404, '公告不存在');
    const uid = sess && sess.userId ? sess.userId : null;
    if (!uid) return fail(401, '未登录');
    db.announcementReads = db.announcementReads || {};
    const mine = db.announcementReads[uid] = db.announcementReads[uid] || {};
    // 幂等：重复标记只更新首次时间
    if (!mine[id]) mine[id] = nowMs();
    save();
    return ok(200, { read: true, announcementId: id, readAt: mine[id] });
  }
```
</details>

## 297. 公告查询接口
`GET http://localhost:3000/announcements/{动态路径}`
原始匹配：`p.startsWith('/announcements/') && m === 'GET'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:741`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.startsWith('/announcements/') && m === 'GET') {
    const a = ANNOUNCEMENTS.find((x) => x.id === p.slice('/announcements/'.length));
    if (!a) return fail(404, '公告不存在');
    return ok(200, { id: a.id, title: a.title, publishedAt: a.publishedAt, content: a.content });
  }
```
</details>

## 298. 业务查询接口
`GET http://localhost:3000/lessons/{动态路径}`
原始匹配：`p.startsWith('/lessons/') && m === 'GET'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:746`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|columnId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|memberId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.startsWith('/lessons/') && m === 'GET') {
    const cid = p.slice('/lessons/'.length);
    // columnId 兼容两种传法：query（uni.request GET 会把 data 拼到 query）与 body
    const columnId = q('columnId') || (await readBodyOnce()).columnId;
    const found = columnId ? columnChapterOf(db, cid) : chapterOf(cid);
    if (!found) return fail(404, '课程不存在');
    const memberId = q('memberId');
    let mm = null;
    if (memberId) { mm = memberOf(db, memberId); if (!mm || !canManageMember(db, ctx, mm)) return fail(404, '会员不存在'); }
    if (columnId) {
      const { column, chapter } = found;
      const body = { id: chapter.id, title: chapter.title, type: chapter.type, locked: false, posterUrl: chapter.posterUrl || null, requireMemberLevel: null, columnId };
      body.content = chapter.content;
      body.videoUrl = chapter.videoUrl || null;
      if (mm) body.progress = progressOf(db, mm.id, 'column:' + column.id, chapter.id);
      return ok(200, body);
    }
    const { level, chapter } = found;
    const unlocked = mm ? levelAccessible(mm, level) : false;
    const body = { id: chapter.id, title: chapter.title, type: chapter.type, locked: !unlocked, posterUrl: chapter.posterUrl || null, requireMemberLevel: IZ.memberTierName(level.section) };
    if (unlocked) { body.content = chapter.content; body.videoUrl = chapter.videoUrl || null; body.progress = progressOf(db, mm.id, level.id, chapter.id); }
    return ok(200, body);
  }

  // ═══════════════════ §11 收益分配 / 钱包提现 ═══════════════════
  // ── P0-9 分配意愿（巡查 5% / 销售 5%） ──
  //   两块可自定义分配对象（本人 / 上级代理 / 合作代理 / 总部，比例自填合计 100%），默认规则与单笔指派权限在总部后台。
```
</details>

## 299. 两块可自定义分配对象（本人 / 上级代理 / 合作代理 / 总部，比例自填合计 100%），默认规则与单笔指派权限在总部后台。
`GET http://localhost:3000/^\/income\/entries\/[^/]+\/allocation-options$/.test(p) && m === 'GET'`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:773`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (/^\/income\/entries\/[^/]+\/allocation-options$/.test(p) && m === 'GET') {
    const id = p.split('/')[3];
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const entry = db.commissions.find((c) => c.id === id && (c.owner_id === uid));
    if (!entry) return fail(404, '收益不存在');
    const a = ALC.allocatable(db, entry);
    if (!a.ok) return fail(400, a.reason);
    const cands = ALC.candidates(db, entry);
    return ok(200, {
      entryId: id,
      bizType: a.kind, bizTypeLabel: a.scheme ? a.scheme.label : a.kind,
      allocationKind: ALC.publicKind(a.kind),
      allocationStatus: entry.allocationStatus || 'NONE',
      scheme: ALC.scheme(db),
      // 前端弹窗直接消费：fields[targetId].options 即原型那几项收益方
      fields: [{
        key: 'targetId',
        label: a.kind === 'sales' ? '销售方' : '巡查方',
        type: 'enum',
        options: cands.map((c) => ({
          value: c.value, label: c.label, name: c.name || '',
          needsId: !!c.needsId, available: c.available !== false,
          unavailableReason: c.unavailableReason || null,
        })),
      }],
      candidates: cands,
      balances: { available: walletAvailable(db, uid), entryAmount: entry.amount },
      allowedActions: ['quote', 'submit'], version: 1,
      note: '巡查 5% / 销售 5% 可自定义分配对象与比例，合计须 100%；「其他代理」需填写对应代理 ID',
    });
  }
```
</details>

## 300. 业务操作接口
`POST http://localhost:3000/^\/income\/entries\/[^/]+\/allocation-quotes$/.test(p) && m === 'POST'`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:804`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|targets|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|targetId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|percent|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|allocationKind|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|agentId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### 请求 JSON 示例
```json
{
  "targets": "示例值",
  "targetId": "有效资源ID",
  "percent": "示例值",
  "allocationKind": "示例值",
  "agentId": "有效资源ID"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (/^\/income\/entries\/[^/]+\/allocation-quotes$/.test(p) && m === 'POST') {
    const id = p.split('/')[3];
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const entry = db.commissions.find((c) => c.id === id && (c.owner_id === uid));
    if (!entry) return fail(404, '收益不存在');
    const b = await readBodyOnce();
    const targets = Array.isArray(b.targets) && b.targets.length
      ? b.targets
      : (b.targetId ? [{ targetId: b.targetId, percent: Number(b.percent) || 100, kind: b.allocationKind, agentId: b.agentId }] : []);
    const q2 = ALC.quote(db, entry, { targets, kind: b.allocationKind });
    if (!q2.valid) return ok(200, { valid: false, errors: q2.errors, entryId: id, entryAmount: q2.entryAmount, rows: q2.rows });
    // 报价单落库：前端提交时可只带 quoteId，服务端据此还原分配方案
    const quoteId = ALC.saveQuote(db, {
      entryId: id, userId: uid, kind: q2.kind, targets,
      entryAmount: q2.entryAmount, rows: q2.rows,
      totalPercent: q2.totalPercent, totalAmount: q2.totalAmount,
    });
    save();
    return ok(200, {
      valid: true, id: quoteId, quoteId, entryId: id,
      kind: ALC.publicKind(q2.kind), internalKind: q2.kind, kindLabel: q2.kindLabel,
      entryAmount: q2.entryAmount, rows: q2.rows, totalPercent: q2.totalPercent, totalAmount: q2.totalAmount,
      settlementNote: q2.settlementNote, expiresAt: nowMs() + ALC.QUOTE_TTL, serverTime: nowMs(),
    });
  }
```
</details>

## 301. 业务操作接口
`POST http://localhost:3000/^\/income\/entries\/[^/]+\/allocations$/.test(p) && m === 'POST'`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:829`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|idempotencyKey|JSON|条件/未显式声明|读取及校验规则见下方实现|request-20261029-001|
|targets|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|targetId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|percent|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|allocationKind|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|agentId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|quoteId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### 请求 JSON 示例
```json
{
  "idempotencyKey": "request-20261029-001",
  "targets": "示例值",
  "targetId": "有效资源ID",
  "percent": "示例值",
  "allocationKind": "示例值",
  "agentId": "有效资源ID",
  "quoteId": "有效资源ID"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (/^\/income\/entries\/[^/]+\/allocations$/.test(p) && m === 'POST') {
    const id = p.split('/')[3];
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const entry = db.commissions.find((c) => c.id === id && (c.owner_id === uid));
    if (!entry) return fail(404, '收益不存在');
    const b = await readBodyOnce();
    if (!b.idempotencyKey) return fail(400, 'idempotencyKey 必填');
    const targets = Array.isArray(b.targets) && b.targets.length
      ? b.targets
      : (b.targetId ? [{ targetId: b.targetId, percent: Number(b.percent) || 100, kind: b.allocationKind, agentId: b.agentId }] : []);
    try {
      const r = ALC.submit(db, entry, {
        targets, kind: b.allocationKind,
        quoteId: b.quoteId || null,          // 只带 quoteId 也能提交（前端主路径）
        idempotencyKey: b.idempotencyKey, operatorId: uid,
      });
      save();
      return ok(200, { status: r.status, allocationId: r.allocationId, operationId: rid('op'), rows: r.rows });
    } catch (e) { return fail(400, e.message); }
  }
```
</details>

## 302. 业务操作接口
`POST http://localhost:3000/^\/income\/entries\/[^/]+\/allocations\/[^/]+\/revoke$/.test(p) && m === 'POST'`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:849`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### 请求 JSON 示例
```json
{}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (/^\/income\/entries\/[^/]+\/allocations\/[^/]+\/revoke$/.test(p) && m === 'POST') {
    const entryId = p.split('/')[3];
    const allocationId = p.split('/')[5];
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const entry = db.commissions.find((c) => c.id === entryId && (c.owner_id === uid));
    if (!entry) return fail(404, '收益不存在');
    try {
      const rec = ALC.revoke(db, allocationId, { operatorId: uid });
      save();
      return ok(200, { status: rec.status, allocationId: rec.id });
    } catch (e) { return fail(400, e.message); }
  }
```
</details>

## 303. 钱包查询接口
`GET http://localhost:3000/wallet/withdrawal-options`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:861`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/wallet/withdrawal-options' && m === 'GET') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const payees = db.payees.filter((x) => x.userId === uid).map(({ bankNumber, ...rest }) => rest);
    return ok(200, {
      balance: walletAvailable(db, uid), minAmount: WITHDRAW.min, maxAmount: WITHDRAW.max,
      feeRate: WITHDRAW.feeRate, feeMin: WITHDRAW.feeMin, feeNote: `手续费 ${(WITHDRAW.feeRate * 100).toFixed(1)}%（最低 ${WITHDRAW.feeMin} 元）`,
      arriveNote: WITHDRAW.arriveNote, accountTypes: ['PERSONAL', 'COMPANY'], payees,
      allowedActions: ['create-payee', 'quote', 'submit'],
    });
  }
```
</details>

## 304. 钱包操作接口
`POST http://localhost:3000/wallet/payees`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:871`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|accountType|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|name|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|bankName|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|bankNumber|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "accountType": "示例值",
  "name": "示例值",
  "bankName": "示例值",
  "bankNumber": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/wallet/payees' && m === 'POST') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const b = await readBodyOnce();
    if (!b.accountType || !b.name || !b.bankName || !b.bankNumber) return fail(400, 'accountType、name、bankName、bankNumber 必填');
    if (!['PERSONAL', 'COMPANY'].includes(b.accountType)) return fail(400, 'accountType 为 PERSONAL/COMPANY');
    const num = String(b.bankNumber).replace(/\s/g, '');
    if (!/^\d{16,19}$/.test(num)) return fail(400, '银行卡号须为 16–19 位数字');
    const rec = { token: rid('payee'), userId: uid, accountType: b.accountType, name: String(b.name).trim(), bankName: String(b.bankName).trim(), bankNumber: num, maskedBankNumber: '****' + num.slice(-4), createdAt: nowMs() };
    db.payees.push(rec); save();
    const { bankNumber, ...pub } = rec;
    return ok(200, { payeeToken: rec.token, payee: pub });
  }
```
</details>

## 305. 钱包操作接口
`POST http://localhost:3000/wallet/withdrawal-quotes`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:883`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|accountType|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|payeeToken|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|amount|number|条件/未显式声明|读取及校验规则见下方实现|1|

### 请求 JSON 示例
```json
{
  "accountType": "示例值",
  "payeeToken": "示例值",
  "amount": 1
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/wallet/withdrawal-quotes' && m === 'POST') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const b = await readBodyOnce();
    if (!b.accountType || !b.payeeToken || b.amount == null) return fail(400, 'accountType、payeeToken、amount 必填');
    const payee = db.payees.find((x) => x.token === b.payeeToken && x.userId === uid);
    if (!payee) return fail(404, '收款账户不存在');
    if (payee.accountType !== b.accountType) return fail(400, '账户类型与收款账户不一致');
    const amount = round2(Number(b.amount));
    if (!(amount >= WITHDRAW.min)) return fail(400, `单笔提现最低 ${WITHDRAW.min} 元`);
    if (amount > WITHDRAW.max) return fail(400, `单笔提现最高 ${WITHDRAW.max} 元`);
    const balance = walletAvailable(db, uid);
    if (amount > balance) return fail(400, `可提现余额不足（当前 ${balance} 元）`);
    const fee = Math.max(WITHDRAW.feeMin, round2(amount * WITHDRAW.feeRate));
    const netAmount = round2(amount - fee);
    return ok(200, {
      id: rid('quote'), accountType: b.accountType, payeeToken: b.payeeToken, amount, fee, netAmount,
      payee: { name: payee.name, bankName: payee.bankName, maskedBankNumber: payee.maskedBankNumber, accountType: payee.accountType },
      arriveNote: WITHDRAW.arriveNote, expiresAt: nowMs() + 600000, serverTime: nowMs(),
    });
  }
```
</details>

## 306. 钱包操作接口
`POST http://localhost:3000/wallet/withdrawals`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:903`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|quoteId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|idempotencyKey|JSON|条件/未显式声明|读取及校验规则见下方实现|request-20261029-001|
|payeeToken|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|amount|number|条件/未显式声明|读取及校验规则见下方实现|1|

### 请求 JSON 示例
```json
{
  "quoteId": "有效资源ID",
  "idempotencyKey": "request-20261029-001",
  "payeeToken": "示例值",
  "amount": 1
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/wallet/withdrawals' && m === 'POST') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const b = await readBodyOnce();
    if (!b.quoteId || !b.idempotencyKey) return fail(400, 'quoteId 与 idempotencyKey 必填');
    const idem = IDEM.check({ list: db.withdrawals, key: b.idempotencyKey, payload: { payeeToken: b.payeeToken || null, amount: b.amount == null ? null : Number(b.amount) } });
    if (idem.conflict) return fail(409, idem.conflictReason);
    if (idem.duplicated) {
      const dup = idem.record;
      return ok(200, { status: dup.status, withdrawalId: dup.id, operationId: dup.operationId });
    }
    if (!b.payeeToken || b.amount == null) return fail(400, 'quoteId 无效（缺少收款信息）');
    const payee = db.payees.find((x) => x.token === b.payeeToken && x.userId === uid);
    if (!payee) return fail(404, '收款账户不存在');
    const amount = round2(Number(b.amount));
    if (!(amount >= WITHDRAW.min) || amount > WITHDRAW.max) return fail(400, '提现金额超出限制');
    const balance = walletAvailable(db, uid);
    if (amount > balance) return fail(400, `可提现余额不足（当前 ${balance} 元）`);
    const fee = Math.max(WITHDRAW.feeMin, round2(amount * WITHDRAW.feeRate));
    const rec = IDEM.stamp({
      id: rid('wdl'), userId: uid, title: '余额提现', amount, fee, netAmount: round2(amount - fee),
      status: 'PENDING_REVIEW', accountType: payee.accountType, accountName: payee.name,
      bankName: payee.bankName, maskedBankNumber: payee.maskedBankNumber,
      operationId: rid('op'), idempotencyKey: b.idempotencyKey, createdAt: nowMs(),
      __idemPayload: { payeeToken: b.payeeToken || null, amount: round2(Number(b.amount)) },
    });
    db.withdrawals.push(rec); save();
    return ok(200, { status: 'PENDING_REVIEW', withdrawalId: rec.id, operationId: rec.operationId });
  }
```
</details>

## 307. 钱包查询接口
`GET http://localhost:3000/wallet/withdrawals`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:931`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/wallet/withdrawals' && m === 'GET') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const items = db.withdrawals.filter((w) => w.userId === uid).map((w) => ({
      id: w.id, title: w.title, amount: w.amount, fee: w.fee, netAmount: w.netAmount, status: w.status,
      accountType: w.accountType, accountName: w.accountName, bankName: w.bankName,
      maskedBankNumber: w.maskedBankNumber, createdAt: new Date(w.createdAt).toISOString(),
    }));
    return ok(200, { items, hasMore: false, nextCursor: null });
  }

  // ═══════════════════ §12 遗留：申请列表 / 邀请落地页 ═══════════════════
```
</details>

## 308. §12 遗留：申请列表 / 邀请落地页
`GET http://localhost:3000/applications`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:942`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|type|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/applications' && m === 'GET') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const type = (q('type') || 'COSTORE').toUpperCase();
    const items = db.applications.filter((a) => a.userId === uid && (type === 'ALL' || a.type === type)).map(publicApplication);
    return ok(200, { items, hasMore: false, nextCursor: null });
  }
```
</details>

## 309. 业务查询接口
`GET http://localhost:3000/promotion/invitations/{动态路径}`
原始匹配：`p.startsWith('/promotion/invitations/') && m === 'GET'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:948`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.startsWith('/promotion/invitations/') && m === 'GET') {
    const promotionId = p.slice('/promotion/invitations/'.length);
    const uid = promotionId.replace(/^promo-/, '');
    const u = db.users[uid];
    if (!u) return fail(404, '推广不存在');
    const ag = db.regionalAgents.find((a) => a.partner_id === uid);
    const agencyType = ag ? (AGENCY_TYPE_MAP[ag.region_type] || 'STORE') : 'STORE';
    const regionType = REGION_TYPE_OF[agencyType] || 'store';
    const tiers = (RA.AGENT_PRICE_TABLE[regionType] || {}).tiers || [];
    const payableAmount = tiers.length ? tiers[tiers.length - 1].total : 0;
    return ok(200, {
      promotionId, agencyType, label: `${AGENCY_TYPE_CN[agencyType]}邀请（${u.name}）`, payableAmount,
      agreement: { version: 'v1', content: nodes(heading('代理申请协议'), para(`申请成为${AGENCY_TYPE_CN[agencyType]}，认可平台代理规则与分润方案。`)) },
    });
  }

  // ═══════════════════ §13 门店 / 健脑官 / 反馈 / 转店 ═══════════════════
```
</details>

## 310. §13 门店 / 健脑官 / 反馈 / 转店
`GET http://localhost:3000/agency/store-workspace`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:965`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|assignmentId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/agency/store-workspace' && m === 'GET') {
    const uid = await agencyUserId(db, ctx); if (uid === null) return true;
    const assignmentId = q('assignmentId');
    if (!assignmentId) return fail(400, 'assignmentId 必填');
    const store = storeById(db, assignmentId);
    if (!store) return fail(404, '门店不存在');
    const staff = db.coaches.filter((c) => c.storeId === store.id).map(publicCoach);
    const approvals = db.applications.filter((a) => a.storeAgentId === store.id && ['PENDING_REVIEW', 'PENDING'].includes(a.applicationStatus)).map(publicApplication);
    const members = db.members.filter((mm) => mm.storeId === store.id).map(publicMember);
    const cs = db.coStores.find((c) => c.owner_id === store.id);
    const owners = cs ? (cs.owners || []).map((o) => { const ou = db.users[o.id]; return { id: o.id, name: ou ? ou.name : o.id, performance: o.performance || 0 }; }) : [];
    return ok(200, { store, staff, approvals, members, owners, allowedActions: ['update-store', 'manage-coach', 'decide-application', 'update-training', 'create-feedback', 'transfer-member'] });
  }
  // 注意：/stores/{storeId}/coaches[/{id}] 必须位于通用 PATCH /stores/{id} 之前。
```
</details>

## 311. 注意：/stores/{storeId}/coaches[/{id}] 必须位于通用 PATCH /stores/{id} 之前。
`POST http://localhost:3000/{动态路径}`
原始匹配：`p.match(/^\/stores\/[^/]+\/coaches$/) && m === 'POST'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:979`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|name|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|loginAccount|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|idempotencyKey|JSON|条件/未显式声明|读取及校验规则见下方实现|request-20261029-001|

### 请求 JSON 示例
```json
{
  "name": "示例值",
  "loginAccount": "示例值",
  "idempotencyKey": "request-20261029-001"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.match(/^\/stores\/[^/]+\/coaches$/) && m === 'POST') {
    const storeId = p.split('/')[2];
    const uid = await agencyUserId(db, ctx); if (uid === null) return true;
    const store = storeById(db, storeId);
    if (!store) return fail(404, '门店不存在');
    const b = await readBodyOnce();
    if (!b.name || !b.loginAccount) return fail(400, 'name 与 loginAccount 必填');
    if (!b.idempotencyKey) return fail(400, 'idempotencyKey 必填');
    const idem = IDEM.check({ list: db.coaches, key: b.idempotencyKey, payload: { storeId: store.id, name: String(b.name).trim(), loginAccount: String(b.loginAccount) } });
    if (idem.conflict) return fail(409, idem.conflictReason);
    if (idem.duplicated) return ok(200, { coach: publicCoach(idem.record) });
    if (!/^[a-zA-Z0-9_-]{4,32}$/.test(String(b.loginAccount))) return fail(400, '登录名须为 4–32 位字母、数字、下划线或短横线');
    if (db.coaches.some((c) => c.loginAccount === b.loginAccount)) return fail(409, '登录名已被占用');
    const rec = IDEM.stamp({ id: rid('co'), storeId: store.id, name: String(b.name).trim(), loginAccount: String(b.loginAccount), status: 'ACTIVE', invitationStatus: 'PENDING', version: 1, idempotencyKey: b.idempotencyKey, createdAt: nowMs() }, { storeId: store.id, name: String(b.name).trim(), loginAccount: String(b.loginAccount) });
    db.coaches.push(rec); save();
    return ok(200, { coach: publicCoach(rec) });
  }
```
</details>

## 312. 业务操作接口
`PATCH http://localhost:3000/{动态路径}`
原始匹配：`p.match(/^\/stores\/[^/]+\/coaches\/[^/]+$/) && m === 'PATCH'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:996`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|name|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|loginAccount|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|status|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "version": 1,
  "name": "示例值",
  "loginAccount": "示例值",
  "status": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.match(/^\/stores\/[^/]+\/coaches\/[^/]+$/) && m === 'PATCH') {
    const storeId = p.split('/')[2];
    const uid = await agencyUserId(db, ctx); if (uid === null) return true;
    const store = storeById(db, storeId);
    if (!store) return fail(404, '门店不存在');
    const coach = db.coaches.find((c) => c.id === p.split('/')[4] && c.storeId === store.id);
    if (!coach) return fail(404, '健脑官不存在');
    const b = await readBodyOnce();
    if (b.version == null || Number(b.version) !== coach.version) return fail(409, `version 不匹配（当前 ${coach.version}）`);
    if (b.name != null) coach.name = String(b.name).trim();
    if (b.loginAccount != null) {
      if (!/^[a-zA-Z0-9_-]{4,32}$/.test(String(b.loginAccount))) return fail(400, '登录名格式不合法');
      if (db.coaches.some((c) => c.loginAccount === b.loginAccount && c.id !== coach.id)) return fail(409, '登录名已被占用');
      coach.loginAccount = String(b.loginAccount);
    }
    if (b.status != null && ['ACTIVE', 'DISABLED'].includes(b.status)) coach.status = b.status;
    coach.version += 1; save();
    return ok(200, { coach: publicCoach(coach) });
  }
  // ───────────── P0-6 线下交付核销（门店工作台 / 总部 / 健脑官） ─────────────
```
</details>

## 313. P0-6 线下交付核销（门店工作台 / 总部 / 健脑官）
`POST http://localhost:3000/{动态路径}`
原始匹配：`p.match(/^\/stores\/[^/]+\/orders\/[^/]+\/verify$/) && m === 'POST'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:1016`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|code|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "code": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.match(/^\/stores\/[^/]+\/orders\/[^/]+\/verify$/) && m === 'POST') {
    const storeId = p.split('/')[2];
    const orderNo = p.split('/')[4];
    const b = await ctx.readBodyOnce();
    let operatorId = null, verifyStoreId = null;
    if (sess.role === 'admin') {
      operatorId = 'HQ';
      verifyStoreId = storeId || null; // 总部代核销，门店以路径参数为准
    } else if (sess.role === 'coach') {
      operatorId = sess.coachId;
      const st = storeById(db, sess.storeId);
      verifyStoreId = (st && st.regionCode) || sess.storeId || storeId || null;
    } else if (sess.role === 'user') {
      const st = storeById(db, storeId);
      if (!st || st.kind !== 'agent') return fail(403, '当前账号非门店老板，无权核销');
      const sa = db.regionalAgents.find((a) => a.partner_id === sess.userId && a.region_type === 'store' && a.region_code === st.regionCode);
      if (!sa) return fail(403, '当前账号非该门店老板，无权核销');
      operatorId = sess.userId;
      verifyStoreId = st.regionCode;
    } else {
      return fail(403, '无权核销');
    }
    let r;
    try {
      r = OL.verify(db, { storeId: verifyStoreId, orderNo, code: b.code, operatorId });
    } catch (e) {
      return fail(400, e.message);
    }
    save();
    return ok(200, {
      orderId: r.order.id, status: 'COMPLETED', deliveryMode: r.deliveryMode,
      activationCode: r.activationCode, verifiedAt: r.verifiedAt,
      verifyStore: r.order.verify_store || verifyStoreId || storeId,
    });
  }
  // 通用门店修改（置于 /stores/{id}/coaches 子路径之后，避免抢先匹配）
```
</details>

## 314. 通用门店修改（置于 /stores/{id}/coaches 子路径之后，避免抢先匹配）
`PATCH http://localhost:3000/stores/{动态路径}`
原始匹配：`p.startsWith('/stores/') && m === 'PATCH'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:1052`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|name|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|address|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|contact|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "name": "示例值",
  "address": "示例值",
  "version": 1,
  "contact": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.startsWith('/stores/') && m === 'PATCH') {
    const id = p.slice('/stores/'.length);
    const uid = await agencyUserId(db, ctx); if (uid === null) return true;
    const b = await readBodyOnce();
    if (b.name == null || b.address == null || b.version == null) return fail(400, 'name、address、version 必填');
    if (String(b.name).length > 60) return fail(400, '名称最多 60 字');
    if (String(b.address).length > 200) return fail(400, '地址最多 200 字');
    const ag = db.regionalAgents.find((a) => a.partner_id === id && a.region_type === 'store');
    if (!ag) return fail(404, '门店不存在');
    if (ag.store_version && Number(b.version) !== ag.store_version) return fail(409, `version 不匹配（当前 ${ag.store_version}）`);
    ag.store_name = String(b.name).trim(); ag.store_address = String(b.address).trim();
    if (b.contact != null) ag.store_contact = String(b.contact).trim();
    ag.store_version = (ag.store_version || 1) + 1; save();
    return ok(200, { store: { id: ag.partner_id, name: ag.store_name, address: ag.store_address, contact: ag.store_contact || '', version: ag.store_version } });
  }
```
</details>

## 315. 业务操作接口
`POST http://localhost:3000/{动态路径}`
原始匹配：`p.match(/^\/applications\/[^/]+\/decisions$/) && m === 'POST'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:1067`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|version|number|条件/未显式声明|资源版本，按业务执行乐观锁校验|1|
|decision|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|

### 请求 JSON 示例
```json
{
  "version": 1,
  "decision": "示例值",
  "reason": "业务调整"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.match(/^\/applications\/[^/]+\/decisions$/) && m === 'POST') {
    const id = p.split('/')[2];
    const b = await readBodyOnce();
    const app = db.applications.find((a) => a.id === id);
    if (!app) return fail(404, '申请不存在');
    if (b.version == null || Number(b.version) !== app.version) return fail(409, `version 不匹配（当前 ${app.version}）`);
    if (!['APPROVE', 'REJECT'].includes(b.decision || '')) return fail(400, 'decision 为 APPROVE/REJECT');
    if (b.decision === 'REJECT' && !b.reason) return fail(400, '拒绝须填 reason');
    if (b.decision === 'REJECT' && String(b.reason).length > 200) return fail(400, 'reason 最多 200 字');
    const isAdmin = ctx.sess.role === 'admin';
    const isStoreAgent = ctx.sess.role === 'user' && app.storeAgentId && app.storeAgentId === ctx.sess.userId;
    if (!isAdmin && !isStoreAgent) return fail(403, '无权审批该申请');
    if (!['PENDING_REVIEW', 'PENDING'].includes(app.applicationStatus)) return fail(409, '申请不在待审状态');
    app.applicationStatus = b.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    app.decisionReason = b.reason || null;
    app.decidedAt = nowMs(); app.version += 1;
    let nextStep = null;
    if (b.decision === 'APPROVE') {
      if (app.type === 'TRANSFER') {
        const mm = memberOf(db, app.memberId);
        if (mm) mm.storeId = app.targetStoreId;
        nextStep = '会员归属已变更';
      } else {
        app.paymentStatus = 'WAITING_PAYMENT';
        nextStep = '等待支付';
      }
    }
    save();
    return ok(200, { status: app.applicationStatus, nextStep });
  }
```
</details>

## 316. 业务查询接口
`GET http://localhost:3000/coach/workspace`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:1097`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/coach/workspace' && m === 'GET') {
    if (ctx.sess.role !== 'coach') return fail(403, '仅健脑官身份可访问');
    const store = storeById(db, ctx.sess.storeId);
    if (!store) return fail(404, '任职门店不存在');
    const members = db.members.filter((mm) => mm.storeId === store.id).map(publicMember);
    return ok(200, { contextId: `coach:${ctx.sess.coachId}`, name: ctx.sess.name || '', store: { id: store.id, name: store.name }, members, allowedActions: ['view-member', 'update-training', 'create-feedback'] });
  }
```
</details>

## 317. 业务操作接口
`POST http://localhost:3000/training-feedback`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:1104`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|memberId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|kind|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|title|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|text|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|idempotencyKey|JSON|条件/未显式声明|读取及校验规则见下方实现|request-20261029-001|
|imageAssetIds|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|attachmentAssetIds|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "memberId": "有效资源ID",
  "kind": "示例值",
  "title": "示例值",
  "text": "示例值",
  "idempotencyKey": "request-20261029-001",
  "imageAssetIds": "示例值",
  "attachmentAssetIds": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/training-feedback' && m === 'POST') {
    const b = await readBodyOnce();
    if (!b.memberId || !b.kind || !b.title || !b.text) return fail(400, 'memberId、kind、title、text 必填');
    if (!b.idempotencyKey) return fail(400, 'idempotencyKey 必填');
    if (!['training', 'self-study', 'camp'].includes(b.kind)) return fail(400, 'kind 为 training/self-study/camp');
    const title = String(b.title).trim(); const text = String(b.text).trim();
    if (title.length < 1 || title.length > 80) return fail(400, '标题 1–80 字');
    if (text.length < 1 || text.length > 3000) return fail(400, '正文 1–3000 字');
    const mm = memberOf(db, b.memberId);
    if (!mm || !canManageMember(db, ctx, mm)) return fail(404, '会员不存在');
    const idem = IDEM.check({ list: db.trainingFeedback, key: b.idempotencyKey, payload: { memberId: b.memberId, title, text, imageAssetIds: b.imageAssetIds || [], attachmentAssetIds: b.attachmentAssetIds || [] } });
    if (idem.conflict) return fail(409, idem.conflictReason);
    if (idem.duplicated) return ok(200, { id: idem.record.id });
    const imgs = Array.isArray(b.imageAssetIds) ? b.imageAssetIds : [];
    const atts = Array.isArray(b.attachmentAssetIds) ? b.attachmentAssetIds : [];
    if (imgs.length > 6) return fail(400, '图片最多 6 张');
    if (atts.length > 6) return fail(400, '附件最多 6 个');
    for (const aid of [...imgs, ...atts]) { const ast = db.assets.find((a) => a.id === aid); if (!ast || ast.status !== 'READY') return fail(400, `资源 ${aid} 未就绪`); }
    const rec = IDEM.stamp({
      id: rid('tfb'), memberId: mm.id, kind: b.kind, title, text,
      coachId: ctx.sess.role === 'coach' ? ctx.sess.coachId : null,
      coachName: ctx.sess.role === 'coach' ? (ctx.sess.name || '健脑官') : (ctx.sess.role === 'admin' ? '总部' : '家长'),
      imageAssetIds: imgs, attachmentAssetIds: atts, idempotencyKey: b.idempotencyKey, createdAt: nowMs(),
      __idemPayload: { memberId: b.memberId, title, text, imageAssetIds: b.imageAssetIds || [], attachmentAssetIds: b.attachmentAssetIds || [] },
    });
    db.trainingFeedback.push(rec); save();
    return ok(200, { id: rec.id });
  }
```
</details>

## 318. 业务查询接口
`GET http://localhost:3000/training-feedback/{动态路径}`
原始匹配：`p.startsWith('/training-feedback/') && m === 'GET'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:1132`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.startsWith('/training-feedback/') && m === 'GET') {
    const f = db.trainingFeedback.find((x) => x.id === p.slice('/training-feedback/'.length));
    if (!f) return fail(404, '反馈不存在');
    const mm = memberOf(db, f.memberId);
    if (!canManageMember(db, ctx, mm)) return fail(403, '无权查看该反馈');
    return ok(200, publicFeedback(f, db));
  }
```
</details>

## 319. 业务查询接口
`GET http://localhost:3000/store-transfer/options`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:1139`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|memberId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|keyword|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/store-transfer/options' && m === 'GET') {
    const uid = await agencyUserId(db, ctx); if (uid === null) return true;
    const memberId = q('memberId');
    if (!memberId) return fail(400, 'memberId 必填');
    const mm = memberOf(db, memberId);
    if (!mm || !canTransferMember(db, ctx, mm)) return fail(404, '会员不存在');
    const keyword = (q('keyword') || '').trim();
    let stores = db.regionalAgents.filter((a) => a.region_type === 'store').map((a) => ({ id: a.partner_id, name: a.store_name || `脑商线下店 ${a.region_code}`, address: a.store_address || '', regionCodes: [a.region_code] }));
    stores = stores.concat(db.coStores.map((c) => ({ id: c.owner_id, name: `合店 ${c.store_id}`, address: '', regionCodes: [c.store_id] })));
    if (keyword) stores = stores.filter((s) => s.name.includes(keyword) || s.id.includes(keyword));
    const current = mm.storeId ? storeById(db, mm.storeId) : null;
    return ok(200, { currentStore: current ? { id: current.id, name: current.name } : null, stores });
  }
```
</details>

## 320. 业务操作接口
`POST http://localhost:3000/store-transfer/applications`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:1152`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|memberId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|targetStoreId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|reason|JSON|条件/未显式声明|操作原因；可能允许 X-Reason Header|业务调整|
|idempotencyKey|JSON|条件/未显式声明|读取及校验规则见下方实现|request-20261029-001|

### 请求 JSON 示例
```json
{
  "memberId": "有效资源ID",
  "targetStoreId": "有效资源ID",
  "reason": "业务调整",
  "idempotencyKey": "request-20261029-001"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/store-transfer/applications' && m === 'POST') {
    const uid = await agencyUserId(db, ctx); if (uid === null) return true;
    const b = await readBodyOnce();
    if (!b.memberId || !b.targetStoreId || !b.reason) return fail(400, 'memberId、targetStoreId、reason 必填');
    if (!b.idempotencyKey) return fail(400, 'idempotencyKey 必填');
    const mm = memberOf(db, b.memberId);
    if (!mm || !canTransferMember(db, ctx, mm)) return fail(404, '会员不存在');
    const idem = IDEM.check({ list: db.storeTransfers, key: b.idempotencyKey, payload: { memberId: mm.id, targetStoreId: b.targetStoreId, reason: b.reason } });
    if (idem.conflict) return fail(409, idem.conflictReason);
    if (idem.duplicated) return ok(200, { application: idem.record });
    if (db.storeTransfers.some((t) => t.memberId === mm.id && t.status === 'PENDING')) return fail(409, '该会员已有待审转店申请');
    const target = storeById(db, b.targetStoreId);
    if (!target) return fail(404, '目标门店不存在');
    if (mm.storeId && mm.storeId === b.targetStoreId) return fail(400, '目标门店与当前门店相同');
    const rec = IDEM.stamp({
      id: rid('trs'), type: 'TRANSFER', memberId: mm.id, fromStoreId: mm.storeId || null, targetStoreId: target.id,
      reason: String(b.reason).trim(), status: 'PENDING', userId: uid, storeAgentId: target.id,
      idempotencyKey: b.idempotencyKey, createdAt: nowMs(), version: 1,
      __idemPayload: { memberId: mm.id, targetStoreId: b.targetStoreId, reason: b.reason },
    });
    db.storeTransfers.push(rec);
    db.applications.push({
      id: rec.id, type: 'TRANSFER', title: '转店申请', applicationStatus: 'PENDING',
      paymentStatus: 'NOT_STARTED', contractStatus: 'NOT_SIGNED', entitlementStatus: 'NOT_OPEN',
      userId: uid, storeId: target.id, storeAgentId: target.id, memberId: mm.id, targetStoreId: target.id,
      payableAmount: 0, store: { id: target.id, name: target.name }, createdAt: new Date(nowMs()).toISOString(), version: 1,
    });
    save();
    return ok(200, { application: { id: rec.id, type: 'TRANSFER', memberId: mm.id, targetStoreId: rec.targetStoreId, status: 'PENDING', version: 1 } });
  }

  // ═══════════════════ §14 上传资源 / 素材库 / 海报合成 ═══════════════════
```
</details>

## 321. §14 上传资源 / 素材库 / 海报合成
`POST http://localhost:3000/assets/upload-intents`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:1184`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|purpose|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|fileName|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|mimeType|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|size|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "purpose": "示例值",
  "fileName": "示例值",
  "mimeType": "示例值",
  "size": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/assets/upload-intents' && m === 'POST') {
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const b = await readBodyOnce();
    if (!b.purpose || !b.fileName || !b.mimeType || b.size == null) return fail(400, 'purpose、fileName、mimeType、size 必填');
    const rule = ASSET_RULES[b.purpose];
    if (!rule) return fail(400, `purpose 不支持（可用：${Object.keys(ASSET_RULES).join('/')}）`);
    if (!rule.mimes.includes(b.mimeType)) return fail(400, `${rule.label}仅支持 ${rule.mimes.join('、')}`);
    const size = Number(b.size);
    if (!Number.isFinite(size) || size <= 0) return fail(400, 'size 不合法');
    if (size > rule.maxSize) return fail(400, `${rule.label}大小不能超过 ${Math.floor(rule.maxSize / 1024 / 1024)}MB`);
    const id = rid('ast');
    const rec = { id, userId: uid, purpose: b.purpose, fileName: String(b.fileName), mimeType: b.mimeType, size, status: 'PENDING', createdAt: nowMs() };
    db.assets.push(rec); save();
    // 问题4：fileId 与 assetId 是**同一个 id**，两种叫法都返回，前端任选其一都能提交申请。
    // ⚠️ 这只是「上传凭证」——前端必须真的把文件 PUT/POST 到 uploadUrl，再调
    //    POST /assets/{id}/completions 确认，服务端才会把 status 置为 READY。
    //    未 READY 的凭证 id 直接提交申请会被拒绝（见 /agency/applications 的资源校验）。
    return ok(200, {
      assetId: id, fileId: id,
      mode: 'multipart', uploadUrl: `https://upload.naoshang.example.com/${id}`,
      fileField: 'file', headers: {}, fields: {}, limits: { maxSize: rule.maxSize },
      status: rec.status,
      nextStep: `把文件上传到 uploadUrl（字段名 ${'file'}），然后调用 POST /assets/${id}/completions 确认`,
    });
  }
```
</details>

## 322. 业务操作接口
`POST http://localhost:3000/{动态路径}`
原始匹配：`p.match(/^\/assets\/[^/]+\/(completions|complete)$/) && m === 'POST'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:1209`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### 请求 JSON 示例
```json
{}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.match(/^\/assets\/[^/]+\/(completions|complete)$/) && m === 'POST') {
    const id = p.split('/')[2];
    const ast = db.assets.find((a) => a.id === id);
    if (!ast) return fail(404, '资源不存在');
    if (ctx.sess.role !== 'admin' && ast.userId !== ctx.sess.userId) return fail(403, '资源不属于当前账号');
    if (ast.status === 'READY') return ok(200, { status: 'ready', previewUrl: ast.previewUrl || null });
    const rule = ASSET_RULES[ast.purpose];
    if (!rule.mimes.includes(ast.mimeType) || ast.size > rule.maxSize) { ast.status = 'FAILED'; ast.failReason = '文件类型或大小不符合用途要求'; save(); return fail(400, ast.failReason); }
    ast.status = 'READY';
    ast.previewUrl = `https://cdn.naoshang.example.com/preview/${ast.id}`;
    save();
    return ok(200, { status: 'ready', previewUrl: ast.previewUrl });
  }
```
</details>

## 323. 素材查询接口
`GET http://localhost:3000/materials/categories`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:1222`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|type|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/materials/categories' && m === 'GET') {
    const type = q('type');
    if (!['image', 'article', 'video'].includes(type || '')) return fail(400, 'type 必填且为 image/article/video');
    return ok(200, { categories: MATERIAL_CATEGORIES[type] });
  }
```
</details>

## 324. 素材查询接口
`GET http://localhost:3000/materials`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:1227`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|type|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|categoryId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/materials' && m === 'GET') {
    const type = q('type');
    if (!['image', 'article', 'video'].includes(type || '')) return fail(400, 'type 必填且为 image/article/video');
    let items = MATERIALS.filter((x) => x.type === type);
    if (q('categoryId')) items = items.filter((x) => x.categoryId === q('categoryId'));
    return ok(200, { items: items.map(({ content, ...rest }) => rest), hasMore: false, nextCursor: null });
  }
```
</details>

## 325. 素材查询接口
`GET http://localhost:3000/materials/{动态路径}`
原始匹配：`p.startsWith('/materials/') && m === 'GET'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:1234`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.startsWith('/materials/') && m === 'GET') {
    const mat = MATERIALS.find((x) => x.id === p.slice('/materials/'.length));
    if (!mat) return fail(404, '素材不存在');
    return ok(200, mat);
  }
```
</details>

## 326. 业务操作接口
`POST http://localhost:3000/{动态路径}`
原始匹配：`p.match(/^\/materials\/[^/]+\/renders$/) && m === 'POST'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:1239`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|qrAssetId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|idempotencyKey|JSON|条件/未显式声明|读取及校验规则见下方实现|request-20261029-001|

### 请求 JSON 示例
```json
{
  "qrAssetId": "有效资源ID",
  "idempotencyKey": "request-20261029-001"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.match(/^\/materials\/[^/]+\/renders$/) && m === 'POST') {
    const id = p.split('/')[2];
    const uid = await ownerUserId(db, ctx); if (uid === null) return true;
    const mat = MATERIALS.find((x) => x.id === id);
    if (!mat) return fail(404, '素材不存在');
    const b = await readBodyOnce();
    if (!b.qrAssetId) return fail(400, 'qrAssetId 必填');
    if (!b.idempotencyKey) return fail(400, 'idempotencyKey 必填');
    const qr = db.assets.find((a) => a.id === b.qrAssetId);
    if (!qr) return fail(404, '二维码资源不存在');
    if (ctx.sess.role === 'user' && qr.userId !== ctx.sess.userId) return fail(403, '二维码资源不属于当前账号');
    if (qr.status !== 'READY') return fail(400, '二维码资源未就绪');
    if (qr.purpose !== 'material-qr') return fail(400, '二维码资源用途必须为 material-qr');
    const idem = IDEM.check({ list: db.materialRenders, key: b.idempotencyKey, payload: { materialId: mat.id, qrAssetId: qr.id } });
    if (idem.conflict) return fail(409, idem.conflictReason);
    if (idem.duplicated) return ok(200, { jobId: idem.record.id });
    const job = IDEM.stamp({ id: rid('job'), type: 'POSTER_RENDER', materialId: mat.id, qrAssetId: qr.id, userId: uid, status: 'queued', message: null, idempotencyKey: b.idempotencyKey, createdAt: nowMs() }, { materialId: mat.id, qrAssetId: qr.id });
    db.jobs.push(job); save();
    scheduleJob(db, job, save);
    return ok(200, { jobId: job.id });
  }
```
</details>

## 327. 业务查询接口
`GET http://localhost:3000/jobs/{动态路径}`
原始匹配：`p.startsWith('/jobs/') && m === 'GET'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5biz.js:1260`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|phone|JSON|条件/未显式声明|读取及校验规则见下方实现|13800138000|
|regionCodes|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.startsWith('/jobs/') && m === 'GET') {
    const job = db.jobs.find((j) => j.id === p.slice('/jobs/'.length));
    if (!job) return fail(404, '任务不存在');
    if (ctx.sess.role === 'user' && job.userId !== ctx.sess.userId) return fail(403, '任务不属于当前账号');
    return ok(200, { status: job.status, downloadUrl: job.downloadUrl || null, shareUrl: job.shareUrl || null, message: job.message || null });
  }

  return false; // 不归本层
}

// ───────────── 调度合成任务（测试平台异步模拟） ─────────────
function scheduleJob(db, job, save) {
  setTimeout(() => { job.status = 'processing'; save && save(); }, 400);
  setTimeout(() => {
    job.status = 'succeeded';
    job.downloadUrl = `https://cdn.naoshang.example.com/posters/${job.id}.png`;
    job.shareUrl = `https://h5.naoshang.example.com/poster/${job.id}`;
    save && save();
  }, 1800);
}

// ───────────── 输出整形 ─────────────
function publicAddress(a) {
  return { id: a.id, recipient: a.recipient, phone: a.phone, regionCodes: a.regionCodes, regionNames: a.regionNames, detail: a.detail, isDefault: a.isDefault, version: a.version };
}
function validateAddress(b, isPatch) {
  const req = ['recipient', 'phone', 'regionCodes', 'detail'];
  for (const k of req) if (!isPatch || b[k] != null) { if (b[k] == null || (typeof b[k] === 'string' && !b[k].trim())) return `${k} 必填`; }
  if (b.phone != null && !/^1\d{10}$/.test(String(b.phone).trim())) return 'phone 须为 11 位手机号';
  if (b.regionCodes != null && (!Array.isArray(b.regionCodes) || b.regionCodes.length !== 3)) return 'regionCodes 须为三级编码';
  return null;
}
function progressOf(db, memberId, levelId, chapterId) {
  const r = db.learningProgress.find((x) => x.memberId === memberId && x.levelId === levelId && x.chapterId === chapterId);
  return r ? { positionSeconds: r.positionSeconds, durationSeconds: r.durationSeconds, completed: r.completed } : { positionSeconds: 0, durationSeconds: 0, completed: false };
}
function publicMember(mm) {
  return {
    id: mm.id, contextId: `member:${mm.id}`, displayId: mm.display_id || mm.id, name: mm.name, avatarUrl: mm.avatarUrl || null,
    gradeCode: mm.gradeCode, gradeLabel: mm.gradeLabel, genderCode: mm.genderCode, genderLabel: mm.genderLabel,
    memberLevel: mm.memberLevel || 'normal', memberLevelName: IZ.memberTierName(mm.memberLevel || 'normal'),
    badge: (mm.memberLevel && mm.memberLevel !== 'normal') ? IZ.memberTierName(mm.memberLevel) : (mm.unlockedLevels.length ? '已开通等级' : ''),
    levels: mm.unlockedLevels.map((lid) => { const lv = levelOf(lid); return { id: lid, name: lv ? lv.name : lid }; }),
    training: mm.training, storeId: mm.storeId || null, version: mm.version,
  };
}
function publicCoach(c) {
  return { id: c.id, name: c.name, loginAccount: c.loginAccount, status: c.status, invitationStatus: c.invitationStatus, version: c.version };
}
function publicApplication(a) {
  return {
    id: a.id, title: a.title, applicationStatus: a.applicationStatus, paymentStatus: a.paymentStatus,
    contractStatus: a.contractStatus, entitlementStatus: a.entitlementStatus,
    store: a.store || null, agencyType: a.agencyType, payableAmount: a.payableAmount, createdAt: a.createdAt, version: a.version,
  };
}
function publicFeedback(f, db) {
  const mm = db ? (db.members.find((m) => m.id === f.memberId) || {}) : {};
  const assetMeta = (id) => { const a = (db ? db.assets.find((x) => x.id === id) : null) || {}; return { assetId: id, kind: a.purpose === 'training-video' ? 'video' : 'file', name: a.fileName || id, size: a.size || 0, previewUrl: a.previewUrl || null }; };
  return {
    id: f.id, memberId: f.memberId, memberName: mm.name || f.memberId, title: f.title, kind: f.kind,
    coachName: f.coachName || null, createdAt: new Date(f.createdAt).toISOString(), content: f.text,
    images: (f.imageAssetIds || []).map((id) => { const a = db.assets.find((x) => x.id === id) || {}; return { assetId: id, previewUrl: a.previewUrl || null }; }),
    attachments: (f.attachmentAssetIds || []).map(assetMeta),
  };
}

module.exports = { handle, ensure, resetBiz, BIZ_KEYS, recordApplication, findCoachByLogin, listAddresses, listCoupons, columnById, columnChapterOf, columnList };

```
</details>

## 328. ① 总部批量发码 / 查询 / 作废（admin）
`POST http://localhost:3000/admin/activation-codes`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5codes.js:87`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|targetType|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|targetId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|issuedTo|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|count|number|条件/未显式声明|读取及校验规则见下方实现|1|
|storeId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|expiresInDays|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|note|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "targetType": "示例值",
  "targetId": "有效资源ID",
  "issuedTo": "示例值",
  "count": 1,
  "storeId": "有效资源ID",
  "expiresInDays": "示例值",
  "note": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/admin/activation-codes' && m === 'POST') {
    if (!sess || sess.role !== 'admin') return fail(403, '仅总部可批量发码');
    const b = await readBody(req);
    if (!b.targetType || !VALID_TYPES.includes(b.targetType)) return fail(400, 'targetType 非法（level/column/fs/jy/cj/xn/ys）');
    if (b.targetType === 'level' && !b.targetId) return fail(400, 'level 类型必须指定 targetId');
    if (b.issuedTo && !db.users[b.issuedTo]) return fail(404, '绑定家长不存在');
    const r = issue(db, {
      targetType: b.targetType, targetId: b.targetId || null, count: b.count || 1,
      channel: 'admin', issuedBy: 'admin', storeId: b.storeId || null, issuedTo: b.issuedTo || null,
      expiresInDays: b.expiresInDays, note: b.note,
    });
    save();
    return ok(200, { batchId: r.batchId, codes: r.codes, records: r.records.map(publicCode) });
  }
```
</details>

## 329. 业务查询接口
`GET http://localhost:3000/admin/activation-codes`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5codes.js:101`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|status|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|targetType|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|channel|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|storeId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|createdAt|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/admin/activation-codes' && m === 'GET') {
    if (!sess || sess.role !== 'admin') return fail(403, '仅总部可查询激活码');
    const st = q('status'), tt = q('targetType'), ch = q('channel'), storeId = q('storeId');
    let items = (db.activationCodes || []).slice();
    if (st) items = items.filter((r) => r.status === st);
    if (tt) items = items.filter((r) => r.targetType === tt);
    if (ch) items = items.filter((r) => r.channel === ch);
    if (storeId) items = items.filter((r) => r.storeId === storeId);
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const all = db.activationCodes || [];
    const stats = {
      total: all.length,
      active: all.filter((r) => r.status === 'active' && (!r.expiresAt || r.expiresAt >= nowMs())).length,
      used: all.filter((r) => r.uses >= r.maxUses).length,
      void: all.filter((r) => r.status === 'void').length,
      expired: all.filter((r) => r.status === 'active' && r.expiresAt && r.expiresAt < nowMs()).length,
    };
    return ok(200, { items: items.map(publicCode), stats, hasMore: false, nextCursor: null });
  }
```
</details>

## 330. 业务操作接口
`POST http://localhost:3000/admin/activation-codes/{动态路径}`
原始匹配：`p.startsWith('/admin/activation-codes/') && p.endsWith('/void') && m === 'POST'`
Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5codes.js:120`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### 请求 JSON 示例
```json
{}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p.startsWith('/admin/activation-codes/') && p.endsWith('/void') && m === 'POST') {
    if (!sess || sess.role !== 'admin') return fail(403, '仅总部可作废激活码');
    const code = decodeURIComponent(p.slice('/admin/activation-codes/'.length, p.length - '/void'.length)).toUpperCase();
    const rec = (db.activationCodes || []).find((r) => r.code === code);
    if (!rec) return fail(404, '激活码不存在');
    if (rec.uses >= rec.maxUses) return fail(400, '该码已核销，不能作废');
    rec.status = 'void'; rec.voidedAt = nowMs(); rec.voidedBy = 'admin';
    save();
    return ok(200, { code: rec.code, status: 'void' });
  }

  // ───────────────── ② 门店收款发码（agency：区域代理身份） ─────────────────
```
</details>

## 331. ② 门店收款发码（agency：区域代理身份）
`POST http://localhost:3000/agency/activation-codes`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5codes.js:132`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|contextId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|targetType|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|count|number|条件/未显式声明|读取及校验规则见下方实现|1|
|note|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "contextId": "有效资源ID",
  "targetType": "示例值",
  "count": 1,
  "note": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/agency/activation-codes' && m === 'POST') {
    if (!sess || sess.role !== 'user') return fail(401, '未登录');
    const b = await readBody(req);
    const cid = b.contextId;
    if (!cid) return fail(400, 'contextId 必填');
    const { userId } = resolveContext(cid);
    const agent = (db.regionalAgents || []).find((a) => a.partner_id === userId);
    if (!agent) return fail(403, '该上下文不是区域代理（门店/区县/市/省代）');
    if (!STORE_TYPES.includes(b.targetType)) return fail(400, '门店仅可发放粉丝/菁英激活码（fs/jy）');
    const r = issue(db, {
      targetType: b.targetType, count: b.count || 1,
      channel: 'store', issuedBy: userId, storeId: agent.region_code || agent.id,
      note: b.note || ('门店收款发码（' + agent.region_type + '）'),
    });
    save();
    return ok(200, { batchId: r.batchId, codes: r.codes, storeId: agent.region_code || agent.id, records: r.records.map(publicCode) });
  }
```
</details>

## 332. 代理查询接口
`GET http://localhost:3000/agency/activation-codes`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5codes.js:149`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|contextId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|createdAt|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/agency/activation-codes' && m === 'GET') {
    if (!sess || sess.role !== 'user') return fail(401, '未登录');
    const cid = q('contextId');
    if (!cid) return fail(400, 'contextId 必填');
    const { userId } = resolveContext(cid);
    const agent = (db.regionalAgents || []).find((a) => a.partner_id === userId);
    if (!agent) return fail(403, '该上下文不是区域代理');
    const items = (db.activationCodes || []).filter((r) => r.channel === 'store' && r.issuedBy === userId)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return ok(200, { items: items.map(publicCode), storeId: agent.region_code || agent.id, hasMore: false, nextCursor: null });
  }

  // ───────────────── ③ 上级赠码（partner：upline → 直属下级家长） ─────────────────
```
</details>

## 333. ③ 上级赠码（partner：upline → 直属下级家长）
`POST http://localhost:3000/partner/gift-codes`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5codes.js:162`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|contextId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|targetType|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|
|toUserId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|
|toPhone|JSON|条件/未显式声明|读取及校验规则见下方实现|13800138000|
|count|number|条件/未显式声明|读取及校验规则见下方实现|1|
|note|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### 请求 JSON 示例
```json
{
  "contextId": "有效资源ID",
  "targetType": "示例值",
  "toUserId": "有效资源ID",
  "toPhone": "13800138000",
  "count": 1,
  "note": "示例值"
}
```

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/gift-codes' && m === 'POST') {
    if (!sess || sess.role !== 'user') return fail(401, '未登录');
    const b = await readBody(req);
    const cid = b.contextId;
    if (!cid) return fail(400, 'contextId 必填');
    const { userId: gifterId } = resolveContext(cid);
    if (gifterId !== sess.userId) return fail(403, '仅可以本人（上级）身份赠码');
    if (!GIFT_TYPES.includes(b.targetType)) return fail(400, '上级仅可赠送 cj/xn/ys 激活码（粉丝/菁英请走门店收款）');
    const toUserId = b.toUserId || (b.toPhone ? (Object.values(db.users).find((u) => u.phone === b.toPhone) || {}).id : null);
    const target = toUserId ? db.users[toUserId] : null;
    if (!target) return fail(404, '受赠家长不存在（toUserId/toPhone）');
    if (target.upline_id !== gifterId) return fail(403, '仅可给直属下级家长赠码');
    if ((TIER_RANK[target.tier] || 0) < (MIN_TIER_RANK[b.targetType] || 0)) {
      const need = { cj: 'VIP 合伙人', xn: '天使合伙人', ys: '天使合伙人' }[b.targetType];
      return fail(403, '受赠家长需先成为' + need + '才能激活该等级');
    }
    const r = issue(db, {
      targetType: b.targetType, count: b.count || 1,
      channel: 'upline', issuedBy: gifterId, issuedTo: toUserId,
      note: b.note || ('上级赠码：' + gifterId + ' → ' + toUserId),
    });
    save();
    return ok(200, { batchId: r.batchId, codes: r.codes, issuedTo: toUserId, records: r.records.map(publicCode) });
  }
```
</details>

## 334. 合伙人查询接口
`GET http://localhost:3000/partner/gift-codes`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5codes.js:186`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|contextId|JSON|条件/未显式声明|读取及校验规则见下方实现|有效资源ID|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|createdAt|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/partner/gift-codes' && m === 'GET') {
    if (!sess || sess.role !== 'user') return fail(401, '未登录');
    const cid = q('contextId');
    if (!cid) return fail(400, 'contextId 必填');
    const { userId: gifterId } = resolveContext(cid);
    if (gifterId !== sess.userId) return fail(403, '仅可查看本人赠码记录');
    const items = (db.activationCodes || []).filter((r) => r.channel === 'upline' && r.issuedBy === gifterId)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return ok(200, { items: items.map(publicCode), hasMore: false, nextCursor: null });
  }

  // ───────────────── ④ 我的激活码（家长查看绑定自己的赠码） ─────────────────
```
</details>

## 335. ④ 我的激活码（家长查看绑定自己的赠码）
`GET http://localhost:3000/me/activation-codes`

Security：Bearer 会话；角色和资源归属条件见下方源码。
源码：`src/routes/h5codes.js:198`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|createdAt|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
  if (p === '/me/activation-codes' && m === 'GET') {
    if (!sess || sess.role !== 'user') return fail(401, '未登录');
    const items = (db.activationCodes || []).filter((r) => r.issuedTo === sess.userId)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return ok(200, { items: items.map(publicCode), hasMore: false, nextCursor: null });
  }

  return false; // 未命中
}

module.exports = { handle, issue, genCode, publicCode, STORE_TYPES, GIFT_TYPES };

```
</details>

## 336. 服务器
`OPTIONS http://localhost:3000/{动态路径}`
原始匹配：`*`
Security：公开。
源码：`server.js:985`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (req.method === 'OPTIONS') { res.writeHead(204, API_STANDARD.corsHeaders()); return res.end(); }
```
</details>

## 337. 业务操作接口
`* except OPTIONS http://localhost:3000/health`

Security：公开。
源码：`server.js:986`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (url.pathname === '/health') { sendJSON(res, 200, { ok: true, ts: Date.now(), service: 'naoshang-api' }); return; }
    // 总部后台（HQ）接口层：/api/hq/* —— 契约见《总部后台API需求文档.md》
    if (url.pathname.startsWith('/api/hq')) return await HQ.handle(db, req, res, url, { readBody, sendJSON, sessions, persist: saveDb });
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    // H5 契约接口层（RESTful）：命中契约路径则处理；未命中返回服务信息/404（纯 API 服务，不托管前端）。
    if (await H.handle(db, req, res, url, { readBody, sendJSON, sessions, persist: saveDb })) return;
    return notApiPath(req, res, url);
  } catch (e) {
    console.error('[ERR]', url.pathname, e.message);
    if (!res.headersSent) sendJSON(res, 500, { error: e.message || '服务器内部错误' });
  }
}));

// 启动前预检：端口被本项目常驻实例占用 → 自动避让 + 数据隔离（不把选择题丢给用户）
let autoPort = false;
const pre = preselectPort();
if (pre.port !== Number(PORT)) {
  PORT = pre.port;
  autoPort = true;
  console.log('[预检] ' + pre.note);
}

// 单实例锁：同一个 db.json 只允许一个进程写。
// 有别的存活实例正在写这个库 → 本实例改用独立副本，
// 避免两个进程各自持有旧内存快照、互相整份覆盖（"数据莫名消失"的根源）。
const lock = acquireDbLock(DB_FILE);
let lockNote = '';
if (!lock.ok) {
  const originName = path.basename(DB_FILE);   // 先记住原库名（useIsolatedDbCopy 会改写 DB_FILE）
  try {
    const copy = useIsolatedDbCopy(PORT);
    lockNote = '检测到已有服务实例（PID ' + lock.owner + '）正在写 ' + originName
      + ' → 本实例改用独立副本 ' + path.basename(copy) + '（不会影响正式库）';
    console.log('[预检] ' + lockNote);
    autoPort = true;
  } catch (e) {
    console.log('[预检] 无法创建数据副本（' + e.message + '），仍使用 ' + originName);
  }
} else {
  // 释放锁：正常退出时清掉，避免留下死锁
  const release = () => releaseDbLock(DB_FILE);
  process.on('exit', release);
  process.on('SIGINT', () => { release(); sessionStore.flush(); process.exit(0); });
  process.on('SIGTERM', () => { release(); sessionStore.flush(); process.exit(0); });
}
// 会话落盘是防抖的（200ms 合并写），退出前强制刷一次，避免丢掉最后几次登录
process.on('exit', () => { try { sessionStore.flush(); } catch (e) { /* 退出期不再抛错 */ } });
loadDb();
sessionStore.load();   // 恢复登录态（重启不掉线，2026-10-28）
// P2-3（2026-10-26）：生产环境禁止 sandbox 免支付直通，避免「下单即成功」被当成真实收款。
if (String(process.env.NODE_ENV || '') === 'production' && PAY.PAYMENT_MODE !== 'live') {
  console.error('[FATAL] NODE_ENV=production 时必须设置 PAYMENT_MODE=live（当前为 ' + PAY.PAYMENT_MODE + '），拒绝启动');
  process.exit(1);
}
/**
 * 启动前预检：端口被谁占了？→ **自动决定用哪个端口**（不把选择题丢给用户）
 *
 * 场景：常驻服务（Windows 计划任务托管）已经占着 3000，
 * 用户又从 IDEA 里跑一个 `node server.js` → 端口冲突。
 *
 * 决策规则：
 *   ① 端口空闲                     → 用它，数据用真实库（正常路径）
 *   ② 端口被**本项目**的常驻实例占着 → 自动往后找一个空闲端口（3001、3002…），
 *                                    并改用**独立的数据副本**。
 *                                    ⚠️ 必须隔离数据：本项目是「内存 + db.json 快照」架构，
 *                                    两个进程写同一个 db.json 会互相整份覆盖
 *                                    （测试数据就是这样被冲掉过好几次）。
 *   ③ 端口被**别的程序**占着         → 只能报错（无法自动避让别人的服务）
 *
 * @returns {{port:number, isolated:boolean, note:string}}
 */
function preselectPort() {
  const wanted = Number(PORT);
  const owner = PORTINFO.portOwner(wanted);
  if (!owner.ours) {
    // 端口空闲，或被别的程序占着 → 交给 listen 的 error 事件去报
    return { port: wanted, isolated: false, note: '' };
  }
  // 往后找一个能绑上的端口
  for (let p = wanted + 1; p <= wanted + 20; p++) {
    if (PORTINFO.portFree(p)) {
      // 数据隔离：复制一份真实库给这个"调试实例"用
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        const copy = path.join(DATA_DIR, `db.debug-${p}.json`);
        if (fs.existsSync(DB_FILE)) fs.copyFileSync(DB_FILE, copy);
        else fs.writeFileSync(copy, JSON.stringify(S.createDb(), null, 2));
        DB_FILE = copy;
        return {
          port: p,
          isolated: true,
          note: '端口 ' + wanted + ' 已被本项目常驻服务占用（PID ' + owner.pid + '）→ 本实例自动改用端口 ' + p
            + '，并使用独立数据副本 ' + path.basename(copy) + '（不会影响正式库）',
        };
      } catch (e) {
        return { port: p, isolated: false, note: '端口 ' + wanted + ' 被占用 → 本实例自动改用端口 ' + p };
      }
    }
  }
  return { port: wanted, isolated: false, note: '' };
}

/**
 * 单实例锁：同一个 db.json 只允许**一个**服务进程写。
 *
 * 为什么必须有：后端是「内存 + db.json 快照」架构 —— 每个进程持有整份内存，
 * 任何一次写操作都会把**整份内存**覆盖写回 db.json。
 * 于是只要有两个进程指向同一个 db.json（哪怕只有一个在真正对外服务），
 * 后写的那个就会用它内存里的**旧快照**把另一个的数据整份盖掉。
 * 这就是"测试数据莫名消失、db.json 变回 7 个默认合伙人"的真正机制
 * （`loadSeed()` 会把 db.users 重置成 7 个默认合伙人，正是我们看到的现象）。
 *
 * 做法：进程启动时在库文件旁写一个 .lock 记录自己的 PID；
 * 启动前先看锁里的 PID 还在不在 —— 还在，说明已经有人写这个库了，
 * 本实例就自动改用一份独立副本，绝不与对方抢同一个文件。
 * 正常退出时释放锁；异常退出留下的死锁会在下次启动时被自动识别并接管。
 */
function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
function lockPathFor(file) { return file + '.lock'; }

/** 尝试独占某个库文件；返回 { ok, owner } */
function acquireDbLock(file) {
  const lock = lockPathFor(file);
  try {
    if (fs.existsSync(lock)) {
      const owner = Number(String(fs.readFileSync(lock, 'utf8')).trim());
      if (owner && owner !== process.pid && pidAlive(owner)) return { ok: false, owner };
    }
  } catch (e) { /* 读不到锁就当没有 */ }
  try { fs.writeFileSync(lock, String(process.pid)); } catch (e) { /* ignore */ }
  return { ok: true, owner: 0 };
}
function releaseDbLock(file) {
  try {
    const lock = lockPathFor(file);
    if (!fs.existsSync(lock)) return;
    if (Number(String(fs.readFileSync(lock, 'utf8')).trim()) === process.pid) fs.unlinkSync(lock);
  } catch (e) { /* ignore */ }
}

/** 把库复制成一份独立副本，并把它设为当前实例的 DB_FILE */
function useIsolatedDbCopy(tag) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const copy = path.join(DATA_DIR, `db.debug-${tag}.json`);
  if (fs.existsSync(DB_FILE)) fs.copyFileSync(DB_FILE, copy);
  else fs.writeFileSync(copy, JSON.stringify(S.createDb(), null, 2));
  DB_FILE = copy;
  return copy;
}

// 端口占用等监听错误 → 给出可操作提示，而非抛一坨 Node 堆栈后直接退出。
server.on('error', (e) => {  if (e && e.code === 'EADDRINUSE') {
    // ⚠️ 关键：端口上跑的常常就是**本项目自己**（Windows 计划任务托管的常驻实例）。
    //   旧逻辑一律报"端口被占用，服务无法启动" → 从 IDEA 直接跑 node server.js 的人
    //   会以为后端挂了，其实它好好地在跑；再照着提示去 stop 就把正常服务关掉了。
    const owner = PORTINFO.portOwner(PORT);
    console.error('');
```
</details>

## 338. 非 API 路径处理（纯 API 服务：返回服务信息或 404）
`* except OPTIONS http://localhost:3000/`

Security：公开。
源码：`server.js:970`

### Query 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
function notApiPath(req, res, url) {
  if (url.pathname === '/' || url.pathname === '') {
    return sendJSON(res, 200, {
      service: '脑商AI合伙人 · 后端 API 服务', version: 'v1', status: 'ok',
      docs: '接口契约见《后端API需求文档.md》；逐接口功能与状态见《前端API接口清单（功能标注）.md》',
      api: { contract: 'RESTful 契约接口（/auth /me /partner /orders /wallet /members /learning /assets …）', admin: '/api/*（算薪结算引擎 + 总部后台）' },
    });
  }
  return sendJSON(res, 404, { error: 'Not Found: ' + url.pathname });
}

// ───────────── 服务器 ─────────────
const server = http.createServer((req, res) => API_STANDARD.context(req, res, async () => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
```
</details>

## 339. 个人中心查询接口
`GET http://localhost:3000/me/income-export?format=csv`

Security：该接口位于统一鉴权前；具体登录检查见下方源码。
源码：`src/routes/h5.js:548`

### Query 参数
|字段|类型|必填|说明|示例|
|---|---|---|---|---|
|format|JSON|条件/未显式声明|读取及校验规则见下方实现|示例值|

### Path 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

### Body 参数
未在本处理器显式读取；透传对象及辅助函数校验见实现摘录。

<details><summary>处理器实现（校验与字段说明依据）</summary>

```javascript
    if (q('format') === 'csv') {
      const head = '编号,月份,类型,金额(元),基数,比例,状态,来源订单,时间\n';
      const body = rows.map((c) => [c.id, c.period || '', T_CN[c.type] || c.type, c.amount, c.base_amount == null ? '' : c.base_amount, c.rate == null ? '' : c.rate, c.status || 'SETTLED', c.ref_order_id || '', c.created_at ? new Date(c.created_at).toISOString() : ''].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="income-${u.display_id || sess.userId}.csv"` });
      res.end('\uFEFF' + head + body + `\n"合计","","",${total},,,,,\n`);
      return true;
    }
    return ok(200, { displayId: u.display_id, entitlementState: st, total, byType, count: rows.length, exportedAt: nowMs(), items });
  }
```
</details>
