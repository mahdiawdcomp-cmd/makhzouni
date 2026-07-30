-- Additive only: links an auto-generated depot→shop transfer back to the sale
-- that caused it, so cancelling/deleting that invoice can reverse the transfer
-- instead of permanently leaving the depot short and the shop long.
ALTER TABLE "inventory_transfers" ADD COLUMN "source_invoice_id" UUID;

CREATE INDEX "inventory_transfers_source_invoice_id_idx"
  ON "inventory_transfers"("source_invoice_id");
