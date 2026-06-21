package com.inventory.ui.vouchers

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.remote.dto.CreateVoucherRequest
import com.inventory.data.repository.CustomerRepository
import com.inventory.data.repository.VoucherRepository
import com.inventory.domain.model.Customer
import com.inventory.domain.model.Voucher
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.LocalDate
import javax.inject.Inject

data class VoucherFormState(
    val isLoading: Boolean = false,
    val error: String? = null,
    val success: Boolean = false,
    val customers: List<Customer> = emptyList(),
    val customerQuery: String = "",
    val selectedCustomerId: String = "",
    val amount: String = "",
    val type: String = "RECEIPT",
    val date: String = LocalDate.now().toString(),
    val notes: String = "",
    val description: String = "",
    val editingVoucherId: String? = null,
    val voucherNumber: String = "",
    val editLoaded: Boolean = false
) {
    val isExpense: Boolean get() = type == "EXPENSE"
    val selectedCustomer: Customer? get() = customers.firstOrNull { it.id == selectedCustomerId }
    val customerSuggestions: List<Customer>
        get() = if (isExpense || selectedCustomer != null || customerQuery.isBlank()) {
            emptyList()
        } else {
            customers
                .filter { it.name.contains(customerQuery, true) || it.phone.contains(customerQuery) }
                .take(8)
        }
}

@HiltViewModel
class VoucherViewModel @Inject constructor(
    private val voucherRepository: VoucherRepository,
    private val customerRepository: CustomerRepository
) : ViewModel() {

    private val _state = MutableStateFlow(VoucherFormState())
    val state = _state.asStateFlow()

    init {
        viewModelScope.launch { customerRepository.customers.collect { list -> _state.value = _state.value.copy(customers = list) } }
        viewModelScope.launch { customerRepository.refreshCustomers() }
    }

    fun onEvent(event: VoucherEvent) {
        when (event) {
            is VoucherEvent.CustomerQueryChanged -> _state.value = _state.value.copy(
                customerQuery = event.query,
                selectedCustomerId = "",
                error = null
            )
            is VoucherEvent.CustomerChanged -> {
                val customer = _state.value.customers.firstOrNull { it.id == event.id }
                _state.value = _state.value.copy(
                    selectedCustomerId = event.id,
                    customerQuery = customer?.name.orEmpty(),
                    error = null
                )
            }
            is VoucherEvent.AmountChanged -> _state.value = _state.value.copy(amount = event.amount.decimal(), error = null)
            is VoucherEvent.TypeChanged -> _state.value = _state.value.copy(
                type = event.type,
                selectedCustomerId = if (event.type == "EXPENSE") "" else _state.value.selectedCustomerId,
                customerQuery = if (event.type == "EXPENSE") "" else _state.value.customerQuery,
                error = null
            )
            is VoucherEvent.DateChanged -> _state.value = _state.value.copy(date = event.date, error = null)
            is VoucherEvent.NotesChanged -> _state.value = _state.value.copy(notes = event.notes, error = null)
            is VoucherEvent.DescriptionChanged -> _state.value = _state.value.copy(description = event.description, error = null)
            is VoucherEvent.Submit -> submitVoucher()
            is VoucherEvent.DismissError -> _state.value = _state.value.copy(error = null)
            is VoucherEvent.DismissSuccess -> _state.value = _state.value.copy(success = false)
        }
    }

    fun loadVoucher(voucherId: String) {
        if (_state.value.editLoaded && _state.value.editingVoucherId == voucherId) return
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true, editingVoucherId = voucherId)
            voucherRepository.getVoucher(voucherId).onSuccess { voucher ->
                val customerName = _state.value.customers.firstOrNull { it.id == voucher.customerId }?.name.orEmpty()
                _state.value = _state.value.copy(
                    isLoading = false,
                    error = null,
                    editLoaded = true,
                    editingVoucherId = voucher.id,
                    voucherNumber = voucher.voucherNumber,
                    selectedCustomerId = voucher.customerId.orEmpty(),
                    customerQuery = customerName,
                    amount = voucher.amount.cleanAmount(),
                    type = voucher.type,
                    date = voucher.date.take(10),
                    notes = voucher.notes.orEmpty(),
                    description = voucher.description.orEmpty()
                )
            }.onFailure {
                _state.value = _state.value.copy(isLoading = false, error = it.message ?: "تعذر تحميل السند")
            }
        }
    }

    private fun submitVoucher() {
        val s = _state.value
        val amountDouble = s.amount.toDoubleOrNull()
        val error = when {
            !s.isExpense && s.selectedCustomerId.isBlank() -> "اختر الزبون"
            s.isExpense && s.description.isBlank() -> "اكتب وصف المصروف"
            amountDouble == null || amountDouble <= 0 -> "المبلغ غير صحيح"
            s.date.isBlank() -> "التاريخ مطلوب"
            else -> null
        }
        if (error != null) {
            _state.value = s.copy(error = error)
            return
        }

        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true, error = null)
            val request = CreateVoucherRequest(
                customerId = if (s.isExpense) null else s.selectedCustomerId,
                amount = amountDouble!!,
                type = s.type,
                date = s.date,
                notes = s.notes.takeIf { it.isNotBlank() },
                description = s.description.takeIf { it.isNotBlank() }
            )
            val result = s.editingVoucherId?.let { voucherRepository.updateVoucher(it, request).map { } }
                ?: voucherRepository.createVoucher(request)
            result.onSuccess {
                customerRepository.refreshCustomers()
                _state.value = _state.value.copy(
                    isLoading = false,
                    success = true,
                    amount = "",
                    notes = "",
                    description = "",
                    customerQuery = "",
                    selectedCustomerId = "",
                    date = LocalDate.now().toString()
                )
            }.onFailure {
                _state.value = _state.value.copy(isLoading = false, error = it.message ?: "تعذر حفظ السند")
            }
        }
    }
}

sealed class VoucherEvent {
    data class CustomerQueryChanged(val query: String) : VoucherEvent()
    data class CustomerChanged(val id: String) : VoucherEvent()
    data class AmountChanged(val amount: String) : VoucherEvent()
    data class DateChanged(val date: String) : VoucherEvent()
    data class TypeChanged(val type: String) : VoucherEvent()
    data class NotesChanged(val notes: String) : VoucherEvent()
    data class DescriptionChanged(val description: String) : VoucherEvent()
    object Submit : VoucherEvent()
    object DismissError : VoucherEvent()
    object DismissSuccess : VoucherEvent()
}

data class VoucherListState(
    val isLoading: Boolean = false,
    val vouchers: List<Voucher> = emptyList(),
    val error: String? = null,
    val typeFilter: String? = null,
    val deleteConfirmId: String? = null,
    val deleteLoading: Boolean = false,
)

@HiltViewModel
class VoucherListViewModel @Inject constructor(
    private val voucherRepository: VoucherRepository,
    private val customerRepository: CustomerRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(VoucherListState())
    val state = _state.asStateFlow()

    init { load() }

    fun load(type: String? = _state.value.typeFilter) {
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true, error = null, typeFilter = type)
            voucherRepository.listVouchers(type = type).onSuccess { list ->
                _state.value = _state.value.copy(isLoading = false, vouchers = list)
            }.onFailure {
                _state.value = _state.value.copy(isLoading = false, error = it.message ?: "تعذر تحميل السندات")
            }
        }
    }

    fun confirmDelete(id: String) {
        _state.value = _state.value.copy(deleteConfirmId = id)
    }

    fun cancelDelete() {
        _state.value = _state.value.copy(deleteConfirmId = null)
    }

    fun executeDelete() {
        val id = _state.value.deleteConfirmId ?: return
        viewModelScope.launch {
            _state.value = _state.value.copy(deleteLoading = true)
            voucherRepository.deleteVoucher(id).onSuccess {
                customerRepository.refreshCustomers()
                _state.value = _state.value.copy(
                    deleteLoading = false,
                    deleteConfirmId = null,
                    vouchers = _state.value.vouchers.filter { it.id != id }
                )
            }.onFailure {
                _state.value = _state.value.copy(
                    deleteLoading = false,
                    error = it.message ?: "تعذر حذف السند",
                    deleteConfirmId = null
                )
            }
        }
    }
}

private fun String.decimal() = filter { it.isDigit() || it == '.' }.ifBlank { "" }

private fun Double.cleanAmount(): String {
    return if (this % 1.0 == 0.0) toLong().toString() else toString()
}
