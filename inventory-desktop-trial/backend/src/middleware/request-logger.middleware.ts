import { NextFunction, Request, Response } from "express";

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const startedAt = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - startedAt;
    const user = req.user ? ` user=${req.user.username}` : "";
    console.log(
      `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms${user}`
    );
  });

  next();
}
