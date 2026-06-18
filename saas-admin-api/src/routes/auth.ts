import { Router, Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { z } from "zod";
import prisma from "../prisma";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

router.post("/login", async (req: Request, res: Response) => {
  const body = loginSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "username and password required" });
    return;
  }

  const admin = await prisma.adminUser.findUnique({ where: { username: body.data.username } });
  if (!admin) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const valid = await bcrypt.compare(body.data.password, admin.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const token = jwt.sign({ adminId: admin.id }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token });
});

export default router;
