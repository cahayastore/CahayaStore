-- Category image for storefront category tiles. Additive only.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS image_url TEXT;
