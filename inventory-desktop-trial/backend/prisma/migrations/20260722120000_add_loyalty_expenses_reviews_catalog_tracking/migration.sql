-- AlterTable (simple additive ADD COLUMN — no table rebuild needed)
ALTER TABLE "payment_vouchers" ADD COLUMN "category" TEXT;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN "loyalty_points" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN "loyalty_points_earned" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "invoices" ADD COLUMN "rating_requested_at" DATETIME;

-- CreateTable
CREATE TABLE "product_reviews" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoice_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "rating" INTEGER,
    "comment" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_reviews_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "product_reviews_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "catalog_cart_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phone" TEXT NOT NULL,
    "item_count" INTEGER NOT NULL,
    "total_value" DECIMAL NOT NULL DEFAULT 0,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "completed_at" DATETIME,
    "notified_at" DATETIME
);

-- CreateTable
CREATE TABLE "catalog_search_misses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "query" TEXT NOT NULL,
    "phone" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
