-- Freeze the piece count on each stock-loss line at loss time (additive,
-- nullable — existing rows stay NULL and the profit report falls back to a live
-- re-computation for them). Stops historical loss valuations from silently
-- changing when a product's pcsPerCarton is edited after the loss was recorded.

ALTER TABLE "stock_loss_items" ADD COLUMN IF NOT EXISTS "quantity_pieces" INTEGER;
