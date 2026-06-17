package com.inventory.ui.customers

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.remote.ApiResult
import com.inventory.data.remote.dto.UpsertCustomerRequest
import com.inventory.data.repository.CustomerRepository
import com.inventory.domain.model.Customer
import com.inventory.domain.model.CustomerTransaction
import com.inventory.domain.model.LastTransaction
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import javax.inject.Inject

data class CustomerListUiState(
    val customers: List<Customer> = emptyList(),
    val query: String = "",
    val isLoading: Boolean = false,
    val isSupplierFilter: Boolean = false,
    val sortBy: String = "updated",
    val ratings: Map<String, String> = emptyMap(),  // customerId -> "A"|"B"|"C"
    val error: String? = null
) {
    val filteredCustomers: List<Customer> = customers.filter {
        (query.isBlank() || it.name.contains(query, true) || it.phone.contains(query)) &&
        it.isSupplier == isSupplierFilter
    }.let { rows ->
        when (sortBy) {
            "name" -> rows.sortedBy { it.name }
            "balanceDesc" -> rows.sortedByDescending { it.currentBalance }
            "balanceAsc" -> rows.sortedBy { it.currentBalance }
            "last" -> rows.sortedByDescending { it.lastTransactionAt.orEmpty() }
            else -> rows.sortedByDescending { it.updatedAt.orEmpty() }
        }
    }
}

@HiltViewModel
class CustomerListViewModel @Inject constructor(
    private val repository: CustomerRepository
) : ViewModel() {
    private val query = MutableStateFlow("")
    private val isLoading = MutableStateFlow(false)
    private val error = MutableStateFlow<String?>(null)
    private val isSupplierFilter = MutableStateFlow(false)
    private val sortBy = MutableStateFlow("updated")
    private val ratings = MutableStateFlow<Map<String, String>>(emptyMap())

    val state: StateFlow<CustomerListUiState> = combine(
        combine(repository.customers, query, isSupplierFilter, isLoading, error) { customers, queryValue, supplierFilter, loading, errorValue ->
            CustomerListUiState(customers, queryValue, loading, supplierFilter, error = errorValue)
        },
        combine(sortBy, ratings) { sortValue, ratingsMap -> sortValue to ratingsMap }
    ) { stateValue, (sortValue, ratingsMap) ->
        stateValue.copy(sortBy = sortValue, ratings = ratingsMap)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), CustomerListUiState())

    init {
        refresh()
        viewModelScope.launch {
            when (val result = repository.getCustomerRatings()) {
                is ApiResult.Success -> ratings.value = result.data.associate { it.id to it.rating }
                else -> Unit
            }
        }
        // ── Auto-refresh every 30 seconds ──
        viewModelScope.launch {
            while (true) {
                delay(30_000L)
                repository.refreshCustomers(query.value)
            }
        }
    }

    fun onQueryChange(value: String) { query.value = value }
    fun onSupplierFilterChange(isSupplier: Boolean) { isSupplierFilter.value = isSupplier }
    fun onSortChange(value: String) { sortBy.value = value }

    fun refresh() {
        viewModelScope.launch {
            isLoading.value = true
            when (val result = repository.refreshCustomers(query.value)) {
                is ApiResult.Error  -> error.value = result.message
                ApiResult.Offline   -> error.value = "لا يوجد اتصال، يتم عرض البيانات المحلية"
                is ApiResult.Success -> error.value = null
            }
            isLoading.value = false
        }
    }
}

data class CustomerDetailUiState(
    val customer: Customer? = null,
    val lastTransaction: LastTransaction? = null,
    val rating: String? = null   // "A" | "B" | "C"
)

@HiltViewModel
class CustomerDetailViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val repository: CustomerRepository
) : ViewModel() {
    private val customerId: String = checkNotNull(savedStateHandle["customerId"])
    private val lastTransaction = MutableStateFlow<LastTransaction?>(null)
    private val rating = MutableStateFlow<String?>(null)

    val state = combine(
        combine(repository.observeCustomer(customerId), lastTransaction) { customer, transaction ->
            CustomerDetailUiState(customer, transaction)
        },
        rating
    ) { uiState, ratingValue ->
        uiState.copy(rating = ratingValue)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), CustomerDetailUiState())

    init {
        viewModelScope.launch {
            when (val result = repository.lastTransaction(customerId)) {
                is ApiResult.Success -> lastTransaction.value = result.data
                else -> Unit
            }
        }
        viewModelScope.launch {
            when (val result = repository.getCustomerRatings()) {
                is ApiResult.Success -> rating.value = result.data.find { it.id == customerId }?.rating
                else -> Unit
            }
        }
    }
}

data class CustomerStatementUiState(
    val from: String = "",
    val to: String = "",
    val allTime: Boolean = true,
    val rows: List<CustomerTransaction> = emptyList()
) {
    val finalBalance: Double = rows.lastOrNull()?.runningBalance ?: 0.0
}

@HiltViewModel
class CustomerStatementViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val repository: CustomerRepository
) : ViewModel() {
    private val customerId: String = checkNotNull(savedStateHandle["customerId"])
    private val from = MutableStateFlow("")
    private val to = MutableStateFlow("")
    private val allTime = MutableStateFlow(true)
    private val rows = MutableStateFlow<List<CustomerTransaction>>(emptyList())

    val state = combine(from, to, allTime, rows) { fromValue, toValue, allTimeValue, rowsValue ->
        CustomerStatementUiState(fromValue, toValue, allTimeValue, rowsValue)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), CustomerStatementUiState())

    init {
        refresh()
    }

    fun setAllTime(value: Boolean) {
        allTime.value = value
    }

    fun setFrom(value: String) {
        from.value = value
    }

    fun setTo(value: String) {
        to.value = value
    }

    fun refresh() {
        viewModelScope.launch {
            val useDates = !allTime.value
            when (val result = repository.transactions(customerId, if (useDates) from.value else null, if (useDates) to.value else null)) {
                is ApiResult.Success -> rows.value = result.data
                else -> Unit
            }
        }
    }
}

data class CustomerFormUiState(
    val name: String = "",
    val phone: String = "",
    val address: String = "",
    val notes: String = "",
    val openingBalance: String = "0",
    val isSupplier: Boolean = false,
    val error: String? = null,
    val saved: Boolean = false,
    val isSaving: Boolean = false
)

@HiltViewModel
class CustomerFormViewModel @Inject constructor(
    private val repository: CustomerRepository
) : ViewModel() {
    private val _state = MutableStateFlow(CustomerFormUiState())
    val state = _state.asStateFlow()

    fun update(field: String, value: String) {
        _state.value = when (field) {
            "name" -> _state.value.copy(name = value)
            "phone" -> _state.value.copy(phone = value)
            "address" -> _state.value.copy(address = value)
            "notes" -> _state.value.copy(notes = value)
            "openingBalance" -> _state.value.copy(openingBalance = value.filterSignedDecimal())
            "isSupplier" -> _state.value.copy(isSupplier = value.toBoolean())
            else -> _state.value
        }.copy(error = null)
    }

    fun save() {
        val current = _state.value
        val error = when {
            current.name.isBlank() -> "اسم الزبون مطلوب"
            current.phone.isBlank() -> "رقم الهاتف مطلوب"
            current.openingBalance.toDoubleOrNull() == null -> "الرصيد غير صحيح"
            else -> null
        }
        if (error != null) {
            _state.value = current.copy(error = error)
            return
        }
        viewModelScope.launch {
            try {
                repository.saveCustomer(
                    null,
                    UpsertCustomerRequest(
                        name = current.name.trim(),
                        phone = current.phone.trim(),
                        address = current.address.takeUnless { it.isBlank() },
                        notes = current.notes.takeUnless { it.isBlank() },
                        openingBalance = current.openingBalance.toDouble(),
                        isSupplier = current.isSupplier
                    )
                )
                _state.value = _state.value.copy(saved = true)
            } catch (error: Exception) {
                _state.value = _state.value.copy(error = error.message ?: "تعذر حفظ الزبون")
            }
        }
    }
}

data class ReceiptUiState(
    val customers: List<Customer> = emptyList(),
    val query: String = "",
    val selected: Customer? = null,
    val amount: String = "",
    val date: String = "",
    val notes: String = "",
    val lastTransaction: LastTransaction? = null,
    val preview: Boolean = false,
    val saved: Boolean = false,
    val isSaving: Boolean = false,
    val error: String? = null
) {
    val suggestions: List<Customer> = customers.filter {
        query.isBlank() || it.name.contains(query, true) || it.phone.contains(query)
    }.take(6)
}

@HiltViewModel
class ReceiptViewModel @Inject constructor(
    private val repository: CustomerRepository
) : ViewModel() {
    private val _state = MutableStateFlow(ReceiptUiState())
    val state = _state.asStateFlow()

    init {
        viewModelScope.launch {
            repository.customers.collect { _state.value = _state.value.copy(customers = it) }
        }
        viewModelScope.launch {
            repository.refreshCustomers()
        }
    }

    fun onQueryChange(value: String) {
        _state.value = _state.value.copy(query = value, selected = null)
    }

    fun selectCustomer(customer: Customer) {
        _state.value = _state.value.copy(query = customer.name, selected = customer)
        viewModelScope.launch {
            when (val result = repository.lastTransaction(customer.id)) {
                is ApiResult.Success -> _state.value = _state.value.copy(lastTransaction = result.data)
                else -> Unit
            }
        }
    }

    fun update(field: String, value: String) {
        _state.value = when (field) {
            "amount" -> _state.value.copy(amount = value.filterDecimal())
            "date" -> _state.value.copy(date = value)
            "notes" -> _state.value.copy(notes = value)
            else -> _state.value
        }.copy(error = null)
    }

    fun preview() {
        val current = _state.value
        val error = when {
            current.selected == null -> "اختر الزبون أولاً"
            current.amount.toDoubleOrNull() == null || current.amount.toDouble() <= 0.0 -> "المبلغ غير صحيح"
            current.date.isBlank() -> "التاريخ مطلوب"
            else -> null
        }
        _state.value = if (error == null) current.copy(preview = true) else current.copy(error = error)
    }

    fun dismissPreview() {
        _state.value = _state.value.copy(preview = false)
    }

    fun save() {
        val current = _state.value
        val customer = current.selected ?: return
        viewModelScope.launch {
            try {
                repository.createReceipt(customer.id, current.amount.toDouble(), current.date, current.notes.takeUnless { it.isBlank() })
                _state.value = _state.value.copy(saved = true, preview = false)
            } catch (error: Exception) {
                _state.value = _state.value.copy(error = error.message ?: "تعذر حفظ السند")
            }
        }
    }
}

// ── Account Lookup ───────────────────────────────────────────────────────────

data class AccountLookupUiState(
    val query: String = "",
    val customers: List<Customer> = emptyList(),
    val selectedId: String? = null,
    val transactions: List<CustomerTransaction> = emptyList(),
    val isLoadingTransactions: Boolean = false,
) {
    val suggestions: List<Customer> = if (query.isNotEmpty())
        customers.filter { it.name.contains(query, ignoreCase = true) || it.phone.contains(query) }.take(10)
    else emptyList()

    val selectedCustomer: Customer? = customers.find { it.id == selectedId }
}

@HiltViewModel
class AccountLookupViewModel @Inject constructor(
    private val repository: CustomerRepository
) : ViewModel() {
    private val _state = MutableStateFlow(AccountLookupUiState())
    val state: StateFlow<AccountLookupUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            repository.customers.collect { list ->
                _state.value = _state.value.copy(customers = list)
            }
        }
        viewModelScope.launch { repository.refreshCustomers("") }
    }

    fun onQueryChange(value: String) {
        _state.value = _state.value.copy(query = value, selectedId = null, transactions = emptyList())
    }

    fun select(id: String) {
        _state.value = _state.value.copy(selectedId = id, isLoadingTransactions = true)
        viewModelScope.launch {
            when (val result = repository.transactions(id, null, null)) {
                is ApiResult.Success -> _state.value = _state.value.copy(transactions = result.data, isLoadingTransactions = false)
                else -> _state.value = _state.value.copy(isLoadingTransactions = false)
            }
        }
    }
}

private fun String.filterDecimal() = filter { it.isDigit() || it == '.' }.ifBlank { "0" }
private fun String.filterSignedDecimal(): String {
    val negative = trimStart().startsWith('-')
    val numeric = filter { it.isDigit() || it == '.' }
    return when {
        numeric.isBlank() && negative -> "-"
        numeric.isBlank() -> "0"
        negative -> "-$numeric"
        else -> numeric
    }
}
