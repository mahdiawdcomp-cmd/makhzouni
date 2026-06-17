package com.inventory.data.repository

import com.inventory.data.local.CustomerDao
import com.inventory.data.local.InvoiceDao
import com.inventory.data.local.InvoiceEntity
import com.inventory.data.local.InvoiceItemDao
import com.inventory.data.local.InvoiceItemEntity
import com.inventory.data.local.ProductDao
import com.inventory.data.remote.ApiClient
import com.inventory.data.remote.ApiResult
import com.inventory.data.remote.NetworkMonitor
import com.inventory.data.remote.dto.CreateInvoiceItemRequest
import com.inventory.data.remote.dto.CreateInvoiceRequest
import com.inventory.data.remote.dto.InvoiceDto
import com.inventory.data.remote.dto.InvoiceItemDto
import com.inventory.data.remote.dto.roundMoney
import com.inventory.domain.finance.FinancialInvoiceType
import com.inventory.domain.finance.calculateInvoiceFinancials
import com.inventory.domain.model.Invoice
import com.inventory.domain.model.InvoiceItem
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.time.Instant
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class InvoiceRepository @Inject constructor(
    private val apiClient: ApiClient,
    private val networkMonitor: NetworkMonitor,
    private val syncRepository: SyncRepository,
    private val invoiceDao: InvoiceDao,
    private val invoiceItemDao: InvoiceItemDao,
    private val customerDao: CustomerDao,
    private val productDao: ProductDao
) {
    val invoices: Flow<List<Invoice>> = invoiceDao.observeInvoices().map { rows ->
        rows.map { entity ->
            entity.toDomain(
                items = invoiceItemDao.getForInvoice(entity.id).map { it.toDomain() },
                customerName = customerDao.getById(entity.customerId)?.name
            )
        }
    }

    suspend fun listInvoices(from: String?, to: String?): ApiResult<List<Invoice>> {
        if (!networkMonitor.isOnline()) {
            val local = localInvoices(from, to)
            return if (local.isNotEmpty()) ApiResult.Success(local) else ApiResult.Offline
        }

        return try {
            val remote = apiClient.api.getInvoices(from, to).data
            cacheInvoices(remote)
            ApiResult.Success(remote.map { it.toDomain() })
        } catch (error: Exception) {
            val local = localInvoices(from, to)
            if (local.isNotEmpty()) {
                ApiResult.Success(local)
            } else {
                ApiResult.Error(error.message ?: "تعذر تحميل الفواتير")
            }
        }
    }

    suspend fun createInvoice(request: CreateInvoiceRequest): ApiResult<Invoice> {
        if (!networkMonitor.isOnline()) {
            syncRepository.enqueue("CREATE_INVOICE", "POST", "invoices", request)
            val pendingInvoice = savePendingInvoice(request)
            return ApiResult.Queued("تم حفظ الفاتورة محلياً، وستُرسل تلقائياً عند رجوع الإنترنت")
        }

        return try {
            val invoice = apiClient.api.createInvoice(request).data
            if (invoice == null) {
                ApiResult.Error("لم يرجع السيرفر الفاتورة")
            } else {
                cacheInvoices(listOf(invoice))
                ApiResult.Success(invoice.toDomain())
            }
        } catch (error: Exception) {
            ApiResult.Error(error.message ?: "تعذر حفظ الفاتورة")
        }
    }

    suspend fun updateInvoice(id: String, request: CreateInvoiceRequest): ApiResult<Invoice> {
        if (!networkMonitor.isOnline()) return ApiResult.Offline
        return try {
            val invoice = apiClient.api.updateInvoice(id, request).data
            if (invoice == null) {
                ApiResult.Error("لم يرجع السيرفر الفاتورة")
            } else {
                cacheInvoices(listOf(invoice))
                ApiResult.Success(invoice.toDomain())
            }
        } catch (error: Exception) {
            ApiResult.Error(error.message ?: "تعذر تعديل الفاتورة")
        }
    }

    suspend fun getInvoice(id: String): ApiResult<Invoice> {
        if (!networkMonitor.isOnline()) {
            return localInvoice(id)?.let { ApiResult.Success(it) } ?: ApiResult.Offline
        }

        return try {
            val invoice = apiClient.api.getInvoice(id).data
            if (invoice == null) {
                localInvoice(id)?.let { ApiResult.Success(it) } ?: ApiResult.Error("الفاتورة غير موجودة")
            } else {
                cacheInvoices(listOf(invoice))
                ApiResult.Success(invoice.toDomain())
            }
        } catch (error: Exception) {
            localInvoice(id)?.let { ApiResult.Success(it) }
                ?: ApiResult.Error(error.message ?: "تعذر تحميل الفاتورة")
        }
    }

    suspend fun exportPdf(id: String) = apiClient.api.invoicePdf(id)
    suspend fun exportImage(id: String) = apiClient.api.invoiceImage(id)

    suspend fun cancelInvoice(id: String): ApiResult<Invoice> = try {
        val invoice = apiClient.api.cancelInvoice(id).data
        if (invoice == null) {
            ApiResult.Error("لم يرجع السيرفر الفاتورة")
        } else {
            cacheInvoices(listOf(invoice))
            ApiResult.Success(invoice.toDomain())
        }
    } catch (error: Exception) {
        ApiResult.Error(error.message ?: "تعذر إلغاء الفاتورة")
    }

    private suspend fun cacheInvoices(invoices: List<InvoiceDto>) {
        invoiceDao.upsertAll(invoices.map { it.toEntity() })
        invoices.forEach { invoice ->
            invoiceItemDao.deleteForInvoice(invoice.id)
            invoiceItemDao.upsertAll(invoice.items.map { it.toEntity(invoice.id) })
        }
    }

    private suspend fun localInvoice(id: String): Invoice? {
        val entity = invoiceDao.getById(id) ?: return null
        return entity.toDomain(
            items = invoiceItemDao.getForInvoice(id).map { it.toDomain() },
            customerName = customerDao.getById(entity.customerId)?.name
        )
    }

    private suspend fun localInvoices(from: String?, to: String?): List<Invoice> {
        return invoiceDao.listInvoices()
            .filter { entity ->
                val date = entity.date.take(10)
                (from.isNullOrBlank() || date >= from) && (to.isNullOrBlank() || date <= to)
            }
            .map { entity -> entity.toDomain(invoiceItemDao.getForInvoice(entity.id).map { it.toDomain() }) }
            .map { invoice ->
                invoice.copy(customerName = customerDao.getById(invoice.customerId)?.name ?: invoice.customerName)
            }
    }

    private suspend fun savePendingInvoice(request: CreateInvoiceRequest): Invoice {
        val id = "local-${UUID.randomUUID()}"
        val now = Instant.now().toString()
        val customer = customerDao.getById(request.customerId)
        val itemEntities = request.items.map { item ->
            val product = productDao.getById(item.productId)
            InvoiceItemEntity(
                id = UUID.randomUUID().toString(),
                invoiceId = id,
                productId = item.productId,
                productName = product?.name ?: item.productId,
                unit = item.unit,
                quantity = item.quantity,
                unitPrice = item.unitPrice,
                totalPrice = (item.quantity * item.unitPrice).roundMoney()
            )
        }
        val subtotal = itemEntities.sumOf { it.totalPrice }.roundMoney()
        val previousBalance = customer?.currentBalance ?: 0.0
        val financials = calculateInvoiceFinancials(
            type = FinancialInvoiceType.valueOf(request.type),
            subtotal = subtotal,
            discount = request.discount,
            tax = request.tax,
            requestedPaid = request.paidAmount,
            previousBalance = previousBalance,
        )
        val entity = InvoiceEntity(
            id = id,
            invoiceNumber = "محلي-${id.takeLast(6)}",
            customerId = request.customerId,
            date = request.date,
            type = request.type,
            subtotal = subtotal,
            discount = request.discount,
            tax = request.tax,
            totalAmount = financials.totalAmount,
            paidAmount = financials.paidAmount,
            remainingAmount = financials.remainingAmount,
            previousBalance = previousBalance,
            finalBalance = financials.finalBalance,
            paymentType = financials.paymentType,
            status = "PENDING_SYNC",
            createdAt = now
        )
        invoiceDao.upsertAll(listOf(entity))
        invoiceItemDao.upsertAll(itemEntities)
        return entity.toDomain(itemEntities.map { it.toDomain() }, customer?.name)
    }
}

fun InvoiceDto.toDomain() = Invoice(
    id = id,
    invoiceNumber = invoiceNumber,
    customerName = customer?.name ?: customerId,
    customerId = customerId,
    date = date.take(10),
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
    items = items.map { it.toDomain() }
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

private fun InvoiceEntity.toDomain(items: List<InvoiceItem>, customerName: String? = null) = Invoice(
    id = id,
    invoiceNumber = invoiceNumber,
    customerName = customerName ?: customerId,
    customerId = customerId,
    date = date.take(10),
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
    items = items
)

fun InvoiceItemDto.toDomain() = InvoiceItem(
    productId = productId,
    productName = productName ?: productId,
    warehouseId = warehouseId,
    unit = unit,
    quantity = quantity,
    unitPrice = unitPrice,
    totalPrice = totalPrice
)

private fun InvoiceItemDto.toEntity(parentInvoiceId: String) = InvoiceItemEntity(
    id = id ?: "${parentInvoiceId}_${productId}",
    invoiceId = invoiceId ?: parentInvoiceId,
    productId = productId,
    productName = productName ?: productId,
    unit = unit,
    quantity = quantity,
    unitPrice = unitPrice,
    totalPrice = totalPrice
)

private fun InvoiceItemEntity.toDomain() = InvoiceItem(
    productId = productId,
    productName = productName,
    warehouseId = null,
    unit = unit,
    quantity = quantity,
    unitPrice = unitPrice,
    totalPrice = totalPrice
)

fun List<InvoiceItem>.toCreateItems() = map {
    CreateInvoiceItemRequest(
        productId = it.productId,
        unit = it.unit,
        quantity = it.quantity,
        unitPrice = it.unitPrice,
    )
}
