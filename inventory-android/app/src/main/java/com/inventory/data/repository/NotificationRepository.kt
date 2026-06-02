package com.inventory.data.repository

import com.inventory.data.local.NotificationDao
import com.inventory.data.local.NotificationEntity
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class NotificationRepository @Inject constructor(
    private val notificationDao: NotificationDao
) {
    fun observeNotifications(): Flow<List<NotificationEntity>> {
        return notificationDao.observeNotifications()
    }

    fun observeUnreadCount(): Flow<Int> {
        return notificationDao.observeUnreadCount()
    }
}
