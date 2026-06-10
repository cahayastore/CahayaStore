-- Order expiry + stock reservation for web checkout.
-- Additive only.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Reservation marker: stock item held for a pending order until this time.
ALTER TABLE product_stocks ADD COLUMN IF NOT EXISTS reserved_until TIMESTAMPTZ;
ALTER TABLE product_stocks ADD COLUMN IF NOT EXISTS reserved_order_id UUID REFERENCES orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_pending_expiry ON orders(payment_status, expires_at);
CREATE INDEX IF NOT EXISTS idx_stock_reserved ON product_stocks(product_id, status, reserved_until);
