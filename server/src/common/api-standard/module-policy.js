'use strict';
// Module-level policy only. No per-endpoint migration register.
const names=['users','course','announcements','materials','softwareCards','quotas','delivery','staff','stores','training','invitations','transfers','support','trace'];
const READ_MODULES=Object.freeze(Object.fromEntries(names.map(name=>[name,Object.freeze({flag:'API_STANDARD_'+name.replace(/([a-z])([A-Z])/g,'$1_$2').toUpperCase()+'_PILOT',defaultEnabled:true})])));
const EXCEPTIONS=Object.freeze({
  products:'金额/商品价格接口',orders:'订单与金额接口',coupons:'优惠金额接口',payments:'支付/对账及带写副作用的导出',revenue:'收益金额接口',withdrawals:'提现金额接口',partners:'年费与合伙收益接口',costore:'合店费用接口',
  auth:'查询可能初始化管理员',columns:'查询可能补建后台专栏',activationCodes:'查询可能构建批次记录',members:'查询可能补写会员门店名称'
});
const LAYER_EXCEPTIONS=Object.freeze({legacyWrites:'所有存量非GET动作，保持原实现',h5:'旧catch吞错/重分类链路',h5biz:'非法JSON回退链路',legacyMain:'主入口尚未模块化的混合管理接口',protocol:'CSV/健康检查/OPTIONS协议例外'});
module.exports={READ_MODULES,EXCEPTIONS,LAYER_EXCEPTIONS};
