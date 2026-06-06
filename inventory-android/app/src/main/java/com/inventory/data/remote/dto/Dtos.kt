package com.inventory.data.remote.dto

import java.math.BigDecimal
import java.math.RoundingMode

// ── Voice Invoice DTOs ────────────────────────────────────────────────────────

data class VoiceCommandRequest(val command: String)

data class VoiceInvoiceBasic(
    val id: String,
    val invoiceNumber: String,
    val customerName: String,
    val productName: String,
    val quantity: Int,
    val unit: String,
    val totalAmount: Double,
    val paymentType: String,
)

data class VoiceInvoiceResponse(
    val success: Boolean? = null,
    val message: String? = null,
    val clarify: String? = null,
    val invoice: VoiceInvoiceBasic? = null,
)

/**
 * Rounds a monetary Double to 2 decimal places using HALF_UP rounding.
 * Avoids IEEE 754 floating-point drift (e.g. 0.1 + 0.2 = 0.30000000000000004).
 * Usage: (quantity * unitPrice).roundMoney()
 */
internal fun Double.roundMoney(): Double =
    BigDecimal(this.toString()).setScale(2, RoundingMode.HALF_UP).toDouble()

data class ApiEnvelope<T>(
    val success: Boolean,
    val message: String? = null,
    val data: T? = null,
    val token: String? = null,
    val user: UserDto? = null,
    val code: String? = null
)

data class UserDto(
    val id: String,
    val name: String,
    val username: String,
    val role: String,
    val permissions: List<String>? = null,
    val isActive: Boolean,
    val createdAt: String? = null,
    val updatedAt: String? = null
)

data class LoginRequest(
    val username: String,
    val password: String
)

data class CreateUserRequest(
    val name: String,
    val username: String,
    val password: String,
    val role: String,
    val permissions: List<String> = emptyList(),
    val isActive: Boolean = true
)

data class UpdateUserRequest(
    val name: String? = null,
    val username: String? = null,
    val password: String? = null,
    val role: String? = null,
    val permissions: List<String>? = null,
    val isActive: Boolean? = null
)

data class ApprovalDto(
    val id: String,
    val requestType: String,
    val requestData: Map<String, Any?>?,
    val requestedBy: String,
    val status: String,
    val reviewedBy: String? = null,
    val reviewedAt: String? = null,
    val createdAt: String? = null,
    val requester: UserDto? = null
)

data class ReviewApprovalRequest(
    val status: String,
    val allowPrices: Boolean? = null,
    val showStock: Boolean? = null
)

data class PagedEnvelope<T>(
    val success: Boolean,
    val message: String? = null,
    val data: List<T> = emptyList(),
    val pagination: PaginationDto? = null
)

data class ProductDto(
    val id: String,
    val itemNumber: String,
    val name: String,
    val qrCode: String? = null,
    val cartonQrCode: String? = null,
    val imageUrl: String? = null,
    val category: String? = null,
    val openingBalancePcs: Int = 0,
    val cartonsAvailable: Int = 0,
    val pcsPerCarton: Int = 1,
    val purchasePrice: Double = 0.0,
    val salePrice: Double = 0.0,
    val minStock: Int = 0,
    val currentStock: Int? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null
)

// Only `name` is required. Server auto-generates itemNumber / qrCode / cartonQrCode if blank.
data class UpsertProductRequest(
    val name: String,
    val itemNumber: String? = null,
    val qrCode: String? = null,
    val cartonQrCode: String? = null,
    val imageUrl: String? = null,
    val category: String? = null,
    val openingBalancePcs: Int = 0,
    val cartonsAvailable: Int = 0,
    val pcsPerCarton: Int = 1,
    val purchasePrice: Double = 0.0,
    val salePrice: Double = 0.0,
    val minStock: Int = 0,
    val branchId: String? = null,    // optional — null = main branch
)

data class BranchDto(
    val id: String,
    val name: String,
    val code: String,
    val phone: String? = null,
    val address: String? = null,
    val isActive: Boolean = true
)

data class ProductMovementDto(
    val date: String,
    val customerName: String? = null,
    val unit: String? = null,
    val quantity: Int,
    val unitPrice: Double = 0.0,
    val totalPrice: Double = 0.0,
    val invoiceNumber: String,
    val invoiceId: String? = null
)

data class ProductMovementResponse(
    val product: ProductDto? = null,
    val rows: List<ProductMovementDto> = emptyList(),
    val totals: ProductMovementTotalsDto = ProductMovementTotalsDto()
)

data class ProductMovementTotalsDto(
    val quantitySold: Int = 0,
    val totalRevenue: Double = 0.0
)

data class CustomerDto(
    val id: String,
    val name: String,
    val phone: String,
    val address: String? = null,
    val notes: String? = null,
    val openingBalance: Double = 0.0,
    val currentBalance: Double = 0.0,
    val isSupplier: Boolean = false,
    val lastTransactionAt: String? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null
)

data class UpsertCustomerRequest(
    val name: String,
    val phone: String,
    val address: String? = null,
    val notes: String? = null,
    val openingBalance: Double = 0.0,
    val isSupplier: Boolean = false
)

data class CustomerTransactionDto(
    val id: String,
    val date: String,
    val type: String,
    val amount: Double,
    val referenceNumber: String,
    val debit: Double? = null,
    val credit: Double? = null,
    val runningBalance: Double,
    val status: String? = null
)

data class CustomerTransactionsEnvelope(
    val customer: CustomerTransactionCustomerDto? = null,
    val transactions: List<CustomerTransactionDto> = emptyList()
)

data class CustomerTransactionCustomerDto(
    val id: String,
    val name: String,
    val openingBalance: Double = 0.0
)

data class LastTransactionDto(
    val id: String? = null,
    val date: String? = null,
    val type: String? = null,
    val amount: Double? = null,
    val referenceNumber: String? = null
)

data class CustomerBalanceDto(
    val customerId: String? = null,
    val openingBalance: Double = 0.0,
    val currentBalance: Double = 0.0,
    val previousBalance: Double? = null,
    val lastTransactionAt: String? = null
)

data class CreateVoucherRequest(
    val customerId: String?,       // null for EXPENSE vouchers
    val amount: Double,
    val type: String,
    val date: String,
    val notes: String? = null,
    val description: String? = null // required for EXPENSE vouchers
)

data class VoucherDto(
    val id: String,
    val voucherNumber: String,
    val customerId: String? = null,
    val customer: CustomerDto? = null,
    val amount: Double = 0.0,
    val type: String,
    val date: String,
    val notes: String? = null,
    val description: String? = null,
    val createdAt: String? = null
)

data class InvoiceDto(
    val id: String,
    val invoiceNumber: String,
    val customerId: String,
    val customer: CustomerDto? = null,
    val date: String,
    val type: String = "SALE",
    val subtotal: Double = 0.0,
    val discount: Double = 0.0,
    val tax: Double = 0.0,
    val totalAmount: Double = 0.0,
    val paidAmount: Double = 0.0,
    val remainingAmount: Double = 0.0,
    val previousBalance: Double = 0.0,
    val finalBalance: Double = 0.0,
    val paymentType: String = "CREDIT",
    val status: String = "ACTIVE",
    val items: List<InvoiceItemDto> = emptyList(),
    val createdAt: String? = null
)

data class InvoiceItemDto(
    val id: String? = null,
    val invoiceId: String? = null,
    val productId: String,
    val productName: String? = null,
    val unit: String,
    val quantity: Int,
    val unitPrice: Double,
    val totalPrice: Double = (quantity * unitPrice).roundMoney()
)

data class CreateInvoiceRequest(
    val customerId: String,
    val date: String,
    val type: String = "SALE",
    val clientRequestId: String = java.util.UUID.randomUUID().toString(),
    val discount: Double,
    val tax: Double,
    val paidAmount: Double,
    val paymentType: String,
    val items: List<CreateInvoiceItemRequest>
)

data class CreateInvoiceItemRequest(
    val productId: String,
    val unit: String,
    val quantity: Int,
    val unitPrice: Double
)

data class PaginationEnvelope<T>(
    val success: Boolean,
    val data: List<T> = emptyList(),
    val pagination: PaginationDto? = null,
    val message: String? = null
)

data class PaginationDto(
    val total: Int,
    val page: Int,
    val limit: Int,
    val pages: Int
)

data class DashboardReportDto(
    val todaySales: Double = 0.0,
    val todayInvoices: Int = 0,
    val totalDebts: Double = 0.0,
    val lowStockProducts: Int = 0,
    val topProductsThisMonth: List<TopProductDto> = emptyList(),
    val lastSevenDaysSales: List<SalesPointDto> = emptyList()
)

data class TopProductDto(
    val productId: String,
    val productName: String,
    val quantitySold: Int = 0,
    val totalSales: Double = 0.0
)

data class SalesPointDto(
    val date: String? = null,
    val period: String? = null,
    val totalSales: Double = 0.0,
    val netProfit: Double = 0.0
)

data class SalesReportDto(
    val totalSales: Double = 0.0,
    val invoiceCount: Int = 0,
    val netProfit: Double = 0.0,
    val chart: List<SalesPointDto> = emptyList()
)

data class InventoryValuationDto(
    val products: List<InventoryProductDto> = emptyList(),
    val totals: InventoryTotalsDto = InventoryTotalsDto()
)

data class InventoryProductDto(
    val id: String,
    val itemNumber: String,
    val name: String,
    val category: String,
    val currentStock: Int,
    val purchasePrice: Double,
    val salePrice: Double,
    val purchaseValue: Double,
    val saleValue: Double
)

data class InventoryTotalsDto(
    val currentStock: Int = 0,
    val purchaseValue: Double = 0.0,
    val saleValue: Double = 0.0
)

data class CustomerDebtDto(
    val id: String,
    val name: String,
    val phone: String,
    val currentBalance: Double,
    val lastTransactionAt: String? = null,
    val debtAgeDays: Int = 0
)

// ── Catalog Management DTOs ───────────────────────────────────────────────────

data class CatalogCustomerDto(
    val id: String,
    val name: String,
    val phone: String,
    val hasAccess: Boolean,
    val allowPrices: Boolean,
    val showStock: Boolean,
    val token: String? = null,
    val lastViewedAt: String? = null,
    val createdAt: String? = null
)

data class GrantCatalogAccessRequest(
    val allowPrices: Boolean,
    val showStock: Boolean
)

data class PatchCatalogAccessRequest(
    val allowPrices: Boolean? = null,
    val showStock: Boolean? = null
)

data class OrderPreparationItemDto(
    val productId: String,
    val productName: String,
    val unit: String,
    val quantity: Int,
    val unitPrice: Double? = null,
    val totalPrice: Double? = null
)

data class OrderPreparationDto(
    val id: String,
    val invoiceId: String,
    val invoiceNumber: String,
    val totalAmount: Double,
    val customerName: String,
    val customerPhone: String,
    val items: List<OrderPreparationItemDto>,
    val createdAt: String
)
