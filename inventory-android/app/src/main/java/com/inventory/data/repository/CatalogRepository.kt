package com.inventory.data.repository

import com.inventory.data.remote.ApiClient
import com.inventory.data.remote.ApiResult
import com.inventory.data.remote.NetworkMonitor
import com.inventory.data.remote.dto.CatalogCustomerDto
import com.inventory.data.remote.dto.GrantCatalogAccessRequest
import com.inventory.data.remote.dto.OrderPreparationDto
import com.inventory.data.remote.dto.PatchCatalogAccessRequest
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class CatalogRepository @Inject constructor(
    private val apiClient: ApiClient,
    private val networkMonitor: NetworkMonitor
) {
    suspend fun getCatalogCustomers(): ApiResult<List<CatalogCustomerDto>> = call {
        apiClient.api.getCatalogCustomers().data.orEmpty()
    }

    suspend fun grantAccess(id: String, allowPrices: Boolean, showStock: Boolean): ApiResult<Unit> = call {
        apiClient.api.grantCatalogAccess(id, GrantCatalogAccessRequest(allowPrices, showStock))
        Unit
    }

    suspend fun patchAccess(id: String, allowPrices: Boolean? = null, showStock: Boolean? = null): ApiResult<Unit> = call {
        apiClient.api.patchCatalogAccess(id, PatchCatalogAccessRequest(allowPrices, showStock))
        Unit
    }

    suspend fun revokeAccess(id: String): ApiResult<Unit> = call {
        apiClient.api.revokeCatalogAccess(id)
        Unit
    }

    suspend fun getOrderPreparations(): ApiResult<List<OrderPreparationDto>> = call {
        apiClient.api.getOrderPreparations().data.orEmpty()
    }

    suspend fun markPrepared(id: String): ApiResult<Unit> = call {
        apiClient.api.markOrderPrepared(id)
        Unit
    }

    private suspend fun <T> call(block: suspend () -> T): ApiResult<T> {
        if (!networkMonitor.isOnline()) return ApiResult.Offline
        return try {
            ApiResult.Success(block())
        } catch (error: Exception) {
            ApiResult.Error(error.message ?: "حدث خطأ غير متوقع")
        }
    }
}
