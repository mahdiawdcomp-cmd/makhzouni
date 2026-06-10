-- CreateTable
CREATE TABLE "client_payments" (
    "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
    "client_id"  UUID         NOT NULL,
    "amount"     DOUBLE PRECISION NOT NULL,
    "currency"   TEXT         NOT NULL DEFAULT 'USD',
    "paid_at"    TIMESTAMP(3) NOT NULL,
    "method"     TEXT,
    "notes"      TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "client_payments_client_id_idx" ON "client_payments"("client_id");

ALTER TABLE "client_payments"
  ADD CONSTRAINT "client_payments_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "licensed_clients"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
