package com.inventory.ui.voice

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.remote.ApiClient
import com.inventory.data.remote.dto.VoiceChatMessage
import com.inventory.data.remote.dto.VoiceCommandRequest
import com.inventory.data.remote.dto.VoiceExecuteRequest
import com.inventory.data.remote.dto.VoiceDraftDto
import com.inventory.data.remote.dto.VoicePlanDto
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed interface VoiceUiState {
    data object Idle : VoiceUiState
    data object Listening : VoiceUiState
    data object Loading : VoiceUiState
    data class NeedsConfirmation(
        val plan: VoicePlanDto,
        val confirmText: String,
    ) : VoiceUiState
    data class NeedsClarification(
        val question: String,
        val suggestions: List<String> = emptyList(),
    ) : VoiceUiState
    data class GeneralAnswer(val text: String) : VoiceUiState
    data object Executing : VoiceUiState
    data class Success(
        val isVoucher: Boolean = false,
        val invoiceId: String = "",
        val invoiceNumber: String = "",
        val voucherNumber: String = "",
        val customerName: String = "",
        val productName: String = "",
        val quantity: Int = 0,
        val unit: String = "PIECE",
        val totalAmount: Double = 0.0,
        val paymentType: String = "CASH",
        val voucherType: String = "RECEIPT",
        val amount: Double = 0.0,
    ) : VoiceUiState
    data class Error(val message: String) : VoiceUiState
}

@HiltViewModel
class VoiceInvoiceViewModel @Inject constructor(
    private val apiClient: ApiClient,
) : ViewModel() {
    private val _uiState = MutableStateFlow<VoiceUiState>(VoiceUiState.Idle)
    val uiState: StateFlow<VoiceUiState> = _uiState.asStateFlow()

    private val _conversation = MutableStateFlow<List<VoiceChatMessage>>(emptyList())
    val conversation: StateFlow<List<VoiceChatMessage>> = _conversation.asStateFlow()
    private var currentDraft: VoiceDraftDto? = null

    fun setListening() {
        _uiState.value = VoiceUiState.Listening
    }

    fun resetToIdle() {
        _uiState.value = VoiceUiState.Idle
    }

    fun clearConversation() {
        _conversation.value = emptyList()
        currentDraft = null
        _uiState.value = VoiceUiState.Idle
    }

    private fun appendMessage(role: String, content: String) {
        if (content.isBlank()) return
        _conversation.value = (_conversation.value + VoiceChatMessage(role, content)).takeLast(12)
    }

    fun parseCommand(text: String) {
        viewModelScope.launch {
            val cleanText = text.trim()
            if (cleanText.isBlank()) return@launch

            val historyBeforeMessage = _conversation.value
            appendMessage("user", cleanText)
            _uiState.value = VoiceUiState.Loading

            try {
                val response = apiClient.api.parseVoiceCommand(
                    VoiceCommandRequest(
                        command = cleanText,
                        history = historyBeforeMessage,
                        draft = currentDraft,
                    )
                )
                val body = response.body()
                if (!response.isSuccessful || body == null) {
                    _uiState.value = VoiceUiState.Error(
                        body?.text ?: "خطأ ${response.code()} من السيرفر"
                    )
                    return@launch
                }
                currentDraft = body.draft

                when (body.type) {
                    "confirm" -> {
                        val plan = body.plan
                        val confirmation = body.confirmText
                        if (plan != null && !confirmation.isNullOrBlank()) {
                            appendMessage("assistant", confirmation)
                            _uiState.value = VoiceUiState.NeedsConfirmation(plan, confirmation)
                        } else {
                            _uiState.value = VoiceUiState.Error("بيانات التأكيد ناقصة")
                        }
                    }
                    "clarify" -> {
                        val question = body.question ?: "وضّح طلبك أكثر"
                        appendMessage("assistant", question)
                        _uiState.value = VoiceUiState.NeedsClarification(
                            question = question,
                            suggestions = body.suggestions,
                        )
                    }
                    "answer" -> {
                        val answer = body.text ?: "ما لكيت جواب واضح"
                        if (body.resetConversation) {
                            _conversation.value = listOf(VoiceChatMessage("assistant", answer))
                            currentDraft = null
                        } else {
                            appendMessage("assistant", answer)
                        }
                        _uiState.value = VoiceUiState.GeneralAnswer(answer)
                    }
                    else -> _uiState.value = VoiceUiState.Error("جواب غير متوقع من السيرفر")
                }
            } catch (error: Exception) {
                _uiState.value = VoiceUiState.Error(
                    error.message ?: "تعذر الاتصال بالسيرفر"
                )
            }
        }
    }

    fun confirmExecution(plan: VoicePlanDto) {
        viewModelScope.launch {
            _uiState.value = VoiceUiState.Executing
            try {
                val response = apiClient.api.executeVoiceCommand(VoiceExecuteRequest(plan))
                val body = response.body()
                if (!response.isSuccessful || body == null) {
                    _uiState.value = VoiceUiState.Error(
                        body?.message ?: "فشل التنفيذ — كود ${response.code()}"
                    )
                    return@launch
                }

                val invoice = body.invoice
                val voucher = body.voucher
                _uiState.value = when {
                    invoice != null -> VoiceUiState.Success(
                        isVoucher = false,
                        invoiceId = invoice.id,
                        invoiceNumber = invoice.invoiceNumber,
                        customerName = invoice.customerName,
                        productName = invoice.productName.ifBlank {
                            plan.items.joinToString("، ") { it.productName }
                        },
                        quantity = invoice.quantity.takeIf { it > 0 }
                            ?: plan.items.sumOf { it.quantity },
                        unit = invoice.unit.ifBlank {
                            plan.items.singleOrNull()?.unit ?: "PIECE"
                        },
                        totalAmount = invoice.totalAmount,
                        paymentType = invoice.paymentType,
                    )
                    voucher != null -> VoiceUiState.Success(
                        isVoucher = true,
                        voucherNumber = voucher.voucherNumber,
                        customerName = voucher.customerName,
                        amount = voucher.amount,
                        voucherType = voucher.type,
                    )
                    else -> VoiceUiState.Error(body.message ?: "خطأ غير معروف")
                }

                if (_uiState.value is VoiceUiState.Success) {
                    appendMessage("assistant", body.message ?: "تم تنفيذ العملية بنجاح")
                }
            } catch (error: Exception) {
                _uiState.value = VoiceUiState.Error(
                    error.message ?: "تعذر الاتصال بالسيرفر"
                )
            }
        }
    }
}
