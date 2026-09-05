-- «جرد الفاتورة» — counting links + the soft "someone is editing" marker.
-- Purely additive: two new tables and two new enums. No existing table, column
-- or row is touched.

CREATE TYPE "InvoiceCountAudience" AS ENUM ('WORKER', 'CUSTOMER');

CREATE TYPE "InvoiceCountLinkStatus" AS ENUM ('OPEN', 'VIEWED', 'SUBMITTED', 'EXPIRED', 'REVOKED');

CREATE TABLE "invoice_count_links" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "audience" "InvoiceCountAudience" NOT NULL,
    "token" TEXT NOT NULL,
    "status" "InvoiceCountLinkStatus" NOT NULL DEFAULT 'OPEN',
    "recipient_id" TEXT,
    "recipient_name" TEXT NOT NULL,
    "recipient_phone" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "first_viewed_at" TIMESTAMP(3),
    "last_viewed_at" TIMESTAMP(3),
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "submitted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "result" JSONB,
    "has_difference" BOOLEAN NOT NULL DEFAULT false,
    "applied_at" TIMESTAMP(3),
    "approval_id" UUID,
    "refund_due" DECIMAL(12,2),
    "refund_ack_at" TIMESTAMP(3),
    "refund_ack_by" UUID,

    CONSTRAINT "invoice_count_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invoice_count_links_token_key" ON "invoice_count_links"("token");
CREATE INDEX "invoice_count_links_invoice_id_idx" ON "invoice_count_links"("invoice_id");
CREATE INDEX "invoice_count_links_status_idx" ON "invoice_count_links"("status");
CREATE INDEX "invoice_count_links_audience_idx" ON "invoice_count_links"("audience");
CREATE INDEX "invoice_count_links_expires_at_idx" ON "invoice_count_links"("expires_at");

ALTER TABLE "invoice_count_links" ADD CONSTRAINT "invoice_count_links_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoice_count_links" ADD CONSTRAINT "invoice_count_links_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_count_links" ADD CONSTRAINT "invoice_count_links_refund_ack_by_fkey"
    FOREIGN KEY ("refund_ack_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "invoice_edit_locks" (
    "invoice_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "user_name" TEXT NOT NULL,
    "heartbeat_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_edit_locks_pkey" PRIMARY KEY ("invoice_id")
);

CREATE INDEX "invoice_edit_locks_heartbeat_at_idx" ON "invoice_edit_locks"("heartbeat_at");

ALTER TABLE "invoice_edit_locks" ADD CONSTRAINT "invoice_edit_locks_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoice_edit_locks" ADD CONSTRAINT "invoice_edit_locks_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
