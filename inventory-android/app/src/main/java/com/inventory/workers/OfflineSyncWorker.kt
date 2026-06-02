package com.inventory.workers

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.inventory.data.repository.SessionManager
import com.inventory.di.DatabaseEntryPoint
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
        val mediaType = "application/json; charset=utf-8".toMediaType()
        val operations = dao.nextPending()

        if (operations.isEmpty()) return Result.success()

        var hasRetryableFailure = false

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

        return if (hasRetryableFailure) Result.retry() else Result.success()
    }
}

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
