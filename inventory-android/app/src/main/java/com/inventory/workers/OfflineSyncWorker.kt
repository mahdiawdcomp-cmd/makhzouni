package com.inventory.workers

import android.content.Context
import androidx.room.withTransaction
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.inventory.data.repository.SessionManager
import com.inventory.data.local.CustomerEntity
import com.inventory.data.local.InvoiceEntity
import com.inventory.data.local.InvoiceItemEntity
import com.inventory.data.local.ProductEntity
import com.inventory.data.remote.dto.CustomerDto
import com.inventory.data.remote.dto.InvoiceDto
import com.inventory.data.remote.dto.ProductDto
import com.inventory.di.DatabaseEntryPoint
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import dagger.hilt.android.EntryPointAccessors
import kotlinx.coroutines.flow.first
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.time.Instant
import java.util.concurrent.TimeUnit

class OfflineSyncWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val database = EntryPointAccessors.fromApplication<DatabaseEntryPoint>(applicationContext).database()
        val dao = database.pendingSyncOperationDao()
        val session = SessionManager(applicationContext)
        session.hydrateCache()
        val token = session.token.first()
        val baseUrl = session.baseUrl.first().trimEnd('/')
        val client = OkHttpClient()
        val gson = Gson()
        val mediaType = "application/json; charset=utf-8".toMediaType()
        val operations = dao.nextPending()

        if (operations.isEmpty()) return Result.success()

        var hasRetryableFailure = false
        var shouldRefreshCache = false

        for (operation in operations) {
            dao.updateStatus(operation.id, "SYNCING", 0, null, Instant.now().toString())

            try {
                val body = operation.payloadJson.toRequestBody(mediaType)
                val builder = Request.Builder()
                    .url("$baseUrl/${operation.path.trimStart('/')}")

                if (!token.isNullOrBlank()) {
                    builder.addHeader("Authorization", "Bearer $token")
                }

                val request = when (operation.method.uppercase()) {
                    "POST" -> builder.post(body).build()
                    "PUT" -> builder.put(body).build()
                    "PATCH" -> builder.patch(body).build()
                    "DELETE" -> builder.delete(body).build()
                    else -> builder.post(body).build()
                }

                client.newCall(request).execute().use { response ->
                    if (response.isSuccessful || response.code == 202) {
                        shouldRefreshCache = true
                        dao.delete(operation.id)
                    } else {
                        hasRetryableFailure = response.code >= 500 || response.code == 429
                        dao.updateStatus(
                            id = operation.id,
                            status = if (hasRetryableFailure) "FAILED" else "BLOCKED",
                            attemptDelta = 1,
                            lastError = "HTTP ${response.code}: ${response.body?.string()}",
                            updatedAt = Instant.now().toString()
                        )
                    }
                }
            } catch (error: Exception) {
                hasRetryableFailure = true
                dao.updateStatus(
                    id = operation.id,
                    status = "FAILED",
                    attemptDelta = 1,
                    lastError = error.message,
                    updatedAt = Instant.now().toString()
                )
            }
        }

        if (shouldRefreshCache) {
            refreshCache(client, gson, database, baseUrl, token)
        }

        return if (hasRetryableFailure) Result.retry() else Result.success()
    }

    private suspend fun refreshCache(
        client: OkHttpClient,
        gson: Gson,
        database: com.inventory.data.local.AppDatabase,
        baseUrl: String,
        token: String?
    ) {
        fun request(path: String): Request {
            val builder = Request.Builder().url("$baseUrl/${path.trimStart('/')}")
            if (!token.isNullOrBlank()) builder.addHeader("Authorization", "Bearer $token")
            return builder.get().build()
        }

        fun body(path: String): String? = try {
            client.newCall(request(path)).execute().use { response ->
                if (response.isSuccessful) response.body?.string() else null
            }
        } catch (_: Exception) {
            null
        }

        body("products?limit=5000")?.let { json ->
            val type = object : TypeToken<PagedResponse<ProductDto>>() {}.type
            val response = gson.fromJson<PagedResponse<ProductDto>>(json, type)
            database.productDao().replaceAll(response.data.map { it.toEntity() })
        }

        body("customers?limit=500")?.let { json ->
            val type = object : TypeToken<PagedResponse<CustomerDto>>() {}.type
            val response = gson.fromJson<PagedResponse<CustomerDto>>(json, type)
            database.customerDao().upsertAll(response.data.map { it.toEntity() })
        }

        body("invoices?limit=500")?.let { json ->
            val type = object : TypeToken<PagedResponse<InvoiceDto>>() {}.type
            val response = gson.fromJson<PagedResponse<InvoiceDto>>(json, type)
            val invoiceEntities = response.data.map { it.toEntity() }
            val itemEntities = response.data.flatMap { invoice ->
                invoice.items.map { it.toEntity(invoice.id) }
            }
            // Atomic: invoices + their items replaced together — no partial state on crash
            database.withTransaction {
                database.invoiceDao().replaceAll(invoiceEntities)
                database.invoiceItemDao().replaceAll(itemEntities)
            }
        }
    }
}

private data class PagedResponse<T>(val success: Boolean = false, val data: List<T> = emptyList())

private fun ProductDto.toEntity() = ProductEntity(
    id = id,
    itemNumber = itemNumber,
    name = name,
    qrCode = qrCode.orEmpty(),
    cartonQrCode = cartonQrCode.orEmpty(),
    imageUrl = imageUrl,
    category = category.orEmpty(),
    openingBalancePcs = openingBalancePcs,
    cartonsAvailable = cartonsAvailable,
    pcsPerCarton = pcsPerCarton,
    purchasePrice = purchasePrice,
    salePrice = salePrice,
    retailPrice = retailPrice,
    minStock = minStock,
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

private fun InvoiceDto.toEntity() = InvoiceEntity(
    id = id,
    invoiceNumber = invoiceNumber,
    customerId = customerId,
    date = date,
    type = type,
    subtotal = subtotal,
    discount = discount,
    tax = tax,
    totalAmount = totalAmount,
    paidAmount = paidAmount,
    remainingAmount = remainingAmount,
    previousBalance = previousBalance,
    finalBalance = finalBalance,
    paymentType = paymentType,
    status = status,
    createdAt = createdAt
)

private fun com.inventory.data.remote.dto.InvoiceItemDto.toEntity(invoiceId: String) = InvoiceItemEntity(
    // Use deterministic ID so repeated syncs don't create duplicate rows.
    // Falls back to "invoiceId_productId" only if the server omits the id field.
    id = id ?: "${invoiceId}_${productId}",
    invoiceId = this.invoiceId ?: invoiceId,
    productId = productId,
    productName = productName ?: productId,
    unit = unit,
    quantity = quantity,
    unitPrice = unitPrice,
    totalPrice = totalPrice
)

object OfflineSyncScheduler {
    fun schedule(context: Context) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()
        val request = PeriodicWorkRequestBuilder<OfflineSyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .build()

        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            "offline-sync-worker",
            ExistingPeriodicWorkPolicy.UPDATE,
            request
        )
    }
}
