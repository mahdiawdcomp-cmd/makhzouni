package com.inventory.workers

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.inventory.data.local.NotificationEntity
import com.inventory.data.remote.ApiClient
import com.inventory.data.remote.DynamicBaseUrlInterceptor
import com.inventory.data.remote.JwtInterceptor
import com.inventory.data.repository.SessionManager
import com.inventory.di.DatabaseEntryPoint
import dagger.hilt.android.EntryPointAccessors
import kotlinx.coroutines.flow.first
import java.util.UUID
import java.util.concurrent.TimeUnit

class DebtReminderWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val session = SessionManager(applicationContext)
        val settings = session.storeSettings.first()
        if (!settings.debtReminderEnabled) return Result.success()

        return try {
            session.hydrateCache()
            val api = ApiClient(JwtInterceptor(session), DynamicBaseUrlInterceptor(session)).api
            val debts = api.customerDebtsReport(settings.debtReminderDays).data.orEmpty()
            val database = EntryPointAccessors.fromApplication<DatabaseEntryPoint>(applicationContext).database()
            val notifications = debts.map {
                NotificationEntity(
                    id = UUID.randomUUID().toString(),
                    customerId = it.id,
                    type = "DEBT_REMINDER",
                    message = settings.debtTemplate
                        .replace("{customerName}", it.name)
                        .replace("{amount}", it.currentBalance.toString())
                        .replace("{daysLate}", it.debtAgeDays.toString())
                        .replace("{storeName}", settings.storeName),
                    sentAt = null,
                    isRead = false,
                    createdAt = java.time.Instant.now().toString()
                )
            }
            database.notificationDao().upsertAll(notifications)
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }
}

class InactiveCustomerWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val session = SessionManager(applicationContext)
        val settings = session.storeSettings.first()
        if (!settings.inactiveAlertEnabled) return Result.success()

        return try {
            session.hydrateCache()
            val api = ApiClient(JwtInterceptor(session), DynamicBaseUrlInterceptor(session)).api
            val customers = api.getInactiveCustomers(settings.inactiveCustomerDays).data.orEmpty()
            val database = EntryPointAccessors.fromApplication<DatabaseEntryPoint>(applicationContext).database()
            database.notificationDao().upsertAll(customers.map {
                NotificationEntity(
                    id = UUID.randomUUID().toString(),
                    customerId = it.id,
                    type = "INACTIVE_CUSTOMER",
                    message = "الزبون ${it.name} غائب منذ ${settings.inactiveCustomerDays} يوم",
                    sentAt = null,
                    isRead = false,
                    createdAt = java.time.Instant.now().toString()
                )
            })
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }
}

object SmartNotificationScheduler {
    fun schedule(context: Context) {
        val debtWork = PeriodicWorkRequestBuilder<DebtReminderWorker>(1, TimeUnit.DAYS).build()
        val inactiveWork = PeriodicWorkRequestBuilder<InactiveCustomerWorker>(1, TimeUnit.DAYS).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            "debt-reminder-worker",
            ExistingPeriodicWorkPolicy.UPDATE,
            debtWork
        )
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            "inactive-customer-worker",
            ExistingPeriodicWorkPolicy.UPDATE,
            inactiveWork
        )
    }
}
