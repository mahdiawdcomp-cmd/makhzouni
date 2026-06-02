ALTER TABLE "products" ADD COLUMN "deleted_at" TIMESTAMP(3);

CREATE INDEX "products_deleted_at_idx" ON "products"("deleted_at");
