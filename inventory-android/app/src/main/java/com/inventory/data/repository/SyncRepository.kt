package com.inventory.data.repository

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.google.gson.Gson
import com.inventory.data.local.PendingSyncOperationDao
import com.inventory.data.local.PendingSyncOperationEntity
import com.inventory.workers.OfflineSyncWorker
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import java.time.Instant
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SyncRepository @Inject constructor(
    private val dao: PendingSyncOperationDao,
    @ApplicationContext private val context: Context
) {
    private val gson = Gson()
    val pendingCount: Flow<Int> = dao.observePendingCount()

    suspend fun enqueue(
        operationType: String,
        method: String,
        path: String,
        payload: Any
    ) {
        val now = Instant.now().toString()
        dao.insert(
            PendingSyncOperationEntity(
                id = UUID.randomUUID().toString(),
                operationType = operationType,
                method = method,
                path = path,
                payloadJson = gson.toJson(payload),
                status = "PENDING",
                attempts = 0,
                lastError = null,
                createdAt = now,
                updatedAt = now
            )
        )
        scheduleNow(context)
    }

    companion object {
        fun scheduleNow(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val request = OneTimeWorkRequestBuilder<OfflineSyncWorker>()
                .setConstraints(constraints)
                .build()

            WorkManager.getInstance(context).enqueueUniqueWork(
                "offline-sync-now",
                ExistingWorkPolicy.APPEND_OR_REPLACE,
                request
            )
        }
    }
}
