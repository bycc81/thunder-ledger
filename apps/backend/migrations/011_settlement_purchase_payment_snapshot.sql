-- B4：账单成员结果补充确认时按商品成本分摊的实际采购付款快照。
ALTER TABLE settlement_member_results
  ADD COLUMN IF NOT EXISTS purchases_paid_tenths bigint NOT NULL DEFAULT 0;
