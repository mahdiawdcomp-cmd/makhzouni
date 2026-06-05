UPDATE "products"
SET "carton_qr_code" = 'CTN-' || md5(random()::text || clock_timestamp()::text || "id"::text)
WHERE "deleted_at" IS NULL
  AND (
    "carton_qr_code" IS NULL
    OR "carton_qr_code" = ''
    OR "carton_qr_code" = "qr_code"
  );
