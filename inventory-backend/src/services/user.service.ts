import bcrypt from "bcrypt";
import { Prisma, UserRole } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";

type Db = Prisma.TransactionClient | typeof prisma;

const userSelect = {
  id: true,
  name: true,
  username: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export interface CreateUserInput {
  name: string;
  username: string;
  password: string;
  role?: UserRole;
  isActive?: boolean;
}

export interface UpdateUserInput {
  name?: string;
  username?: string;
  password?: string;
  role?: UserRole;
  isActive?: boolean;
}

function getSaltRounds() {
  return Number(process.env.BCRYPT_SALT_ROUNDS ?? 10);
}

export async function listUsers() {
  return prisma.user.findMany({
    select: userSelect,
    orderBy: { createdAt: "desc" },
  });
}

export async function createUser(input: CreateUserInput, db: Db = prisma) {
  const passwordHash = await bcrypt.hash(input.password, getSaltRounds());

  return db.user.create({
    data: {
      name: input.name,
      username: input.username,
      passwordHash,
      role: input.role ?? UserRole.STAFF,
      isActive: input.isActive ?? true,
    },
    select: userSelect,
  });
}

export async function updateUser(id: string, input: UpdateUserInput, db: Db = prisma) {
  const data: Prisma.UserUpdateInput = {};

  if (input.name !== undefined) data.name = input.name;
  if (input.username !== undefined) data.username = input.username;
  if (input.role !== undefined) data.role = input.role;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.password !== undefined) {
    data.passwordHash = await bcrypt.hash(input.password, getSaltRounds());
  }

  return db.user.update({
    where: { id },
    data,
    select: userSelect,
  });
}

export async function deactivateUser(
  id: string,
  currentUserId?: string,
  db: Db = prisma
) {
  if (id === currentUserId) {
    throw new AppError("You cannot deactivate your own user", 400, "SELF_DEACTIVATE");
  }

  return db.user.update({
    where: { id },
    data: { isActive: false },
    select: userSelect,
  });
}
