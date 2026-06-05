package com.inventory.ui.navigation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.local.NotificationDao
import com.inventory.data.remote.NetworkMonitor
import com.inventory.data.repository.ApprovalRepository
import com.inventory.data.repository.SessionManager
import com.inventory.data.repository.SyncRepository
import com.inventory.utils.PermissionManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

data class ShellUiState(
    val isOnline: Boolean = true,
    val pendingSync: Int = 0,
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
    syncRepository: SyncRepository,
    permissionManager: PermissionManager
) : ViewModel() {
    private val connectionState = combine(
        networkMonitor.observeOnline(),
        syncRepository.pendingCount
    ) { online, pendingSync -> online to pendingSync }

    val state: StateFlow<ShellUiState> = combine(
        connectionState,
        notificationDao.observeUnreadCount(),
        approvalRepository.pending,
        sessionManager.role,
        sessionManager.permissions
    ) { connection, unread, approvals, role, permissions ->
        ShellUiState(
            isOnline = connection.first,
            pendingSync = connection.second,
            unreadNotifications = unread,
            pendingApprovals = approvals.size,
            isAdmin = permissionManager.canManageApprovals(role, permissions)
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ShellUiState())
}
