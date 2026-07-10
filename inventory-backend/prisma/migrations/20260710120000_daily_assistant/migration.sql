-- Daily Smart Assistant («المساعد الذكي اليومي») — additive only.

-- Precomputed snapshot storage (daily heavy indicators + weekly basket analysis)
CREATE TABLE "assistant_snapshots" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "period_key" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "data" JSONB NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "assistant_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assistant_snapshots_kind_period_key_key" ON "assistant_snapshots"("kind", "period_key");
CREATE INDEX "assistant_snapshots_kind_generated_at_idx" ON "assistant_snapshots"("kind", "generated_at");

-- Supporting indexes for the assistant's pending-tasks + sleeping/customer queries
CREATE INDEX "pending_approvals_status_idx" ON "pending_approvals"("status");
CREATE INDEX "inventory_transfers_status_idx" ON "inventory_transfers"("status");
CREATE INDEX "customers_last_transaction_at_idx" ON "customers"("last_transaction_at");
