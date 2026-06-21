package com.inventory.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

val MIGRATION_8_9 = object : Migration(8, 9) {
    override fun migrate(database: SupportSQLiteDatabase) {
        database.execSQL("ALTER TABLE products ADD COLUMN shopStock INTEGER DEFAULT NULL")
    }
}

val MIGRATION_9_10 = object : Migration(9, 10) {
    override fun migrate(database: SupportSQLiteDatabase) {
        database.execSQL("ALTER TABLE payment_vouchers ADD COLUMN cancelledAt TEXT DEFAULT NULL")
    }
}

val MIGRATION_10_11 = object : Migration(10, 11) {
    override fun migrate(database: SupportSQLiteDatabase) {
        database.execSQL("ALTER TABLE invoices ADD COLUMN notes TEXT DEFAULT NULL")
        database.execSQL("ALTER TABLE invoice_items ADD COLUMN notes TEXT DEFAULT NULL")
    }
}

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
    version = 11,
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
