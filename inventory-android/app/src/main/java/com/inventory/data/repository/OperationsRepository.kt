package com.inventory.data.repository

import com.inventory.data.remote.ApiClient
import com.inventory.data.remote.ApiResult
import com.inventory.data.remote.NetworkMonitor
import com.inventory.data.remote.dto.AuditLogDto
import com.inventory.data.remote.dto.BranchDto
import com.inventory.data.remote.dto.BranchRequest
import com.inventory.data.remote.dto.CouponDto
import com.inventory.data.remote.dto.CouponRequest
import com.inventory.data.remote.dto.CreateQuotationRequest
import com.inventory.data.remote.dto.CreateTransferRequest
import com.inventory.data.remote.dto.InvoiceDto
import com.inventory.data.remote.dto.QuotationDto
import com.inventory.data.remote.dto.TransferDto
import com.inventory.data.remote.dto.UpdateQuotationStatusRequest
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class OperationsRepository @Inject constructor(
    private val apiClient: ApiClient,
    private val networkMonitor: NetworkMonitor
) {
    suspend fun branches(): ApiResult<List<BranchDto>> = onlineCall("تعذر تحميل الفروع") {
        apiClient.api.getBranches().data.orEmpty()
    }

    suspend fun createBranch(request: BranchRequest): ApiResult<BranchDto> = onlineCall("تعذر حفظ الفرع") {
        apiClient.api.createBranch(request).data ?: error("لم يرجع السيرفر الفرع")
    }

    suspend fun coupons(): ApiResult<List<CouponDto>> = onlineCall("تعذر تحميل الكوبونات") {
        apiClient.api.getCoupons().data.orEmpty()
    }

    suspend fun createCoupon(request: CouponRequest): ApiResult<CouponDto> = onlineCall("تعذر حفظ الكوبون") {
        apiClient.api.createCoupon(request).data ?: error("لم يرجع السيرفر الكوبون")
    }

    suspend fun quotations(status: String? = null): ApiResult<List<QuotationDto>> = onlineCall("تعذر تحميل عروض الأسعار") {
        apiClient.api.getQuotations(status = status).data
    }

    suspend fun createQuotation(request: CreateQuotationRequest): ApiResult<QuotationDto> = onlineCall("تعذر حفظ عرض السعر") {
        apiClient.api.createQuotation(request).data ?: error("لم يرجع السيرفر عرض السعر")
    }

    suspend fun updateQuotationStatus(id: String, status: String): ApiResult<QuotationDto> = onlineCall("تعذر تحديث عرض السعر") {
        apiClient.api.updateQuotationStatus(id, UpdateQuotationStatusRequest(status)).data ?: error("لم يرجع السيرفر عرض السعر")
    }

    suspend fun convertQuotation(id: String): ApiResult<InvoiceDto> = onlineCall("تعذر تحويل عرض السعر") {
        apiClient.api.convertQuotation(id).data ?: error("لم يرجع السيرفر الفاتورة")
    }

    suspend fun transfers(branchId: String? = null): ApiResult<List<TransferDto>> = onlineCall("تعذر تحميل التحويلات") {
        apiClient.api.getTransfers(branchId = branchId).data
    }

    suspend fun createTransfer(request: CreateTransferRequest): ApiResult<TransferDto> = onlineCall("تعذر حفظ التحويل") {
        apiClient.api.createTransfer(request)
    }

    suspend fun auditLogs(entity: String? = null, action: String? = null): ApiResult<List<AuditLogDto>> =
        onlineCall("تعذر تحميل سجل التدقيق") {
            apiClient.api.getAuditLogs(entity = entity, action = action).data
        }

    private suspend fun <T> onlineCall(message: String, block: suspend () -> T): ApiResult<T> {
        if (!networkMonitor.isOnline()) return ApiResult.Offline
        return try {
            ApiResult.Success(block())
        } catch (error: Exception) {
            ApiResult.Error(error.message ?: message)
        }
    }
}
