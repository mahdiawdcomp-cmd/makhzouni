import { NextFunction, Request, Response } from "express";
import { AnyZodObject, ZodError } from "zod";

export function validate(schema: AnyZodObject) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = schema.parse({
        body: req.body,
        params: req.params,
        query: req.query,
      });

      req.body = parsed.body ?? req.body;
      req.params = parsed.params ?? req.params;
      req.validatedQuery = parsed.query;
      next();
    } catch (error) {
      next(error instanceof ZodError ? error : error);
    }
  };
}
