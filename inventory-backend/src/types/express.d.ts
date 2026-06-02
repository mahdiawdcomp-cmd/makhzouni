import { UserRole } from "@prisma/client";

declare global {
  namespace Express {
    interface User {
      id: string;
      name: string;
      username: string;
      role: UserRole;
      isActive: boolean;
    }

    interface Request {
      user?: User;
      validatedQuery?: unknown;
    }
  }
}

export {};
