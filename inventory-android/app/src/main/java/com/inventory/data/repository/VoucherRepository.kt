package com.inventory.data.repository

import com.inventory.data.remote.InventoryApi
import com.inventory.data.remote.dto.CreateVoucherRequest
import com.inventory.data.remote.dto.VoucherDto
import com.inventory.domain.model.Voucher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class VoucherRepository @Inject constructor(
    private val api: InventoryApi
) {
    suspend fun listVouchers(type: String? = null, page: Int = 1, limit: Int = 50): Result<List<Voucher>> {
        return withContext(Dispatchers.IO) {
            try {
                val response = api.getVouchers(type = type, page = page, limit = limit)
                Result.success((response.data ?: emptyList()).map { it.toDomain() })
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }

    suspend fun deleteVoucher(id: String): Result<Unit> {
        return withContext(Dispatchers.IO) {
            try {
                val response = api.deleteVoucher(id)
                if (response.success) Result.success(Unit)
                else Result.failure(Exception(response.message ?: "Failed to delete voucher"))
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }

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

    suspend fun getVoucher(id: String): Result<Voucher> {
        return withContext(Dispatchers.IO) {
            try {
                val response = api.getVoucher(id)
                val voucher = response.data
                if (response.success && voucher != null) {
                    Result.success(voucher.toDomain())
                } else {
                    Result.failure(Exception(response.message ?: "Failed to load voucher"))
                }
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }

    suspend fun updateVoucher(id: String, request: CreateVoucherRequest): Result<Voucher> {
        return withContext(Dispatchers.IO) {
            try {
                val response = api.updateVoucher(id, request)
                val voucher = response.data
                if (response.success && voucher != null) {
                    Result.success(voucher.toDomain())
                } else {
                    Result.failure(Exception(response.message ?: "Failed to update voucher"))
                }
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }
}

private fun VoucherDto.toDomain() = Voucher(
    id = id,
    voucherNumber = voucherNumber,
    customerId = customerId,
    customerName = customer?.name,
    amount = amount,
    type = type,
    date = date.take(10),
    notes = notes,
    description = description
)
