package com.inventory.data.local

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [
        UserEntity::class,
        ProductEntity::class,
        CustomerEntity::class,
        InvoiceEntity::class,
        InvoiceItemEntity::class,
        PaymentVoucherEntity::class,
        PendingApprovalEntity::class,
        NotificationEntity::class,
        StockMovementEntity::class,
        MessageTemplateEntity::class,
        SettingEntity::class,
        PendingSyncOperationEntity::class
    ],
    version = 7,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun userDao(): UserDao
    abstract fun productDao(): ProductDao
    abstract fun customerDao(): CustomerDao
    abstract fun pendingApprovalDao(): PendingApprovalDao
    abstract fun invoiceDao(): InvoiceDao
    abstract fun invoiceItemDao(): InvoiceItemDao
    abstract fun paymentVoucherDao(): PaymentVoucherDao
    abstract fun notificationDao(): NotificationDao
    abstract fun stockMovementDao(): StockMovementDao
    abstract fun pendingSyncOperationDao(): PendingSyncOperationDao
}
