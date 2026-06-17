-- Normalize every customer phone to international Iraq format (964XXXXXXXXXX)
-- so the WhatsApp integration and the public-catalog phone lookup match a
-- single canonical form. Customers imported earlier were stored as local
-- (07...) while catalog-created ones were stored as 964..., which produced
-- duplicate records (e.g. مهدي / مهودي). This migration:
--   1. merges any customers that collapse onto the same normalized phone
--      (keeps the OLDEST record, repoints all FKs, deletes the rest),
--   2. rewrites every phone to its normalized form.
-- Idempotent: re-running is a no-op once phones are already normalized.

-- Temp helper: mirrors normalizePhone() in the app code.
CREATE OR REPLACE FUNCTION _norm_phone_tmp(p text) RETURNS text AS $$
DECLARE d text;
BEGIN
  d := regexp_replace(coalesce(p, ''), '\D', '', 'g');
  IF left(d, 2) = '00' THEN d := substr(d, 3); END IF;
  IF left(d, 3) = '964' THEN RETURN d; END IF;
  IF left(d, 1) = '0'  THEN RETURN '964' || substr(d, 2); END IF;
  IF left(d, 1) = '7'  THEN RETURN '964' || d; END IF;
  RETURN d;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 1) Merge duplicates onto the oldest record for each normalized phone.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.id AS loser_id, k.keeper_id
    FROM (
      SELECT id, _norm_phone_tmp(phone) AS norm,
             row_number() OVER (PARTITION BY _norm_phone_tmp(phone)
                                ORDER BY created_at ASC, id ASC) AS rn
      FROM customers
    ) c
    JOIN (
      SELECT DISTINCT ON (_norm_phone_tmp(phone))
             _norm_phone_tmp(phone) AS norm, id AS keeper_id
      FROM customers
      ORDER BY _norm_phone_tmp(phone), created_at ASC, id ASC
    ) k ON k.norm = c.norm
    WHERE c.rn > 1
  LOOP
    UPDATE invoices              SET customer_id = r.keeper_id WHERE customer_id = r.loser_id;
    UPDATE payment_vouchers      SET customer_id = r.keeper_id WHERE customer_id = r.loser_id;
    UPDATE coupon_redemptions    SET customer_id = r.keeper_id WHERE customer_id = r.loser_id;
    UPDATE quotations            SET customer_id = r.keeper_id WHERE customer_id = r.loser_id;
    UPDATE notifications         SET customer_id = r.keeper_id WHERE customer_id = r.loser_id;
    UPDATE customer_portal_links SET customer_id = r.keeper_id WHERE customer_id = r.loser_id;
    UPDATE catalog_access_links  SET customer_id = r.keeper_id WHERE customer_id = r.loser_id;
    DELETE FROM customers WHERE id = r.loser_id;
  END LOOP;
END $$;

-- 2) Rewrite every phone to its normalized form.
UPDATE customers
SET phone = _norm_phone_tmp(phone)
WHERE phone <> _norm_phone_tmp(phone);

DROP FUNCTION _norm_phone_tmp(text);
