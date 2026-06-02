package com.inventory.data.repository

import com.inventory.data.remote.InventoryApi
import com.inventory.data.remote.dto.CreateVoucherRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class VoucherRepository @Inject constructor(
    private val api: InventoryApi
) {
    suspend fun createVoucher(request: CreateVoucherRequest): Result<Unit> {
        return withContext(Dispatchers.IO) {
            try {
                val response = api.createVoucher(request)
                if (response.success) {
                    Result.success(Unit)
                } else {
                    Result.failure(Exception(response.message ?: "Failed to create voucher"))
                }
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }
}
