package com.inventory.data.repository

import com.inventory.data.remote.ApiClient
import com.inventory.data.remote.ApiResult
import com.inventory.data.remote.NetworkMonitor
import com.inventory.data.remote.dto.CreateCycleCountRequest
import com.inventory.data.remote.dto.CycleCountSessionDetailDto
import com.inventory.data.remote.dto.CycleCountSessionDto
import com.inventory.data.remote.dto.UpdateCycleCountItemRequest
import javax.inject.Inject
import javax.inject.Singleton

/**
 * "جدولة الجرد الذكي" (scheduled smart cycle count) — network-only admin
 * repository, fully independent from the manual stocktake. Mirrors the web
 * CycleCountPage endpoints. The worker public-link counting flow is not exposed
 * here (admin-only surface on Android).
 */
@Singleton
class CycleCountRepository @Inject constructor(
    private val apiClient: ApiClient,
    private val networkMonitor: NetworkMonitor
) {
    suspend fun listSessions(): ApiResult<List<CycleCountSessionDto>> = call {
        apiClient.api.getCycleCountSessions().data.orEmpty()
    }

    suspend fun getSession(id: String): ApiResult<CycleCountSessionDetailDto> = call {
        apiClient.api.getCycleCountSession(id).data
            ?: throw IllegalStateException("جلسة الجرد الذكي غير موجودة")
    }

    suspend fun createSession(
        warehouseId: String?,
        strategy: String,
        itemLimit: Int,
        notes: String?,
    ): ApiResult<CycleCountSessionDto> = call {
        apiClient.api.createCycleCountSession(
            CreateCycleCountRequest(
                warehouseId = warehouseId?.takeIf { it.isNotBlank() },
                strategy = strategy,
                itemLimit = itemLimit,
                notes = notes?.takeIf { it.isNotBlank() },
            )
        ).data ?: throw IllegalStateException("تعذر إنشاء الجلسة")
    }

    suspend fun updateItem(sessionId: String, productId: String, actualQty: Int): ApiResult<Unit> = call {
        apiClient.api.updateCycleCountItem(
            sessionId,
            UpdateCycleCountItemRequest(productId = productId, actualQty = actualQty)
        )
        Unit
    }

    suspend fun submit(id: String): ApiResult<Unit> = call { apiClient.api.submitCycleCountSession(id); Unit }
    suspend fun close(id: String): ApiResult<Unit> = call { apiClient.api.closeCycleCountSession(id); Unit }
    suspend fun cancel(id: String): ApiResult<Unit> = call { apiClient.api.cancelCycleCountSession(id); Unit }
    suspend fun reopen(id: String): ApiResult<Unit> = call { apiClient.api.reopenCycleCountSession(id); Unit }

    suspend fun approveItem(id: String, itemId: String): ApiResult<Unit> = call {
        apiClient.api.approveCycleCountItem(id, itemId); Unit
    }

    suspend fun rejectItem(id: String, itemId: String): ApiResult<Unit> = call {
        apiClient.api.rejectCycleCountItem(id, itemId); Unit
    }

    suspend fun approveAll(id: String): ApiResult<Unit> = call { apiClient.api.approveAllCycleCountItems(id); Unit }
    suspend fun rejectAll(id: String): ApiResult<Unit> = call { apiClient.api.rejectAllCycleCountItems(id); Unit }

    private suspend fun <T> call(block: suspend () -> T): ApiResult<T> {
        if (!networkMonitor.isOnline()) return ApiResult.Offline
        return try {
            ApiResult.Success(block())
        } catch (error: Exception) {
            ApiResult.Error(error.message ?: "حدث خطأ غير متوقع")
        }
    }
}
