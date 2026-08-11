-- WhatsApp Assistant linking (Twilio Verify) + per-channel assistant history.
-- profiles.whatsapp_phone_e164/whatsapp_verified_at let a partner prove a
-- WhatsApp number belongs to their account (OTP via Twilio Verify — no
-- OTP-code table needed, Twilio is stateful on its own side). assistant_messages
-- gains a channel column so web and WhatsApp turns can be filtered/threaded
-- separately, and conversation_id widens from UUID to TEXT since WhatsApp
-- threads use a deterministic non-UUID id ("whatsapp:<phoneE164>").

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS whatsapp_phone_e164 TEXT;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS whatsapp_verified_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_whatsapp_phone_e164_key'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_whatsapp_phone_e164_key UNIQUE (whatsapp_phone_e164);
  END IF;
END $$;

ALTER TABLE public.assistant_messages
  ALTER COLUMN conversation_id TYPE TEXT USING conversation_id::text;

ALTER TABLE public.assistant_messages
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'web';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assistant_messages_channel_check'
      AND conrelid = 'public.assistant_messages'::regclass
  ) THEN
    ALTER TABLE public.assistant_messages
      ADD CONSTRAINT assistant_messages_channel_check CHECK (channel IN ('web', 'whatsapp'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS assistant_messages_channel_conversation_idx
  ON public.assistant_messages (channel, conversation_id);
