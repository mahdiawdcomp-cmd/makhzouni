CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "branches_code_key" ON "branches"("code");
CREATE INDEX "branches_created_by_idx" ON "branches"("created_by");

ALTER TABLE "branches" ADD CONSTRAINT "branches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "products" ADD COLUMN "branch_id" UUID;
ALTER TABLE "customers" ADD COLUMN "branch_id" UUID;
ALTER TABLE "invoices" ADD COLUMN "branch_id" UUID;
ALTER TABLE "payment_vouchers" ADD COLUMN "branch_id" UUID;
ALTER TABLE "stock_movements" ADD COLUMN "branch_id" UUID;

CREATE INDEX "products_branch_id_idx" ON "products"("branch_id");
CREATE INDEX "customers_branch_id_idx" ON "customers"("branch_id");
CREATE INDEX "invoices_branch_id_idx" ON "invoices"("branch_id");
CREATE INDEX "payment_vouchers_branch_id_idx" ON "payment_vouchers"("branch_id");
CREATE INDEX "stock_movements_branch_id_idx" ON "stock_movements"("branch_id");

ALTER TABLE "products" ADD CONSTRAINT "products_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customers" ADD CONSTRAINT "customers_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
