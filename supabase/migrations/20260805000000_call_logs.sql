-- Call Center Phase 1: Voice calling (Twilio Voice + browser softphone).
CREATE TABLE IF NOT EXISTS call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  twilio_call_sid TEXT UNIQUE NOT NULL,
  direction TEXT NOT NULL,
  from_number TEXT NOT NULL,
  to_number TEXT NOT NULL,
  agent_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  recording_url TEXT,
  disposition TEXT,
  linked_ticket_id UUID REFERENCES support_tickets(id) ON DELETE SET NULL,
  linked_deal_id UUID REFERENCES portal_deals(id) ON DELETE SET NULL,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS call_logs_agent_user_id_idx ON call_logs (agent_user_id);
CREATE INDEX IF NOT EXISTS call_logs_created_at_idx ON call_logs (created_at DESC);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS call_ready BOOLEAN NOT NULL DEFAULT FALSE;
