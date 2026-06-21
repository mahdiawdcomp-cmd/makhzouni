package com.inventory.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "users")
data class UserEntity(
    @PrimaryKey val id: String,
    val name: String,
    val username: String,
    val role: String,
    val permissions: String = "",
    val isActive: Boolean,
    val updatedAt: String?
)

@Entity(tableName = "products")
data class ProductEntity(
    @PrimaryKey val id: String,
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
    val shopStock: Int? = null,
    val updatedAt: String?
)

@Entity(tableName = "customers")
data class CustomerEntity(
    @PrimaryKey val id: String,
    val name: String,
    val phone: String,
    val address: String?,
    val notes: String?,
    val openingBalance: Double,
    val currentBalance: Double,
    val isSupplier: Boolean,
    val lastTransactionAt: String?,
    val updatedAt: String?,
    val deletedAt: String?
)

@Entity(tableName = "invoices")
data class InvoiceEntity(
    @PrimaryKey val id: String,
    val invoiceNumber: String,
    val customerId: String,
    val date: String,
    val type: String,
    val subtotal: Double,
    val discount: Double,
    val tax: Double,
    val totalAmount: Double,
    val paidAmount: Double,
    val remainingAmount: Double,
    val previousBalance: Double,
    val finalBalance: Double,
    val paymentType: String,
    val status: String,
    val createdAt: String?,
    val notes: String? = null
)

@Entity(tableName = "invoice_items")
data class InvoiceItemEntity(
    @PrimaryKey val id: String,
    val invoiceId: String,
    val productId: String,
    val productName: String,
    val unit: String,
    val quantity: Int,
    val unitPrice: Double,
    val totalPrice: Double,
    val notes: String? = null
)

@Entity(tableName = "payment_vouchers")
data class PaymentVoucherEntity(
    @PrimaryKey val id: String,
    val voucherNumber: String,
    val customerId: String?,
    val amount: Double,
    val type: String,
    val date: String,
    val notes: String?,
    val cancelledAt: String? = null,
    val createdAt: String?
)

@Entity(tableName = "pending_approvals")
data class PendingApprovalEntity(
    @PrimaryKey val id: String,
    val requestType: String,
    val requestData: String,
    val requestedBy: String,
    val status: String,
    val reviewedBy: String?,
    val reviewedAt: String?,
    val createdAt: String?
)

@Entity(tableName = "notifications")
data class NotificationEntity(
    @PrimaryKey val id: String,
    val customerId: String?,
    val type: String,
    val message: String,
    val sentAt: String?,
    val isRead: Boolean,
    val createdAt: String?
)

@Entity(tableName = "stock_movements")
data class StockMovementEntity(
    @PrimaryKey val id: String,
    val productId: String,
    val invoiceId: String?,
    val type: String,
    val quantity: Int,
    val balanceBefore: Int,
    val balanceAfter: Int,
    val createdAt: String?
)

@Entity(tableName = "message_templates")
data class MessageTemplateEntity(
    @PrimaryKey val id: String,
    val name: String,
    val body: String,
    val type: String,
    val isActive: Boolean,
    val updatedAt: String?
)

@Entity(tableName = "settings")
data class SettingEntity(
    @PrimaryKey val key: String,
    val valueJson: String,
    val updatedAt: String?
)

@Entity(tableName = "pending_sync_operations")
data class PendingSyncOperationEntity(
    @PrimaryKey val id: String,
    val operationType: String,
    val method: String,
    val path: String,
    val payloadJson: String,
    val status: String,
    val attempts: Int,
    val lastError: String?,
    val createdAt: String,
    val updatedAt: String
)
