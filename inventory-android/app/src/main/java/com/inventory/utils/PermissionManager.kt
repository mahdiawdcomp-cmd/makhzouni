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

    fun canApprove(role: String?) = role == "ADMIN"
    fun canEditDirectly(role: String?) = role == "ADMIN"
    fun mustRequestApproval(role: String?) = role == "STAFF"
    fun hasPermission(role: String?, permissions: List<String>, permission: String) =
        role == "ADMIN" || permissions.contains(permission)
    fun canManageUsers(role: String?, permissions: List<String>) = hasPermission(role, permissions, "MANAGE_USERS")
    fun canManageApprovals(role: String?, permissions: List<String>) = hasPermission(role, permissions, "MANAGE_APPROVALS")

    val canApproveFlow = currentRole.map(::canApprove)
}
