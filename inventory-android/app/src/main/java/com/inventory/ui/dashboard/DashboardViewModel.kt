package com.inventory.ui.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.remote.ApiResult
import com.inventory.data.remote.dto.OrderPreparationDto
import com.inventory.data.repository.ApprovalRepository
import com.inventory.data.repository.CatalogRepository
import com.inventory.data.repository.NotificationRepository
import com.inventory.data.repository.ReportRepository
import com.inventory.data.repository.SessionManager
import com.inventory.domain.model.DashboardReport
import com.inventory.utils.PermissionManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class DashboardUiState(
    val role: String? = null,
    val permissions: List<String> = emptyList(),
    val canManageUsers: Boolean = false,
    val canApprove: Boolean = false,
    val canManageProducts: Boolean = false,
    val canManageCustomers: Boolean = false,
    val canManageInvoices: Boolean = false,
    val canManageVouchers: Boolean = false,
    val canViewReports: Boolean = false,
    val canManageSettings: Boolean = false,
    val pendingApprovalCount: Int = 0,
    val unreadNotifications: Int = 0,
    val report: DashboardReport? = null,
    val pendingOrders: List<OrderPreparationDto> = emptyList()
)

@HiltViewModel
class DashboardViewModel @Inject constructor(
    sessionManager: SessionManager,
    permissionManager: PermissionManager,
    approvalRepository: ApprovalRepository,
    notificationRepository: NotificationRepository,
    private val reportRepository: ReportRepository,
    private val catalogRepository: CatalogRepository
) : ViewModel() {
    private val report = MutableStateFlow<DashboardReport?>(null)
    private val pendingOrders = MutableStateFlow<List<OrderPreparationDto>>(emptyList())

    // Combine first 5 flows then zip with pendingOrders
    private val baseState = combine(
        sessionManager.role,
        sessionManager.permissions,
        approvalRepository.pending,
        notificationRepository.observeUnreadCount(),
        report
    ) { role, permissions, approvals, unreadCount, dashboardReport ->
        DashboardUiState(
            role = role,
            permissions = permissions,
            canManageUsers = permissionManager.canManageUsers(role, permissions),
            canApprove = permissionManager.canManageApprovals(role, permissions),
            canManageProducts = permissionManager.canManageProducts(role, permissions),
            canManageCustomers = permissionManager.canManageCustomers(role, permissions),
            canManageInvoices = permissionManager.canManageInvoices(role, permissions),
            canManageVouchers = permissionManager.canManageVouchers(role, permissions),
            canViewReports = permissionManager.canViewReports(role, permissions),
            canManageSettings = permissionManager.canManageSettings(role, permissions),
            pendingApprovalCount = approvals.size,
            unreadNotifications = unreadCount,
            report = dashboardReport
        )
    }

    val uiState: StateFlow<DashboardUiState> = combine(baseState, pendingOrders) { base, orders ->
        base.copy(pendingOrders = orders)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), DashboardUiState())

    init {
        viewModelScope.launch { approvalRepository.refreshPending() }
        viewModelScope.launch {
            when (val result = reportRepository.dashboard()) {
                is ApiResult.Success -> report.value = result.data
                else -> Unit
            }
        }
        loadOrderPreparations()
    }

    private fun loadOrderPreparations() {
        viewModelScope.launch {
            when (val result = catalogRepository.getOrderPreparations()) {
                is ApiResult.Success -> pendingOrders.value = result.data
                else -> Unit
            }
        }
    }

    fun markPrepared(id: String) {
        viewModelScope.launch {
            when (catalogRepository.markPrepared(id)) {
                is ApiResult.Success -> loadOrderPreparations()
                else -> Unit
            }
        }
    }
}
