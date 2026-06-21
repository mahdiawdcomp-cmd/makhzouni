package com.inventory.ui.invoices

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.remote.ApiResult
import com.inventory.data.repository.InvoiceRepository
import com.inventory.domain.model.Invoice
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class InvoiceDetailUiState(
    val invoice: Invoice? = null,
    val isLoading: Boolean = false,
    val isActionLoading: Boolean = false,
    val error: String? = null,
    val message: String? = null
)

@HiltViewModel
class InvoiceDetailViewModel @Inject constructor(
    private val repository: InvoiceRepository
) : ViewModel() {
    private val _state = MutableStateFlow(InvoiceDetailUiState())
    val state = _state.asStateFlow()

    fun loadInvoice(invoiceId: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true, error = null, message = null)
            when (val result = repository.getInvoice(invoiceId)) {
                is ApiResult.Success -> _state.value = _state.value.copy(invoice = result.data, isLoading = false)
                is ApiResult.Error -> _state.value = _state.value.copy(isLoading = false, error = result.message)
                ApiResult.Offline -> _state.value = _state.value.copy(isLoading = false, error = "لا يوجد اتصال")
                else -> _state.value = _state.value.copy(isLoading = false)
            }
        }
    }

    fun cancelInvoice() {
        val id = _state.value.invoice?.id ?: return
        viewModelScope.launch {
            _state.value = _state.value.copy(isActionLoading = true, error = null, message = null)
            when (val result = repository.cancelInvoice(id)) {
                is ApiResult.Success -> _state.value = _state.value.copy(
                    invoice = result.data,
                    isActionLoading = false,
                    message = "تم إلغاء الفاتورة وتحديث الحساب والمخزون"
                )
                is ApiResult.Error -> _state.value = _state.value.copy(isActionLoading = false, error = result.message)
                ApiResult.Offline -> _state.value = _state.value.copy(isActionLoading = false, error = "لا يوجد اتصال")
                else -> _state.value = _state.value.copy(isActionLoading = false)
            }
        }
    }

    fun reactivateInvoice() {
        val id = _state.value.invoice?.id ?: return
        viewModelScope.launch {
            _state.value = _state.value.copy(isActionLoading = true, error = null, message = null)
            when (val result = repository.reactivateInvoice(id)) {
                is ApiResult.Success -> _state.value = _state.value.copy(
                    invoice = result.data,
                    isActionLoading = false,
                    message = "تم إرجاع الفاتورة نشطة وتحديث الحساب والمخزون"
                )
                is ApiResult.Error -> _state.value = _state.value.copy(isActionLoading = false, error = result.message)
                ApiResult.Offline -> _state.value = _state.value.copy(isActionLoading = false, error = "لا يوجد اتصال")
                else -> _state.value = _state.value.copy(isActionLoading = false)
            }
        }
    }

    fun clearMessage() {
        _state.value = _state.value.copy(message = null, error = null)
    }
}
