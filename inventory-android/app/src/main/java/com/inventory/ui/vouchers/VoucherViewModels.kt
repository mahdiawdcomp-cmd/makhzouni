package com.inventory.ui.vouchers

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.remote.dto.CreateVoucherRequest
import com.inventory.data.repository.CustomerRepository
import com.inventory.data.repository.VoucherRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import javax.inject.Inject

data class VoucherFormState(
    val isLoading: Boolean = false,
    val error: String? = null,
    val success: Boolean = false,
    val customers: List<com.inventory.domain.model.Customer> = emptyList(),
    val selectedCustomerId: String = "",
    val amount: String = "",
    val type: String = "RECEIPT",
    val notes: String = "",
    val description: String = ""   // for EXPENSE vouchers
) {
    val isExpense: Boolean get() = type == "EXPENSE"
}

@HiltViewModel
class VoucherViewModel @Inject constructor(
    private val voucherRepository: VoucherRepository,
    private val customerRepository: CustomerRepository
) : ViewModel() {

    private val _state = MutableStateFlow(VoucherFormState())
    val state = _state.asStateFlow()

    init {
        loadCustomers()
    }

    private fun loadCustomers() {
        viewModelScope.launch {
            customerRepository.customers.collect { list ->
                _state.value = _state.value.copy(customers = list)
            }
        }
    }

    fun onEvent(event: VoucherEvent) {
        when (event) {
            is VoucherEvent.CustomerChanged -> _state.value = _state.value.copy(selectedCustomerId = event.id, error = null)
            is VoucherEvent.AmountChanged -> _state.value = _state.value.copy(amount = event.amount, error = null)
            is VoucherEvent.TypeChanged -> _state.value = _state.value.copy(type = event.type, error = null)
            is VoucherEvent.NotesChanged -> _state.value = _state.value.copy(notes = event.notes, error = null)
            is VoucherEvent.DescriptionChanged -> _state.value = _state.value.copy(description = event.description, error = null)
            is VoucherEvent.Submit -> submitVoucher()
            is VoucherEvent.DismissError -> _state.value = _state.value.copy(error = null)
            is VoucherEvent.DismissSuccess -> _state.value = _state.value.copy(success = false)
        }
    }

    private fun submitVoucher() {
        val s = _state.value
        val amountDouble = s.amount.toDoubleOrNull()

        // Validation
        if (!s.isExpense && s.selectedCustomerId.isBlank()) {
            _state.value = s.copy(error = "يجب اختيار الزبون")
            return
        }
        if (s.isExpense && s.description.isBlank()) {
            _state.value = s.copy(error = "يجب إدخال وصف للمصروف")
            return
        }
        if (amountDouble == null || amountDouble <= 0) {
            _state.value = s.copy(error = "المبلغ غير صحيح")
            return
        }

        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true, error = null)
            val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US)
            val request = CreateVoucherRequest(
                customerId = if (s.isExpense) null else s.selectedCustomerId,
                amount = amountDouble,
                type = s.type,
                date = sdf.format(Date()),
                notes = s.notes.takeIf { it.isNotBlank() },
                description = s.description.takeIf { it.isNotBlank() }
            )
            val result = voucherRepository.createVoucher(request)
            result.onSuccess {
                _state.value = _state.value.copy(
                    isLoading = false,
                    success = true,
                    amount = "",
                    notes = "",
                    description = "",
                    selectedCustomerId = ""
                )
            }.onFailure {
                _state.value = _state.value.copy(isLoading = false, error = it.message)
            }
        }
    }
}

sealed class VoucherEvent {
    data class CustomerChanged(val id: String) : VoucherEvent()
    data class AmountChanged(val amount: String) : VoucherEvent()
    data class TypeChanged(val type: String) : VoucherEvent()
    data class NotesChanged(val notes: String) : VoucherEvent()
    data class DescriptionChanged(val description: String) : VoucherEvent()
    object Submit : VoucherEvent()
    object DismissError : VoucherEvent()
    object DismissSuccess : VoucherEvent()
}
