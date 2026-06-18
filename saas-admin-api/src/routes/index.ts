import { Router } from "express";
import authRoutes from "./auth";
import tenantsRoutes from "./tenants";
import activateRoutes from "./activate";
import tenantConfigRoutes from "./tenant-config";

const router = Router();

router.use("/auth", authRoutes);
router.use("/tenants", tenantsRoutes);
router.use("/activate", activateRoutes);
router.use("/tenant-config", tenantConfigRoutes);

export default router;
