package com.inventory.data.repository

import com.inventory.data.local.PendingApprovalDao
import com.inventory.data.local.PendingApprovalEntity
import com.inventory.data.remote.ApiClient
import com.inventory.data.remote.ApiResult
import com.inventory.data.remote.NetworkMonitor
import com.inventory.data.remote.dto.ReviewApprovalRequest
import com.inventory.domain.model.Approval
import com.inventory.domain.model.ApprovalDisplayItem
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ApprovalRepository @Inject constructor(
    private val apiClient: ApiClient,
    private val pendingApprovalDao: PendingApprovalDao,
    private val networkMonitor: NetworkMonitor
) {
    val pending: Flow<List<Approval>> = pendingApprovalDao.observePending().map { list ->
        list.map { Approval(it.id, it.requestType, it.requestedBy, it.createdAt) }
    }

    suspend fun refreshPending(): ApiResult<List<Approval>> {
        if (!networkMonitor.isOnline()) return ApiResult.Offline
        return try {
            val response = apiClient.api.getApprovals()
            val approvals = response.data.orEmpty()
            pendingApprovalDao.upsertAll(approvals.map {
                PendingApprovalEntity(
                    id = it.id,
                    requestType = it.requestType,
                    requestData = it.requestData?.toString().orEmpty(),
                    requestedBy = it.requestedBy,
                    status = it.status,
                    reviewedBy = it.reviewedBy,
                    reviewedAt = it.reviewedAt,
                    createdAt = it.createdAt
                )
            })
            ApiResult.Success(approvals.map { it.toDomain() })
        } catch (error: Exception) {
            ApiResult.Error(error.message ?: "تعذر تحميل الطلبات")
        }
    }

    suspend fun approve(id: String, allowPrices: Boolean? = null, showStock: Boolean? = null) =
        apiClient.api.reviewApproval(id, ReviewApprovalRequest("APPROVED", allowPrices, showStock))

    suspend fun reject(id: String) = apiClient.api.reviewApproval(id, ReviewApprovalRequest("REJECTED"))

    private fun com.inventory.data.remote.dto.ApprovalDto.toDomain(): Approval {
        val data = requestData.orEmpty()
        val body = data.mapValue("body").orEmpty()
        val items = data.listValue("displayItems").map { row ->
            ApprovalDisplayItem(
                productName = row.stringValue("productName") ?: row.stringValue("productId") ?: "-",
                unit = row.stringValue("unit") ?: "PIECE",
                quantity = row.intValue("quantity") ?: 0,
                unitPrice = row.doubleValue("unitPrice"),
                totalPrice = row.doubleValue("totalPrice")
            )
        }
        return Approval(
            id = id,
            requestType = requestType,
            requesterName = requester?.name ?: requestedBy,
            createdAt = createdAt,
            customerName = data.stringValue("customerName") ?: body.stringValue("customerName"),
            phone = data.stringValue("phone") ?: body.stringValue("phone"),
            address = data.stringValue("address") ?: body.stringValue("address"),
            notes = data.stringValue("notes") ?: body.stringValue("notes"),
            subtotal = data.doubleValue("subtotal"),
            itemCount = items.size,
            displayItems = items
        )
    }

    private fun Map<String, Any?>.stringValue(key: String): String? =
        this[key]?.toString()?.takeIf { it.isNotBlank() && it != "null" }

    private fun Map<String, Any?>.doubleValue(key: String): Double? = when (val value = this[key]) {
        is Number -> value.toDouble()
        is String -> value.toDoubleOrNull()
        else -> null
    }

    private fun Map<String, Any?>.intValue(key: String): Int? = when (val value = this[key]) {
        is Number -> value.toInt()
        is String -> value.toIntOrNull()
        else -> null
    }

    @Suppress("UNCHECKED_CAST")
    private fun Map<String, Any?>.mapValue(key: String): Map<String, Any?>? = this[key] as? Map<String, Any?>

    @Suppress("UNCHECKED_CAST")
    private fun Map<String, Any?>.listValue(key: String): List<Map<String, Any?>> =
        (this[key] as? List<*>)?.mapNotNull { it as? Map<String, Any?> }.orEmpty()
}
