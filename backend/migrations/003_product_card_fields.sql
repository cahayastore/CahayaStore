-- Card display fields for storefront product cards.
-- Additive only — safe to run on existing data.

-- Image shown on product cards / detail (URL).
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Original (pre-discount) price. When > price, storefront shows a strikethrough
-- and computes the discount percentage badge.
ALTER TABLE products ADD COLUMN IF NOT EXISTS original_price NUMERIC(14,2);
