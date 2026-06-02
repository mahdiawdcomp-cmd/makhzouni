CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'STAFF');
CREATE TYPE "PaymentType" AS ENUM ('CASH', 'CREDIT', 'PARTIAL');
CREATE TYPE "InvoiceStatus" AS ENUM ('ACTIVE', 'CANCELLED');
CREATE TYPE "Unit" AS ENUM ('PIECE', 'DOZEN', 'CARTON');
CREATE TYPE "VoucherType" AS ENUM ('RECEIPT', 'PAYMENT');
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "StockMovementType" AS ENUM ('IN', 'OUT');

CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'STAFF',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "products" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "item_number" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "qr_code" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "opening_balance_pcs" INTEGER NOT NULL DEFAULT 0,
  "cartons_available" INTEGER NOT NULL DEFAULT 0,
  "pcs_per_carton" INTEGER NOT NULL DEFAULT 1,
  "purchase_price" DECIMAL(12,2) NOT NULL,
  "sale_price" DECIMAL(12,2) NOT NULL,
  "min_stock" INTEGER NOT NULL DEFAULT 0,
  "current_stock" INTEGER GENERATED ALWAYS AS ("opening_balance_pcs" + ("cartons_available" * "pcs_per_carton")) STORED,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "address" TEXT,
  "notes" TEXT,
  "opening_balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "current_balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "last_transaction_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invoices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "invoice_number" TEXT NOT NULL,
  "customer_id" UUID NOT NULL,
  "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "subtotal" DECIMAL(12,2) NOT NULL,
  "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total_amount" DECIMAL(12,2) NOT NULL,
  "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "remaining_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "previous_balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "final_balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "payment_type" "PaymentType" NOT NULL,
  "status" "InvoiceStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invoice_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "invoice_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "product_name" TEXT NOT NULL,
  "unit" "Unit" NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unit_price" DECIMAL(12,2) NOT NULL,
  "total_price" DECIMAL(12,2) NOT NULL,
  CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_vouchers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "voucher_number" TEXT NOT NULL,
  "customer_id" UUID NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "type" "VoucherType" NOT NULL,
  "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_vouchers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pending_approvals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "request_type" TEXT NOT NULL,
  "request_data" JSONB NOT NULL,
  "requested_by" UUID NOT NULL,
  "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "reviewed_by" UUID,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pending_approvals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "customer_id" UUID,
  "type" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "sent_at" TIMESTAMP(3),
  "is_read" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stock_movements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "product_id" UUID NOT NULL,
  "invoice_id" UUID,
  "type" "StockMovementType" NOT NULL,
  "quantity" INTEGER NOT NULL,
  "balance_before" INTEGER NOT NULL,
  "balance_after" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX "products_item_number_key" ON "products"("item_number");
CREATE UNIQUE INDEX "products_qr_code_key" ON "products"("qr_code");
CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");
CREATE UNIQUE INDEX "payment_vouchers_voucher_number_key" ON "payment_vouchers"("voucher_number");

CREATE INDEX "products_created_by_idx" ON "products"("created_by");
CREATE INDEX "invoices_customer_id_idx" ON "invoices"("customer_id");
CREATE INDEX "invoices_created_by_idx" ON "invoices"("created_by");
CREATE INDEX "invoice_items_invoice_id_idx" ON "invoice_items"("invoice_id");
CREATE INDEX "invoice_items_product_id_idx" ON "invoice_items"("product_id");
CREATE INDEX "payment_vouchers_customer_id_idx" ON "payment_vouchers"("customer_id");
CREATE INDEX "payment_vouchers_created_by_idx" ON "payment_vouchers"("created_by");
CREATE INDEX "pending_approvals_requested_by_idx" ON "pending_approvals"("requested_by");
CREATE INDEX "pending_approvals_reviewed_by_idx" ON "pending_approvals"("reviewed_by");
CREATE INDEX "notifications_customer_id_idx" ON "notifications"("customer_id");
CREATE INDEX "stock_movements_product_id_idx" ON "stock_movements"("product_id");
CREATE INDEX "stock_movements_invoice_id_idx" ON "stock_movements"("invoice_id");

ALTER TABLE "products" ADD CONSTRAINT "products_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pending_approvals" ADD CONSTRAINT "pending_approvals_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pending_approvals" ADD CONSTRAINT "pending_approvals_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
