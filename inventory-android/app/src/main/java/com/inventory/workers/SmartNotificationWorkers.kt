package com.inventory.workers

import android.content.Context
import android.Manifest
import android.app.NotificationManager
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
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
            if (notifications.isNotEmpty()) {
                showPriorityNotification(
                    applicationContext,
                    "تنبيه ديون",
                    "عندك ${notifications.size} زبون يحتاج متابعة دفع"
                )
            }
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
            if (customers.isNotEmpty()) {
                showPriorityNotification(
                    applicationContext,
                    "زبائن خامدين",
                    "عندك ${customers.size} زبون ما عنده حركة من فترة"
                )
            }
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }
}

private fun showPriorityNotification(context: Context, title: String, message: String) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
        return
    }
    val notification = NotificationCompat.Builder(context, "inventory_priority_alerts")
        .setSmallIcon(com.inventory.R.drawable.ic_launcher)
        .setContentTitle(title)
        .setContentText(message)
        .setPriority(NotificationCompat.PRIORITY_MAX)
        .setCategory(NotificationCompat.CATEGORY_ALARM)
        .setDefaults(NotificationCompat.DEFAULT_ALL)
        .setAutoCancel(true)
        .build()
    NotificationManagerCompat.from(context).notify(title.hashCode(), notification)
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
