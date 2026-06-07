package com.inventory.ui.operations

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.remote.ApiResult
import com.inventory.data.remote.dto.BranchDto
import com.inventory.data.remote.dto.BranchRequest
import com.inventory.data.remote.dto.CouponDto
import com.inventory.data.remote.dto.CouponRequest
import com.inventory.data.remote.dto.CreateInvoiceRequest
import com.inventory.data.remote.dto.CreateQuotationRequest
import com.inventory.data.remote.dto.CreateTransferItemRequest
import com.inventory.data.remote.dto.CreateTransferRequest
import com.inventory.data.repository.CustomerRepository
import com.inventory.data.repository.InvoiceRepository
import com.inventory.data.repository.OperationsRepository
import com.inventory.data.repository.ProductRepository
import com.inventory.domain.model.Customer
import com.inventory.domain.model.Product
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.LocalDate
import javax.inject.Inject

data class DraftLine(
    val product: Product,
    val unit: String = "PIECE",
    val quantity: Int = 1,
    val unitPrice: Double = product.salePrice
) {
    val total: Double = quantity * unitPrice
}

data class SalesOperationState(
    val mode: String = "POS",
    val customers: List<Customer> = emptyList(),
    val products: List<Product> = emptyList(),
    val customerQuery: String = "",
    val productQuery: String = "",
    val selectedCustomer: Customer? = null,
    val lines: List<DraftLine> = emptyList(),
    val paid: String = "0",
    val discount: String = "0",
    val notes: String = "",
    val loading: Boolean = false,
    val message: String? = null
) {
    val customerSuggestions = if (selectedCustomer != null || customerQuery.isBlank()) emptyList()
    else customers.filter { it.name.contains(customerQuery, true) || it.phone.contains(customerQuery) }.take(6)

    val productSuggestions = if (productQuery.isBlank()) emptyList()
    else products.filter { it.name.contains(productQuery, true) || it.itemNumber.contains(productQuery, true) }.take(8)

    val subtotal = lines.sumOf { it.total }
    val total = (subtotal - (discount.toDoubleOrNull() ?: 0.0)).coerceAtLeast(0.0)
}

@HiltViewModel
class SalesOperationViewModel @Inject constructor(
    private val invoiceRepository: InvoiceRepository,
    private val operationsRepository: OperationsRepository,
    private val customerRepository: CustomerRepository,
    private val productRepository: ProductRepository
) : ViewModel() {
    private val _state = MutableStateFlow(SalesOperationState())
    val state = _state.asStateFlow()

    init {
        viewModelScope.launch { customerRepository.customers.collect { _state.value = _state.value.copy(customers = it) } }
        viewModelScope.launch { productRepository.products.collect { _state.value = _state.value.copy(products = it) } }
        viewModelScope.launch {
            customerRepository.refreshCustomers()
            productRepository.refreshProducts()
        }
    }

    fun setMode(mode: String) {
        if (_state.value.mode != mode) _state.value = _state.value.copy(mode = mode, message = null)
    }

    fun setCustomerQuery(value: String) {
        _state.value = _state.value.copy(customerQuery = value, selectedCustomer = null)
    }

    fun selectCustomer(customer: Customer) {
        _state.value = _state.value.copy(selectedCustomer = customer, customerQuery = customer.name)
    }

    fun setProductQuery(value: String) {
        _state.value = _state.value.copy(productQuery = value)
    }

    fun addProduct(product: Product) {
        _state.value = _state.value.copy(
            lines = _state.value.lines + DraftLine(product),
            productQuery = ""
        )
    }

    fun addProductById(productId: String, unit: String = "PIECE") {
        val product = _state.value.products.find { it.id == productId } ?: return
        _state.value = _state.value.copy(
            lines = _state.value.lines + DraftLine(product = product, unit = unit, unitPrice = unitPriceFor(product, unit)),
            productQuery = ""
        )
    }

    fun updateLine(index: Int, quantity: Int? = null, unitPrice: Double? = null, unit: String? = null) {
        _state.value = _state.value.copy(lines = _state.value.lines.mapIndexed { i, line ->
            if (i == index) {
                val nextUnit = unit ?: line.unit
                line.copy(
                    unit = nextUnit,
                    quantity = quantity ?: line.quantity,
                    unitPrice = unitPrice ?: if (unit != null) unitPriceFor(line.product, nextUnit) else line.unitPrice
                )
            } else line
        })
    }

    fun removeLine(index: Int) {
        _state.value = _state.value.copy(lines = _state.value.lines.filterIndexed { i, _ -> i != index })
    }

    fun setPaid(value: String) { _state.value = _state.value.copy(paid = value.decimal()) }
    fun setDiscount(value: String) { _state.value = _state.value.copy(discount = value.decimal()) }
    fun setNotes(value: String) { _state.value = _state.value.copy(notes = value) }
    fun clearMessage() { _state.value = _state.value.copy(message = null) }

    fun save() {
        val s = _state.value
        val customer = s.selectedCustomer
        val validation = when {
            customer == null -> "اختار الزبون أولاً"
            s.lines.isEmpty() -> "أضف مادة واحدة على الأقل"
            s.lines.any { it.quantity <= 0 } -> "العدد لازم يكون أكبر من صفر"
            else -> null
        }
        if (validation != null) {
            _state.value = s.copy(message = validation)
            return
        }

        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true)
            val items = s.lines.map {
                com.inventory.data.remote.dto.CreateInvoiceItemRequest(
                    productId = it.product.id,
                    unit = it.unit,
                    quantity = it.quantity,
                    unitPrice = it.unitPrice
                )
            }
            val result = if (s.mode == "QUOTATION") {
                operationsRepository.createQuotation(
                    CreateQuotationRequest(
                        customerId = customer!!.id,
                        discount = s.discount.toDoubleOrNull() ?: 0.0,
                        notes = s.notes.takeIf { it.isNotBlank() },
                        items = items
                    )
                )
            } else {
                val request = CreateInvoiceRequest(
                    customerId = customer!!.id,
                    date = LocalDate.now().toString(),
                    type = if (s.mode == "RETURN") "SALES_RETURN" else "SALE",
                    discount = s.discount.toDoubleOrNull() ?: 0.0,
                    tax = 0.0,
                    paidAmount = s.paid.toDoubleOrNull() ?: 0.0,
                    paymentType = if ((s.paid.toDoubleOrNull() ?: 0.0) >= s.total) "CASH" else "PARTIAL",
                    items = items
                )
                invoiceRepository.createInvoice(request)
            }

            when (result) {
                is ApiResult.Success -> {
                    productRepository.refreshProducts()
                    customerRepository.refreshCustomers()
                    _state.value = SalesOperationState(
                        mode = s.mode,
                        customers = _state.value.customers,
                        products = _state.value.products,
                        message = when (s.mode) {
                            "RETURN" -> "تم حفظ مرتجع المبيعات"
                            "QUOTATION" -> "تم حفظ عرض السعر"
                            else -> "تم حفظ فاتورة POS"
                        }
                    )
                }
                is ApiResult.Error -> _state.value = _state.value.copy(loading = false, message = result.message)
                is ApiResult.Offline -> _state.value = _state.value.copy(loading = false, message = "لا يوجد اتصال")
                is ApiResult.Queued -> _state.value = _state.value.copy(loading = false, message = result.message)
            }
        }
    }
}

data class AdminOperationsState(
    val branches: List<BranchDto> = emptyList(),
    val coupons: List<CouponDto> = emptyList(),
    val quotations: List<com.inventory.data.remote.dto.QuotationDto> = emptyList(),
    val transfers: List<com.inventory.data.remote.dto.TransferDto> = emptyList(),
    val auditLogs: List<com.inventory.data.remote.dto.AuditLogDto> = emptyList(),
    val products: List<Product> = emptyList(),
    val loading: Boolean = false,
    val message: String? = null,
    val auditEntity: String? = null,
    val auditAction: String? = null
)

@HiltViewModel
class AdminOperationsViewModel @Inject constructor(
    private val operationsRepository: OperationsRepository,
    private val productRepository: ProductRepository
) : ViewModel() {
    private val _state = MutableStateFlow(AdminOperationsState())
    val state = _state.asStateFlow()

    init {
        viewModelScope.launch { productRepository.products.collect { _state.value = _state.value.copy(products = it) } }
        refreshAll()
    }

    fun refreshAll() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true)
            productRepository.refreshProducts()
            val branches = operationsRepository.branches()
            val coupons = operationsRepository.coupons()
            val quotations = operationsRepository.quotations()
            val transfers = operationsRepository.transfers()
            val logs = operationsRepository.auditLogs(_state.value.auditEntity, _state.value.auditAction)
            _state.value = _state.value.copy(
                branches = (branches as? ApiResult.Success)?.data ?: _state.value.branches,
                coupons = (coupons as? ApiResult.Success)?.data ?: _state.value.coupons,
                quotations = (quotations as? ApiResult.Success)?.data ?: _state.value.quotations,
                transfers = (transfers as? ApiResult.Success)?.data ?: _state.value.transfers,
                auditLogs = (logs as? ApiResult.Success)?.data ?: _state.value.auditLogs,
                loading = false,
                message = listOf(branches, coupons, transfers, logs).filterIsInstance<ApiResult.Error>().firstOrNull()?.message
            )
        }
    }

    fun updateQuotation(id: String, status: String) {
        viewModelScope.launch {
            when (val result = operationsRepository.updateQuotationStatus(id, status)) {
                is ApiResult.Success -> refreshAll()
                is ApiResult.Error -> _state.value = _state.value.copy(message = result.message)
                ApiResult.Offline -> _state.value = _state.value.copy(message = "لا يوجد اتصال")
            }
        }
    }

    fun convertQuotation(id: String) {
        viewModelScope.launch {
            when (val result = operationsRepository.convertQuotation(id)) {
                is ApiResult.Success -> refreshAll()
                is ApiResult.Error -> _state.value = _state.value.copy(message = result.message)
                ApiResult.Offline -> _state.value = _state.value.copy(message = "لا يوجد اتصال")
            }
        }
    }

    fun setAuditFilter(entity: String?, action: String?) {
        _state.value = _state.value.copy(auditEntity = entity, auditAction = action)
        refreshAll()
    }

    fun createBranch(name: String, code: String, phone: String, address: String) {
        viewModelScope.launch {
            when (val result = operationsRepository.createBranch(BranchRequest(name, code, phone.takeIf { it.isNotBlank() }, address.takeIf { it.isNotBlank() }))) {
                is ApiResult.Success -> refreshAll()
                is ApiResult.Error -> _state.value = _state.value.copy(message = result.message)
                ApiResult.Offline -> _state.value = _state.value.copy(message = "لا يوجد اتصال")
            }
        }
    }

    fun createCoupon(code: String, name: String, type: String, value: String, maxUses: String, active: Boolean) {
        viewModelScope.launch {
            val amount = value.toDoubleOrNull()
            if (amount == null || amount <= 0) {
                _state.value = _state.value.copy(message = "قيمة الخصم غير صحيحة")
                return@launch
            }
            val request = CouponRequest(
                code = code,
                name = name,
                discountType = type,
                discountValue = amount,
                maxUses = maxUses.toIntOrNull(),
                isActive = active
            )
            when (val result = operationsRepository.createCoupon(request)) {
                is ApiResult.Success -> refreshAll()
                is ApiResult.Error -> _state.value = _state.value.copy(message = result.message)
                ApiResult.Offline -> _state.value = _state.value.copy(message = "لا يوجد اتصال")
            }
        }
    }

    fun createTransfer(from: String, to: String, productId: String, qty: String, unit: String, notes: String) {
        viewModelScope.launch {
            val quantity = qty.toIntOrNull()
            if (from.isBlank() || to.isBlank() || productId.isBlank() || quantity == null || quantity <= 0) {
                _state.value = _state.value.copy(message = "أكمل معلومات التحويل")
                return@launch
            }
            val request = CreateTransferRequest(
                fromBranchId = from,
                toBranchId = to,
                notes = notes.takeIf { it.isNotBlank() },
                items = listOf(CreateTransferItemRequest(productId, quantity, unit))
            )
            when (val result = operationsRepository.createTransfer(request)) {
                is ApiResult.Success -> refreshAll()
                is ApiResult.Error -> _state.value = _state.value.copy(message = result.message)
                ApiResult.Offline -> _state.value = _state.value.copy(message = "لا يوجد اتصال")
            }
        }
    }

    fun clearMessage() {
        _state.value = _state.value.copy(message = null)
    }
}

private fun unitPriceFor(product: Product, unit: String): Double = when (unit) {
    "CARTON" -> product.salePrice * product.pcsPerCarton
    "DOZEN" -> product.salePrice * 12
    else -> product.salePrice
}

private fun String.decimal() = filter { it.isDigit() || it == '.' }.ifBlank { "0" }
