import { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AppError } from "../utils/app-error";

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (error instanceof ZodError) {
    return res.status(422).json({
      success: false,
      message: "Validation failed",
      errors: error.flatten(),
    });
  }

  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      code: error.code,
    });
  }

  // صورة أكبر من الحد المسموح (يجب ألا يصل هنا بعد رفع الحد لـ 8mb)
  if (
    typeof error === "object" &&
    error !== null &&
    (error as { type?: string }).type === "entity.too.large"
  ) {
    return res.status(413).json({
      success: false,
      message: "الصورة كبيرة جداً — قلّص حجمها أو اختر صورة أوضح وأصغر",
      code: "PAYLOAD_TOO_LARGE",
    });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      const target = Array.isArray(error.meta?.target)
        ? error.meta.target.join(", ")
        : String(error.meta?.target ?? "");
      return res.status(409).json({
        success: false,
        message: target
          ? `Duplicate value already exists: ${target}`
          : "Duplicate value violates a unique constraint",
        code: error.code,
      });
    }

    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        message: "Record not found",
        code: error.code,
      });
    }
  }

  console.error(error);

  return res.status(500).json({
    success: false,
    message: "Internal server error",
    // TEMP debug: surface the error name/message to diagnose the transfer-approval 500.
    debug: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  });
}
