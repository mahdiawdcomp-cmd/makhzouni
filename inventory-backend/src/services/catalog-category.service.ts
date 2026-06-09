import prisma from "../config/database";

export async function listCatalogCategories() {
  return prisma.catalogCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

export async function upsertCatalogCategory(name: string, types: string[], sortOrder?: number) {
  return prisma.catalogCategory.upsert({
    where: { name },
    create: { name, types, sortOrder: sortOrder ?? 0 },
    update: { types, ...(sortOrder !== undefined ? { sortOrder } : {}) },
  });
}

export async function deleteCatalogCategory(id: string) {
  return prisma.catalogCategory.delete({ where: { id } });
}
