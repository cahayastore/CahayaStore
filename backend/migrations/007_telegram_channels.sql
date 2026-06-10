-- 007 — Telegram account linking + order channel attribution.
-- Additive only, idempotent.

-- Link a marketplace user to a Telegram account.
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_id BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_username TEXT;

-- Unique telegram_id (allow many NULLs). Partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_id
  ON users (telegram_id) WHERE telegram_id IS NOT NULL;

-- Order source attribution: web | telegram | miniapp.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'web';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'orders' AND constraint_name = 'orders_channel_check'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_channel_check
      CHECK (channel IN ('web', 'telegram', 'miniapp'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_channel ON orders (channel);

-- Single-row bot configuration editable from admin (no redeploy).
CREATE TABLE IF NOT EXISTS bot_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  welcome_message TEXT,
  banner_url TEXT,
  menu_config JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO bot_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
