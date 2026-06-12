-- Soft-delete support for users: keep name on invoices, hide from list
ALTER TABLE "users" ADD COLUMN "deleted_at" TIMESTAMP(3);
