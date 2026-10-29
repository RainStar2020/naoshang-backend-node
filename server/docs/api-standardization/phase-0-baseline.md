# 阶段 0 静态基线（2026-10-29）

范围：仅静态源码；未启动服务、未连接数据库、未执行写入测试或 SQL。

## 分发与登记
server.js 的 HTTP 入口依次处理 OPTIONS、/health、/api/hq/*、其他 /api/*、H5、服务信息/404。
HQ 由 routes/hq/index.js 注册 modules/*.js；H5 入口委托 h5biz.js、h5codes.js，包含动作别名。
phase-0-source-register.json 保存文件、行号、分类和源码片段，包括路由、错误、分页与金额字段候选。
注意：这是源码证据登记，不是已验证的精确端点数量；多行条件、正则、动态路径和别名需在阶段1契约夹具中进一步解析，不把候选行数作为覆盖率分母。

## 响应基线（静态预期，非运行通过）
H5 成功：原始业务对象；失败：HTTP错误状态 + {error: 文案}。
HQ 成功：HTTP200 + {code:0,message:"ok",data:结果或null}。
HQ 失败：HTTP映射 + {code:数值业务码,message:文案,data:null}，可能附加 extra。
主入口 /api：原始对象、{error}、{ok:false,error} 混用。
健康检查：{ok:true,ts:毫秒时间戳,service:"naoshang-api"}。
OPTIONS：204无响应体。CSV导出为非JSON响应，不套业务信封。
默认旧版必须维持这些形状；新信封只能显式 X-API-Version:2 启用。
现有未知异常返回 e.message，安全兜底改为固定文案是明确记录的安全兼容例外。

## 错误与分页
HQ 业务码：40000输入、40100未登录、40300无权限、40400不存在、40900状态、40901版本、40902幂等、40903名额、50000系统。
H5 fail 接收 HTTP码和文案，缺少稳定业务码及字段级 errors；不能通过文案猜业务码。
readBody 非法 JSON 抛普通 Error；h5biz 部分捕获后回退空对象。
HQ page/pageSize，默认20、上限100；输出items/total/page/pageSize，无totalPages。其他分页见登记源码。

## 金额字段及静态样例快照（元 -> 预期整数分）
amount、base_amount/baseAmount、price、balance、monthly_fee、actual_paid、seller_cost、supply_spread、store_fee、hq_fee、payable_amount。
VIP零售价9980 -> 998000；天使29800 -> 2980000；私董59800 -> 5980000；联创239800 -> 23980000。
权益费200 -> 20000；合店月费698 -> 69800；活动名额服务费2000 -> 200000；粉丝会员19.9 -> 1990。
上述来自代码常量/注释，不是实际数据库金额或新工具计算结果。
53处Math.round/toFixed候选匹配不等于53处金额缺陷，需分类。
MySQL导出已有DECIMAL(18,2)，业务主源为内存+JSON，SQL迁移不属于本轮。

## 遗留区分
README描述早期Express/SQLite，不代表当前启动链路。
routes/auth.js引用缺失的src/db，未被当前server.js入口直接引用，暂列遗留候选，不删除。
当前启用链路以server.js -> HQ/H5/业务模块的require和委托为准。

## 验证与限制
已运行：静态rg检索、源码读取、源码SHA256快照、node --version（v20.20.2）。
未运行：HTTP旧契约回归、金额单测、全量回归、数据库验证。没有测试通过结论。
项目声明Node>=22.5；阶段1纯工具单测若在当前环境运行需注明版本差异。
原有未跟踪项：根package-lock.json、server/data/db.json.bak-before-Test123-2026-10-29T03-51-37-713Z；不修改。

## 本阶段变更和回滚
仅新增本目录phase-0-baseline.md、phase-0-source-register.json、phase-0-source-hashes.json。
无SQL、无业务代码变更。回滚只需删除这三个新增文档文件；不删除目录中的后续文件。
