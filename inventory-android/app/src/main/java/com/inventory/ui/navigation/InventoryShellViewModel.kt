package com.inventory.ui.navigation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.local.NotificationDao
import com.inventory.data.remote.NetworkMonitor
import com.inventory.data.repository.ApprovalRepository
import com.inventory.data.repository.SessionManager
import com.inventory.utils.PermissionManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

data class ShellUiState(
    val isOnline: Boolean = true,
    val unreadNotifications: Int = 0,
    val pendingApprovals: Int = 0,
    val isAdmin: Boolean = false
)

@HiltViewModel
class InventoryShellViewModel @Inject constructor(
    networkMonitor: NetworkMonitor,
    notificationDao: NotificationDao,
    approvalRepository: ApprovalRepository,
    sessionManager: SessionManager,
    permissionManager: PermissionManager
) : ViewModel() {
    val state: StateFlow<ShellUiState> = combine(
        networkMonitor.observeOnline(),
        notificationDao.observeUnreadCount(),
        approvalRepository.pending,
        sessionManager.role
    ) { online, unread, approvals, role ->
        ShellUiState(
            isOnline = online,
            unreadNotifications = unread,
            pendingApprovals = approvals.size,
            isAdmin = permissionManager.canApprove(role)
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ShellUiState())
}
