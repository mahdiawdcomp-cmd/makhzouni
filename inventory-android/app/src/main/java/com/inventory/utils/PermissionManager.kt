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

    fun canApprove(role: String?) = role == "ADMIN"
    fun canEditDirectly(role: String?) = role == "ADMIN"
    fun mustRequestApproval(role: String?) = role == "STAFF"

    val canApproveFlow = currentRole.map(::canApprove)
}
