-- CreateTable
CREATE TABLE "stock_losses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "loss_number" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'DAMAGE',
    "notes" TEXT,
    "cancelled_at" DATETIME,
    "created_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "stock_losses_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "branches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "stock_losses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "stock_loss_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "loss_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    CONSTRAINT "stock_loss_items_loss_id_fkey" FOREIGN KEY ("loss_id") REFERENCES "stock_losses" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "stock_loss_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'STAFF',
    "permissions" JSONB NOT NULL DEFAULT [],
    "phone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "branches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "item_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "qr_code" TEXT NOT NULL,
    "carton_qr_code" TEXT,
    "image_url" TEXT,
    "category" TEXT,
    "opening_balance_pcs" INTEGER NOT NULL DEFAULT 0,
    "cartons_available" INTEGER NOT NULL DEFAULT 0,
    "pcs_per_carton" INTEGER NOT NULL DEFAULT 1,
    "purchase_price" DECIMAL NOT NULL DEFAULT 0,
    "sale_price" DECIMAL NOT NULL DEFAULT 0,
    "retail_price" DECIMAL NOT NULL DEFAULT 0,
    "cost_price" DECIMAL NOT NULL DEFAULT 0,
    "expiry_date" DATETIME,
    "min_stock" INTEGER NOT NULL DEFAULT 0,
    "current_stock" INTEGER NOT NULL DEFAULT 0,
    "storage_location" TEXT,
    "branch_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "category_tags" JSONB NOT NULL DEFAULT [],
    "type_tags" JSONB NOT NULL DEFAULT [],
    "is_new_arrival" BOOLEAN NOT NULL DEFAULT false,
    "is_offer" BOOLEAN NOT NULL DEFAULT false,
    "old_price" DECIMAL,
    CONSTRAINT "products_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "products_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "product_warehouse_stocks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "quantity_pieces" INTEGER NOT NULL DEFAULT 0,
    "storage_location" TEXT,
    "min_stock" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "product_warehouse_stocks_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "product_warehouse_stocks_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "branches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "catalog_categories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "types" JSONB NOT NULL DEFAULT [],
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "counters" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT,
    "notes" TEXT,
    "is_supplier" BOOLEAN NOT NULL DEFAULT false,
    "is_both" BOOLEAN NOT NULL DEFAULT false,
    "tags" JSONB NOT NULL DEFAULT [],
    "catalog_link_sent_at" DATETIME,
    "opening_balance" DECIMAL NOT NULL DEFAULT 0,
    "current_balance" DECIMAL NOT NULL DEFAULT 0,
    "credit_limit" DECIMAL,
    "last_transaction_at" DATETIME,
    "branch_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    CONSTRAINT "customers_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "customer_tags" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "customer_portal_links" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "expires_at" DATETIME,
    "revoked_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_viewed_at" DATETIME,
    CONSTRAINT "customer_portal_links_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "catalog_access_links" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "allow_prices" BOOLEAN NOT NULL DEFAULT false,
    "show_stock" BOOLEAN NOT NULL DEFAULT true,
    "revoked_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_viewed_at" DATETIME,
    CONSTRAINT "catalog_access_links_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoice_number" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'SALE',
    "customer_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subtotal" DECIMAL NOT NULL,
    "discount" DECIMAL NOT NULL DEFAULT 0,
    "tax" DECIMAL NOT NULL DEFAULT 0,
    "total_amount" DECIMAL NOT NULL,
    "paid_amount" DECIMAL NOT NULL DEFAULT 0,
    "remaining_amount" DECIMAL NOT NULL DEFAULT 0,
    "previous_balance" DECIMAL NOT NULL DEFAULT 0,
    "final_balance" DECIMAL NOT NULL DEFAULT 0,
    "payment_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "client_request_id" TEXT,
    "coupon_id" TEXT,
    "original_invoice_id" TEXT,
    "source_quotation_id" TEXT,
    "created_by" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" DATETIME,
    "deleted_by" TEXT,
    "delete_reason" TEXT,
    CONSTRAINT "invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "invoices_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "invoices_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "invoices_original_invoice_id_fkey" FOREIGN KEY ("original_invoice_id") REFERENCES "invoices" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "invoices_source_quotation_id_fkey" FOREIGN KEY ("source_quotation_id") REFERENCES "quotations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoice_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "warehouse_id" TEXT,
    "product_name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL NOT NULL,
    "cost_price" DECIMAL NOT NULL DEFAULT 0,
    "total_price" DECIMAL NOT NULL,
    "notes" TEXT,
    CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "invoice_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "invoice_items_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "branches" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "payment_vouchers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "voucher_number" TEXT NOT NULL,
    "customer_id" TEXT,
    "description" TEXT,
    "branch_id" TEXT,
    "amount" DECIMAL NOT NULL,
    "type" TEXT NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" DATETIME,
    "archived_at" DATETIME,
    "deleted_by" TEXT,
    "delete_reason" TEXT,
    CONSTRAINT "payment_vouchers_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "payment_vouchers_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "payment_vouchers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discount_type" TEXT NOT NULL,
    "discount_value" DECIMAL NOT NULL,
    "starts_at" DATETIME,
    "ends_at" DATETIME,
    "max_uses" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "coupons_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "coupon_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "coupon_redemptions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "coupon_redemptions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "coupon_redemptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "quotations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quotation_number" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "subtotal" DECIMAL NOT NULL,
    "discount" DECIMAL NOT NULL DEFAULT 0,
    "total_amount" DECIMAL NOT NULL,
    "expires_at" DATETIME,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "quotations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "quotations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "quotation_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quotation_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL NOT NULL,
    "total_price" DECIMAL NOT NULL,
    CONSTRAINT "quotation_items_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "quotation_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "pending_approvals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "request_type" TEXT NOT NULL,
    "request_data" JSONB NOT NULL,
    "requested_by" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewed_by" TEXT,
    "reviewed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pending_approvals_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "pending_approvals_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customer_id" TEXT,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "sent_at" DATETIME,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "invoice_id" TEXT,
    "loss_id" TEXT,
    "type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "balance_before" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "stock_movements_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "stock_movements_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "record_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "inventory_transfers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transfer_number" TEXT NOT NULL,
    "from_branch_id" TEXT NOT NULL,
    "to_branch_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "inventory_transfers_from_branch_id_fkey" FOREIGN KEY ("from_branch_id") REFERENCES "branches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "inventory_transfers_to_branch_id_fkey" FOREIGN KEY ("to_branch_id") REFERENCES "branches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "inventory_transfers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "transfer_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transfer_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    CONSTRAINT "transfer_items_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "inventory_transfers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "transfer_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "order_preparations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoice_id" TEXT,
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "order_data" JSONB,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "prepared_at" DATETIME,
    "prepared_by_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_preparations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "order_preparations_prepared_by_id_fkey" FOREIGN KEY ("prepared_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "retail_catalog_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product_id" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "price" DECIMAL NOT NULL,
    "old_price" DECIMAL,
    "categories" JSONB NOT NULL DEFAULT [],
    "sub_categories" JSONB NOT NULL DEFAULT [],
    "images" JSONB NOT NULL DEFAULT [],
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "is_best_seller" BOOLEAN NOT NULL DEFAULT false,
    "is_new" BOOLEAN NOT NULL DEFAULT false,
    "is_offer" BOOLEAN NOT NULL DEFAULT false,
    "low_stock_badge" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "retail_catalog_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "retail_categories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sub_categories" JSONB NOT NULL DEFAULT [],
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "retail_customers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_subscriber" BOOLEAN NOT NULL DEFAULT false,
    "interests" JSONB NOT NULL DEFAULT [],
    "wish_note" TEXT,
    "orders_count" INTEGER NOT NULL DEFAULT 0,
    "last_order_at" DATETIME,
    "referral_code" TEXT,
    "referred_by" TEXT,
    "orders_token" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "retail_coupons" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discount_type" TEXT NOT NULL,
    "discount_value" DECIMAL NOT NULL,
    "starts_at" DATETIME,
    "ends_at" DATETIME,
    "max_uses" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "retail_orders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "order_number" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT,
    "notes" TEXT,
    "items" JSONB NOT NULL,
    "warehouse_id" TEXT,
    "warehouse_distribution" JSONB,
    "subtotal" DECIMAL NOT NULL,
    "discount" DECIMAL NOT NULL DEFAULT 0,
    "referral_discount" DECIMAL NOT NULL DEFAULT 0,
    "total" DECIMAL NOT NULL,
    "coupon_code" TEXT,
    "referral_code" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "invoice_id" TEXT,
    "prepared_at" DATETIME,
    "prepared_by_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "stocktake_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "public_token" TEXT NOT NULL,
    "branch_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" DATETIME,
    CONSTRAINT "stocktake_sessions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "stocktake_sessions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "stocktake_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "session_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "system_qty" INTEGER NOT NULL,
    "actual_qty" INTEGER,
    "variance" INTEGER,
    "notes" TEXT,
    "approval_status" TEXT NOT NULL DEFAULT 'PENDING',
    "approved_qty" INTEGER,
    CONSTRAINT "stocktake_items_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "stocktake_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "stocktake_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "licensed_clients" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "license_key" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "months" INTEGER NOT NULL,
    "notes" TEXT,
    "contact_phone" TEXT,
    "contact_email" TEXT,
    "backend_url" TEXT,
    "frontend_url" TEXT,
    "is_revoked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "client_payments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "client_id" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "paid_at" DATETIME NOT NULL,
    "method" TEXT,
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "client_payments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "licensed_clients" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_losses_loss_number_key" ON "stock_losses"("loss_number");

-- CreateIndex
CREATE INDEX "stock_losses_date_idx" ON "stock_losses"("date");

-- CreateIndex
CREATE INDEX "stock_losses_warehouse_id_idx" ON "stock_losses"("warehouse_id");

-- CreateIndex
CREATE INDEX "stock_loss_items_loss_id_idx" ON "stock_loss_items"("loss_id");

-- CreateIndex
CREATE INDEX "stock_loss_items_product_id_idx" ON "stock_loss_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "branches_code_key" ON "branches"("code");

-- CreateIndex
CREATE INDEX "branches_created_by_idx" ON "branches"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "products_item_number_key" ON "products"("item_number");

-- CreateIndex
CREATE UNIQUE INDEX "products_qr_code_key" ON "products"("qr_code");

-- CreateIndex
CREATE UNIQUE INDEX "products_carton_qr_code_key" ON "products"("carton_qr_code");

-- CreateIndex
CREATE INDEX "products_created_by_idx" ON "products"("created_by");

-- CreateIndex
CREATE INDEX "products_branch_id_idx" ON "products"("branch_id");

-- CreateIndex
CREATE INDEX "products_deleted_at_idx" ON "products"("deleted_at");

-- CreateIndex
CREATE INDEX "product_warehouse_stocks_warehouse_id_idx" ON "product_warehouse_stocks"("warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_warehouse_stocks_product_id_warehouse_id_key" ON "product_warehouse_stocks"("product_id", "warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_categories_name_key" ON "catalog_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "customers_branch_id_idx" ON "customers"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_tags_name_key" ON "customer_tags"("name");

-- CreateIndex
CREATE UNIQUE INDEX "customer_portal_links_token_key" ON "customer_portal_links"("token");

-- CreateIndex
CREATE UNIQUE INDEX "customer_portal_links_token_hash_key" ON "customer_portal_links"("token_hash");

-- CreateIndex
CREATE INDEX "customer_portal_links_customer_id_idx" ON "customer_portal_links"("customer_id");

-- CreateIndex
CREATE INDEX "customer_portal_links_expires_at_idx" ON "customer_portal_links"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_access_links_token_key" ON "catalog_access_links"("token");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_access_links_token_hash_key" ON "catalog_access_links"("token_hash");

-- CreateIndex
CREATE INDEX "catalog_access_links_customer_id_idx" ON "catalog_access_links"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_client_request_id_key" ON "invoices"("client_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_source_quotation_id_key" ON "invoices"("source_quotation_id");

-- CreateIndex
CREATE INDEX "invoices_customer_id_idx" ON "invoices"("customer_id");

-- CreateIndex
CREATE INDEX "invoices_date_idx" ON "invoices"("date");

-- CreateIndex
CREATE INDEX "invoices_created_at_idx" ON "invoices"("created_at");

-- CreateIndex
CREATE INDEX "invoices_customer_id_date_idx" ON "invoices"("customer_id", "date");

-- CreateIndex
CREATE INDEX "invoices_created_by_idx" ON "invoices"("created_by");

-- CreateIndex
CREATE INDEX "invoices_branch_id_idx" ON "invoices"("branch_id");

-- CreateIndex
CREATE INDEX "invoices_coupon_id_idx" ON "invoices"("coupon_id");

-- CreateIndex
CREATE INDEX "invoices_original_invoice_id_idx" ON "invoices"("original_invoice_id");

-- CreateIndex
CREATE INDEX "invoices_archived_at_idx" ON "invoices"("archived_at");

-- CreateIndex
CREATE INDEX "invoice_items_invoice_id_idx" ON "invoice_items"("invoice_id");

-- CreateIndex
CREATE INDEX "invoice_items_product_id_idx" ON "invoice_items"("product_id");

-- CreateIndex
CREATE INDEX "invoice_items_warehouse_id_idx" ON "invoice_items"("warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_vouchers_voucher_number_key" ON "payment_vouchers"("voucher_number");

-- CreateIndex
CREATE INDEX "payment_vouchers_customer_id_idx" ON "payment_vouchers"("customer_id");

-- CreateIndex
CREATE INDEX "payment_vouchers_date_idx" ON "payment_vouchers"("date");

-- CreateIndex
CREATE INDEX "payment_vouchers_created_at_idx" ON "payment_vouchers"("created_at");

-- CreateIndex
CREATE INDEX "payment_vouchers_created_by_idx" ON "payment_vouchers"("created_by");

-- CreateIndex
CREATE INDEX "payment_vouchers_branch_id_idx" ON "payment_vouchers"("branch_id");

-- CreateIndex
CREATE INDEX "payment_vouchers_archived_at_idx" ON "payment_vouchers"("archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE INDEX "coupons_is_active_idx" ON "coupons"("is_active");

-- CreateIndex
CREATE INDEX "coupons_starts_at_ends_at_idx" ON "coupons"("starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "coupon_redemptions_customer_id_idx" ON "coupon_redemptions"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_coupon_id_invoice_id_key" ON "coupon_redemptions"("coupon_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_quotation_number_key" ON "quotations"("quotation_number");

-- CreateIndex
CREATE INDEX "quotations_customer_id_idx" ON "quotations"("customer_id");

-- CreateIndex
CREATE INDEX "quotations_status_idx" ON "quotations"("status");

-- CreateIndex
CREATE INDEX "quotations_created_by_idx" ON "quotations"("created_by");

-- CreateIndex
CREATE INDEX "quotation_items_quotation_id_idx" ON "quotation_items"("quotation_id");

-- CreateIndex
CREATE INDEX "quotation_items_product_id_idx" ON "quotation_items"("product_id");

-- CreateIndex
CREATE INDEX "pending_approvals_requested_by_idx" ON "pending_approvals"("requested_by");

-- CreateIndex
CREATE INDEX "pending_approvals_reviewed_by_idx" ON "pending_approvals"("reviewed_by");

-- CreateIndex
CREATE INDEX "notifications_customer_id_idx" ON "notifications"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_name_key" ON "message_templates"("name");

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_key" ON "settings"("key");

-- CreateIndex
CREATE INDEX "stock_movements_product_id_idx" ON "stock_movements"("product_id");

-- CreateIndex
CREATE INDEX "stock_movements_created_at_idx" ON "stock_movements"("created_at");

-- CreateIndex
CREATE INDEX "stock_movements_product_id_created_at_idx" ON "stock_movements"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_invoice_id_idx" ON "stock_movements"("invoice_id");

-- CreateIndex
CREATE INDEX "stock_movements_branch_id_idx" ON "stock_movements"("branch_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs"("entity");

-- CreateIndex
CREATE INDEX "audit_logs_record_id_idx" ON "audit_logs"("record_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_transfers_transfer_number_key" ON "inventory_transfers"("transfer_number");

-- CreateIndex
CREATE INDEX "inventory_transfers_from_branch_id_idx" ON "inventory_transfers"("from_branch_id");

-- CreateIndex
CREATE INDEX "inventory_transfers_to_branch_id_idx" ON "inventory_transfers"("to_branch_id");

-- CreateIndex
CREATE INDEX "inventory_transfers_created_by_idx" ON "inventory_transfers"("created_by");

-- CreateIndex
CREATE INDEX "transfer_items_transfer_id_idx" ON "transfer_items"("transfer_id");

-- CreateIndex
CREATE INDEX "transfer_items_product_id_idx" ON "transfer_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_preparations_invoice_id_key" ON "order_preparations"("invoice_id");

-- CreateIndex
CREATE INDEX "order_preparations_status_idx" ON "order_preparations"("status");

-- CreateIndex
CREATE INDEX "retail_catalog_items_is_active_idx" ON "retail_catalog_items"("is_active");

-- CreateIndex
CREATE INDEX "retail_catalog_items_product_id_idx" ON "retail_catalog_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "retail_categories_name_key" ON "retail_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "retail_customers_phone_key" ON "retail_customers"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "retail_customers_referral_code_key" ON "retail_customers"("referral_code");

-- CreateIndex
CREATE UNIQUE INDEX "retail_customers_orders_token_key" ON "retail_customers"("orders_token");

-- CreateIndex
CREATE INDEX "retail_customers_is_subscriber_idx" ON "retail_customers"("is_subscriber");

-- CreateIndex
CREATE UNIQUE INDEX "retail_coupons_code_key" ON "retail_coupons"("code");

-- CreateIndex
CREATE INDEX "retail_coupons_is_active_idx" ON "retail_coupons"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "retail_orders_order_number_key" ON "retail_orders"("order_number");

-- CreateIndex
CREATE INDEX "retail_orders_status_idx" ON "retail_orders"("status");

-- CreateIndex
CREATE INDEX "retail_orders_phone_idx" ON "retail_orders"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "stocktake_sessions_public_token_key" ON "stocktake_sessions"("public_token");

-- CreateIndex
CREATE INDEX "stocktake_sessions_branch_id_idx" ON "stocktake_sessions"("branch_id");

-- CreateIndex
CREATE INDEX "stocktake_sessions_created_by_idx" ON "stocktake_sessions"("created_by");

-- CreateIndex
CREATE INDEX "stocktake_sessions_status_idx" ON "stocktake_sessions"("status");

-- CreateIndex
CREATE INDEX "stocktake_items_session_id_idx" ON "stocktake_items"("session_id");

-- CreateIndex
CREATE INDEX "stocktake_items_approval_status_idx" ON "stocktake_items"("approval_status");

-- CreateIndex
CREATE UNIQUE INDEX "stocktake_items_session_id_product_id_key" ON "stocktake_items"("session_id", "product_id");

-- CreateIndex
CREATE INDEX "client_payments_client_id_idx" ON "client_payments"("client_id");
