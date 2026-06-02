package com.inventory.ui.invoices

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.remote.ApiResult
import com.inventory.data.remote.dto.CreateInvoiceRequest
import com.inventory.data.repository.CustomerRepository
import com.inventory.data.repository.InvoiceRepository
import com.inventory.data.repository.ProductRepository
import com.inventory.data.repository.toCreateItems
import com.inventory.domain.model.Customer
import com.inventory.domain.model.Invoice
import com.inventory.domain.model.InvoiceItem
import com.inventory.domain.model.Product
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.LocalDate
import javax.inject.Inject

data class InvoiceListUiState(
    val invoices: List<Invoice> = emptyList(),
    val query: String = "",
    val filter: String = "today",
    val isLoading: Boolean = false,
    val error: String? = null
) {
    val filteredInvoices = invoices.filter {
        query.isBlank() || it.invoiceNumber.contains(query, true) || it.customerName.contains(query, true)
    }
}

@HiltViewModel
class InvoiceListViewModel @Inject constructor(
    private val repository: InvoiceRepository
) : ViewModel() {
    private val _state = MutableStateFlow(InvoiceListUiState())
    val state = _state.asStateFlow()

    init {
        refresh()
        // ── Auto-refresh every 30 seconds ──
        viewModelScope.launch {
            while (true) {
                delay(30_000L)
                doRefresh(showLoading = false) // silent background refresh
            }
        }
    }

    fun setQuery(value: String) { _state.value = _state.value.copy(query = value) }
    fun setFilter(value: String) { _state.value = _state.value.copy(filter = value); refresh() }

    fun refresh() {
        viewModelScope.launch { doRefresh(showLoading = true) }
    }

    private suspend fun doRefresh(showLoading: Boolean) {
        val (from, to) = rangeFor(_state.value.filter)
        if (showLoading) _state.value = _state.value.copy(isLoading = true)
        when (val result = repository.listInvoices(from, to)) {
            is ApiResult.Success -> _state.value = _state.value.copy(invoices = result.data, isLoading = false, error = null)
            is ApiResult.Error   -> _state.value = _state.value.copy(isLoading = false, error = result.message)
            ApiResult.Offline    -> _state.value = _state.value.copy(isLoading = false, error = "لا يوجد اتصال")
        }
    }
}

data class InvoiceDraftItem(
    val product: Product,
    val unit: String = "PIECE",
    val quantity: Int = 1,
    val unitPrice: Double = product.salePrice
) {
    val totalPrice: Double = quantity * unitPrice
    fun toInvoiceItem() = InvoiceItem(product.id, product.name, unit, quantity, unitPrice, totalPrice)
}

data class InvoiceCreateUiState(
    val customers: List<Customer> = emptyList(),
    val products: List<Product> = emptyList(),
    val customerQuery: String = "",
    val productQuery: String = "",
    val selectedCustomer: Customer? = null,
    val date: String = LocalDate.now().toString(),
    val invoiceNumber: String = "تلقائي",
    val items: List<InvoiceDraftItem> = emptyList(),
    val showPurchasePrice: Boolean = false,
    val showStock: Boolean = false,
    val discountValue: String = "0",
    val discountMode: String = "amount",
    val tax: String = "0",
    val paidAmount: String = "0",
    val paymentType: String = "CREDIT",
    val preview: Boolean = false,
    val isSaving: Boolean = false,
    val error: String? = null,
    val queuedMessage: String? = null,
    val savedInvoiceId: String? = null
) {
    val customerSuggestions = customers.filter { customerQuery.isBlank() || it.name.contains(customerQuery, true) || it.phone.contains(customerQuery) }.take(6)
    val productSuggestions = products.filter { productQuery.isBlank() || it.name.contains(productQuery, true) || it.itemNumber.contains(productQuery, true) }.take(8)
    val subtotal = items.sumOf { it.totalPrice }
    val discountAmount = if (discountMode == "percent") subtotal * (discountValue.toDoubleOrNull().orZero() / 100.0) else discountValue.toDoubleOrNull().orZero()
    val afterDiscount = subtotal - discountAmount
    val total = afterDiscount + tax.toDoubleOrNull().orZero()
    val previousBalance = selectedCustomer?.currentBalance ?: 0.0
    val paid = paidAmount.toDoubleOrNull().orZero()
    val remaining = total - paid
    val finalBalance = previousBalance + remaining
}

@HiltViewModel
class InvoiceCreateViewModel @Inject constructor(
    private val invoiceRepository: InvoiceRepository,
    private val customerRepository: CustomerRepository,
    private val productRepository: ProductRepository
) : ViewModel() {
    private val _state = MutableStateFlow(InvoiceCreateUiState())
    val state: StateFlow<InvoiceCreateUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch { customerRepository.customers.collect { _state.value = _state.value.copy(customers = it) } }
        viewModelScope.launch { productRepository.products.collect { _state.value = _state.value.copy(products = it) } }
        viewModelScope.launch { customerRepository.refreshCustomers(); productRepository.refreshProducts() }
    }

    fun setCustomerQuery(value: String) { _state.value = _state.value.copy(customerQuery = value, selectedCustomer = null) }
    fun selectCustomer(customer: Customer) { _state.value = _state.value.copy(selectedCustomer = customer, customerQuery = customer.name) }
    fun setProductQuery(value: String) { _state.value = _state.value.copy(productQuery = value) }
    fun setDate(value: String) { _state.value = _state.value.copy(date = value) }
    fun togglePurchase() { _state.value = _state.value.copy(showPurchasePrice = !_state.value.showPurchasePrice) }
    fun toggleStock() { _state.value = _state.value.copy(showStock = !_state.value.showStock) }
    fun setDiscount(value: String) { _state.value = _state.value.copy(discountValue = value.filterDecimal()) }
    fun setTax(value: String) { _state.value = _state.value.copy(tax = value.filterDecimal()) }
    fun setPaid(value: String) { _state.value = _state.value.copy(paidAmount = value.filterDecimal()) }
    fun setDiscountMode(value: String) { _state.value = _state.value.copy(discountMode = value) }
    fun setPaymentType(value: String) { _state.value = _state.value.copy(paymentType = value) }
    fun showPreview() { _state.value = _state.value.copy(preview = true) }
    fun hidePreview() { _state.value = _state.value.copy(preview = false) }

    fun addProduct(product: Product) {
        if (_state.value.items.any { it.product.id == product.id }) return
        _state.value = _state.value.copy(items = _state.value.items + InvoiceDraftItem(product), productQuery = "")
    }

    fun updateItem(productId: String, unit: String? = null, quantity: Int? = null, price: Double? = null) {
        _state.value = _state.value.copy(items = _state.value.items.map {
            if (it.product.id == productId) it.copy(
                unit = unit ?: it.unit,
                quantity = quantity ?: it.quantity,
                unitPrice = price ?: it.unitPrice
            ) else it
        })
    }

    fun removeItem(productId: String) {
        _state.value = _state.value.copy(items = _state.value.items.filterNot { it.product.id == productId })
    }

    fun save() {
        val current = _state.value
        val customer = current.selectedCustomer
        val error = when {
            customer == null -> "اختر الزبون"
            current.items.isEmpty() -> "أضف صنف واحد على الأقل"
            current.date.isBlank() -> "التاريخ مطلوب"
            current.total < 0.0 -> "الخصم أكبر من مجموع الفاتورة"
            else -> null
        }
        if (error != null) {
            _state.value = current.copy(error = error)
            return
        }
        viewModelScope.launch {
            _state.value = _state.value.copy(isSaving = true)
            val request = CreateInvoiceRequest(
                customerId = customer!!.id,
                date = current.date,
                discount = current.discountAmount,
                tax = current.tax.toDoubleOrNull().orZero(),
                paidAmount = current.paid,
                paymentType = current.paymentType,
                items = current.items.map { it.toInvoiceItem() }.toCreateItems()
            )
            when (val result = invoiceRepository.createInvoice(request)) {
                is ApiResult.Success -> _state.value = _state.value.copy(isSaving = false, savedInvoiceId = result.data.id, preview = false, error = null, queuedMessage = null)
                is ApiResult.Queued -> _state.value = _state.value.copy(isSaving = false, preview = false, error = null, queuedMessage = result.message)
                is ApiResult.Error -> _state.value = _state.value.copy(isSaving = false, error = result.message)
                ApiResult.Offline -> _state.value = _state.value.copy(isSaving = false, error = "لا يوجد اتصال")
            }
        }
    }
    fun downloadPdf(context: android.content.Context) {
        val invoiceId = _state.value.savedInvoiceId
        if (invoiceId == null) {
            _state.value = _state.value.copy(error = "يجب حفظ الفاتورة أولاً")
            return
        }
        downloadFile(context, invoiceId, "pdf")
    }

    fun downloadImage(context: android.content.Context) {
        val invoiceId = _state.value.savedInvoiceId
        if (invoiceId == null) {
            _state.value = _state.value.copy(error = "يجب حفظ الفاتورة أولاً")
            return
        }
        downloadFile(context, invoiceId, "image")
    }

    private fun downloadFile(context: android.content.Context, invoiceId: String, type: String) {
        viewModelScope.launch {
            try {
                val responseBody = if (type == "pdf") {
                    invoiceRepository.exportPdf(invoiceId)
                } else {
                    invoiceRepository.exportImage(invoiceId)
                }
                
                val ext = if (type == "pdf") "pdf" else "png"
                val file = java.io.File(context.cacheDir, "invoice_${invoiceId}.$ext")
                file.writeBytes(responseBody.bytes())
                
                val uri = androidx.core.content.FileProvider.getUriForFile(
                    context,
                    "${context.packageName}.fileprovider",
                    file
                )
                
                val intent = android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, if (type == "pdf") "application/pdf" else "image/png")
                    addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                context.startActivity(android.content.Intent.createChooser(intent, "عرض الفاتورة"))
            } catch (e: Exception) {
                _state.value = _state.value.copy(error = "فشل التحميل: ${e.message}")
            }
        }
    }
}

private fun rangeFor(filter: String): Pair<String?, String?> {
    val today = LocalDate.now()
    return when (filter) {
        "today" -> today.toString() to today.toString()
        "week" -> today.minusDays(6).toString() to today.toString()
        "month" -> today.withDayOfMonth(1).toString() to today.toString()
        else -> null to null
    }
}

private fun String.filterDecimal() = filter { it.isDigit() || it == '.' }.ifBlank { "0" }
private fun Double?.orZero() = this ?: 0.0
