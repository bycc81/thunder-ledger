-- B4：阶段账单及其确认时快照。销售唯一映射保证一笔销售不能重复结账。
CREATE TABLE IF NOT EXISTS settlement_bills (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES collaboration_batches(id),
  status text NOT NULL DEFAULT 'confirmed' CHECK (status = 'confirmed'),
  sale_total_tenths bigint NOT NULL,
  expense_total_tenths bigint NOT NULL,
  cost_total_tenths bigint NOT NULL,
  profit_total_tenths bigint NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS settlement_bills_batch_confirmed_idx ON settlement_bills(batch_id, confirmed_at DESC);

CREATE TABLE IF NOT EXISTS settlement_bill_sales (
  settlement_bill_id uuid NOT NULL REFERENCES settlement_bills(id),
  sale_id uuid NOT NULL REFERENCES sales(id),
  product_name text NOT NULL,
  quantity integer NOT NULL,
  total_price_tenths bigint NOT NULL,
  consumed_cost_tenths bigint NOT NULL,
  seller_user_id uuid NOT NULL REFERENCES users(id),
  seller_username text NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (settlement_bill_id, sale_id),
  UNIQUE (sale_id)
);

CREATE TABLE IF NOT EXISTS settlement_bill_expenses (
  settlement_bill_id uuid NOT NULL REFERENCES settlement_bills(id),
  expense_id uuid NOT NULL REFERENCES expenses(id),
  sale_id uuid,
  name text NOT NULL,
  amount_tenths bigint NOT NULL,
  payer_user_id uuid NOT NULL REFERENCES users(id),
  payer_username text NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (settlement_bill_id, expense_id),
  UNIQUE (expense_id)
);

CREATE TABLE IF NOT EXISTS settlement_cost_shares (
  settlement_bill_id uuid NOT NULL REFERENCES settlement_bills(id),
  user_id uuid NOT NULL REFERENCES users(id),
  username text NOT NULL,
  amount_tenths bigint NOT NULL CHECK (amount_tenths >= 0),
  PRIMARY KEY (settlement_bill_id, user_id)
);

CREATE TABLE IF NOT EXISTS settlement_profit_shares (
  settlement_bill_id uuid NOT NULL REFERENCES settlement_bills(id),
  user_id uuid NOT NULL REFERENCES users(id),
  username text NOT NULL,
  percentage integer NOT NULL CHECK (percentage BETWEEN 0 AND 100),
  amount_tenths bigint NOT NULL,
  PRIMARY KEY (settlement_bill_id, user_id)
);

CREATE TABLE IF NOT EXISTS settlement_member_results (
  settlement_bill_id uuid NOT NULL REFERENCES settlement_bills(id),
  user_id uuid NOT NULL REFERENCES users(id),
  username text NOT NULL,
  cost_share_tenths bigint NOT NULL,
  cost_recovery_tenths bigint NOT NULL,
  sales_received_tenths bigint NOT NULL,
  expenses_paid_tenths bigint NOT NULL,
  profit_percentage integer NOT NULL,
  profit_amount_tenths bigint NOT NULL,
  net_tenths bigint NOT NULL,
  PRIMARY KEY (settlement_bill_id, user_id)
);

CREATE TABLE IF NOT EXISTS settlement_transfer_suggestions (
  settlement_bill_id uuid NOT NULL REFERENCES settlement_bills(id),
  sequence integer NOT NULL,
  payer_user_id uuid NOT NULL REFERENCES users(id),
  payer_username text NOT NULL,
  payee_user_id uuid NOT NULL REFERENCES users(id),
  payee_username text NOT NULL,
  amount_tenths bigint NOT NULL CHECK (amount_tenths > 0),
  PRIMARY KEY (settlement_bill_id, sequence)
);
