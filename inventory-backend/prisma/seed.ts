import "dotenv/config";
import bcrypt from "bcrypt";
import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS ?? 10);
  const passwordHash = await bcrypt.hash("Password123!", saltRounds);

  await prisma.stockMovement.deleteMany();
  await prisma.invoiceItem.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.paymentVoucher.deleteMany();
  await prisma.pendingApproval.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.product.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.user.deleteMany();

  const users = await prisma.user.createManyAndReturn({
    data: [
      {
        name: "System Admin",
        username: "admin",
        passwordHash,
        role: UserRole.ADMIN,
      },
      {
        name: "Warehouse Staff",
        username: "warehouse",
        passwordHash,
        role: UserRole.STAFF,
      },
      {
        name: "Sales Staff",
        username: "sales",
        passwordHash,
        role: UserRole.STAFF,
      },
    ],
  });

  const admin = users.find((user) => user.username === "admin") ?? users[0];

  await prisma.product.createMany({
    data: [
      {
        itemNumber: "ITM-001",
        name: "Premium Rice 25kg",
        qrCode: "QR-ITM-001",
        category: "Food",
        openingBalancePcs: 20,
        cartonsAvailable: 30,
        pcsPerCarton: 1,
        purchasePrice: "28000.00",
        salePrice: "32500.00",
        minStock: 10,
        createdBy: admin.id,
      },
      {
        itemNumber: "ITM-002",
        name: "Cooking Oil 1L",
        qrCode: "QR-ITM-002",
        category: "Food",
        openingBalancePcs: 48,
        cartonsAvailable: 20,
        pcsPerCarton: 12,
        purchasePrice: "1500.00",
        salePrice: "2000.00",
        minStock: 60,
        createdBy: admin.id,
      },
      {
        itemNumber: "ITM-003",
        name: "Tomato Paste 800g",
        qrCode: "QR-ITM-003",
        category: "Food",
        openingBalancePcs: 24,
        cartonsAvailable: 18,
        pcsPerCarton: 24,
        purchasePrice: "900.00",
        salePrice: "1250.00",
        minStock: 80,
        createdBy: admin.id,
      },
      {
        itemNumber: "ITM-004",
        name: "Black Tea 500g",
        qrCode: "QR-ITM-004",
        category: "Beverages",
        openingBalancePcs: 12,
        cartonsAvailable: 15,
        pcsPerCarton: 20,
        purchasePrice: "3500.00",
        salePrice: "4500.00",
        minStock: 50,
        createdBy: admin.id,
      },
      {
        itemNumber: "ITM-005",
        name: "Sugar 1kg",
        qrCode: "QR-ITM-005",
        category: "Food",
        openingBalancePcs: 30,
        cartonsAvailable: 25,
        pcsPerCarton: 10,
        purchasePrice: "950.00",
        salePrice: "1300.00",
        minStock: 70,
        createdBy: admin.id,
      },
      {
        itemNumber: "ITM-006",
        name: "Laundry Detergent 2kg",
        qrCode: "QR-ITM-006",
        category: "Cleaning",
        openingBalancePcs: 10,
        cartonsAvailable: 12,
        pcsPerCarton: 8,
        purchasePrice: "4200.00",
        salePrice: "5500.00",
        minStock: 24,
        createdBy: admin.id,
      },
      {
        itemNumber: "ITM-007",
        name: "Dish Soap 750ml",
        qrCode: "QR-ITM-007",
        category: "Cleaning",
        openingBalancePcs: 16,
        cartonsAvailable: 14,
        pcsPerCarton: 12,
        purchasePrice: "1100.00",
        salePrice: "1600.00",
        minStock: 36,
        createdBy: admin.id,
      },
      {
        itemNumber: "ITM-008",
        name: "Bottled Water 500ml",
        qrCode: "QR-ITM-008",
        category: "Beverages",
        openingBalancePcs: 60,
        cartonsAvailable: 40,
        pcsPerCarton: 24,
        purchasePrice: "180.00",
        salePrice: "250.00",
        minStock: 200,
        createdBy: admin.id,
      },
      {
        itemNumber: "ITM-009",
        name: "Soft Drink 330ml",
        qrCode: "QR-ITM-009",
        category: "Beverages",
        openingBalancePcs: 48,
        cartonsAvailable: 35,
        pcsPerCarton: 24,
        purchasePrice: "450.00",
        salePrice: "650.00",
        minStock: 150,
        createdBy: admin.id,
      },
      {
        itemNumber: "ITM-010",
        name: "Paper Towels 6 Rolls",
        qrCode: "QR-ITM-010",
        category: "Household",
        openingBalancePcs: 8,
        cartonsAvailable: 16,
        pcsPerCarton: 6,
        purchasePrice: "3000.00",
        salePrice: "4200.00",
        minStock: 25,
        createdBy: admin.id,
      },
    ],
  });

  await prisma.customer.createMany({
    data: [
      {
        name: "Al Noor Market",
        phone: "07700000001",
        address: "Baghdad - Karrada",
        notes: "Wholesale customer",
        openingBalance: "250000.00",
        currentBalance: "250000.00",
      },
      {
        name: "Dijlah Stores",
        phone: "07700000002",
        address: "Baghdad - Mansour",
        openingBalance: "0.00",
        currentBalance: "0.00",
      },
      {
        name: "Basra Retail Co.",
        phone: "07700000003",
        address: "Basra - Ashar",
        notes: "Prefers monthly statements",
        openingBalance: "125000.00",
        currentBalance: "125000.00",
      },
      {
        name: "Mosul Family Shop",
        phone: "07700000004",
        address: "Mosul - Al Majmoua",
        openingBalance: "50000.00",
        currentBalance: "50000.00",
      },
      {
        name: "Erbil Mini Market",
        phone: "07700000005",
        address: "Erbil - Ankawa",
        openingBalance: "0.00",
        currentBalance: "0.00",
      },
    ],
  });
}

main()
  .then(async () => {
    console.log("Seed data created successfully.");
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
