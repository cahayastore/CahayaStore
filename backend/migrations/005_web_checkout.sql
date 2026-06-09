-- Web checkout support: guest access token on orders + delivered content cache.
-- Additive only.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS access_token TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_whatsapp TEXT;

-- Index for fast token lookups on the public order/credentials endpoint.
CREATE INDEX IF NOT EXISTS idx_orders_access_token ON orders(access_token);

-- Track which stock item was delivered to which order item (one-time codes/accounts).
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS delivered_stock_id UUID REFERENCES product_stocks(id) ON DELETE SET NULL;
