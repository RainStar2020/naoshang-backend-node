# 阶段3环境变量登记

所有金额开关均为显式字符串1开启，未设置或其他值均关闭。本轮未在服务环境启用任何金额开关，也未启用分字段读取。

- MONEY_SHADOW_WRITE_PRODUCTS：默认0；只对skus/listPrice、activityPrices/amount、columns/price的已接线写操作影子双写。不得用于历史批量回填。
- MONEY_SHADOW_WRITE_CHECKOUT_QUOTES：默认0；只对新建scene=checkout报价影子双写。
- MONEY_CENTS_READ_PRODUCTS：默认0；仅v2的显式readDto/原始记录投影可读取产品分字段，不改变旧元字段及计价算法。本轮不启用，也不将既有商城展示全部切换到此路径。
- MONEY_CENTS_READ_CHECKOUT_QUOTES：默认0；同上，限checkout报价的分值投影。本轮不启用，现有报价金额仍按旧计算和旧DTO读取。
- MONEY_SHADOW_REQUIRE_COMPLETE：默认0；同步预检是否将MISSING_SHADOW升级为阻止项。回填后/批次D前要求1。即便为0，实际NOT NULL列仍受缺值保护。

影子批次失败率上限当前固定默认0（beginBatch内部参数），第一条失败即告警并停止同批后续影子写入；不阻断旧业务。不提供未批准的运行时阈值放宽变量。
批次边界：一次SKU补建、一批专栏替换分别一个批次；单SKU改价、单活动价、单报价分别为单记录批次。新请求会开启新批次，不是跨请求永久熔断。
进程级totals导出attempted/failed/written/stopped计数；批次记录attempted/failed/written/skipped/stopped/events；告警[MONEY_SHADOW]含批次和记录定位，无凭证信息。计数非持久化，不新增运维API。

已有版本开关不变：X-API-Version:2显式选择；API_STANDARD_V2=0全局退回旧信封；USERS/SUPPORT模块开关保持既有语义。

关闭示例（仅配置后续进程，本轮不启动生产进程）：
```powershell
$env:MONEY_CENTS_READ_PRODUCTS = '0'
$env:MONEY_CENTS_READ_CHECKOUT_QUOTES = '0'
$env:MONEY_SHADOW_WRITE_PRODUCTS = '0'
$env:MONEY_SHADOW_WRITE_CHECKOUT_QUOTES = '0'
```
已有进程须由部署配置应用，不能声称在PowerShell赋值已改变其环境。
