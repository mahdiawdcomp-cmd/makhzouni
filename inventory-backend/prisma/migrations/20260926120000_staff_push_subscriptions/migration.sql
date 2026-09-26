-- «شاشة التجهيز»: staff phone push subscriptions. Additive only.
CREATE TABLE IF NOT EXISTS "staff_push_subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "subscription" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "staff_push_subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "staff_push_subscriptions_endpoint_key" ON "staff_push_subscriptions"("endpoint");
CREATE INDEX IF NOT EXISTS "staff_push_subscriptions_user_id_idx" ON "staff_push_subscriptions"("user_id");