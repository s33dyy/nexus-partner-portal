-- Reward fulfillment wiring + gadget catalogue fields + points-rate policy
-- (2026-08-06). See db/schema.sql for the authoritative, repeatable version
-- of these statements (db:migrate re-runs schema.sql wholesale on deploy).
ALTER TABLE reward_redemptions ADD COLUMN IF NOT EXISTS fulfillment_provider TEXT;
ALTER TABLE reward_redemptions ADD COLUMN IF NOT EXISTS fulfillment_reference TEXT;
ALTER TABLE reward_redemptions ADD COLUMN IF NOT EXISTS fulfillment_voucher_code TEXT;
ALTER TABLE reward_redemptions ADD COLUMN IF NOT EXISTS fulfillment_expires_at TIMESTAMPTZ;
ALTER TABLE reward_redemptions ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ;
ALTER TABLE reward_redemptions ADD COLUMN IF NOT EXISTS failure_reason TEXT;

ALTER TABLE reward_catalog_items ADD COLUMN IF NOT EXISTS country_eligibility TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE reward_catalog_items ADD COLUMN IF NOT EXISTS requires_shipping BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE reward_catalog_items ADD COLUMN IF NOT EXISTS fulfillment_assignee_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS reward_points_rate_policy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  points_per_reward_dollar NUMERIC(12,4) NOT NULL CHECK (points_per_reward_dollar > 0),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reward_points_rate_policy_effective_from_idx
  ON reward_points_rate_policy (effective_from DESC);

INSERT INTO reward_points_rate_policy (id, points_per_reward_dollar, effective_from, is_seed)
VALUES ('00000000-0000-0000-0000-0000000000f1', 1, '2020-01-01T00:00:00Z', TRUE)
ON CONFLICT (id) DO NOTHING;
