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

// 2-step voice flow
data class VoicePlanDto(
    val operation: String,          // "INVOICE" | "VOUCHER"
    val customerId: String,
    val customerName: String,
    val productId: String?    = null,
    val productName: String?  = null,
    val quantity: Int?        = null,
    val unit: String?         = null,
    val unitPrice: Double?    = null,
    val totalAmount: Double?  = null,
    val paymentType: String?  = null,
    val paidAmount: Double?   = null,
    val amount: Double?       = null,
    val voucherType: String?  = null,
)

data class VoiceParseResponse(
    val type: String,               // "confirm" | "clarify" | "answer"
    val plan: VoicePlanDto?   = null,
    val confirmText: String?  = null,
    val question: String?     = null,
    val text: String?         = null,
)

data class VoiceExecuteRequest(val plan: VoicePlanDto)

data class VoiceVoucherResult(
    val id: String,
    val voucherNumber: String,
    val customerName: String,
    val amount: Double,
    val type: String,
)

data class VoiceExecuteResponse(
    val success: Boolean?         = null,
    val message: String?          = null,
    val invoice: VoiceInvoiceBasic? = null,
    val voucher: VoiceVoucherResult? = null,
)

// ── OCR Invoice DTOs ──────────────────────────────────────────────────────────

data class OcrInvoiceRequest(val imageBase64: String)

data class OcrProductMatch(
    val id: String,
    val name: String,
    val itemNumber: String,
    val purchasePrice: Double,
    val salePrice: Double?   = null,
    val pcsPerCarton: Int,
)

data class OcrItemDto(
    val extractedName: String,
    val quantity: Int,
    val unit: String,          // "PIECE" | "DOZEN" | "CARTON"
    val unitPrice: Double,
    val product: OcrProductMatch?          = null,
    val suggestions: List<OcrProductMatch> = emptyList(),
    val matched: Boolean,
)

data class OcrInvoiceResponse(
    val success: Boolean,
    val message: String,
    val supplierName: String?     = null,
    val invoiceDate: String?      = null,
    val notes: String?            = null,
    val items: List<OcrItemDto>   = emptyList(),
)

data class AgentMessageDto(
    val role: String,
    val content: String
)

data class AgentChatRequest(
    val message: String,
    val history: List<AgentMessageDto>
)

data class AgentChatResponse(
    val success: Boolean? = null,
    val reply: String? = null,
    val history: List<AgentMessageDto>? = null
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

data class WarehouseInfoDto(
    val id: String,
    val name: String,
    val code: String,
    val isActive: Boolean = true
)

data class WarehouseStockDto(
    val id: String? = null,
    val warehouseId: String,
    val warehouse: WarehouseInfoDto,
    val quantityPieces: Int = 0,
    val storageLocation: String? = null,
    val minStock: Int? = null
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
    val retailPrice: Double = 0.0,
    val minStock: Int = 0,
    val currentStock: Int? = null,
    val shopStock: Int? = null,
    val warehouseStocks: List<WarehouseStockDto>? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null
)

data class WarehouseDistributionItem(
    val warehouseId: String,
    val pieces: Int
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
    val retailPrice: Double = 0.0,
    val minStock: Int = 0,
    val branchId: String? = null,
    val warehouseDistribution: List<WarehouseDistributionItem>? = null,
)

data class BranchDto(
    val id: String,
    val name: String,
    val code: String,
    val phone: String? = null,
    val address: String? = null,
    val isActive: Boolean = true,
    val createdAt: String? = null,
    val updatedAt: String? = null
)

data class BranchRequest(
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
    val invoiceType: String? = null,
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
    val warehouseId: String? = null,
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
    val branchId: String? = null,
    val originalInvoiceId: String? = null,
    val couponCode: String? = null,
    val clientRequestId: String = java.util.UUID.randomUUID().toString(),
    val discount: Double,
    val tax: Double,
    val paidAmount: Double,
    val paymentType: String,
    val items: List<CreateInvoiceItemRequest>
)

data class CreateInvoiceItemRequest(
    val productId: String,
    val warehouseId: String? = null,
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

data class QuotationDto(
    val id: String,
    val quotationNumber: String,
    val customerId: String,
    val customer: CustomerDto? = null,
    val status: String = "PENDING",
    val subtotal: Double = 0.0,
    val discount: Double = 0.0,
    val totalAmount: Double = 0.0,
    val expiresAt: String? = null,
    val notes: String? = null,
    val items: List<QuotationItemDto> = emptyList(),
    val createdAt: String? = null
)

data class QuotationItemDto(
    val id: String? = null,
    val productId: String,
    val productName: String? = null,
    val unit: String,
    val quantity: Int,
    val unitPrice: Double,
    val totalPrice: Double = (quantity * unitPrice).roundMoney()
)

data class CreateQuotationRequest(
    val customerId: String,
    val discount: Double = 0.0,
    val expiresAt: String? = null,
    val notes: String? = null,
    val items: List<CreateInvoiceItemRequest>
)

data class UpdateQuotationStatusRequest(val status: String)

data class CouponDto(
    val id: String,
    val code: String,
    val name: String,
    val discountType: String,
    val discountValue: Double = 0.0,
    val startsAt: String? = null,
    val endsAt: String? = null,
    val maxUses: Int? = null,
    val usedCount: Int = 0,
    val isActive: Boolean = true,
    val createdAt: String? = null
)

data class CouponRequest(
    val code: String,
    val name: String,
    val discountType: String,
    val discountValue: Double,
    val startsAt: String? = null,
    val endsAt: String? = null,
    val maxUses: Int? = null,
    val isActive: Boolean = true
)

data class TransferDto(
    val id: String,
    val transferNumber: String,
    val fromBranchId: String,
    val toBranchId: String,
    val fromBranch: BranchNameDto? = null,
    val toBranch: BranchNameDto? = null,
    val creator: UserNameDto? = null,
    val status: String = "COMPLETED",
    val notes: String? = null,
    val items: List<TransferItemDto> = emptyList(),
    val createdAt: String? = null
)

data class BranchNameDto(val name: String? = null)
data class UserNameDto(val name: String? = null, val username: String? = null)

data class TransferItemDto(
    val id: String? = null,
    val productId: String,
    val product: TransferProductDto? = null,
    val quantity: Int,
    val unit: String
)

data class TransferProductDto(
    val name: String? = null,
    val itemNumber: String? = null,
    val pcsPerCarton: Int = 1
)

data class CreateTransferRequest(
    val fromBranchId: String,
    val toBranchId: String,
    val notes: String? = null,
    val items: List<CreateTransferItemRequest>
)

data class CreateTransferItemRequest(
    val productId: String,
    val quantity: Int,
    val unit: String
)

data class AuditLogDto(
    val id: String,
    val action: String,
    val entity: String,
    val recordId: String? = null,
    val user: UserDto? = null,
    val before: Map<String, Any?>? = null,
    val after: Map<String, Any?>? = null,
    val metadata: Map<String, Any?>? = null,
    val createdAt: String? = null
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

// A/B/C customer rating from /reports/customers/ratings
data class CustomerRatingDto(
    val id: String,
    val name: String,
    val phone: String,
    val currentBalance: Double = 0.0,
    val totalPurchases: Double = 0.0,
    val invoiceCount: Int = 0,
    val avgPaymentDays: Double = 0.0,
    val rating: String,         // "A" | "B" | "C"
    val ratingLabel: String = ""
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

// ── Retail catalog orders (كتلوك المفرد) ────────────────────────────────────────
data class RetailOrderItemDto(
    val title: String,
    val productName: String? = null,
    val quantity: Int,
    val unitPrice: Double,
    val totalPrice: Double? = null
)

data class RetailOrderDto(
    val id: String,
    val orderNumber: String,
    val customerName: String,
    val phone: String,
    val address: String? = null,
    val notes: String? = null,
    val items: List<RetailOrderItemDto> = emptyList(),
    val subtotal: Double,
    val discount: Double,
    val total: Double,
    val couponCode: String? = null,
    val status: String,
    val createdAt: String
)

// ── License ───────────────────────────────────────────────────────────────────
data class LicenseStatusDto(
    val status: String,          // valid | expiring | expired | missing | invalid
    val clientName: String? = null,
    val expiresAt: String? = null,
    val daysLeft: Int? = null,
    val readOnlyMode: Boolean = false
)
