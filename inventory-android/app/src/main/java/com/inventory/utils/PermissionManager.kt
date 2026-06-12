package com.inventory.utils

import com.inventory.data.repository.SessionManager
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class PermissionManager @Inject constructor(
    sessionManager: SessionManager
) {
    val currentRole: Flow<String?> = sessionManager.role
    val currentPermissions: Flow<List<String>> = sessionManager.permissions

    // ── Role helpers ───────────────────────────────────────────────────────────
    fun canApprove(role: String?) = role == "ADMIN"
    fun canEditDirectly(role: String?) = role == "ADMIN"
    fun mustRequestApproval(role: String?) = role == "STAFF"

    // ── Generic permission gate ────────────────────────────────────────────────
    // ADMIN bypasses all; STAFF needs the explicit permission in their list.
    fun hasPermission(role: String?, permissions: List<String>, permission: String) =
        role == "ADMIN" || permissions.contains(permission)

    // ── Granular permission checks (mirrors backend schema) ────────────────────
    fun canManageUsers(role: String?, permissions: List<String>) =
        hasPermission(role, permissions, "MANAGE_USERS")

    fun canManageApprovals(role: String?, permissions: List<String>) =
        hasPermission(role, permissions, "MANAGE_APPROVALS")

    fun canManageProducts(role: String?, permissions: List<String>) =
        hasPermission(role, permissions, "MANAGE_PRODUCTS")

    fun canManageCustomers(role: String?, permissions: List<String>) =
        hasPermission(role, permissions, "MANAGE_CUSTOMERS")

    fun canManageInvoices(role: String?, permissions: List<String>) =
        hasPermission(role, permissions, "MANAGE_INVOICES")

    fun canManageVouchers(role: String?, permissions: List<String>) =
        hasPermission(role, permissions, "MANAGE_VOUCHERS")

    fun canViewReports(role: String?, permissions: List<String>) =
        hasPermission(role, permissions, "VIEW_REPORTS")

    fun canManageSettings(role: String?, permissions: List<String>) =
        hasPermission(role, permissions, "MANAGE_SETTINGS")

    /** Staff who can see products but without showing purchase price or sale price. */
    fun viewWithoutPrices(role: String?, permissions: List<String>) =
        role != "ADMIN" && permissions.contains("VIEW_WITHOUT_PRICES")

    /** Whether this role/permissions combo can see purchase price on Android. */
    fun canViewPurchasePrice(role: String?, permissions: List<String>) =
        role == "ADMIN" || permissions.contains("VIEW_PURCHASE_PRICE")

    // ── Reactive flows ─────────────────────────────────────────────────────────
    val canApproveFlow = currentRole.map(::canApprove)
}
