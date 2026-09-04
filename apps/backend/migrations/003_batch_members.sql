-- 批次2层权限：将批次参与人统一为带角色的批次成员。
CREATE TABLE IF NOT EXISTS batch_members (
  batch_id uuid NOT NULL REFERENCES collaboration_batches(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('owner','editor','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, user_id)
);
INSERT INTO batch_members(batch_id, user_id, role)
SELECT batch_id, user_id, 'owner' FROM batch_participants
ON CONFLICT (batch_id, user_id) DO NOTHING;
CREATE INDEX IF NOT EXISTS batch_members_user_idx ON batch_members(user_id);
