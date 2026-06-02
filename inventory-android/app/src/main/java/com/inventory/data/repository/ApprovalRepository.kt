package com.inventory.data.repository

import com.inventory.data.local.PendingApprovalDao
import com.inventory.data.local.PendingApprovalEntity
import com.inventory.data.remote.ApiClient
import com.inventory.data.remote.ApiResult
import com.inventory.data.remote.NetworkMonitor
import com.inventory.data.remote.dto.ReviewApprovalRequest
import com.inventory.domain.model.Approval
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
            ApiResult.Success(approvals.map {
                Approval(it.id, it.requestType, it.requester?.name ?: it.requestedBy, it.createdAt)
            })
        } catch (error: Exception) {
            ApiResult.Error(error.message ?: "تعذر تحميل الطلبات")
        }
    }

    suspend fun approve(id: String) = apiClient.api.reviewApproval(id, ReviewApprovalRequest("APPROVED"))
    suspend fun reject(id: String) = apiClient.api.reviewApproval(id, ReviewApprovalRequest("REJECTED"))
}
