package com.inventory.ui.navigation

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.local.NotificationDao
import com.inventory.data.remote.NetworkMonitor
import com.inventory.data.repository.ApprovalRepository
import com.inventory.data.repository.RealtimeSyncRepository
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
    val permissions: List<String> = emptyList(),
    val readOnly: Boolean = false,
    val tenantFeatures: List<String> = emptyList(),
    val blockedSyncCount: Int = 0,
    val blockedSyncReason: String? = null
)

@HiltViewModel
class InventoryShellViewModel @Inject constructor(
    private val networkMonitor: NetworkMonitor,
    notificationDao: NotificationDao,
    approvalRepository: ApprovalRepository,
    sessionManager: SessionManager,
    syncRepository: SyncRepository,
    realtimeSyncRepository: RealtimeSyncRepository,
    permissionManager: PermissionManager,
    @ApplicationContext private val context: Context
) : ViewModel() {
    private val connectionState = combine(
        networkMonitor.observeOnline(),
        syncRepository.pendingCount
    ) { online, pendingSync -> online to pendingSync }

    private data class RoleState(val role: String?, val permissions: List<String>)
    private val roleState = combine(
        sessionManager.role,
        sessionManager.permissions
    ) { role, permissions -> RoleState(role, permissions) }

    // Entitlement + blocked-sync flows grouped so the final combine stays ≤5 args.
    private data class EntitlementState(
        val readOnly: Boolean,
        val features: List<String>,
        val blockedCount: Int,
        val blockedReason: String?,
    )
    private val entitlementState = combine(
        sessionManager.readOnly,
        sessionManager.tenantFeatures,
        syncRepository.blockedCount,
        syncRepository.blockedReasons
    ) { readOnly, features, blockedCount, blockedReasons ->
        EntitlementState(
            readOnly = readOnly,
            features = features,
            blockedCount = blockedCount,
            // Pick the first stored reason (raw code like READ_ONLY_MODE, or legacy
            // free text). The UI maps it to an Arabic sentence.
            blockedReason = blockedReasons.firstOrNull(),
        )
    }

    val state: StateFlow<ShellUiState> = combine(
        connectionState,
        notificationDao.observeUnreadCount(),
        approvalRepository.pending,
        roleState,
        entitlementState
    ) { connection, unread, approvals, roles, entitlement ->
        ShellUiState(
            isOnline = connection.first,
            pendingSync = connection.second,
            unreadNotifications = unread,
            pendingApprovals = approvals.size,
            isAdmin = permissionManager.canManageApprovals(roles.role, roles.permissions),
            permissions = roles.permissions,
            readOnly = entitlement.readOnly,
            tenantFeatures = entitlement.features,
            blockedSyncCount = entitlement.blockedCount,
            blockedSyncReason = entitlement.blockedReason
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ShellUiState())

    init {
        realtimeSyncRepository.start(viewModelScope)

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
