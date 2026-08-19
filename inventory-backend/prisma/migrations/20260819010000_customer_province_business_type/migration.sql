-- Additive only. Two optional columns feeding بند ٤ of the WhatsApp funnel
-- plan: province drives the automatic "محافظات"/governorate tags and the
-- region-based delivery message; business_type is an admin-entered tag
-- source until the WhatsApp registration conversation (بند ٥) can ask for it
-- directly. Both nullable — no existing customer is required to have them.

ALTER TABLE "customers" ADD COLUMN "province" TEXT;
ALTER TABLE "customers" ADD COLUMN "business_type" TEXT;
