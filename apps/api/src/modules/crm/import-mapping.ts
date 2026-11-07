export const IMPORT_FIELDS:Record<string,Record<string,string[]>>={
  customer:{external_customer_id:['来源客户编号','客户编号','买家编号','会员编号','用户id','buyer_id','customer_id'],display_name:['客户称呼','客户名称','买家昵称','会员昵称','昵称','buyer_nick'],source_created_at:['来源创建时间','注册时间','入会时间'],source_updated_at:['来源更新时间','更新时间'],source_revision:['来源版本'],org_unit:['来源组织标识','组织编号'],phone:['电话','手机号','手机号码'],email:['邮箱','电子邮箱']},
  order:{external_order_id:['来源订单编号','订单编号','订单号','交易单号','order_id'],external_customer_id:['来源客户编号','客户编号','买家编号','会员编号','用户id','buyer_id','customer_id'],status:['来源订单状态','订单状态','交易状态'],currency:['币种','货币'],paid_at:['支付时间','付款时间'],paid_amount:['实付金额','实付款','买家实付','实收金额'],refund_amount:['累计退款金额','累计退款','退款金额'],source_updated_at:['来源更新时间','更新时间'],source_revision:['来源版本'],expected_item_count:['完整明细行数','明细行数'],unallocated_paid_amount:['未分摊实付金额'],unallocated_refund_amount:['未分摊退款金额'],unallocated_reason:['未分摊原因']},
  item:{external_order_id:['来源订单编号','订单编号','订单号','order_id'],external_line_id:['来源行编号','明细编号','子订单号','line_id'],external_sku_id:['来源SKU编号','商品编号','sku编号','商家编码','sku_id'],name:['商品名称','商品标题','产品名称'],quantity:['数量','购买数量','商品数量'],paid_amount:['实付金额','明细实付金额'],refund_amount:['累计退款金额','明细退款金额','退款金额']},
};
const normalize=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[\s_\-（）()]/g,'').replace(/文本$/,'');
/** Only unambiguous known aliases, with one source column per target. */
export function suggestImportMapping(role:string,headers:string[],existing:Record<string,string>={}){
  const fields:Record<string,string>={...existing},conflicts:string[]=[];
  for(const [target,aliases]of Object.entries(IMPORT_FIELDS[role]??{})){
    if(fields[target])continue;
    const exact=headers.filter(h=>h===target);
    const candidates=exact.length?exact:headers.filter(h=>[target,...aliases].some(a=>normalize(a)===normalize(h)));
    if(candidates.length===1&&!Object.values(fields).includes(candidates[0]))fields[target]=candidates[0];
    else if(candidates.length>1)conflicts.push(target);
  }
  return {fields,conflicts};
}
