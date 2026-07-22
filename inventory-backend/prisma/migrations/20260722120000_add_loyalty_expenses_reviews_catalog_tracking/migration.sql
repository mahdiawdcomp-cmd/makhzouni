-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "loyalty_points" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "loyalty_points_earned" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rating_requested_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "payment_vouchers" ADD COLUMN     "category" TEXT;

-- CreateTable
CREATE TABLE "product_reviews" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "rating" INTEGER,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_cart_sessions" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "item_count" INTEGER NOT NULL,
    "total_value" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "notified_at" TIMESTAMP(3),

    CONSTRAINT "catalog_cart_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_search_misses" (
    "id" UUID NOT NULL,
    "query" TEXT NOT NULL,
    "phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_search_misses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_reviews_invoice_id_key" ON "product_reviews"("invoice_id");

-- CreateIndex
CREATE INDEX "product_reviews_customer_id_idx" ON "product_reviews"("customer_id");

-- CreateIndex
CREATE INDEX "catalog_cart_sessions_phone_idx" ON "catalog_cart_sessions"("phone");

-- CreateIndex
CREATE INDEX "catalog_cart_sessions_completed_at_notified_at_idx" ON "catalog_cart_sessions"("completed_at", "notified_at");

-- CreateIndex
CREATE INDEX "catalog_search_misses_query_idx" ON "catalog_search_misses"("query");

-- AddForeignKey
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
