-- Optional WhatsApp/phone number per user, used to notify the requester and
-- assigned staff about stock-transfer requests and their approval/rejection.
-- Additive + nullable — safe on prod.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" TEXT;
