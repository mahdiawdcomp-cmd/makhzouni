package com.inventory.ui.invoices

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.remote.ApiResult
import com.inventory.data.remote.dto.CreateInvoiceRequest
import com.inventory.data.remote.dto.CreateInvoiceItemRequest
import com.inventory.data.repository.CustomerRepository
import com.inventory.data.repository.InvoiceRepository
import com.inventory.data.repository.ProductRepository
import com.inventory.data.repository.SessionManager
import com.inventory.domain.model.Customer
import com.inventory.domain.model.Invoice
import com.inventory.domain.model.InvoiceItem
import com.inventory.domain.model.Product
import com.inventory.domain.finance.FinancialInvoiceType
import com.inventory.domain.finance.calculateInvoiceFinancials
import com.inventory.domain.finance.roundMoney
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
import java.util.UUID
import javax.inject.Inject

data class InvoiceListUiState(
    val invoices: List<Invoice> = emptyList(),
    val query: String = "",
    val filter: String = "all",
    val sortBy: String = "dateDesc",
    val isLoading: Boolean = false,
    val error: String? = null
) {
    val filteredInvoices = invoices.filter {
        query.isBlank() || it.invoiceNumber.contains(query, true) || it.customerName.contains(query, true)
    }.let { rows ->
        when (sortBy) {
            "totalDesc" -> rows.sortedByDescending { it.totalAmount }
            "remainingDesc" -> rows.sortedByDescending { it.remainingAmount }
            "paidDesc" -> rows.sortedByDescending { it.paidAmount }
            "customer" -> rows.sortedBy { it.customerName }
            else -> rows.sortedByDescending { it.date }
        }
    }
}

@HiltViewModel
class InvoiceListViewModel @Inject constructor(
    private val repository: InvoiceRepository,
    private val customerRepository: CustomerRepository
) : ViewModel() {
    private val _state = MutableStateFlow(InvoiceListUiState())
    val state = _state.asStateFlow()

    init {
        refresh()
        // â”€â”€ Auto-refresh every 30 seconds â”€â”€
        viewModelScope.launch {
            while (true) {
                delay(30_000L)
                doRefresh(showLoading = false) // silent background refresh
            }
        }
    }

    fun setQuery(value: String) { _state.value = _state.value.copy(query = value) }
    fun setFilter(value: String) { _state.value = _state.value.copy(filter = value); refresh() }
    fun setSort(value: String) { _state.value = _state.value.copy(sortBy = value) }

    fun refresh() {
        viewModelScope.launch { doRefresh(showLoading = true) }
    }

    private suspend fun doRefresh(showLoading: Boolean) {
        val (from, to) = rangeFor(_state.value.filter)
        if (showLoading) _state.value = _state.value.copy(isLoading = true)
        when (val result = repository.listInvoices(from, to)) {
            is ApiResult.Success -> {
                val invoices = result.data.ifEmpty { loadInvoicesFromStatements(from, to) }
                _state.value = _state.value.copy(invoices = invoices, isLoading = false, error = null)
            }
            is ApiResult.Error   -> {
                val invoices = loadInvoicesFromStatements(from, to)
                _state.value = _state.value.copy(
                    invoices = invoices,
                    isLoading = false,
                    error = if (invoices.isEmpty()) result.message else null
                )
            }
            ApiResult.Offline    -> _state.value = _state.value.copy(isLoading = false, error = "لا يوجد اتصال")
        }
    }

    private suspend fun loadInvoicesFromStatements(from: String?, to: String?): List<Invoice> {
        val customers = when (val result = customerRepository.refreshCustomers()) {
            is ApiResult.Success -> result.data
            else -> emptyList()
        }
        val uuid = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
        val seen = mutableSetOf<String>()
        return customers.flatMap { customer ->
            when (val rows = customerRepository.transactions(customer.id, from, to)) {
                is ApiResult.Success -> rows.data.mapNotNull { row ->
                    val type = row.type.uppercase()
                    if (!type.contains("INVOICE") || type.contains("PAYMENT")) return@mapNotNull null
                    val invoiceId = uuid.find(row.id)?.value ?: row.id
                    if (!seen.add(invoiceId)) return@mapNotNull null
                    Invoice(
                        id = invoiceId,
                        invoiceNumber = row.referenceNumber,
                        customerName = customer.name,
                        customerId = customer.id,
                        date = row.date.take(10),
                        type = row.invoiceType ?: if (row.credit > 0.0) "PURCHASE" else "SALE",
                        totalAmount = row.amount,
                        paidAmount = 0.0,
                        remainingAmount = row.amount,
                        previousBalance = 0.0,
                        finalBalance = row.runningBalance,
                        paymentType = "CREDIT",
                        status = "ACTIVE"
                    )
                }
                else -> emptyList()
            }
        }.sortedByDescending { it.date }
    }
}

data class InvoiceDraftItem(
    val product: Product,
    val lineId: String = UUID.randomUUID().toString(),
    val unit: String = "PIECE",
    val warehouseId: String? = product.warehouseStocks.maxByOrNull { it.quantityPieces }?.warehouseId,
    val quantity: Int = 0,
    val unitPrice: Double = unitPriceFor(product, unit)
) {
    val totalPrice: Double = quantity * unitPrice
    fun toInvoiceItem() = InvoiceItem(
        productId = product.id,
        productName = product.name,
        warehouseId = warehouseId,
        unit = unit,
        quantity = quantity,
        unitPrice = unitPrice,
        totalPrice = totalPrice,
    )
}

private fun unitPriceFor(product: Product, unit: String, useRetail: Boolean = false): Double {
    val base = if (useRetail && product.retailPrice > 0.0) product.retailPrice else product.salePrice
    return when (unit) {
        "CARTON" -> base * product.pcsPerCarton
        "DOZEN" -> base * 12
        else -> base
    }
}

data class InvoiceCreateUiState(
    val customers: List<Customer> = emptyList(),
    val products: List<Product> = emptyList(),
    val customerQuery: String = "",
    val productQuery: String = "",
    val selectedCustomer: Customer? = null,
    val date: String = LocalDate.now().toString(),
    val invoiceNumber: String = "تلقائي",
    val invoiceType: String = "SALE",
    val items: List<InvoiceDraftItem> = emptyList(),
    val showPurchasePrice: Boolean = false,
    val showStock: Boolean = false,
    val useRetailPrice: Boolean = false,
    val hidePrice: Boolean = false,
    val discountValue: String = "0",
    val discountMode: String = "amount",
    val paidAmount: String = "0",
    val paymentType: String = "CREDIT",
    val preview: Boolean = false,
    val isSaving: Boolean = false,
    val error: String? = null,
    val queuedMessage: String? = null,
    val savedInvoiceId: String? = null,
    val editingInvoiceId: String? = null,
    val editLoaded: Boolean = false
) {
    val customerSuggestions = if (customerQuery.isBlank() || selectedCustomer != null) {
        emptyList()
    } else {
        customers.filter { it.name.contains(customerQuery, true) || it.phone.contains(customerQuery) }.take(6)
    }
    val productSuggestions = if (productQuery.isBlank()) {
        emptyList()
    } else {
        products.filter { it.name.contains(productQuery, true) || it.itemNumber.contains(productQuery, true) }.take(8)
    }
    val subtotal = items.sumOf { it.totalPrice }.roundMoney()
    val discountAmount = (if (discountMode == "percent") subtotal * (discountValue.toDoubleOrNull().orZero() / 100.0) else discountValue.toDoubleOrNull().orZero()).roundMoney()
    val previousBalance = selectedCustomer?.currentBalance ?: 0.0
    val requestedPaid = when (paymentType) {
        "CASH" -> (subtotal - discountAmount).coerceAtLeast(0.0)
        "CREDIT" -> 0.0
        else -> paidAmount.toDoubleOrNull().orZero()
    }
    val financials = calculateInvoiceFinancials(
        type = FinancialInvoiceType.valueOf(invoiceType),
        subtotal = subtotal,
        discount = discountAmount,
        tax = 0.0,
        requestedPaid = requestedPaid,
        previousBalance = previousBalance,
    )
    val total = financials.totalAmount
    val paid = financials.paidAmount
    val remaining = financials.remainingAmount
    val finalBalance = financials.finalBalance
}

@HiltViewModel
class InvoiceCreateViewModel @Inject constructor(
    private val invoiceRepository: InvoiceRepository,
    private val customerRepository: CustomerRepository,
    private val productRepository: ProductRepository,
    private val sessionManager: SessionManager
) : ViewModel() {
    private val _state = MutableStateFlow(InvoiceCreateUiState())
    val state: StateFlow<InvoiceCreateUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch { customerRepository.customers.collect { _state.value = _state.value.copy(customers = it) } }
        viewModelScope.launch { productRepository.products.collect { _state.value = _state.value.copy(products = it) } }
        viewModelScope.launch { customerRepository.refreshCustomers(); productRepository.refreshProducts() }
        viewModelScope.launch {
            sessionManager.permissions.collect { perms ->
                _state.value = _state.value.copy(hidePrice = perms.contains("VIEW_WITHOUT_PRICES"))
            }
        }
    }

    fun setCustomerQuery(value: String) { _state.value = _state.value.copy(customerQuery = value, selectedCustomer = null) }
    fun selectCustomer(customer: Customer) { _state.value = _state.value.copy(selectedCustomer = customer, customerQuery = customer.name) }
    fun setProductQuery(value: String) { _state.value = _state.value.copy(productQuery = value) }
    fun setDate(value: String) { _state.value = _state.value.copy(date = value) }
    fun togglePurchase() { _state.value = _state.value.copy(showPurchasePrice = !_state.value.showPurchasePrice) }
    fun toggleStock() { _state.value = _state.value.copy(showStock = !_state.value.showStock) }
    fun setDiscount(value: String) { _state.value = _state.value.copy(discountValue = value.filterDecimal()) }
    fun setPaid(value: String) { _state.value = _state.value.copy(paidAmount = value.filterDecimal()) }
    fun setDiscountMode(value: String) { _state.value = _state.value.copy(discountMode = value) }
    fun setPaymentType(value: String) { _state.value = _state.value.copy(paymentType = value) }
    fun showPreview() { _state.value = _state.value.copy(preview = true) }
    fun hidePreview() { _state.value = _state.value.copy(preview = false) }

    fun loadForEdit(invoiceId: String) {
        if (_state.value.editLoaded && _state.value.editingInvoiceId == invoiceId) return
        viewModelScope.launch {
            _state.value = _state.value.copy(isSaving = true, editingInvoiceId = invoiceId)
            when (val result = invoiceRepository.getInvoice(invoiceId)) {
                is ApiResult.Success -> {
                    val invoice = result.data
                    val products = _state.value.products
                    val customers = _state.value.customers
                    val customer = customers.find { it.id == invoice.customerId } ?: Customer(
                        id = invoice.customerId,
                        name = invoice.customerName,
                        phone = "",
                        address = null,
                        notes = null,
                        openingBalance = 0.0,
                        currentBalance = invoice.previousBalance,
                        isSupplier = false,
                        lastTransactionAt = null,
                        updatedAt = null
                    )
                    val draftItems = invoice.items.map { invoiceItem ->
                        val product = products.find { it.id == invoiceItem.productId } ?: Product(
                            id = invoiceItem.productId,
                            itemNumber = invoiceItem.productId.take(8),
                            name = invoiceItem.productName,
                            qrCode = "",
                            category = "",
                            openingBalancePcs = 0,
                            cartonsAvailable = 0,
                            pcsPerCarton = 1,
                            purchasePrice = 0.0,
                            salePrice = invoiceItem.unitPrice,
                            minStock = 0,
                            updatedAt = null
                        )
                        InvoiceDraftItem(
                            product = product,
                            unit = invoiceItem.unit,
                            warehouseId = invoiceItem.warehouseId,
                            quantity = invoiceItem.quantity,
                            unitPrice = invoiceItem.unitPrice
                        )
                    }
                    _state.value = _state.value.copy(
                        selectedCustomer = customer,
                        customerQuery = customer?.name ?: invoice.customerName,
                        date = invoice.date,
                        invoiceNumber = invoice.invoiceNumber,
                        invoiceType = invoice.type,
                        items = draftItems,
                        discountValue = invoice.discount.toString(),
                        discountMode = "amount",
                        paidAmount = invoice.paidAmount.toString(),
                        paymentType = invoice.paymentType,
                        isSaving = false,
                        error = null,
                        editLoaded = true
                    )
                }
                is ApiResult.Error -> _state.value = _state.value.copy(isSaving = false, error = result.message)
                ApiResult.Offline -> _state.value = _state.value.copy(isSaving = false, error = "لا يوجد اتصال")
                else -> _state.value = _state.value.copy(isSaving = false)
            }
        }
    }

    fun addProduct(product: Product) {
        val useRetail = _state.value.useRetailPrice
        _state.value = _state.value.copy(
            items = _state.value.items + InvoiceDraftItem(product = product, unitPrice = unitPriceFor(product, "PIECE", useRetail)),
            productQuery = ""
        )
    }

    fun addProductById(productId: String, unit: String = "PIECE") {
        val product = _state.value.products.find { it.id == productId } ?: return
        val useRetail = _state.value.useRetailPrice
        _state.value = _state.value.copy(
            items = _state.value.items + InvoiceDraftItem(product = product, unit = unit, unitPrice = unitPriceFor(product, unit, useRetail)),
            productQuery = ""
        )
    }

    fun toggleRetailPrice() {
        val next = !_state.value.useRetailPrice
        val updatedItems = _state.value.items.map {
            it.copy(unitPrice = unitPriceFor(it.product, it.unit, next))
        }
        _state.value = _state.value.copy(useRetailPrice = next, items = updatedItems)
    }

    fun quickCreateProduct() {
        val name = _state.value.productQuery.trim()
        if (name.isBlank()) return
        viewModelScope.launch {
            when (val result = productRepository.createQuickProduct(name)) {
                is ApiResult.Success -> addProduct(result.data)
                is ApiResult.Error -> _state.value = _state.value.copy(error = result.message)
                ApiResult.Offline -> _state.value = _state.value.copy(error = "لا يوجد اتصال لإضافة المادة")
            }
        }
    }

    fun updateItem(lineId: String, unit: String? = null, quantity: Int? = null, price: Double? = null) {
        _state.value = _state.value.copy(items = _state.value.items.map {
            val nextUnit = unit ?: it.unit
            if (it.lineId == lineId) it.copy(
                unit = nextUnit,
                quantity = quantity ?: it.quantity,
                unitPrice = price ?: if (unit != null) unitPriceFor(it.product, nextUnit, _state.value.useRetailPrice) else it.unitPrice
            ) else it
        })
    }

    fun updateItemWarehouse(lineId: String, warehouseId: String) {
        _state.value = _state.value.copy(items = _state.value.items.map {
            if (it.lineId == lineId) it.copy(warehouseId = warehouseId) else it
        })
    }

    fun updateItemTotal(lineId: String, total: Double) {
        _state.value = _state.value.copy(items = _state.value.items.map {
            if (it.lineId == lineId) {
                val qty = if (it.quantity <= 0) 1 else it.quantity
                it.copy(unitPrice = total / qty)
            } else {
                it
            }
        })
    }

    fun removeItem(lineId: String) {
        _state.value = _state.value.copy(items = _state.value.items.filterNot { it.lineId == lineId })
    }

    fun save() {
        val current = _state.value
        val customer = current.selectedCustomer
        val error = when {
            current.items.any { it.quantity <= 0 } -> "أدخل العدد لكل مادة"
            customer == null -> "اختر الزبون"
            current.items.isEmpty() -> "أضف صنف واحد على الأقل"
            current.date.isBlank() -> "التاريخ مطلوب"
            current.total < 0.0 -> "المجموع غير صحيح"
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
                type = current.invoiceType,
                discount = current.discountAmount,
                tax = 0.0,
                paidAmount = current.paid,
                paymentType = current.financials.paymentType,
                items = current.items.map {
                    CreateInvoiceItemRequest(
                        productId = it.product.id,
                        warehouseId = it.warehouseId,
                        unit = it.unit,
                        quantity = it.quantity,
                        unitPrice = it.unitPrice,
                    )
                }
            )
            val result = current.editingInvoiceId?.let { invoiceRepository.updateInvoice(it, request) }
                ?: invoiceRepository.createInvoice(request)
            when (result) {
                is ApiResult.Success -> {
                    customerRepository.refreshCustomers()
                    productRepository.refreshProducts()
                    _state.value = _state.value.copy(isSaving = false, savedInvoiceId = result.data.id, preview = false, error = null, queuedMessage = null)
                }
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
