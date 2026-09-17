import { Router } from "express";
import {
  acknowledgeAuctionHandler,
  auctionResultsHandler,
  cancelAuctionHandler,
  createAuctionHandler,
  listAuctionsHandler,
} from "../controllers/auctions.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { requireAnyPermission } from "../middleware/permission.middleware";
import { validate } from "../middleware/validate";
import { createAuctionSchema, idParamSchema, listAuctionsSchema } from "../utils/schemas";

const router = Router();

router.use(authMiddleware);

// Auctions sell goods at a price and carry bidders' phone numbers: whoever may
// manage products or invoices. The dashboard banner is behind the same gate —
// hiding it in the UI alone would still hand the numbers to any staff login.
router.use(requireAnyPermission("MANAGE_PRODUCTS", "MANAGE_INVOICES"));
router.get("/results", auctionResultsHandler);
router.get("/", validate(listAuctionsSchema), listAuctionsHandler);
router.post("/", validate(createAuctionSchema), createAuctionHandler);
router.post("/:id/cancel", validate(idParamSchema), cancelAuctionHandler);
router.post("/:id/acknowledge", validate(idParamSchema), acknowledgeAuctionHandler);

export default router;
