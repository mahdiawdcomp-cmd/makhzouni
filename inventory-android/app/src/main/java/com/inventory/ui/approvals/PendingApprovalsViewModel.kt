package com.inventory.ui.approvals

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.remote.ApiResult
import com.inventory.data.repository.ApprovalRepository
import com.inventory.domain.model.Approval
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class PendingApprovalsViewModel @Inject constructor(
    private val approvalRepository: ApprovalRepository
) : ViewModel() {
    private val _approvals = MutableStateFlow<List<Approval>>(emptyList())
    val approvals = _approvals.asStateFlow()

    private val _message = MutableStateFlow<String?>(null)
    val message = _message.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            when (val result = approvalRepository.refreshPending()) {
                is ApiResult.Success -> _approvals.value = result.data
                is ApiResult.Error -> _message.value = result.message
                is ApiResult.Offline -> _message.value = "أنت بدون إنترنت، آخر تحديث غير متاح"
            }
        }
    }

    fun approve(id: String, allowPrices: Boolean? = null, showStock: Boolean? = null) {
        viewModelScope.launch {
            try {
                approvalRepository.approve(id, allowPrices, showStock)
                _message.value = "تمت الموافقة"
                refresh()
            } catch (error: Exception) {
                _message.value = error.message ?: "تعذرت الموافقة"
            }
        }
    }

    fun reject(id: String) {
        viewModelScope.launch {
            try {
                approvalRepository.reject(id)
                _message.value = "تم الرفض"
                refresh()
            } catch (error: Exception) {
                _message.value = error.message ?: "تعذر الرفض"
            }
        }
    }

    fun clearMessage() {
        _message.value = null
    }
}
