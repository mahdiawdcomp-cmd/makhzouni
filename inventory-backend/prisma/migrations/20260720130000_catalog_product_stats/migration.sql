-- Per-product catalog engagement counters (views + orders).
CREATE TABLE "catalog_product_stats" (
    "product_id" UUID NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "last_viewed_at" TIMESTAMP(3),

    CONSTRAINT "catalog_product_stats_pkey" PRIMARY KEY ("product_id")
);
