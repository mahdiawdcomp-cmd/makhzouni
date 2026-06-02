package com.inventory.data.repository

import com.inventory.data.remote.ApiClient
import com.inventory.data.remote.ApiResult
import com.inventory.data.remote.NetworkMonitor
import com.inventory.data.remote.dto.CreateInvoiceItemRequest
import com.inventory.data.remote.dto.CreateInvoiceRequest
import com.inventory.data.remote.dto.InvoiceDto
import com.inventory.data.remote.dto.InvoiceItemDto
import com.inventory.domain.model.Invoice
import com.inventory.domain.model.InvoiceItem
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class InvoiceRepository @Inject constructor(
    private val apiClient: ApiClient,
    private val networkMonitor: NetworkMonitor,
    private val syncRepository: SyncRepository
) {
    suspend fun listInvoices(from: String?, to: String?): ApiResult<List<Invoice>> {
        if (!networkMonitor.isOnline()) return ApiResult.Offline
        return try {
            ApiResult.Success(apiClient.api.getInvoices(from, to).data.map { it.toDomain() })
        } catch (error: Exception) {
            ApiResult.Error(error.message ?: "تعذر تحميل الفواتير")
        }
    }

    suspend fun createInvoice(request: CreateInvoiceRequest): ApiResult<Invoice> {
        if (!networkMonitor.isOnline()) {
            syncRepository.enqueue("CREATE_INVOICE", "POST", "invoices", request)
            return ApiResult.Queued("تم حفظ الفاتورة محلياً، وستُرسل تلقائياً عند رجوع الإنترنت")
        }
        return try {
            val invoice = apiClient.api.createInvoice(request).data
            if (invoice == null) ApiResult.Error("لم يرجع السيرفر الفاتورة") else ApiResult.Success(invoice.toDomain())
        } catch (error: Exception) {
            ApiResult.Error(error.message ?: "تعذر حفظ الفاتورة")
        }
    }

    suspend fun getInvoice(id: String): ApiResult<Invoice> {
        if (!networkMonitor.isOnline()) return ApiResult.Offline
        return try {
            val invoice = apiClient.api.getInvoice(id).data
            if (invoice == null) ApiResult.Error("الفاتورة غير موجودة") else ApiResult.Success(invoice.toDomain())
        } catch (error: Exception) {
            ApiResult.Error(error.message ?: "تعذر تحميل الفاتورة")
        }
    }

    suspend fun exportPdf(id: String) = apiClient.api.invoicePdf(id)
    suspend fun exportImage(id: String) = apiClient.api.invoiceImage(id)
    suspend fun cancelInvoice(id: String): ApiResult<Invoice> = try {
        val invoice = apiClient.api.cancelInvoice(id).data
        if (invoice == null) ApiResult.Error("لم يرجع السيرفر الفاتورة") else ApiResult.Success(invoice.toDomain())
    } catch (error: Exception) {
        ApiResult.Error(error.message ?: "تعذر إلغاء الفاتورة")
    }
}

fun InvoiceDto.toDomain() = Invoice(
    id = id,
    invoiceNumber = invoiceNumber,
    customerName = customer?.name ?: customerId,
    customerId = customerId,
    date = date.take(10),
    totalAmount = totalAmount,
    paidAmount = paidAmount,
    remainingAmount = remainingAmount,
    previousBalance = previousBalance,
    finalBalance = finalBalance,
    paymentType = paymentType,
    status = status,
    items = items.map { it.toDomain() }
)

fun InvoiceItemDto.toDomain() = InvoiceItem(
    productId = productId,
    productName = productName ?: productId,
    unit = unit,
    quantity = quantity,
    unitPrice = unitPrice,
    totalPrice = totalPrice
)

fun List<InvoiceItem>.toCreateItems() = map {
    CreateInvoiceItemRequest(it.productId, it.unit, it.quantity, it.unitPrice)
}
