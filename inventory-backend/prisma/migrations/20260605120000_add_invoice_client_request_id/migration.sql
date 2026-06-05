ALTER TABLE "invoices" ADD COLUMN "client_request_id" TEXT;

CREATE UNIQUE INDEX "invoices_client_request_id_key" ON "invoices"("client_request_id");
