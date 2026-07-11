-- «الديون الشخصية» (personal debts, unrelated to shop customers) — additive only.

-- CreateTable
CREATE TABLE "personal_debts" (
    "id" UUID NOT NULL,
    "person_name" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "personal_debts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "personal_debts_status_due_date_idx" ON "personal_debts"("status", "due_date");
CREATE INDEX "personal_debts_created_by_idx" ON "personal_debts"("created_by");

ALTER TABLE "personal_debts" ADD CONSTRAINT "personal_debts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
