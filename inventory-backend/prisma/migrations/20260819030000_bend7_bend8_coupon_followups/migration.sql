-- Additive only. بند ٧ — first-order welcome coupon (auto-issued on
-- CATALOG_ACCESS approval) needs a source marker (distinguish from manual
-- promo codes) and an expiry-reminder dedupe flag. بند ٨ — three fully
-- automatic follow-ups each need a permanent once-ever dedupe flag on the
-- entity they target.

ALTER TABLE "promo_codes" ADD COLUMN "source" TEXT;
ALTER TABLE "promo_codes" ADD COLUMN "reminder_sent_at" TIMESTAMP(3);

ALTER TABLE "prospects" ADD COLUMN "no_reply_follow_up_sent_at" TIMESTAMP(3);

ALTER TABLE "customers" ADD COLUMN "registered_no_order_follow_up_sent_at" TIMESTAMP(3);
ALTER TABLE "customers" ADD COLUMN "inactive_follow_up_sent_at" TIMESTAMP(3);
