import { Prisma } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";

export interface BranchInput {
  name: string;
  code: string;
  phone?: string;
  address?: string;
  isActive?: boolean;
}

export async function listBranches(query: { search?: string; isActive?: boolean }) {
  const where: Prisma.BranchWhereInput = {
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" } },
            { code: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
  };

  return prisma.branch.findMany({
    where,
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
}

export async function getBranchById(id: string) {
  const branch = await prisma.branch.findUnique({ where: { id } });

  if (!branch) {
    throw new AppError("Branch not found", 404, "BRANCH_NOT_FOUND");
  }

  return branch;
}

export async function createBranch(input: BranchInput, createdBy?: string) {
  return prisma.branch.create({
    data: {
      name: input.name,
      code: input.code,
      phone: input.phone,
      address: input.address,
      isActive: input.isActive ?? true,
      createdBy,
    },
  });
}

export async function updateBranch(id: string, input: Partial<BranchInput>) {
  await getBranchById(id);

  return prisma.branch.update({
    where: { id },
    data: input,
  });
}
