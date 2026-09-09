-- Per-number daily ceiling on paid AI replies. The shop's concern, verbatim:
-- «ليش اصرف فلوس على امور تافهه؟» — a chatty non-buyer should not be able to
-- quietly spend the API balance. Additive only.

ALTER TABLE "whatsapp_ai_chats" ADD COLUMN "replies_today" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "whatsapp_ai_chats" ADD COLUMN "today_key" TEXT;
