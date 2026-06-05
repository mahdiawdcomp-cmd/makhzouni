package com.inventory

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Application
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import com.inventory.workers.OfflineSyncScheduler
import com.inventory.workers.SmartNotificationScheduler
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class InventoryApp : Application() {
    override fun onCreate() {
        super.onCreate()
        createHighPriorityNotificationChannel()
        SmartNotificationScheduler.schedule(this)
        OfflineSyncScheduler.schedule(this)
    }

    private fun createHighPriorityNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        val audioAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        val channel = NotificationChannel(
            "inventory_priority_alerts",
            "تنبيهات مخزوني المهمة",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "تنبيهات الديون والمخزون والحركات المهمة"
            enableVibration(true)
            setSound(sound, audioAttributes)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
}
