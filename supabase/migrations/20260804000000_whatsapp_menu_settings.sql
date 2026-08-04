-- Generic key/value store for small runtime settings — first use: caching
-- the Twilio Content API SIDs for the WhatsApp menu's interactive
-- list-picker/quick-reply templates so they're created once, not on every
-- deploy.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
