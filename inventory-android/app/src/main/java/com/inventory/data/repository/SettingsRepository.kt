package com.inventory.data.repository

import com.inventory.data.remote.ApiResult
import com.inventory.data.remote.InventoryApi
import com.inventory.data.remote.dto.BranchDto
import com.inventory.data.remote.dto.UpdateAppSettingsRequest
import kotlinx.coroutines.flow.Flow
import okhttp3.OkHttpClient
import okhttp3.Request
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SettingsRepository @Inject constructor(
    private val sessionManager: SessionManager,
    private val api: InventoryApi
) {
    private val httpClient = OkHttpClient()

    val settings: Flow<StoreSettings> = sessionManager.storeSettings

    suspend fun save(settings: StoreSettings) = sessionManager.saveStoreSettings(settings)

    /** Active branches, for the "مخزن المحل الافتراضي للبيع" picker. */
    suspend fun loadBranches(): ApiResult<List<BranchDto>> = try {
        ApiResult.Success(api.getBranches().data.orEmpty().filter { it.isActive })
    } catch (error: Exception) {
        ApiResult.Error(error.message ?: "تعذر تحميل المخازن")
    }

    /** The backend-wide (shared, not per-device) default warehouse used for sales. */
    suspend fun getShopWarehouseId(): ApiResult<String?> = try {
        ApiResult.Success(api.getAppSettings().data?.shopWarehouseId?.takeIf { it.isNotBlank() })
    } catch (error: Exception) {
        ApiResult.Error(error.message ?: "تعذر تحميل الإعدادات")
    }

    suspend fun updateShopWarehouseId(warehouseId: String): ApiResult<String?> = try {
        ApiResult.Success(api.updateAppSettings(UpdateAppSettingsRequest(warehouseId)).data?.shopWarehouseId)
    } catch (error: Exception) {
        ApiResult.Error(error.message ?: "تعذر حفظ الإعداد")
    }

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
