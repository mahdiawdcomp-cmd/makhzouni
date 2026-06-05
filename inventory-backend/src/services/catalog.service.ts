import { Unit } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { approvalRequestTypes, createPendingApproval } from "./approval.service";

type CatalogOrderInput = {
  customerName: string;
  phone: string;
  address?: string;
  notes?: string;
  items: Array<{
    productId: string;
    unit: Unit;
    quantity: number;
  }>;
};

function toNumber(value: unknown) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function stockOf(product: { openingBalancePcs: number; cartonsAvailable: number; pcsPerCarton: number }) {
  return product.openingBalancePcs + product.cartonsAvailable * product.pcsPerCarton;
}

function piecesFor(unit: Unit, quantity: number, pcsPerCarton: number) {
  if (unit === Unit.CARTON) return quantity * pcsPerCarton;
  if (unit === Unit.DOZEN) return quantity * 12;
  return quantity;
}

function salePriceFor(unit: Unit, salePrice: unknown, pcsPerCarton: number) {
  const price = toNumber(salePrice);
  if (unit === Unit.CARTON) return price * pcsPerCarton;
  if (unit === Unit.DOZEN) return price * 12;
  return price;
}

export async function listCatalogProducts() {
  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  return products
    .map((product) => ({
      id: product.id,
      itemNumber: product.itemNumber,
      name: product.name,
      imageUrl: product.imageUrl,
      category: product.category,
      salePrice: toNumber(product.salePrice),
      pcsPerCarton: product.pcsPerCarton,
      currentStock: stockOf(product),
    }))
    .filter((product) => product.currentStock > 0);
}

export async function submitCatalogOrder(input: CatalogOrderInput) {
  const uniqueProductIds = [...new Set(input.items.map((item) => item.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: uniqueProductIds }, deletedAt: null },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  const normalizedItems = input.items.map((item) => {
    const product = productById.get(item.productId);
    if (!product) {
      throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
    }

    const available = stockOf(product);
    const requestedPieces = piecesFor(item.unit, item.quantity, product.pcsPerCarton);
    if (available <= 0 || requestedPieces > available) {
      throw new AppError("Product stock is not enough", 400, "CATALOG_STOCK_NOT_ENOUGH");
    }

    const unitPrice = salePriceFor(item.unit, product.salePrice, product.pcsPerCarton);
    return {
      productId: product.id,
      productName: product.name,
      unit: item.unit,
      quantity: item.quantity,
      unitPrice,
      totalPrice: unitPrice * item.quantity,
      availableStock: available,
    };
  });

  const requester = await prisma.user.findFirst({
    where: { isActive: true },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });

  if (!requester) {
    throw new AppError("No active user exists to own catalog approvals", 500, "NO_APPROVAL_REQUESTER");
  }

  const approval = await createPendingApproval(
    approvalRequestTypes.CATALOG_ORDER,
    {
      source: "PUBLIC_CATALOG",
      customerName: input.customerName,
      phone: input.phone,
      address: input.address,
      notes: input.notes,
      subtotal: normalizedItems.reduce((sum, item) => sum + item.totalPrice, 0),
      body: {
        customerName: input.customerName,
        phone: input.phone,
        address: input.address,
        notes: input.notes,
        items: normalizedItems.map((item) => ({
          productId: item.productId,
          unit: item.unit,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      },
      displayItems: normalizedItems,
    },
    requester.id
  );

  return { approvalId: approval.id };
}
