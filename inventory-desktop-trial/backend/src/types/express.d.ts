import { UserRole } from "@prisma/client";

declare global {
  namespace Express {
    interface User {
      id: string;
      name: string;
      username: string;
      role: UserRole;
      permissions: string[];
      isActive: boolean;
    }

    interface Request {
      user?: User;
      validatedQuery?: unknown;
    }
  }
}

export {};
