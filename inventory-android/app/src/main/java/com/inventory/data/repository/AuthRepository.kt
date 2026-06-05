package com.inventory.data.repository

import com.inventory.data.remote.ApiClient
import com.inventory.data.remote.ApiResult
import com.inventory.data.remote.NetworkMonitor
import com.inventory.data.remote.dto.LoginRequest
import kotlinx.coroutines.flow.first
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthRepository @Inject constructor(
    private val apiClient: ApiClient,
    private val networkMonitor: NetworkMonitor,
    private val sessionManager: SessionManager
) {
    suspend fun login(username: String, password: String, rememberMe: Boolean): ApiResult<Unit> {
        if (!networkMonitor.isOnline()) return ApiResult.Offline
        return try {
            val response = apiClient.api.login(LoginRequest(username, password))
            val token = response.token
            val user = response.user
            if (response.success && token != null && user != null) {
                sessionManager.saveSession(token, user.role, user.name, rememberMe, user.permissions.orEmpty())
                ApiResult.Success(Unit)
            } else {
                ApiResult.Error(response.message ?: "فشل تسجيل الدخول", response.code)
            }
        } catch (error: Exception) {
            ApiResult.Error(error.message ?: "خطأ غير معروف")
        }
    }

    suspend fun hasRememberedSession(): Boolean {
        sessionManager.hydrateCache()
        return sessionManager.rememberMe.first() && !sessionManager.currentToken.isNullOrBlank()
    }
}
