package com.inventory.domain.model

data class User(
    val id: String,
    val name: String,
    val username: String,
    val role: String,
    val permissions: List<String> = emptyList(),
    val isActive: Boolean
)

data class Approval(
    val id: String,
    val requestType: String,
    val requesterName: String,
    val createdAt: String?,
    val customerName: String? = null,
    val phone: String? = null,
    val address: String? = null,
    val notes: String? = null,
    val subtotal: Double? = null,
    val itemCount: Int = 0,
    val displayItems: List<ApprovalDisplayItem> = emptyList()
)

data class ApprovalDisplayItem(
    val productName: String,
    val unit: String,
    val quantity: Int,
    val unitPrice: Double? = null,
    val totalPrice: Double? = null
)

enum class UserRole {
    ADMIN,
    STAFF
}

data class WarehouseStock(
    val warehouseId: String,
    val warehouseName: String,
    val warehouseCode: String,
    val quantityPieces: Int,
    val storageLocation: String? = null,
    val minStock: Int? = null
)

data class Product(
    val id: String,
    val itemNumber: String,
    val name: String,
    val qrCode: String,
    val cartonQrCode: String = "",
    val imageUrl: String? = null,
    val category: String,
    val openingBalancePcs: Int,
    val cartonsAvailable: Int,
    val pcsPerCarton: Int,
    val purchasePrice: Double,
    val salePrice: Double,
    val retailPrice: Double = 0.0,
    val minStock: Int,
    val warehouseStocks: List<WarehouseStock> = emptyList(),
    val updatedAt: String?
) {
    val currentStock: Int = openingBalancePcs + cartonsAvailable * pcsPerCarton
    val isLowStock: Boolean = currentStock <= minStock
}

data class ProductMovement(
    val date: String,
    val customerName: String,
    val quantity: Int,
    val unitPrice: Double,
    val unit: String?,
    val invoiceNumber: String,
    val invoiceId: String
)

data class Customer(
    val id: String,
    val name: String,
    val phone: String,
    val address: String?,
    val notes: String?,
    val openingBalance: Double,
    val currentBalance: Double,
    val isSupplier: Boolean,
    val lastTransactionAt: String?,
    val updatedAt: String?
)

data class CustomerTransaction(
    val id: String,
    val date: String,
    val type: String,
    val invoiceType: String? = null,
    val debit: Double,
    val credit: Double,
    val amount: Double,
    val referenceNumber: String,
    val runningBalance: Double,
    val status: String? = null
)

data class LastTransaction(
    val id: String?,
    val date: String?,
    val type: String?,
    val amount: Double?,
    val referenceNumber: String?
)

data class Invoice(
    val id: String,
    val invoiceNumber: String,
    val customerName: String,
    val customerId: String,
    val date: String,
    val type: String = "SALE",
    val subtotal: Double = 0.0,
    val discount: Double = 0.0,
    val tax: Double = 0.0,
    val totalAmount: Double,
    val paidAmount: Double,
    val remainingAmount: Double,
    val previousBalance: Double,
    val finalBalance: Double,
    val paymentType: String,
    val status: String,
    val items: List<InvoiceItem> = emptyList()
)

data class InvoiceItem(
    val productId: String,
    val productName: String,
    val unit: String,
    val quantity: Int,
    val unitPrice: Double,
    val totalPrice: Double
)

data class Voucher(
    val id: String,
    val voucherNumber: String,
    val customerId: String?,
    val customerName: String?,
    val amount: Double,
    val type: String,
    val date: String,
    val notes: String?,
    val description: String?
)

data class DashboardReport(
    val todaySales: Double,
    val todayInvoices: Int,
    val totalDebts: Double,
    val lowStockProducts: Int,
    val topProducts: List<TopProduct>,
    val lastSevenDaysSales: List<SalesPoint>
)

data class TopProduct(
    val productId: String,
    val productName: String,
    val quantitySold: Int,
    val totalSales: Double
)

data class SalesPoint(
    val label: String,
    val totalSales: Double,
    val netProfit: Double = 0.0
)

data class SalesReport(
    val totalSales: Double,
    val netProfit: Double,
    val chart: List<SalesPoint>
)

data class InventoryValuation(
    val products: List<InventoryProduct>,
    val totalPurchaseValue: Double,
    val totalSaleValue: Double
)

data class InventoryProduct(
    val id: String,
    val itemNumber: String,
    val name: String,
    val category: String,
    val currentStock: Int,
    val purchaseValue: Double,
    val saleValue: Double
)

data class CustomerDebt(
    val id: String,
    val name: String,
    val phone: String,
    val currentBalance: Double,
    val lastTransactionAt: String?,
    val debtAgeDays: Int
)
