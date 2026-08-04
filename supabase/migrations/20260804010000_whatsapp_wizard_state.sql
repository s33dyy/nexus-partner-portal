-- WhatsApp guided-menu wizard: tracks which deterministic step a
-- conversation is on, so multi-step flows (browsing, Create-a-Deal) don't
-- depend on an LLM re-inferring state from free-text history every turn.
CREATE TABLE IF NOT EXISTS whatsapp_wizard_state (
  conversation_id TEXT PRIMARY KEY,
  flow TEXT NOT NULL,
  step TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
