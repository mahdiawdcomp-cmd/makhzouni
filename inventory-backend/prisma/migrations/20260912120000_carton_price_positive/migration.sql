ALTER TABLE "products" DROP CONSTRAINT "products_carton_price_valid";

ALTER TABLE "products"
ADD CONSTRAINT "products_carton_price_valid"
CHECK ("carton_piece_price" IS NULL OR ("carton_piece_price" > 0 AND "carton_piece_price" <= "sale_price"));
