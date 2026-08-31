import { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AppError } from "../utils/app-error";
import { recordError } from "../services/error-log.service";

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  if (error instanceof ZodError) {
    const firstIssue = error.issues[0];
    const field = firstIssue?.path?.slice(1).join(".");
    return res.status(422).json({
      success: false,
      message: firstIssue ? `${field ? `${field}: ` : ""}${firstIssue.message}` : "Validation failed",
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

  // Multer (file uploads) rejects with its own error class, which used to fall
  // through to the generic 500 — so "ملف أكبر من الحد" or "صيغة غير مدعومة"
  // reached the user as a bare English "Internal server error".
  if (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "MulterError"
  ) {
    const code = (error as { code?: string }).code;
    const message =
      code === "LIMIT_FILE_SIZE"
        ? "الملف أكبر من الحد المسموح (25 ميغابايت) — احذف الصور المدمجة من ملف Excel وأعد المحاولة"
        : code === "LIMIT_FILE_COUNT" || code === "LIMIT_UNEXPECTED_FILE"
          ? "ارفع ملفاً واحداً فقط"
          : (error as { message?: string }).message || "تعذّر رفع الملف";
    return res.status(code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
      success: false,
      message,
      code: code ?? "UPLOAD_ERROR",
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

  // Unexpected 500s land in ErrorLog so they surface on /error-logs.
  // Fire-and-forget — recordError never throws.
  void recordError({
    source: "API",
    code: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null,
    message: error instanceof Error ? error.message : String(error),
    context: { method: req.method, path: req.originalUrl?.slice(0, 300) },
  });

  return res.status(500).json({
    success: false,
    message: "Internal server error",
  });
}
