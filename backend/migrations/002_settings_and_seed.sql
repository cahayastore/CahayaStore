-- Settings key-value store for runtime config managed by admin panel.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  is_secret BOOLEAN NOT NULL DEFAULT FALSE,
  value_plain JSONB,
  value_encrypted JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default categories
INSERT INTO categories (name, slug) VALUES
  ('File Digital', 'file-digital'),
  ('Akun', 'akun'),
  ('Voucher', 'voucher')
ON CONFLICT (slug) DO NOTHING;

-- Seed demo products (only if products table is empty)
INSERT INTO products (name, slug, description, price, product_type, stock_type, category_id, is_active)
SELECT 'Template Notion Premium', 'template-notion-premium',
       'Template Notion siap pakai untuk produktivitas harian.',
       45000, 'file', 'file', (SELECT id FROM categories WHERE slug='file-digital'), TRUE
WHERE NOT EXISTS (SELECT 1 FROM products WHERE slug='template-notion-premium');

INSERT INTO products (name, slug, description, price, product_type, stock_type, category_id, is_active)
SELECT 'Akun Streaming Premium 1 Bulan', 'akun-streaming-1-bulan',
       'Akun streaming bersama premium garansi 30 hari.',
       35000, 'account', 'credential', (SELECT id FROM categories WHERE slug='akun'), TRUE
WHERE NOT EXISTS (SELECT 1 FROM products WHERE slug='akun-streaming-1-bulan');

INSERT INTO products (name, slug, description, price, product_type, stock_type, category_id, is_active)
SELECT 'Voucher Game 50K', 'voucher-game-50k',
       'Voucher top up game nominal 50.000.',
       52000, 'voucher', 'code', (SELECT id FROM categories WHERE slug='voucher'), TRUE
WHERE NOT EXISTS (SELECT 1 FROM products WHERE slug='voucher-game-50k');
