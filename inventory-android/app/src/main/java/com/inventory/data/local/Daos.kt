package com.inventory.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow

@Dao
interface UserDao {
    @Query("SELECT * FROM users ORDER BY name")
    fun observeUsers(): Flow<List<UserEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(users: List<UserEntity>)
}

@Dao
interface ProductDao {
    @Query("SELECT * FROM products ORDER BY itemNumber")
    fun observeProducts(): Flow<List<ProductEntity>>

    @Query("SELECT * FROM products WHERE id = :id LIMIT 1")
    fun observeProduct(id: String): Flow<ProductEntity?>

    @Query("SELECT * FROM products WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): ProductEntity?

    @Query("SELECT * FROM products WHERE qrCode = :qrCode OR cartonQrCode = :qrCode LIMIT 1")
    suspend fun findByQr(qrCode: String): ProductEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(products: List<ProductEntity>)

    @Query("DELETE FROM products")
    suspend fun clearProducts()

    @Transaction
    suspend fun replaceAll(products: List<ProductEntity>) {
        clearProducts()
        upsertAll(products)
    }

    @Query("DELETE FROM products WHERE id = :id")
    suspend fun deleteProduct(id: String)
}

@Dao
interface CustomerDao {
    @Query("SELECT * FROM customers WHERE deletedAt IS NULL ORDER BY name")
    fun observeCustomers(): Flow<List<CustomerEntity>>

    @Query("SELECT * FROM customers WHERE id = :id LIMIT 1")
    fun observeCustomer(id: String): Flow<CustomerEntity?>

    @Query("SELECT * FROM customers WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): CustomerEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(customers: List<CustomerEntity>)

    @Query("DELETE FROM customers")
    suspend fun clearCustomers()

    @Transaction
    suspend fun replaceAll(customers: List<CustomerEntity>) {
        clearCustomers()
        upsertAll(customers)
    }
}

@Dao
interface PendingApprovalDao {
    @Query("SELECT * FROM pending_approvals WHERE status = 'PENDING' ORDER BY createdAt DESC")
    fun observePending(): Flow<List<PendingApprovalEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(items: List<PendingApprovalEntity>)
}

@Dao
interface InvoiceDao {
    @Query("SELECT * FROM invoices ORDER BY date DESC, createdAt DESC")
    fun observeInvoices(): Flow<List<InvoiceEntity>>

    @Query("SELECT * FROM invoices ORDER BY date DESC, createdAt DESC")
    suspend fun listInvoices(): List<InvoiceEntity>

    @Query("SELECT * FROM invoices WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): InvoiceEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(items: List<InvoiceEntity>)

    @Query("DELETE FROM invoices")
    suspend fun clearInvoices()

    @Transaction
    suspend fun replaceAll(items: List<InvoiceEntity>) {
        clearInvoices()
        upsertAll(items)
    }
}

@Dao
interface InvoiceItemDao {
    @Query("SELECT * FROM invoice_items WHERE invoiceId = :invoiceId ORDER BY id")
    suspend fun getForInvoice(invoiceId: String): List<InvoiceItemEntity>

    @Query("DELETE FROM invoice_items WHERE invoiceId = :invoiceId")
    suspend fun deleteForInvoice(invoiceId: String)

    @Query("DELETE FROM invoice_items")
    suspend fun clearItems()

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(items: List<InvoiceItemEntity>)

    @Transaction
    suspend fun replaceAll(items: List<InvoiceItemEntity>) {
        clearItems()
        upsertAll(items)
    }
}

@Dao
interface PaymentVoucherDao {
    @Query("SELECT * FROM payment_vouchers ORDER BY date DESC, createdAt DESC")
    fun observeVouchers(): Flow<List<PaymentVoucherEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(items: List<PaymentVoucherEntity>)
}

@Dao
interface NotificationDao {
    @Query("SELECT COUNT(*) FROM notifications WHERE isRead = 0")
    fun observeUnreadCount(): Flow<Int>

    @Query("SELECT * FROM notifications ORDER BY createdAt DESC")
    fun observeNotifications(): Flow<List<NotificationEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(items: List<NotificationEntity>)
}

@Dao
interface StockMovementDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(items: List<StockMovementEntity>)
}

@Dao
interface PendingSyncOperationDao {
    @Query("SELECT * FROM pending_sync_operations WHERE status IN ('PENDING', 'FAILED') AND attempts < :maxAttempts ORDER BY createdAt ASC LIMIT :limit")
    suspend fun nextPending(limit: Int = 25, maxAttempts: Int = 5): List<PendingSyncOperationEntity>

    @Query("SELECT COUNT(*) FROM pending_sync_operations WHERE status IN ('PENDING', 'FAILED')")
    fun observePendingCount(): Flow<Int>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(operation: PendingSyncOperationEntity)

    @Query("UPDATE pending_sync_operations SET status = :status, attempts = attempts + :attemptDelta, lastError = :lastError, updatedAt = :updatedAt WHERE id = :id")
    suspend fun updateStatus(
        id: String,
        status: String,
        attemptDelta: Int,
        lastError: String?,
        updatedAt: String
    )

    @Query("DELETE FROM pending_sync_operations WHERE id = :id")
    suspend fun delete(id: String)
}
