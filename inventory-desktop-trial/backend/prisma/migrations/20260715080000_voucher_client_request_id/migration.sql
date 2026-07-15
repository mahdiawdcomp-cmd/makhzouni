-- Additive: idempotency key for voucher creation (duplicate-submit protection)
ALTER TABLE "payment_vouchers" ADD COLUMN "client_request_id" TEXT;

CREATE UNIQUE INDEX "payment_vouchers_client_request_id_key" ON "payment_vouchers"("client_request_id");
