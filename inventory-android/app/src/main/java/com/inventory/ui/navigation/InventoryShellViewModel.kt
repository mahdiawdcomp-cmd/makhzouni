package com.inventory.ui.navigation

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.local.NotificationDao
import com.inventory.data.remote.NetworkMonitor
import com.inventory.data.repository.ApprovalRepository
import com.inventory.data.repository.SessionManager
import com.inventory.data.repository.SyncRepository
import com.inventory.utils.PermissionManager
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ShellUiState(
    val isOnline: Boolean = true,
    val pendingSync: Int = 0,
    val unreadNotifications: Int = 0,
    val pendingApprovals: Int = 0,
    val isAdmin: Boolean = false,
    val permissions: List<String> = emptyList()
)

@HiltViewModel
class InventoryShellViewModel @Inject constructor(
    private val networkMonitor: NetworkMonitor,
    notificationDao: NotificationDao,
    approvalRepository: ApprovalRepository,
    sessionManager: SessionManager,
    syncRepository: SyncRepository,
    permissionManager: PermissionManager,
    @ApplicationContext private val context: Context
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
            isAdmin = permissionManager.canManageApprovals(role, permissions),
            permissions = permissions
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ShellUiState())

    init {
        // When network is restored, flush any pending offline operations immediately.
        viewModelScope.launch {
            networkMonitor.observeOnline()
                .distinctUntilChanged()
                .drop(1) // skip the initial emission
                .filter { it } // only when going online
                .collect { SyncRepository.scheduleOnReconnect(context) }
        }
    }
}
