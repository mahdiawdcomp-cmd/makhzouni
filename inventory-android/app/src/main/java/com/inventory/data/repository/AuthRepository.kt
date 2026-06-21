package com.inventory.data.repository

import android.util.Log
import androidx.room.withTransaction
import com.inventory.data.local.AppDatabase
import com.inventory.data.local.CustomerEntity
import com.inventory.data.local.InvoiceEntity
import com.inventory.data.local.PaymentVoucherEntity
import com.inventory.data.local.ProductEntity
import com.inventory.data.remote.ApiClient
import com.inventory.data.remote.ApiResult
import com.inventory.data.remote.NetworkMonitor
import com.inventory.data.remote.dto.CustomerDto
import com.inventory.data.remote.dto.InvoiceDto
import com.inventory.data.remote.dto.LoginRequest
import com.inventory.data.remote.dto.ProductDto
import com.inventory.data.remote.dto.VoucherDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

private const val TAG = "AuthRepository"

@Singleton
class AuthRepository @Inject constructor(
    private val apiClient: ApiClient,
    private val networkMonitor: NetworkMonitor,
    private val sessionManager: SessionManager,
    private val database: AppDatabase
) {
    // Background scope for fire-and-forget cache syncs — SupervisorJob so one
    // failed sync doesn't cancel pending ones.
    private val syncScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    suspend fun login(username: String, password: String, rememberMe: Boolean): ApiResult<Unit> {
        if (!networkMonitor.isOnline()) return ApiResult.Offline
        return try {
            val response = apiClient.api.login(LoginRequest(username, password))
            val token = response.token
            val user = response.user
            if (response.success && token != null && user != null) {
                sessionManager.saveSession(token, user.role, user.name, rememberMe, user.permissions.orEmpty())
                // Launch in background — login should not wait for the full sync.
                syncScope.launch {
                    runCatching { replaceLocalCacheFromServer() }
                        .onFailure { Log.w(TAG, "Post-login sync failed: ${it.message}") }
                }
                ApiResult.Success(Unit)
            } else {
                ApiResult.Error(response.message ?: "فشل تسجيل الدخول", response.code)
            }
        } catch (error: Exception) {
            ApiResult.Error(error.message ?: "خطأ غير معروف")
        }
    }

    suspend fun hasRememberedSession(): Boolean {
        sessionManager.hydrateCache()
        val hasSession = sessionManager.rememberMe.first() && !sessionManager.currentToken.isNullOrBlank()
        // Return immediately — sync runs in background so the splash screen is instant.
        if (hasSession && networkMonitor.isOnline()) {
            syncScope.launch {
                runCatching { replaceLocalCacheFromServer() }
                    .onFailure { Log.w(TAG, "Startup sync failed: ${it.message}") }
            }
        }
        return hasSession
    }

    suspend fun replaceLocalCacheFromServer() = withContext(Dispatchers.IO) {
        val products  = apiClient.api.getProducts(limit = 5000).data.orEmpty().map { it.toEntity() }
        val customers = apiClient.api.getCustomers(limit = 500).data.orEmpty().map { it.toEntity() }
        val vouchers  = apiClient.api.getVouchers(limit = 1000).data.orEmpty().map { it.toEntity() }
        val invoices  = apiClient.api.getInvoices(limit = 1000).data.orEmpty()

        // invoice_items are NOT synced here — the list endpoint returns invoices without
        // items embedded. Items are fetched lazily when the user opens a specific invoice
        // (InvoiceRepository.loadInvoice). Syncing an empty list here would wipe all
        // locally-cached items on every app start.
        database.withTransaction {
            database.productDao().replaceAll(products)
            database.customerDao().replaceAll(customers)
            database.paymentVoucherDao().replaceAll(vouchers)
            database.invoiceDao().replaceAll(invoices.map { it.toEntity() })
        }
        Log.d(TAG, "Cache sync done — ${products.size} products, ${customers.size} customers, " +
                "${vouchers.size} vouchers, ${invoices.size} invoices")
    }
}

private fun ProductDto.toEntity() = ProductEntity(
    id = id,
    itemNumber = itemNumber,
    name = name,
    qrCode = qrCode.orEmpty(),
    cartonQrCode = cartonQrCode.orEmpty(),
    imageUrl = imageUrl,
    category = category.orEmpty(),
    openingBalancePcs = openingBalancePcs,
    cartonsAvailable = cartonsAvailable,
    pcsPerCarton = pcsPerCarton,
    purchasePrice = purchasePrice,
    salePrice = salePrice,
    retailPrice = retailPrice,
    minStock = minStock,
    shopStock = shopStock,
    updatedAt = updatedAt
)

private fun CustomerDto.toEntity() = CustomerEntity(
    id = id,
    name = name,
    phone = phone,
    address = address,
    notes = notes,
    openingBalance = openingBalance,
    currentBalance = currentBalance,
    isSupplier = isSupplier,
    lastTransactionAt = lastTransactionAt,
    updatedAt = updatedAt,
    deletedAt = null
)

private fun VoucherDto.toEntity() = PaymentVoucherEntity(
    id = id,
    voucherNumber = voucherNumber,
    customerId = customerId,
    amount = amount,
    type = type,
    date = date,
    notes = notes ?: description,
    cancelledAt = cancelledAt,
    createdAt = createdAt
)

private fun InvoiceDto.toEntity() = InvoiceEntity(
    id = id,
    invoiceNumber = invoiceNumber,
    customerId = customerId,
    date = date,
    type = type,
    subtotal = subtotal,
    discount = discount,
    tax = tax,
    totalAmount = totalAmount,
    paidAmount = paidAmount,
    remainingAmount = remainingAmount,
    previousBalance = previousBalance,
    finalBalance = finalBalance,
    paymentType = paymentType,
    status = status,
    createdAt = createdAt
)

