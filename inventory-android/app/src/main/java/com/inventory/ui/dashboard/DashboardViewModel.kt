package com.inventory.ui.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.repository.ApprovalRepository
import com.inventory.data.repository.ReportRepository
import com.inventory.data.repository.SessionManager
import com.inventory.data.repository.NotificationRepository
import com.inventory.data.remote.ApiResult
import com.inventory.domain.model.DashboardReport
import com.inventory.utils.PermissionManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class DashboardUiState(
    val role: String? = null,
    val canManageUsers: Boolean = false,
    val canApprove: Boolean = false,
    val pendingApprovalCount: Int = 0,
    val unreadNotifications: Int = 0,
    val report: DashboardReport? = null
)

@HiltViewModel
class DashboardViewModel @Inject constructor(
    sessionManager: SessionManager,
    permissionManager: PermissionManager,
    approvalRepository: ApprovalRepository,
    notificationRepository: NotificationRepository,
    private val reportRepository: ReportRepository
) : ViewModel() {
    private val report = kotlinx.coroutines.flow.MutableStateFlow<DashboardReport?>(null)

    val uiState: StateFlow<DashboardUiState> = combine(
        sessionManager.role,
        approvalRepository.pending,
        notificationRepository.observeUnreadCount(),
        report
    ) { role, approvals, unreadCount, dashboardReport ->
        DashboardUiState(
            role = role,
            canManageUsers = permissionManager.canEditDirectly(role),
            canApprove = permissionManager.canApprove(role),
            pendingApprovalCount = approvals.size,
            unreadNotifications = unreadCount,
            report = dashboardReport
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), DashboardUiState())

    init {
        viewModelScope.launch {
            approvalRepository.refreshPending()
        }
        viewModelScope.launch {
            when (val result = reportRepository.dashboard()) {
                is ApiResult.Success -> report.value = result.data
                else -> Unit
            }
        }
    }
}
