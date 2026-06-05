package com.inventory.data.repository

import com.inventory.data.remote.ApiResult
import kotlinx.coroutines.flow.Flow
import okhttp3.OkHttpClient
import okhttp3.Request
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SettingsRepository @Inject constructor(
    private val sessionManager: SessionManager
) {
    private val httpClient = OkHttpClient()

    val settings: Flow<StoreSettings> = sessionManager.storeSettings

    suspend fun save(settings: StoreSettings) = sessionManager.saveStoreSettings(settings)

    suspend fun testConnection(): ApiResult<Unit> = try {
        val healthUrl = sessionManager.currentBaseUrl
            .trimEnd('/')
            .removeSuffix("/api") + "/health"
        val request = Request.Builder().url(healthUrl).get().build()

        httpClient.newCall(request).execute().use { response ->
            if (response.isSuccessful) {
                ApiResult.Success(Unit)
            } else {
                ApiResult.Error("فشل الاتصال: HTTP ${response.code}")
            }
        }
    } catch (error: Exception) {
        ApiResult.Error(error.message ?: "فشل الاتصال")
    }
}
