-- B4：利润比例支持最多两位小数，旧整数比例自动转换为 numeric 值。
ALTER TABLE settlement_profit_shares
  DROP CONSTRAINT IF EXISTS settlement_profit_shares_percentage_check;
ALTER TABLE settlement_profit_shares
  ALTER COLUMN percentage TYPE numeric(5, 2) USING percentage::numeric;
ALTER TABLE settlement_profit_shares
  ADD CONSTRAINT settlement_profit_shares_percentage_check
  CHECK (percentage BETWEEN 0 AND 100 AND round(percentage, 2) = percentage);

ALTER TABLE settlement_member_results
  DROP CONSTRAINT IF EXISTS settlement_member_results_profit_percentage_check;
ALTER TABLE settlement_member_results
  ALTER COLUMN profit_percentage TYPE numeric(5, 2) USING profit_percentage::numeric;
ALTER TABLE settlement_member_results
  ADD CONSTRAINT settlement_member_results_profit_percentage_check
  CHECK (profit_percentage BETWEEN 0 AND 100 AND round(profit_percentage, 2) = profit_percentage);
