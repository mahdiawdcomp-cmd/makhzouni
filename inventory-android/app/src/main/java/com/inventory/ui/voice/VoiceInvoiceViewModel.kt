package com.inventory.ui.voice

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.remote.ApiClient
import com.inventory.data.remote.dto.VoiceCommandRequest
import com.inventory.data.remote.dto.VoiceExecuteRequest
import com.inventory.data.remote.dto.VoicePlanDto
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

    /** Plan resolved — waiting for user to tap تأكيد */
    data class NeedsConfirmation(
        val plan: VoicePlanDto,
        val confirmText: String,
    ) : VoiceUiState

    /** Info missing — auto re-listen with this question */
    data class NeedsClarification(val question: String) : VoiceUiState

    /** General Q&A answer from AI */
    data class GeneralAnswer(val text: String) : VoiceUiState

    /** Calling /execute after confirmation */
    data object Executing : VoiceUiState

    data class Success(
        val isVoucher: Boolean        = false,
        val invoiceId: String         = "",
        val invoiceNumber: String     = "",
        val voucherNumber: String     = "",
        val customerName: String      = "",
        val productName: String       = "",
        val quantity: Int             = 0,
        val unit: String              = "PIECE",
        val totalAmount: Double       = 0.0,
        val paymentType: String       = "CASH",
        val voucherType: String       = "RECEIPT",
        val amount: Double            = 0.0,
    ) : VoiceUiState

    data class Error(val message: String) : VoiceUiState
}

// ── ViewModel ─────────────────────────────────────────────────────────────────

@HiltViewModel
class VoiceInvoiceViewModel @Inject constructor(
    private val apiClient: ApiClient,
) : ViewModel() {

    private val _uiState = MutableStateFlow<VoiceUiState>(VoiceUiState.Idle)
    val uiState: StateFlow<VoiceUiState> = _uiState.asStateFlow()

    fun setListening() { _uiState.value = VoiceUiState.Listening }
    fun resetToIdle()  { _uiState.value = VoiceUiState.Idle }

    // ── Step 1: parse text → confirm / clarify / answer ───────────────────────
    fun parseCommand(text: String) {
        viewModelScope.launch {
            _uiState.value = VoiceUiState.Loading
            try {
                val response = apiClient.api.parseVoiceCommand(VoiceCommandRequest(text))
                val body = response.body()

                if (!response.isSuccessful || body == null) {
                    _uiState.value = VoiceUiState.Error("خطأ ${response.code()} من السيرفر")
                    return@launch
                }

                when (body.type) {
                    "confirm" -> {
                        val plan = body.plan
                        val confirmText = body.confirmText
                        if (plan != null && confirmText != null) {
                            _uiState.value = VoiceUiState.NeedsConfirmation(plan, confirmText)
                        } else {
                            _uiState.value = VoiceUiState.Error("بيانات التأكيد ناقصة")
                        }
                    }
                    "clarify" -> _uiState.value = VoiceUiState.NeedsClarification(
                        body.question ?: "وضّح طلبك"
                    )
                    "answer" -> _uiState.value = VoiceUiState.GeneralAnswer(
                        body.text ?: "لم أجد جواباً"
                    )
                    else -> _uiState.value = VoiceUiState.Error("جواب غير متوقع من السيرفر")
                }
            } catch (e: Exception) {
                _uiState.value = VoiceUiState.Error(e.message ?: "تعذر الاتصال بالسيرفر")
            }
        }
    }

    // ── Step 2: execute confirmed plan ────────────────────────────────────────
    fun confirmExecution(plan: VoicePlanDto) {
        viewModelScope.launch {
            _uiState.value = VoiceUiState.Executing
            try {
                val response = apiClient.api.executeVoiceCommand(VoiceExecuteRequest(plan))
                val body = response.body()

                if (!response.isSuccessful || body == null) {
                    _uiState.value = VoiceUiState.Error("فشل التنفيذ — كود ${response.code()}")
                    return@launch
                }

                val inv = body.invoice
                val vou = body.voucher

                when {
                    inv != null -> _uiState.value = VoiceUiState.Success(
                        isVoucher     = false,
                        invoiceId     = inv.id,
                        invoiceNumber = inv.invoiceNumber,
                        customerName  = inv.customerName,
                        productName   = inv.productName,
                        quantity      = inv.quantity,
                        unit          = inv.unit,
                        totalAmount   = inv.totalAmount,
                        paymentType   = inv.paymentType,
                    )
                    vou != null -> _uiState.value = VoiceUiState.Success(
                        isVoucher     = true,
                        voucherNumber = vou.voucherNumber,
                        customerName  = vou.customerName,
                        amount        = vou.amount,
                        voucherType   = vou.type,
                    )
                    else -> _uiState.value = VoiceUiState.Error(body.message ?: "خطأ غير معروف")
                }
            } catch (e: Exception) {
                _uiState.value = VoiceUiState.Error(e.message ?: "تعذر الاتصال بالسيرفر")
            }
        }
    }
}
