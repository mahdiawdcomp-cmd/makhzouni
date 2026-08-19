-- Additive only. Records a phone number that asked to stop receiving
-- marketing, so the "للتوقف عن استلام الرسائل، رد بكلمة: توقف" line printed in
-- every campaign message is actually honoured.
--
-- Keyed by phone, not by customer: the request can come from a prospect, a
-- catalog visitor or a customer, and it must hold even if that number later
-- becomes a customer or stops being one.
--
-- Blocks campaigns and follow-ups only. Invoices, statements, vouchers and
-- login codes keep going out — those answer a transaction the customer
-- started, they are not the advertising that was opted out of.

CREATE TABLE "marketing_opt_outs" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "reason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'WHATSAPP_REPLY',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_opt_outs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marketing_opt_outs_phone_key" ON "marketing_opt_outs"("phone");
