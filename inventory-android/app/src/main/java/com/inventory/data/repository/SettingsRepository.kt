package com.inventory.data.repository

import com.inventory.data.remote.ApiClient
import com.inventory.data.remote.ApiResult
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SettingsRepository @Inject constructor(
    private val sessionManager: SessionManager,
    private val apiClient: ApiClient
) {
    val settings: Flow<StoreSettings> = sessionManager.storeSettings

    suspend fun save(settings: StoreSettings) = sessionManager.saveStoreSettings(settings)

    suspend fun testConnection(): ApiResult<Unit> = try {
        val response = apiClient.api.dashboardReport()
        if (response.success) ApiResult.Success(Unit) else ApiResult.Error(response.message ?: "فشل الاتصال")
    } catch (error: Exception) {
        ApiResult.Error(error.message ?: "فشل الاتصال")
    }
}
