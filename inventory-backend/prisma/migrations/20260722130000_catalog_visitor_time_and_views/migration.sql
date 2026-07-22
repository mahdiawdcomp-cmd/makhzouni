-- AlterTable
ALTER TABLE "catalog_visitors" ADD COLUMN     "total_time_seconds" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "catalog_visitor_product_views" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_visitor_product_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "catalog_visitor_product_views_phone_viewed_at_idx" ON "catalog_visitor_product_views"("phone", "viewed_at");
