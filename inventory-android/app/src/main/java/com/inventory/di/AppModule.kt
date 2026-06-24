package com.inventory.di

import android.content.Context
import androidx.room.Room
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.inventory.data.local.AppDatabase
import com.inventory.data.local.MIGRATION_8_9
import com.inventory.data.local.MIGRATION_9_10
import com.inventory.data.local.MIGRATION_10_11
import com.inventory.data.local.MIGRATION_11_12
import com.inventory.data.remote.ApiClient
import com.inventory.data.remote.InventoryApi
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    private val MIGRATION_2_3 = object : Migration(2, 3) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL("ALTER TABLE users ADD COLUMN permissions TEXT NOT NULL DEFAULT ''")
        }
    }
    private val MIGRATION_3_4 = object : Migration(3, 4) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL("ALTER TABLE products ADD COLUMN cartonQrCode TEXT NOT NULL DEFAULT ''")
            db.execSQL("ALTER TABLE products ADD COLUMN imageUrl TEXT")
        }
    }
    private val MIGRATION_4_5 = object : Migration(4, 5) {
        override fun migrate(db: SupportSQLiteDatabase) {
            // Schema-only DAO upgrade. Existing tables already match the entities.
        }
    }
    private val MIGRATION_5_6 = object : Migration(5, 6) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL("ALTER TABLE invoices ADD COLUMN type TEXT NOT NULL DEFAULT 'SALE'")
        }
    }

    // customerId in payment_vouchers changes from NOT NULL to nullable (EXPENSE vouchers have no customer)
    private val MIGRATION_6_7 = object : Migration(6, 7) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL("""
                CREATE TABLE IF NOT EXISTS payment_vouchers_new (
                    id TEXT NOT NULL,
                    voucherNumber TEXT NOT NULL,
                    customerId TEXT,
                    amount REAL NOT NULL,
                    type TEXT NOT NULL,
                    date TEXT NOT NULL,
                    notes TEXT,
                    createdAt TEXT,
                    PRIMARY KEY(id)
                )
            """.trimIndent())
            db.execSQL("INSERT INTO payment_vouchers_new SELECT id, voucherNumber, customerId, amount, type, date, notes, createdAt FROM payment_vouchers")
            db.execSQL("DROP TABLE payment_vouchers")
            db.execSQL("ALTER TABLE payment_vouchers_new RENAME TO payment_vouchers")
        }
    }

    private val MIGRATION_7_8 = object : Migration(7, 8) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL("ALTER TABLE products ADD COLUMN retailPrice REAL NOT NULL DEFAULT 0.0")
        }
    }

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): AppDatabase {
        return Room.databaseBuilder(context, AppDatabase::class.java, "inventory.db")
            .addMigrations(MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5, MIGRATION_5_6, MIGRATION_6_7, MIGRATION_7_8, MIGRATION_8_9, MIGRATION_9_10, MIGRATION_10_11, MIGRATION_11_12)
            .build()
    }

    @Provides
    fun provideUserDao(database: AppDatabase) = database.userDao()

    @Provides
    fun provideProductDao(database: AppDatabase) = database.productDao()

    @Provides
    fun provideCustomerDao(database: AppDatabase) = database.customerDao()

    @Provides
    fun providePendingApprovalDao(database: AppDatabase) = database.pendingApprovalDao()

    @Provides
    fun provideNotificationDao(database: AppDatabase) = database.notificationDao()

    @Provides
    fun providePendingSyncOperationDao(database: AppDatabase) = database.pendingSyncOperationDao()

    @Provides
    fun provideInvoiceDao(database: AppDatabase) = database.invoiceDao()

    @Provides
    fun provideInvoiceItemDao(database: AppDatabase) = database.invoiceItemDao()

    @Provides
    fun providePaymentVoucherDao(database: AppDatabase) = database.paymentVoucherDao()

    @Provides
    @Singleton
    fun provideInventoryApi(apiClient: ApiClient): InventoryApi = apiClient.api
}
