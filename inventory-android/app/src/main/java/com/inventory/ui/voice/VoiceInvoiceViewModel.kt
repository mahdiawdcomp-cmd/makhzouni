package com.inventory.ui.voice

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.remote.ApiClient
import com.inventory.data.remote.dto.VoiceCommandRequest
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

// ── UI State ──────────────────────────────────────────────────────────────────

sealed interface VoiceUiState {
    data object Idle : VoiceUiState
    data object Listening : VoiceUiState
    data object Loading : VoiceUiState
    data class Success(
        val invoiceNumber: String,
        val invoiceId: String,
        val customerName: String,
        val productName: String,
        val quantity: Int,
        val unit: String,
        val totalAmount: Double,
        val paymentType: String,
    ) : VoiceUiState
    data class NeedsClarification(val question: String) : VoiceUiState
    data class Error(val message: String) : VoiceUiState
}

// ── ViewModel ─────────────────────────────────────────────────────────────────

@HiltViewModel
class VoiceInvoiceViewModel @Inject constructor(
    private val apiClient: ApiClient,
) : ViewModel() {

    private val _uiState = MutableStateFlow<VoiceUiState>(VoiceUiState.Idle)
    val uiState: StateFlow<VoiceUiState> = _uiState.asStateFlow()

    fun setListening() {
        _uiState.value = VoiceUiState.Listening
    }

    fun resetToIdle() {
        _uiState.value = VoiceUiState.Idle
    }

    fun processCommand(text: String) {
        viewModelScope.launch {
            _uiState.value = VoiceUiState.Loading
            try {
                val response = apiClient.api.processVoiceInvoice(
                    VoiceCommandRequest(command = text)
                )

                val body = response.body()

                if (!response.isSuccessful || body == null) {
                    _uiState.value = VoiceUiState.Error(
                        "حصل خطأ في الاتصال — كود ${response.code()}"
                    )
                    return@launch
                }

                // النظام يحتاج توضيح
                if (body.clarify != null) {
                    _uiState.value = VoiceUiState.NeedsClarification(body.clarify)
                    return@launch
                }

                // تم إنشاء الفاتورة
                val inv = body.invoice
                if (body.success == true && inv != null) {
                    _uiState.value = VoiceUiState.Success(
                        invoiceNumber = inv.invoiceNumber,
                        invoiceId     = inv.id,
                        customerName  = inv.customerName,
                        productName   = inv.productName,
                        quantity      = inv.quantity,
                        unit          = inv.unit,
                        totalAmount   = inv.totalAmount,
                        paymentType   = inv.paymentType,
                    )
                    return@launch
                }

                _uiState.value = VoiceUiState.Error(body.message ?: "خطأ غير معروف")

            } catch (e: Exception) {
                _uiState.value = VoiceUiState.Error(e.message ?: "تعذر الاتصال بالسيرفر")
            }
        }
    }
}
