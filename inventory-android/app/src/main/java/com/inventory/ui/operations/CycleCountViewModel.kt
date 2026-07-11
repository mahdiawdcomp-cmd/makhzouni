package com.inventory.ui.operations

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.remote.ApiResult
import com.inventory.data.remote.dto.CycleCountSessionDetailDto
import com.inventory.data.remote.dto.CycleCountSessionDto
import com.inventory.data.repository.CycleCountRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * "جدولة الجرد الذكي" admin state — a single VM drives both the sessions list
 * and the currently-opened session detail (selectedId != null). Mirrors the web
 * CycleCountPage: list → open a session → count items → submit → approve/reject.
 */
data class CycleCountUiState(
    val isLoading: Boolean = false,
    val sessions: List<CycleCountSessionDto> = emptyList(),
    val selected: CycleCountSessionDetailDto? = null,
    val detailLoading: Boolean = false,
    val busy: Boolean = false,
    val error: String? = null,
    val message: String? = null,
)

@HiltViewModel
class CycleCountViewModel @Inject constructor(
    private val repository: CycleCountRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(CycleCountUiState())
    val uiState: StateFlow<CycleCountUiState> = _uiState.asStateFlow()

    init {
        loadSessions()
    }

    fun loadSessions() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            when (val result = repository.listSessions()) {
                is ApiResult.Success -> _uiState.update { it.copy(isLoading = false, sessions = result.data) }
                is ApiResult.Error   -> _uiState.update { it.copy(isLoading = false, error = result.message) }
                is ApiResult.Offline -> _uiState.update { it.copy(isLoading = false, error = OFFLINE) }
                else                 -> _uiState.update { it.copy(isLoading = false) }
            }
        }
    }

    fun openSession(id: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(detailLoading = true, error = null) }
            when (val result = repository.getSession(id)) {
                is ApiResult.Success -> _uiState.update { it.copy(detailLoading = false, selected = result.data) }
                is ApiResult.Error   -> _uiState.update { it.copy(detailLoading = false, error = result.message) }
                is ApiResult.Offline -> _uiState.update { it.copy(detailLoading = false, error = OFFLINE) }
                else                 -> _uiState.update { it.copy(detailLoading = false) }
            }
        }
    }

    fun closeDetail() = _uiState.update { it.copy(selected = null) }

    private fun refreshSelected() {
        _uiState.value.selected?.id?.let { openSession(it) }
    }

    fun createSession(warehouseId: String?, strategy: String, itemLimit: Int, notes: String?) {
        runAction("تم إنشاء الجلسة") {
            repository.createSession(warehouseId, strategy, itemLimit, notes)
        }
    }

    fun setItemQty(productId: String, actualQty: Int) {
        val sessionId = _uiState.value.selected?.id ?: return
        runAction(null, refreshList = false) { repository.updateItem(sessionId, productId, actualQty) }
    }

    fun submit() = withSession { runAction("تم إرسال الجرد للمراجعة") { repository.submit(it) } }
    fun close() = withSession { runAction("تم إغلاق الجلسة") { repository.close(it) } }
    fun cancel() = withSession { runAction("تم إلغاء الجلسة") { repository.cancel(it) } }
    fun reopen() = withSession { runAction("تمت إعادة فتح الجلسة") { repository.reopen(it) } }
    fun approveItem(itemId: String) = withSession { runAction(null) { repository.approveItem(it, itemId) } }
    fun rejectItem(itemId: String) = withSession { runAction(null) { repository.rejectItem(it, itemId) } }
    fun approveAll() = withSession { runAction("تمت الموافقة على الفروقات") { repository.approveAll(it) } }
    fun rejectAll() = withSession { runAction("تم رفض الفروقات") { repository.rejectAll(it) } }

    fun clearMessage() = _uiState.update { it.copy(error = null, message = null) }

    private inline fun withSession(block: (String) -> Unit) {
        _uiState.value.selected?.id?.let(block)
    }

    /**
     * Runs a mutating call, then refreshes the open session detail (and the list
     * unless refreshList=false). A null successMessage stays silent (used for
     * per-item edits/approvals where a toast per tap would be noisy).
     */
    private fun runAction(
        successMessage: String?,
        refreshList: Boolean = true,
        block: suspend () -> ApiResult<*>,
    ) {
        viewModelScope.launch {
            _uiState.update { it.copy(busy = true, error = null) }
            when (val result = block()) {
                is ApiResult.Success -> {
                    _uiState.update { it.copy(busy = false, message = successMessage) }
                    refreshSelected()
                    if (refreshList) loadSessions()
                }
                is ApiResult.Error   -> _uiState.update { it.copy(busy = false, error = result.message) }
                is ApiResult.Offline -> _uiState.update { it.copy(busy = false, error = OFFLINE) }
                else                 -> _uiState.update { it.copy(busy = false) }
            }
        }
    }

    companion object {
        private const val OFFLINE = "لا يوجد اتصال بالإنترنت"
    }
}
