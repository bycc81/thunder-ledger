-- B4.1：采购更正采用追加历史；结算调整单保存已确认账单的差额，不修改原账单。
CREATE TABLE IF NOT EXISTS purchase_corrections (
  id uuid PRIMARY KEY,
  purchase_id uuid NOT NULL REFERENCES inventory_purchases(id), batch_id uuid NOT NULL REFERENCES collaboration_batches(id),
  old_quantity integer NOT NULL, new_quantity integer NOT NULL, old_total_cost_tenths bigint NOT NULL, new_total_cost_tenths bigint NOT NULL,
  old_payer_user_id uuid NOT NULL REFERENCES users(id), new_payer_user_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_corrections_purchase_created_idx ON purchase_corrections(purchase_id, created_at DESC);
CREATE TABLE IF NOT EXISTS purchase_correction_cost_shares (
  correction_id uuid NOT NULL REFERENCES purchase_corrections(id), version text NOT NULL CHECK (version IN ('old','new')),
  user_id uuid NOT NULL REFERENCES users(id), amount_tenths bigint NOT NULL, PRIMARY KEY(correction_id, version, user_id)
);
CREATE TABLE IF NOT EXISTS settlement_adjustment_bills (
  id uuid PRIMARY KEY, batch_id uuid NOT NULL REFERENCES collaboration_batches(id), settlement_bill_id uuid NOT NULL REFERENCES settlement_bills(id),
  purchase_correction_id uuid NOT NULL REFERENCES purchase_corrections(id), status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed')),
  old_cost_tenths bigint NOT NULL, new_cost_tenths bigint NOT NULL, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), confirmed_by uuid REFERENCES users(id), confirmed_at timestamptz,
  UNIQUE(settlement_bill_id, purchase_correction_id)
);
CREATE INDEX IF NOT EXISTS settlement_adjustment_bills_batch_status_idx ON settlement_adjustment_bills(batch_id, status, created_at DESC);
CREATE TABLE IF NOT EXISTS settlement_adjustment_member_results (
  adjustment_bill_id uuid NOT NULL REFERENCES settlement_adjustment_bills(id), user_id uuid NOT NULL REFERENCES users(id), username text NOT NULL,
  old_cost_share_tenths bigint NOT NULL, new_cost_share_tenths bigint NOT NULL, old_purchase_paid_tenths bigint NOT NULL, new_purchase_paid_tenths bigint NOT NULL, net_delta_tenths bigint NOT NULL,
  PRIMARY KEY(adjustment_bill_id, user_id)
);
CREATE TABLE IF NOT EXISTS settlement_adjustment_transfers (
  adjustment_bill_id uuid NOT NULL REFERENCES settlement_adjustment_bills(id), sequence integer NOT NULL,
  payer_user_id uuid NOT NULL REFERENCES users(id), payer_username text NOT NULL, payee_user_id uuid NOT NULL REFERENCES users(id), payee_username text NOT NULL, amount_tenths bigint NOT NULL CHECK(amount_tenths > 0),
  PRIMARY KEY(adjustment_bill_id, sequence)
);
