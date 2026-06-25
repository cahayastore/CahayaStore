-- 009 — Barcode stock type.
-- Adds 'barcode' as a valid value for products.stock_type,
-- product_stocks.content_type, and deliveries.delivery_type.
-- Stored like any other credential: the barcode VALUE goes in
-- encrypted_content; the symbology (code128/ean13/qrcode/auto) is kept in a
-- new product_stocks.barcode_symbology column. Additive + idempotent.

-- 1) products.stock_type — allow 'barcode'.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_stock_type_check;
ALTER TABLE products
  ADD CONSTRAINT products_stock_type_check
  CHECK (stock_type IN ('file', 'credential', 'code', 'manual', 'barcode'));

-- 2) product_stocks.content_type — allow 'barcode'.
ALTER TABLE product_stocks DROP CONSTRAINT IF EXISTS product_stocks_content_type_check;
ALTER TABLE product_stocks
  ADD CONSTRAINT product_stocks_content_type_check
  CHECK (content_type IN ('file', 'credential', 'code', 'note', 'barcode'));

-- 3) Symbology for a barcode stock unit (NULL for non-barcode rows).
--    Values: code128 | ean13 | qrcode | auto
ALTER TABLE product_stocks ADD COLUMN IF NOT EXISTS barcode_symbology TEXT;

-- 4) deliveries.delivery_type — allow 'barcode'.
ALTER TABLE deliveries DROP CONSTRAINT IF EXISTS deliveries_delivery_type_check;
ALTER TABLE deliveries
  ADD CONSTRAINT deliveries_delivery_type_check
  CHECK (delivery_type IN ('file', 'credential', 'voucher', 'manual', 'barcode'));
