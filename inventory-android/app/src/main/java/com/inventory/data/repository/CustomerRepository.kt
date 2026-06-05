package com.inventory.data.repository

import com.inventory.data.local.CustomerDao
import com.inventory.data.local.CustomerEntity
import com.inventory.data.remote.ApiClient
import com.inventory.data.remote.ApiResult
import com.inventory.data.remote.NetworkMonitor
import com.inventory.data.remote.dto.CreateVoucherRequest
import com.inventory.data.remote.dto.CustomerDto
import com.inventory.data.remote.dto.CustomerTransactionDto
import com.inventory.data.remote.dto.LastTransactionDto
import com.inventory.data.remote.dto.UpsertCustomerRequest
import com.inventory.domain.model.Customer
import com.inventory.domain.model.CustomerTransaction
import com.inventory.domain.model.LastTransaction
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class CustomerRepository @Inject constructor(
    private val apiClient: ApiClient,
    private val customerDao: CustomerDao,
    private val networkMonitor: NetworkMonitor,
    private val syncRepository: SyncRepository
) {
    val customers: Flow<List<Customer>> = customerDao.observeCustomers().map { list ->
        list.map { it.toDomain() }
    }

    fun observeCustomer(id: String): Flow<Customer?> = customerDao.observeCustomer(id).map { it?.toDomain() }

    suspend fun refreshCustomers(search: String? = null, isSupplier: Boolean? = null): ApiResult<List<Customer>> {
        if (!networkMonitor.isOnline()) return ApiResult.Offline
        return try {
            val response = apiClient.api.getCustomers(search.takeUnless { it.isNullOrBlank() }, isSupplier)
            val entities = response.data.map { it.toEntity() }
            customerDao.upsertAll(entities)
            ApiResult.Success(entities.map { it.toDomain() })
        } catch (error: Exception) {
            ApiResult.Error(error.message ?: "تعذر تحميل الزبائن")
        }
    }

    suspend fun saveCustomer(id: String?, request: UpsertCustomerRequest) = if (id == null) {
        if (!networkMonitor.isOnline()) {
            syncRepository.enqueue("CREATE_CUSTOMER", "POST", "customers", request)
            null
        } else {
            apiClient.api.createCustomer(request)
        }
    } else {
        if (!networkMonitor.isOnline()) {
            syncRepository.enqueue("UPDATE_CUSTOMER", "PUT", "customers/$id", request)
            null
        } else {
            apiClient.api.updateCustomer(id, request)
        }
    }

    suspend fun transactions(customerId: String, from: String?, to: String?): ApiResult<List<CustomerTransaction>> {
        if (!networkMonitor.isOnline()) return ApiResult.Offline
        return try {
            val rows = apiClient.api.getCustomerTransactions(customerId, from.takeUnless { it.isNullOrBlank() }, to.takeUnless { it.isNullOrBlank() }).data?.transactions.orEmpty()
            ApiResult.Success(rows.map { it.toDomain() })
        } catch (error: Exception) {
            ApiResult.Error(error.message ?: "تعذر تحميل كشف الحساب")
        }
    }

    suspend fun lastTransaction(customerId: String): ApiResult<LastTransaction?> {
        if (!networkMonitor.isOnline()) return ApiResult.Offline
        return try {
            ApiResult.Success(apiClient.api.getLastCustomerTransaction(customerId).data?.toDomain())
        } catch (error: Exception) {
            ApiResult.Error(error.message ?: "تعذر تحميل آخر حركة")
        }
    }

    suspend fun createReceipt(customerId: String, amount: Double, date: String, notes: String?) {
        val request = CreateVoucherRequest(customerId, amount, "RECEIPT", date, notes)
        if (!networkMonitor.isOnline()) {
            syncRepository.enqueue("CREATE_RECEIPT", "POST", "vouchers", request)
        } else {
            apiClient.api.createVoucher(request)
        }
    }
}

private fun CustomerEntity.toDomain() = Customer(
    id = id,
    name = name,
    phone = phone,
    address = address,
    notes = notes,
    openingBalance = openingBalance,
    currentBalance = currentBalance,
    isSupplier = isSupplier,
    lastTransactionAt = lastTransactionAt,
    updatedAt = updatedAt
)

private fun CustomerDto.toEntity() = CustomerEntity(
    id = id,
    name = name,
    phone = phone,
    address = address,
    notes = notes,
    openingBalance = openingBalance,
    currentBalance = currentBalance,
    isSupplier = isSupplier,
    lastTransactionAt = lastTransactionAt,
    updatedAt = updatedAt,
    deletedAt = null
)

private fun CustomerTransactionDto.toDomain(): CustomerTransaction {
    val debitValue = debit ?: if (type == "INVOICE") amount else 0.0
    val creditValue = credit ?: if (type == "RECEIPT") amount else 0.0
    return CustomerTransaction(
        id = id,
        date = date,
        type = type,
        debit = debitValue,
        credit = creditValue,
        amount = amount,
        referenceNumber = referenceNumber,
        runningBalance = runningBalance,
        status = status
    )
}

private fun LastTransactionDto.toDomain() = LastTransaction(id, date, type, amount, referenceNumber)
