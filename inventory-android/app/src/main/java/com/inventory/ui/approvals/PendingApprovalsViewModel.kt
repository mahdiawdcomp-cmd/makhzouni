package com.inventory.ui.approvals

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.repository.ApprovalRepository
import com.inventory.domain.model.Approval
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class PendingApprovalsViewModel @Inject constructor(
    private val approvalRepository: ApprovalRepository
) : ViewModel() {
    val approvals: StateFlow<List<Approval>> = approvalRepository.pending.stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(5_000),
        emptyList()
    )

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            approvalRepository.refreshPending()
        }
    }

    fun approve(id: String) {
        viewModelScope.launch {
            approvalRepository.approve(id)
            refresh()
        }
    }

    fun reject(id: String) {
        viewModelScope.launch {
            approvalRepository.reject(id)
            refresh()
        }
    }
}
