package com.inventory

import android.app.Application
import com.inventory.workers.OfflineSyncScheduler
import com.inventory.workers.SmartNotificationScheduler
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class InventoryApp : Application() {
    override fun onCreate() {
        super.onCreate()
        SmartNotificationScheduler.schedule(this)
        OfflineSyncScheduler.schedule(this)
    }
}
